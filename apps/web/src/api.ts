import {
  toDateStr,
  type AddMealFields,
  type AuthState,
  type BodyLog,
  type BodyLogInput,
  type CalibrationView,
  type ConfirmMealInput,
  type Dashboard,
  type HouseholdSettings,
  type JourneyView,
  type ManualTargetInput,
  type Meal,
  type MonthView,
  type MyFood,
  type MyFoodInput,
  type Profile,
  type ProfileInput,
  type ProfileSummary,
  type ProfileUpdate,
  type Recap,
  type ReferenceFood,
  type SettingsView,
  type SystemStatus,
  type TargetsView,
  type AiRunRow,
} from '@katori/shared';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

// ----- PIN unlock tokens, per profile, kept on this phone -----

const TOKENS_KEY = 'katori.unlock';

function readTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function setUnlockToken(profileId: string, token: string | null) {
  const t = readTokens();
  if (token) t[profileId] = token;
  else delete t[profileId];
  try {
    localStorage.setItem(TOKENS_KEY, JSON.stringify(t));
  } catch {
    // private mode: the unlock lasts this page only
  }
  memoryTokens[profileId] = token ?? undefined;
}
const memoryTokens: Record<string, string | undefined> = {};
export function unlockToken(profileId: string): string | undefined {
  return memoryTokens[profileId] ?? readTokens()[profileId];
}

function profileFromPath(path: string): string | undefined {
  return path.match(/^\/api\/profiles\/([^/?]+)/)?.[1];
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-katori-date': toDateStr(new Date()) };
  const pid = profileFromPath(path);
  const token = pid ? unlockToken(pid) : undefined;
  if (token) headers['x-katori-unlock'] = token;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(path, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = data as { error?: string; code?: string } | undefined;
    if (res.status === 423 && pid) {
      setUnlockToken(pid, null);
      window.dispatchEvent(new Event('katori:locked'));
    }
    throw new ApiError(res.status, err?.error ?? `Request failed (${res.status})`, err?.code);
  }
  return data as T;
}

const get = <T>(p: string) => request<T>('GET', p);
const post = <T>(p: string, b?: unknown) => request<T>('POST', p, b ?? {});
const put = <T>(p: string, b: unknown) => request<T>('PUT', p, b);
const patch = <T>(p: string, b: unknown) => request<T>('PATCH', p, b);
const del = (p: string) => request<void>('DELETE', p);

const P = (pid: string) => `/api/profiles/${encodeURIComponent(pid)}`;

/** Authenticated URL for <img> and download links (they can't send headers). */
export function withUnlock(pid: string, url: string): string {
  const t = unlockToken(pid);
  return t ? `${url}${url.includes('?') ? '&' : '?'}unlock=${encodeURIComponent(t)}` : url;
}

