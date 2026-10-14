import { z } from 'zod';

// ---------- Enums ----------

export const Sex = z.enum(['male', 'female']);
export type Sex = z.infer<typeof Sex>;

export const Goal = z.enum(['lose', 'maintain', 'gain']);
export type Goal = z.infer<typeof Goal>;

export const JobType = z.enum(['desk', 'standing', 'manual']);
export type JobType = z.infer<typeof JobType>;

export const ActivityLevel = z.enum(['sedentary', 'light', 'moderate', 'active', 'very_active']);
export type ActivityLevel = z.infer<typeof ActivityLevel>;

export const SpecialStatus = z.enum(['none', 'pregnant', 'breastfeeding']);
export type SpecialStatus = z.infer<typeof SpecialStatus>;

/** How a profile's estimates run. Credentials never live in the database. */
export const AiAccess = z.enum(['sign_in', 'api_key', 'manual']);
export type AiAccess = z.infer<typeof AiAccess>;

export const MealStatus = z.enum(['pending', 'estimated', 'confirmed', 'failed']);
export type MealStatus = z.infer<typeof MealStatus>;

export const ItemSource = z.enum(['ai', 'my_food', 'reference', 'manual']);
export type ItemSource = z.infer<typeof ItemSource>;

export const TargetSource = z.enum(['formula', 'learned', 'manual']);
export type TargetSource = z.infer<typeof TargetSource>;

export const Confidence = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof Confidence>;

// ---------- Primitives ----------

export const DateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
/** Wall-clock local time of the phone, no zone: a meal at 11:00 is brunch wherever you are. */
export const LocalDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Expected YYYY-MM-DDTHH:mm');
export const TimeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm');
export const HexColour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #rrggbb');
export const Pin = z.string().regex(/^\d{4}$/, 'PIN is 4 digits');

export const MealSlot = z.object({
  name: z.string().trim().min(1).max(24),
  time: TimeStr,
});
export type MealSlot = z.infer<typeof MealSlot>;

export const DietFlags = z.object({
  vegetarian: z.boolean(),
  eggs: z.boolean(),
});
export type DietFlags = z.infer<typeof DietFlags>;

export const Nutrients = z.object({
  kcal: z.number().min(0).max(20000),
  protein_g: z.number().min(0).max(2000),
  carbs_g: z.number().min(0).max(2000),
  fat_g: z.number().min(0).max(2000),
  fiber_g: z.number().min(0).max(500),
});
export type Nutrients = z.infer<typeof Nutrients>;

// ---------- AI output: what `claude -p --json-schema` returns ----------
// Mirrors schemas/meal-estimate.json; a unit test keeps the two in step.

export const MealEstimateItem = z.object({
  name: z.string().min(1).max(80),
  portion: z.string().max(60),
  grams: z.number().min(0).max(3000),
  kcal: z.number().min(0).max(5000),
  protein_g: z.number().min(0).max(500),
  carbs_g: z.number().min(0).max(1000),
  fat_g: z.number().min(0).max(500),
  fiber_g: z.number().min(0).max(200),
  confidence: Confidence,
  /** Set when the line matched one of the person's saved foods. */
  myFoodId: z.string().nullable(),
  /** Set when the values came from the reference lookup tool (IFCT / INDB code). */
  referenceId: z.string().nullable(),
});
export type MealEstimateItem = z.infer<typeof MealEstimateItem>;

export const EstimateQuestion = z.object({
  text: z.string().min(1).max(140),
  /** Tap-to-answer chips; the person can also type a free answer. */
  options: z.array(z.string().min(1).max(40)).max(4),
});
export type EstimateQuestion = z.infer<typeof EstimateQuestion>;

export const MealEstimate = z.object({
  items: z.array(MealEstimateItem).max(30),
  questions: z.array(EstimateQuestion).max(2),
});
export type MealEstimate = z.infer<typeof MealEstimate>;

// ---------- API inputs ----------

export const ProfileInput = z.object({
  name: z.string().trim().min(1).max(30),
  colour: HexColour,
  sex: Sex,
  birthDate: DateStr,
  heightCm: z.number().min(90).max(250),
  weightKg: z.number().min(20).max(300),
  goal: Goal,
  goalWeightKg: z.number().min(20).max(300).nullable(),
  paceKgWeek: z.number().min(0).max(2),
  jobType: JobType,
  workoutsPerWeek: z.number().int().min(0).max(14),
  activity: ActivityLevel,
  neckCm: z.number().min(15).max(80).nullable(),
  waistCm: z.number().min(30).max(250).nullable(),
  hipCm: z.number().min(30).max(250).nullable(),
  diet: DietFlags,
  mealSlots: z.array(MealSlot).min(1).max(8),
  specialStatus: SpecialStatus,
  aiAccess: AiAccess,
  /** Optional earlier starting point for the Journey chart (a weigh-in from before onboarding). */
  startWeightKg: z.number().min(20).max(300).nullable(),
  startDate: DateStr.nullable(),
});
export type ProfileInput = z.infer<typeof ProfileInput>;

