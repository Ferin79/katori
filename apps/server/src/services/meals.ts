import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import {
  scaleNutrients,
  slotForTime,
  sumNutrients,
  type AddMealFields,
  type AnswersInput,
  type ConfirmMealInput,
  type Meal,
  type MealEstimate,
  type MealItem,
  type QuickAddInput,
} from '@katori/shared';
import type { MyFoodRow } from '../ai/runner.js';
import type { Ctx } from '../context.js';
import type { DB, DBOrTx } from '../db/client.js';
import { mealItems, meals, profiles } from '../db/schema.js';
import { badRequest, notFound, nowIso } from '../lib/http.js';
import { findFoodByName, foodsForProfile, getFood, matchFoodsInNote } from './foods.js';
import { photoAbsPath, savePhoto } from './photos.js';
import { getProfileRow } from './profiles.js';

type MealRow = typeof meals.$inferSelect;
type ItemRow = typeof mealItems.$inferSelect;
type NewItem = Omit<typeof mealItems.$inferInsert, 'mealId'>;

const r1 = (n: number) => Math.round(n * 10) / 10;

function toItem(r: ItemRow): MealItem {
  return {
    id: r.id,
    name: r.name,
    portion: r.portion,
    grams: r.grams,
    kcal: Math.round(r.kcal),
    protein_g: r1(r.proteinG),
    carbs_g: r1(r.carbsG),
    fat_g: r1(r.fatG),
    fiber_g: r1(r.fiberG),
    confidence: r.confidence,
    source: r.source,
    myFoodId: r.myFoodId,
  };
}

function itemsFor(db: DB, mealIds: number[]): Map<number, MealItem[]> {
  const out = new Map<number, MealItem[]>();
  if (!mealIds.length) return out;
  const rows = db.select().from(mealItems).where(inArray(mealItems.mealId, mealIds)).orderBy(asc(mealItems.position), asc(mealItems.id)).all();
  for (const r of rows) {
    const list = out.get(r.mealId) ?? [];
    list.push(toItem(r));
    out.set(r.mealId, list);
  }
  return out;
}

function sharesFor(db: DB, rows: MealRow[]) {
  const groups = [...new Set(rows.map((r) => r.sharedGroupId).filter((g): g is string => Boolean(g)))];
  if (!groups.length) return new Map<string, { mealId: number; profileId: string; name: string; colour: string; portion: number }[]>();
  const members = db
    .select({ mealId: meals.id, group: meals.sharedGroupId, profileId: meals.profileId, portion: meals.portion, name: profiles.name, colour: profiles.colour })
    .from(meals)
    .innerJoin(profiles, eq(profiles.id, meals.profileId))
    .where(inArray(meals.sharedGroupId, groups))
    .all();
  const map = new Map<string, typeof members>();
  for (const m of members) {
    const list = map.get(m.group!) ?? [];
    list.push(m);
    map.set(m.group!, list);
  }
  return map;
}

export function toMeals(db: DB, rows: MealRow[]): Meal[] {
  const items = itemsFor(db, rows.map((r) => r.id));
  const shares = sharesFor(db, rows);
  return rows.map((r) => {
    const list = items.get(r.id) ?? [];
    return {
      id: r.id,
      profileId: r.profileId,
      eatenAt: r.eatenAt,
      slot: r.slot,
      note: r.note,
      hasPhoto: Boolean(r.photoPath),
      status: r.status,
      sharedGroupId: r.sharedGroupId,
      portion: r.portion,
      questions: r.status === 'estimated' ? r.questions : [],
      answers: r.answers,
      error: r.error,
      attempts: r.attempts,
      nextAttemptAt: r.nextAttemptAt,
      calibration: r.calibration,
      trueKcal: r.trueKcal,
      trueProteinG: r.trueProteinG,
      items: list,
      totals: sumNutrients(list),
      createdAt: r.createdAt,
      confirmedAt: r.confirmedAt,
      sharedWith: (r.sharedGroupId ? (shares.get(r.sharedGroupId) ?? []) : [])
        .filter((s) => s.mealId !== r.id)
        .map((s) => ({ profileId: s.profileId, name: s.name, colour: s.colour, portion: s.portion })),
    };
  });
}