export const api = {
  profiles: () => get<ProfileSummary[]>('/api/profiles'),
  createProfile: (input: ProfileInput) => post<Profile>('/api/profiles', input),
  profile: (pid: string) => get<Profile>(P(pid)),
  updateProfile: (pid: string, input: ProfileUpdate) => patch<Profile>(P(pid), input),
  deleteProfile: (pid: string) => del(P(pid)),
  unlock: (pid: string, pin: string) => post<{ token: string | null }>(`${P(pid)}/unlock`, { pin }),
  setPin: (pid: string, pin: string | null, currentPin?: string) => put<{ hasPin: boolean; token: string | null }>(`${P(pid)}/pin`, { pin, currentPin }),

  aiStatus: (pid: string) => get<AuthState>(`${P(pid)}/ai-status`),
  checkAi: (pid: string) => post<AuthState>(`${P(pid)}/ai-status/check`),

  targets: (pid: string) => get<TargetsView>(`${P(pid)}/targets`),
  setTargets: (pid: string, input: ManualTargetInput) => put<TargetsView>(`${P(pid)}/targets`, input),
  recalcTargets: (pid: string) => post<TargetsView>(`${P(pid)}/targets/recalculate`),
  decideSuggestion: (pid: string, action: 'accepted' | 'dismissed') => post<TargetsView>(`${P(pid)}/targets/suggestion`, { action }),

  meals: (pid: string, date: string) => get<Meal[]>(`${P(pid)}/meals?date=${date}`),
  meal: (pid: string, id: number) => get<Meal>(`${P(pid)}/meals/${id}`),
  addMeal: (pid: string, fields: AddMealFields, photo: Blob | null) => {
    const fd = new FormData();
    fd.append('data', JSON.stringify(fields));
    if (photo) fd.append('photo', photo, 'meal.jpg');
    return post<Meal[]>(`${P(pid)}/meals`, fd);
  },
  quickAdd: (pid: string, myFoodId: number, slot: string, eatenAt: string, servings = 1) => post<Meal>(`${P(pid)}/meals/quick`, { myFoodId, slot, eatenAt, servings }),
  updateMeal: (pid: string, id: number, body: { slot?: string; eatenAt?: string; note?: string }) => patch<Meal>(`${P(pid)}/meals/${id}`, body),
  confirmMeal: (pid: string, id: number, input: ConfirmMealInput) => post<Meal>(`${P(pid)}/meals/${id}/confirm`, input),
  answerMeal: (pid: string, id: number, answers: { question: string; answer: string }[]) => post<Meal>(`${P(pid)}/meals/${id}/answers`, { answers }),
  retryMeal: (pid: string, id: number) => post<Meal>(`${P(pid)}/meals/${id}/retry`),
  deleteMeal: (pid: string, id: number) => del(`${P(pid)}/meals/${id}`),
  mealPhotoUrl: (pid: string, id: number) => withUnlock(pid, `${P(pid)}/meals/${id}/photo`),

  foods: (pid: string) => get<MyFood[]>(`${P(pid)}/foods`),
  quickFoods: (pid: string) => get<MyFood[]>(`${P(pid)}/foods/quick`),
  createFood: (pid: string, input: MyFoodInput) => post<MyFood>(`${P(pid)}/foods`, input),
  updateFood: (pid: string, id: number, input: MyFoodInput) => put<MyFood>(`${P(pid)}/foods/${id}`, input),
  deleteFood: (pid: string, id: number) => del(`${P(pid)}/foods/${id}`),
  searchReference: (q: string) => get<ReferenceFood[]>(`/api/reference/search?q=${encodeURIComponent(q)}`),

  body: (pid: string) => get<BodyLog[]>(`${P(pid)}/body`),
  saveBody: (pid: string, date: string, input: BodyLogInput) => put<{ log: BodyLog | null }>(`${P(pid)}/body/${date}`, input),
  backfill: (pid: string, entries: { date: string; weightKg: number }[]) => post<{ saved: number }>(`${P(pid)}/body/backfill`, { entries }),
  deleteBody: (pid: string, date: string) => del(`${P(pid)}/body/${date}`),

  dashboard: (pid: string) => get<Dashboard>(`${P(pid)}/dashboard`),
  month: (pid: string, month: string) => get<MonthView>(`${P(pid)}/month?month=${month}`),
  journey: (pid: string) => get<JourneyView>(`${P(pid)}/journey`),
  requestRecap: (pid: string, month: string) => post<Recap>(`${P(pid)}/recaps`, { month }),
  exportUrl: (pid: string, kind: 'meals' | 'body') => withUnlock(pid, `${P(pid)}/export/${kind}.csv`),

  settings: () => get<SettingsView>('/api/settings'),
  saveSettings: (s: HouseholdSettings) => put<SettingsView>('/api/settings', s),
  system: () => get<SystemStatus>('/api/system'),
  aiRuns: () => get<AiRunRow[]>('/api/ai-runs?limit=20'),

  calibration: () => get<CalibrationView>('/api/calibration'),
  addCalibration: (pid: string, data: { note: string; trueKcal: number; trueProteinG: number | null }, photo: Blob | null) => {
    const fd = new FormData();
    fd.append('data', JSON.stringify(data));
    if (photo) fd.append('photo', photo, 'meal.jpg');
    return post<Meal>(`${P(pid)}/calibration`, fd);
  },
  rerunCalibration: () => post<{ queued: number }>('/api/calibration/rerun'),
  setCalibrationTruth: (mealId: number, trueKcal: number, trueProteinG: number | null) => patch<CalibrationView>(`/api/calibration/${mealId}`, { trueKcal, trueProteinG }),
};
