import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Dashboard, Meal, MyFood, Profile, TargetsView } from '@katori/shared';
import { runBackup, restoreBackup } from './services/backup.js';
import { FAKE_JPEG, H, TODAY, arjunInput, makeTestApp, multipart, type TestApp } from './test/helpers.js';

let t: TestApp;
beforeEach(async () => {
  t = await makeTestApp();
});
afterEach(async () => {
  await t.close();
});

async function api<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await t.app.inject({ method: method as 'GET', url, payload: body as object, headers: { ...H, ...headers } });
  return { status: res.statusCode, json: (res.body ? JSON.parse(res.body) : null) as T };
}

async function createArjun(over = {}) {
  const r = await api<Profile>('POST', '/api/profiles', arjunInput(over));
  expect(r.status).toBe(201);
  return r.json;
}

async function addMeal(pid: string, data: object, photo: Buffer | undefined = FAKE_JPEG) {
  const m = multipart(data, photo);
  const res = await t.app.inject({ method: 'POST', url: `/api/profiles/${pid}/meals`, payload: m.payload, headers: m.headers });
  expect(res.statusCode, res.body).toBe(201);
  return JSON.parse(res.body) as Meal[];
}

describe('profiles and targets', () => {
  it('onboarding yields the worked-example targets (≈2,044 kcal, 112 g protein)', async () => {
    const p = await createArjun();
    expect(p.id).toBe('arjun');
    expect(p.age).toBe(26);
    const { json } = await api<TargetsView>('GET', `/api/profiles/${p.id}/targets`);
    expect(json.current).toMatchObject({ kcal: 2044, protein_g: 112, fat_g: 57, carbs_g: 271, fiber_g: 29, source: 'formula' });
    // Journey start point was recorded
    const body = await api<{ date: string; weightKg: number }[]>('GET', `/api/profiles/${p.id}/body`);
    expect(body.json.map((b) => b.date)).toEqual([TODAY, '2026-07-01']);
  });

  it('applies the guardrails', async () => {
    const fast = await createArjun({ name: 'Fast', paceKgWeek: 1.5 });
    const t1 = await api<TargetsView>('GET', `/api/profiles/${fast.id}/targets`);
    expect(t1.json.formula?.paceCapped).toBe(true);
    expect(t1.json.formula?.appliedPaceKgWeek).toBeCloseTo(0.7, 5);

    const preg = await createArjun({ name: 'Asha', sex: 'female', hipCm: 98, neckCm: 32, waistCm: 80, specialStatus: 'pregnant' });
    const t2 = await api<TargetsView>('GET', `/api/profiles/${preg.id}/targets`);
    expect(t2.json.formula?.maintenanceOnly).toBe(true);
    expect(t2.json.current?.kcal).toBe(Math.round(t2.json.formula!.maintenance));

    const kid = await createArjun({ name: 'Kid', birthDate: '2012-05-01', weightKg: 45, heightCm: 155 });
    expect(kid.minor).toBe(true);
    const dash = await api<Dashboard>('GET', `/api/profiles/${kid.id}/dashboard`);
    expect(dash.json.body).toBeNull(); // no body fat estimate for under-18s
  });

  it('manual override and recalculation on a 1 kg move', async () => {
    const p = await createArjun();
    await api('PUT', `/api/profiles/${p.id}/targets`, { kcal: 1900, protein_g: 120, carbs_g: 220, fat_g: 60, fiber_g: 30 });
    let v = await api<TargetsView>('GET', `/api/profiles/${p.id}/targets`);
    expect(v.json.current).toMatchObject({ kcal: 1900, source: 'manual' });
    await api('POST', `/api/profiles/${p.id}/targets/recalculate`);
    v = await api<TargetsView>('GET', `/api/profiles/${p.id}/targets`);
    expect(v.json.current).toMatchObject({ kcal: 2044, source: 'formula' });
    await api('PUT', `/api/profiles/${p.id}/body/${TODAY}`, { weightKg: 68.8 }, {});
    v = await api<TargetsView>('GET', `/api/profiles/${p.id}/targets`);
    expect(v.json.current?.basisWeightKg).toBe(68.8);
    expect(v.json.current?.protein_g).toBe(110);
  });
});

