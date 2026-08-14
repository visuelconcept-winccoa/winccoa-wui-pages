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
//   3. CHECKS the workspace can build them at all (scaffold wiring + the pages'
//      external npm deps) and aborts with the repair commands if not,
//   4. builds the standalone pages into <project>/data/dashboard-wc,
//   5. filters the deployed menu AND the app-security role manifest to ONLY the
//      selected modules, and prunes the non-selected page bundles from the
//      deploy (use --no-prune to keep the bundles),
//   6. VERIFIES every selected module ends up deployed (fresh bundle + menu
//      entry) and that index.html was bumped so the service worker drops its
//      CacheFirst script cache — exits non-zero otherwise,
//   7. deploys the BACKENDS (webserver modules + managers) associated with the
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
//   --project <root>      Target WinCC OA project root (else prompted, else the
//                         one remembered from the last run).
//   --workspace <dir>     The @wincc-oa/webui-runtime workspace that BUILDS the
//                         pages. Defaults to `<repo>/.runtime` when it exists,
//                         else the remembered one, else this repo (scaffold laid
//                         on top). Sources (libs/, tools/specs.json) are ALWAYS
//                         read here; only the npm build runs in the workspace.
//   --modules <a,b,...>   Page ids to include (else interactive selection).
//   --name <dir>          Webserver dir under javascript/ (default customer-webserver).
//   --full                Full rebuild (shared bundles + app + pages) instead of pages-only.
//   --no-prune            Keep the non-selected page bundles in the deploy (menu-only
//                         filtering). By default the non-selected bundles ARE removed so
//                         only the selected modules are actually published/reachable.
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
//   --yes                 Ask NOTHING: reuse every remembered answer and go.
//
// Every interactive answer is REMEMBERED in .deploy-release-cache.json (gitignored)
// so a redeploy is Entrée, Entrée, Entrée — and `--yes` alone needs no argument:
//   lastWorkspace                            the workspace that built last time
//   lastProject                              the target project root
//   modulesByProject[project]                the module selection, per project
//   settingsByProject[project].startPage     the landing route, per project
//   settingsByProject[project].aiAssistant   the AI assistant flag, per project
// Per project on purpose: a dev target and a customer target rarely want the same
// modules or the same landing page. An explicit flag always beats the cache, a
// remembered start page is dropped when its module is no longer selected, and the
// answers are saved BEFORE the build so a failed build costs nothing. Delete the
// file to start fresh.
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
import { EXTERNAL_DEPENDENCIES } from '../external-dependencies.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..'); // tools/scripts -> repo root
const LIBS_DIR = path.join(ROOT, 'libs');
const SPECS_FILE = path.join(ROOT, 'tools', 'specs.json');
// Local (gitignored) cache remembering the last-used project root, offered as the
// default on the next run. Mirrors the .license-cache.json convention.
const STATE_FILE = path.join(ROOT, '.deploy-release-cache.json');

/** Default pre-selected modules (the "fleet + ops" release). */
const DEFAULT_MODULES = [
  'machine-fleet-3d',
  'fleet-closures',
  'fleet-kpi-analysis',
  'fleet-stop-analysis',
  'audit-trail',
  'para',
  'eng-studio',
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
  workspace: arg('workspace'),
  modules: arg('modules')?.split(',').map((s) => s.trim()).filter(Boolean),
  wsName: arg('name') || 'customer-webserver',
  full: has('full'),
  // Prune non-selected page bundles by DEFAULT so only the selected modules are
  // published. --no-prune reverts to menu-only filtering (bundles stay on disk).
  // --prune is still accepted (no-op) for backward compatibility.
  prune: !has('no-prune'),
  noBackend: has('no-backend'),
  installWebserver: has('install-webserver') || has('webserver'),
  winccoa: arg('winccoa'),
  startPage: arg('start-page'),
  aiAssistant: has('ai-assistant'),
  yes: has('yes')
};

/** Default landing route when none is chosen (the dashboard overview). */
const DEFAULT_START_PAGE = '/dashboard';

/**
 * The runtime workspace that owns apps/, node_modules and the npm scripts.
 *
 * Resolution order: --workspace, then `<repo>/.runtime` (the separate-workspace
 * layout), then the workspace remembered from the last run, then ROOT itself
 * (scaffold laid on top). Everything below that reads a SCAFFOLD file must use
 * this, never ROOT. `readState` is a hoisted function declaration, so reading the
 * cache here is fine.
 */
