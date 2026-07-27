#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
//
// Screenshot the wui-ampere page served by the standalone harness (no WinCC OA):
//   node shoot.mjs [--url http://127.0.0.1:4310] [--out ./out]
// Captures: ampere.png (overview), ampere-detail.png (HTA/BT substation),
// ampere-railway.png (2x25 kV railway demo).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL_BASE = arg('url', 'http://127.0.0.1:4310');
const OUT = path.resolve(arg('out', './out'));
mkdirSync(OUT, { recursive: true });

const EXEC = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';
const SHOTS = [
  { name: 'ampere.png', query: '', wait: 6000 },
  // embed=1 -> the page's own chromeless fitted rendering (same contract as mosaic tiles)
  { name: 'ampere-detail.png', query: '?embed=1&network=demo-poste-htabt', wait: 6000 },
  { name: 'ampere-railway.png', query: '?embed=1&network=demo-ferro-2x25kv', wait: 6000 }
];

const browser = await chromium.launch({
  headless: true,
  executablePath: EXEC,
  args: ['--use-gl=swiftshader', '--disable-dev-shm-usage']
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 200));
});
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 300)));

for (const shot of SHOTS) {
  const url = `${URL_BASE}/${shot.query}`;
  console.log(`• ${shot.name} ← ${url}`);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(shot.wait);
  // hide the harness-only offline notice (with a real backend it never shows)
  await page.evaluate(() => {
    document
      .querySelector('wui-ampere')
      ?.shadowRoot?.querySelectorAll('.notice')
      .forEach((n) => n.remove());
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, shot.name) });
}
await browser.close();
console.log(`✓ done → ${OUT}`);
