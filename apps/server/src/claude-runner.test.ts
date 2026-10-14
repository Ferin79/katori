import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@katori/shared';
import { buildSystemPrompt, buildUserPrompt } from './ai/prompt.js';
import { fakeEstimate } from './ai/fake-runner.js';
import { ClaudeRunner } from './ai/claude-runner.js';
import { RunnerError, type MyFoodRow, type ProfileRow } from './ai/runner.js';
import { writeCredential } from './services/credentials.js';
import { estimateToItems } from './services/meals.js';
import { FAKE_JPEG, makeTestApp, type TestApp } from './test/helpers.js';
import { writeFileSync } from 'node:fs';

const stub = fileURLToPath(new URL('./test/stub-claude.mjs', import.meta.url));

const profile: ProfileRow = {
  id: 'arjun',
  name: 'Arjun',
  colour: '#e07a2f',
  sex: 'male',
  birthDate: '2000-01-15',
  heightCm: 177.8,
  activity: 'light',
  jobType: 'desk',
  workoutsPerWeek: 3,
  goal: 'lose',
  goalWeightKg: 66,
  paceKgWeek: 0.25,
  dietFlags: { vegetarian: true, eggs: false },
  mealSlots: [{ name: 'Dinner', time: '18:00' }],
  specialStatus: 'none',
  aiAccess: 'sign_in',
  pinHash: null,
  createdAt: '2026-10-14T00:00:00Z',
};

const dal: MyFoodRow = { id: 1, profileId: null, name: 'Household dal', aliases: ['my usual dal'], servingDesc: '1 katori', servingG: 150, kcal: 170, proteinG: 9, carbsG: 22, fatG: 5, fiberG: 5, createdAt: '' };

let t: TestApp | null = null;
afterEach(async () => {
  await t?.close();
  t = null;
});

async function runnerApp() {
  t = await makeTestApp({ aiMode: 'claude', claudeBin: process.execPath, claudeBinArgs: [stub], testMode: false });
  return { runner: new ClaudeRunner(t.cfg), cfg: t.cfg };
}

describe('ClaudeRunner (against a stub claude binary)', () => {
  it('runs exactly the PLAN.md call: argv array, empty folder with meal.jpg, one credential', async () => {
    const { runner, cfg } = await runnerApp();
    writeCredential(cfg, 'arjun', { type: 'oauth', token: 'sk-ant-oat01-good' });
    const photo = path.join(cfg.dataDir, 'in.jpg');
    writeFileSync(photo, FAKE_JPEG);
    const res = await runner.estimate({ profile, photoPath: photo, note: '2 rotis, my usual dal', answers: [], settings: DEFAULT_SETTINGS, savedFoods: [dal], referenceLookup: false });

    expect(res.estimate.items).toHaveLength(2);
    const report = JSON.parse(readFileSync(path.join(cfg.claudeConfigRoot, 'arjun', 'report-run.json'), 'utf8'));
    expect(report.cwdFiles).toEqual(['meal.jpg']);
    expect(report.hasOauth).toBe(true);
    expect(report.hasApiKey).toBe(false);
    expect(report.configDir).toBe(path.join(cfg.claudeConfigRoot, 'arjun'));
    const a: string[] = report.args;
    expect(a[0]).toBe('-p');
    expect(a[1]).toContain('Photo: ./meal.jpg. Note: 2 rotis, my usual dal');
    const flag = (f: string) => a[a.indexOf(f) + 1];
    expect(flag('--model')).toBe('sonnet');
    expect(flag('--tools')).toBe('Read');
    expect(flag('--disallowedTools')).toBe('mcp__*');
    expect(flag('--permission-mode')).toBe('dontAsk');
    expect(flag('--output-format')).toBe('json');
    expect(flag('--max-turns')).toBe('4');
    expect(JSON.parse(flag('--json-schema')!).title).toBe('MealEstimate');
    expect(a).toContain('--no-session-persistence');
    expect(a).toContain('--append-system-prompt-file');
    expect(a).not.toContain('--bare');
    // Nothing secret beyond the one credential leaks into the job environment.
    expect(report.envKeys).not.toContain('ANTHROPIC_API_KEY');
  });

  it('with the lookup tool: strict MCP config allowing only search_food', async () => {
    const { runner, cfg } = await runnerApp();
    writeCredential(cfg, 'arjun', { type: 'oauth', token: 'sk-ant-oat01-good' });
    await runner.estimate({ profile, photoPath: null, note: 'dal', answers: [], settings: DEFAULT_SETTINGS, savedFoods: [], referenceLookup: true });
    const a: string[] = JSON.parse(readFileSync(path.join(cfg.claudeConfigRoot, 'arjun', 'report-run.json'), 'utf8')).args;
    expect(a).toContain('--strict-mcp-config');
    expect(a).toContain('mcp__katori_ref__search_food');
    expect(a).not.toContain('--disallowedTools');
  });

  it('classifies a rejected credential as a non-retryable auth error', async () => {
    const { runner, cfg } = await runnerApp();
    writeCredential(cfg, 'arjun', { type: 'oauth', token: 'sk-ant-oat01-expired' });
    const err = await runner.estimate({ profile, photoPath: null, note: 'dal', answers: [], settings: DEFAULT_SETTINGS, savedFoods: [], referenceLookup: false }).catch((e) => e);
    expect(err).toBeInstanceOf(RunnerError);
    expect(err).toMatchObject({ kind: 'auth', retryable: false });
    expect(err.message).toContain('401 OAuth access token is invalid');
    expect((await runner.authStatus(profile)).ok).toBe(false);
  });

  it('refuses to run without the profile’s own credential (never falls back to someone else’s)', async () => {
    const { runner } = await runnerApp();
    const err = await runner.estimate({ profile, photoPath: null, note: 'dal', answers: [], settings: DEFAULT_SETTINGS, savedFoods: [], referenceLookup: false }).catch((e) => e);
    expect(err).toMatchObject({ kind: 'auth', retryable: false });
    expect(err.message).toMatch(/katori set-credential arjun/);
  });

  it('API-key profiles get only ANTHROPIC_API_KEY', async () => {
    const { runner, cfg } = await runnerApp();
    writeCredential(cfg, 'arjun', { type: 'api_key', key: 'sk-ant-api03-good' });
    const ok = await runner.authStatus({ ...profile, aiAccess: 'api_key' });
    expect(ok.ok).toBe(true);
    const report = JSON.parse(readFileSync(path.join(cfg.claudeConfigRoot, 'arjun', 'report-auth.json'), 'utf8'));
    expect(report).toMatchObject({ hasApiKey: true, hasOauth: false });
  });
});

