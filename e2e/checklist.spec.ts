// The PLAN.md "Testing before delivery" checklist as a regression suite, at iPhone size.
// Tests run in order and share one fresh test instance (seeded "Meera" with 60 days of data).
import { expect, test } from '@playwright/test';
import { createProfile, expectNoHorizontalOverflow, fake, selectProfile, THALI, today, watchConsole } from './helpers';

test.describe.configure({ mode: 'serial' });

let priya = '';

test('Home cards: a profile seeded with 60 days renders every card without errors or overflow', async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto('/');
  await selectProfile(page, 'meera');
  for (const id of ['card-today', 'card-macros', 'card-meals', 'card-last7', 'card-streak']) {
    await expect(page.getByTestId(id), id).toBeVisible();
  }
  // Removed from Home to cut clutter; the body charts now live on Body.
  for (const id of ['card-energy', 'card-protein', 'card-slots', 'card-top', 'card-weight', 'card-bodycomp', 'card-waist']) {
    await expect(page.getByTestId(id), id).toHaveCount(0);
  }
  await expect(page.getByTestId('heatmap').locator('.cell[data-state="on"]').first()).toBeVisible();
  // Macro tiles flip between grams left and grams eaten on each tap.
  const protein = page.getByTestId('macro-protein');
  await expect(protein).toContainText(/Protein (left|over)/);
  await protein.click();
  await expect(protein).toContainText('Protein eaten');
  await expect(page.getByTestId('macro-carbs')).toContainText('Carbs eaten');
  await protein.click();
  await expect(protein).toContainText(/Protein (left|over)/);
  await expectNoHorizontalOverflow(page);
  await page.getByTestId('nav-body').click();
  for (const id of ['body-weight-card', 'body-measure-card', 'body-latest', 'card-weight', 'card-bodycomp', 'card-waist']) {
    await expect(page.getByTestId(id), id).toBeVisible();
  }
  await expect(page.getByTestId('card-weight').locator('svg.recharts-surface')).toBeVisible();
  for (const path of ['/add', '/body', '/progress', '/progress?view=journey', '/settings', '/settings/foods', '/settings/calibration']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalOverflow(page);
  }
  expect(errors).toEqual([]);
});

test('Onboarding and targets: the worked example gives ≈2,044 kcal and 112 g protein', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByTestId('ob-name').fill('Arjun');
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-sex-male').click();
  await page.getByTestId('ob-dob').fill('2000-01-15');
  await page.getByTestId('ob-height-cm').fill('177.8');
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-weight').fill('70');
  await page.getByTestId('ob-start-weight').fill('78');
  await page.getByTestId('ob-start-date').fill('2026-07-01');
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-goal-weight').fill('66');
  // Guardrail: a too-fast pace is capped at 1% of body weight.
  await page.getByTestId('ob-pace').fill('1.2');
  await expect(page.getByTestId('ob-pace-hint')).toContainText('Capped at 1% of body weight: 0.7 kg a week');
  await page.getByTestId('ob-pace-0.25').click();
  await page.getByTestId('ob-next').click();
  await expect(page.getByTestId('ob-activity')).toHaveValue('light'); // desk + 3 workouts
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-neck').fill('38');
  await page.getByTestId('ob-waist').fill('85');
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-slot-remove-3').click();
  for (const [i, name, time] of [
    [0, 'Brunch', '11:00'],
    [1, 'Shake', '15:00'],
    [2, 'Dinner', '18:00'],
  ] as const) {
    await page.getByTestId(`ob-slot-name-${i}`).fill(name);
    await page.getByTestId(`ob-slot-time-${i}`).fill(time);
  }
  await page.getByTestId('ob-next').click();
  await page.getByTestId('ob-ai-sign_in').check();
  await page.getByTestId('ob-create').click();
  await expect(page.getByTestId('ob-result-kcal')).toHaveText('2,044');
  await expect(page.getByTestId('ob-result-protein')).toHaveText('112 g');
  await expect(page.getByTestId('ob-result-fat')).toHaveText('57 g');
  await expect(page.getByTestId('ob-result-carbs')).toHaveText('271 g');
  await page.getByTestId('ob-finish').click();
  await expect(page.getByTestId('home-title')).toHaveText('Arjun');
  await expect(page.getByTestId('today-target')).toContainText('2,044');
});

