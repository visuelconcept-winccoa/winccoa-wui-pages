#!/usr/bin/env node
// -----------------------------------------------------------------------------
// One-shot dev-workspace wiring for the `libs/wui-*` pages.
//
// `webui-runtime-init` scaffolds an un-versioned runtime workspace (apps/,
// tsconfig.base.json, package.json). This script patches that scaffold so the
// Vite dev server discovers, serves and menu-links every `libs/wui-<page>` —
// the integration described in DEVELOPMENT.md, applied automatically.
//
//   node tools/wire-workspace.mjs [--workspace <dir>] [--check]
//
//   --workspace <dir>  workspace root to patch (default: repo root, the parent
//                      of tools/). Use it to wire a separate runtime workspace.
//   --check            report what would change, write nothing (exit 1 if any
//                      file still needs wiring).
//
// What it does (all idempotent — safe to re-run after every re-scaffold):
//   1. deploy tools/dev-wiring/{discover-page-libs,page-menu-merge-plugin}.mjs
//      -> <workspace>/apps/dashboard-wc/scripts/
//   2. patch apps/dashboard-wc/vite.shared.ts  (merge discoverPageLibs() into standalonePages)
//   3. patch apps/dashboard-wc/vite.config.ts  (add pageMenuMergePlugin before copyConfigFilesPlugin)
//   4. patch tsconfig.base.json                (paths @visuelconcept/wui-*/* -> libs/wui-*/src/*)
//
// An anchor that cannot be found (and isn't already wired) is a hard error: the
// runtime version probably moved it — patch by hand per DEVELOPMENT.md.
// -----------------------------------------------------------------------------
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const argumentValue = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const checkOnly = hasFlag('check');
const workspace = path.resolve(
  argumentValue('workspace') ?? path.resolve(__dirname, '..')
);
const wiringSourceDirectory = path.join(__dirname, 'dev-wiring');

const HELPERS = ['discover-page-libs.mjs', 'page-menu-merge-plugin.mjs'];
const PUBLIC_URL_PREFIX = '/data/dashboard-wc';

let changed = 0;
let pending = 0;
const log = (mark, message) => console.log(`  ${mark} ${message}`);

/** Apply `edit` to a file unless `isWired(content)` is already true. */
function patchFile(relativePath, isWired, edit) {
  const file = path.join(workspace, relativePath);
  if (!existsSync(file)) {
    log('!', `${relativePath} not found — is this a webui-runtime workspace?`);
    process.exitCode = 1;
    return;
  }

  const before = readFileSync(file, 'utf8');
  if (isWired(before)) {
    log('•', `${relativePath} already wired`);
    return;
  }

  const after = edit(before); // throws if an anchor is missing
  if (checkOnly) {
    log('→', `${relativePath} WOULD be patched`);
    pending += 1;
    return;
  }

  writeFileSync(file, after);
  log('✓', `${relativePath} patched`);
  changed += 1;
}

/** Replace `anchor` with `replacement`, erroring if the anchor is absent. */
function replaceAnchor(content, anchor, replacement, where) {
  if (!content.includes(anchor)) {
    throw new Error(
      `anchor not found in ${where}:\n    ${anchor}\n  The runtime version likely changed it — wire it by hand (see DEVELOPMENT.md).`
    );
  }
  return content.replace(anchor, replacement);
}

// --- 1. deploy helper scripts -------------------------------------------------
function deployHelpers() {
  const destinationDirectory = path.join(
    workspace,
    'apps',
    'dashboard-wc',
    'scripts'
  );
  if (!existsSync(destinationDirectory)) {
    if (checkOnly) {
      log('→', `apps/dashboard-wc/scripts/ missing — WOULD create + deploy helpers`);
      pending += HELPERS.length;
      return;
    }
    mkdirSync(destinationDirectory, { recursive: true });
  }

  for (const helper of HELPERS) {
    const source = path.join(wiringSourceDirectory, helper);
    const destination = path.join(destinationDirectory, helper);
    const fresh = readFileSync(source, 'utf8');
    if (existsSync(destination) && readFileSync(destination, 'utf8') === fresh) {
      log('•', `scripts/${helper} up to date`);
      continue;
    }
    if (checkOnly) {
      log('→', `scripts/${helper} WOULD be deployed`);
      pending += 1;
      continue;
    }
    copyFileSync(source, destination);
    log('✓', `scripts/${helper} deployed`);
    changed += 1;
  }
}

