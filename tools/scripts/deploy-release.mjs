#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable no-console */
// -----------------------------------------------------------------------------
// deploy-release.mjs — build + deploy a curated set of dashboard modules
// -----------------------------------------------------------------------------
// Interactive helper that:
//   1. asks for the target WinCC OA project root (data/, javascript/, config/),
//   2. lets you SELECT which page modules to include (pre-checked default set),
//   3. builds the standalone pages into <project>/data/dashboard-wc,
//   4. filters the deployed menu to ONLY the selected modules (optionally prunes
//      the other page bundles),
//   5. deploys the BACKENDS (webserver modules + managers) associated with the
//      selected modules — via tools/scripts/deploy-backend.mjs, driven by
//      tools/specs.json.
//
// A page module is a `libs/wui-<id>/` with a `src/<id>.ts` entry (e.g.
// wui-process-monitor → id "process-monitor"). Kit libs (wui-fleet-core,
// wui-kit, wui-ai-kit) have no such entry → they are not pages; they are bundled
// automatically into the pages that import them.
//
// Usage:
//   node tools/scripts/deploy-release.mjs                 # fully interactive
//   node tools/scripts/deploy-release.mjs --project D:\WinCC_OA_Proj_321\WebDemo2
//   node tools/scripts/deploy-release.mjs --project <root> \
//        --modules machine-fleet-3d,fleet-closures,audit-trail,para,process-monitor --yes
//
// Options:
//   --project <root>      Target WinCC OA project root (else prompted).
//   --modules <a,b,...>   Page ids to include (else interactive selection).
//   --name <dir>          Webserver dir under javascript/ (default customer-webserver).
//   --full                Full rebuild (shared bundles + app + pages) instead of pages-only.
//   --prune               Delete the non-selected page bundles from the deploy (strict version).
//   --install-webserver   Install the base customer-webserver into the project first
//     (alias --webserver)  (copy + npm install + tsc + pmon line) — needed on a FRESH project
//                          where <ws>/src/modules does not exist yet.
//   --winccoa <path>      WinCC OA install path for the webserver's file: deps
//                          (only with --install-webserver; default keeps 3.21).
//   --start-page <route>  Default landing page (redirect of "/"), e.g. /process-monitor
//                          or a module id (process-monitor). Default: /dashboard.
//   --ai-assistant        Enable the embedded AI assistant in the pages (default OFF).
//                          Writes dashboard-features.json { aiAssistant: true|false } that
//                          the pages read at runtime.
//   --no-backend          Skip backend/manager deployment (frontend only).
//   --yes                 Don't ask for confirmation (non-interactive).
//
// Backend step also auto-generates any missing <ws>/src/modules/<page>/index.ts
// descriptor (from specs.json) so the routes mount. It NEVER restarts managers or
// the webserver (production actions) — it prints what to restart afterwards.
// -----------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // tools/scripts -> repo root
const LIBS_DIR = path.join(ROOT, 'libs');
const SPECS_FILE = path.join(ROOT, 'tools', 'specs.json');

/** Default pre-selected modules (the "fleet + ops" release). */
const DEFAULT_MODULES = [
  'machine-fleet-3d',
  'fleet-closures',
  'fleet-kpi-analysis',
  'fleet-stop-analysis',
  'audit-trail',
  'para',
  'process-monitor'
];

// ---- args -------------------------------------------------------------------

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const opts = {
  project: arg('project'),
  modules: arg('modules')?.split(',').map((s) => s.trim()).filter(Boolean),
  wsName: arg('name') || 'customer-webserver',
  full: has('full'),
  prune: has('prune'),
  noBackend: has('no-backend'),
  installWebserver: has('install-webserver') || has('webserver'),
  winccoa: arg('winccoa'),
  startPage: arg('start-page'),
  aiAssistant: has('ai-assistant'),
  yes: has('yes')
};

/** Default landing route when none is chosen (the dashboard overview). */
const DEFAULT_START_PAGE = '/dashboard';

// ---- small utils ------------------------------------------------------------

const C = { reset: '[0m', bold: '[1m', dim: '[2m', green: '[32m', yellow: '[33m', cyan: '[36m', red: '[31m' };
const c = (col, s) => `${C[col]}${s}${C.reset}`;

/** Strip // line comments and parse JSONC (menu.fragment.jsonc are simple). */
function readJsonc(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const noComments = raw
    .split('\n')
    .map((line) => (line.trimStart().startsWith('//') ? '' : line))
    .join('\n');
  return JSON.parse(noComments);
}

