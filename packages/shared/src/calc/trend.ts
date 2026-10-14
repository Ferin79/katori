import { addDays, diffDays } from './dates.js';
import { KCAL_PER_KG } from './energy.js';

export interface WeightPoint {
  date: string;
  weightKg: number;
}

export interface TrendPoint extends WeightPoint {
  trendKg: number;
}

/**
 * Exponentially smoothed trend weight (α = 0.1 per day), which hides water and salt swings.
 * Gaps between weigh-ins decay the old trend as if each missing day repeated the new reading.
 */
export function trendWeights(points: WeightPoint[], alpha = 0.1): TrendPoint[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const out: TrendPoint[] = [];
  let trend: number | null = null;
  let prevDate: string | null = null;
  for (const p of sorted) {
    if (trend === null || prevDate === null) {
      trend = p.weightKg;
    } else {
      const gap = Math.max(1, diffDays(prevDate, p.date));
      const k = 1 - Math.pow(1 - alpha, gap);
      trend = trend + k * (p.weightKg - trend);
    }
    prevDate = p.date;
    out.push({ ...p, trendKg: trend });
  }
  return out;
}

/** Trend value on a date (the last trend point on or before it). */
export function trendOn(trend: TrendPoint[], date: string): number | null {
  let v: number | null = null;
  for (const t of trend) {
    if (t.date > date) break;
    v = t.trendKg;
  }
  return v;
}

/** Least-squares slope of trend weight, kg per day, over the last `windowDays`. */
export function trendSlopePerDay(trend: TrendPoint[], asOf: string, windowDays = 28): number | null {
  const from = addDays(asOf, -windowDays);
  const pts = trend.filter((t) => t.date >= from && t.date <= asOf);
  if (pts.length < 5) return null;
  const xs = pts.map((p) => diffDays(from, p.date));
  const ys = pts.map((p) => p.trendKg);
  const n = pts.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** Projected date the trend reaches the goal weight, or null if it isn't heading there. */
export function projectGoalDate(trend: TrendPoint[], goalKg: number | null, asOf: string): string | null {
  if (goalKg == null || trend.length === 0) return null;
  const current = trendOn(trend, asOf);
  const slope = trendSlopePerDay(trend, asOf);
  if (current == null || slope == null || Math.abs(slope) < 1e-4) return null;
  const remaining = goalKg - current;
  if (Math.abs(remaining) < 0.1) return asOf;
  if (Math.sign(remaining) !== Math.sign(slope)) return null;
  const days = Math.round(remaining / slope);
  if (days > 3 * 365) return null;
  return addDays(asOf, days);
}

/** TDEE_observed ≈ Ī − 7700·ΔW / d */
export function observedMaintenance(p: { avgIntakeKcal: number; deltaTrendKg: number; days: number }): number {
  return p.avgIntakeKcal - (KCAL_PER_KG * p.deltaTrendKg) / p.days;
}

export const LEARNED_MIN_DAYS = 21;

/**
 * Blend observed maintenance with the formula. At 3 weeks of logging the two count equally;
 * by 8 weeks the observed value carries 80%.
 */
export function blendMaintenance(formula: number, observed: number, loggedDays: number): number | null {
  if (loggedDays < LEARNED_MIN_DAYS) return null;
  const w = Math.min(0.8, Math.max(0.5, 0.5 + ((loggedDays - LEARNED_MIN_DAYS) * 0.3) / 35));
  return w * observed + (1 - w) * formula;
}
