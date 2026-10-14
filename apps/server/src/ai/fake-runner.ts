// KATORI_AI=fake: canned, deterministic estimates so tests are repeatable and spend no plan usage.
// It reads the note the way the real prompt asks Claude to ("2 rotis, 1 katori dal, little ghee"),
// matches saved foods, asks tap-to-answer questions, and can be switched into failure modes.
import type { EstimateQuestion, MealEstimate, MealEstimateItem } from '@katori/shared';
import {
  RunnerError,
  type EstimateRequest,
  type EstimateResult,
  type MyFoodRow,
  type ProfileRow,
  type RecapRequest,
  type RecapResult,
  type Runner,
} from './runner.js';

export type FakeMode = 'ok' | 'error' | 'timeout' | 'invalid';

interface Per100 {
  kcal: number;
  p: number;
  c: number;
  f: number;
  fib: number;
}

interface FakeFood {
  match: RegExp;
  name: string;
  unit: string;
  grams: (s: EstimateRequest['settings']) => number;
  per100: Per100;
  fat?: boolean;
}

const FOODS: FakeFood[] = [
  { match: /\b(roti|rotis|chapati|chapatis|phulka|phulkas)\b/, name: 'Phulka roti', unit: 'medium', grams: (s) => s.rotiG, per100: { kcal: 264, p: 8.6, c: 50.6, f: 2.6, fib: 7 } },
  { match: /\bparath/, name: 'Plain paratha', unit: 'piece', grams: () => 80, per100: { kcal: 326, p: 7.8, c: 45, f: 13, fib: 5 } },
  { match: /\bpaneer\b/, name: 'Paneer sabzi', unit: 'katori', grams: (s) => s.katoriMl, per100: { kcal: 180, p: 9.5, c: 6, f: 13, fib: 1.2 } },
  { match: /\b(dal|daal|dhal|lentil)/, name: 'Toor dal', unit: 'katori', grams: (s) => s.katoriMl, per100: { kcal: 105, p: 6.5, c: 15.5, f: 1.2, fib: 3.5 } },
  { match: /\brajma\b/, name: 'Rajma', unit: 'katori', grams: (s) => s.katoriMl, per100: { kcal: 125, p: 7.5, c: 18, f: 1.5, fib: 5.5 } },
  { match: /\b(chole|chana)\b/, name: 'Chole', unit: 'katori', grams: (s) => s.katoriMl, per100: { kcal: 140, p: 7, c: 20, f: 2.5, fib: 6 } },
  { match: /\b(rice|chawal|pulao)\b/, name: 'Steamed rice', unit: 'katori', grams: (s) => Math.round(s.katoriMl * 0.8), per100: { kcal: 130, p: 2.7, c: 28, f: 0.3, fib: 0.4 } },
  { match: /\b(sabzi|sabji|subzi|bhaji|curry)\b/, name: 'Mixed veg sabzi', unit: 'katori', grams: (s) => s.katoriMl, per100: { kcal: 48, p: 2, c: 8, f: 0.6, fib: 3 } },
  { match: /\b(raita|curd|dahi|yogurt)\b/, name: 'Curd', unit: 'katori', grams: (s) => s.katoriMl, per100: { kcal: 60, p: 3.1, c: 4.5, f: 3.3, fib: 0 } },
  { match: /\bsalad\b/, name: 'Salad', unit: 'katori', grams: () => 100, per100: { kcal: 20, p: 1, c: 4, f: 0.2, fib: 1.8 } },
  { match: /\bpapad\b/, name: 'Roasted papad', unit: 'piece', grams: () => 12, per100: { kcal: 371, p: 26, c: 60, f: 3, fib: 10 } },
  { match: /\b(pickle|achar)\b/, name: 'Mango pickle', unit: 'tsp', grams: () => 15, per100: { kcal: 200, p: 1, c: 6, f: 19, fib: 2 } },
  { match: /\bidli/, name: 'Idli', unit: 'piece', grams: () => 40, per100: { kcal: 140, p: 4.5, c: 29, f: 0.4, fib: 1.5 } },
  { match: /\bdosa/, name: 'Plain dosa', unit: 'piece', grams: () => 100, per100: { kcal: 168, p: 3.9, c: 29, f: 3.7, fib: 1 } },
  { match: /\bpoha\b/, name: 'Poha', unit: 'katori', grams: (s) => s.katoriMl, per100: { kcal: 130, p: 2.5, c: 25, f: 2.5, fib: 1 } },
  { match: /\bupma\b/, name: 'Upma', unit: 'katori', grams: (s) => s.katoriMl, per100: { kcal: 120, p: 3, c: 18, f: 4, fib: 1.5 } },
  { match: /\b(shake|smoothie)\b/, name: 'Protein shake', unit: 'glass', grams: () => 300, per100: { kcal: 70, p: 8, c: 6, f: 1.5, fib: 0.5 } },
  { match: /\bmilk\b/, name: 'Milk', unit: 'glass', grams: () => 250, per100: { kcal: 62, p: 3.2, c: 4.8, f: 3.3, fib: 0 } },
  { match: /\b(chai|tea)\b/, name: 'Chai', unit: 'cup', grams: () => 150, per100: { kcal: 40, p: 1.3, c: 5.6, f: 1.4, fib: 0 } },
  { match: /\bbanana/, name: 'Banana', unit: 'medium', grams: () => 118, per100: { kcal: 89, p: 1.1, c: 23, f: 0.3, fib: 2.6 } },
  { match: /\begg/, name: 'Boiled egg', unit: 'large', grams: () => 50, per100: { kcal: 143, p: 12.6, c: 0.7, f: 9.5, fib: 0 } },
  { match: /\bghee\b/, name: 'Ghee', unit: 'tsp', grams: () => 5, per100: { kcal: 900, p: 0, c: 0, f: 100, fib: 0 }, fat: true },
  { match: /\b(oil|tel)\b/, name: 'Cooking oil', unit: 'tsp', grams: () => 5, per100: { kcal: 884, p: 0, c: 0, f: 100, fib: 0 }, fat: true },
];

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, half: 0.5, '½': 0.5, quarter: 0.25, little: 0.5, some: 1, few: 2 };

