import type { MealSlot, Nutrients } from '../schemas.js';
import { minutesOf } from './dates.js';

export const ZERO_NUTRIENTS: Nutrients = { kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0, fiber_g: 0 };

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Multiply a line's nutrients (and grams) by a factor, e.g. a shared-plate portion. */
export function scaleNutrients<T extends Nutrients & { grams?: number }>(item: T, factor: number): T {
  return {
    ...item,
    ...(item.grams !== undefined ? { grams: Math.round(item.grams * factor) } : {}),
    kcal: Math.round(item.kcal * factor),
    protein_g: r1(item.protein_g * factor),
    carbs_g: r1(item.carbs_g * factor),
    fat_g: r1(item.fat_g * factor),
    fiber_g: r1(item.fiber_g * factor),
  };
}

/** Change a line's grams; macros rescale in proportion. Lines with 0 g keep their macros. */
export function rescaleToGrams<T extends Nutrients & { grams: number }>(item: T, grams: number): T {
  if (item.grams <= 0) return { ...item, grams };
  const scaled = scaleNutrients(item, grams / item.grams);
  return { ...scaled, grams };
}

export function sumNutrients(items: readonly Nutrients[]): Nutrients {
  const t = items.reduce(
    (acc, i) => ({
      kcal: acc.kcal + i.kcal,
      protein_g: acc.protein_g + i.protein_g,
      carbs_g: acc.carbs_g + i.carbs_g,
      fat_g: acc.fat_g + i.fat_g,
      fiber_g: acc.fiber_g + i.fiber_g,
    }),
    { ...ZERO_NUTRIENTS },
  );
  return {
    kcal: Math.round(t.kcal),
    protein_g: r1(t.protein_g),
    carbs_g: r1(t.carbs_g),
    fat_g: r1(t.fat_g),
    fiber_g: r1(t.fiber_g),
  };
}

/** Energy implied by the macros (Atwater: 4 kcal/g protein and carbs, 9 fat, 2 fiber). */
export function macroKcal(n: Pick<Nutrients, 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g'>): number {
  return Math.round(4 * n.protein_g + 4 * n.carbs_g + 9 * n.fat_g + 2 * n.fiber_g);
}

/**
 * True when the calories and the macros clearly disagree (more than 20% and 40 kcal apart),
 * e.g. 600 kcal typed against macros that add up to 300. Small gaps are normal: labels round.
 */
export function macrosDisagree(n: Nutrients): boolean {
  const fromMacros = macroKcal(n);
  const gap = Math.abs(n.kcal - fromMacros);
  return gap >= 40 && gap > 0.2 * Math.max(n.kcal, fromMacros);
}

/** Upper bounds a line's values may take, matching the `Nutrients` schema. */
export const NUTRIENT_MAX: Nutrients = { kcal: 20000, protein_g: 2000, carbs_g: 2000, fat_g: 2000, fiber_g: 500 };

/** Pick the profile's meal slot closest to a time of day (circular, so 23:30 is near 00:30). */
export function slotForTime(slots: readonly MealSlot[], time: string): string {
  if (slots.length === 0) return 'Meal';
  const t = minutesOf(time);
  let best = slots[0]!;
  let bestDist = Infinity;
  for (const s of slots) {
    const d = Math.abs(minutesOf(s.time) - t);
    const dist = Math.min(d, 1440 - d);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best.name;
}

export const DEFAULT_MEAL_SLOTS: MealSlot[] = [
  { name: 'Breakfast', time: '08:00' },
  { name: 'Lunch', time: '13:00' },
  { name: 'Snack', time: '16:30' },
  { name: 'Dinner', time: '20:00' },
];
