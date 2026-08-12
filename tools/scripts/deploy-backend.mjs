#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// deploy-backend.mjs — deploy page-module backends + managers to a WinCC OA project
// -----------------------------------------------------------------------------
// Source of truth is tools/specs.json: each page may declare
//   backend: { mount, srcFiles: [...] }   -> HTTP module under the webserver
//   backend: { vendorPackages: [...] }    -> workspace libs the routes import
//   managers: [ "<name>", ... ]           -> JS managers under <project>/javascript/
//
// This script mirrors those into a target project, WITHOUT touching the module
// `index.ts` descriptors (created once by each page's own installer) and WITHOUT
// restarting managers (that must be done in the WinCC OA console / pmon).
//
//   node tools/scripts/deploy-backend.mjs --project <winccoa-project-root> [options]
//
// Options:
//   --project <root>     REQUIRED. WinCC OA project root (has javascript/, config/).
//   --name <dir>         webserver folder under <project>/javascript/ (default: customer-webserver)
//   --only <p1,p2,...>   restrict to these page ids (specs.json "page"); default: all
//   --no-managers        do not copy managers and do not touch config/progs
//   --no-progs           copy managers but do not edit config/progs
//   --no-build           skip the webserver `npm run build`
//   --dry-run            print what would happen, change nothing
//
// What it does (idempotent): copy each selected page's backend.srcFiles from
// backend/routes/ into <ws>/src/modules/<page>/; VENDOR any workspace library it
// declares (see below); copy each manager folder from backend/managers/<m>/ into
// <project>/javascript/<m>/; append any missing manager line to
// <project>/config/progs; then build the webserver (tsc).
//
// Vendoring (`backend.vendorPackages`): a route module may import a pure workspace
// library — `engController.ts` imports `@visuelconcept/wui-eng-core`, the
// engineering domain it shares with the page. That specifier does not exist on a
// customer webserver, and installing it as a package would not help: the library
// ships TypeScript sources, and tsc does not EMIT files it reads from node_modules,
// so the import would compile and then fail at runtime. So the library's sources are
// copied INTO the module (`_vendor/<lib>/`), where the webserver's own tsc compiles
// and emits them, and the bare specifier is rewritten to that relative path — the
// same rule tools/vendor-page.mjs applies to the frontend. `*.spec.ts` files are
// left out on purpose: they import vitest, which would break the webserver build.
//
// It NEVER restarts managers — after it finishes, in the WinCC OA console:
//   • restart the webserver manager (loads the rebuilt modules),
//   • RESTART every manager whose folder was just overwritten. A running manager
//     keeps executing the code it loaded at startup, so its MSA vRPC service stays
//     on the OLD contract while the rebuilt webserver already calls the new one —
//     the bridge then answers 502 "Service is not available" even though the
//     manager looks perfectly alive in pmon. This is why the summary below lists
//     the already-registered managers separately from the newly-added ones.
//   • start any newly-added managers.
// -----------------------------------------------------------------------------
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const project = arg('project');
const wsName = arg('name') ?? 'customer-webserver';
const only = arg('only')?.split(',').map((s) => s.trim()).filter(Boolean);
const noManagers = has('no-managers');
const noProgs = has('no-progs') || noManagers;
const noBuild = has('no-build');
const dryRun = has('dry-run');

if (!project) {
  console.error('Usage: node tools/scripts/deploy-backend.mjs --project <winccoa-project-root> [--name <dir>] [--only p1,p2] [--no-managers] [--no-progs] [--no-build] [--dry-run]');
  process.exit(1);
}

const ws = join(project, 'javascript', wsName);
const modulesDir = join(ws, 'src', 'modules');
const routesDir = join(ROOT, 'backend', 'routes');
const managersDir = join(ROOT, 'backend', 'managers');
const progsFile = join(project, 'config', 'progs');

if (!existsSync(modulesDir)) {
  console.error(`✗ Webserver modules dir not found: ${modulesDir}`);
  console.error(`  Install the webserver first (webserver/install.mjs --project ${project} --name ${wsName}).`);
  process.exit(1);
}