const localRuntime = path.join(ROOT, '.runtime');
const WORKSPACE = path.resolve(
  opts.workspace ??
    (fs.existsSync(path.join(localRuntime, 'apps')) ? localRuntime : undefined) ??
    readState().lastWorkspace ??
    ROOT
);
const SEPARATE_WORKSPACE = WORKSPACE !== ROOT;
const BASE_MENU_FILE = path.join(WORKSPACE, 'apps', 'dashboard-wc', 'config', 'menuconfig.jsonc');
/** Suffix for the repair commands we print, so they are copy-pasteable. */
const wsFlag = SEPARATE_WORKSPACE ? ` --workspace "${WORKSPACE}"` : '';

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
    // npm scripts (build, build:pages) belong to the WORKSPACE — that is where
    // apps/, nx and node_modules live. Our own node scripts stay in ROOT, where
    // libs/ and tools/specs.json are.
    const child = spawn(isNpm ? cmd : process.execPath, args, {
      cwd: isNpm ? WORKSPACE : ROOT,
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

/**
 * Page bundle ids hardcoded in the base menuconfig (e.g. app-security,
 * diagnosis). These are SHELL/system pages, not optional release modules: they
 * must always ship, otherwise their (permanent) menu entry points at a bundle
 * that was never built or got pruned → 404. Always force-included in the
 * selection so they are kept in the menu AND never pruned.
 */
function baseMenuBundleIds() {
  try {
    const menu = readJsonc(BASE_MENU_FILE);
    const ids = new Set();
    const walk = (entries) => {
      for (const e of entries ?? []) {
        const bundle = moduleBundleId(e);
        if (bundle) ids.add(bundle);
        walk(e.entries);
        walk(e.children);
      }
    };
    walk(menu.entries);
    return ids;
  } catch {
    return new Set(); // no/invalid base menu — nothing to force-include
  }
}

// ---- interactive selection --------------------------------------------------

/** Read the whole gitignored cache object ({} if none/unreadable). */
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return s && typeof s === 'object' ? s : {};
  } catch {
    return {}; // no cache yet / unreadable
  }
}

/** Merge a partial update into the cache and persist it (best-effort). */
function writeState(patch) {
  try {
    fs.writeFileSync(STATE_FILE, `${JSON.stringify({ ...readState(), ...patch }, null, 2)}\n`);
  } catch {
    /* non-fatal: caching the defaults is a convenience only */
  }
}

/** Last-used project root, or null if none/invalid. */
function readLastProject() {
  const { lastProject } = readState();
  return typeof lastProject === 'string' && lastProject ? lastProject : null;
}

/** Remember the chosen project root for next time. */
function saveLastProject(project) {
  writeState({ lastProject: project });
}

/** Module ids selected last time FOR THIS project, or null if none. */
function readLastModules(project) {
  const map = readState().modulesByProject;
  const arr = map && typeof map === 'object' ? map[project] : null;
  return Array.isArray(arr) && arr.length ? arr : null;
}

/** Remember the selected module ids for this project. */
function saveLastModules(project, ids) {
  const map = { ...readState().modulesByProject, [project]: ids };
  writeState({ modulesByProject: map });
}

/** Remember which runtime workspace built this deploy (default for next time). */
function saveLastWorkspace(workspace) {
  writeState({ lastWorkspace: workspace });
}

/**
 * Per-project answers to the remaining questions (start page, AI assistant).
 * Kept in their own map so an existing cache with only modulesByProject keeps
 * working untouched.
 */
function readProjectSettings(project) {
  const map = readState().settingsByProject;
  const settings = map && typeof map === 'object' ? map[project] : null;
  return settings && typeof settings === 'object' ? settings : {};
}

function saveProjectSettings(project, patch) {
  const map = readState().settingsByProject;
  const previous = map && typeof map === 'object' ? map : {};
  writeState({
    settingsByProject: {
      ...previous,
      [project]: { ...readProjectSettings(project), ...patch }
    }
  });
}