export const ProfileUpdate = ProfileInput.omit({ startWeightKg: true, startDate: true, weightKg: true, neckCm: true, waistCm: true, hipCm: true }).partial();
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const MealItemInput = Nutrients.extend({
  name: z.string().trim().min(1).max(80),
  portion: z.string().max(60),
  grams: z.number().min(0).max(5000),
  confidence: Confidence.nullable(),
  source: ItemSource,
  myFoodId: z.number().int().nullable(),
});
export type MealItemInput = z.infer<typeof MealItemInput>;

export const AlsoFor = z.object({
  profileId: z.string().min(1),
  /** Portion multiplier relative to the plate in the photo, e.g. 0.75. */
  portion: z.number().min(0.1).max(5),
});
export type AlsoFor = z.infer<typeof AlsoFor>;

export const AddMealFields = z.object({
  note: z.string().max(500).default(''),
  slot: z.string().max(24),
  eatenAt: LocalDateTime,
  portion: z.number().min(0.1).max(5).default(1),
  alsoFor: z.array(AlsoFor).max(10).default([]),
});
export type AddMealFields = z.infer<typeof AddMealFields>;

export const QuickAddInput = z.object({
  myFoodId: z.number().int(),
  servings: z.number().min(0.1).max(20).default(1),
  slot: z.string().max(24),
  eatenAt: LocalDateTime,
});
export type QuickAddInput = z.infer<typeof QuickAddInput>;

export const ConfirmMealInput = z.object({
  items: z.array(MealItemInput).max(40),
  slot: z.string().max(24).optional(),
  eatenAt: LocalDateTime.optional(),
});
export type ConfirmMealInput = z.infer<typeof ConfirmMealInput>;

export const AnswersInput = z.object({
  answers: z
    .array(z.object({ question: z.string().max(140), answer: z.string().trim().min(1).max(100) }))
    .min(1)
    .max(2),
});
export type AnswersInput = z.infer<typeof AnswersInput>;

export const MyFoodInput = Nutrients.extend({
  name: z.string().trim().min(1).max(60),
  aliases: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  servingDesc: z.string().trim().min(1).max(40),
  servingG: z.number().min(0).max(3000),
  /** true = household (profile_id blank), false = this profile only. */
  household: z.boolean(),
});
export type MyFoodInput = z.infer<typeof MyFoodInput>;

export const BodyLogInput = z.object({
  weightKg: z.number().min(20).max(300).nullable().optional(),
  neckCm: z.number().min(15).max(80).nullable().optional(),
  waistCm: z.number().min(30).max(250).nullable().optional(),
  hipCm: z.number().min(30).max(250).nullable().optional(),
});
export type BodyLogInput = z.infer<typeof BodyLogInput>;

export const BodyBackfillInput = z.object({
  entries: z.array(z.object({ date: DateStr, weightKg: z.number().min(20).max(300) })).min(1).max(2000),
});
export type BodyBackfillInput = z.infer<typeof BodyBackfillInput>;

export const ManualTargetInput = z.object({
  kcal: z.number().int().min(800).max(6000),
  protein_g: z.number().min(0).max(500),
  carbs_g: z.number().min(0).max(1000),
  fat_g: z.number().min(0).max(400),
  fiber_g: z.number().min(0).max(150),
});
export type ManualTargetInput = z.infer<typeof ManualTargetInput>;

export const ClaudeModel = z.enum(['sonnet', 'opus', 'haiku']);
export type ClaudeModel = z.infer<typeof ClaudeModel>;

export const HouseholdSettings = z.object({
  /** Volume of your katori (bowl), ml. */
  katoriMl: z.number().min(50).max(1000),
  /** Weight of a typical roti, g. */
  rotiG: z.number().min(10).max(200),
  /** Volume of your serving ladle, ml. */
  ladleMl: z.number().min(10).max(500),
  /** Your usual cooking oil or ghee per sabzi serving, ml (1 tsp ≈ 5 ml). */
  oilPerServingMl: z.number().min(0).max(60),
  model: ClaudeModel,
  /** Ground estimates in IFCT / INDB through the local lookup tool, when loaded. */
  referenceLookup: z.boolean(),
  /** Calibration pass mark: calorie error within ±this percent. */
  calibrationTolerancePct: z.number().min(1).max(50),
});
export type HouseholdSettings = z.infer<typeof HouseholdSettings>;

export const DEFAULT_SETTINGS: HouseholdSettings = {
  katoriMl: 150,
  rotiG: 35,
  ladleMl: 60,
  oilPerServingMl: 5,
  model: 'sonnet',
  referenceLookup: true,
  calibrationTolerancePct: 15,
};

export const CalibrationInput = z.object({
  note: z.string().max(500).default(''),
  trueKcal: z.number().min(1).max(5000),
  trueProteinG: z.number().min(0).max(500).nullable().default(null),
});
export type CalibrationInput = z.infer<typeof CalibrationInput>;

export const PinInput = z.object({
  pin: Pin.nullable(),
  currentPin: Pin.optional(),
});
export type PinInput = z.infer<typeof PinInput>;