const specs = JSON.parse(readFileSync(join(ROOT, 'tools', 'specs.json'), 'utf8'));
const selected = specs.filter((p) => (only ? only.includes(p.page) : true) && (p.backend?.srcFiles?.length || p.managers?.length));

if (selected.length === 0) {
  console.error(only ? `No matching pages with backend/managers for --only ${only.join(',')}` : 'No pages with backend/managers in specs.json');
  process.exit(1);
}

const tag = dryRun ? '[dry-run] ' : '';
console.log(`${tag}Deploying backend -> ${ws}`);
console.log(`${tag}Pages: ${selected.map((p) => p.page).join(', ')}`);

const copied = [];
const managersCopied = new Set();
const progsAdded = [];
const warnings = [];
/**
 * config/progs as it was BEFORE this run appended anything — a manager already
 * listed there is (almost certainly) running, so overwriting its folder desyncs
 * the live process from the deployed code until it is restarted.
 */
const progsBefore = existsSync(progsFile) ? readFileSync(progsFile, 'utf8') : '';

function copyFile(src, dest, label) {
  if (!existsSync(src)) {
    warnings.push(`missing source: ${src}`);
    return;
  }
  if (dryRun) {
    console.log(`${tag}  copy ${label}`);
    copied.push(label);
    return;
  }
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  copied.push(label);
}

