#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Screenshot every standalone page (libs/wui-*) of the WebUI dashboard, logged in
// against a live WinCC OA backend, by driving the Vite dev server with Playwright.
//
//   WUI_USER=<user> WUI_PASS=<pass> BASE_URL=https://<oa-host>:<httpsPort> \
//     node tools/screenshot-pages.mjs [options]
//
//   --dev-url <url>   running dev server (default http://127.0.0.1:4300). If it is
//                     not reachable, the tool starts `npm start` itself (needs
//                     BASE_URL) and stops it again when done.
//   --out <dir>       output directory (default docs/images/manual)
//   --headless        run headless (default: headed — some pages need real WebGL)
//   --only <ids>      comma-separated page ids to capture (default: all discovered)
//   --width / --height  viewport (default 1600 x 1000)
//   --demo            log in WITH write permission, click each page's "generate/
//                     load demonstration" control to populate it, and drill into the
//                     first detail sub-page (captured as <id>-detail.png). WRITES demo
//                     data to the backend (orders, templates, assets, …).
//
// WHY THIS SHAPE (learned the hard way):
//   * The pages need LIVE data, so we run them on the Vite dev server, which
//     proxies /api, /WebUI_*, login and the data WebSocket to BASE_URL. Playwright
//     pointed straight at the deployed https host fails: its WebSocket
//     (wss://<host>/websocket from /WebUI_Settings) and the Basic-auth token flow
//     don't survive automation. The dev server sidesteps both.
//   * Auth is HTTP Basic on GET /WebUI_Token. The app does NOT put the credentials
//     on that request, so a 401 stalls login. We intercept the request and inject
//     `Authorization: Basic <user:pass>` — then the JWT comes back and the socket
//     connects. Credentials come from WUI_USER / WUI_PASS only (never hardcode).
//   * Self-signed certs everywhere → ignoreHTTPSErrors + --ignore-certificate-errors.
//   * The "Emergency Mode / Memory full" banner and toasts are <wui-message> /
//     <ix-toast> system overlays (in shadow DOM); we strip them before each shot.
//
// Routes are discovered from each libs/wui-<page>/menu.fragment.jsonc (the same
// source the dev menu merge uses), so new pages are picked up automatically.
// -----------------------------------------------------------------------------
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

/** Minimal JSONC → JSON: drop block and line comments (menu fragments use these). */
const stripJsonComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"])\/\/.*$/gm, '$1');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const DEV_URL = arg('dev-url', 'http://127.0.0.1:4300').replace(/\/$/, '');
const OUT = path.resolve(repoRoot, arg('out', 'docs/images/manual'));
const HEADLESS = flag('headless');
const WIDTH = Number(arg('width', '1600'));
const HEIGHT = Number(arg('height', '1000'));
const ONLY = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const USER = process.env.WUI_USER;
const PASS = process.env.WUI_PASS;
if (!USER || !PASS) {
  console.error('✗ Set WUI_USER and WUI_PASS (the dashboard login). Never hardcode credentials.');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');

// Pages that need extra settle time (3D / charts render lazily after data loads).
const WAIT_OVERRIDES = { 'fleet-3d': 9000, 'fleet-kpi': 6500, 'fleet-stops': 6500, 'production-orders': 6500, 'asset-lifecycle': 6500 };
const DEFAULT_WAIT = 5000;

// --demo: log in with write permission, click any "generate/load demonstration"
// control to populate the page, then drill into the first detail sub-page.
const DEMO = flag('demo');
// Generators are labelled "… démonstration" (FR) / "generate … demo"; the fleet
// analyses load by clicking the "Atelier de démonstration" selector — all matched here.
const DEMO_RE = /d[ée]monstrat|generate|sample|seed/i;
// Pages whose first list item opens a detail sub-page (captured <id>-detail.png),
// and how to open it: an ix-card (Fleet-3D atelier) or the first table row.
const DETAILS = { 'fleet-3d': 'card', mosaic: 'row', 'camera-streams': 'row', 'remote-vnc': 'row', 'report-builder': 'row' };
const hashDepth = (url) => (url.split('#')[1] || '').split('?')[0].split('/').filter(Boolean).length;

// (run in-page) click the first button matching `pat`; returns its text or null.
const CLICK_BTN = (pat) => {
  const re = new RegExp(pat, 'i');
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      const tag = el.tagName.toLowerCase();
      if (tag === 'button' || tag === 'ix-button') {
        const t = (el.textContent || '').trim();
        if (t && re.test(t) && el.offsetParent !== null) { el.click(); return t; }
      }
      if (el.shadowRoot) { const r = walk(el.shadowRoot); if (r) return r; }
    }
    return null;
  };
  return walk(document);
};
// (run in-page) open the first detail item: an ix-card, or the first table data row.
const OPEN_DETAIL = (kind) => {
  const find = (root, fn) => {
    for (const el of root.querySelectorAll('*')) {
      if (fn(el)) return el;
      if (el.shadowRoot) { const r = find(el.shadowRoot, fn); if (r) return r; }
    }
    return null;
  };
  const target = kind === 'card'
    ? find(document, (e) => e.tagName.toLowerCase() === 'ix-card')
    : find(document, (e) => {
        const g = e.tagName.toLowerCase();
        if (g === 'tr' && e.querySelector('td')) return true;
        if (g === 'ix-row') return true;
        return e.getAttribute && e.getAttribute('role') === 'row' && !e.querySelector('th') && !!e.querySelector('td,[role="cell"],[role="gridcell"]');
      });
  if (target) { target.click(); return true; }
  return false;
};

