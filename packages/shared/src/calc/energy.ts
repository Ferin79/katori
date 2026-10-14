import type { ActivityLevel, Goal, JobType, Sex, SpecialStatus } from '../schemas.js';

/** Mifflin-St Jeor activity multipliers (PLAN.md, Targets and body metrics). */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, string> = {
  sedentary: 'Sedentary',
  light: 'Lightly active',
  moderate: 'Moderately active',
  active: 'Active',
  very_active: 'Very active',
};

const ACTIVITY_ORDER: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

/** Roughly 7,700 kcal per kg of body weight (approximate). */
export const KCAL_PER_KG = 7700;

export const PROTEIN_G_PER_KG = 1.6;
export const PROTEIN_G_PER_KG_HIGH = 2.2;
export const FAT_SHARE = 0.25;
export const FIBER_G_PER_1000_KCAL = 14;
/** Pace is capped at 1% of body weight per week. */
export const MAX_PACE_SHARE = 0.01;

/** BMR = 10W + 6.25H − 5A + s, s = +5 (men), −161 (women). W kg, H cm, A years. */
export function bmr(p: { sex: Sex; weightKg: number; heightCm: number; age: number }): number {
  return 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === 'male' ? 5 : -161);
}

/**
 * Job type sets a base level; workouts per week bump it.
 * A desk job with 3 workouts a week is "lightly active" (1.375), as in the worked example.
 */
export function activityFromLifestyle(jobType: JobType, workoutsPerWeek: number): ActivityLevel {
  const base = jobType === 'desk' ? 0 : jobType === 'standing' ? 1 : 2;
  const bump = workoutsPerWeek <= 0 ? 0 : workoutsPerWeek <= 3 ? 1 : workoutsPerWeek <= 5 ? 2 : 3;
  return ACTIVITY_ORDER[Math.min(base + bump, ACTIVITY_ORDER.length - 1)]!;
}

export function maintenanceKcal(bmrKcal: number, activity: ActivityLevel): number {
  return bmrKcal * ACTIVITY_FACTORS[activity];
}

export function maxPaceKgWeek(weightKg: number): number {
  return weightKg * MAX_PACE_SHARE;
}

/** Daily kcal deficit (or surplus) for a weekly pace: 0.25 kg/week ≈ 275 kcal/day. */
export function dailyEnergyDelta(paceKgWeek: number): number {
  return (paceKgWeek * KCAL_PER_KG) / 7;
}

/** Rule-of-thumb floors: 1,200 kcal (women), 1,500 kcal (men). */
export function calorieFloor(sex: Sex): number {
  return sex === 'male' ? 1500 : 1200;
}

export interface TargetInput {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  age: number;
  activity: ActivityLevel;
  goal: Goal;
  paceKgWeek: number;
  specialStatus: SpecialStatus;
  /** Use a learned maintenance instead of the formula one. */
  maintenanceOverride?: number;
}

export interface TargetBreakdown {
  bmr: number;
  activityFactor: number;
  formulaMaintenance: number;
  maintenance: number;
  requestedPaceKgWeek: number;
  appliedPaceKgWeek: number;
  dailyDelta: number;
  kcal: number;
  protein_g: number;
  proteinHigh_g: number;
  fat_g: number;
  carbs_g: number;
  fiber_g: number;
  maintenanceOnly: boolean;
  paceCapped: boolean;
  floorApplied: boolean;
  notes: string[];
}

/**
 * Calorie and macro targets from onboarding answers, with the guardrails:
 * pace ≤ 1% of body weight a week, calorie floors, and maintenance-only for
 * pregnant, breastfeeding and under-18 profiles.
 */
export function computeTargets(input: TargetInput): TargetBreakdown {
  const notes: string[] = [];
  const b = bmr(input);
  const factor = ACTIVITY_FACTORS[input.activity];
  const formulaMaintenance = b * factor;
  const maintenance = input.maintenanceOverride ?? formulaMaintenance;

  const minor = input.age < 18;
  const maintenanceOnly = minor || input.specialStatus !== 'none';
  if (input.specialStatus === 'pregnant') notes.push('Pregnant: maintenance target only, no deficit.');
  if (input.specialStatus === 'breastfeeding') notes.push('Breastfeeding: maintenance target only, no deficit.');
  if (minor) notes.push('Under 18: intake tracking with a maintenance target only.');

  let pace = input.goal === 'maintain' || maintenanceOnly ? 0 : input.paceKgWeek;
  let paceCapped = false;
  const cap = maxPaceKgWeek(input.weightKg);
  if (pace > cap) {
    pace = cap;
    paceCapped = true;
    notes.push(`Pace capped at 1% of body weight: ${round1(cap)} kg a week.`);
  }

  const delta = dailyEnergyDelta(pace);
  let kcal = input.goal === 'gain' ? maintenance + delta : maintenance - delta;

  let floorApplied = false;
  if (!maintenanceOnly && input.goal === 'lose') {
    // The floor never pushes a target above maintenance.
    const floor = Math.min(calorieFloor(input.sex), maintenance);
    if (kcal < floor) {
      kcal = floor;
      floorApplied = true;
      notes.push(
        floor < calorieFloor(input.sex)
          ? `Held at maintenance: the ${calorieFloor(input.sex).toLocaleString('en-US')} kcal floor is above it, so no deficit.`
          : `Raised to the ${calorieFloor(input.sex).toLocaleString('en-US')} kcal floor.`,
      );
    }
  }

  const kcalR = Math.round(kcal);
  const macros = macrosFor(kcalR, input.weightKg);
  return {
    bmr: b,
    activityFactor: factor,
    formulaMaintenance,
    maintenance,
    requestedPaceKgWeek: input.paceKgWeek,
    appliedPaceKgWeek: pace,
    dailyDelta: delta,
    kcal: kcalR,
    ...macros,
    maintenanceOnly,
    paceCapped,
    floorApplied,
    notes,
  };
}

/** Protein 1.6 g/kg, fat 25% of calories, carbs the remainder, fiber 14 g per 1,000 kcal. */
export function macrosFor(kcal: number, weightKg: number) {
  const protein_g = Math.round(PROTEIN_G_PER_KG * weightKg);
  const proteinHigh_g = Math.round(PROTEIN_G_PER_KG_HIGH * weightKg);
  const fat_g = Math.round((kcal * FAT_SHARE) / 9);
  const carbs_g = Math.max(0, Math.round((kcal - protein_g * 4 - fat_g * 9) / 4));
  const fiber_g = Math.round((FIBER_G_PER_1000_KCAL * kcal) / 1000);
  return { protein_g, proteinHigh_g, fat_g, carbs_g, fiber_g };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
