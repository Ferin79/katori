import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ProfileInput } from '@katori/shared';
import { buildApp, type BuiltApp } from '../app.js';
import { loadConfig, type Config } from '../config.js';

export interface TestApp extends BuiltApp {
  dir: string;
  cfg: Config;
  close: () => Promise<void>;
}

export async function makeTestApp(overrides: Partial<Config> = {}): Promise<TestApp> {
  const dir = mkdtempSync(path.join(tmpdir(), 'katori-test-'));
  const cfg = loadConfig({
    dataDir: dir,
    dbPath: path.join(dir, 'test.db'),
    photosDir: path.join(dir, 'photos'),
    jobsDir: path.join(dir, 'jobs'),
    credentialsDir: path.join(dir, 'credentials'),
    claudeConfigRoot: path.join(dir, 'claude'),
    backupStatusFile: path.join(dir, 'backup-status.json'),
    backupDir: path.join(dir, 'backups'),
    webDist: path.join(dir, 'no-web'),
    aiMode: 'fake',
    testMode: true,
    fakeDelayMs: 5,
    retryBaseMs: 10,
    maxAttempts: 3,
    ambientAuthProfile: null,
    ...overrides,
  });
  const built = await buildApp(cfg, { logger: false });
  built.ctx.queue.start();
  return {
    ...built,
    dir,
    cfg,
    close: async () => {
      await built.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const TODAY = '2026-10-14';
export const H = { 'x-katori-date': TODAY };

/** PLAN.md worked example: 26, male, 177.8 cm, 70 kg, desk job + 3 workouts, 0.25 kg/week. */
export function arjunInput(over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    name: 'Arjun',
    colour: '#e07a2f',
    sex: 'male',
    birthDate: '2000-01-15',
    heightCm: 177.8,
    weightKg: 70,
    goal: 'lose',
    goalWeightKg: 66,
    paceKgWeek: 0.25,
    jobType: 'desk',
    workoutsPerWeek: 3,
    activity: 'light',
    neckCm: 38,
    waistCm: 85,
    hipCm: null,
    diet: { vegetarian: true, eggs: false },
    mealSlots: [
      { name: 'Brunch', time: '11:00' },
      { name: 'Shake', time: '15:00' },
      { name: 'Dinner', time: '18:00' },
    ],
    specialStatus: 'none',
    aiAccess: 'sign_in',
    startWeightKg: 78,
    startDate: '2026-07-01',
    ...over,
  };
}

export function multipart(data: object, photo?: Buffer) {
  const boundary = `----katori${Math.random().toString(16).slice(2)}`;
  const parts: Buffer[] = [Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="data"\r\n\r\n${JSON.stringify(data)}\r\n`)];
  if (photo) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="meal.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`), photo, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...H } };
}

/** Not a real picture, but it has JPEG magic bytes, which is all the server checks. */
export const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(256, 7)]);
