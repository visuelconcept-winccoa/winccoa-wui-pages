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
const { MSG, PARAM_LABEL, PARAM_OPTION_LABEL, ROLE_LABEL, WARNING_MSG, resolveLang, fmt } = module_;

// The core's warning vocabulary, bundled the same way.
const coreBundle = await esbuild.build({
  entryPoints: [resolve(REPO, 'libs/wui-eng-core/src/warnings.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'silent'
});
const core = await import(`data:text/javascript;base64,${Buffer.from(coreBundle.outputFiles[0].text).toString('base64')}`);
const CORE_CODES = Object.values(core.WARNING_CODES).flatMap((group) => Object.values(group));

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
for (const [key, entry] of [
  ...entries(MSG),
  ...entries(ROLE_LABEL, 'ROLE_LABEL'),
  ...entries(PARAM_LABEL, 'PARAM_LABEL'),
  ...entries(PARAM_OPTION_LABEL, 'PARAM_OPTION_LABEL')
]) {
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

// --- the core's warnings must all be translated, with matching placeholders ---
for (const code of CORE_CODES) {
  const entry = WARNING_MSG[code];
  if (entry === undefined) {
    errors.push(`WARNING_MSG: no translation for the core code "${code}" (it would render in English only)`);
    continue;
  }
  count += 1;
  for (const lang of LANGS) {
    if (typeof entry[lang] !== 'string' || entry[lang].trim() === '') {
      errors.push(`WARNING_MSG["${code}"]: missing or empty "${lang}"`);
    }
  }
  const reference = placeholders(entry.en);
  for (const lang of ['fr', 'de']) {
    if (placeholders(entry[lang]) !== reference) {
      errors.push(`WARNING_MSG["${code}"]: placeholders differ — en={${reference}} ${lang}={${placeholders(entry[lang])}}`);
    }
  }
}
// --- every connection parameter the form renders must have a label ------------
// Same class of defect as an untranslated warning: the core owns the SHAPE of the
// device form, so a parameter added there would render as a raw key ("unitId").
const devicesBundle = await esbuild.build({
  entryPoints: [resolve(REPO, 'libs/wui-eng-core/src/devices.ts')],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  write: false,
  logLevel: 'silent'
});
const devices = await import(`data:text/javascript;base64,${Buffer.from(devicesBundle.outputFiles[0].text).toString('base64')}`);
const PARAM_KEYS = [...new Set(Object.values(devices.PROTOCOL_PARAMS).flatMap((specs) => specs.map((spec) => spec.key)))];
for (const key of PARAM_KEYS) {
  if (PARAM_LABEL[key] === undefined) {
    errors.push(`PARAM_LABEL: no label for the connection parameter "${key}" (the form would show the raw key)`);
  }
}
for (const key of Object.keys(PARAM_LABEL)) {
  if (!PARAM_KEYS.includes(key)) errors.push(`PARAM_LABEL: "${key}" matches no PROTOCOL_PARAMS key (typo, or a removed parameter)`);
}

// Every VALUE a choice/flag parameter can take needs a label too — the raw fallback
// would put "true"/"big" in a dropdown an operator has to interpret.
const OPTION_KEYS = [];
for (const specs of Object.values(devices.PROTOCOL_PARAMS)) {
  for (const spec of specs) {
    if (spec.kind === 'flag') OPTION_KEYS.push(`${spec.key}.true`, `${spec.key}.false`);
    else if (spec.kind === 'choice') OPTION_KEYS.push(...(spec.options ?? []).map((option) => `${spec.key}.${option}`));
    if (spec.kind === 'choice' && (spec.options ?? []).length === 0) {
      errors.push(`PROTOCOL_PARAMS: the choice parameter "${spec.key}" declares no options`);
    }
  }
}
for (const key of [...new Set(OPTION_KEYS)]) {
  if (PARAM_OPTION_LABEL[key] === undefined) errors.push(`PARAM_OPTION_LABEL: no label for the option "${key}"`);
}
for (const key of Object.keys(PARAM_OPTION_LABEL)) {
  if (!OPTION_KEYS.includes(key)) errors.push(`PARAM_OPTION_LABEL: "${key}" matches no declared option (typo, or a removed value)`);
}
console.log(
  `[eng-i18n] ${PARAM_KEYS.length} connection parameters and ${new Set(OPTION_KEYS).size} of their options checked against the label tables.`
);

// A translation nobody emits is dead weight (or a typo in the code).
for (const code of Object.keys(WARNING_MSG)) {
  if (!CORE_CODES.includes(code) && !code.startsWith('demo.') && !code.startsWith('ui.')) {
    errors.push(`WARNING_MSG: "${code}" matches no core code (typo, or a removed warning)`);
  }
}
console.log(`[eng-i18n] ${CORE_CODES.length} core warning codes checked against WARNING_MSG.`);

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
