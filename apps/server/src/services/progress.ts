// Home dashboard, Month and Journey. Each answers: how is today going, is this week on track,
// is the body changing. Every chart leads with averages and trends, not single weigh-ins.
import {
  addDays,
  addMonths,
  bmi,
  bmiCategory,
  firstOfMonth,
  isMinor,
  lastOfMonth,
  monthOf,
  projectGoalDate,
  startOfWeek,
  sumNutrients,
  trendOn,
  trendSlopePerDay,
  trendWeights,
  type Dashboard,
  type DayTotal,
  type HeatState,
  type JourneyView,
  type MonthView,
  type TargetRow,
} from '@katori/shared';
import type { ProfileRow } from '../ai/runner.js';
import type { DB } from '../db/client.js';
import { listBody } from './body.js';
import { listMeals } from './meals.js';
import { formulaBreakdown, latestWeight, learnedMaintenance, listTargets, maybeRecalculate, targetOn, targetSuggestion } from './targets.js';
import { dailyTotals, slotTotals, topFoods } from './totals.js';

const r1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Daily totals with the target that was in force on each day. */
export function daysWithTargets(db: DB, profileId: string, from: string, to: string, targets: TargetRow[]): DayTotal[] {
  return dailyTotals(db, profileId, from, to).map((d) => {
    const t = targetOn(targets, d.date);
    return { ...d, targetKcal: t?.kcal ?? null, targetProteinG: t?.protein_g ?? null };
  });
}

/** Calendar state of a day: under 80% of target usually means an incomplete log. */
export function heatState(d: DayTotal): HeatState {
  if (d.meals === 0) return 'none';
  if (d.targetKcal == null) return 'on';
  if (d.kcal > d.targetKcal * 1.05) return 'over';
  if (d.kcal < d.targetKcal * 0.8) return 'under';
  return 'on';
}

const proteinHit = (d: DayTotal) => d.meals > 0 && d.targetProteinG != null && d.protein_g >= d.targetProteinG * 0.95;

function weightSeries(db: DB, profile: ProfileRow, today: string) {
  const body = listBody(db, profile, today, undefined, today);
  const weights = body.filter((b) => b.weightKg != null).map((b) => ({ date: b.date, weightKg: b.weightKg! }));
  return { body, trend: trendWeights(weights) };
}