test('Guardrails: calorie floor, pregnant and under-18 profiles get the right targets', async ({ page, request }) => {
  const asha = await createProfile(request, { name: 'Asha', sex: 'female', birthDate: '1981-03-02', heightCm: 155, weightKg: 55, goal: 'lose', paceKgWeek: 0.5, aiAccess: 'manual' });
  const ashaTargets = await (await request.get(`/api/profiles/${asha}/targets`)).json();
  expect(ashaTargets.current.kcal).toBe(1200);
  expect(ashaTargets.formula.notes.join(' ')).toContain('1,200 kcal floor');

  await request.patch(`/api/profiles/${asha}`, { data: { specialStatus: 'pregnant' } });
  await page.goto('/settings');
  await selectProfile(page, asha);
  await expect(page.getByTestId('target-kcal')).toHaveText(`${Math.round(ashaTargets.formula.maintenance).toLocaleString('en-US')} kcal`);

  const kabir = await createProfile(request, { name: 'Kabir', sex: 'male', birthDate: '2011-05-01', heightCm: 165, weightKg: 52, goal: 'lose', paceKgWeek: 0.5, aiAccess: 'manual' });
  await page.goto('/');
  await selectProfile(page, kabir);
  await expect(page.getByText('Intake tracking')).toBeVisible();
  await expect(page.getByTestId('card-bodycomp')).toHaveCount(0);
  const k = await (await request.get(`/api/profiles/${kabir}/targets`)).json();
  expect(k.current.kcal).toBe(Math.round(k.formula.maintenance));
});

test('Add meal and question chips: pending → estimated, items and a question appear', async ({ page }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  await page.getByTestId('nav-add').click();
  await page.getByTestId('photo-input').setInputFiles(THALI);
  await expect(page.getByTestId('photo-preview')).toBeVisible();
  await page.getByTestId('meal-note').fill('2 rotis, 1 katori dal');
  await page.getByTestId('meal-submit').click();
  await expect(page.getByTestId('review-pending')).toBeVisible();
  await expect(page.getByTestId('review-photo')).toBeVisible();
  await expect(page.getByTestId('questions')).toBeVisible();
  await expect(page.getByTestId('item-name-0')).toHaveText('Phulka roti');
  await expect(page.getByTestId('item-low-2')).toBeVisible();
  await page.getByTestId('answer-0-Ghee').click();
  await expect(page.getByTestId('item-name-2')).toHaveText('Ghee in tadka');
  await expect(page.getByTestId('questions')).toHaveCount(0);
});

test('Review and saved foods: grams rescale, a household dal replaces the AI line, confirm; Home updates', async ({ page }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  // Save a household dal with real numbers first.
  await page.goto('/settings/foods');
  await page.getByTestId('food-new').click();
  await page.getByTestId('food-name').fill('Ghar ki dal');
  await page.getByTestId('food-aliases').fill('my usual dal');
  await page.getByTestId('food-serving').fill('1 katori');
  await page.getByTestId('food-grams').fill('150');
  await page.getByTestId('food-kcal').fill('190');
  await page.getByTestId('food-protein').fill('9.5');
  await page.getByTestId('food-carbs').fill('22');
  await page.getByTestId('food-fat').fill('7');
  await page.getByTestId('food-fiber').fill('5');
  await page.getByTestId('food-save').click();
  await expect(page.getByTestId('foods-household-list')).toContainText('Ghar ki dal');

  await page.goto('/');
  await page.getByTestId('card-meals').locator('[data-testid^=meal-row-]').first().click();
  await expect(page.getByTestId('item-kcal-0')).toHaveText('185');
  await page.getByTestId('item-grams-0').fill('105');
  await expect(page.getByTestId('item-kcal-0')).toHaveText('278');
  // Swap and "Save as my food" are gone; replace a line by removing it and adding the saved food.
  await expect(page.locator('[data-testid^=item-swap-], [data-testid^=item-save-]')).toHaveCount(0);
  await page.getByTestId('item-remove-1').click();
  await page.getByTestId('item-add').click();
  await page.getByTestId('food-picker').getByRole('button', { name: /Ghar ki dal/ }).click();
  await expect(page.getByTestId('item-name-2')).toHaveText('Ghar ki dal');
  await expect(page.getByTestId('item-kcal-2')).toHaveText('190');
  const total = await page.getByTestId('review-total-kcal').innerText();
  await page.getByTestId('review-confirm').click();
  await expect(page.getByTestId('today-kcal')).toHaveText(total.replace(' kcal', ''));
  await expect(page.getByTestId('today-left')).toContainText(`${(2044 - Number(total.replace(/\D/g, ''))).toLocaleString('en-US')} kcal left`);
});

