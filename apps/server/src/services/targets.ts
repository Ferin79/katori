import { and, asc, desc, eq, lte } from 'drizzle-orm';
import {
  ageOn,
  addDays,
  blendMaintenance,
  computeTargets,
  diffDays,
  observedMaintenance,
  trendOn,
  trendWeights,
  type ManualTargetInput,
  type TargetBreakdown,
  type TargetRow,
  type TargetSource,
  type TargetSuggestion,
  type TargetsView,
} from '@katori/shared';
import type { ProfileRow } from '../ai/runner.js';
import type { DB } from '../db/client.js';
import { bodyLogs, targets } from '../db/schema.js';
import { getInternal, setInternal } from './settings.js';
import { dailyTotals } from './totals.js';

type TargetDbRow = typeof targets.$inferSelect;

export function rowToTarget(r: TargetDbRow): TargetRow {
  return {
    id: r.id,
    effectiveFrom: r.effectiveFrom,
    kcal: r.kcal,
    protein_g: r.proteinG,
    carbs_g: r.carbsG,
    fat_g: r.fatG,
    fiber_g: r.fiberG,
    source: r.source,
    basisWeightKg: r.basisWeightKg,
  };
}

export function latestWeight(db: DB, profileId: string, onOrBefore?: string): number | null {
  const conds = [eq(bodyLogs.profileId, profileId)];
  if (onOrBefore) conds.push(lte(bodyLogs.date, onOrBefore));
  const rows = db
    .select({ w: bodyLogs.weightKg })
    .from(bodyLogs)
    .where(and(...conds))
    .orderBy(desc(bodyLogs.date))
    .all();
  return rows.find((r) => r.w != null)?.w ?? null;
}

export function formulaBreakdown(profile: ProfileRow, weightKg: number, onDate: string, maintenanceOverride?: number): TargetBreakdown {
  return computeTargets({
    sex: profile.sex,
    weightKg,
    heightCm: profile.heightCm,
    age: ageOn(profile.birthDate, onDate),
    activity: profile.activity,
    goal: profile.goal,
    paceKgWeek: profile.paceKgWeek,
    specialStatus: profile.specialStatus,
    maintenanceOverride,
  });
}

export function listTargets(db: DB, profileId: string): TargetRow[] {
  return db
    .select()
    .from(targets)
    .where(eq(targets.profileId, profileId))
    .orderBy(asc(targets.effectiveFrom), asc(targets.id))
    .all()
    .map(rowToTarget);
}

/** The target in force on a date; old days are judged by the targets of their time. */
export function targetOn(rows: TargetRow[], date: string): TargetRow | null {
  let found: TargetRow | null = null;
  for (const r of rows) {
    if (r.effectiveFrom <= date) found = r;
    else break;
  }
  return found ?? rows[0] ?? null;
}

export function currentTarget(db: DB, profileId: string, date: string): TargetRow | null {
  return targetOn(listTargets(db, profileId), date);
}

export function insertTarget(
  db: DB,
  profileId: string,
  values: { kcal: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number },
  source: TargetSource,
  basisWeightKg: number | null,
  effectiveFrom: string,
): TargetRow {
  // One row per day: a second change on the same day replaces the first.
  db.delete(targets).where(and(eq(targets.profileId, profileId), eq(targets.effectiveFrom, effectiveFrom))).run();
  const row = db
    .insert(targets)
    .values({
      profileId,
      effectiveFrom,
      kcal: Math.round(values.kcal),
      proteinG: Math.round(values.protein_g),
      carbsG: Math.round(values.carbs_g),
      fatG: Math.round(values.fat_g),
      fiberG: Math.round(values.fiber_g),
      source,
      basisWeightKg,
    })
    .returning()
    .get();
  return rowToTarget(row);
}

export function recalcFormula(db: DB, profile: ProfileRow, today: string, weightKg?: number | null): TargetRow | null {
  const w = weightKg ?? latestWeight(db, profile.id, today);
  if (w == null) return null;
  const t = formulaBreakdown(profile, w, today);
  return insertTarget(db, profile.id, t, 'formula', w, today);
}

/**
 * Formula targets follow the body: recalculate when weight has moved 1 kg from the weight the
 * current target used, or once a month. Manual and learned targets are left alone.
 */
export function maybeRecalculate(db: DB, profile: ProfileRow, today: string): TargetRow | null {
  const current = currentTarget(db, profile.id, today);
  const w = latestWeight(db, profile.id, today);
  if (w == null) return null;
  if (!current) return recalcFormula(db, profile, today, w);
  if (current.source !== 'formula') return null;
  const moved = current.basisWeightKg == null || Math.abs(w - current.basisWeightKg) >= 1;
  const stale = diffDays(current.effectiveFrom, today) >= 30;
  return moved || stale ? recalcFormula(db, profile, today, w) : null;
}

export function setManualTarget(db: DB, profile: ProfileRow, input: ManualTargetInput, today: string): TargetRow {
  return insertTarget(db, profile.id, input, 'manual', latestWeight(db, profile.id, today), today);
}

