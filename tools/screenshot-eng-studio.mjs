#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Screenshot the Engineering Studio's three panels from its OFFLINE demo — no
// WinCC OA runtime, no login, no live backend. The demo (libs/wui-eng-studio/
// demo) runs the page with the in-memory DemoEngGateway; this tool drives it
// with Playwright (Chromium is preinstalled in the environment) and writes one
// PNG per panel to docs/images/eng-studio/.
//
//   node tools/screenshot-eng-studio.mjs [--dev-url <url>] [--out <dir>]
//                                        [--width 1600] [--height 1000]
//
// If --dev-url is not reachable it starts the demo Vite server itself
// (needs `npm install` done in libs/wui-eng-studio/demo) and stops it after.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DEMO_DIR = resolve(REPO, 'libs/wui-eng-studio/demo');

// Playwright is installed in the demo harness (which also runs the demo dev
// server). Resolve it from there so this tool needs no root node_modules.
const demoRequire = createRequire(pathToFileURL(resolve(DEMO_DIR, 'package.json')));
const pw = await import(pathToFileURL(demoRequire.resolve('playwright')));
const chromium = pw.chromium ?? pw.default?.chromium;

/**
 * The environment ships a preinstalled Chromium under $PLAYWRIGHT_BROWSERS_PATH
 * (a different build than the npm `playwright` pins), so point launch() at it
 * instead of downloading. Falls back to Playwright's own resolution.
 */
function findChromium() {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  try {
    for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
      const exe = resolve(base, dir, 'chrome-linux/chrome');
      if (existsSync(exe)) return exe;
    }
  } catch {
    /* fall through to Playwright's default */
  }
  return undefined;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const OUT = resolve(REPO, arg('out', 'docs/images/eng-studio'));
const WIDTH = Number(arg('width', '1600'));
const HEIGHT = Number(arg('height', '1000'));
let devUrl = arg('dev-url', 'http://127.0.0.1:4310');

const PANELS = [
  { id: 'devices', file: '01-devices.png', desc: 'Équipements + carnet d’adresses' },
  { id: 'model', file: '02-model.png', desc: 'Modèle : carnet + grille de signaux' },
  { id: 'control', file: '03-control.png', desc: 'Contrôle : diff + check-in (dry-run)' }
];

// Extra Devices-panel shots that showcase the many-to-many device↔book relation.
const DEVICE_SHOTS = [
  { device: 'ligne-embouteillage', file: '04-book-aggregation.png', desc: 'Agrégation : 2 interfaces OPC UA + PackML sur un équipement' },
  { device: 'z01-pompe1', file: '05-book-mutualisation.png', desc: 'Mutualisation : un carnet catalogue partagé entre équipements' },
  { device: 'pac-depart1', file: '06-book-pac3200.png', desc: 'PAC3200 : catalogue de registres Modbus mutualisé' },
  { device: 'ligne-encaisseuse', file: '07-book-packml.png', desc: 'PackML : interface OPC UA standard mutualisée' },
  { device: 'm580-station', file: '08-book-schneider-m580.png', desc: 'Schneider M580 : carnet depuis un export de variables Control Expert' },
  {
    device: 'm580-station',
    book: 'book-m580-pesage-xvm',
    file: '09-book-schneider-xvm.png',
    desc: 'Schneider XVM : second générateur (XML) sur le même équipement'
  },
  {
    device: 'm580-station',
    book: 'book-m580-station',
    file: '10-roles-qualification.png',
    desc: 'Qualification : rôles déduits par règles + affectation en masse'
  },
  {
    device: 'pac-depart1',
    role: 'counter',
    file: '11-roles-pac3200.png',
    desc: 'Qualification automatique du PAC3200 : les compteurs d’énergie isolés parmi 45 signaux'
  }
];

// The generation scenario: fill the Model panel's form from the S7 book and
// generate, then capture the Model panel and the resulting check-in diff.
const GENERATION_SHOTS = [
  { file: '12-model-generation.png', panel: 'model', desc: 'Génération du modèle depuis le carnet (rôles → configs)' },
  { file: '13-control-generated.png', panel: 'control', desc: 'Diff de check-in issu de la génération' }
];