test('Profiles: a meal logged in one profile never shows in another', async ({ page, request }) => {
  priya = await createProfile(request, { name: 'Priya', sex: 'female', birthDate: '1998-06-20', heightCm: 162, weightKg: 58 });
  await page.goto('/');
  await selectProfile(page, priya);
  await expect(page.getByText('Nothing logged yet today.')).toBeVisible();
  await expect(page.getByTestId('today-kcal')).toHaveText('0');
  const other = await request.get(`/api/profiles/${priya}/meals`, { headers: { 'x-katori-date': today() } });
  expect(await other.json()).toEqual([]);
  // Household foods are shared, personal ones are not.
  const foods = (await (await request.get(`/api/profiles/${priya}/foods`)).json()) as { name: string }[];
  expect(foods.map((f) => f.name)).toContain('Ghar ki dal');
});

test('Shared plate: "Also for" gives both profiles the meal with their own portions', async ({ page, request }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  await page.getByTestId('nav-add').click();
  await page.getByTestId('meal-note').fill('2 rotis, 1 katori rajma, 1 katori rice, no ghee');
  await page.getByTestId(`also-${priya}`).check();
  await page.getByTestId(`also-portion-${priya}-minus`).click();
  await page.getByTestId(`also-portion-${priya}-minus`).click();
  await expect(page.getByTestId(`also-portion-${priya}-value`)).toHaveText('0.5×');
  await page.getByTestId('meal-submit').click();
  await expect(page.getByTestId('shared-with')).toContainText('Priya (0.5×)');
  await expect(page.getByTestId('items')).toBeVisible();
  await expect
    .poll(async () => ((await (await request.get(`/api/profiles/${priya}/meals`, { headers: { 'x-katori-date': today() } })).json()) as { status: string }[])[0]?.status)
    .toBe('estimated');
  const mine = ((await (await request.get('/api/profiles/arjun/meals', { headers: { 'x-katori-date': today() } })).json()) as { portion: number; totals: { kcal: number }; sharedGroupId: string }[]).at(-1)!;
  const hers = ((await (await request.get(`/api/profiles/${priya}/meals`, { headers: { 'x-katori-date': today() } })).json()) as { portion: number; totals: { kcal: number }; sharedGroupId: string }[])[0]!;
  expect(hers.portion).toBe(0.5);
  expect(hers.sharedGroupId).toBe(mine.sharedGroupId);
  expect(hers.totals.kcal).toBeGreaterThan(0);
  expect(hers.totals.kcal).toBeLessThan(mine.totals.kcal);
  await page.getByTestId('review-confirm').click();
});