/** Discover page routes from each libs/wui-PAGE/menu.fragment.jsonc (+ the shell dashboard). */
function discoverPages() {
  const pages = [{ id: 'dashboard', route: '/dashboard', title: 'Dashboard' }];
  const libsDir = path.join(repoRoot, 'libs');
  const seen = new Set(['dashboard']);
  if (!existsSync(libsDir)) return pages;
  for (const dirent of readdirSync(libsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !dirent.name.startsWith('wui-')) continue;
    const frag = path.join(libsDir, dirent.name, 'menu.fragment.jsonc');
    if (!existsSync(frag)) continue;
    let entries;
    try {
      entries = JSON.parse(stripJsonComments(readFileSync(frag, 'utf8')));
    } catch (error) {
      console.warn(`  ! skipped ${dirent.name}/menu.fragment.jsonc: ${error.message}`);
      continue;
    }
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const route = e.path;
      // Skip redirects/generators (no concrete path) and parameterised detail routes.
      if (!route || route === '' || route.includes(':') || e.redirect || e.generator) continue;
      const id = e.routeId || route.replace(/^\//, '').replace(/\//g, '-');
      if (seen.has(id)) continue;
      seen.add(id);
      const title = (e.title && (e.title.en_US || e.title['en_US.utf8'])) || id;
      pages.push({ id, route, title });
    }
  }
  return pages;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reachable(url) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    await fetch(url, { signal: c.signal });
    clearTimeout(t);
    return true;
  } catch {
    return false;
  }
}

/** Start `npm start` (Vite) if the dev server is not already up. Returns the child or null. */
async function ensureDevServer() {
  if (await reachable(DEV_URL + '/')) {
    console.log(`• dev server already running at ${DEV_URL}`);
    return null;
  }
  if (!process.env.BASE_URL) {
    console.error(`✗ ${DEV_URL} is not reachable and BASE_URL is unset.\n  Start it first:  BASE_URL=https://<oa-host>:<httpsPort> npm start\n  (or pass --dev-url to an already-running server).`);
    process.exit(1);
  }
  console.log(`• starting dev server (BASE_URL=${process.env.BASE_URL}) …`);
  const child = spawn('npm', ['run', 'start'], { cwd: repoRoot, env: process.env, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    if (await reachable(DEV_URL + '/')) {
      console.log(`• dev server ready (after ~${(i + 1) * 2}s)`);
      return child;
    }
  }
  stopServer(child);
  console.error('✗ dev server did not become ready in time.');
  process.exit(1);
}

function stopServer(child) {
  if (!child) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
    else process.kill(-child.pid);
  } catch {
    /* already gone */
  }
}