const r1 = (n: number) => Math.round(n * 10) / 10;

function quantityOf(segment: string): number | null {
  const num = segment.match(/(\d+(?:\.\d+)?)/);
  if (num) return Number(num[1]);
  for (const [w, n] of Object.entries(WORD_NUM)) {
    if (new RegExp(`(^|\\s)${w}(\\s|$)`).test(segment)) return n;
  }
  return null;
}

function line(name: string, portion: string, grams: number, per100: Per100, confidence: MealEstimateItem['confidence'], myFoodId: string | null = null): MealEstimateItem {
  const k = grams / 100;
  return {
    name,
    portion,
    grams: Math.round(grams),
    kcal: Math.round(per100.kcal * k),
    protein_g: r1(per100.p * k),
    carbs_g: r1(per100.c * k),
    fat_g: r1(per100.f * k),
    fiber_g: r1(per100.fib * k),
    confidence,
    myFoodId,
    referenceId: null,
  };
}

function savedFoodLine(f: MyFoodRow, qty: number): MealEstimateItem {
  return {
    name: f.name,
    portion: `${qty} × ${f.servingDesc}`,
    grams: Math.round(f.servingG * qty),
    kcal: Math.round(f.kcal * qty),
    protein_g: r1(f.proteinG * qty),
    carbs_g: r1(f.carbsG * qty),
    fat_g: r1(f.fatG * qty),
    fiber_g: r1(f.fiberG * qty),
    confidence: 'high',
    myFoodId: String(f.id),
    referenceId: null,
  };
}

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 || unit === 'tsp' || unit === 'medium' || unit === 'large' ? '' : 's'}`;
}

/** The canned estimator. Exported for unit tests. */
export function fakeEstimate(req: EstimateRequest): MealEstimate {
  const note = req.note.toLowerCase();
  const answers = new Map(req.answers.map((a) => [a.question, a.answer.toLowerCase()]));
  const fatAnswer = [...answers.entries()].find(([q]) => /ghee or oil/i.test(q))?.[1];
  const rotiAnswer = [...answers.entries()].find(([q]) => /how many rotis/i.test(q))?.[1];
  const noFat = /\bno (ghee|oil|tadka|fat)\b/.test(note) || fatAnswer === 'none';

  const items: MealEstimateItem[] = [];
  const questions: EstimateQuestion[] = [];
  let explicitFat = false;
  let needsTadka = false;

  const segments = note.split(/,|\band\b|\+|;|\bwith\b/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const saved = req.savedFoods.find((f) => [f.name, ...f.aliases].some((n) => n && seg.includes(n.toLowerCase())));
    if (saved) {
      items.push(savedFoodLine(saved, quantityOf(seg) ?? 1));
      continue;
    }
    const food = FOODS.find((f) => f.match.test(seg));
    if (!food) continue;
    if (food.fat) {
      if (noFat) continue;
      explicitFat = true;
      const q = quantityOf(seg) ?? 1;
      const tsp = /little/.test(seg) ? 1 : q;
      items.push(line(`${food.name}${/roti|chapati/.test(note) && food.name === 'Ghee' ? ' on roti' : ''}`, plural(tsp, 'tsp'), food.grams(req.settings) * tsp, food.per100, 'high'));
      continue;
    }
    let qty = quantityOf(seg) ?? 1;
    if (/(roti|chapati|phulka)/.test(seg)) {
      if (rotiAnswer && !/\d/.test(seg)) qty = Number(rotiAnswer) || qty;
    }
    if (/(dal|daal|sabzi|sabji|curry|rajma|chole|paneer)/.test(seg)) needsTadka = true;
    items.push(line(food.name, plural(qty, food.unit), food.grams(req.settings) * qty, food.per100, quantityOf(seg) == null ? 'medium' : 'high'));
  }

  if (items.length === 0 && !req.photoPath) {
    return { items: [], questions: [{ text: 'What did you eat?', options: [] }] };
  }

  if (items.length === 0) {
    // A photo with no usable note: the "fixture thali".
    const rotis = rotiAnswer ? Number(rotiAnswer) || 2 : 2;
    needsTadka = true;
    items.push(
      line('Phulka roti', plural(rotis, 'medium'), req.settings.rotiG * rotis, FOODS[0]!.per100, rotiAnswer ? 'high' : 'medium'),
      line('Toor dal', '1 katori', req.settings.katoriMl, FOODS[3]!.per100, 'medium'),
      line('Mixed veg sabzi', '1 katori', req.settings.katoriMl, FOODS[7]!.per100, 'low'),
      line('Steamed rice', '1 katori', Math.round(req.settings.katoriMl * 0.8), FOODS[6]!.per100, 'medium'),
      line('Salad', '1 small katori', 60, FOODS[9]!.per100, 'high'),
    );
    if (!rotiAnswer) questions.push({ text: 'How many rotis did you eat?', options: ['1', '2', '3', '4'] });
  }

  if (needsTadka && !explicitFat && !noFat) {
    const grams = req.settings.oilPerServingMl * 0.9;
    const isGhee = fatAnswer === 'ghee';
    const name = fatAnswer ? `${isGhee ? 'Ghee' : 'Oil'} in tadka` : 'Oil or ghee in tadka';
    items.push(line(name, `${r1(req.settings.oilPerServingMl / 5)} tsp`, grams, { kcal: 890, p: 0, c: 0, f: 100, fib: 0 }, fatAnswer ? 'high' : 'low'));
    if (!fatAnswer) questions.unshift({ text: 'Ghee or oil in the tadka?', options: ['Ghee', 'Oil', 'None'] });
  }
  return { items, questions: questions.slice(0, 2) };
}

export class FakeRunner implements Runner {
  readonly mode = 'fake' as const;
  private failMode: FakeMode = 'ok';
  private auth = new Map<string, boolean>();

  constructor(private delayMs: number) {}

  setMode(mode: FakeMode) {
    this.failMode = mode;
  }

  getMode(): FakeMode {
    return this.failMode;
  }

  setAuth(profileId: string, ok: boolean) {
    this.auth.set(profileId, ok);
  }

  reset() {
    this.failMode = 'ok';
    this.auth.clear();
  }

  private async gate(profile: ProfileRow) {
    await new Promise((r) => setTimeout(r, this.delayMs));
    const meta = { durationMs: this.delayMs, exitCode: 1, model: 'fake', raw: '' };
    if (profile.aiAccess === 'manual') throw new RunnerError('no_access', 'This profile is set to manual logging (no AI).', false);
    if (this.auth.get(profile.id) === false) throw new RunnerError('auth', 'Signed out: the Claude credential for this profile was rejected.', false, meta);
    if (this.failMode === 'error') throw new RunnerError('error', 'Claude Code failed (exit 1): fake runner error', true, meta);
    if (this.failMode === 'timeout') throw new RunnerError('timeout', 'Timed out after 120 s', true, { ...meta, exitCode: null });
    if (this.failMode === 'invalid') throw new RunnerError('invalid_output', 'Estimate did not match the schema: fake invalid output', true, meta);
  }

  async estimate(req: EstimateRequest): Promise<EstimateResult> {
    await this.gate(req.profile);
    const estimate = fakeEstimate(req);
    return { estimate, durationMs: this.delayMs, exitCode: 0, model: `fake-${req.settings.model}`, raw: JSON.stringify({ structured_output: estimate }) };
  }

  async recap(req: RecapRequest): Promise<RecapResult> {
    await this.gate(req.profile);
    const firstLines = req.summary.split('\n').filter((l) => l.startsWith('- ')).slice(0, 3).map((l) => l.slice(2).replace(/\.$/, ''));
    const text = `${req.month} recap for ${req.profile.name} (fake runner). ${firstLines.join('. ')}. Keep the weekly average near your target and lean on your saved foods; small, steady changes add up.`;
    return { text, durationMs: this.delayMs, exitCode: 0, model: 'fake', raw: text };
  }

  async authStatus(profile: ProfileRow): Promise<{ ok: boolean; message: string }> {
    if (profile.aiAccess === 'manual') return { ok: false, message: 'Manual logging (no AI).' };
    const ok = this.auth.get(profile.id) !== false;
    return ok ? { ok, message: 'Signed in (fake runner)' } : { ok, message: 'Signed out: claude auth status reports no valid login for this profile.' };
  }
}
