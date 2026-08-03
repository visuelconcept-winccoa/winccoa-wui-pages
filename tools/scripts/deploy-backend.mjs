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
//   • start any newly-added managers.
// -----------------------------------------------------------------------------
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
if (!noBuild && !dryRun) {
  try {
    console.log(`… npm run build (tsc) in ${ws}`);
    execSync('npm run build', { cwd: ws, stdio: 'inherit' });
  } catch {
    warnings.push(`webserver build failed — run \`npm run build\` manually in ${ws}`);
  }
} else if (noBuild) {
  console.log(`${tag}(skipped build)`);
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
console.log('\nNext (WinCC OA console / pmon):');
console.log(`  • restart the "${wsName}" manager so the rebuilt modules load`);
if (managersCopied.size > 0) console.log(`  • start newly-added managers: ${[...managersCopied].join(', ')}`);

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
