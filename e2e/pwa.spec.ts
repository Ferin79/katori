// Home-screen app: installable on iPhone through Safari's Share → Add to Home Screen.
import { expect, test } from '@playwright/test';

test('manifest, icons and iPhone tags make it installable', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(href!);
  expect(res.headers()['content-type']).toContain('application/manifest+json');
  const m = await res.json();
  expect(m).toMatchObject({ name: 'Katori', display: 'standalone', start_url: '/', scope: '/' });
  expect(m.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  for (const icon of m.icons as { src: string }[]) expect((await request.get(icon.src)).ok(), icon.src).toBeTruthy();

  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Katori');
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect((await request.get(touchIcon!)).headers()['content-type']).toBe('image/png');

  // The shell is revalidated so a home-screen app picks up new versions; bundles are immutable.
  expect((await request.get('/')).headers()['cache-control']).toBe('no-cache');
  const bundle = await page.locator('script[type="module"][src*="/assets/"]').getAttribute('src');
  expect((await request.get(bundle!)).headers()['cache-control']).toContain('immutable');
});

test('in iPhone Safari, Home explains Add to Home Screen; "Not now" sticks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('install-hint')).toBeVisible();
  await expect(page.getByTestId('install-steps')).toContainText('Add to Home Screen');
  await page.screenshot({ path: 'test-results/screens/32-install-hint.png' });
  await page.getByTestId('install-hint-dismiss').click();
  await expect(page.getByTestId('install-hint')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('home-title')).toBeVisible();
  await expect(page.getByTestId('install-hint')).toHaveCount(0);
});

test('launched from the Home Screen: no hint, and Settings says installed', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  await page.goto('/');
  await expect(page.getByTestId('home-title')).toBeVisible();
  await expect(page.getByTestId('install-hint')).toHaveCount(0);
  await page.goto('/settings');
  await expect(page.getByTestId('settings-app')).toContainText('Installed: running from the Home Screen');
  await expect(page.getByTestId('app-reload')).toBeVisible();
});

test('a new version on the server shows a Reload banner', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('home-title')).toBeVisible();
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
  // From now on the server lists a different bundle than the one this page is running.
  await page.route(
    (url) => url.pathname === '/',
    async (route) => {
      if (route.request().resourceType() !== 'fetch') return route.continue();
      const res = await route.fetch();
      const body = (await res.text()).replace(/\/assets\/index-[^"]+\.js/, '/assets/index-NEWBUILD.js');
      return route.fulfill({ response: res, body });
    },
  );
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // back to the app
  await expect(page.getByTestId('update-banner')).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/33-update-banner.png' });
});