export function getMealRow(db: DB, profileId: string, id: number): MealRow {
  const row = db.select().from(meals).where(and(eq(meals.id, id), eq(meals.profileId, profileId))).get();
  if (!row) throw notFound('Meal not found');
  return row;
}

export function getMeal(db: DB, profileId: string, id: number): Meal {
  return toMeals(db, [getMealRow(db, profileId, id)])[0]!;
}

export function listMeals(db: DB, profileId: string, date: string, includeCalibration = false): Meal[] {
  const conds = [eq(meals.profileId, profileId), eq(meals.eatenDate, date)];
  if (!includeCalibration) conds.push(eq(meals.calibration, false));
  return toMeals(db, db.select().from(meals).where(and(...conds)).orderBy(asc(meals.eatenAt), asc(meals.id)).all());
}

function foodItem(f: MyFoodRow, servings: number, position: number): NewItem {
  const scaled = scaleNutrients({ kcal: f.kcal, protein_g: f.proteinG, carbs_g: f.carbsG, fat_g: f.fatG, fiber_g: f.fiberG, grams: f.servingG }, servings);
  return {
    position,
    name: f.name,
    portion: servings === 1 ? f.servingDesc : `${servings} × ${f.servingDesc}`,
    grams: scaled.grams ?? 0,
    kcal: scaled.kcal,
    proteinG: scaled.protein_g,
    carbsG: scaled.carbs_g,
    fatG: scaled.fat_g,
    fiberG: scaled.fiber_g,
    confidence: 'high',
    source: 'my_food',
    myFoodId: f.id,
  };
}

/**
 * Turn the AI's lines into stored items. When a line matches a saved food, the person's own
 * numbers replace the AI's (scaled to the AI's grams). Shared plates scale by the portion.
 */
export function estimateToItems(estimate: MealEstimate, foods: MyFoodRow[], portion: number): NewItem[] {
  const byId = new Map(foods.map((f) => [String(f.id), f]));
  return estimate.items.map((it, position) => {
    const food = (it.myFoodId ? byId.get(it.myFoodId) : undefined) ?? findFoodByName(foods, it.name);
    let base;
    if (food) {
      const grams = it.grams > 0 ? it.grams : food.servingG;
      const factor = food.servingG > 0 ? grams / food.servingG : 1;
      const s = scaleNutrients({ kcal: food.kcal, protein_g: food.proteinG, carbs_g: food.carbsG, fat_g: food.fatG, fiber_g: food.fiberG }, factor);
      base = { name: food.name, grams, ...s, source: 'my_food' as const, myFoodId: food.id };
    } else {
      base = { name: it.name, grams: it.grams, kcal: it.kcal, protein_g: it.protein_g, carbs_g: it.carbs_g, fat_g: it.fat_g, fiber_g: it.fiber_g, source: it.referenceId ? ('reference' as const) : ('ai' as const), myFoodId: null };
    }
    const p = portion === 1 ? base : scaleNutrients(base, portion);
    return {
      position,
      name: p.name,
      portion: portion === 1 ? it.portion : `${it.portion} × ${portion}`,
      grams: Math.round(p.grams),
      kcal: Math.round(p.kcal),
      proteinG: r1(p.protein_g),
      carbsG: r1(p.carbs_g),
      fatG: r1(p.fat_g),
      fiberG: r1(p.fiber_g),
      confidence: it.confidence,
      source: p.source,
      myFoodId: p.myFoodId,
    };
  });
}

export function replaceItems(db: DBOrTx, mealId: number, items: NewItem[]): void {
  db.delete(mealItems).where(eq(mealItems.mealId, mealId)).run();
  if (items.length) db.insert(mealItems).values(items.map((i) => ({ ...i, mealId }))).run();
}

