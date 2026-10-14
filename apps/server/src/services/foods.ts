// "My foods": household foods (profile_id blank) are shared by every profile; personal ones,
// like a 3 PM shake, stay in their profile. Daily repeats become one-tap quick-add chips.
import { and, eq, isNull, or } from 'drizzle-orm';
import { addDays, type MyFood, type MyFoodInput } from '@katori/shared';
import type { MyFoodRow } from '../ai/runner.js';
import type { DB, DBOrTx } from '../db/client.js';
import { myFoods } from '../db/schema.js';
import { badRequest, notFound } from '../lib/http.js';

const r1 = (n: number) => Math.round(n * 10) / 10;

export function toMyFood(row: MyFoodRow, uses = 0): MyFood {
  return {
    id: row.id,
    profileId: row.profileId,
    household: row.profileId == null,
    name: row.name,
    aliases: row.aliases,
    servingDesc: row.servingDesc,
    servingG: row.servingG,
    kcal: Math.round(row.kcal),
    protein_g: r1(row.proteinG),
    carbs_g: r1(row.carbsG),
    fat_g: r1(row.fatG),
    fiber_g: r1(row.fiberG),
    uses,
  };
}

/** Household foods plus this profile's own. */
export function foodsForProfile(db: DBOrTx, profileId: string): MyFoodRow[] {
  return db
    .select()
    .from(myFoods)
    .where(or(isNull(myFoods.profileId), eq(myFoods.profileId, profileId)))
    .all();
}

function usesByFood(db: DB, profileId: string, since: string): Map<number, number> {
  const rows = db.$client
    .prepare(
      `SELECT i.my_food_id AS id, COUNT(*) AS n
         FROM meal_items i JOIN meals m ON m.id = i.meal_id
        WHERE m.profile_id = ? AND m.eaten_date >= ? AND i.my_food_id IS NOT NULL AND m.status IN ('estimated', 'confirmed')
        GROUP BY i.my_food_id`,
    )
    .all(profileId, since) as { id: number; n: number }[];
  return new Map(rows.map((r) => [r.id, r.n]));
}

export function listFoods(db: DB, profileId: string, today: string): MyFood[] {
  const uses = usesByFood(db, profileId, addDays(today, -30));
  return foodsForProfile(db, profileId)
    .map((f) => toMyFood(f, uses.get(f.id) ?? 0))
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name));
}

/** Quick-add chips: this profile's most-used saved foods over the last 30 days. */
export function quickAddFoods(db: DB, profileId: string, today: string, limit = 8): MyFood[] {
  return listFoods(db, profileId, today).slice(0, limit);
}

export function getFood(db: DB, profileId: string, id: number): MyFoodRow {
  const row = db
    .select()
    .from(myFoods)
    .where(and(eq(myFoods.id, id), or(isNull(myFoods.profileId), eq(myFoods.profileId, profileId))))
    .get();
  if (!row) throw notFound('Saved food not found');
  return row;
}

function values(profileId: string, input: MyFoodInput) {
  return {
    profileId: input.household ? null : profileId,
    name: input.name,
    aliases: input.aliases,
    servingDesc: input.servingDesc,
    servingG: input.servingG,
    kcal: input.kcal,
    proteinG: input.protein_g,
    carbsG: input.carbs_g,
    fatG: input.fat_g,
    fiberG: input.fiber_g,
  };
}

export function createFood(db: DB, profileId: string, input: MyFoodInput): MyFood {
  const dupe = foodsForProfile(db, profileId).find((f) => f.name.toLowerCase() === input.name.toLowerCase() && (f.profileId == null) === input.household);
  if (dupe) throw badRequest(`"${input.name}" is already saved`);
  return toMyFood(db.insert(myFoods).values(values(profileId, input)).returning().get());
}

export function updateFood(db: DB, profileId: string, id: number, input: MyFoodInput): MyFood {
  getFood(db, profileId, id);
  return toMyFood(db.update(myFoods).set(values(profileId, input)).where(eq(myFoods.id, id)).returning().get());
}

export function deleteFood(db: DB, profileId: string, id: number): void {
  getFood(db, profileId, id);
  db.delete(myFoods).where(eq(myFoods.id, id)).run();
}

/** Saved foods named in a note ("my usual dal", "shake"): used by manual-only profiles. */
export function matchFoodsInNote(foods: MyFoodRow[], note: string): MyFoodRow[] {
  const n = note.toLowerCase();
  return foods.filter((f) => [f.name, ...f.aliases].some((name) => name && n.includes(name.toLowerCase())));
}

/** Server-side fallback when the AI didn't set myFoodId: exact name or alias match. */
export function findFoodByName(foods: MyFoodRow[], name: string): MyFoodRow | undefined {
  const n = name.trim().toLowerCase();
  return foods.find((f) => f.name.toLowerCase() === n || f.aliases.some((a) => a.toLowerCase() === n));
}