describe('meals', () => {
  it('Add meal → pending → estimated with a question → answer → confirm with edits', async () => {
    const p = await createArjun();
    const [meal] = await addMeal(p.id, { note: '2 rotis, 1 katori dal', slot: 'Dinner', eatenAt: `${TODAY}T18:10` });
    expect(meal!.status).toBe('pending');
    await t.ctx.queue.idle();

    let m = (await api<Meal>('GET', `/api/profiles/${p.id}/meals/${meal!.id}`)).json;
    expect(m.status).toBe('estimated');
    expect(m.items.map((i) => i.name)).toEqual(['Phulka roti', 'Toor dal', 'Oil or ghee in tadka']);
    expect(m.questions[0]?.text).toBe('Ghee or oil in the tadka?');

    await api('POST', `/api/profiles/${p.id}/meals/${m.id}/answers`, { answers: [{ question: 'Ghee or oil in the tadka?', answer: 'Ghee' }] });
    await t.ctx.queue.idle();
    m = (await api<Meal>('GET', `/api/profiles/${p.id}/meals/${m.id}`)).json;
    expect(m.questions).toEqual([]);
    expect(m.items.at(-1)?.name).toBe('Ghee in tadka');

    const items = m.items.map((i) => (i.name === 'Phulka roti' ? { ...i, grams: 35, kcal: 92, protein_g: 3, carbs_g: 17.7, fat_g: 0.9, fiber_g: 2.5 } : i));
    const confirmed = await api<Meal>('POST', `/api/profiles/${p.id}/meals/${m.id}/confirm`, { items });
    expect(confirmed.json.status).toBe('confirmed');
    const dash = await api<Dashboard>('GET', `/api/profiles/${p.id}/dashboard`);
    expect(dash.json.today.totals.kcal).toBe(confirmed.json.totals.kcal);
    expect(dash.json.today.remainingKcal).toBe(2044 - confirmed.json.totals.kcal);
  });

  it("keeps each profile's meals to itself", async () => {
    const a = await createArjun();
    const b = await createArjun({ name: 'Priya', sex: 'female', hipCm: 98, neckCm: 32, waistCm: 78 });
    await addMeal(a.id, { note: '1 katori poha', slot: 'Brunch', eatenAt: `${TODAY}T11:00` });
    await t.ctx.queue.idle();
    expect((await api<Meal[]>('GET', `/api/profiles/${a.id}/meals`)).json).toHaveLength(1);
    expect((await api<Meal[]>('GET', `/api/profiles/${b.id}/meals`)).json).toHaveLength(0);
    expect((await api('GET', `/api/profiles/${b.id}/meals/1`)).status).toBe(404);
  });

  it('shared plates: "Also for" logs one photo to both profiles with their own portions', async () => {
    const a = await createArjun();
    const b = await createArjun({ name: 'Priya', sex: 'female', hipCm: 98, neckCm: 32, waistCm: 78, mealSlots: [{ name: 'Supper', time: '19:00' }] });
    const created = await addMeal(a.id, { note: '2 rotis, 1 katori dal, no ghee', slot: 'Dinner', eatenAt: `${TODAY}T18:30`, portion: 1, alsoFor: [{ profileId: b.id, portion: 0.5 }] });
    expect(created).toHaveLength(2);
    expect(created[0]!.sharedGroupId).toBe(created[1]!.sharedGroupId);
    await t.ctx.queue.idle();
    const mine = (await api<Meal[]>('GET', `/api/profiles/${a.id}/meals`)).json[0]!;
    const hers = (await api<Meal[]>('GET', `/api/profiles/${b.id}/meals`)).json[0]!;
    expect(hers.slot).toBe('Supper');
    expect(hers.totals.kcal).toBeCloseTo(mine.totals.kcal / 2, -1);
    expect(mine.sharedWith[0]).toMatchObject({ profileId: b.id, portion: 0.5 });
    // One photo file serves both.
    const files = readdirSync(t.cfg.photosDir, { recursive: true }).filter((f) => String(f).endsWith('.jpg'));
    expect(files).toHaveLength(1);
  });

  it('saved foods: AI lines use your numbers; quick add logs in one tap; household foods are shared', async () => {
    const a = await createArjun();
    const b = await createArjun({ name: 'Priya', sex: 'female', hipCm: 98, neckCm: 32, waistCm: 78 });
    const shake = (await api<MyFood>('POST', `/api/profiles/${a.id}/foods`, { name: '3 PM shake', aliases: ['shake'], servingDesc: '1 glass', servingG: 350, kcal: 240, protein_g: 30, carbs_g: 14, fat_g: 6, fiber_g: 3, household: false })).json;
    const dal = (await api<MyFood>('POST', `/api/profiles/${a.id}/foods`, { name: 'Household dal', aliases: ['dal'], servingDesc: '1 katori', servingG: 150, kcal: 170, protein_g: 9, carbs_g: 22, fat_g: 5, fiber_g: 5, household: true })).json;
    expect((await api<MyFood[]>('GET', `/api/profiles/${b.id}/foods`)).json.map((f) => f.name)).toEqual(['Household dal']);

    const quick = await api<Meal>('POST', `/api/profiles/${a.id}/meals/quick`, { myFoodId: shake.id, servings: 1, slot: 'Shake', eatenAt: `${TODAY}T15:00` });
    expect(quick.json).toMatchObject({ status: 'confirmed', totals: { kcal: 240, protein_g: 30 } });

    await addMeal(a.id, { note: '2 rotis, 1 katori dal, no ghee', slot: 'Dinner', eatenAt: `${TODAY}T18:00` });
    await t.ctx.queue.idle();
    const meals = (await api<Meal[]>('GET', `/api/profiles/${a.id}/meals`)).json;
    const dalLine = meals.flatMap((m) => m.items).find((i) => i.myFoodId === dal.id);
    expect(dalLine).toMatchObject({ source: 'my_food', kcal: 170, protein_g: 9 });
    const chips = (await api<MyFood[]>('GET', `/api/profiles/${a.id}/foods/quick`)).json;
    expect(chips[0]?.uses).toBeGreaterThan(0);
  });

  it('failure paths: error and timeout retry then show Failed with Retry; signed out shows the banner', async () => {
    const p = await createArjun();
    await api('POST', '/api/_test/fake', { mode: 'error' });
    const [m1] = await addMeal(p.id, { note: '1 katori poha', slot: 'Brunch', eatenAt: `${TODAY}T11:00` });
    await new Promise((r) => setTimeout(r, 400));
    await t.ctx.queue.idle();
    let m = (await api<Meal>('GET', `/api/profiles/${p.id}/meals/${m1!.id}`)).json;
    expect(m).toMatchObject({ status: 'failed', attempts: 3 });
    expect(m.error).toMatch(/fake runner error/);

    await api('POST', '/api/_test/fake', { mode: 'timeout' });
    await api('POST', `/api/profiles/${p.id}/meals/${m.id}/retry`);
    await new Promise((r) => setTimeout(r, 400));
    await t.ctx.queue.idle();
    m = (await api<Meal>('GET', `/api/profiles/${p.id}/meals/${m.id}`)).json;
    expect(m.status).toBe('failed');
    expect(m.error).toMatch(/Timed out/);

    await api('POST', '/api/_test/fake', { mode: 'ok' });
    await api('POST', `/api/profiles/${p.id}/meals/${m.id}/retry`);
    await t.ctx.queue.idle();
    expect((await api<Meal>('GET', `/api/profiles/${p.id}/meals/${m.id}`)).json.status).toBe('estimated');

    await api('POST', '/api/_test/fake', { auth: { profileId: p.id, ok: false } });
    expect((await api<Profile>('GET', `/api/profiles/${p.id}`)).json.auth.status).toBe('signed_out');
    const [m2] = await addMeal(p.id, { note: '1 katori upma', slot: 'Brunch', eatenAt: `${TODAY}T11:30` });
    await t.ctx.queue.idle();
    m = (await api<Meal>('GET', `/api/profiles/${p.id}/meals/${m2!.id}`)).json;
    expect(m).toMatchObject({ status: 'failed', attempts: 1 }); // auth failures don't retry
  });

  it('manual-only profiles skip the AI and start from saved foods named in the note', async () => {
    const p = await createArjun({ aiAccess: 'manual' });
    await api('POST', `/api/profiles/${p.id}/foods`, { name: 'Poha', aliases: [], servingDesc: '1 plate', servingG: 200, kcal: 260, protein_g: 5, carbs_g: 48, fat_g: 5, fiber_g: 2, household: true });
    const [m] = await addMeal(p.id, { note: 'poha', slot: 'Brunch', eatenAt: `${TODAY}T11:00` }, undefined);
    expect(m).toMatchObject({ status: 'estimated', totals: { kcal: 260 } });
  });
});

