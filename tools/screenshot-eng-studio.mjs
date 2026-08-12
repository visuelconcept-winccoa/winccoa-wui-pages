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

// Playwright and Vite come from the demo harness when it has its own install, and
// from the workspace root otherwise — the demo's page sources already resolve
// `@siemens/ix` and `@wincc-oa/*` from the root, so a root-only checkout must work.
const demoRequire = createRequire(pathToFileURL(resolve(DEMO_DIR, 'package.json')));
const rootRequire = createRequire(pathToFileURL(resolve(REPO, 'package.json')));

/** Resolve a package from the demo install first, then from the workspace root. */
function resolveFrom(specifier) {
  for (const from of [demoRequire, rootRequire]) {
    try {
      return from.resolve(specifier);
    } catch {
      continue;
    }
  }
  throw new Error(`${specifier} not found — run npm install at the repo root or in libs/wui-eng-studio/demo`);
}

const pw = await import(pathToFileURL(resolveFrom('playwright')));
const chromium = pw.chromium ?? pw.default?.chromium;

/**
 * The `vite` CLI of whichever install provided it. On Windows the extension-less
 * `.bin/vite` is a shell script `spawn` cannot execute, so the `.cmd` shim wins.
 */
function viteBin() {
  const names = process.platform === 'win32' ? ['vite.cmd', 'vite'] : ['vite'];
  for (const dir of [DEMO_DIR, REPO]) {
    for (const name of names) {
      const bin = resolve(dir, 'node_modules/.bin', name);
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('vite not found — run npm install at the repo root or in libs/wui-eng-studio/demo');
}

/**
 * An ALREADY-INSTALLED Chromium, whatever build it is.
 *
 * Both the CI image and a developer machine usually have one whose build number
 * differs from the one the npm `playwright` pins — and Playwright then refuses to
 * launch rather than using it. So look for any `chromium-*` in the browser cache and
 * point `launch()` at it; falling through to Playwright's own resolution (and its
 * "run npx playwright install" message) only when there is nothing to find.
 */
function findChromium() {
  if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) return process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  const bases = [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers'];
  // Playwright's default cache, per platform.
  if (process.env.LOCALAPPDATA) bases.push(resolve(process.env.LOCALAPPDATA, 'ms-playwright'));
  if (process.env.HOME) bases.push(resolve(process.env.HOME, '.cache/ms-playwright'));
  const relative = ['chrome-linux/chrome', 'chrome-win64/chrome.exe', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'];
  for (const base of bases.filter(Boolean)) {
    try {
      for (const dir of readdirSync(base).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
        for (const exe of relative.map((r) => resolve(base, dir, r))) {
          if (existsSync(exe)) return exe;
        }
      }
    } catch {
      continue;
    }
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
/**
 * UI language of the captured screenshots. English by default so the shots match
 * the English documentation; `--lang fr|de` re-captures the same set in another
 * language (see `LOCALE_SHOTS` for the pair kept in the docs).
 */
const LANG = arg('lang', 'en');

const PANELS = [
  { id: 'devices', file: '01-devices.png', desc: 'Devices + address book' },
  { id: 'model', file: '02-model.png', desc: 'Model: book + signal grid' },
  { id: 'control', file: '03-control.png', desc: 'Control: diff + check-in (dry-run)' },
  // Appended rather than renumbered: 01..20 are referenced by name throughout the
  // docs, and renumbering them would silently break every one of those links.
  { id: 'books', file: '21-books.png', desc: 'Catalogues: every address book, with its users' }
];

// Extra Devices-panel shots that showcase the many-to-many device↔book relation.
const DEVICE_SHOTS = [
  { device: 'ligne-embouteillage', file: '04-book-aggregation.png', desc: 'Aggregation: two OPC UA interfaces + PackML on one device' },
  { device: 'z01-pompe1', file: '05-book-mutualisation.png', desc: 'Sharing: one catalog book across devices' },
  { device: 'pac-depart1', file: '06-book-pac3200.png', desc: 'PAC3200: shared Modbus register catalog' },
  { device: 'ligne-encaisseuse', file: '07-book-packml.png', desc: 'PackML: shared standard OPC UA interface' },
  { device: 'm580-station', file: '08-book-schneider-m580.png', desc: 'Schneider M580: book from a Control Expert variables export' },
  {
    device: 'm580-station',
    book: 'book-m580-pesage-xvm',
    file: '09-book-schneider-xvm.png',
    desc: 'Schneider XVM: a second generator (XML) on the same device'
  },
  {
    device: 'm580-station',
    book: 'book-m580-station',
    file: '10-roles-qualification.png',
    desc: 'Qualification: rule-derived roles + bulk assignment'
  },
  {
    device: 'pac-depart1',
    role: 'counter',
    file: '11-roles-pac3200.png',
    desc: 'PAC3200 auto-qualification: the energy counters isolated among 45 signals'
  }
];

// The generation scenario: fill the Model panel's form from the S7 book and
// generate, then capture the Model panel and the resulting check-in diff.
/**
 * A minimal but REPRESENTATIVE NodeSet2 for the import-preview shot: a `ProbeType`
 * whose instance declaration is a typed sub-object, plus two instances (`P01`, `P02`)
 * that each carry their own `AcquisitionConfig.SampleRate`. Only the topmost instances
 * are walked, so the preview must show exactly two signals with distinct paths.
 */
const NODESET_SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<UANodeSet xmlns="http://opcfoundation.org/UA/2011/03/UANodeSet.xsd">
  <NamespaceUris><Uri>http://example.org/Probe/</Uri></NamespaceUris>
  <Aliases>
    <Alias Alias="Double">i=11</Alias>
    <Alias Alias="HasComponent">i=47</Alias>
    <Alias Alias="HasTypeDefinition">i=40</Alias>
    <Alias Alias="HasModellingRule">i=37</Alias>
  </Aliases>
  <UAObjectType NodeId="ns=1;i=10" BrowseName="1:ProbeType">
    <References><Reference ReferenceType="HasComponent">ns=1;i=11</Reference></References>
  </UAObjectType>
  <UAObject NodeId="ns=1;i=11" BrowseName="1:AcquisitionConfig">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=20</Reference>
      <Reference ReferenceType="HasModellingRule">i=78</Reference>
    </References>
  </UAObject>
  <UAObjectType NodeId="ns=1;i=20" BrowseName="1:AcquisitionConfigType">
    <References><Reference ReferenceType="HasComponent">ns=1;i=21</Reference></References>
  </UAObjectType>
  <UAVariable NodeId="ns=1;i=21" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3">
    <References><Reference ReferenceType="HasModellingRule">i=78</Reference></References>
  </UAVariable>
  <UAObject NodeId="ns=1;i=100" BrowseName="1:P01">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=101</Reference>
    </References>
  </UAObject>
  <UAObject NodeId="ns=1;i=101" BrowseName="1:AcquisitionConfig">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=20</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=102</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=102" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3"/>
  <UAObject NodeId="ns=1;i=200" BrowseName="1:P02">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=10</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=201</Reference>
    </References>
  </UAObject>
  <UAObject NodeId="ns=1;i=201" BrowseName="1:AcquisitionConfig">
    <References>
      <Reference ReferenceType="HasTypeDefinition">ns=1;i=20</Reference>
      <Reference ReferenceType="HasComponent">ns=1;i=202</Reference>
    </References>
  </UAObject>
  <UAVariable NodeId="ns=1;i=202" BrowseName="1:SampleRate" DataType="Double" AccessLevel="3"/>
</UANodeSet>`;

const GENERATION_SHOTS = [
  { file: '12-model-generation.png', panel: 'model', desc: 'Model generation from the book (roles → configs)' },
  { file: '13-control-generated.png', panel: 'control', desc: 'Check-in diff produced by the generation' }
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

/**
 * Spawn options for the Vite CLI. `shell` is required on Windows: the resolved
 * binary is a `.cmd` shim, and current Node refuses to spawn one directly (EINVAL).
 */
const SPAWN_OPTIONS = { cwd: DEMO_DIR, stdio: 'inherit', shell: process.platform === 'win32' };

function run(cmd, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, SPAWN_OPTIONS);
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
    const vite = viteBin();
    console.log('[eng-shots] building demo bundle…');
    await run(vite, ['build']);
    console.log('[eng-shots] starting vite preview…');
    server = spawn(vite, ['preview', '--port', '4310', '--strictPort', '--host', '127.0.0.1'], SPAWN_OPTIONS);
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
      await page.goto(`${devUrl}/?panel=${panel.id}&lang=${LANG}`, { waitUntil: 'load' });
      await page.waitForSelector('wui-eng-studio');
      // Let the element boot its demo data + Lit render.
      await page.waitForTimeout(600);
      // For the control panel, trigger a dry-run so the report shows too. The
      // buttons are `ix-button`s, and the label is localised ("dry-run" / "Dry-Run"),
      // hence the case-insensitive match.
      if (panel.id === 'control') {
        await page.evaluate(() => {
          const app = document.querySelector('wui-eng-studio');
          app?.shadowRoot?.querySelectorAll('ix-button').forEach((b) => {
            if ((b.textContent ?? '').toLowerCase().includes('dry-run')) b.click();
          });
        });
        await page.waitForTimeout(500);
      }
      // The Catalogues panel opens with no selection: pick the shared PackML catalog
      // so the shot shows a real detail (interface, provenance, users) and not a hint.
      if (panel.id === 'books') {
        await page.evaluate(() => {
          document.querySelector('wui-eng-studio')?.selectBookById('book-packml-v101');
        });
        await page.waitForTimeout(400);
      }
      const file = resolve(OUT, panel.file);
      await page.screenshot({ path: file });
      console.log(`[eng-shots] ${panel.file} — ${panel.desc}`);
    }

    // Device-specific Devices-panel shots (many-to-many showcase).
    for (const shot of DEVICE_SHOTS) {
      await page.goto(`${devUrl}/?panel=devices&lang=${LANG}`, { waitUntil: 'load' });
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
    await page.goto(`${devUrl}/?panel=devices&lang=${LANG}`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const app = document.querySelector('wui-eng-studio');
      app?.selectDeviceById('ligne-embouteillage');
      app?.selectBookById('book-opcua-remplisseuse');
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT, '14-browse-online.png') });
    console.log('[eng-shots] 14-browse-online.png — Book produced by an online OPC UA browse');
    await page.evaluate(async () => {
      await document.querySelector('wui-eng-studio')?.refreshForDemo();
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(OUT, '15-browse-refresh-delta.png') });
    console.log('[eng-shots] 15-browse-refresh-delta.png — Re-browse: added / removed / changed delta');

    // Custom structure + mapping: a house-standard type authored as an outline and
    // auto-mapped onto the S7 book, whose paths are nested and named differently.
    await page.goto(`${devUrl}/?panel=model&lang=${LANG}`, { waitUntil: 'load' });
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
    console.log('[eng-shots] 16-custom-structure-mapping.png — Custom structure + signal mapping');

    // Generation scenario: qualify → generate → diff, captured end to end.
    await page.goto(`${devUrl}/?panel=model&lang=${LANG}`, { waitUntil: 'load' });
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

    // Device declaration form, in the two states worth documenting:
    //   1. a CREATION mid-typing, showing the core's live validation (an invalid
    //      name and a missing required parameter);
    //   2. an EDIT of an existing equipment, with its books checked.
    await page.goto(`${devUrl}/?panel=devices&lang=${LANG}`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.querySelector('wui-eng-studio')?.deviceFormForDemo(undefined, {
        name: 'Four n°2 (zone B)',
        protocol: 's7plus',
        accessModes: ['s7plus', 'opcua'],
        connection: {}
      });
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT, '19-device-form-new.png') });
    console.log('[eng-shots] 19-device-form-new.png — Device form: creation, with the core validating as you type');
    // A PAC3200: the one demo equipment whose word order and addressing base are
    // DOCUMENTED facts (from the Siemens manual), so the "declared on the WinCC OA
    // side" card shows real content instead of "not stated".
    await page.evaluate(() => {
      document.querySelector('wui-eng-studio')?.deviceFormForDemo('pac-depart1');
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT, '20-device-form-edit.png') });
    console.log('[eng-shots] 20-device-form-edit.png — Device form: editing a Modbus equipment (declared driver settings)');

    // The catalogue creation form — the screen that makes an address book with no
    // equipment at all. Captured on the FILE generator (the one that needs no
    // runtime), so the shot shows the source card, the template/project interface
    // question and the optional attachment.
    await page.goto(`${devUrl}/?panel=books&lang=${LANG}`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.querySelector('wui-eng-studio')?.bookFormForDemo();
    });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(OUT, '22-book-form.png') });
    console.log('[eng-shots] 22-book-form.png — Catalogue creation form (no equipment needed)');

    // The server EXPLORER: the address space, one level per request, before anything
    // is created. Two branches are opened so the shot shows the nesting and the
    // per-level counts. Selectors pierce the shadow roots (Playwright does it for CSS).
    const exploreButton = await page.$('.explorer-head ix-button');
    if (exploreButton) {
      await exploreButton.click();
      await page.waitForTimeout(600);
      for (const toggle of (await page.$$('.explorer-toggle')).slice(0, 2)) {
        await toggle.click();
        await page.waitForTimeout(400);
      }
      await page.screenshot({ path: resolve(OUT, '23-book-explorer.png') });
      console.log('[eng-shots] 23-book-explorer.png — Server explorer: look before creating');
    }

    // Signals HIDDEN by hand: the count, the book warning and "Restore all".
    await page.goto(`${devUrl}/?panel=books&lang=${LANG}`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.querySelector('wui-eng-studio')?.selectBookById('book-packml-v101');
    });
    await page.waitForTimeout(500);
    for (const box of (await page.$$('.signals-scroll tbody .cb-col input[type=checkbox]')).slice(0, 3)) {
      await box.click();
    }
    const hideButton = await page.$('.role-bar ix-button[variant="danger-secondary"]');
    if (hideButton) {
      await hideButton.click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: resolve(OUT, '24-signals-hidden.png') });
      console.log('[eng-shots] 24-signals-hidden.png — Signals hidden by hand (reversible)');
    }

    // Tagging ONE signal's role: the chip clicked open into its picker. Captured on
    // the PAC3200 (45 rows) so the shot shows a single control among plain chips.
    await page.goto(`${devUrl}/?panel=books&lang=${LANG}`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      document.querySelector('wui-eng-studio')?.selectBookById('book-pac3200');
    });
    await page.waitForTimeout(500);
    const roleChip = (await page.$$('.signals-scroll tbody .chip.role-tag'))[0];
    if (roleChip) {
      await roleChip.click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(OUT, '25-role-tag.png') });
      console.log('[eng-shots] 25-role-tag.png — Tagging one signal’s role (click the chip)');
    }

    // The IMPORT PREVIEW: a NodeSet2 picked in the creation form is parsed on the spot
    // (by the same core function the server ingests with), so the card shows what the
    // catalog will contain BEFORE anything is created. The file is handed over as an
    // in-memory buffer — a fixture on disk would be one more thing to keep in sync, and
    // this one doubles as the regression shot for the nested-instance bug (P01/P02 each
    // carry their own AcquisitionConfig; the paths must not collide).
    await page.goto(`${devUrl}/?panel=books&lang=${LANG}`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelector('wui-eng-studio')?.bookFormForDemo());
    await page.waitForTimeout(400);
    const formatSelect = page.locator('wui-eng-book-form ix-select').first();
    await formatSelect.click();
    await page.waitForTimeout(300);
    await page.locator('wui-eng-book-form ix-select-item[value="nodeset"]').click();
    await page.waitForTimeout(300);
    await page
      .locator('wui-eng-book-form input[type="file"]')
      .setInputFiles({ name: 'Probe.NodeSet2.xml', mimeType: 'text/xml', buffer: Buffer.from(NODESET_SAMPLE, 'utf8') });
    await page.waitForTimeout(900);
    await page.screenshot({ path: resolve(OUT, '26-book-preview.png') });
    console.log('[eng-shots] 26-book-preview.png — Import preview: the file’s content, before creating');

    // The connection state: read, not declared. Captured on the Modbus station whose
    // connection is INACTIVE — the case a two-colour lamp cannot tell from a downtime.
    await page.goto(`${devUrl}/?panel=devices&lang=${LANG}`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector('wui-eng-studio')?.selectDeviceById('m580-station'));
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT, '27-device-state.png') });
    console.log('[eng-shots] 27-device-state.png — Connection state: LED + word + the driver’s own code');

    // WORKSPACE HOUSEKEEPING: a model deleted from the library leaves its datapoints
    // staged for creation. Reproduced by dropping the generated type from the workspace
    // AND from the live snapshot — which is what the deletion leaves behind — so the shot
    // shows the warning that names the orphans and the bar that removes them.
    await page.goto(`${devUrl}/?panel=control&lang=${LANG}`, { waitUntil: 'load' });
    await page.waitForSelector('wui-eng-studio');
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const app = document.querySelector('wui-eng-studio');
      const orphaned = app.workspace.dps[0]?.dpType;
      if (orphaned === undefined) return;
      app.workspace = { ...app.workspace, types: app.workspace.types.filter((t) => t.typeName !== orphaned) };
      app.live = {
        ...app.live,
        types: app.live.types.filter((t) => t.typeName !== orphaned),
        dps: app.live.dps.filter((d) => d.dpType !== orphaned)
      };
      app.recomputePlan();
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const root = document.querySelector('wui-eng-studio').shadowRoot;
      root.querySelector('.diff-scroll thead input[type="checkbox"]')?.click();
    });
    await page.waitForTimeout(300);
    await page.screenshot({ path: resolve(OUT, '28-control-cleanup.png') });
    console.log('[eng-shots] 28-control-cleanup.png — Workspace housekeeping: orphans named, rows selected');

    // Proof that the page is localised, kept in the docs: the same panel in FR and
    // DE. The rest of the set stays English so it matches the documentation.
    for (const [code, file] of [
      ['fr', '17-i18n-fr.png'],
      ['de', '18-i18n-de.png']
    ]) {
      await page.goto(`${devUrl}/?panel=devices&lang=${code}`, { waitUntil: 'load' });
      await page.waitForSelector('wui-eng-studio');
      await page.waitForTimeout(500);
      await page.evaluate(() => {
        const app = document.querySelector('wui-eng-studio');
        app?.selectDeviceById('ligne-embouteillage');
        app?.selectBookById('book-opcua-remplisseuse');
      });
      await page.waitForTimeout(400);
      await page.screenshot({ path: resolve(OUT, file) });
      console.log(`[eng-shots] ${file} — UI in ${code.toUpperCase()}`);
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