function run(cmd, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    // Use a shell only for `npm` (npm.cmd on Windows). For `node` keep shell off
    // and call the real binary so args with spaces (project paths) are preserved.
    const isNpm = cmd === 'npm';
    const child = spawn(isNpm ? cmd : process.execPath, args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: isNpm && process.platform === 'win32',
      env: { ...process.env, ...extraEnv }
    });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with code ${code}`))));
    child.on('error', reject);
  });
}

// ---- module catalog ---------------------------------------------------------

/** Discover page modules: libs/wui-<id>/src/<id>.ts, enriched with menu title + specs backend. */
function discoverModules() {
  const specs = JSON.parse(fs.readFileSync(SPECS_FILE, 'utf8'));
  const specByPage = new Map(specs.map((s) => [s.page, s]));
  const out = [];
  for (const dirent of fs.readdirSync(LIBS_DIR, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !dirent.name.startsWith('wui-')) continue;
    const id = dirent.name.slice('wui-'.length);
    const entry = path.join(LIBS_DIR, dirent.name, 'src', `${id}.ts`);
    if (!fs.existsSync(entry)) continue; // kit libs (no page entry) excluded
    let title = id;
    let route = `/${id}`;
    const fragFile = path.join(LIBS_DIR, dirent.name, 'menu.fragment.jsonc');
    try {
      const frag = readJsonc(fragFile);
      title = frag?.[0]?.title?.en_US || frag?.[0]?.title?.['en_US.utf8'] || id;
      route = frag?.[0]?.path || route;
    } catch {
      /* no/invalid fragment — keep id */
    }
    const spec = specByPage.get(id);
    const hasBackend = Boolean(spec?.backend?.srcFiles?.length);
    const managers = spec?.managers ?? [];
    out.push({ id, lib: dirent.name, title, route, hasBackend, mount: spec?.backend?.mount, managers, backend: spec?.backend });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

// ---- interactive selection --------------------------------------------------

async function promptProject(rl) {
  if (opts.project) return validateProject(opts.project);
  for (;;) {
    const ans = (await rl.question(c('cyan', 'Dossier du projet WinCC OA (racine, contient data/ javascript/ config/) : '))).trim().replace(/^"|"$/g, '');
    if (!ans) continue;
    const v = validateProject(ans, true);
    if (v) return v;
    console.log(c('red', `  ✗ "${ans}" n'a pas l'air d'un projet WinCC OA (data/ + javascript/ + config/ requis).`));
  }
}

function validateProject(p, soft = false) {
  const abs = path.resolve(p);
  const ok = ['data', 'javascript', 'config'].every((d) => fs.existsSync(path.join(abs, d)));
  if (!ok) {
    if (soft) return null;
    console.error(c('red', `✗ Projet invalide : ${abs} (data/ + javascript/ + config/ requis).`));
    process.exit(1);
  }
  return abs;
}

async function promptModules(rl, catalog) {
  const selected = new Set(DEFAULT_MODULES.filter((id) => catalog.some((m) => m.id === id)));
  if (opts.modules) {
    const valid = new Set(catalog.map((m) => m.id));
    for (const id of opts.modules) {
      if (!valid.has(id)) {
        console.error(c('red', `✗ Module inconnu : ${id}. Disponibles : ${[...valid].join(', ')}`));
        process.exit(1);
      }
    }
    return new Set(opts.modules);
  }
  for (;;) {
    console.log(`\n${c('bold', 'Modules disponibles')} ${c('dim', '([x] = inclus)')}`);
    catalog.forEach((m, i) => {
      const mark = selected.has(m.id) ? c('green', '[x]') : '[ ]';
      const be = m.hasBackend || m.managers.length ? c('dim', `  · backend/managers: ${m.mount || '-'} ${m.managers.join(',')}`) : '';
      console.log(`  ${mark} ${String(i + 1).padStart(2)}. ${m.id.padEnd(28)} ${c('dim', m.title)}${be}`);
    });
    console.log(c('dim', "  fleet-core est une lib partagée (bundlée automatiquement, pas un module sélectionnable)."));
    const ans = (await rl.question(`\n${c('cyan', "Numéros à basculer (ex: 1 3 5), 'a'=tout, 'n'=aucun, Entrée=valider : ")}`)).trim().toLowerCase();
    if (ans === '') break;
    if (ans === 'a') { catalog.forEach((m) => selected.add(m.id)); continue; }
    if (ans === 'n') { selected.clear(); continue; }
    for (const tok of ans.split(/[\s,]+/)) {
      const idx = Number.parseInt(tok, 10) - 1;
      const m = catalog[idx];
      if (m) selected.has(m.id) ? selected.delete(m.id) : selected.add(m.id);
    }
  }
  return selected;
}