describe('prompt', () => {
  it('injects household measures, diet and saved foods', () => {
    const s = buildSystemPrompt('# Base', { settings: { ...DEFAULT_SETTINGS, katoriMl: 180, rotiG: 40 }, profile, savedFoods: [dal], referenceLookup: false });
    expect(s).toContain('1 katori (bowl) = 180 ml');
    expect(s).toContain('1 typical roti = 40 g');
    expect(s).toContain('vegetarian, no eggs');
    expect(s).toContain('id 1: Household dal (also: my usual dal)');
    expect(s).not.toContain('search_food');
    expect(buildUserPrompt({ hasPhoto: true, note: 'x', answers: [{ question: 'Ghee or oil?', answer: 'Ghee' }] })).toContain('- Ghee or oil? → Ghee');
  });
});

describe('estimate post-processing', () => {
  it('replaces matched lines with saved-food numbers and scales shared portions', () => {
    const items = estimateToItems(
      {
        items: [
          { name: 'Dal', portion: '1 katori', grams: 300, kcal: 999, protein_g: 1, carbs_g: 1, fat_g: 1, fiber_g: 1, confidence: 'medium', myFoodId: '1', referenceId: null },
          { name: 'Rice', portion: '1 katori', grams: 120, kcal: 156, protein_g: 3.2, carbs_g: 33.6, fat_g: 0.4, fiber_g: 0.5, confidence: 'high', myFoodId: null, referenceId: 'INDB:ASC100' },
        ],
        questions: [],
      },
      [dal],
      0.5,
    );
    expect(items[0]).toMatchObject({ name: 'Household dal', source: 'my_food', myFoodId: 1, grams: 150, kcal: 170, proteinG: 9 });
    expect(items[1]).toMatchObject({ source: 'reference', kcal: 78 });
  });

  it('fake estimator reads notes like the prompt asks', () => {
    const r = fakeEstimate({ profile, photoPath: null, note: '2 rotis, 1 katori dal, little ghee', answers: [], settings: DEFAULT_SETTINGS, savedFoods: [], referenceLookup: false });
    expect(r.items.map((i) => [i.name, i.portion])).toEqual([
      ['Phulka roti', '2 medium'],
      ['Toor dal', '1 katori'],
      ['Ghee on roti', '1 tsp'],
    ]);
    expect(r.questions).toEqual([]);
  });
});