async function reachable(url) {
  try {
    const res = await fetch(url, { method: 'GET' });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

async function waitFor(url, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await reachable(url)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { cwd: DEMO_DIR, stdio: 'inherit' });
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${cmd} ${args.join(' ')} → exit ${code}`))));
    child.on('error', reject);
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  let server = null;
  if (!(await reachable(devUrl))) {
    // Build once, then serve the STATIC bundle with `vite preview`: no dev-server
    // tsconfig scan (the lib tsconfigs extend the runtime workspace's base, absent
    // here) and no HMR websocket (so Playwright's networkidle settles).
    const viteBin = resolve(DEMO_DIR, 'node_modules/.bin/vite');
    console.log('[eng-shots] building demo bundle…');
    await run(viteBin, ['build']);
    console.log('[eng-shots] starting vite preview…');
    server = spawn(viteBin, ['preview', '--port', '4310', '--strictPort', '--host', '127.0.0.1'], {
      cwd: DEMO_DIR,
      stdio: 'inherit'
    });
    devUrl = 'http://127.0.0.1:4310';
    if (!(await waitFor(devUrl, 60000))) {
      server.kill('SIGTERM');
      throw new Error('demo preview server did not come up on ' + devUrl);
    }
  }

  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox', '--force-color-profile=srgb']
  });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 });
  try {
    for (const panel of PANELS) {
      await page.goto(`${devUrl}/?panel=${panel.id}`, { waitUntil: 'load' });
      await page.waitForSelector('wui-eng-studio');
      // Let the element boot its demo data + Lit render.
      await page.waitForTimeout(600);
      // For the control panel, trigger a dry-run so the report shows too.
      if (panel.id === 'control') {
        await page.evaluate(() => {
          const app = document.querySelector('wui-eng-studio');
          app?.shadowRoot?.querySelectorAll('button.btn').forEach((b) => {
            if (b.textContent && b.textContent.includes('dry-run')) b.click();
          });
        });
        await page.waitForTimeout(500);
      }
      const file = resolve(OUT, panel.file);
      await page.screenshot({ path: file });
      console.log(`[eng-shots] ${panel.file} — ${panel.desc}`);
    }

    // Device-specific Devices-panel shots (many-to-many showcase).
    for (const shot of DEVICE_SHOTS) {
      await page.goto(`${devUrl}/?panel=devices`, { waitUntil: 'load' });
      await page.waitForSelector('wui-eng-studio');
      await page.waitForTimeout(500);
      await page.evaluate((id) => {
        document.querySelector('wui-eng-studio')?.selectDeviceById(id);
      }, shot.device);
      await page.waitForTimeout(400);
      if (shot.book) {
        await page.evaluate((id) => {
          document.querySelector('wui-eng-studio')?.selectBookById(id);
        }, shot.book);
        await page.waitForTimeout(300);
      }
      if (shot.role) {
        await page.evaluate((role) => {
          document.querySelector('wui-eng-studio')?.filterByRole(role);
        }, shot.role);
        await page.waitForTimeout(300);
      }
      const file = resolve(OUT, shot.file);
      await page.screenshot({ path: file });
      console.log(`[eng-shots] ${shot.file} — ${shot.desc}`);
    }

    // Online OPC UA browse scenario, captured on the demo's FAKE server:
    //   1. the book produced by the real core walker (level-by-level, warnings);
    //   2. the same book RE-BROWSED after the machine's program drifted → the
    //      delta (added / removed / changed) that makes a refresh worth doing.
    await page.goto(`${devUrl}/?panel=devices`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const app = document.querySelector('wui-eng-studio');
      app?.selectDeviceById('ligne-embouteillage');
      app?.selectBookById('book-opcua-remplisseuse');
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT, '14-browse-online.png') });
    console.log('[eng-shots] 14-browse-online.png — Carnet issu d’un parcours OPC UA en ligne');
    await page.evaluate(async () => {
      await document.querySelector('wui-eng-studio')?.refreshForDemo();
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(OUT, '15-browse-refresh-delta.png') });
    console.log('[eng-shots] 15-browse-refresh-delta.png — Re-parcours : delta ajoutés / disparus / modifiés');

    // Custom structure + mapping: a house-standard type authored as an outline and
    // auto-mapped onto the S7 book, whose paths are nested and named differently.
    await page.goto(`${devUrl}/?panel=model`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const app = document.querySelector('wui-eng-studio');
      app?.selectDeviceById('s7-four1');
      app?.customStructureForDemo(
        'STD_Four',
        ['STD_Four', '  PV', '    Temperature : Float', '    Hygrometrie : Float', '  SP', '    Temperature : Float', '    Rampe : Float', '  Etat', '    EnChauffe : Bool', '    PorteOuverte : Bool', '  Moteur', '    Marche : Bool', '    Defaut : Bool', '    Vitesse : Float'].join('\n')
      );
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(OUT, '16-custom-structure-mapping.png') });
    console.log('[eng-shots] 16-custom-structure-mapping.png — Structure personnalisée + mapping des signaux');

    // Generation scenario: qualify → generate → diff, captured end to end.
    await page.goto(`${devUrl}/?panel=model`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const app = document.querySelector('wui-eng-studio');
      app?.selectDeviceById('s7-four1');
      app?.generateForDemo('Equip_Four_Gen', 'Z04', 'FOUR010, FOUR011');
    });
    await page.waitForTimeout(700);
    for (const shot of GENERATION_SHOTS) {
      await page.evaluate((panel) => {
        const app = document.querySelector('wui-eng-studio');
        if (app) app.panel = panel;
      }, shot.panel);
      await page.waitForTimeout(400);
      const file = resolve(OUT, shot.file);
      await page.screenshot({ path: file });
      console.log(`[eng-shots] ${shot.file} — ${shot.desc}`);
    }
  } finally {
    await browser.close();
    if (server) server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
