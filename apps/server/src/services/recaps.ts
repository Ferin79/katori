// A monthly recap per profile, written by Claude from that month's numbers. Runs through the
// same one-at-a-time queue with the profile's own AI access.
import { and, eq } from 'drizzle-orm';
import { toDateStr, type Recap } from '@katori/shared';
import type { ProfileRow } from '../ai/runner.js';
import { RunnerError } from '../ai/runner.js';
import type { Ctx } from '../context.js';
import type { DB } from '../db/client.js';
import { aiRuns, recaps } from '../db/schema.js';
import { badRequest } from '../lib/http.js';
import { getProfileRow } from './profiles.js';
import { monthStats } from './progress.js';
import { getSettings } from './settings.js';
import { topFoods } from './totals.js';

type RecapRow = typeof recaps.$inferSelect;

const toRecap = (r: RecapRow): Recap => ({ month: r.month, status: r.status, text: r.text, error: r.error, createdAt: r.createdAt });

export function getRecap(db: DB, profileId: string, month: string): Recap | null {
  const row = db.select().from(recaps).where(and(eq(recaps.profileId, profileId), eq(recaps.month, month))).get();
  return row ? toRecap(row) : null;
}

export function requestRecap(ctx: Ctx, profile: ProfileRow, month: string): Recap {
  if (profile.aiAccess === 'manual') throw badRequest('Recaps need AI access; this profile is manual-only.');
  ctx.db
    .insert(recaps)
    .values({ profileId: profile.id, month, status: 'pending', createdAt: new Date().toISOString() })
    .onConflictDoUpdate({ target: [recaps.profileId, recaps.month], set: { status: 'pending', text: null, error: null, createdAt: new Date().toISOString() } })
    .run();
  ctx.queue.kick();
  return getRecap(ctx.db, profile.id, month)!;
}

export function monthSummary(db: DB, profile: ProfileRow, month: string, today: string): string {
  const s = monthStats(db, profile, month, today);
  const top = topFoods(db, profile.id, s.days[0]?.date ?? `${month}-01`, s.days.at(-1)?.date ?? `${month}-28`);
  const lines = [
    `Month: ${month}`,
    `- Days logged: ${s.averages.loggedDays} of ${s.days.length}`,
    `- Average intake: ${s.averages.kcal} kcal a day${s.targetKcal ? ` against a target of ${s.targetKcal}` : ''}`,
    `- Average protein: ${s.averages.protein_g} g; carbs ${s.averages.carbs_g} g; fat ${s.averages.fat_g} g; fiber ${s.averages.fiber_g} g`,
    `- Days on target: ${s.daysOnTarget}; days over: ${s.daysOver}`,
  ];
  if (s.weight.startKg != null) lines.push(`- Weight: ${s.weight.startKg} kg → ${s.weight.endKg} kg (change ${s.weight.changeKg} kg, average ${s.weight.avgKg} kg)`);
  if (s.waist.startCm != null) lines.push(`- Waist: ${s.waist.startCm} cm → ${s.waist.endCm} cm`);
  if (s.bodyFat.start != null) lines.push(`- Estimated body fat: ${s.bodyFat.start}% → ${s.bodyFat.end}%`);
  if (top.byKcal.length) lines.push(`- Top calorie sources: ${top.byKcal.map((t) => `${t.name} (${t.kcal} kcal)`).join(', ')}`);
  if (top.byProtein.length) lines.push(`- Top protein sources: ${top.byProtein.map((t) => `${t.name} (${t.protein_g} g)`).join(', ')}`);
  if (profile.goalWeightKg) lines.push(`- Goal weight: ${profile.goalWeightKg} kg`);
  return lines.join('\n');
}

export async function processRecap(ctx: Ctx, profileId: string, month: string): Promise<void> {
  const { db, runner } = ctx;
  const profile = getProfileRow(db, profileId);
  const settings = getSettings(db);
  const today = toDateStr(new Date());
  const started = Date.now();
  const run = db.insert(aiRuns).values({ profileId, kind: 'recap', startedAt: new Date(started).toISOString(), model: settings.model }).returning({ id: aiRuns.id }).get();
  try {
    const res = await runner.recap({ profile, model: settings.model, month, summary: monthSummary(db, profile, month, today) });
    db.update(aiRuns).set({ durationMs: Date.now() - started, exitCode: res.exitCode, model: res.model, outputJson: res.text }).where(eq(aiRuns.id, run.id)).run();
    db.update(recaps).set({ status: 'done', text: res.text, error: null }).where(and(eq(recaps.profileId, profileId), eq(recaps.month, month))).run();
  } catch (e) {
    const err = e instanceof RunnerError ? e : new RunnerError('error', String(e), false);
    if (err.kind === 'auth') ctx.auth.markSignedOut(profileId, err.message);
    db.update(aiRuns).set({ durationMs: Date.now() - started, exitCode: err.meta.exitCode ?? null, error: `${err.kind}: ${err.message}` }).where(eq(aiRuns.id, run.id)).run();
    db.update(recaps).set({ status: 'failed', error: err.message }).where(and(eq(recaps.profileId, profileId), eq(recaps.month, month))).run();
  }
}
