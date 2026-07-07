#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Canonical source-mode installer for a @visuelconcept/wui-<page> module.
// Identical across all pages — module.json declares which surfaces exist
// (frontend.npmDeps?, backend?, managers?), and each section no-ops when absent.
//
//   node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> [options]
//
// Options:
//   --no-build        copy/wire only; skip npm installs + build:pages
//   --register-pmon   append each manager line to <project>/config/progs
//
// Steps (in order, skipping absent surfaces):
//   1. page SOURCE (kit/fleet-core/ai-kit vendored under _vendor/) -> <workspace>/libs/default-components/src/lib/standalone-pages/
//   2. menu entries  -> <workspace>/apps/dashboard-wc/config/menuconfig.jsonc   (idempotent by routeId)
//   3. frontend npm deps -> installed in the workspace (so build:pages can bundle them)
//   4. backend module -> <project>/javascript/customer-webserver/src/modules/<page>/   (auto-discovered)
//   5. managers -> <project>/javascript/<name>/ (+ npm install if a package.json ships; + optional pmon)
//   6. build:pages in the workspace -> <project>/data/dashboard-wc/
//
// After: rebuild the webserver (npm run build) + restart it, start any managers,
// and in the browser do "Clear site data" (the SW caches menuconfig.json;
// Ctrl+Shift+R is NOT enough), then reload.
// -----------------------------------------------------------------------------
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : undefined; };
const has = (n) => process.argv.includes(`--${n}`);

const workspace = arg('workspace');
const project = arg('project');
if (!workspace || !project) {
  console.error('Usage: node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> [--no-build] [--register-pmon]');
  process.exit(1);
}
const m = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8'));
console.log(`Installing ${m.name}@${m.version} (source mode${m.tier ? `, Tier ${m.tier}` : ''})`);
console.log(`  workspace: ${workspace}`);
console.log(`  project:   ${project}`);

// 1. page source -> workspace standalone-pages
const spDir = join(workspace, 'libs', 'default-components', 'src', 'lib', 'standalone-pages');
if (!existsSync(spDir)) {
  console.error(`  ! not a WebUI Runtime workspace (missing ${spDir})`);
  process.exit(1);
}
cpSync(join(HERE, m.frontend.standalonePagesDir), spDir, { recursive: true });
console.log(`  ✓ page source (vendored) -> ${spDir}`);

// 2. menu entries -> workspace menuconfig.jsonc (idempotent text insert after "entries": [)
const menuPath = join(workspace, 'apps', 'dashboard-wc', 'config', 'menuconfig.jsonc');
if (existsSync(menuPath)) {
  let text = readFileSync(menuPath, 'utf8');
  const frag = JSON.parse(readFileSync(join(HERE, m.frontend.menuFragment), 'utf8').replace(/^\s*\/\/.*$/gm, ''));
  let added = 0;
  for (const entry of frag) {
    const rid = entry.routeId;
    if (rid && new RegExp(`"routeId"\\s*:\\s*"${rid}"`).test(text)) continue;
    const block = JSON.stringify(entry, null, 2).split('\n').map((l) => `    ${l}`).join('\n');
    text = text.replace(/("entries"\s*:\s*\[)/, `$1\n${block},`);
    added += 1;
  }
  writeFileSync(menuPath, text);
  console.log(`  ✓ menu: +${added} entr${added === 1 ? 'y' : 'ies'} -> ${menuPath}`);
} else {
  console.warn(`  ! ${menuPath} not found — add the menu fragment manually.`);
}

// 3. frontend npm deps -> install in the workspace
const depSpecs = Object.entries(m.frontend.npmDeps ?? {}).map(([k, v]) => `${k}@${v}`);
if (depSpecs.length && !has('no-build')) {
  try {
    console.log(`  … npm install ${depSpecs.join(' ')} (workspace)`);
    execSync(`npm install ${depSpecs.join(' ')}`, { cwd: workspace, stdio: 'inherit' });
    console.log('  ✓ frontend deps installed in the workspace');
  } catch {
    console.warn(`  ! failed to install ${depSpecs.join(' ')} — run it manually in ${workspace}`);
  }
}

// 4. backend module -> webserver modules/  (auto-discovered by @visuelconcept/wui-webserver)
if (m.backend?.module) {
  const cwDir = join(project, 'javascript', 'customer-webserver');
  if (existsSync(cwDir)) {
    const dst = join(cwDir, 'src', 'modules', basename(m.backend.module));
    cpSync(join(HERE, m.backend.module), dst, { recursive: true });
    console.log(`  ✓ backend module -> ${dst}`);
  } else {
    console.warn(`  ! ${cwDir} not found — install @visuelconcept/wui-webserver first, then re-run.`);
  }
}

// 5. managers -> <project>/javascript/<name>/  (+ npm install if shipped, + optional pmon)
const managers = m.managers ?? (m.manager ? [m.manager] : []);
for (const mgr of managers) {
  const mgrDst = join(project, 'javascript', mgr.name);
  mkdirSync(mgrDst, { recursive: true });
  cpSync(join(HERE, mgr.dir), mgrDst, { recursive: true });
  console.log(`  ✓ manager -> ${mgrDst}`);
  if (!has('no-build') && existsSync(join(mgrDst, 'package.json'))) {
    try {
      console.log(`  … npm install (manager ${mgr.name})`);
      execSync('npm install', { cwd: mgrDst, stdio: 'inherit' });
      console.log('  ✓ manager deps installed');
    } catch {
      console.warn(`  ! manager npm install failed — run it manually in ${mgrDst}`);
    }
  }
  const progs = join(project, 'config', 'progs');
  if (has('register-pmon') && existsSync(progs)) {
    const cur = readFileSync(progs, 'utf8');
    if (cur.includes(`${mgr.name}/index.js`)) {
      console.log(`  • pmon: ${mgr.name} already present (skipped)`);
    } else {
      appendFileSync(progs, `${cur.endsWith('\n') ? '' : '\n'}${mgr.pmon}\n`);
      console.log(`  ✓ pmon line appended for ${mgr.name} — VERIFY order in the WinCC OA console.`);
    }
  } else if (managers.length) {
    console.log(`  → register the manager in pmon:  ${mgr.pmon}`);
  }
}

// 6. build:pages in the workspace, deploying to the project's data/
if (!has('no-build')) {
  const outDir = join(project, 'data', 'dashboard-wc');
  try {
    console.log(`  … npm run build:pages (OUT_DIR=${outDir})`);
    execSync('npm run build:pages', { cwd: workspace, stdio: 'inherit', env: { ...process.env, OUT_DIR: outDir } });
    console.log('  ✓ pages built against the target runtime + deployed');
  } catch {
    console.warn(`  ! build failed — run manually: (cd "${workspace}" ; OUT_DIR="${outDir}" npm run build:pages)`);
  }
}

console.log('\nNext:');
if (m.backend?.module) console.log(`  • backend: (cd "${join(project, 'javascript', 'customer-webserver')}" && npm run build) then restart the webserver manager.`);
for (const mgr of managers) console.log(`  • manager: start "${mgr.name}" in the WinCC OA console.`);
console.log('  • browser: DevTools → Application → Storage → "Clear site data" (the SW caches menuconfig.json — Ctrl+Shift+R is NOT enough), then reload, logged in.');
