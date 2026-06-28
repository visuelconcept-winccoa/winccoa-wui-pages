#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// One-command installer for @visuelconcept/wui-webserver — the prerequisite
// dashboard webserver (customer-webserver base + backend-module auto-discovery).
//
//   node install.mjs --project <winccoa-project-root> [options]
//
// Options:
//   --name <dir>        manager folder name under <project>/javascript/  (default: customer-webserver)
//   --winccoa <path>    WinCC OA install path to point the file: deps at
//                       (default: keep package.json as-is, i.e. .../WinCC_OA/3.21)
//   --no-build          copy only; skip `npm install` + `npm run build`
//   --register-pmon     also append the manager line to <project>/config/progs
//
// Steps: copy the webserver into <project>/javascript/<name>/, install deps,
// compile (tsc), and print the pmon manager line. After this, page modules
// install their backend by dropping a folder into <name>/src/modules/.
// -----------------------------------------------------------------------------
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv;
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i !== -1 ? argv[i + 1] : undefined;
};
const has = (name) => argv.includes(`--${name}`);

const project = arg('project');
const name = arg('name') ?? 'customer-webserver';
const winccoa = arg('winccoa');
if (!project) {
  console.error('Usage: node install.mjs --project <winccoa-project-root> [--name <dir>] [--winccoa <path>] [--no-build] [--register-pmon]');
  process.exit(1);
}

const dest = join(project, 'javascript', name);
console.log(`Installing @visuelconcept/wui-webserver -> ${dest}`);
mkdirSync(dest, { recursive: true });

// 1. copy source (node_modules / dist are produced in place by the build below)
for (const f of ['run.js', 'package.json', 'tsconfig.json', 'src']) {
  cpSync(join(HERE, f), join(dest, f), { recursive: true });
}
console.log('  ✓ copied run.js, package.json, tsconfig.json, src/ (with the modules/ loader)');

// 2. optionally retarget the WinCC OA install path in the file: deps
if (winccoa) {
  const pkgPath = join(dest, 'package.json');
  const patched = readFileSync(pkgPath, 'utf8')
    .replace(/file:[^"]*\/javascript\/webserver-js/g, `file:${winccoa}/javascript/webserver-js`)
    .replace(/file:[^"]*\/javascript\/@types\/winccoa-manager/g, `file:${winccoa}/javascript/@types/winccoa-manager`);
  writeFileSync(pkgPath, patched);
  console.log(`  ✓ pointed WinCC OA deps at ${winccoa}`);
}

// 3. install + build
if (!has('no-build')) {
  try {
    console.log('  … npm install (this fetches uWebSockets.js from GitHub — needs network once)');
    execSync('npm install', { cwd: dest, stdio: 'inherit' });
    console.log('  … npm run build (tsc -> dist/)');
    execSync('npm run build', { cwd: dest, stdio: 'inherit' });
    console.log('  ✓ built');
  } catch {
    console.warn(`  ! build step failed — run \`npm install\` then \`npm run build\` manually in ${dest}`);
  }
}

// 4. pmon manager registration
const pmonLine = `node | always | 30 | 2 | 2 |${name}/run.js`;
const progs = join(project, 'config', 'progs');
if (has('register-pmon') && existsSync(progs)) {
  const cur = readFileSync(progs, 'utf8');
  if (cur.includes(`${name}/run.js`)) {
    console.log('  • pmon: a line for this manager already exists (skipped)');
  } else {
    appendFileSync(progs, `${cur.endsWith('\n') ? '' : '\n'}${pmonLine}\n`);
    console.log(`  ✓ pmon line appended to config/progs — VERIFY the manager number/order in the WinCC OA console.`);
  }
} else {
  console.log('  → register the manager: add this manager in the WinCC OA console (pmon), parameter');
  console.log(`      ${name}/run.js   (or add to config/progs:  ${pmonLine})`);
}

console.log('');
console.log('Done. This manager IS the dashboard webserver — ensure no OTHER webserver manager');
console.log('(e.g. webserver-js/run.js) runs on the same httpsPort. Then start/restart the manager.');
console.log(`Add page-module backends later with each module\'s install.mjs (--webserver ${join(dest, 'src')}).`);