describe('body metrics and progress', () => {
  it('computes BMI, ratios and Navy body fat', async () => {
    const p = await createArjun();
    const r = await api<{ log: { bmi: number; bodyFatPct: number; waistToHeight: number } }>('PUT', `/api/profiles/${p.id}/body/${TODAY}`, { weightKg: 70, neckCm: 38, waistCm: 85 });
    expect(r.json.log.bmi).toBeCloseTo(22.14, 2);
    expect(r.json.log.bodyFatPct).toBeCloseTo(16.47, 1);
    expect(r.json.log.waistToHeight).toBeCloseTo(0.478, 3);
  });

  it('backfill builds the journey with monthly averages', async () => {
    const p = await createArjun();
    const entries = [];
    for (let i = 0; i < 100; i++) {
      const d = new Date(Date.UTC(2026, 6, 1 + i));
      entries.push({ date: d.toISOString().slice(0, 10), weightKg: Math.round((78 - i * 0.06) * 10) / 10 });
    }
    await api('POST', `/api/profiles/${p.id}/body/backfill`, { entries });
    const j = await api<{ startKg: number; months: { month: string; avgWeightKg: number }[]; points: unknown[] }>('GET', `/api/profiles/${p.id}/journey`);
    expect(j.json.startKg).toBe(78);
    expect(j.json.months.map((m) => m.month)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(j.json.months[0]!.avgWeightKg).toBeGreaterThan(j.json.months[2]!.avgWeightKg);
    expect(j.json.points.length).toBeGreaterThan(90);
  });

  it('seeded 60-day profile fills every dashboard card', async () => {
    const { seedTestData } = await import('./seed.js');
    seedTestData(t.ctx.db, TODAY);
    const d = (await api<Dashboard>('GET', '/api/profiles/meera/dashboard')).json;
    expect(d.last7.days).toHaveLength(7);
    expect(d.weight.points.length).toBeGreaterThan(40);
    expect(d.body?.points.length).toBeGreaterThan(3);
    expect(d.waist.points.length).toBeGreaterThan(3);
    expect(d.streak.heatmap.length).toBeGreaterThan(70);
    expect(d.slots.map((s) => s.name)).toEqual(['Breakfast', 'Lunch', 'Snack', 'Dinner']);
    expect(d.top.byKcal.length).toBeGreaterThan(0);
    expect(d.energy.learnedMaintenance).not.toBeNull();
    const month = (await api<{ days: unknown[]; averages: { loggedDays: number } }>('GET', '/api/profiles/meera/month')).json;
    expect(month.averages.loggedDays).toBeGreaterThan(5);
  });

  it('writes a monthly recap through the queue', async () => {
    const p = await createArjun();
    await api('POST', `/api/profiles/${p.id}/recaps`, { month: '2026-10' });
    await t.ctx.queue.idle();
    const m = await api<{ recap: { status: string; text: string } }>('GET', `/api/profiles/${p.id}/month?month=2026-10`);
    expect(m.json.recap.status).toBe('done');
    expect(m.json.recap.text).toContain('2026-10 recap for Arjun');
  });

  it('exports CSV with rows', async () => {
    const p = await createArjun();
    await addMeal(p.id, { note: '2 rotis, 1 katori dal', slot: 'Dinner', eatenAt: `${TODAY}T18:00` });
    await t.ctx.queue.idle();
    const res = await t.app.inject({ method: 'GET', url: `/api/profiles/${p.id}/export/meals.csv`, headers: H });
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines[0]).toMatch(/^date,time,slot/);
    expect(lines.length).toBeGreaterThan(2);
  });
});