export function dashboard(db: DB, profile: ProfileRow, date: string): Dashboard {
  maybeRecalculate(db, profile, date); // weight moved 1 kg, or a month has passed
  const targets = listTargets(db, profile.id);
  const target = targetOn(targets, date);
  const minor = isMinor(profile.birthDate, date);

  // Today
  const meals = listMeals(db, profile.id, date);
  const counted = meals.filter((m) => m.status === 'estimated' || m.status === 'confirmed');
  const totals = sumNutrients(counted.map((m) => m.totals));

  // Last 7 days
  const last7 = daysWithTargets(db, profile.id, addDays(date, -6), date, targets);
  const complete = last7.filter((d) => d.meals > 0 && d.date < date);
  const avg7 = avg((complete.length ? complete : last7.filter((d) => d.meals > 0)).map((d) => d.kcal));

  // Weight trend
  const { body, trend } = weightSeries(db, profile, date);
  const currentTrend = trendOn(trend, date);
  const slope = trendSlopePerDay(trend, date);
  const weightFrom = addDays(date, -90);

  // Energy balance over the last 14 complete days
  const window = daysWithTargets(db, profile.id, addDays(date, -14), addDays(date, -1), targets);
  const logged = window.filter((d) => d.meals > 0);
  const w = latestWeight(db, profile.id, date);
  const learned = learnedMaintenance(db, profile, date);

  // Waist and ratios
  const waistPts = body.filter((b) => b.waistCm != null).map((b) => ({ date: b.date, waistCm: b.waistCm! }));
  const lastTape = [...body].reverse().find((b) => b.waistCm != null);

  // Protein consistency, streak and heatmap
  const monthStart = firstOfMonth(monthOf(date));
  const heatFrom = addDays(startOfWeek(date), -7 * 11); // 12 calendar weeks
  const history = daysWithTargets(db, profile.id, [heatFrom, monthStart, addDays(date, -29)].sort()[0]!, date, targets);
  const week = history.filter((d) => d.date >= startOfWeek(date));
  const month = history.filter((d) => d.date >= monthStart);
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const d = history[i]!;
    if (d.meals > 0) streak++;
    else if (d.date === date) continue; // today isn't over yet
    else break;
  }

  // Meal slots over 30 days, in the profile's own order
  const from30 = addDays(date, -29);
  const slotRows = slotTotals(db, profile.id, from30, date);
  const loggedDays30 = history.filter((d) => d.date >= from30 && d.meals > 0).length;
  const totalSlotKcal = slotRows.reduce((a, s) => a + s.kcal, 0);
  const order = new Map(profile.mealSlots.map((s, i) => [s.name, i]));
  const slots = slotRows
    .sort((a, b) => (order.get(a.slot) ?? 99) - (order.get(b.slot) ?? 99))
    .map((s) => ({ name: s.slot, kcal: Math.round(s.kcal), avgKcal: Math.round(s.kcal / Math.max(1, loggedDays30)), share: totalSlotKcal ? s.kcal / totalSlotKcal : 0 }));

  return {
    date,
    target,
    minor,
    today: {
      totals,
      remainingKcal: target ? target.kcal - totals.kcal : null,
      meals,
      toReview: meals.filter((m) => m.status === 'estimated').length,
      pending: meals.filter((m) => m.status === 'pending').length,
      failed: meals.filter((m) => m.status === 'failed').length,
    },
    last7: { days: last7, avgKcal: avg7 == null ? null : Math.round(avg7) },
    weight: {
      points: trend.filter((t) => t.date >= weightFrom).map((t) => ({ date: t.date, weightKg: t.weightKg, trendKg: r1(t.trendKg) })),
      goalKg: profile.goalWeightKg,
      currentTrendKg: currentTrend == null ? null : r1(currentTrend),
      latestKg: w,
      projectedGoalDate: projectGoalDate(trend, profile.goalWeightKg, date),
      weeklyRateKg: slope == null ? null : Math.round(slope * 7 * 100) / 100,
    },
    energy: {
      avgIntakeKcal: logged.length ? Math.round(avg(logged.map((d) => d.kcal))!) : null,
      formulaMaintenance: w == null ? null : Math.round(formulaBreakdown(profile, w, date).formulaMaintenance),
      learnedMaintenance: learned ? Math.round(learned.learned) : null,
      observedMaintenance: learned ? Math.round(learned.observed) : null,
      loggedDays: logged.length,
      windowDays: 14,
    },
    body: minor
      ? null
      : {
          points: body
            .filter((b) => b.bodyFatPct != null && b.fatMassKg != null && b.leanMassKg != null)
            .map((b) => ({ date: b.date, bodyFatPct: r1(b.bodyFatPct!), fatMassKg: r1(b.fatMassKg!), leanMassKg: r1(b.leanMassKg!) })),
        },
    waist: {
      points: waistPts,
      latest: {
        waistCm: lastTape?.waistCm ?? null,
        waistToHeight: lastTape?.waistToHeight ?? null,
        waistToHip: lastTape?.waistToHip ?? null,
        bmi: w == null ? null : r1(bmi(w, profile.heightCm)),
        bmiCategory: w == null ? null : bmiCategory(bmi(w, profile.heightCm)),
      },
    },
    protein: {
      targetG: target?.protein_g ?? null,
      weekHit: week.filter(proteinHit).length,
      weekDays: week.length,
      monthHit: month.filter(proteinHit).length,
      monthDays: month.length,
    },
    streak: {
      current: streak,
      daysLogged30: loggedDays30,
      heatmap: history.filter((d) => d.date >= heatFrom).map((d) => ({ date: d.date, state: heatState(d), kcal: d.kcal })),
    },
    slots,
    top: topFoods(db, profile.id, monthStart, date),
    suggestion: targetSuggestion(db, profile, date),
  };
}