export function targetsView(db: DB, profile: ProfileRow, today: string): TargetsView {
  const history = listTargets(db, profile.id);
  const w = latestWeight(db, profile.id, today);
  const formula = w == null ? null : formulaBreakdown(profile, w, today);
  return {
    current: targetOn(history, today),
    history: [...history].reverse(),
    formula: formula && {
      bmr: formula.bmr,
      activityFactor: formula.activityFactor,
      maintenance: formula.maintenance,
      appliedPaceKgWeek: formula.appliedPaceKgWeek,
      dailyDelta: formula.dailyDelta,
      kcal: formula.kcal,
      protein_g: formula.protein_g,
      proteinHigh_g: formula.proteinHigh_g,
      fat_g: formula.fat_g,
      carbs_g: formula.carbs_g,
      fiber_g: formula.fiber_g,
      maintenanceOnly: formula.maintenanceOnly,
      paceCapped: formula.paceCapped,
      floorApplied: formula.floorApplied,
      notes: formula.notes,
    },
  };
}

// ---------- Learned maintenance ----------

const LEARN_WINDOW_DAYS = 56;
const SUGGEST_MIN_CHANGE_KCAL = 75;
const SUGGEST_EVERY_DAYS = 7;

export interface LearnedResult {
  loggedDays: number;
  avgIntakeKcal: number;
  observed: number;
  learned: number;
  formula: number;
}

/**
 * After 3 weeks of logging, compare average intake with the change in trend weight:
 * TDEE_observed ≈ Ī − 7700·ΔW / d, blended with the formula.
 */
export function learnedMaintenance(db: DB, profile: ProfileRow, today: string): LearnedResult | null {
  const from = addDays(today, -LEARN_WINDOW_DAYS);
  const days = dailyTotals(db, profile.id, from, addDays(today, -1)).filter((d) => d.meals > 0);
  if (days.length < 21) return null;
  const firstDay = days[0]!.date;
  const weights = db
    .select({ date: bodyLogs.date, weightKg: bodyLogs.weightKg })
    .from(bodyLogs)
    .where(and(eq(bodyLogs.profileId, profile.id), lte(bodyLogs.date, today)))
    .orderBy(asc(bodyLogs.date))
    .all()
    .filter((r): r is { date: string; weightKg: number } => r.weightKg != null);
  const trend = trendWeights(weights);
  const start = trendOn(trend, firstDay);
  const end = trendOn(trend, today);
  const span = diffDays(firstDay, today);
  if (start == null || end == null || span < 14) return null;
  const inWindow = weights.filter((w) => w.date >= firstDay);
  if (inWindow.length < 4) return null;

  const avgIntakeKcal = days.reduce((a, d) => a + d.kcal, 0) / days.length;
  const observed = observedMaintenance({ avgIntakeKcal, deltaTrendKg: end - start, days: span });
  const latestW = latestWeight(db, profile.id, today) ?? end;
  const formula = formulaBreakdown(profile, latestW, today).formulaMaintenance;
  const learned = blendMaintenance(formula, observed, days.length);
  if (learned == null) return null;
  return { loggedDays: days.length, avgIntakeKcal, observed, learned, formula };
}

interface SuggestionDecision {
  date: string;
  action: 'accepted' | 'dismissed';
}

export function targetSuggestion(db: DB, profile: ProfileRow, today: string): TargetSuggestion | null {
  const current = currentTarget(db, profile.id, today);
  if (!current) return null;
  const last = getInternal<SuggestionDecision>(db, `suggestion:${profile.id}`);
  if (last && diffDays(last.date, today) < SUGGEST_EVERY_DAYS) return null;
  const l = learnedMaintenance(db, profile, today);
  if (!l) return null;
  const w = latestWeight(db, profile.id, today);
  if (w == null) return null;
  const suggested = formulaBreakdown(profile, w, today, l.learned).kcal;
  if (Math.abs(suggested - current.kcal) < SUGGEST_MIN_CHANGE_KCAL) return null;
  const dir = suggested > current.kcal ? 'higher' : 'lower';
  return {
    currentKcal: current.kcal,
    suggestedKcal: suggested,
    learnedMaintenance: Math.round(l.learned),
    formulaMaintenance: Math.round(l.formula),
    observedMaintenance: Math.round(l.observed),
    loggedDays: l.loggedDays,
    message: `Over ${l.loggedDays} logged days your weight trend suggests maintenance is about ${Math.round(l.learned).toLocaleString('en-US')} kcal, so your target could be ${Math.abs(suggested - current.kcal)} kcal ${dir}.`,
  };
}

export function decideSuggestion(db: DB, profile: ProfileRow, today: string, action: 'accepted' | 'dismissed'): TargetRow | null {
  let row: TargetRow | null = null;
  if (action === 'accepted') {
    const l = learnedMaintenance(db, profile, today);
    const w = latestWeight(db, profile.id, today);
    if (l && w != null) row = insertTarget(db, profile.id, formulaBreakdown(profile, w, today, l.learned), 'learned', w, today);
  }
  setInternal(db, `suggestion:${profile.id}`, { date: today, action } satisfies SuggestionDecision);
  return row;
}