/** Choose the default landing page among the selected modules (or the dashboard). */
async function promptStartPage(rl, chosen) {
  const choices = [{ label: 'Tableau de bord (overview)', route: DEFAULT_START_PAGE }, ...chosen.map((m) => ({ label: m.title, route: m.route, id: m.id }))];
  if (opts.startPage) {
    const want = opts.startPage.startsWith('/') ? opts.startPage : `/${opts.startPage}`;
    const match = choices.find((ch) => ch.route === want || ch.id === opts.startPage);
    return match ? match.route : want; // accept an explicit custom route too
  }
  if (opts.yes) return DEFAULT_START_PAGE; // non-interactive: keep the default
  console.log(`\n${c('bold', 'Page de démarrage par défaut')} ${c('dim', '(redirection de "/")')}`);
  choices.forEach((ch, i) => console.log(`  ${String(i + 1).padStart(2)}. ${ch.route.padEnd(22)} ${c('dim', ch.label)}`));
  const ans = (await rl.question(`\n${c('cyan', `Numéro [1=${DEFAULT_START_PAGE} par défaut] : `)}`)).trim();
  if (ans === '') return DEFAULT_START_PAGE;
  const idx = Number.parseInt(ans, 10) - 1;
  return choices[idx]?.route ?? DEFAULT_START_PAGE;
}

/** Ask whether to enable the AI assistant in the pages (OFF by default). */
async function promptAiAssistant(rl) {
  if (opts.aiAssistant) return true; // --ai-assistant forces it on
  if (opts.yes) return false; // non-interactive: keep the default (off)
  const ans = (await rl.question(`\n${c('cyan', 'Activer l\'assistant IA dans les pages ? [o/N] : ')}`)).trim().toLowerCase();
  return ans === 'o' || ans === 'oui' || ans === 'y';
}

/** Write the deploy-time feature flags read by the pages (AI assistant on/off). */
function writeFeatures(dwcDir, aiAssistant) {
  const file = path.join(dwcDir, 'dashboard-features.json');
  fs.writeFileSync(file, `${JSON.stringify({ aiAssistant }, null, 2)}\n`);
  console.log(c('green', `  ✓ assistant IA ${aiAssistant ? 'ACTIVÉ' : 'désactivé'} (dashboard-features.json)`));
}

/** Set the home redirect ("/" and the raw index.html) to the chosen landing route. */
function applyStartPage(dwcDir, startPage) {
  const file = path.join(dwcDir, 'menuconfig.json');
  if (!fs.existsSync(file)) { console.log(c('yellow', '  ! menuconfig.json absent — page de démarrage non appliquée.')); return; }
  const menu = JSON.parse(fs.readFileSync(file, 'utf8'));
  let changed = 0;
  const homePaths = new Set(['/', '/data/dashboard-wc/index.html']);
  for (const e of menu.entries ?? []) {
    if (homePaths.has(e.path) && typeof e.redirect === 'string' && e.redirect !== startPage) {
      e.redirect = startPage;
      changed++;
    }
  }
  if (changed > 0) {
    fs.writeFileSync(file, `${JSON.stringify(menu, null, 2)}\n`);
    console.log(c('green', `  ✓ page de démarrage → ${startPage}`));
  } else {
    console.log(c('dim', `  · page de démarrage déjà ${startPage} (ou redirection home absente).`));
  }
}

// ---- menu filtering + pruning ----------------------------------------------

/** Page bundle id referenced by a menu entry's `module`, or null. */
function moduleBundleId(entry) {
  const m = typeof entry?.module === 'string' ? entry.module.match(/\/pages\/([^/]+)\.js$/) : null;
  return m ? m[1] : null;
}

/** Keep structural entries + entries whose page bundle is selected; recurse into children. */
function filterMenuEntries(entries, selected) {
  const keep = [];
  for (const entry of entries) {
    const bundle = moduleBundleId(entry);
    if (bundle && !selected.has(bundle)) continue; // a page bundle that is not selected → drop
    const next = { ...entry };
    for (const key of ['entries', 'children']) {
      if (Array.isArray(next[key])) next[key] = filterMenuEntries(next[key], selected);
    }
    keep.push(next);
  }
  return keep;
}

