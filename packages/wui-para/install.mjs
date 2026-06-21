#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Source-mode installer for @visuelconcept/wui-para.
//
//   node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> [--no-build]
//
// A page bundle is coupled to the shell's import map, so we build the page IN
// the TARGET's WebUI Runtime workspace (matching its runtime version). Steps:
//   1. copy the page SOURCE   -> <workspace>/libs/default-components/src/lib/standalone-pages/
//   2. insert the menu entry  -> <workspace>/apps/dashboard-wc/config/menuconfig.jsonc  (idempotent)
//   3. copy the backend module -> <project>/javascript/customer-webserver/src/modules/   (for @visuelconcept/wui-webserver)
//   4. build:pages in the workspace with OUT_DIR=<project>/data/dashboard-wc
//
// After install: rebuild the webserver (npm run build) + restart it, and in the
// browser do DevTools -> Application -> Storage -> "Clear site data" (the service
// worker caches menuconfig.json; Ctrl+Shift+R is NOT enough), then reload.
// -----------------------------------------------------------------------------
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i !== -1 ? process.argv[i + 1] : undefined; };
const has = (n) => process.argv.includes(`--${n}`);

const workspace = arg('workspace');
const project = arg('project');
if (!workspace || !project) {
  console.error('Usage: node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root> [--no-build]');
  process.exit(1);
}
const m = JSON.parse(readFileSync(join(HERE, 'module.json'), 'utf8'));
console.log(`Installing ${m.name}@${m.version} (source mode)`);
console.log(`  workspace: ${workspace}`);
console.log(`  project:   ${project}`);

// 1. page source -> workspace standalone-pages
const spDir = join(workspace, 'libs', 'default-components', 'src', 'lib', 'standalone-pages');
if (!existsSync(spDir)) {
  console.error(`  ! not a WebUI Runtime workspace (missing ${spDir})`);
  process.exit(1);
}
cpSync(join(HERE, m.frontend.standalonePagesDir), spDir, { recursive: true });
console.log(`  ✓ page source -> ${spDir}`);

// 2. menu entry -> workspace menuconfig.jsonc (idempotent text insert after "entries": [)
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

// 3. backend module -> webserver modules/  (auto-discovered by @visuelconcept/wui-webserver)
if (m.backend?.module) {
  const cwDir = join(project, 'javascript', 'customer-webserver');
  if (existsSync(cwDir)) {
    const dst = join(cwDir, 'src', 'modules', basename(m.backend.module));
    cpSync(join(HERE, m.backend.module), dst, { recursive: true });
    console.log(`  ✓ backend module -> ${dst}`);
  } else {
    console.warn(`  ! ${cwDir} not found — install @visuelconcept/wui-webserver first (its install.mjs), then re-run.`);
  }
}

// 4. build:pages in the workspace, deploying to the project's data/
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
console.log(`  • backend: (cd "${join(project, 'javascript', 'customer-webserver')}" && npm run build) then restart the webserver manager.`);
console.log('  • browser: DevTools → Application → Storage → "Clear site data" (the SW caches menuconfig.json — Ctrl+Shift+R is NOT enough), then reload, logged in.');
