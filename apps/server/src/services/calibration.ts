// Calibration (one evening): weigh ~10 typical meals, work out their true calories, run the same
// photos and notes through the app, and log the error per meal in ai_runs. Calibration meals never
// count toward anyone's daily totals.
import { desc, eq, inArray } from 'drizzle-orm';
import { toLocalDateTime, type CalibrationInput, type CalibrationView, type Meal } from '@katori/shared';
import type { Ctx } from '../context.js';
import { aiRuns, meals, profiles } from '../db/schema.js';
import { notFound } from '../lib/http.js';
import { createMeals, toMeals } from './meals.js';
import { getSettings } from './settings.js';

export function createCalibrationMeal(ctx: Ctx, profileId: string, input: CalibrationInput, photo: Buffer | null): Meal {
  return createMeals(
    ctx,
    profileId,
    { note: input.note, slot: 'Calibration', eatenAt: toLocalDateTime(new Date()), portion: 1, alsoFor: [] },
    photo,
    { calibration: { trueKcal: input.trueKcal, trueProteinG: input.trueProteinG } },
  )[0]!;
}

export function calibrationView(ctx: Ctx): CalibrationView {
  const { db } = ctx;
  const tolerancePct = getSettings(db).calibrationTolerancePct;
  const rows = db
    .select({ meal: meals, profileName: profiles.name })
    .from(meals)
    .innerJoin(profiles, eq(profiles.id, meals.profileId))
    .where(eq(meals.calibration, true))
    .orderBy(desc(meals.createdAt))
    .all();
  const dto = new Map(toMeals(db, rows.map((r) => r.meal)).map((m) => [m.id, m]));
  const runs = rows.length
    ? db
        .select()
        .from(aiRuns)
        .where(inArray(aiRuns.mealId, rows.map((r) => r.meal.id)))
        .orderBy(desc(aiRuns.startedAt))
        .all()
    : [];

  const out = rows.map(({ meal, profileName }) => {
    const m = dto.get(meal.id)!;
    const mealRuns = runs.filter((r) => r.mealId === meal.id);
    const lastOk = mealRuns.find((r) => r.calibrationErrorPct != null);
    const estimatedKcal = m.status === 'estimated' || m.status === 'confirmed' ? m.totals.kcal : null;
    const errorPct = lastOk?.calibrationErrorPct ?? null;
    return {
      mealId: meal.id,
      profileId: meal.profileId,
      profileName,
      note: meal.note,
      trueKcal: meal.trueKcal!,
      trueProteinG: meal.trueProteinG,
      status: meal.status,
      estimatedKcal,
      estimatedProteinG: estimatedKcal == null ? null : m.totals.protein_g,
      errorPct: errorPct == null ? null : Math.round(errorPct * 10) / 10,
      withinTolerance: errorPct == null ? null : Math.abs(errorPct) <= tolerancePct,
      runs: mealRuns.length,
      lastRunAt: mealRuns[0]?.startedAt ?? null,
    };
  });
  const scored = out.filter((r) => r.errorPct != null);
  const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  return {
    tolerancePct,
    rows: out,
    summary: {
      meals: out.length,
      scored: scored.length,
      within: scored.filter((r) => r.withinTolerance).length,
      meanAbsErrorPct: mean(scored.map((r) => Math.abs(r.errorPct!))),
      meanErrorPct: mean(scored.map((r) => r.errorPct!)),
    },
  };
}

/** After tuning the prompt, run every calibration meal again. */
export function rerunCalibration(ctx: Ctx): number {
  const ids = ctx.db.select({ id: meals.id }).from(meals).where(eq(meals.calibration, true)).all().map((r) => r.id);
  if (ids.length) {
    ctx.db.update(meals).set({ status: 'pending', attempts: 0, error: null, nextAttemptAt: null, answers: [] }).where(inArray(meals.id, ids)).run();
    ctx.queue.kick();
  }
  return ids.length;
}

export function updateCalibrationTruth(ctx: Ctx, mealId: number, trueKcal: number, trueProteinG: number | null): void {
  const meal = ctx.db.select().from(meals).where(eq(meals.id, mealId)).get();
  if (!meal?.calibration) throw notFound('Calibration meal not found');
  ctx.db.update(meals).set({ trueKcal, trueProteinG }).where(eq(meals.id, mealId)).run();
}