function filterMenu(dwcDir, selected) {
  const file = path.join(dwcDir, 'menuconfig.json');
  if (!fs.existsSync(file)) { console.log(c('yellow', `  ! menuconfig.json absent (${file}) — menu non filtré.`)); return; }
  const menu = JSON.parse(fs.readFileSync(file, 'utf8'));
  const before = JSON.stringify(menu);
  if (Array.isArray(menu.entries)) menu.entries = filterMenuEntries(menu.entries, selected);
  if (JSON.stringify(menu) !== before) {
    fs.writeFileSync(file, `${JSON.stringify(menu, null, 2)}\n`);
    console.log(c('green', `  ✓ menu filtré sur ${selected.size} module(s).`));
  } else {
    console.log(c('dim', '  · menu déjà conforme.'));
  }
}

// ---- webserver install + module descriptors --------------------------------

/** Install the base customer-webserver into the project (copy + npm install + tsc + pmon). */
async function installWebserver(project) {
  const args = ['webserver/install.mjs', '--project', project, '--name', opts.wsName, '--register-pmon'];
  if (opts.winccoa) args.push('--winccoa', opts.winccoa);
  await run('node', args);
}

/**
 * Create the `<ws>/src/modules/<page>/index.ts` descriptor for each selected
 * backend page when missing, derived from specs.json (mount, routeClass,
 * routeFile). Without it the webserver loader can't mount the module and
 * deploy-backend skips the routes. Returns false if the modules dir is absent.
 */
function ensureModuleDescriptors(project, backends) {
  const modulesDir = path.join(project, 'javascript', opts.wsName, 'src', 'modules');
  if (!fs.existsSync(modulesDir)) return false;
  for (const m of backends) {
    const be = m.backend;
    if (!be?.routeClass || !be?.routeFile) continue;
    const dir = path.join(modulesDir, m.id);
    const file = path.join(dir, 'index.ts');
    if (fs.existsSync(file)) { console.log(c('dim', `  · descripteur modules/${m.id} déjà présent.`)); continue; }
    fs.mkdirSync(dir, { recursive: true });
    const descriptor =
      `// Backend module descriptor for the ${m.title} page — auto-discovered by\n` +
      `// @visuelconcept/wui-webserver (mountModuleRoutes). Generated by deploy-release.mjs.\n` +
      `import { WsjAccessControlList } from '@winccoa/backend';\n\n` +
      `import { ${be.routeClass} } from './${be.routeFile}';\n\n` +
      `export default {\n` +
      `  mount: '${be.mount}',\n` +
      `  // Unauthenticated for demo. Tighten before production, e.g. { allowUsers: ['root', 'engineer'] }.\n` +
      `  acl: WsjAccessControlList.fullAccess,\n` +
      `  routes: () => ${be.routeClass}.routes()\n` +
      `};\n`;
    fs.writeFileSync(file, descriptor);
    console.log(c('green', `  ✓ descripteur créé : modules/${m.id}/index.ts (${be.mount})`));
  }
  return true;
}

/** Delete the non-selected LIB page bundles (never touches shell/standalone pages). */
function pruneBundles(dwcDir, catalog, selected) {
  const pagesDir = path.join(dwcDir, 'pages');
  let removed = 0;
  for (const m of catalog) {
    if (selected.has(m.id)) continue;
    const f = path.join(pagesDir, `${m.id}.js`);
    if (fs.existsSync(f)) { fs.rmSync(f); removed++; console.log(c('dim', `  - retiré pages/${m.id}.js`)); }
  }
  console.log(c('green', `  ✓ ${removed} bundle(s) non sélectionné(s) retiré(s).`));
}

// ---- main -------------------------------------------------------------------