describe('PINs', () => {
  it('locks a profile until unlocked', async () => {
    const p = await createArjun();
    const set = await api<{ token: string }>('PUT', `/api/profiles/${p.id}/pin`, { pin: '1234' });
    expect((await api('GET', `/api/profiles/${p.id}/dashboard`)).status).toBe(423);
    expect((await api('POST', `/api/profiles/${p.id}/unlock`, { pin: '9999' })).status).toBe(403);
    const ok = await api<{ token: string }>('POST', `/api/profiles/${p.id}/unlock`, { pin: '1234' });
    expect((await api('GET', `/api/profiles/${p.id}/dashboard`, undefined, { 'x-katori-unlock': ok.json.token })).status).toBe(200);
    expect(set.json.token).toBeTruthy();
    // The profile list stays visible so the chips can render.
    expect((await api<{ hasPin: boolean }[]>('GET', '/api/profiles')).json[0]!.hasPin).toBe(true);
  });
});

describe('calibration', () => {
  it('logs the calorie error per meal and excludes calibration meals from totals', async () => {
    const p = await createArjun();
    const m = multipart({ note: '2 rotis, 1 katori dal, 1 tsp ghee', trueKcal: 400, trueProteinG: 15 }, FAKE_JPEG);
    const res = await t.app.inject({ method: 'POST', url: `/api/profiles/${p.id}/calibration`, payload: m.payload, headers: m.headers });
    expect(res.statusCode).toBe(201);
    await t.ctx.queue.idle();
    const v = (await api<{ rows: { errorPct: number; estimatedKcal: number }[]; summary: { scored: number } }>('GET', '/api/calibration')).json;
    expect(v.summary.scored).toBe(1);
    expect(v.rows[0]!.errorPct).toBeCloseTo(((v.rows[0]!.estimatedKcal - 400) / 400) * 100, 0);
    expect((await api<Dashboard>('GET', `/api/profiles/${p.id}/dashboard`)).json.today.totals.kcal).toBe(0);
    expect((await api<{ queued: number }>('POST', '/api/calibration/rerun')).json.queued).toBe(1);
  });
});

