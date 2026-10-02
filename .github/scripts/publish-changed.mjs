#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Publish every lib whose package.json version is not on the registry yet.
// -----------------------------------------------------------------------------
//   node .github/scripts/publish-changed.mjs [--dry-run]
//
// "Changed" is decided against the registry, not against a git diff: a version
// that failed to publish, or a lib never published, is picked up on the next run.
//
//   1. a lib is a folder libs/wui-<id>/ with a package.json that is not "private";
//   2. `npm view <name>@<version>` → absent = to publish;
//   3. every internal dependency range of a lib to publish must be satisfied by
//      the LOCAL version of that lib — otherwise the page would ship against a
//      kit version that does not exist (forgot to bump a range);
//   4. publish in dependency order: kits before the pages using them.
//
// Auth: NODE_AUTH_TOKEN, with an .npmrc pointing @visuelconcept-winccoa at GitHub
// Packages (actions/setup-node does both). --dry-run checks and runs
// `npm publish --dry-run`, nothing leaves the runner.
// -----------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');
const LIBS_DIR = 'libs';
const npm = (args, options = {}) =>
  execFileSync('npm', args, { encoding: 'utf8', shell: process.platform === 'win32', ...options });

const libs = readdirSync(LIBS_DIR)
  .map((dir) => join(LIBS_DIR, dir))
  .filter((dir) => existsSync(join(dir, 'package.json')))
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) }))
  .filter(({ manifest }) => !manifest.private);
const byName = new Map(libs.map((lib) => [lib.manifest.name, lib]));

const internalDependencies = ({ manifest }) =>
  Object.entries(manifest.dependencies ?? {}).filter(([name]) => byName.has(name));

/** Covers the ranges the libs use: exact, ^x.y.z, ~x.y.z. */
function satisfies(version, range) {
  const parse = (text) => text.split('-')[0].split('.').map(Number);
  const [major, minor, patch] = parse(version);
  const operator = /^[\^~]/.test(range) ? range[0] : '';
  const [rMajor, rMinor, rPatch] = parse(range.slice(operator.length));
  const atLeast = major > rMajor || (major === rMajor && (minor > rMinor || (minor === rMinor && patch >= rPatch)));
  if (!operator) return version === range;
  if (!atLeast) return false;
  if (operator === '~') return major === rMajor && minor === rMinor;
  if (rMajor > 0) return major === rMajor;
  if (rMinor > 0) return major === 0 && minor === rMinor;
  return major === 0 && minor === 0 && patch === rPatch;
}

function isPublished({ manifest }) {
  try {
    // The lib's own registry: without --registry, npm view asks npmjs.org unless the
    // scope is mapped in .npmrc — and npmjs answers 404 for every lib.
    const registry = manifest.publishConfig?.registry ? ['--registry', manifest.publishConfig.registry] : [];
    return npm(['view', `${manifest.name}@${manifest.version}`, 'version', ...registry], { stdio: ['ignore', 'pipe', 'pipe'] }).trim() !== '';
  } catch (error) {
    if (/E404|404 Not Found/.test(String(error.stderr))) return false;
    throw new Error(`npm view ${manifest.name} failed:\n${error.stderr}`);
  }
}

/**
 * Kits first: depth-first on the internal dependencies. A cycle (para ⇄
 * app-security: each requires the other's backend) is cut where it closes —
 * `npm publish` installs nothing, so within a cycle any order is valid.
 */
function publishOrder(selection) {
  const ordered = [];
  const seen = new Set();
  const visit = (lib, path) => {
    if (path.includes(lib) || seen.has(lib)) return;
    for (const [name] of internalDependencies(lib)) visit(byName.get(name), [...path, lib]);
    seen.add(lib);
    if (selection.has(lib)) ordered.push(lib);
  };
  for (const lib of selection) visit(lib, []);
  return ordered;
}

const toPublish = new Set(libs.filter((lib) => !isPublished(lib)));
for (const lib of libs) {
  const state = toPublish.has(lib) ? 'to publish' : 'published';
  console.log(`  ${lib.manifest.name}@${lib.manifest.version}  ${state}`);
}

const errors = [];
for (const lib of toPublish) {
  for (const [name, range] of internalDependencies(lib)) {
    const local = byName.get(name).manifest.version;
    if (!satisfies(local, range)) errors.push(`${lib.manifest.name} wants ${name}@${range}, the repo has ${local}`);
  }
}
if (errors.length) {
  console.error(`\nInconsistent ranges — bump them before publishing:\n  ${errors.join('\n  ')}`);
  process.exit(1);
}

const ordered = publishOrder(toPublish);
if (!ordered.length) {
  console.log('\nNothing to publish.');
  process.exit(0);
}

console.log(`\n${DRY_RUN ? 'Would publish' : 'Publishing'}, in this order: ${ordered.map((l) => l.manifest.name).join(', ')}`);
for (const lib of ordered) {
  console.log(`\n::group::${lib.manifest.name}@${lib.manifest.version}`);
  npm(['publish', lib.dir, ...(DRY_RUN ? ['--dry-run'] : [])], { stdio: 'inherit' });
  console.log('::endgroup::');
}
