// Daily totals are computed on read from meal_items (PLAN.md: nothing is stored twice).
// Estimated and confirmed meals count; pending, failed and calibration meals do not.
import { dateRange, type Nutrients } from '@katori/shared';
import type { DB } from '../db/client.js';

export interface DailyTotal extends Nutrients {
  date: string;
  meals: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function dailyTotals(db: DB, profileId: string, from: string, to: string): DailyTotal[] {
  if (from > to) return [];
  const rows = db.$client
    .prepare(
      `SELECT m.eaten_date AS date,
              COUNT(DISTINCT m.id) AS meals,
              COALESCE(SUM(i.kcal), 0) AS kcal,
              COALESCE(SUM(i.protein_g), 0) AS protein_g,
              COALESCE(SUM(i.carbs_g), 0) AS carbs_g,
              COALESCE(SUM(i.fat_g), 0) AS fat_g,
              COALESCE(SUM(i.fiber_g), 0) AS fiber_g
         FROM meals m
         LEFT JOIN meal_items i ON i.meal_id = m.id
        WHERE m.profile_id = ? AND m.eaten_date BETWEEN ? AND ?
          AND m.status IN ('estimated', 'confirmed') AND m.calibration = 0
        GROUP BY m.eaten_date`,
    )
    .all(profileId, from, to) as DailyTotal[];
  const byDate = new Map(rows.map((r) => [r.date, r]));
  return dateRange(from, to).map((date) => {
    const r = byDate.get(date);
    return r
      ? { date, meals: r.meals, kcal: Math.round(r.kcal), protein_g: r1(r.protein_g), carbs_g: r1(r.carbs_g), fat_g: r1(r.fat_g), fiber_g: r1(r.fiber_g) }
      : { date, meals: 0, kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };
  });
}

/** Calories by meal slot over a date range. */
export function slotTotals(db: DB, profileId: string, from: string, to: string): { slot: string; kcal: number; days: number }[] {
  return db.$client
    .prepare(
      `SELECT m.slot AS slot, COALESCE(SUM(i.kcal), 0) AS kcal, COUNT(DISTINCT m.eaten_date) AS days
         FROM meals m JOIN meal_items i ON i.meal_id = m.id
        WHERE m.profile_id = ? AND m.eaten_date BETWEEN ? AND ?
          AND m.status IN ('estimated', 'confirmed') AND m.calibration = 0
        GROUP BY m.slot`,
    )
    .all(profileId, from, to) as { slot: string; kcal: number; days: number }[];
}

/** Foods giving the most calories and protein over a range, grouped by item name. */
export function topFoods(db: DB, profileId: string, from: string, to: string) {
  const rows = db.$client
    .prepare(
      `SELECT i.name AS name, SUM(i.kcal) AS kcal, SUM(i.protein_g) AS protein_g, COUNT(*) AS count
         FROM meals m JOIN meal_items i ON i.meal_id = m.id
        WHERE m.profile_id = ? AND m.eaten_date BETWEEN ? AND ?
          AND m.status IN ('estimated', 'confirmed') AND m.calibration = 0
        GROUP BY lower(i.name)`,
    )
    .all(profileId, from, to) as { name: string; kcal: number; protein_g: number; count: number }[];
  return {
    byKcal: [...rows].sort((a, b) => b.kcal - a.kcal).slice(0, 5).map((r) => ({ name: r.name, kcal: Math.round(r.kcal), count: r.count })),
    byProtein: [...rows].sort((a, b) => b.protein_g - a.protein_g).slice(0, 5).map((r) => ({ name: r.name, protein_g: r1(r.protein_g), count: r.count })),
  };
}
