import { expect, type APIRequestContext, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const THALI = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'thali.png');

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Collects console errors so each test can assert none happened. */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && !/status of (403|404|423)/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, 'page scrolls sideways at phone width').toBeLessThanOrEqual(client);
  // Nothing inside scrolls sideways or cuts text off with "…" either (screen-reader-only text aside).
  const problems = await page.evaluate(() =>
    [...document.body.querySelectorAll('*')]
      .filter((el) => !el.classList.contains('sr-only') && el.getBoundingClientRect().width > 0)
      .filter((el) => {
        const s = getComputedStyle(el);
        const scrolls = (s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
        const clipped = (s.overflowX === 'hidden' || s.textOverflow === 'ellipsis') && el.children.length === 0 && el.scrollWidth > el.clientWidth + 1;
        return scrolls || clipped;
      })
      .map((el) => `${el.tagName.toLowerCase()}.${el.className} "${(el.textContent ?? '').trim().slice(0, 30)}"`),
  );
  expect(problems, 'rows that scroll sideways or text cut off').toEqual([]);
}

export async function selectProfile(page: Page, id: string) {
  await page.getByTestId(`profile-chip-${id}`).click();
  await expect(page.getByTestId(`profile-chip-${id}`)).toHaveAttribute('aria-pressed', 'true');
}

export async function fake(request: APIRequestContext, body: { mode?: 'ok' | 'error' | 'timeout' | 'invalid'; auth?: { profileId: string; ok: boolean } }) {
  const r = await request.post('/api/_test/fake', { data: body });
  expect(r.ok()).toBeTruthy();
}

export interface QuickProfile {
  name: string;
  sex: 'male' | 'female';
  birthDate: string;
  heightCm: number;
  weightKg: number;
  goal?: 'lose' | 'maintain' | 'gain';
  paceKgWeek?: number;
  specialStatus?: 'none' | 'pregnant' | 'breastfeeding';
  aiAccess?: 'sign_in' | 'api_key' | 'manual';
  colour?: string;
}

/** Create a helper profile through the API (the onboarding UI is covered by its own test). */
export async function createProfile(request: APIRequestContext, p: QuickProfile): Promise<string> {
  const r = await request.post('/api/profiles', {
    headers: { 'x-katori-date': today() },
    data: {
      name: p.name,
      colour: p.colour ?? '#1baf7a',
      sex: p.sex,
      birthDate: p.birthDate,
      heightCm: p.heightCm,
      weightKg: p.weightKg,
      goal: p.goal ?? 'maintain',
      goalWeightKg: null,
      paceKgWeek: p.paceKgWeek ?? 0,
      jobType: 'desk',
      workoutsPerWeek: 3,
      activity: 'light',
      neckCm: null,
      waistCm: null,
      hipCm: null,
      diet: { vegetarian: true, eggs: false },
      mealSlots: [
        { name: 'Breakfast', time: '08:00' },
        { name: 'Lunch', time: '13:00' },
        { name: 'Snack', time: '16:30' },
        { name: 'Dinner', time: '20:00' },
      ],
      specialStatus: p.specialStatus ?? 'none',
      aiAccess: p.aiAccess ?? 'sign_in',
      startWeightKg: null,
      startDate: null,
    },
  });
  expect(r.status(), await r.text()).toBe(201);
  return ((await r.json()) as { id: string }).id;
}
