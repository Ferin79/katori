import type { HouseholdSettings, MealEstimate } from '@katori/shared';
import type { myFoods, profiles } from '../db/schema.js';

export type ProfileRow = typeof profiles.$inferSelect;
export type MyFoodRow = typeof myFoods.$inferSelect;

export interface EstimateRequest {
  profile: ProfileRow;
  /** Absolute path of the stored meal photo, or null for a note-only estimate. */
  photoPath: string | null;
  note: string;
  answers: { question: string; answer: string }[];
  settings: HouseholdSettings;
  savedFoods: MyFoodRow[];
  referenceLookup: boolean;
}

export interface RunMeta {
  durationMs: number;
  exitCode: number | null;
  model: string;
  raw: string;
}

export interface EstimateResult extends RunMeta {
  estimate: MealEstimate;
}

export interface RecapRequest {
  profile: ProfileRow;
  model: string;
  month: string;
  summary: string;
}

export interface RecapResult extends RunMeta {
  text: string;
}

export type RunnerErrorKind = 'auth' | 'timeout' | 'usage_limit' | 'error' | 'config' | 'invalid_output' | 'no_access';

export class RunnerError extends Error {
  constructor(
    public kind: RunnerErrorKind,
    message: string,
    public retryable: boolean,
    public meta: Partial<RunMeta> = {},
  ) {
    super(message);
  }
}

export interface Runner {
  readonly mode: 'claude' | 'fake';
  estimate(req: EstimateRequest): Promise<EstimateResult>;
  recap(req: RecapRequest): Promise<RecapResult>;
  /** `claude auth status` for a profile: exits 0 when signed in and 1 when not. */
  authStatus(profile: ProfileRow): Promise<{ ok: boolean; message: string }>;
}
