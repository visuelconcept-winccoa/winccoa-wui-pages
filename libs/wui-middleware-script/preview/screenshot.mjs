#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Capture the documentation screenshots of the Middleware-Script page from the
// WinCC-OA-free preview (run `node build.mjs` first, or use `npm run shots`):
//
//   middleware-script.png        Script tab, first demo task selected
//   middleware-script-test.png   Test tab after a dry-run (outputs + logs)
//   middleware-script-model.png  reusable-model editor (declared IO/params)
//
// Written into ../../../docs/images/manual/ (override with --out <dir>).
// Chromium: playwright-core + PW_CHROMIUM env or the Playwright default
// install (falls back to /opt/pw-browsers/chromium).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const outDir = args.includes('--out')
  ? path.resolve(args[args.indexOf('--out') + 1])
  : path.resolve(here, '../../../docs/images/manual');
const executablePath = process.env.PW_CHROMIUM ?? '/opt/pw-browsers/chromium';

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.png': 'image/png'
};

/** Tiny static server rooted at the preview directory (node_modules included). */
function serveStatic() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]);
    let file = path.join(here, urlPath === '/' ? 'index.html' : urlPath);
    if (!file.startsWith(here) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const { server, port } = await serveStatic();
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb']
});
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
  // The floating light/dark toggle is a preview-only helper — keep it out of
  // the documentation captures.
  await page.addStyleTag({ content: '#theme-toggle { display: none !important; }' });

  // Playwright CSS selectors pierce shadow DOM. Select the first demo task and
  // let the Stencil components settle.
  await page.locator('wui-ms-task-list button.row').first().click();
  await page.waitForSelector('wui-ms-script-editor .cm-editor');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'middleware-script.png') });
  console.log(`✓ ${path.join(outDir, 'middleware-script.png')}`);

  // Test tab: load the simulated live values, dry-run, capture the result.
  await page.locator('wui-ms-editor ix-tab-item').nth(2).click();
  await page.waitForSelector('wui-ms-test-panel');
  const buttons = page.locator('wui-ms-test-panel ix-button');
  await buttons.nth(0).click(); // "Charger les valeurs live"
  await page.waitForTimeout(300);
  await buttons.nth(1).click(); // "Lancer le test"
  await page.waitForSelector('wui-ms-test-panel .result');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'middleware-script-test.png') });
  console.log(`✓ ${path.join(outDir, 'middleware-script-test.png')}`);

  // Models mode: open the demo reusable model (declared aliases + parameters).
  await page.locator('wui-ms-task-list .mode button').nth(1).click();
  await page.locator('wui-ms-task-list button.row').first().click();
  await page.waitForSelector('wui-ms-model-editor wui-ms-script-editor .cm-editor');
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'middleware-script-model.png') });
  console.log(`✓ ${path.join(outDir, 'middleware-script-model.png')}`);
} finally {
  await browser.close();
  server.close();
}
