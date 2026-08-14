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
  // Backslashes MUST go: this is a textual substitution into a JSON string, and a
  // Windows path like C:\Program Files\Siemens\WinCC_OA\3.21 injects \P \S \W \3 —
  // none of them valid JSON escapes. The file then no longer parses, and every
  // later `npm install` / `npm run build` in the webserver dies on it. Forward
  // slashes are also what npm wants in a `file:` specifier, so this is a fix in
  // both directions. A trailing separator would double up; drop it too.
  const oaPath = winccoa.replaceAll('\\', '/').replace(/\/+$/, '');

  // npm creates a `file:` link WITHOUT checking its target, so a wrong path here
  // yields two dangling junctions: `npm install` looks fine and tsc then fails on
  // EVERY module with "Cannot find module '@winccoa/backend'", never naming the
  // real cause. Refuse up front instead.
  const required = [
    `${oaPath}/javascript/webserver-js`,
    `${oaPath}/javascript/@types/winccoa-manager`
  ];
  const missing = required.filter((p) => !existsSync(p));
  if (missing.length > 0) {
    console.error(`\n✗ --winccoa ${winccoa} does not look like a WinCC OA install root:`);
    for (const p of missing) console.error(`    missing ${p}`);
    console.error(
      '  Pass the VERSION ROOT (the folder containing javascript/), from a version that\n' +
        '  ships the WebUI Runtime webserver — e.g. C:/Program Files/Siemens/WinCC_OA/3.21.\n' +
        '  Left package.json untouched.'
    );
    process.exit(1);
  }

  const pkgPath = join(dest, 'package.json');
  const patched = readFileSync(pkgPath, 'utf8')
    .replace(/file:[^"]*\/javascript\/webserver-js/g, `file:${oaPath}/javascript/webserver-js`)
    .replace(/file:[^"]*\/javascript\/@types\/winccoa-manager/g, `file:${oaPath}/javascript/@types/winccoa-manager`);
  // Cheap guarantee that we did not just break the file (the bug above shipped
  // silently precisely because nothing re-read it).
  try {
    JSON.parse(patched);
  } catch (error) {
    console.error(`\n✗ rewriting package.json would produce invalid JSON: ${error.message}`);
    console.error('  Left package.json untouched.');
    process.exit(1);
  }
  writeFileSync(pkgPath, patched);
  console.log(`  ✓ pointed WinCC OA deps at ${oaPath}`);
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