export interface CreateMealOptions {
  calibration?: { trueKcal: number; trueProteinG: number | null };
}

/**
 * Add meal: one row per person. "Also for" logs the same photo to other profiles, each with its
 * own portion. Every AI profile's meal is estimated with that profile's own AI access.
 */
export function createMeals(ctx: Ctx, profileId: string, fields: AddMealFields, photo: Buffer | null, opts: CreateMealOptions = {}): Meal[] {
  const { db } = ctx;
  const owner = getProfileRow(db, profileId);
  if (!photo && !fields.note.trim() && owner.aiAccess !== 'manual') throw badRequest('Add a photo or a short note');
  const others = fields.alsoFor.filter((a) => a.profileId !== profileId);
  const people = [{ profile: owner, portion: fields.portion }, ...others.map((a) => ({ profile: getProfileRow(db, a.profileId), portion: a.portion }))];
  const photoPath = photo ? savePhoto(ctx.cfg, photo, fields.eatenAt.slice(0, 7)) : null;
  const groupId = people.length > 1 ? randomUUID() : null;

  const ids = db.transaction((tx) => {
    const created: number[] = [];
    for (const { profile, portion } of people) {
      const manual = profile.aiAccess === 'manual';
      // Everyone else's line goes into their own slot for that time of day.
      const slot = profile.id === owner.id ? fields.slot : slotForTime(profile.mealSlots, fields.eatenAt.slice(11, 16));
      const row = tx
        .insert(meals)
        .values({
          profileId: profile.id,
          eatenAt: fields.eatenAt,
          eatenDate: fields.eatenAt.slice(0, 10),
          slot,
          note: fields.note,
          photoPath,
          status: manual ? 'estimated' : 'pending',
          sharedGroupId: groupId,
          portion,
          calibration: Boolean(opts.calibration),
          trueKcal: opts.calibration?.trueKcal ?? null,
          trueProteinG: opts.calibration?.trueProteinG ?? null,
        })
        .returning()
        .get();
      if (manual) {
        // No AI: start from saved foods named in the note; the person fills in the rest on Review.
        const matched = matchFoodsInNote(foodsForProfile(tx, profile.id), fields.note);
        replaceItems(tx, row.id, matched.map((f, i) => scaleItem(foodItem(f, 1, i), portion)));
      }
      created.push(row.id);
    }
    return created;
  });
  ctx.queue.kick();
  return toMeals(db, db.select().from(meals).where(inArray(meals.id, ids)).orderBy(asc(meals.id)).all());
}

function scaleItem(item: NewItem, portion: number): NewItem {
  if (portion === 1) return item;
  const s = scaleNutrients({ kcal: item.kcal, protein_g: item.proteinG, carbs_g: item.carbsG, fat_g: item.fatG, fiber_g: item.fiberG, grams: item.grams }, portion);
  return { ...item, grams: s.grams ?? item.grams, kcal: s.kcal, proteinG: s.protein_g, carbsG: s.carbs_g, fatG: s.fat_g, fiberG: s.fiber_g };
}

/** One tap: log a saved food as a confirmed meal. */
export function quickAdd(ctx: Ctx, profileId: string, input: QuickAddInput): Meal {
  const { db } = ctx;
  getProfileRow(db, profileId);
  const food = getFood(db, profileId, input.myFoodId);
  const id = db.transaction((tx) => {
    const row = tx
      .insert(meals)
      .values({
        profileId,
        eatenAt: input.eatenAt,
        eatenDate: input.eatenAt.slice(0, 10),
        slot: input.slot,
        note: `Quick add: ${food.name}`,
        status: 'confirmed',
        confirmedAt: nowIso(),
      })
      .returning()
      .get();
    replaceItems(tx, row.id, [foodItem(food, input.servings, 0)]);
    return row.id;
  });
  return getMeal(db, profileId, id);
}

