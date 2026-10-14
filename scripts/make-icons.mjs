#!/usr/bin/env node
// Renders apps/web/public/icon.svg to the PNGs a home-screen shortcut needs.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const pub = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public');
const svg = readFileSync(path.join(pub, 'icon.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [file, size, rounded] of [
  ['apple-touch-icon.png', 180, false], // iOS rounds the corners itself
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
]) {
  await page.setViewportSize({ width: size, height: size });
  const art = rounded ? svg : svg.replace('rx="112"', 'rx="0"');
  await page.setContent(`<html><body style="margin:0;background:transparent">${art.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(pub, file), omitBackground: true });
  console.log(`wrote ${file}`);
}

// Maskable: a full-bleed square with the artwork inside the central 80% safe zone, so Android
// can crop it to a circle or squircle without cutting the bowl.
{
  const size = 512;
  await page.setViewportSize({ width: size, height: size });
  const inner = svg.replace('<svg ', `<svg width="${size * 0.8}" height="${size * 0.8}" `).replace('rx="112"', 'rx="0"');
  await page.setContent(
    `<html><body style="margin:0"><div id="m" style="width:${size}px;height:${size}px;background:#7b5cf5;display:grid;place-items:center">${inner}</div></body></html>`,
  );
  await page.locator('#m').screenshot({ path: path.join(pub, 'icon-maskable-512.png') });
  console.log('wrote icon-maskable-512.png');
}
await browser.close();
