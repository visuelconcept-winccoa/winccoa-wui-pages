#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Step 0 of a fresh clone: CREATE and POPULATE `.runtime/`, then hand over to
// tools/wire-workspace.mjs. It automates section 1 of DEVELOPMENT.md — the five
// commands nobody remembers — and nothing else:
//
//   1. mkdir .runtime + a minimal package.json  (npm cannot infer a package name
//      from a folder called ".runtime": the leading dot is not a legal npm name)
//   2. npm install @wincc-oa/webui-runtime@<version>
//   3. npx webui-runtime-init          (scaffolds apps/, libs/default-components/, …)
//   4. npm install --save-dev --no-audit --no-fund
//   5. npm run init:oa-data
//   6. node tools/wire-workspace.mjs   (unless --no-wire)
//
//   node tools/bootstrap-workspace.mjs [--version <spec>] [--workspace <dir>]
//                                      [--reinit] [--no-wire] [--no-deps] [--check]
//
//   --version <spec>   version of @wincc-oa/webui-runtime to install. Default
//                      `latest`. PIN IT to the version of the TARGET project: a
//                      page bundle is welded to the import map of the shell that
//                      built it (DEVELOPMENT.md, "Build on the TARGET's runtime
//                      version"). One `.runtime/` per runtime version.
//   --workspace <dir>  where to create the workspace. Default `<repo>/.runtime`.
//   --reinit           re-run `webui-runtime-init` even though the workspace is
//                      already scaffolded (that regenerates apps/ and
//                      libs/default-components/ pristine — the wiring step below
//                      re-applies our patches, so this is a supported repair).
//   --no-wire          stop after step 5, do not chain wire-workspace.mjs.
//   --no-deps          forwarded to wire-workspace.mjs (skip the pages' deps).
//   --check            report what would run, change nothing.
//
// Idempotent: on an already-bootstrapped workspace it re-installs (a no-op),
// skips `webui-runtime-init` unless `--reinit`, and re-wires.
//
// Why this is not a shell one-liner in .vscode/tasks.json: the steps run in two
// different working directories, `&&` is a parse error in Windows PowerShell, and
// the guard below (never scaffold on top of a repo root) must live somewhere it
// cannot be skipped.
// -----------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argumentValue = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const checkOnly = hasFlag('check');
const repoRoot = path.resolve(__dirname, '..');
const workspace = path.resolve(
  argumentValue('workspace') ?? path.join(repoRoot, '.runtime')
);
const runtimeVersion = argumentValue('version') ?? 'latest';
const packageSpec = `@wincc-oa/webui-runtime@${runtimeVersion}`;

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const log = (mark, message) => console.log(`  ${mark} ${message}`);

/**
 * The one thing this script must never do. The scaffold's postinstall copies
 * itself over the calling directory with `force: true`: run at a repo root it
 * overwrites LICENSE (AGPL -> MIT), README.md, AGENTS.md, CLAUDE.md and
 * .gitignore. `git checkout` would undo it — but only for what is tracked, and
 * only if you noticed.
 */
if (workspace === repoRoot || existsSync(path.join(workspace, '.git'))) {
  console.error(
    `\n✗ Refusing to scaffold into ${workspace}\n` +
      `  webui-runtime-init overwrites LICENSE, README.md, AGENTS.md, CLAUDE.md and\n` +
      `  .gitignore in the directory it runs in. It belongs in its own folder —\n` +
      `  drop --workspace to use the default <repo>/.runtime.`
  );
  process.exit(1);
}

/** Run a command in the workspace, aborting the bootstrap on a non-zero exit. */
function run(command, args, { hint } = {}) {
  const printable = `${command} ${args.join(' ')}`;
  if (checkOnly) {
    log('·', `would run: ${printable}`);
    return;
  }
  console.log(`\n$ ${printable}`);
  const result = spawnSync(command, args, {
    cwd: workspace,
    stdio: 'inherit',
    // npm/npx are .cmd shims on Windows and are not spawnable without a shell.
    shell: process.platform === 'win32'
  });
  if (result.status !== 0) {
    console.error(
      `\n✗ \`${printable}\` failed (exit ${result.status}).` + (hint ? `\n  ${hint}` : '')
    );
    process.exit(1);
  }
}

console.log(`Bootstrap ${path.relative(repoRoot, workspace) || workspace}`);
console.log(`  runtime  ${packageSpec}`);

// --- 1. the folder + a package.json npm will accept ----------------------------
const workspacePackagePath = path.join(workspace, 'package.json');
if (existsSync(workspacePackagePath)) {
  log('=', 'package.json already there');
} else if (checkOnly) {
  log('·', 'would create the folder + a minimal package.json');
} else {
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    workspacePackagePath,
    `${JSON.stringify(
      {
        name: 'winccoa-wui-runtime',
        version: '0.0.0',
        private: true,
        description:
          'WebUI Runtime workspace for winccoa-wui-pages — generated, never committed.'
      },
      null,
      2
    )}\n`
  );
  log('+', 'folder + minimal package.json');
}

// --- 2. the runtime package ----------------------------------------------------
run('npm', ['install', packageSpec, '--no-audit', '--no-fund'], {
  hint:
    runtimeVersion === 'latest'
      ? 'Check the registry access / the npm proxy.'
      : `Does that version exist?  npm view @wincc-oa/webui-runtime versions`
});

// --- 3. the scaffold -----------------------------------------------------------
if (existsSync(path.join(workspace, 'apps')) && !hasFlag('reinit')) {
  log(
    '=',
    'already scaffolded (apps/ present) — skipping webui-runtime-init, --reinit forces it'
  );
} else {
  run('npx', ['webui-runtime-init'], {
    hint: 'Some versions ask questions — then run it by hand from the workspace.'
  });
}

// --- 4 & 5. the workspace's own dev deps, then its oa-data ---------------------
run('npm', ['install', '--save-dev', '--no-audit', '--no-fund']);

const workspaceScripts = existsSync(workspacePackagePath)
  ? (readJson(workspacePackagePath).scripts ?? {})
  : {};
if (workspaceScripts['init:oa-data']) {
  run('npm', ['run', 'init:oa-data']);
} else if (checkOnly) {
  log('·', 'would run: npm run init:oa-data (if the scaffold still declares it)');
} else {
  log('!', 'no `init:oa-data` script in the workspace — skipped (runtime version moved it?)');
}

// --- 6. our wiring -------------------------------------------------------------
// Chained on purpose: a scaffolded-but-unwired workspace serves the runtime's own
// pages only and otherwise looks like a successful setup.
if (hasFlag('no-wire')) {
  console.log(
    '\nWorkspace populated. Not wired (--no-wire) — finish with:  node tools/wire-workspace.mjs'
  );
  process.exit(0);
}

const wireArguments = [
  path.join(__dirname, 'wire-workspace.mjs'),
  '--workspace',
  workspace
];
if (hasFlag('no-deps')) wireArguments.push('--no-deps');
if (checkOnly) wireArguments.push('--check');
console.log('\nWiring');
const wired = spawnSync(process.execPath, wireArguments, { stdio: 'inherit' });
if (!checkOnly && wired.status !== 0) {
  console.error(
    `\n✗ wire-workspace failed (exit ${wired.status}). The workspace itself is populated;\n` +
      `  fix the wiring and re-run:  node tools/wire-workspace.mjs`
  );
  process.exit(1);
}

if (checkOnly) process.exit(0);
console.log(
  `\nDone. Start the dev server:  npm start  (from ${
    path.relative(repoRoot, workspace) || workspace
  }, with BASE_URL=https://<oa-host>:<httpsPort>)`
);