export function monthStats(db: DB, profile: ProfileRow, month: string, today: string): Omit<MonthView, 'recap'> {
  const targets = listTargets(db, profile.id);
  const first = firstOfMonth(month);
  const last = month === monthOf(today) ? today : lastOfMonth(month);
  const days = first <= last ? daysWithTargets(db, profile.id, first, last, targets) : [];
  const logged = days.filter((d) => d.meals > 0);
  const mean = (k: 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g') => (logged.length ? r1(avg(logged.map((d) => d[k]))!) : 0);
  const body = listBody(db, profile, today, first, last);
  const weights = body.filter((b) => b.weightKg != null);
  const tapes = body.filter((b) => b.waistCm != null);
  const fats = body.filter((b) => b.bodyFatPct != null);
  const startKg = weights[0]?.weightKg ?? null;
  const endKg = weights.at(-1)?.weightKg ?? null;
  return {
    month,
    days,
    averages: { kcal: Math.round(mean('kcal')), protein_g: mean('protein_g'), carbs_g: mean('carbs_g'), fat_g: mean('fat_g'), fiber_g: mean('fiber_g'), loggedDays: logged.length },
    targetKcal: targetOn(targets, last)?.kcal ?? null,
    daysOnTarget: days.filter((d) => heatState(d) === 'on').length,
    daysOver: days.filter((d) => heatState(d) === 'over').length,
    weight: {
      startKg,
      endKg,
      changeKg: startKg != null && endKg != null ? r1(endKg - startKg) : null,
      avgKg: weights.length ? r1(avg(weights.map((b) => b.weightKg!))!) : null,
    },
    waist: { startCm: tapes[0]?.waistCm ?? null, endCm: tapes.at(-1)?.waistCm ?? null },
    bodyFat: { start: fats[0] ? r1(fats[0].bodyFatPct!) : null, end: fats.at(-1) ? r1(fats.at(-1)!.bodyFatPct!) : null },
  };
}

export function journey(db: DB, profile: ProfileRow, today: string): JourneyView {
  const { body, trend } = weightSeries(db, profile, today);
  const startDate = body[0]?.date ?? null;
  const startKg = trend[0]?.weightKg ?? null;
  const currentTrend = trendOn(trend, today);
  const months: JourneyView['months'] = [];
  if (startDate) {
    const targets = listTargets(db, profile.id);
    for (let m = monthOf(startDate); m <= monthOf(today); m = addMonths(m, 1)) {
      const first = firstOfMonth(m);
      const last = m === monthOf(today) ? today : lastOfMonth(m);
      const inMonth = body.filter((b) => b.date >= first && b.date <= last);
      const ws = inMonth.filter((b) => b.weightKg != null).map((b) => b.weightKg!);
      const waists = inMonth.filter((b) => b.waistCm != null).map((b) => b.waistCm!);
      const days = daysWithTargets(db, profile.id, first, last, targets).filter((d) => d.meals > 0);
      months.push({
        month: m,
        avgWeightKg: ws.length ? r1(avg(ws)!) : null,
        avgKcal: days.length ? Math.round(avg(days.map((d) => d.kcal))!) : null,
        loggedDays: days.length,
        avgWaistCm: waists.length ? r1(avg(waists)!) : null,
      });
    }
  }
  return {
    startDate,
    startKg,
    currentTrendKg: currentTrend == null ? null : r1(currentTrend),
    latestKg: latestWeight(db, profile.id, today),
    goalKg: profile.goalWeightKg,
    changeKg: startKg != null && currentTrend != null ? r1(currentTrend - startKg) : null,
    projectedGoalDate: projectGoalDate(trend, profile.goalWeightKg, today),
    points: trend.map((t) => ({ date: t.date, weightKg: t.weightKg, trendKg: r1(t.trendKg) })),
    months,
  };
}