// --- 2. vite.shared.ts --------------------------------------------------------
function patchViteShared() {
  patchFile(
    'apps/dashboard-wc/vite.shared.ts',
    (c) => c.includes('discover-page-libs.mjs'),
    (c) => {
      let out = replaceAnchor(
        c,
        `import { sharedBundles } from './scripts/discover-exports.mjs';`,
        `import { discoverPageLibs } from './scripts/discover-page-libs.mjs';\nimport { sharedBundles } from './scripts/discover-exports.mjs';`,
        'vite.shared.ts (import)'
      );
      out = replaceAnchor(
        out,
        `export const standalonePages: Record<string, string> =\n  discoverStandalonePages();`,
        `export const standalonePages: Record<string, string> = {\n  ...discoverStandalonePages(),\n  ...discoverPageLibs()\n};`,
        'vite.shared.ts (standalonePages)'
      );
      return out;
    }
  );
}

// --- 3. vite.config.ts --------------------------------------------------------
function patchViteConfig() {
  patchFile(
    'apps/dashboard-wc/vite.config.ts',
    (c) => c.includes('page-menu-merge-plugin.mjs'),
    (c) => {
      let out = replaceAnchor(
        c,
        `import { createLicensePlugin } from './scripts/license-plugin-config.mjs';`,
        `import { createLicensePlugin } from './scripts/license-plugin-config.mjs';\nimport { pageMenuMergePlugin } from './scripts/page-menu-merge-plugin.mjs';`,
        'vite.config.ts (import)'
      );
      out = replaceAnchor(
        out,
        `      copyConfigFilesPlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' }),`,
        `      // Must precede copyConfigFilesPlugin so it serves menuconfig.json first,\n` +
          `      // merging each libs/wui-<page>/menu.fragment.jsonc into the dev nav (dev only).\n` +
          `      pageMenuMergePlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' }),\n` +
          `      copyConfigFilesPlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' }),`,
        'vite.config.ts (plugins)'
      );
      return out;
    }
  );
}

// --- 4. tsconfig.base.json ----------------------------------------------------
/** Build `@visuelconcept/wui-*\/*` -> `libs/wui-*\/src/*` from the libs dir. */
function visuelconceptPaths() {
  const libsDirectory = path.join(workspace, 'libs');
  const entries = {};
  if (!existsSync(libsDirectory)) return entries;
  for (const dirent of readdirSync(libsDirectory, { withFileTypes: true })) {
    if (dirent.isDirectory() && dirent.name.startsWith('wui-')) {
      entries[`@visuelconcept/${dirent.name}/*`] = [`libs/${dirent.name}/src/*`];
    }
  }
  return entries;
}

function patchTsconfigPaths() {
  const relativePath = 'tsconfig.base.json';
  const file = path.join(workspace, relativePath);
  if (!existsSync(file)) {
    log('!', `${relativePath} not found`);
    process.exitCode = 1;
    return;
  }

  const content = readFileSync(file, 'utf8');
  const json = JSON.parse(content);
  const existing = json.compilerOptions?.paths;
  if (!existing) {
    log('!', `${relativePath}: compilerOptions.paths absent — wire it by hand.`);
    process.exitCode = 1;
    return;
  }

  // Keep non-generated entries, regenerate every @visuelconcept/wui-* one.
  const kept = Object.fromEntries(
    Object.entries(existing).filter(([k]) => !k.startsWith('@visuelconcept/wui-'))
  );
  const desired = { ...kept, ...visuelconceptPaths() };

  // Serialize ONLY the paths object back into the original text, so the rest of
  // the file (lib, ts-lit globalTags, …) stays byte-identical.
  const body = Object.entries(desired)
    .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(',\n');
  const replacement = `"paths": {\n${body}\n    }`;

  // paths holds only string→array entries, so the first `}` closes it.
  const next = content.replace(/"paths":\s*\{[^}]*\}/, replacement);
  if (next === content) {
    log('•', `${relativePath} paths already up to date`);
    return;
  }
  if (checkOnly) {
    log('→', `${relativePath} paths WOULD be updated`);
    pending += 1;
    return;
  }
  writeFileSync(file, next);
  log(
    '✓',
    `${relativePath} paths updated (${Object.keys(visuelconceptPaths()).length} wui libs)`
  );
  changed += 1;
}

// --- run ----------------------------------------------------------------------
console.log(
  `Wiring dev workspace (${checkOnly ? 'check' : 'apply'}): ${workspace}`
);
try {
  deployHelpers();
  patchViteShared();
  patchViteConfig();
  patchTsconfigPaths();
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}

if (checkOnly) {
  console.log(
    pending
      ? `\n${pending} item(s) need wiring — run without --check.`
      : '\nAll wired.'
  );
  process.exit(pending ? 1 : 0);
}
console.log(
  changed
    ? `\nDone — ${changed} change(s). Start the dev server:  npm start`
    : '\nAlready fully wired — nothing to do.'
);
