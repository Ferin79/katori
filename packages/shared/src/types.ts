// Response shapes shared by the server and the web app.
import type {
  ActivityLevel,
  AiAccess,
  Confidence,
  DietFlags,
  EstimateQuestion,
  Goal,
  HouseholdSettings,
  ItemSource,
  JobType,
  MealSlot,
  MealStatus,
  Nutrients,
  Sex,
  SpecialStatus,
  TargetSource,
} from './schemas.js';

export type AuthStatus = 'ok' | 'signed_out' | 'missing_credential' | 'manual' | 'unknown';

export interface AuthState {
  status: AuthStatus;
  checkedAt: string | null;
  message: string | null;
}

export interface ProfileSummary {
  id: string;
  name: string;
  colour: string;
  aiAccess: AiAccess;
  hasPin: boolean;
  minor: boolean;
  auth: AuthState;
}

export interface Profile extends ProfileSummary {
  sex: Sex;
  birthDate: string;
  age: number;
  heightCm: number;
  goal: Goal;
  goalWeightKg: number | null;
  paceKgWeek: number;
  jobType: JobType;
  workoutsPerWeek: number;
  activity: ActivityLevel;
  diet: DietFlags;
  mealSlots: MealSlot[];
  specialStatus: SpecialStatus;
  createdAt: string;
  latestWeightKg: number | null;
}

export interface TargetRow extends Nutrients {
  id: number;
  effectiveFrom: string;
  source: TargetSource;
  basisWeightKg: number | null;
}

export interface TargetsView {
  current: TargetRow | null;
  history: TargetRow[];
  formula: {
    bmr: number;
    activityFactor: number;
    maintenance: number;
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
  } | null;
}

export interface MealItem extends Nutrients {
  id: number;
  name: string;
  portion: string;
  grams: number;
  confidence: Confidence | null;
  source: ItemSource;
  myFoodId: number | null;
}

export interface MealShare {
  profileId: string;
  name: string;
  colour: string;
  portion: number;
}

export interface Meal {
  id: number;
  profileId: string;
  eatenAt: string;
  slot: string;
  note: string;
  hasPhoto: boolean;
  status: MealStatus;
  sharedGroupId: string | null;
  portion: number;
  questions: EstimateQuestion[];
  answers: { question: string; answer: string }[];
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  calibration: boolean;
  trueKcal: number | null;
  trueProteinG: number | null;
  items: MealItem[];
  totals: Nutrients;
  createdAt: string;
  confirmedAt: string | null;
  sharedWith: MealShare[];
}

export interface MyFood extends Nutrients {
  id: number;
  profileId: string | null;
  household: boolean;
  name: string;
  aliases: string[];
  servingDesc: string;
  servingG: number;
  uses: number;
}

export interface ReferenceFood {
  id: string;
  source: 'IFCT2017' | 'INDB';
  name: string;
  /** Per 100 g. */
  kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  servingDesc: string | null;
  servingG: number | null;
}

export interface BodyLog {
  date: string;
  weightKg: number | null;
  neckCm: number | null;
  waistCm: number | null;
  hipCm: number | null;
  bmi: number | null;
  bodyFatPct: number | null;
  fatMassKg: number | null;
  leanMassKg: number | null;
  waistToHeight: number | null;
  waistToHip: number | null;
}

export interface DayTotal extends Nutrients {
  date: string;
  meals: number;
  targetKcal: number | null;
  targetProteinG: number | null;
}

export type HeatState = 'none' | 'under' | 'on' | 'over';

export interface TargetSuggestion {
  currentKcal: number;
  suggestedKcal: number;
  learnedMaintenance: number;
  formulaMaintenance: number;
  observedMaintenance: number;
  loggedDays: number;
  message: string;
}

export interface Dashboard {
  date: string;
  target: TargetRow | null;
  minor: boolean;
  today: {
    totals: Nutrients;
    remainingKcal: number | null;
    meals: Meal[];
    toReview: number;
    pending: number;
    failed: number;
  };
  last7: { days: DayTotal[]; avgKcal: number | null };
  weight: {
    points: { date: string; weightKg: number; trendKg: number }[];
    goalKg: number | null;
    currentTrendKg: number | null;
    latestKg: number | null;
    projectedGoalDate: string | null;
    weeklyRateKg: number | null;
  };
  energy: {
    avgIntakeKcal: number | null;
    formulaMaintenance: number | null;
    learnedMaintenance: number | null;
    observedMaintenance: number | null;
    loggedDays: number;
    windowDays: number;
  };
  body: { points: { date: string; bodyFatPct: number; fatMassKg: number; leanMassKg: number }[] } | null;
  waist: {
    points: { date: string; waistCm: number }[];
    latest: { waistCm: number | null; waistToHeight: number | null; waistToHip: number | null; bmi: number | null; bmiCategory: string | null };
  };
  protein: { targetG: number | null; weekHit: number; weekDays: number; monthHit: number; monthDays: number };
  streak: { current: number; daysLogged30: number; heatmap: { date: string; state: HeatState; kcal: number }[] };
  slots: { name: string; kcal: number; avgKcal: number; share: number }[];
  top: {
    byKcal: { name: string; kcal: number; count: number }[];
    byProtein: { name: string; protein_g: number; count: number }[];
  };
  suggestion: TargetSuggestion | null;
}

export interface MonthView {
  month: string;
  days: DayTotal[];
  averages: Nutrients & { loggedDays: number };
  targetKcal: number | null;
  daysOnTarget: number;
  daysOver: number;
  weight: { startKg: number | null; endKg: number | null; changeKg: number | null; avgKg: number | null };
  waist: { startCm: number | null; endCm: number | null };
  bodyFat: { start: number | null; end: number | null };
  recap: Recap | null;
}

export interface Recap {
  month: string;
  status: 'pending' | 'done' | 'failed';
  text: string | null;
  error: string | null;
  createdAt: string;
}

export interface JourneyView {
  startDate: string | null;
  startKg: number | null;
  currentTrendKg: number | null;
  latestKg: number | null;
  goalKg: number | null;
  changeKg: number | null;
  projectedGoalDate: string | null;
  points: { date: string; weightKg: number; trendKg: number }[];
  months: { month: string; avgWeightKg: number | null; avgKcal: number | null; loggedDays: number; avgWaistCm: number | null }[];
}

export interface SystemStatus {
  aiMode: 'claude' | 'fake';
  version: string;
  queue: { pending: number; running: boolean };
  backup: { configured: boolean; lastAt: string | null; ok: boolean | null; stale: boolean; message: string | null; dest: string | null };
  reference: { count: number; sources: string[] };
  testMode: boolean;
}

export interface SettingsView {
  settings: HouseholdSettings;
  system: SystemStatus;
}

export interface CalibrationRow {
  mealId: number;
  profileId: string;
  profileName: string;
  note: string;
  trueKcal: number;
  trueProteinG: number | null;
  status: MealStatus;
  estimatedKcal: number | null;
  estimatedProteinG: number | null;
  errorPct: number | null;
  withinTolerance: boolean | null;
  runs: number;
  lastRunAt: string | null;
}

export interface CalibrationView {
  tolerancePct: number;
  rows: CalibrationRow[];
  summary: { meals: number; scored: number; within: number; meanAbsErrorPct: number | null; meanErrorPct: number | null };
}

export interface AiRunRow {
  id: number;
  profileId: string;
  mealId: number | null;
  kind: 'estimate' | 'recap' | 'auth';
  startedAt: string;
  durationMs: number | null;
  model: string | null;
  exitCode: number | null;
  error: string | null;
  calibrationErrorPct: number | null;
}
