#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Verify the Engineering Studio's translation table — EN / FR / DE.
// -----------------------------------------------------------------------------
//   node tools/check-eng-i18n.mjs
//
// Checks, on the REAL module (bundled with esbuild, no test runner needed):
//   1. every entry has a non-empty string in all three languages;
//   2. the `{placeholders}` are the SAME set in all three. This is the bug a
//      reviewer never spots: a `{n}` dropped from the German string renders a
//      sentence with a missing number, silently, only for German users;
//   3. no translation is left identical to the English one *by accident* — those
//      are listed as INFO, since many industrial terms are legitimately identical
//      ("OPC UA", "Check-in", "DPE"), and the operator can judge the list.
//   4. `resolveLang` accepts the WinCC OA locale identifiers the shell passes.
//
// Exits non-zero on (1) or (2) — those are defects, not judgement calls.
// -----------------------------------------------------------------------------

import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DEMO_DIR = resolve(REPO, 'libs/wui-eng-studio/demo');
const SOURCE = resolve(REPO, 'libs/wui-eng-studio/src/eng-studio/i18n.ts');

// esbuild comes with the demo harness (which already builds this page).
const demoRequire = createRequire(pathToFileURL(resolve(DEMO_DIR, 'package.json')));
const esbuild = demoRequire('esbuild');

const bundle = await esbuild.build({
  entryPoints: [SOURCE],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'silent'
});
const module_ = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { MSG, ROLE_LABEL, resolveLang, fmt } = module_;

const LANGS = ['en', 'fr', 'de'];
const errors = [];
const identical = [];

/** Walk the (possibly nested) message table, yielding [dotted key, entry]. */
function* entries(node, prefix = '') {
  for (const [key, value] of Object.entries(node)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object' && 'en' in value) yield [path, value];
    else if (value !== null && typeof value === 'object') yield* entries(value, path);
  }
}

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

let count = 0;
for (const [key, entry] of [...entries(MSG), ...entries(ROLE_LABEL, 'ROLE_LABEL')]) {
  count += 1;
  for (const lang of LANGS) {
    const value = entry[lang];
    if (typeof value !== 'string' || value.trim() === '') {
      errors.push(`${key}: missing or empty "${lang}"`);
    }
  }
  const reference = placeholders(entry.en);
  for (const lang of ['fr', 'de']) {
    if (placeholders(entry[lang]) !== reference) {
      errors.push(`${key}: placeholders differ — en={${reference}} ${lang}={${placeholders(entry[lang])}}`);
    }
  }
  if (entry.fr === entry.en || entry.de === entry.en) identical.push(key);
}

// Locale identifiers the WinCC OA shell passes, plus plain tags.
const localeCases = [
  ['en_US.utf8', 'en'],
  ['fr.utf8', 'fr'],
  ['de_AT.utf8', 'de'],
  ['de-CH', 'de'],
  ['FR', 'fr'],
  ['ru', 'en'],
  ['', 'en'],
  [null, 'en']
];
for (const [input, expected] of localeCases) {
  const got = resolveLang(input);
  if (got !== expected) errors.push(`resolveLang(${JSON.stringify(input)}) → "${got}", expected "${expected}"`);
}

if (fmt('{a} and {b} and {missing}', { a: 1, b: 2 }) !== '1 and 2 and {missing}') {
  errors.push('fmt(): an unknown placeholder must be left as-is');
}

console.log(`[eng-i18n] ${count} entries × ${LANGS.length} languages checked.`);
if (identical.length > 0) {
  console.log(`[eng-i18n] INFO — ${identical.length} entr(ies) identical to English (often legitimate): ${identical.join(', ')}`);
}
if (errors.length > 0) {
  console.error(`[eng-i18n] ${errors.length} problem(s):`);
  for (const error of errors) console.error(`  · ${error}`);
  process.exit(1);
}
console.log('[eng-i18n] OK');