export function confirmMeal(ctx: Ctx, profileId: string, id: number, input: ConfirmMealInput): Meal {
  const { db } = ctx;
  const meal = getMealRow(db, profileId, id);
  if (meal.status === 'pending') throw badRequest('This meal is still being estimated');
  db.transaction((tx) => {
    replaceItems(
      tx,
      id,
      input.items.map((i, position) => ({
        position,
        name: i.name,
        portion: i.portion,
        grams: i.grams,
        kcal: i.kcal,
        proteinG: i.protein_g,
        carbsG: i.carbs_g,
        fatG: i.fat_g,
        fiberG: i.fiber_g,
        confidence: i.confidence,
        source: i.source,
        myFoodId: i.myFoodId,
      })),
    );
    tx.update(meals)
      .set({
        status: 'confirmed',
        confirmedAt: nowIso(),
        questions: [],
        error: null,
        ...(input.slot ? { slot: input.slot } : {}),
        ...(input.eatenAt ? { eatenAt: input.eatenAt, eatenDate: input.eatenAt.slice(0, 10) } : {}),
      })
      .where(eq(meals.id, id))
      .run();
  });
  return getMeal(db, profileId, id);
}

/** Tap-to-answer question chips re-run the estimate with the answers added. */
export function answerMeal(ctx: Ctx, profileId: string, id: number, input: AnswersInput): Meal {
  const { db } = ctx;
  const meal = getMealRow(db, profileId, id);
  if (meal.status !== 'estimated') throw badRequest('Only an estimated meal can be re-run');
  const answers = [...meal.answers.filter((a) => !input.answers.some((n) => n.question === a.question)), ...input.answers];
  db.update(meals).set({ answers, status: 'pending', attempts: 0, error: null, nextAttemptAt: null }).where(eq(meals.id, id)).run();
  ctx.queue.kick();
  return getMeal(db, profileId, id);
}

export function retryMeal(ctx: Ctx, profileId: string, id: number): Meal {
  const { db } = ctx;
  const meal = getMealRow(db, profileId, id);
  if (meal.status !== 'failed' && meal.status !== 'estimated') throw badRequest('Only a failed or estimated meal can be retried');
  db.update(meals).set({ status: 'pending', attempts: 0, error: null, nextAttemptAt: null }).where(eq(meals.id, id)).run();
  ctx.queue.kick();
  return getMeal(db, profileId, id);
}

export function updateMealMeta(ctx: Ctx, profileId: string, id: number, patch: { slot?: string; eatenAt?: string; note?: string }): Meal {
  getMealRow(ctx.db, profileId, id);
  const set: Partial<MealRow> = {};
  if (patch.slot) set.slot = patch.slot;
  if (patch.eatenAt) {
    set.eatenAt = patch.eatenAt;
    set.eatenDate = patch.eatenAt.slice(0, 10);
  }
  if (patch.note !== undefined) set.note = patch.note;
  if (Object.keys(set).length) ctx.db.update(meals).set(set).where(eq(meals.id, id)).run();
  return getMeal(ctx.db, profileId, id);
}

export function deleteMeal(ctx: Ctx, profileId: string, id: number): void {
  const meal = getMealRow(ctx.db, profileId, id);
  ctx.db.delete(meals).where(eq(meals.id, id)).run();
  if (meal.photoPath) {
    const other = ctx.db.select({ id: meals.id }).from(meals).where(and(eq(meals.photoPath, meal.photoPath), ne(meals.id, id))).get();
    if (!other) rmSync(photoAbsPath(ctx.cfg, meal.photoPath), { force: true });
  }
}

export function mealPhotoPath(ctx: Ctx, profileId: string, id: number): string | null {
  const meal = getMealRow(ctx.db, profileId, id);
  return meal.photoPath ? photoAbsPath(ctx.cfg, meal.photoPath) : null;
}