async function promptProject(rl) {
  if (opts.project) return validateProject(opts.project);
  const last = readLastProject();
  // --yes means "ask nothing": reuse the remembered project rather than block on
  // a prompt that a scripted run can never answer.
  if (opts.yes) {
    const valid = last ? validateProject(last, true) : null;
    if (valid) {
      console.log(c('dim', `  · --yes : projet mémorisé repris (${valid}).`));
      return valid;
    }
    console.error(c('red', '✗ --yes sans --project, et aucun projet mémorisé valide.'));
    process.exit(1);
  }
  const hint = last ? c('dim', `\n  [Entrée = ${last}]`) : '';
  for (;;) {
    const ans = (await rl.question(c('cyan', 'Dossier du projet WinCC OA (racine, contient data/ javascript/ config/)') + hint + c('cyan', ' : '))).trim().replace(/^"|"$/g, '');
    if (!ans) {
      if (!last) continue; // no remembered default — keep asking
      const v = validateProject(last, true);
      if (v) return v;
      console.log(c('yellow', `  ! Dernier projet "${last}" introuvable/invalide — saisissez un chemin.`));
      continue;
    }
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

async function promptModules(rl, catalog, project) {
  // Default selection: modules chosen last time for THIS project, else the
  // built-in default set. Filtered to modules that still exist in the catalog.
  const remembered = readLastModules(project);
  const base = remembered ?? DEFAULT_MODULES;
  const selected = new Set(base.filter((id) => catalog.some((m) => m.id === id)));
  if (remembered) console.log(c('dim', '  · sélection par défaut reprise du dernier déploiement de ce projet.'));
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
  // --yes means "ask nothing": take the remembered selection (or the default set)
  // instead of stopping on the toggle list, which would hang a scripted run.
  if (opts.yes) {
    console.log(
      c('dim', `  · --yes : sélection ${remembered ? 'mémorisée' : 'par défaut'} reprise (${[...selected].join(', ')}).`)
    );
    return selected;
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
async function promptStartPage(rl, chosen, project) {
  const choices = [{ label: 'Tableau de bord (overview)', route: DEFAULT_START_PAGE }, ...chosen.map((m) => ({ label: m.title, route: m.route, id: m.id }))];
  if (opts.startPage) {
    const want = opts.startPage.startsWith('/') ? opts.startPage : `/${opts.startPage}`;
    const match = choices.find((ch) => ch.route === want || ch.id === opts.startPage);
    return match ? match.route : want; // accept an explicit custom route too
  }
  // Reuse the remembered answer, but only while that route is still reachable:
  // the module it pointed at may have been deselected since, and redirecting "/"
  // to an undeployed page is a dead landing page.
  const remembered = readProjectSettings(project).startPage;
  const fallback = choices.some((ch) => ch.route === remembered) ? remembered : DEFAULT_START_PAGE;
  if (opts.yes) return fallback;
  console.log(`\n${c('bold', 'Page de démarrage par défaut')} ${c('dim', '(redirection de "/")')}`);
  choices.forEach((ch, i) => {
    const mark = ch.route === fallback ? c('green', ' ←') : '';
    console.log(`  ${String(i + 1).padStart(2)}. ${ch.route.padEnd(22)} ${c('dim', ch.label)}${mark}`);
  });
  const origin = remembered && remembered === fallback ? 'mémorisé' : 'défaut';
  const ans = (await rl.question(`\n${c('cyan', `Numéro [Entrée = ${fallback}, ${origin}] : `)}`)).trim();
  if (ans === '') return fallback;
  const idx = Number.parseInt(ans, 10) - 1;
  return choices[idx]?.route ?? fallback;
}

/** Ask whether to enable the AI assistant in the pages (OFF by default). */
async function promptAiAssistant(rl, project) {
  if (opts.aiAssistant) return true; // --ai-assistant forces it on
  const remembered = readProjectSettings(project).aiAssistant;
  const fallback = typeof remembered === 'boolean' ? remembered : false;
  if (opts.yes) return fallback;
  // Capitalise the remembered branch, so [O/n] vs [o/N] shows the default.
  const shape = fallback ? '[O/n]' : '[o/N]';
  const ans = (await rl.question(`\n${c('cyan', `Activer l'assistant IA dans les pages ? ${shape} : `)}`)).trim().toLowerCase();
  if (ans === '') return fallback;
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

/**
 * Restrict the built app-security-manifest.json to the selected modules (the
 * counterpart of filterMenu/pruneBundles for the Application-Security page).
 * The build aggregates EVERY libs/wui-* role fragment, so without this filter
 * the page's "Discover modules" would seed AppSecurity_<module> datapoints for
 * modules that are not part of this release. Entries whose module id is not in
 * the repo catalog (external modules merged by their own installer) are kept.
 */
function filterAppSecurityManifest(dwcDir, catalog, selected) {
  const file = path.join(dwcDir, 'app-security-manifest.json');
  if (!fs.existsSync(file)) { console.log(c('dim', '  · app-security-manifest.json absent — rien à filtrer.')); return; }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.log(c('yellow', `  ! app-security-manifest.json illisible (${e.message}) — non filtré.`));
    return;
  }
  if (!Array.isArray(manifest)) { console.log(c('yellow', '  ! app-security-manifest.json inattendu (pas un tableau) — non filtré.')); return; }
  const known = new Set(catalog.map((m) => m.id));
  const kept = manifest.filter((entry) => !known.has(entry?.module) || selected.has(entry.module));
  if (kept.length !== manifest.length) {
    fs.writeFileSync(file, `${JSON.stringify(kept, null, 2)}\n`);
    console.log(c('green', `  ✓ app-security-manifest filtré : ${kept.length}/${manifest.length} module(s) conservé(s).`));
  } else {
    console.log(c('dim', '  · app-security-manifest déjà conforme.'));
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

// ---- preflight: the workspace must be able to produce the pages -------------

/**
 * The scaffold patches that make `libs/wui-*` pages reach the build at all.
 * `webui-runtime-init` regenerates apps/ and libs/default-components/ pristine
 * (they are untracked), which silently reverts them — the build then emits ONLY
 * the runtime's own standalone pages and the module-less base menuconfig, i.e. a
 * deploy that succeeds with a dashboard missing every additional page.
 */
const WIRING_HELPERS = [
  'apps/dashboard-wc/scripts/discover-page-libs.mjs',
  'apps/dashboard-wc/scripts/page-menu-merge-plugin.mjs',
  'apps/dashboard-wc/scripts/page-appsec-merge-plugin.mjs'
];

/**
 * Patches the wiring applies, as [file, inserted marker]. Markers match the
 * CALL, not the identifier: an import left behind by a half-reverted file would
 * otherwise pass while the page/menu discovery is dead.
 */
const WIRING_PATCHES = [
  // discoverPageLibs() adds libs/wui-<id>/src/<id>.ts to the rollup inputs.
  ['apps/dashboard-wc/vite.shared.ts', '...discoverPageLibs()'],
  // Merge menu.fragment.jsonc / role fragments into the EMITTED config files.
  ['apps/dashboard-wc/vite.config.pages.ts', 'pageMenuMergePlugin('],
  ['apps/dashboard-wc/vite.config.pages.ts', 'pageAppsecMergePlugin(']
];

/** Abort unless the scaffold is wired (see tools/wire-workspace.mjs). */
function assertWiring() {
  const missing = [];
  for (const relative of WIRING_HELPERS) {
    if (!fs.existsSync(path.join(WORKSPACE, relative))) missing.push(`${relative} (absent)`);
  }
  for (const [relative, marker] of WIRING_PATCHES) {
    const file = path.join(WORKSPACE, relative);
    if (!fs.existsSync(file)) { missing.push(`${relative} (absent)`); continue; }
    if (!fs.readFileSync(file, 'utf8').includes(marker)) missing.push(`${relative} (${marker} absent)`);
  }
  // The full build emits the menu/appsec config too — it needs the same plugins.
  if (opts.full) {
    const appConfig = path.join(WORKSPACE, 'apps/dashboard-wc/vite.config.ts');
    const source = fs.existsSync(appConfig) ? fs.readFileSync(appConfig, 'utf8') : '';
    for (const marker of ['pageMenuMergePlugin(', 'pageAppsecMergePlugin(']) {
      if (!source.includes(marker)) missing.push(`apps/dashboard-wc/vite.config.ts (${marker} absent)`);
    }
  }
  if (missing.length === 0) { console.log(c('dim', '  · wiring du scaffold OK.')); return; }
  console.error(c('red', '\n✗ Workspace NON wiré — le build produirait un dashboard sans les pages additionnelles :'));
  for (const m of missing) console.error(c('red', `    - ${m}`));
  console.error(c('yellow', '\n  Réparez (idempotent), puis relancez ce déploiement :'));
  console.error(`    node tools/wire-workspace.mjs${wsFlag}`);
  process.exit(1);
}

/**
 * With a separate workspace the pages are NOT in it — they stay here, and the
 * scaffold finds them through the generated wui-pages-root.json. Two things must
 * hold, and neither fails loudly on its own:
 *
 *   • that file must point at THIS repo. Pointing elsewhere (another checkout, a
 *     moved folder) builds someone else's pages, or none, and the build succeeds.
 *   • <repo>/node_modules must resolve, because a bundled import is looked up by
 *     walking up from the page source, i.e. from here.
 */
function assertPagesRoot() {
  if (!SEPARATE_WORKSPACE) return;
  const problems = [];

  const rootFile = path.join(WORKSPACE, 'apps/dashboard-wc/scripts/wui-pages-root.json');
  if (!fs.existsSync(rootFile)) {
    problems.push('wui-pages-root.json absent — le scaffold ignore où sont les pages');
  } else {
    try {
      const declared = JSON.parse(fs.readFileSync(rootFile, 'utf8')).libsDirectory;
      if (typeof declared !== 'string' || !fs.existsSync(declared)) {
        problems.push(`wui-pages-root.json pointe sur "${declared}" qui n'existe pas`);
      } else if (fs.realpathSync(declared) !== fs.realpathSync(LIBS_DIR)) {
        problems.push(`wui-pages-root.json pointe sur ${declared} — pas sur ${LIBS_DIR}`);
      }
    } catch (error) {
      problems.push(`wui-pages-root.json illisible : ${error.message}`);
    }
  }

  // Resolve a package the pages certainly import, rather than just testing that
  // the directory exists — a dangling link passes existsSync on some platforms.
  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'lit', 'package.json'))) {
    problems.push('node_modules ne résout pas depuis le repo (lit introuvable)');
  }

  if (problems.length === 0) {
    console.log(c('dim', `  · pages rattachées au workspace OK (${WORKSPACE}).`));
    return;
  }
  console.error(c('red', '\n✗ Le workspace ne trouverait pas ces pages — le build les omettrait silencieusement :'));
  for (const p of problems) console.error(c('red', `    - ${p}`));
  console.error(c('yellow', '\n  Réparez (idempotent), puis relancez ce déploiement :'));
  console.error(`    node tools/wire-workspace.mjs${wsFlag}`);
  process.exit(1);
}

/**
 * Abort unless the third-party packages the selected pages import are installed.
 * A regenerated package.json loses them (three, @novnc/novnc, jsmpeg, …) and the
 * pages build dies on "failed to resolve import" — loud, but only after a long
 * build, so check it up front.
 */
function assertPageDependencies(chosen) {
  const missing = new Map(); // install name -> page ids needing it
  for (const m of chosen) {
    const packageFile = path.join(LIBS_DIR, m.lib, 'package.json');
    if (!fs.existsSync(packageFile)) continue;
    let deps;
    try {
      const manifest = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
      // Page libs declare their third-party packages as peerDependencies (the
      // workspace provides them) — read both keys, like install-page-dependencies.
      deps = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies });
    } catch {
      continue; // unreadable lib manifest — the build will report it
    }
    for (const dep of deps) {
      const installName = EXTERNAL_DEPENDENCIES[dep]?.[0];
      if (!installName) continue; // provided by the workspace runtime deps
      if (fs.existsSync(path.join(WORKSPACE, 'node_modules', installName))) continue;
      missing.set(installName, [...(missing.get(installName) ?? []), m.id]);
    }
  }
  if (missing.size === 0) { console.log(c('dim', '  · dépendances externes des pages OK.')); return; }
  console.error(c('red', '\n✗ Dépendances npm des pages manquantes dans node_modules :'));
  for (const [name, pages] of missing) console.error(c('red', `    - ${name}  (requis par : ${pages.join(', ')})`));
  console.error(c('yellow', '\n  Installez-les, puis relancez ce déploiement :'));
  console.error(`    node tools/install-page-dependencies.mjs${wsFlag}`);
  process.exit(1);
}

// ---- postflight: what got deployed is what was selected ---------------------

/**
 * Verify, per selected module, that the deploy REALLY contains it: a page bundle
 * written by THIS build (not a leftover from an older deploy) and a menu entry
 * pointing at it. This is the net that catches every cause of the
 * "pages absentes après déploiement" class of bug, whatever its origin
 * (unwired scaffold, missing menu fragment, over-eager pruning).
 *
 * @param startedAt epoch ms captured just before the build
 * @returns true when every selected module checks out
 */
function verifyDeploy(dwcDir, chosen, startedAt) {
  const menuFile = path.join(dwcDir, 'menuconfig.json');
  const menuSource = fs.existsSync(menuFile) ? fs.readFileSync(menuFile, 'utf8') : '';
  const problems = [];
  // The WebUI service worker serves scripts CacheFirst (~15 days) and only
  // purges its caches when the cached index.html's Last-Modified stops matching
  // the origin's. A pages-only build doesn't rewrite index.html, so
  // page-menu-merge-plugin bumps its mtime instead — if that didn't happen, the
  // new bundles are on disk but browsers keep serving the old ones.
  const indexFile = path.join(dwcDir, 'index.html');
  if (!fs.existsSync(indexFile)) {
    problems.push('index.html absent — shell non déployé (relancez avec --full)');
  } else if (fs.statSync(indexFile).mtimeMs < startedAt - 5000) {
    problems.push("index.html non réécrit/touché — le service worker continuerait de servir les anciens bundles");
  }
  for (const m of chosen) {
    const bundle = path.join(dwcDir, 'pages', `${m.id}.js`);
    if (!fs.existsSync(bundle)) { problems.push(`${m.id} : pages/${m.id}.js absent (page non construite)`); continue; }
    // Tolerate a 5 s skew: OUT_DIR writes and our timestamp aren't atomic.
    if (fs.statSync(bundle).mtimeMs < startedAt - 5000) {
      problems.push(`${m.id} : pages/${m.id}.js PÉRIMÉ (${new Date(fs.statSync(bundle).mtimeMs).toISOString()}) — pas réécrit par ce build`);
    }
    if (!menuSource.includes(`/pages/${m.id}.js`)) {
      problems.push(`${m.id} : aucune entrée de menu ne référence pages/${m.id}.js (page inaccessible)`);
    }
  }
  if (problems.length === 0) {
    console.log(c('green', `  ✓ ${chosen.length} module(s) vérifié(s) : bundle frais + entrée de menu.`));
    console.log(c('green', '  ✓ index.html à jour → le service worker purgera ses caches (F5 côté navigateur).'));
    return true;
  }
  console.error(c('red', '\n✗ Déploiement INCOMPLET :'));
  for (const p of problems) console.error(c('red', `    - ${p}`));
  console.error(c('yellow', '\n  Cause la plus fréquente : scaffold non wiré (apps/ et libs/default-components/ sont'));
  console.error(c('yellow', '  régénérés vierges par webui-runtime-init / restaurés sans wiring). Réparez puis relancez :'));
  console.error(`    node tools/wire-workspace.mjs${wsFlag}`);
  return false;
}

// ---- main -------------------------------------------------------------------

async function main() {
  console.log(c('bold', '\n=== Déploiement d\'une version (modules sélectionnés) ===\n'));
  const catalog = discoverModules();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const project = await promptProject(rl);
    saveLastProject(project); // remember it as the default for next time
    const selected = await promptModules(rl, catalog, project);
    if (selected.size === 0) { console.error(c('red', '✗ Aucun module sélectionné.')); process.exit(1); }
    saveLastModules(project, [...selected]); // remember this selection for this project

    // Always include the shell/system pages hardcoded in the base menu
    // (app-security, diagnosis) — they must ship regardless of the selection,
    // else their permanent menu entry 404s (bundle never built / pruned).
    const baseIds = baseMenuBundleIds();
    const forced = [];
    for (const id of baseIds) {
      if (catalog.some((m) => m.id === id) && !selected.has(id)) { selected.add(id); forced.push(id); }
    }
    if (forced.length) console.log(c('dim', `  · pages système toujours incluses : ${forced.join(', ')}`));

    const chosen = catalog.filter((m) => selected.has(m.id));

    // Fail BEFORE the (long) build if the workspace can't actually produce the
    // selected pages — otherwise the deploy "succeeds" with pages missing.
    console.log(c('bold', '\nContrôles préalables'));
    assertPagesRoot();
    assertWiring();
    assertPageDependencies(chosen);

    const startPage = await promptStartPage(rl, chosen, project);
    const aiAssistant = await promptAiAssistant(rl, project);
    // Remember every answer + the workspace, so the next run is `--yes` alone.
    // Saved BEFORE the build: a build that dies halfway must not cost the answers.
    saveProjectSettings(project, { startPage, aiAssistant });
    saveLastWorkspace(WORKSPACE);
    const dwcDir = path.join(project, 'data', 'dashboard-wc');
    const backends = chosen.filter((m) => m.hasBackend || m.managers.length);

    // summary
    console.log(`\n${c('bold', 'Récapitulatif')}`);
    console.log(`  Sources     : ${ROOT}`);
    console.log(`  Workspace   : ${WORKSPACE}${SEPARATE_WORKSPACE ? '' : c('dim', ' (scaffold dans le repo)')}`);
    console.log(`  Projet      : ${project}`);
    console.log(`  Sortie web  : ${dwcDir}`);
    console.log(`  Build       : ${opts.full ? 'complet (shared bundles + app + pages)' : 'pages seulement'}`);
    console.log(`  Modules     : ${chosen.map((m) => m.id).join(', ')}`);
    console.log(`  Démarrage   : ${startPage}`);
    console.log(`  Assistant IA: ${aiAssistant ? 'activé' : 'désactivé (défaut)'}`);
    console.log(`  Élagage     : ${opts.prune ? 'oui, défaut (bundles non sélectionnés supprimés)' : 'non, --no-prune (menu filtré seulement)'}`);
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
    console.log(c('bold', '\n[1/5] Build frontend…'));
    const buildStartedAt = Date.now(); // reference for the freshness check below
    await run('npm', ['run', opts.full ? 'build' : 'build:pages'], { OUT_DIR: dwcDir });

    // 2) menu filter + default landing page + feature flags
    console.log(c('bold', '\n[2/5] Filtrage du menu + page de démarrage + options…'));
    filterMenu(dwcDir, selected);
    filterAppSecurityManifest(dwcDir, catalog, selected);
    applyStartPage(dwcDir, startPage);
    writeFeatures(dwcDir, aiAssistant);

    // 3) optional prune
    if (opts.prune) {
      console.log(c('bold', '\n[3/5] Élagage des bundles non sélectionnés…'));
      pruneBundles(dwcDir, catalog, selected);
    } else {
      console.log(c('dim', '\n[3/5] Élagage ignoré (--no-prune : le menu est filtré mais les bundles restent sur disque).'));
    }

    // 4) verify the deploy really contains the selection AND that browsers will
    //    pick it up — never report success on a deploy that silently lost pages.
    console.log(c('bold', '\n[4/5] Vérification du déploiement…'));
    if (!verifyDeploy(dwcDir, chosen, buildStartedAt)) process.exit(1);

    // 5) backend
    if (opts.noBackend || backends.length === 0) {
      console.log(c('dim', `\n[5/5] Backend ignoré (${opts.noBackend ? '--no-backend' : 'aucun backend pour la sélection'}).`));
    } else {
      console.log(c('bold', '\n[5/5] Déploiement des backends/managers…'));
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
      console.log(c('yellow', `\nÀ FAIRE dans la console WinCC OA / pmon (${project}) — OBLIGATOIRE, rien n'est redémarré automatiquement :`));
      console.log(`  • redémarrer le manager "${opts.wsName}" pour recharger les modules webserver,`);
      console.log(`  • redémarrer (ou démarrer) CHAQUE manager déployé : ${managers.join(', ')}.`);
      console.log(c('yellow', "    Un manager laissé en place continue d'exécuter le code chargé à son démarrage :"));
      console.log(c('yellow', '    pmon l\'affiche "running" mais son service MSA vRPC reste sur l\'ancien contrat, et'));
      console.log(c('yellow', '    l\'API du webserver répond 502 "Service is not available" tant qu\'il n\'est pas relancé.'));
    }
    console.log(c('dim', '\nDans le navigateur : un simple F5 suffit — index.html a un Last-Modified plus récent, le service worker purge ses caches et recharge la nouvelle version.'));
  } finally {
    rl.close();
  }
}

main().catch((e) => { console.error(c('red', `\n✗ ${e.message}`)); process.exit(1); });
