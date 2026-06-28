#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Install the third-party npm packages that the `libs/wui-*` pages need beyond
// what the @wincc-oa/webui-runtime workspace already provides (three,
// @novnc/novnc, @cycjimmy/jsmpeg-player, …). Without them the dev server fails
// to resolve a page's imports (e.g. "@cycjimmy/jsmpeg-player not found").
//
//   node tools/install-page-dependencies.mjs [--workspace <dir>] [--check]
//
//   --workspace <dir>  workspace to install into (default: repo root).
//   --check            list what would be installed, install nothing.
//
// Sources of truth:
//   - WHICH packages : the `dependencies` of each libs/wui-*/package.json
//   - WHICH versions : tools/external-dependencies.mjs (libs pin "*")
//   - WHAT to skip   : anything already in the workspace root package.json
//                      (lit, rxjs, tsyringe, @siemens/*, … and echarts, which
//                      is provided by @siemens/ix-echarts).
// -----------------------------------------------------------------------------
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXTERNAL_DEPENDENCIES } from './external-dependencies.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argumentValue = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const checkOnly = hasFlag('check') || hasFlag('dry-run');
const workspace = path.resolve(
  argumentValue('workspace') ?? path.resolve(__dirname, '..')
);
const libsDirectory = path.join(workspace, 'libs');
const rootPackagePath = path.join(workspace, 'package.json');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

// Ranges already recorded by the workspace (name -> range), so we can skip what
// is provided and re-pin an exact dep whose recorded range drifted.
const rootPackage = existsSync(rootPackagePath) ? readJson(rootPackagePath) : {};
const providedRanges = {
  ...rootPackage.dependencies,
  ...rootPackage.devDependencies
};

// Collect external dep names declared by every page lib.
const externalNames = new Set();
if (existsSync(libsDirectory)) {
  for (const dirent of readdirSync(libsDirectory, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !dirent.name.startsWith('wui-')) {
      continue;
    }
    const libraryPackagePath = path.join(
      libsDirectory,
      dirent.name,
      'package.json'
    );
    if (!existsSync(libraryPackagePath)) {
      continue;
    }
    const libraryPackage = readJson(libraryPackagePath);
    const declared = {
      ...libraryPackage.dependencies,
      ...libraryPackage.peerDependencies
    };
    for (const name of Object.keys(declared)) {
      if (name.startsWith('@visuelconcept/') || name.startsWith('@wincc-oa/')) {
        continue;
      }
      externalNames.add(name);
    }
  }
}

// Resolve install name + version; skip what is already satisfied.
const toInstall = new Map(); // installName -> versionRange
const unknown = [];
for (const name of externalNames) {
  const [installName, versionRange] =
    EXTERNAL_DEPENDENCIES[name] ?? [name, undefined];
  const recorded = providedRanges[installName];

  if (versionRange === undefined) {
    // Not in the registry (libs pin "*"). Only flag it if nothing provides it.
    if (recorded === undefined) {
      unknown.push(name);
    }
    continue;
  }

  if (/^\d/.test(versionRange)) {
    // Exact pin: (re)install unless the recorded range is already exact-equal,
    // so a drifted "^1.4.0" gets corrected back to "1.4.0".
    if (recorded !== versionRange) {
      toInstall.set(installName, versionRange);
    }
    continue;
  }

  // Range dep: skip if the workspace already provides it (any range).
  if (recorded === undefined) {
    toInstall.set(installName, versionRange);
  }
}

console.log(`Page dependencies for: ${workspace}`);
if (unknown.length > 0) {
  console.log(
    `  ! no pinned version for: ${unknown.join(', ')} — add it to tools/external-dependencies.mjs (skipped)`
  );
}
if (toInstall.size === 0) {
  console.log('  • nothing to install — all page deps already provided.');
  process.exit(unknown.length > 0 ? 1 : 0);
}

// A version with no range prefix (e.g. "1.4.0") is an EXACT pin and must be
// saved verbatim — npm's default `^` prefix would let @novnc/novnc float to
// 1.7.0 and break its deep import (see DEVELOPMENT.md). Ranges (^, ~, …) save
// normally.
const exactSpecs = [];
const rangeSpecs = [];
for (const [name, range] of toInstall) {
  (/^\d/.test(range) ? exactSpecs : rangeSpecs).push(`${name}@${range}`);
}
for (const spec of [...rangeSpecs, ...exactSpecs]) {
  console.log(`  → ${spec}${exactSpecs.includes(spec) ? '  (exact)' : ''}`);
}

if (checkOnly) {
  console.log(
    `\n${exactSpecs.length + rangeSpecs.length} package(s) would be installed — run without --check.`
  );
  process.exit(0);
}

if (rangeSpecs.length > 0) {
  console.log(`\nnpm install ${rangeSpecs.join(' ')}\n`);
  execSync(`npm install ${rangeSpecs.join(' ')}`, {
    cwd: workspace,
    stdio: 'inherit'
  });
}
if (exactSpecs.length > 0) {
  console.log(`\nnpm install --save-exact ${exactSpecs.join(' ')}\n`);
  execSync(`npm install --save-exact ${exactSpecs.join(' ')}`, {
    cwd: workspace,
    stdio: 'inherit'
  });
}
console.log('\n✓ page dependencies installed.');