describe('backups', () => {
  it('backup-and-restore drill', async () => {
    const p = await createArjun();
    const s = await runBackup(t.ctx.db, t.cfg);
    expect(s.ok).toBe(true);
    expect(existsSync(s.file!)).toBe(true);
    // One self-contained file: no WAL side files next to the snapshot.
    expect(existsSync(`${s.file}-wal`)).toBe(false);
    expect(existsSync(`${s.file}-shm`)).toBe(false);
    // Restoring onto a fresh machine (no data folder yet) works.
    const fresh = path.join(t.dir, 'fresh', 'katori.db');
    restoreBackup({ ...t.cfg, dbPath: fresh }, s.file!);
    expect(existsSync(fresh)).toBe(true);
    const sys = await api<{ backup: { ok: boolean; stale: boolean } }>('GET', '/api/system');
    expect(sys.json.backup).toMatchObject({ ok: true, stale: false });

    await api('DELETE', `/api/profiles/${p.id}`);
    expect((await api<unknown[]>('GET', '/api/profiles')).json).toHaveLength(0);
    await t.app.close();
    restoreBackup(t.cfg, s.file!);
    const again = await makeTestApp({ ...t.cfg });
    try {
      const res = await again.app.inject({ method: 'GET', url: '/api/profiles', headers: H });
      expect(JSON.parse(res.body)).toHaveLength(1);
    } finally {
      await again.close();
    }
    const dir = t.dir;
    t.close = async () => rmSync(dir, { recursive: true, force: true }); // app already closed
    expect(path.basename(s.file!)).toMatch(/^katori-\d{4}-\d{2}-\d{2}\.db$/);
  });
});