// Remove transient system overlays (toasts + the wui-message status banner) from
// every (open) shadow root, so they don't cover the page in the screenshot.
const STRIP_OVERLAYS = () => {
  let removed = 0;
  const OVERLAY = new Set(['wui-message', 'ix-toast', 'ix-toast-container']);
  const walk = (root) => {
    for (const el of root.querySelectorAll('*')) {
      if (OVERLAY.has(el.tagName.toLowerCase())) { el.remove(); removed++; continue; }
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(document);
  return removed;
};

async function main() {
  const pages = discoverPages().filter((p) => ONLY.length === 0 || ONLY.includes(p.id));
  console.log(`Screenshotting ${pages.length} page(s) → ${OUT}`);
  mkdirSync(OUT, { recursive: true });

  const server = await ensureDevServer();
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: ['--ignore-certificate-errors', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: WIDTH, height: HEIGHT } });
  const page = await context.newPage();
  // The app omits the Basic header on GET /WebUI_Token; inject it so login completes.
  await page.route('**/WebUI_Token*', (route) =>
    route.continue({ headers: { ...route.request().headers(), authorization: AUTH } })
  );

  const captured = [];
  try {
    await page.goto(DEV_URL + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(5000);

    // login (with write permission when generating demo data)
    await page.locator('input[type="text"]').first().pressSequentially(USER, { delay: 20 });
    await page.locator('input[type="password"]').first().pressSequentially(PASS, { delay: 20 });
    if (DEMO) {
      await page.getByText('Login with write permissions').click({ timeout: 4000 }).catch(() => {});
      await sleep(300);
    }
    await page
      .locator('ix-button')
      .filter({ hasText: 'Login' })
      .first()
      .click({ timeout: 8000 })
      .catch(() => page.locator('input[type="password"]').first().press('Enter'));

    let loggedIn = false;
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      if (!page.url().includes('/login')) { loggedIn = true; break; }
    }
    if (!loggedIn) throw new Error('login did not complete (still on /login) — check WUI_USER/WUI_PASS and the backend connection.');
    console.log('✓ logged in');
    await sleep(7000); // let the connection settle + initial toasts auto-dismiss

    for (const p of pages) {
      await page.evaluate((r) => { globalThis.location.hash = r; }, '#' + p.route);
      await sleep(WAIT_OVERRIDES[p.id] ?? DEFAULT_WAIT);
      await page.evaluate(STRIP_OVERLAYS);

      // Populate the page with demonstration data (or load the demo atelier).
      if (DEMO) {
        const clicked = await page.evaluate(CLICK_BTN, DEMO_RE.source);
        if (clicked) {
          console.log(`    demo: "${clicked}"`);
          await sleep(p.id === 'fleet-kpi' || p.id === 'fleet-stops' ? 7000 : 5500);
          await page.evaluate(STRIP_OVERLAYS);
        }
      }

      await sleep(300);
      await page.evaluate(STRIP_OVERLAYS);
      await page.screenshot({ path: path.join(OUT, `${p.id}.png`) });
      captured.push(p);
      console.log(`  ✓ ${p.id.padEnd(20)} ${p.route}`);

      // Drill into the first detail sub-page, captured as <id>-detail.png.
      if (DEMO && DETAILS[p.id]) {
        const before = hashDepth(page.url());
        const opened = await page.evaluate(OPEN_DETAIL, DETAILS[p.id]);
        await sleep(p.id === 'fleet-3d' ? 9000 : 5500);
        if (opened && hashDepth(page.url()) > before) {
          await page.evaluate(STRIP_OVERLAYS);
          await sleep(300);
          await page.evaluate(STRIP_OVERLAYS);
          await page.screenshot({ path: path.join(OUT, `${p.id}-detail.png`) });
          captured.push({ id: `${p.id}-detail`, route: page.url().split('#')[1] || '' });
          console.log(`  ✓ ${`${p.id}-detail`.padEnd(20)} ${page.url().split('#')[1] || ''}`);
        } else {
          console.log(`    (no detail captured for ${p.id})`);
        }
      }
    }
  } finally {
    await browser.close();
    stopServer(server);
  }

  console.log(`\nDone — ${captured.length} screenshot(s) in ${OUT}`);
}

main().catch((error) => {
  console.error('\n✗ ' + (error?.message || error));
  process.exit(1);
});
