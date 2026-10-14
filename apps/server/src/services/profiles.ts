import { rmSync } from 'node:fs';
import { asc, eq, inArray } from 'drizzle-orm';
import { ageOn, isMinor, type Profile, type ProfileInput, type ProfileSummary, type ProfileUpdate } from '@katori/shared';
import type { ProfileRow } from '../ai/runner.js';
import type { Ctx } from '../context.js';
import type { DB } from '../db/client.js';
import { bodyLogs, meals, profiles } from '../db/schema.js';
import { notFound } from '../lib/http.js';
import { removeCredential } from './credentials.js';
import { photoAbsPath } from './photos.js';
import { latestWeight, recalcFormula } from './targets.js';

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return base || 'profile';
}

function uniqueId(db: DB, name: string): string {
  const base = slugify(name);
  for (let i = 1; ; i++) {
    const id = i === 1 ? base : `${base}-${i}`;
    if (!db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, id)).get()) return id;
  }
}

export function getProfileRow(db: DB, id: string): ProfileRow {
  const row = db.select().from(profiles).where(eq(profiles.id, id)).get();
  if (!row) throw notFound('Profile not found');
  return row;
}

export function toSummary(ctx: Ctx, row: ProfileRow, today: string): ProfileSummary {
  return {
    id: row.id,
    name: row.name,
    colour: row.colour,
    aiAccess: row.aiAccess,
    hasPin: Boolean(row.pinHash),
    minor: isMinor(row.birthDate, today),
    auth: ctx.auth.get(row),
  };
}

export function toProfile(ctx: Ctx, row: ProfileRow, today: string): Profile {
  return {
    ...toSummary(ctx, row, today),
    sex: row.sex,
    birthDate: row.birthDate,
    age: ageOn(row.birthDate, today),
    heightCm: row.heightCm,
    goal: row.goal,
    goalWeightKg: row.goalWeightKg,
    paceKgWeek: row.paceKgWeek,
    jobType: row.jobType,
    workoutsPerWeek: row.workoutsPerWeek,
    activity: row.activity,
    diet: row.dietFlags,
    mealSlots: row.mealSlots,
    specialStatus: row.specialStatus,
    createdAt: row.createdAt,
    latestWeightKg: latestWeight(ctx.db, row.id, today),
  };
}

export function listProfiles(ctx: Ctx, today: string): ProfileSummary[] {
  return ctx.db
    .select()
    .from(profiles)
    .orderBy(asc(profiles.createdAt))
    .all()
    .map((r) => toSummary(ctx, r, today));
}

/** Onboarding: the profile, today's body log, an optional earlier starting weigh-in, and formula targets. */
export function createProfile(ctx: Ctx, input: ProfileInput, today: string): Profile {
  const { db } = ctx;
  const id = uniqueId(db, input.name);
  const row = db.transaction((tx) => {
    const created = tx
      .insert(profiles)
      .values({
        id,
        name: input.name,
        colour: input.colour,
        sex: input.sex,
        birthDate: input.birthDate,
        heightCm: input.heightCm,
        activity: input.activity,
        jobType: input.jobType,
        workoutsPerWeek: input.workoutsPerWeek,
        goal: input.goal,
        goalWeightKg: input.goalWeightKg,
        paceKgWeek: input.paceKgWeek,
        dietFlags: input.diet,
        mealSlots: input.mealSlots,
        specialStatus: input.specialStatus,
        aiAccess: input.aiAccess,
      })
      .returning()
      .get();
    tx.insert(bodyLogs)
      .values({ profileId: id, date: today, weightKg: input.weightKg, neckCm: input.neckCm, waistCm: input.waistCm, hipCm: input.hipCm })
      .run();
    if (input.startWeightKg != null && input.startDate && input.startDate < today) {
      tx.insert(bodyLogs).values({ profileId: id, date: input.startDate, weightKg: input.startWeightKg }).onConflictDoNothing().run();
    }
    return created;
  });
  recalcFormula(db, row, today, input.weightKg);
  void ctx.auth.check(row);
  return toProfile(ctx, row, today);
}

const FORMULA_FIELDS = ['sex', 'birthDate', 'heightCm', 'goal', 'paceKgWeek', 'activity', 'specialStatus'] as const;

export function updateProfile(ctx: Ctx, id: string, patch: ProfileUpdate, today: string): Profile {
  const before = getProfileRow(ctx.db, id);
  const set: Partial<typeof profiles.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.colour !== undefined) set.colour = patch.colour;
  if (patch.sex !== undefined) set.sex = patch.sex;
  if (patch.birthDate !== undefined) set.birthDate = patch.birthDate;
  if (patch.heightCm !== undefined) set.heightCm = patch.heightCm;
  if (patch.goal !== undefined) set.goal = patch.goal;
  if (patch.goalWeightKg !== undefined) set.goalWeightKg = patch.goalWeightKg;
  if (patch.paceKgWeek !== undefined) set.paceKgWeek = patch.paceKgWeek;
  if (patch.jobType !== undefined) set.jobType = patch.jobType;
  if (patch.workoutsPerWeek !== undefined) set.workoutsPerWeek = patch.workoutsPerWeek;
  if (patch.activity !== undefined) set.activity = patch.activity;
  if (patch.diet !== undefined) set.dietFlags = patch.diet;
  if (patch.mealSlots !== undefined) set.mealSlots = patch.mealSlots;
  if (patch.specialStatus !== undefined) set.specialStatus = patch.specialStatus;
  if (patch.aiAccess !== undefined) set.aiAccess = patch.aiAccess;
  if (Object.keys(set).length) ctx.db.update(profiles).set(set).where(eq(profiles.id, id)).run();
  const after = getProfileRow(ctx.db, id);

  // Answers that feed the formula re-derive the targets (a manual override is replaced: the
  // person just changed what the targets are based on).
  if (FORMULA_FIELDS.some((f) => patch[f] !== undefined && patch[f] !== before[f])) recalcFormula(ctx.db, after, today);
  if (patch.aiAccess !== undefined && patch.aiAccess !== before.aiAccess) void ctx.auth.check(after);
  return toProfile(ctx, after, today);
}

export function deleteProfile(ctx: Ctx, id: string): void {
  getProfileRow(ctx.db, id);
  const photos = ctx.db
    .select({ photoPath: meals.photoPath })
    .from(meals)
    .where(eq(meals.profileId, id))
    .all()
    .map((m) => m.photoPath)
    .filter((p): p is string => Boolean(p));
  ctx.db.delete(profiles).where(eq(profiles.id, id)).run();
  // Shared-plate photos stay while another profile's meal still uses them.
  const stillUsed = new Set(
    photos.length
      ? ctx.db
          .select({ p: meals.photoPath })
          .from(meals)
          .where(inArray(meals.photoPath, photos))
          .all()
          .map((r) => r.p)
      : [],
  );
  for (const p of new Set(photos)) if (!stillUsed.has(p)) rmSync(photoAbsPath(ctx.cfg, p), { force: true });
  removeCredential(ctx.cfg, id);
  ctx.auth.forget(id);
}
