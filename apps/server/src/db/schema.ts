// Every personal row carries profile_id (PLAN.md, Data model). Daily and monthly totals and
// body fat are computed on read, so nothing is stored twice.
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const now = sql`(strftime('%Y-%m-%dT%H:%M:%fZ','now'))`;

export const profiles = sqliteTable('profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  colour: text('colour').notNull(),
  sex: text('sex', { enum: ['male', 'female'] }).notNull(),
  birthDate: text('birth_date').notNull(),
  heightCm: real('height_cm').notNull(),
  activity: text('activity', { enum: ['sedentary', 'light', 'moderate', 'active', 'very_active'] }).notNull(),
  jobType: text('job_type', { enum: ['desk', 'standing', 'manual'] }).notNull(),
  workoutsPerWeek: integer('workouts_per_week').notNull(),
  goal: text('goal', { enum: ['lose', 'maintain', 'gain'] }).notNull(),
  goalWeightKg: real('goal_weight_kg'),
  paceKgWeek: real('pace_kg_week').notNull(),
  dietFlags: text('diet_flags', { mode: 'json' }).$type<{ vegetarian: boolean; eggs: boolean }>().notNull(),
  mealSlots: text('meal_slots', { mode: 'json' }).$type<{ name: string; time: string }[]>().notNull(),
  specialStatus: text('special_status', { enum: ['none', 'pregnant', 'breastfeeding'] }).notNull().default('none'),
  aiAccess: text('ai_access', { enum: ['sign_in', 'api_key', 'manual'] }).notNull(),
  pinHash: text('pin_hash'),
  createdAt: text('created_at').notNull().default(now),
});

export const meals = sqliteTable(
  'meals',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    eatenAt: text('eaten_at').notNull(),
    eatenDate: text('eaten_date').notNull(),
    slot: text('slot').notNull(),
    note: text('note').notNull().default(''),
    photoPath: text('photo_path'),
    status: text('status', { enum: ['pending', 'estimated', 'confirmed', 'failed'] }).notNull(),
    sharedGroupId: text('shared_group_id'),
    portion: real('portion').notNull().default(1),
    questions: text('questions', { mode: 'json' }).$type<{ text: string; options: string[] }[]>().notNull().default(sql`'[]'`),
    answers: text('answers', { mode: 'json' }).$type<{ question: string; answer: string }[]>().notNull().default(sql`'[]'`),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: text('next_attempt_at'),
    calibration: integer('calibration', { mode: 'boolean' }).notNull().default(false),
    trueKcal: real('true_kcal'),
    trueProteinG: real('true_protein_g'),
    createdAt: text('created_at').notNull().default(now),
    confirmedAt: text('confirmed_at'),
  },
  (t) => [index('meals_profile_date').on(t.profileId, t.eatenDate), index('meals_status').on(t.status), index('meals_group').on(t.sharedGroupId)],
);

export const myFoods = sqliteTable(
  'my_foods',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** Blank = household food, shared by every profile. */
    profileId: text('profile_id').references(() => profiles.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    aliases: text('aliases', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    servingDesc: text('serving_desc').notNull(),
    servingG: real('serving_g').notNull(),
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    fiberG: real('fiber_g').notNull(),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('my_foods_profile').on(t.profileId)],
);

export const mealItems = sqliteTable(
  'meal_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    mealId: integer('meal_id')
      .notNull()
      .references(() => meals.id, { onDelete: 'cascade' }),
    position: integer('position').notNull().default(0),
    name: text('name').notNull(),
    portion: text('portion').notNull().default(''),
    grams: real('grams').notNull(),
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    fiberG: real('fiber_g').notNull(),
    confidence: text('confidence', { enum: ['high', 'medium', 'low'] }),
    source: text('source', { enum: ['ai', 'my_food', 'reference', 'manual'] }).notNull(),
    myFoodId: integer('my_food_id').references(() => myFoods.id, { onDelete: 'set null' }),
  },
  (t) => [index('meal_items_meal').on(t.mealId)],
);

export const bodyLogs = sqliteTable(
  'body_logs',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    weightKg: real('weight_kg'),
    neckCm: real('neck_cm'),
    waistCm: real('waist_cm'),
    hipCm: real('hip_cm'),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.date] })],
);

export const targets = sqliteTable(
  'targets',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    effectiveFrom: text('effective_from').notNull(),
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    fiberG: real('fiber_g').notNull(),
    source: text('source', { enum: ['formula', 'learned', 'manual'] }).notNull(),
    /** Weight the formula used, so a 1 kg move can trigger a recalculation. */
    basisWeightKg: real('basis_weight_kg'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [index('targets_profile_from').on(t.profileId, t.effectiveFrom)],
);

/** Household-wide key/value settings (measures, model) plus internal keys. */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

export const aiRuns = sqliteTable(
  'ai_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    mealId: integer('meal_id').references(() => meals.id, { onDelete: 'set null' }),
    kind: text('kind', { enum: ['estimate', 'recap', 'auth'] }).notNull().default('estimate'),
    startedAt: text('started_at').notNull(),
    durationMs: integer('duration_ms'),
    model: text('model'),
    exitCode: integer('exit_code'),
    outputJson: text('output_json'),
    error: text('error'),
    /** Calorie error vs the weighed truth, for calibration meals. */
    calibrationErrorPct: real('calibration_error_pct'),
  },
  (t) => [index('ai_runs_meal').on(t.mealId)],
);

export const recaps = sqliteTable(
  'recaps',
  {
    profileId: text('profile_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    month: text('month').notNull(),
    status: text('status', { enum: ['pending', 'done', 'failed'] }).notNull(),
    text: text('text'),
    error: text('error'),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.month] })],
);

/** IFCT 2017 and INDB values per 100 g, loaded by `katori import-reference`. */
export const referenceFoods = sqliteTable(
  'reference_foods',
  {
    id: text('id').primaryKey(),
    source: text('source', { enum: ['IFCT2017', 'INDB'] }).notNull(),
    name: text('name').notNull(),
    searchText: text('search_text').notNull(),
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    fiberG: real('fiber_g').notNull(),
    servingDesc: text('serving_desc'),
    servingG: real('serving_g'),
  },
  (t) => [index('reference_foods_name').on(t.name)],
);