test('Saved foods: one tap quick-adds the 3 PM shake', async ({ page }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  await page.goto('/settings/foods');
  await page.getByTestId('food-new').click();
  await page.getByTestId('food-name').fill('3 PM shake');
  await page.getByTestId('food-serving').fill('1 glass');
  await page.getByTestId('food-grams').fill('350');
  await page.getByTestId('food-kcal').fill('240');
  await page.getByTestId('food-protein').fill('30');
  await page.getByTestId('food-scope-mine').click();
  await page.getByTestId('food-save').click();
  await expect(page.getByTestId('foods-mine-list')).toContainText('3 PM shake');
  const before = Number((await (await page.request.get('/api/profiles/arjun/dashboard', { headers: { 'x-katori-date': today() } })).json()).today.totals.kcal);
  await page.getByTestId('nav-add').click();
  // Saved foods have their own tab on Add meal: a list, not a sideways row of chips.
  await page.getByTestId('add-mode-saved').click();
  await expect(page.getByTestId('quick-add')).toContainText('1 glass, 350 g');
  await page.getByTestId('quick-add').getByRole('button', { name: /3 PM shake/ }).click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Logged 3 PM shake' })).toBeVisible();
  await expect(page.getByTestId('today-kcal')).toHaveText((before + 240).toLocaleString('en-US'));
  // The tab is remembered on this phone; the photo tab is one tap back.
  await page.getByTestId('nav-add').click();
  await expect(page.getByTestId('add-mode-saved')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('add-mode-new').click();
  await expect(page.getByTestId('meal-note')).toBeVisible();
});

test('Body metrics: body fat, BMI and ratios match the unit-tested formulas', async ({ page }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  await page.getByTestId('nav-body').click();
  // Weight: save one reading, then nudge it with − and update.
  const saveWeight = page.getByTestId('body-save-weight');
  await page.getByTestId('body-weight').fill('70.2');
  await saveWeight.click();
  await expect(saveWeight).toHaveText('Saved');
  await expect(page.getByTestId('weight-saved')).toHaveText('Saved today');
  await page.getByTestId('body-weight-minus').click();
  await page.getByTestId('body-weight-minus').click();
  await expect(page.getByTestId('body-weight')).toHaveValue('70.0');
  await expect(saveWeight).toHaveText('Update weight');
  await saveWeight.click();
  await expect(saveWeight).toHaveText('Saved');
  // Tape: its own card and button, so the weight above stays as saved.
  await page.getByTestId('body-add-hips').click();
  await page.getByTestId('body-neck').fill('38');
  await page.getByTestId('body-waist').fill('85');
  await page.getByTestId('body-hips').fill('96');
  await page.getByTestId('body-save-measures').click();
  await expect(page.getByTestId('body-save-measures')).toHaveText('Saved');
  await expect(page.getByTestId('body-weight')).toHaveValue('70.0');
  await expect(page.getByTestId('latest-bf')).toHaveText('16.5%'); // unit test: 16.47
  await expect(page.getByTestId('latest-bmi')).toHaveText('22.1'); // 22.14
  await expect(page.getByTestId('latest-whtr')).toHaveText('0.48'); // 0.478
  await expect(page.getByTestId('latest-whr')).toHaveText('0.89'); // 85 / 96
});

test('Month and Journey: backfilled weigh-ins since July give a trend and monthly averages', async ({ page }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  await page.getByTestId('nav-body').click();
  const lines: string[] = [];
  for (let i = 0; i < 104; i += 2) {
    const d = new Date(2026, 6, 1 + i);
    lines.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${(78 - i * 0.056).toFixed(1)}`);
  }
  await page.getByTestId('body-backfill-toggle').click(); // tucked away: a one-time job
  await page.getByTestId('backfill-text').fill(lines.join('\n'));
  await expect(page.getByTestId('backfill-save')).toHaveText('Add 52 weigh-ins');
  await page.getByTestId('backfill-save').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Backfilled 52 weigh-ins' })).toBeVisible();
  await page.goto('/progress?view=journey');
  await expect(page.getByTestId('journey-start')).toHaveText('78 kg');
  await expect(page.getByTestId('journey-change')).toContainText('−');
  await expect(page.getByTestId('journey-chart').locator('.recharts-line')).toBeVisible();
  for (const m of ['2026-07', '2026-08', '2026-09']) await expect(page.getByTestId(`journey-month-${m}`)).toBeVisible();
  await page.getByTestId('progress-view-month').click();
  await expect(page.getByTestId('month-avg-kcal')).not.toHaveText('0');
  await page.getByTestId('recap-request').click();
  await expect(page.getByTestId('recap-text')).toContainText('recap for Arjun');
});

test('Failure paths: error and timeout show Failed with Retry; signed out shows the banner', async ({ page, request }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  await fake(request, { mode: 'error' });
  await page.getByTestId('nav-add').click();
  await page.getByTestId('meal-note').fill('1 katori poha, chai');
  await page.getByTestId('meal-submit').click();
  await expect(page.getByTestId('review-failed')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('review-error')).toContainText('fake runner error');

  await fake(request, { mode: 'timeout' });
  await page.getByTestId('review-retry').click();
  await expect(page.getByTestId('review-error')).toContainText('Timed out', { timeout: 20_000 });

  await fake(request, { mode: 'ok' });
  await page.getByTestId('review-retry').click();
  await expect(page.getByTestId('items')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('review-confirm').click();

  await fake(request, { auth: { profileId: 'arjun', ok: false } });
  await page.reload();
  await expect(page.getByTestId('signin-banner')).toContainText('Arjun is signed out of Claude');
  await fake(request, { auth: { profileId: 'arjun', ok: true } });
});

test('Settings and export: new estimates use the household measures; CSV has rows', async ({ page }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  await page.goto('/settings');
  await page.getByTestId('settings-scope-household').click();
  await page.getByTestId('set-katori').fill('180');
  await page.getByTestId('set-roti').fill('40');
  await page.getByTestId('household-save').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'Household settings saved' })).toBeVisible();
  await page.getByTestId('nav-add').click();
  await page.getByTestId('meal-note').fill('1 roti, 1 katori toor dal, no ghee');
  await page.getByTestId('meal-submit').click();
  await expect(page.getByTestId('items')).toBeVisible();
  await expect(page.getByTestId('item-grams-0')).toHaveValue('40');
  await expect(page.getByTestId('item-grams-1')).toHaveValue('180');
  await page.getByTestId('review-confirm').click();

  await page.goto('/settings');
  const href = await page.getByTestId('export-meals').getAttribute('href');
  const csv = await (await page.request.get(href!)).text();
  const rows = csv.trim().split(/\r?\n/);
  expect(rows[0]).toMatch(/^date,time,slot,meal_id/);
  expect(rows.length).toBeGreaterThan(3);
  const body = await (await page.request.get((await page.getByTestId('export-body').getAttribute('href'))!)).text();
  expect(body.trim().split(/\r?\n/).length).toBeGreaterThan(50);
});

test('Profile PIN: another phone needs the PIN', async ({ page, browser }) => {
  await page.goto('/');
  await selectProfile(page, priya);
  await page.goto('/settings');
  await page.getByTestId('pin-new').fill('2468');
  await page.getByTestId('pin-set').click();
  await expect(page.getByTestId('toast').filter({ hasText: 'PIN set' })).toBeVisible();

  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 393, height: 852 } });
  const phone = await other.newPage();
  await phone.goto('/');
  await phone.getByTestId(`profile-chip-${priya}`).click();
  await expect(phone.getByTestId('pin-prompt')).toBeVisible();
  await phone.getByTestId('pin-input').fill('1111');
  await phone.getByTestId('pin-submit').click();
  await expect(phone.getByTestId('pin-error')).toHaveText('Wrong PIN');
  await phone.getByTestId('pin-input').fill('2468');
  await phone.getByTestId('pin-submit').click();
  await expect(phone.getByTestId('home-title')).toHaveText('Priya');
  await other.close();
});

test('Calibration and learned maintenance', async ({ page }) => {
  await page.goto('/');
  await selectProfile(page, 'arjun');
  await page.goto('/settings/calibration');
  await page.getByTestId('calibration-photo-input').setInputFiles(THALI);
  await page.getByTestId('calibration-note').fill('2 rotis, 1 katori dal, 1 tsp ghee');
  await page.getByTestId('calibration-true-kcal').fill('450');
  await page.getByTestId('calibration-add').click();
  await expect(page.getByTestId('calibration-within')).toHaveText('1 of 1', { timeout: 15_000 });

  await page.goto('/');
  await selectProfile(page, 'meera');
  await expect(page.getByTestId('card-suggestion')).toBeVisible();
  await page.getByTestId('suggestion-accept').click();
  await expect(page.getByTestId('card-suggestion')).toHaveCount(0);
});

test('Edit nutrition by hand: typed calories and macros replace the estimate, before and after confirming', async ({ page }) => {
  const n = (s: string) => Number(s.replace(/[^\d.]/g, ''));
  await page.goto('/');
  await selectProfile(page, 'arjun');
  const before = n(await page.getByTestId('today-kcal').innerText());
  await page.getByTestId('nav-add').click();
  await page.getByTestId('meal-note').fill('2 rotis, 1 katori dal');
  await page.getByTestId('meal-submit').click();
  await expect(page.getByTestId('items')).toBeVisible();
  const mealUrl = page.url();
  const oldKcal = n(await page.getByTestId('item-kcal-1').innerText());
  const oldProtein = await page.getByTestId('item-protein-1').innerText();
  const oldTotal = n(await page.getByTestId('review-total-kcal').innerText());

  await page.getByTestId('item-edit-1').click();
  // Bad values explain themselves and block Done.
  await page.getByTestId('edit-kcal').fill('');
  await expect(page.getByTestId('edit-kcal-error')).toHaveText('Enter a number (0 if none)');
  await expect(page.getByTestId('edit-save')).toBeDisabled();
  await page.getByTestId('edit-kcal').fill('-5');
  await expect(page.getByTestId('edit-kcal-error')).toHaveText("Can't be negative");
  await page.getByTestId('edit-kcal').fill('20001');
  await expect(page.getByTestId('edit-kcal-error')).toHaveText('Up to 20,000');
  // Cancel throws the typing away.
  await page.getByTestId('edit-cancel').click();
  await expect(page.getByTestId('item-kcal-1')).toHaveText(oldKcal.toLocaleString('en-US'));

  // 100 kcal more, same protein (the "AI said 500, it was 600" case).
  await page.getByTestId('item-edit-1').click();
  await page.getByTestId('edit-kcal').fill(String(oldKcal + 100));
  await expect(page.getByTestId('edit-meal-total')).toContainText(`${(oldTotal + 100).toLocaleString('en-US')} kcal`);
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('item-kcal-1')).toHaveText((oldKcal + 100).toLocaleString('en-US'));
  await expect(page.getByTestId('item-protein-1')).toHaveText(oldProtein);
  await expect(page.getByTestId('item-1')).toContainText('Manual');
  await expect(page.getByTestId('review-total-kcal')).toHaveText(`${(oldTotal + 100).toLocaleString('en-US')} kcal`);
  await expect(page.getByTestId('review-unsaved')).toBeVisible();
  // Grams now rescale from the typed numbers.
  const grams = Number(await page.getByTestId('item-grams-1').inputValue());
  await page.getByTestId('item-grams-1').fill(String(grams / 2));
  await expect(page.getByTestId('item-kcal-1')).toHaveText(Math.round((oldKcal + 100) / 2).toLocaleString('en-US'));
  await page.getByTestId('item-grams-1').fill(String(grams));
  await page.getByTestId('review-confirm').click();
  await expect(page.getByTestId('today-kcal')).toHaveText((before + oldTotal + 100).toLocaleString('en-US'));

  // After confirming: Save changes waits for a change, then stores it.
  await page.goto(mealUrl);
  await expect(page.getByTestId('review-confirm')).toHaveText('Save changes');
  await expect(page.getByTestId('review-confirm')).toBeDisabled();
  await page.getByTestId('item-macros-1').click(); // the numbers open the editor too
  await page.getByTestId('edit-protein').fill('20');
  await page.getByTestId('edit-save').click();
  await expect(page.getByTestId('review-confirm')).toBeEnabled();
  await page.getByTestId('review-confirm').click();
  await expect(page.getByTestId('today-kcal')).toBeVisible();
  const meal = await (await page.request.get(`/api/profiles/arjun/meals/${mealUrl.split('/').pop()}`)).json();
  expect(meal.items[1]).toMatchObject({ kcal: oldKcal + 100, protein_g: 20, source: 'manual', confidence: 'high', myFoodId: null });
});