/** Name → directory of every workspace library (from each lib's package.json). */
function libsByPackageName() {
  const map = new Map();
  const libsDir = join(ROOT, 'libs');
  if (!existsSync(libsDir)) return map;
  for (const dirent of readdirSync(libsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const manifest = join(libsDir, dirent.name, 'package.json');
    if (!existsSync(manifest)) continue;
    try {
      const { name } = JSON.parse(readFileSync(manifest, 'utf8'));
      if (typeof name === 'string') map.set(name, dirent.name);
    } catch {
      /* unreadable manifest — the package simply stays unresolvable */
    }
  }
  return map;
}

const LIB_BY_NAME = libsByPackageName();

/** Every .ts file of a directory except the tests (relative paths). */
function sourceFiles(dir, prefix = '') {
  const out = [];
  for (const dirent of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
    if (dirent.isDirectory()) out.push(...sourceFiles(join(dir, dirent.name), rel));
    else if (dirent.name.endsWith('.ts') && !dirent.name.endsWith('.spec.ts')) out.push(rel);
  }
  return out;
}

/**
 * Copy one workspace library's sources into `<moduleDir>/_vendor/<lib>/`.
 * Returns the vendored directory name, or null when the package is unknown.
 */
function vendorPackage(packageName, moduleDir, page) {
  const lib = LIB_BY_NAME.get(packageName);
  if (lib === undefined) {
    warnings.push(`module '${page}': vendorPackages declares '${packageName}', which matches no library manifest under libs/ — the webserver build will fail on its import.`);
    return null;
  }
  const srcDir = join(ROOT, 'libs', lib, 'src');
  if (!existsSync(srcDir)) {
    warnings.push(`module '${page}': '${packageName}' has no src/ directory (${srcDir}).`);
    return null;
  }
  const files = sourceFiles(srcDir);
  for (const file of files) {
    copyFile(join(srcDir, file), join(moduleDir, '_vendor', lib, file), `modules/${page}/_vendor/${lib}/${file}`);
  }
  return lib;
}

/**
 * Rewrite the bare workspace specifiers of a COPIED route file to the vendored
 * path. Only import/export specifiers are touched — a package name mentioned in a
 * comment or a string stays as written.
 */
function rewriteVendorImports(file, vendored, page, label) {
  if (dryRun || vendored.size === 0 || !existsSync(file)) return;
  const before = readFileSync(file, 'utf8');
  let after = before;
  for (const [packageName, lib] of vendored) {
    const escaped = packageName.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    // `from '@scope/pkg'` and `from '@scope/pkg/sub/path.js'`, single or double quotes.
    after = after.replaceAll(
      new RegExp(String.raw`(\bfrom\s*|\bimport\s*\(\s*)(['"])${escaped}(/[^'"]*)?\2`, 'g'),
      (_whole, head, quote, sub) => `${head}${quote}./_vendor/${lib}${sub ?? '/index.js'}${quote}`
    );
  }
  if (after !== before) writeFileSync(file, after);
  // A leftover bare specifier compiles here and fails on the customer's webserver,
  // which is exactly the kind of gap this script exists to close — so say it loudly.
  const leftover = [...after.matchAll(/\bfrom\s*['"](@[^'".][^'"]*)['"]/g)]
    .map((match) => match[1])
    .filter((specifier) => [...vendored.keys()].some((name) => specifier === name || specifier.startsWith(`${name}/`)));
  if (leftover.length > 0) warnings.push(`module '${page}': ${label} still imports ${[...new Set(leftover)].join(', ')} after rewriting.`);
}

// 1) module srcFiles + 2) managers
for (const page of selected) {
  const srcFiles = page.backend?.srcFiles ?? [];
  if (srcFiles.length > 0) {
    const moduleDir = join(modulesDir, page.page);
    if (!existsSync(join(moduleDir, 'index.ts'))) {
      warnings.push(`module '${page.page}' has no index.ts in ${moduleDir} — the page module must be installed once before its backend can mount (skipping its srcFiles).`);
    } else {
      for (const f of srcFiles) {
        copyFile(join(routesDir, f), join(moduleDir, f), `modules/${page.page}/${f}`);
      }
      // Vendor the workspace libraries the routes import, then point the copied
      // files at them (see the header). Done AFTER the copy: it edits the copies.
      const vendored = new Map();
      for (const packageName of page.backend?.vendorPackages ?? []) {
        const lib = vendorPackage(packageName, moduleDir, page.page);
        if (lib !== null) vendored.set(packageName, lib);
      }
      for (const f of srcFiles) {
        rewriteVendorImports(join(moduleDir, f), vendored, page.page, f);
      }
    }
  }
  if (!noManagers) {
    for (const m of page.managers ?? []) {
      if (managersCopied.has(m)) continue;
      managersCopied.add(m);
      copyFile(join(managersDir, m), join(project, 'javascript', m), `javascript/${m}/`);
    }
  }
}

// 3) config/progs registration (idempotent)
if (!noProgs && managersCopied.size > 0) {
  if (!existsSync(progsFile)) {
    warnings.push(`config/progs not found at ${progsFile} — register managers manually in pmon.`);
  } else {
    const current = readFileSync(progsFile, 'utf8');
    const lines = [];
    for (const m of managersCopied) {
      const entry = chooseEntry(project, m);
      if (current.includes(`${m}/${entry}`)) continue;
      lines.push(`node             | always |      30 |        2 |        2 |${m}/${entry}`);
    }
    if (lines.length > 0) {
      if (dryRun) {
        console.log(`${tag}  would append to config/progs:\n${lines.map((l) => '      ' + l).join('\n')}`);
      } else {
        appendFileSync(progsFile, `${current.endsWith('\n') ? '' : '\n'}${lines.join('\n')}\n`);
      }
      progsAdded.push(...lines);
    }
  }
}

// 4) build the webserver
//
// A FAILED build is fatal, not a warning. The sources are already copied at this
// point, so a tsc failure leaves the project with new TypeScript and the PREVIOUS
// compiled JavaScript: the webserver keeps serving the old routes, and the deploy
// used to report success anyway — "I redeployed and I don't see the changes", with
// nothing in the summary that says why. Fail loudly instead.
let buildFailed = false;
if (!noBuild && !dryRun) {
  try {
    console.log(`… npm run build (tsc) in ${ws}`);
    execSync('npm run build', { cwd: ws, stdio: 'inherit' });
  } catch {
    buildFailed = true;
  }
  // Even a build that EXITS 0 can have emitted nothing for a module (a stale
  // tsconfig include, an emit-blocking error in another module): check that each
  // deployed module really has compiled output newer than the sources just written.
  if (!buildFailed) {
    for (const stale of staleCompiledModules(ws, selected)) {
      warnings.push(
        `module '${stale.page}': ${stale.reason} — the webserver still serves the previous code for it; run \`npm run build\` in ${ws} and read the errors.`
      );
    }
  }
} else if (noBuild) {
  console.log(`${tag}(skipped build)`);
}

/**
 * Modules whose compiled output is missing or older than the sources just copied.
 *
 * `main` of the webserver package points at `dist/`, and tsc mirrors `src/` there, so
 * `src/modules/<page>/x.ts` compiles to `dist/modules/<page>/x.js`. Comparing the two
 * mtimes is what distinguishes "compiled" from "copied but not compiled" — the state
 * that makes a deploy look successful while the running webserver has none of it.
 */
function staleCompiledModules(webserverDirectory, deployed) {
  const stale = [];
  for (const { page } of deployed) {
    const sourceDirectory = join(webserverDirectory, 'src', 'modules', page);
    const emittedDirectory = join(webserverDirectory, 'dist', 'modules', page);
    if (!existsSync(sourceDirectory)) continue;
    if (!existsSync(emittedDirectory)) {
      stale.push({ page, reason: `no compiled output in dist/modules/${page}` });
      continue;
    }
    for (const file of readdirSync(sourceDirectory).filter((name) => name.endsWith('.ts'))) {
      const emitted = join(emittedDirectory, `${file.slice(0, -'.ts'.length)}.js`);
      if (!existsSync(emitted)) {
        stale.push({ page, reason: `${file} produced no ${basename(emitted)}` });
        break;
      }
      if (statSync(emitted).mtimeMs < statSync(join(sourceDirectory, file)).mtimeMs) {
        stale.push({ page, reason: `${basename(emitted)} is older than ${file}` });
        break;
      }
    }
  }
  return stale;
}

// summary
console.log('');
console.log(`${tag}Copied ${copied.length} item(s):`);
for (const c of copied) console.log(`  ✓ ${c}`);
if (progsAdded.length > 0) {
  console.log('Added to config/progs (verify manager number/order in pmon):');
  for (const l of progsAdded) console.log(`  + ${l}`);
}
if (warnings.length > 0) {
  console.log('\nWarnings:');
  for (const w of warnings) console.log(`  ! ${w}`);
}
// Managers whose folder was overwritten while already registered in pmon are the
// dangerous ones: pmon shows them "running" but the live process still serves the
// PREVIOUS code, so the rebuilt webserver's vRPC calls fail (502 "Service is not
// available") until each one is restarted.
const managersToRestart = [...managersCopied].filter((m) => isRegisteredInProgs(m));
const managersToStart = [...managersCopied].filter((m) => !isRegisteredInProgs(m));

console.log('\nNext (WinCC OA console / pmon) — REQUIRED, this script restarts nothing:');
console.log(`  • restart the "${wsName}" manager so the rebuilt modules load`);
if (managersToRestart.length > 0) {
  console.log(`  • RESTART these already-registered managers — their code was just overwritten: ${managersToRestart.join(', ')}`);
  console.log('    (a running manager keeps the code it loaded at startup; skipping this leaves the');
  console.log('     webserver bridge answering 502 "Service is not available" on a manager that looks alive)');
}
if (managersToStart.length > 0) console.log(`  • start newly-added managers: ${managersToStart.join(', ')}`);

// A backend that did not COMPILE is not deployed, whatever was copied. Exit non-zero
// after the full report (the operator needs the copy list and the restart lines) so
// deploy-release.mjs stops instead of printing "✓ Déploiement terminé".
if (buildFailed) {
  console.error(`\n✗ webserver build (tsc) FAILED in ${ws} — the sources are copied but NOT compiled.`);
  console.error('  The webserver keeps serving the previous routes. Run `npm run build` there and fix the errors.');
  process.exit(1);
}

/** True when config/progs already listed this manager BEFORE this run (→ likely running). */
function isRegisteredInProgs(manager) {
  return new RegExp(`(^|[|\\\\/\\s])${manager}/`, 'm').test(progsBefore);
}

/** Pick a manager entry file: prefer index.js, else index_http.js, else index.js. */
function chooseEntry(projectRoot, manager) {
  const base = join(projectRoot, 'javascript', manager);
  for (const candidate of ['index.js', 'index_http.js']) {
    try {
      if (statSync(join(base, candidate)).isFile()) return candidate;
    } catch {
      // keep looking
    }
  }
  return 'index.js';
}