async function main() {
  console.log(c('bold', '\n=== Déploiement d\'une version (modules sélectionnés) ===\n'));
  const catalog = discoverModules();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const project = await promptProject(rl);
    const selected = await promptModules(rl, catalog);
    if (selected.size === 0) { console.error(c('red', '✗ Aucun module sélectionné.')); process.exit(1); }

    const chosen = catalog.filter((m) => selected.has(m.id));
    const startPage = await promptStartPage(rl, chosen);
    const aiAssistant = await promptAiAssistant(rl);
    const dwcDir = path.join(project, 'data', 'dashboard-wc');
    const backends = chosen.filter((m) => m.hasBackend || m.managers.length);

    // summary
    console.log(`\n${c('bold', 'Récapitulatif')}`);
    console.log(`  Projet      : ${project}`);
    console.log(`  Sortie web  : ${dwcDir}`);
    console.log(`  Build       : ${opts.full ? 'complet (shared bundles + app + pages)' : 'pages seulement'}`);
    console.log(`  Modules     : ${chosen.map((m) => m.id).join(', ')}`);
    console.log(`  Démarrage   : ${startPage}`);
    console.log(`  Assistant IA: ${aiAssistant ? 'activé' : 'désactivé (défaut)'}`);
    console.log(`  Élagage     : ${opts.prune ? 'oui (autres bundles supprimés)' : 'non (menu filtré seulement)'}`);
    console.log(`  Webserver   : ${opts.installWebserver ? `installation "${opts.wsName}"${opts.winccoa ? ` (WinCC OA: ${opts.winccoa})` : ''}` : 'supposé déjà installé'}`);
    console.log(`  Backends    : ${opts.noBackend ? 'ignorés' : (backends.length ? backends.map((m) => `${m.id}[${[m.mount, ...m.managers].filter(Boolean).join(' ')}]`).join(', ') : 'aucun')}`);

    if (!fs.existsSync(path.join(dwcDir, 'index.html')) && !opts.full) {
      console.log(c('yellow', `\n  ! Le shell ne semble pas déployé (${path.join(dwcDir, 'index.html')} absent).`));
      console.log(c('yellow', '    Un build "pages seulement" suppose un shell + shared bundles déjà présents — sinon relancez avec --full.'));
    }

    if (!opts.yes) {
      const go = (await rl.question(`\n${c('cyan', 'Lancer le déploiement ? [o/N] : ')}`)).trim().toLowerCase();
      if (go !== 'o' && go !== 'oui' && go !== 'y') { console.log('Annulé.'); process.exit(0); }
    }
    rl.close();

    // 1) frontend build
    console.log(c('bold', '\n[1/4] Build frontend…'));
    await run('npm', ['run', opts.full ? 'build' : 'build:pages'], { OUT_DIR: dwcDir });

    // 2) menu filter + default landing page + feature flags
    console.log(c('bold', '\n[2/4] Filtrage du menu + page de démarrage + options…'));
    filterMenu(dwcDir, selected);
    applyStartPage(dwcDir, startPage);
    writeFeatures(dwcDir, aiAssistant);

    // 3) optional prune
    if (opts.prune) {
      console.log(c('bold', '\n[3/4] Élagage des bundles non sélectionnés…'));
      pruneBundles(dwcDir, catalog, selected);
    } else {
      console.log(c('dim', '\n[3/4] Élagage ignoré (--prune pour une version stricte).'));
    }

    // 4) backend
    if (opts.noBackend || backends.length === 0) {
      console.log(c('dim', `\n[4/4] Backend ignoré (${opts.noBackend ? '--no-backend' : 'aucun backend pour la sélection'}).`));
    } else {
      console.log(c('bold', '\n[4/4] Déploiement des backends/managers…'));
      const wsModulesDir = path.join(project, 'javascript', opts.wsName, 'src', 'modules');
      if (opts.installWebserver) {
        console.log(c('cyan', `  → installation du webserver "${opts.wsName}"…`));
        await installWebserver(project);
      } else if (!fs.existsSync(wsModulesDir)) {
        console.error(c('red', `\n✗ Webserver "${opts.wsName}" non installé (${wsModulesDir} absent).`));
        console.error(c('yellow', '  Relancez avec --install-webserver (et --winccoa <chemin WinCC OA> si l\'install n\'est pas en 3.21 standard).'));
        process.exit(1);
      }
      // Generate any missing module descriptors so the routes actually mount.
      ensureModuleDescriptors(project, backends);
      const only = backends.map((m) => m.id).join(',');
      await run('node', ['tools/scripts/deploy-backend.mjs', '--project', project, '--name', opts.wsName, '--only', only]);
    }

    // report
    const managers = [...new Set(backends.flatMap((m) => m.managers))];
    console.log(c('green', '\n✓ Déploiement terminé.'));
    if (managers.length) {
      console.log(c('yellow', `\nÀ FAIRE dans la console WinCC OA / pmon (${project}) :`));
      console.log(`  • redémarrer le manager "${opts.wsName}" pour recharger les modules webserver,`);
      console.log(`  • démarrer/redémarrer les managers : ${managers.join(', ')}.`);
    }
    console.log(c('dim', '\nDans le navigateur : « Clear site data » + reload pour charger la nouvelle version.'));
  } finally {
    rl.close();
  }
}

main().catch((e) => { console.error(c('red', `\n✗ ${e.message}`)); process.exit(1); });
