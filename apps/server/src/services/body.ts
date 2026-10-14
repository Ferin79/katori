import { and, asc, eq, gte, lte } from 'drizzle-orm';
import {
  bmi,
  fatMassKg,
  isMinor,
  leanMassKg,
  navyBodyFat,
  waistToHeight,
  waistToHip,
  type BodyBackfillInput,
  type BodyLog,
  type BodyLogInput,
} from '@katori/shared';
import type { ProfileRow } from '../ai/runner.js';
import type { DB } from '../db/client.js';
import { bodyLogs } from '../db/schema.js';
import { maybeRecalculate } from './targets.js';

type BodyRow = typeof bodyLogs.$inferSelect;

/**
 * Raw rows plus derived metrics. Tape measurements are taken every couple of weeks, so body fat
 * uses that day's tape with the latest weight on or before it. Under-18s get no body fat estimate.
 */
export function enrichBody(profile: ProfileRow, rows: BodyRow[], today: string): BodyLog[] {
  const minor = isMinor(profile.birthDate, today);
  let lastWeight: number | null = null;
  return rows.map((r) => {
    if (r.weightKg != null) lastWeight = r.weightKg;
    const w = r.weightKg ?? lastWeight;
    const bf = minor ? null : navyBodyFat({ sex: profile.sex, heightCm: profile.heightCm, neckCm: r.neckCm, waistCm: r.waistCm, hipCm: r.hipCm });
    return {
      date: r.date,
      weightKg: r.weightKg,
      neckCm: r.neckCm,
      waistCm: r.waistCm,
      hipCm: r.hipCm,
      bmi: r.weightKg != null ? bmi(r.weightKg, profile.heightCm) : null,
      bodyFatPct: bf,
      fatMassKg: bf != null && w != null ? fatMassKg(w, bf) : null,
      leanMassKg: bf != null && w != null ? leanMassKg(w, bf) : null,
      waistToHeight: r.waistCm != null ? waistToHeight(r.waistCm, profile.heightCm) : null,
      waistToHip: r.waistCm != null && r.hipCm != null ? waistToHip(r.waistCm, r.hipCm) : null,
    };
  });
}

export function bodyRows(db: DB, profileId: string, from?: string, to?: string): BodyRow[] {
  const conds = [eq(bodyLogs.profileId, profileId)];
  if (from) conds.push(gte(bodyLogs.date, from));
  if (to) conds.push(lte(bodyLogs.date, to));
  return db.select().from(bodyLogs).where(and(...conds)).orderBy(asc(bodyLogs.date)).all();
}

export function listBody(db: DB, profile: ProfileRow, today: string, from?: string, to?: string): BodyLog[] {
  // Enrich over the full history so a range still sees the weight carried into it.
  const all = enrichBody(profile, bodyRows(db, profile.id), today);
  return all.filter((b) => (!from || b.date >= from) && (!to || b.date <= to));
}

/** Upsert one day. Omitted fields keep their value; null clears a field. */
export function upsertBody(db: DB, profile: ProfileRow, date: string, input: BodyLogInput, today: string): BodyLog | null {
  const existing = db
    .select()
    .from(bodyLogs)
    .where(and(eq(bodyLogs.profileId, profile.id), eq(bodyLogs.date, date)))
    .get();
  const merged = {
    profileId: profile.id,
    date,
    weightKg: input.weightKg !== undefined ? input.weightKg : (existing?.weightKg ?? null),
    neckCm: input.neckCm !== undefined ? input.neckCm : (existing?.neckCm ?? null),
    waistCm: input.waistCm !== undefined ? input.waistCm : (existing?.waistCm ?? null),
    hipCm: input.hipCm !== undefined ? input.hipCm : (existing?.hipCm ?? null),
  };
  if (merged.weightKg == null && merged.neckCm == null && merged.waistCm == null && merged.hipCm == null) {
    db.delete(bodyLogs).where(and(eq(bodyLogs.profileId, profile.id), eq(bodyLogs.date, date))).run();
    return null;
  }
  db.insert(bodyLogs)
    .values(merged)
    .onConflictDoUpdate({ target: [bodyLogs.profileId, bodyLogs.date], set: { weightKg: merged.weightKg, neckCm: merged.neckCm, waistCm: merged.waistCm, hipCm: merged.hipCm } })
    .run();
  if (input.weightKg !== undefined) maybeRecalculate(db, profile, today);
  return listBody(db, profile, today, date, date)[0] ?? null;
}

/** Backfill past weigh-ins (e.g. everything since July). Existing tape values are kept. */
export function backfillWeights(db: DB, profile: ProfileRow, input: BodyBackfillInput, today: string): number {
  db.transaction((tx) => {
    for (const e of input.entries) {
      tx.insert(bodyLogs)
        .values({ profileId: profile.id, date: e.date, weightKg: e.weightKg })
        .onConflictDoUpdate({ target: [bodyLogs.profileId, bodyLogs.date], set: { weightKg: e.weightKg } })
        .run();
    }
  });
  maybeRecalculate(db, profile, today);
  return input.entries.length;
}

export function deleteBody(db: DB, profileId: string, date: string): void {
  db.delete(bodyLogs).where(and(eq(bodyLogs.profileId, profileId), eq(bodyLogs.date, date))).run();
}
