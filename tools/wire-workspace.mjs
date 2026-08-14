#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// THE single command that makes a freshly scaffolded runtime workspace usable.
//
// `webui-runtime-init` regenerates an un-versioned workspace (apps/,
// libs/default-components/, tsconfig.base.json, package.json) — pristine, every
// time. So this is not a setup script but a REAPPLIABLE PATCH SET: it re-teaches
// that scaffold about the `libs/wui-*` pages, re-applies the shell fixes we own,
// and finishes by installing the pages' third-party deps.
//
// Run it after every re-scaffold and after adding or removing a page lib.
//
//   node tools/wire-workspace.mjs [--workspace <dir>] [--check] [--no-deps]
//
//   --workspace <dir>  workspace root to patch. Defaults to `<repo>/.runtime`
//                      when that exists (the separate-workspace layout), else to
//                      the repo root (scaffold laid on top) — so the usual case
//                      needs no flag.
//   --check            report what would change, write nothing (exit 1 if any
//                      file still needs wiring). Chains the edits in memory, so a
//                      patch anchored on an earlier patch's output is judged
//                      correctly instead of raising a false "anchor not found".
//   --no-deps          skip the final install-page-dependencies step.
//
// The pages are NEVER copied or linked into the workspace: their location is
// written to apps/dashboard-wc/scripts/wui-pages-root.json and read by the three
// deployed plugins. Config, not filesystem links — see wui-pages-root.mjs for why.
//
// What it does (all idempotent — safe to re-run after every re-scaffold):
//   1. deploy tools/dev-wiring/{discover-page-libs,page-menu-merge-plugin,page-appsec-merge-plugin}.mjs
//      -> <workspace>/apps/dashboard-wc/scripts/
//   2. patch apps/dashboard-wc/vite.shared.ts       (merge discoverPageLibs() into standalonePages)
//   3. patch apps/dashboard-wc/vite.config.ts       (add pageMenuMergePlugin + pageAppsecMergePlugin)
//   4. patch apps/dashboard-wc/vite.config.pages.ts (add pageMenuMergePlugin + pageAppsecMergePlugin for the build:pages merges)
//   5. patch tsconfig.base.json                     (paths @visuelconcept/wui-*/* -> libs/wui-*/src/*)
//   6. patch libs/default-components/src/lib/webui-app-ix.ts (chromeless shell for Mosaïque tiles; embed flag read from the hash so the root redirect / SPA router can't strip it)
//   7. patch libs/default-components/src/lib/route-generators/route-generator-utils.ts (loadModuleWithFallback: always try import(), only /error on real failure — fixes blank page on first nav)
//   8. patch libs/default-components/src/lib/services/webui-ix-routes.service.ts (route action honors the loader's redirect instead of rendering a blank element)
//
// Patches 6-8 are SHELL customizations re-integrated into the runtime scaffold
// after each re-scaffold (same model as the menu fragments) — keep them here,
// never hand-edit the scaffolded default-components.
//
// An anchor that cannot be found (and isn't already wired) is a hard error: the
// runtime version probably moved it — patch by hand per DEVELOPMENT.md.
// -----------------------------------------------------------------------------
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import { spawnSync } from 'node:child_process';
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
/**
 * The workspace defaults to `<repo>/.runtime` when that folder exists (the
 * separate-workspace layout), else to the repo itself (scaffold on top). So the
 * common case needs no `--workspace` flag at all.
 */
const defaultWorkspace = existsSync(path.join(repoRoot, '.runtime', 'apps'))
  ? path.join(repoRoot, '.runtime')
  : repoRoot;
const workspace = path.resolve(argumentValue('workspace') ?? defaultWorkspace);
const separateWorkspace = workspace !== repoRoot;
const wiringSourceDirectory = path.join(__dirname, 'dev-wiring');
const repoLibs = path.join(repoRoot, 'libs');

const HELPERS = [
  'wui-pages-root.mjs',
  'discover-page-libs.mjs',
  'page-menu-merge-plugin.mjs',
  'page-appsec-merge-plugin.mjs'
];
const PUBLIC_URL_PREFIX = '/data/dashboard-wc';

let changed = 0;
let pending = 0;
const log = (mark, message) => console.log(`  ${mark} ${message}`);

/**
 * Pending edits, in `--check` mode only: relativePath -> content as it WOULD be.
 *
 * Several files take more than one patch, and a later patch anchors on text an
 * earlier one inserts (e.g. the appsec plugin anchors on the menu plugin's import
 * line). Since `--check` writes nothing, the later patch used to read the
 * untouched file, miss its anchor and abort with
 * "anchor not found — the runtime version likely changed it" — a FALSE alarm on a
 * perfectly fine fresh scaffold, and one that hid real problems. Chaining the
 * edits in memory makes `--check` see exactly what `--apply` would produce.
 */
const virtualFiles = new Map();

/** Apply `edit` to a file unless `isWired(content)` is already true. */
function patchFile(relativePath, isWired, edit) {
  const file = path.join(workspace, relativePath);
  if (!existsSync(file)) {
    log('!', `${relativePath} not found — is this a webui-runtime workspace?`);
    process.exitCode = 1;
    return;
  }

  const before = virtualFiles.get(relativePath) ?? readFileSync(file, 'utf8');
  if (isWired(before)) {
    log('•', `${relativePath} already wired`);
    return;
  }

  const after = edit(before); // throws if an anchor is missing
  if (checkOnly) {
    virtualFiles.set(relativePath, after);
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

// --- 1b. tell the deployed helpers where the pages live -----------------------
/**
 * Write `apps/dashboard-wc/scripts/wui-pages-root.json`, the ONE place that says
 * where the `wui-*` page libs are. This is what replaces linking the libs into
 * the workspace: config instead of junctions/symlinks — nothing for a `readdir`
 * to mis-detect, identical on every OS, and it survives a zip or a CI checkout.
 *
 * Removed again when the workspace IS the repo, so switching back to the
 * scaffold-on-top layout cannot leave a stale pointer behind.
 */
function writePagesRoot() {
  const relativePath = path.join('apps', 'dashboard-wc', 'scripts', 'wui-pages-root.json');
  const file = path.join(workspace, relativePath);
  const pretty = relativePath.replaceAll('\\', '/');

  if (!separateWorkspace) {
    if (!existsSync(file)) {
      log('•', `${pretty} not needed (workspace IS the repo)`);
      return;
    }
    if (checkOnly) {
      log('→', `${pretty} WOULD be removed (workspace IS the repo)`);
      pending += 1;
      return;
    }
    rmSync(file);
    log('✓', `${pretty} removed (workspace IS the repo)`);
    changed += 1;
    return;
  }

  // Forward slashes: the file is read by JS on every platform, and a Windows
  // backslash would need escaping in JSON.
  const fresh = `${JSON.stringify(
    {
      _comment:
        'Generated by tools/wire-workspace.mjs — do not edit. Says where the wui-* page libs live.',
      repoRoot: repoRoot.replaceAll('\\', '/'),
      libsDirectory: repoLibs.replaceAll('\\', '/')
    },
    null,
    2
  )}\n`;

  if (existsSync(file) && readFileSync(file, 'utf8') === fresh) {
    log('•', `${pretty} up to date`);
    return;
  }
  if (checkOnly) {
    log('→', `${pretty} WOULD point at ${repoLibs}`);
    pending += 1;
    return;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, fresh);
  log('✓', `${pretty} -> ${repoLibs}`);
  changed += 1;
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

// --- 4. vite.config.pages.ts --------------------------------------------------
// The pages-only build (build:pages) uses this config and copies menuconfig.json
// via copyConfigFilesPlugin WITHOUT the page fragments. Add pageMenuMergePlugin
// so its build hook (closeBundle) merges libs/wui-<page>/menu.fragment.jsonc into
// the emitted menuconfig.json — the build counterpart of the dev middleware.
function patchViteConfigPages() {
  patchFile(
    'apps/dashboard-wc/vite.config.pages.ts',
    (c) => c.includes('page-menu-merge-plugin.mjs'),
    (c) => {
      let out = replaceAnchor(
        c,
        `import { createLicensePlugin } from './scripts/license-plugin-config.mjs';`,
        `import { createLicensePlugin } from './scripts/license-plugin-config.mjs';\nimport { pageMenuMergePlugin } from './scripts/page-menu-merge-plugin.mjs';`,
        'vite.config.pages.ts (import)'
      );
      out = replaceAnchor(
        out,
        `  plugins: [nxViteTsPaths(), copyConfigFilesPlugin()],`,
        `  plugins: [\n` +
          `    nxViteTsPaths(),\n` +
          `    copyConfigFilesPlugin(),\n` +
          `    // Merge libs/wui-<page>/menu.fragment.jsonc into the built menuconfig.json\n` +
          `    // (build counterpart of the dev middleware; idempotent by routeId).\n` +
          `    pageMenuMergePlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' })\n` +
          `  ],`,
        'vite.config.pages.ts (plugins)'
      );
      return out;
    }
  );
}

// --- 4b. vite.config.pages.ts — content-hashed chunk names ---------------------
// The pages build emits shared chunks (kit, stores…) with FIXED names
// (pages/chunks/[name].js). When a deploy reshuffles the chunk graph, a browser
// or the service worker can mix an OLD chunk with a NEW one under the same URL,
// which throws `SyntaxError: The requested module './x.js' does not provide an
// export named 'y'` and blank pages — intermittently, on any page, until every
// cache expires. Content-hashed names make each build's graph atomic: old and
// new chunks coexist, imports always resolve against the matching build.
// Entry names ([name].js) stay stable — menuconfig references them.
function patchViteConfigPagesChunkHash() {
  patchFile(
    'apps/dashboard-wc/vite.config.pages.ts',
    (c) => c.includes(`chunkFileNames: 'pages/chunks/[name]-[hash].js'`),
    (c) => {
      let out = replaceAnchor(
        c,
        `chunkFileNames: 'pages/chunks/[name].js',`,
        `chunkFileNames: 'pages/chunks/[name]-[hash].js',`,
        'vite.config.pages.ts (chunkFileNames)'
      );
      out = replaceAnchor(
        out,
        `assetFileNames: 'pages/assets/[name].[ext]',`,
        `assetFileNames: 'pages/assets/[name]-[hash].[ext]',`,
        'vite.config.pages.ts (assetFileNames)'
      );
      return out;
    }
  );
}

// --- 4c. vite.config.ts — app-security manifest merge (dev) -------------------
// Serves <prefix>/app-security-manifest.json by aggregating every
// libs/wui-<page>/src/app-security.roles.json — the app-security "Discover"
// seed, with no central manifest. Runs alongside pageMenuMergePlugin (patched
// in first, so its plugin line is the anchor).
function patchViteConfigAppsec() {
  patchFile(
    'apps/dashboard-wc/vite.config.ts',
    (c) => c.includes('page-appsec-merge-plugin.mjs'),
    (c) => {
      let out = replaceAnchor(
        c,
        `import { pageMenuMergePlugin } from './scripts/page-menu-merge-plugin.mjs';`,
        `import { pageMenuMergePlugin } from './scripts/page-menu-merge-plugin.mjs';\nimport { pageAppsecMergePlugin } from './scripts/page-appsec-merge-plugin.mjs';`,
        'vite.config.ts (appsec import)'
      );
      out = replaceAnchor(
        out,
        `      pageMenuMergePlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' }),`,
        `      pageMenuMergePlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' }),\n` +
          `      // Aggregate each libs/wui-<page>/src/app-security.roles.json into\n` +
          `      // <prefix>/app-security-manifest.json (app-security "Discover" seed; dev only).\n` +
          `      pageAppsecMergePlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' }),`,
        'vite.config.ts (appsec plugin)'
      );
      return out;
    }
  );
}

function patchViteConfigPagesAppsec() {
  patchFile(
    'apps/dashboard-wc/vite.config.pages.ts',
    (c) => c.includes('page-appsec-merge-plugin.mjs'),
    (c) => {
      let out = replaceAnchor(
        c,
        `import { pageMenuMergePlugin } from './scripts/page-menu-merge-plugin.mjs';`,
        `import { pageMenuMergePlugin } from './scripts/page-menu-merge-plugin.mjs';\nimport { pageAppsecMergePlugin } from './scripts/page-appsec-merge-plugin.mjs';`,
        'vite.config.pages.ts (appsec import)'
      );
      out = replaceAnchor(
        out,
        `    pageMenuMergePlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' })`,
        `    pageMenuMergePlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' }),\n` +
          `    // Emit <outDir>/app-security-manifest.json (build counterpart of the dev merge).\n` +
          `    pageAppsecMergePlugin({ publicUrlPrefix: '${PUBLIC_URL_PREFIX}' })`,
        'vite.config.pages.ts (appsec plugin)'
      );
      return out;
    }
  );
}

// --- 4c-bis. the runtime's AI-assistant skills, copied into this repo ----------
/**
 * `webui-runtime-init` ships the `winccoa-*` skills (widget, standalone-page,
 * menu, branding, shared-bundles, api-standalone, web-guide) in three flavours.
 * They live in the workspace, but the assistant runs HERE — and Claude Code &
 * co. only look at the project directory, they do not descend into `.runtime/`.
 *
 * COPIED, not linked, and that is deliberate: whether a given assistant's skill
 * DISCOVERY walks a junction is unverifiable from inside a session (it happens at
 * startup), and today's lesson is precisely that links get mis-detected — five
 * `isDirectory()` filters, plus `exports` conditions on aliased packages. A copy
 * assumes nothing. It is refreshed on every run of this script, which is already
 * the ritual after a runtime upgrade, so staleness is bounded.
 *
 * Only the LEAF folders are touched: your own `.claude/settings.json`,
 * `.claude/agents/` and `.github/workflows/` are never read or written here.
 * All three are gitignored — third-party content that must not be committed.
 */
const SKILL_DIRECTORIES = [
  path.join('.claude', 'skills'),
  path.join('.ai', 'skills'),
  path.join('.github', 'prompts')
];

function copySkills() {
  if (!separateWorkspace) {
    log('•', 'skills already in place (workspace IS the repo)');
    return;
  }
  for (const relative of SKILL_DIRECTORIES) {
    const source = path.join(workspace, relative);
    const destination = path.join(repoRoot, relative);
    const pretty = relative.replaceAll('\\', '/');

    if (!existsSync(source)) {
      log('•', `${pretty} not shipped by this runtime — skipped`);
      continue;
    }

    // A leftover link from an earlier layout would make cpSync write THROUGH it,
    // back into the workspace. Unlink first (rmdir touches only the link).
    try {
      if (lstatSync(destination).isSymbolicLink()) {
        if (checkOnly) {
          log('→', `${pretty} is a link — WOULD be replaced by a copy`);
          pending += 1;
          continue;
        }
        try {
          unlinkSync(destination);
        } catch {
          rmdirSync(destination);
        }
      }
    } catch {
      /* absent — nothing to unlink */
    }

    if (sameTree(source, destination)) {
      log('•', `${pretty} up to date`);
      continue;
    }
    if (checkOnly) {
      log('→', `${pretty} WOULD be refreshed from the workspace`);
      pending += 1;
      continue;
    }
    // Replace wholesale so a skill deleted upstream disappears here too.
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(path.dirname(destination), { recursive: true });
    cpSync(source, destination, { recursive: true });
    log('✓', `${pretty} refreshed from the workspace`);
    changed += 1;
  }
}

/** Shallow-but-sufficient equality: same relative file list, same sizes. */
function sameTree(a, b) {
  if (!existsSync(b)) return false;
  const list = (root, prefix = '') => {
    const out = [];
    for (const dirent of readdirSync(path.join(root, prefix), { withFileTypes: true })) {
      const rel = path.join(prefix, dirent.name);
      if (dirent.isDirectory()) out.push(...list(root, rel));
      else out.push(`${rel.replaceAll('\\', '/')}:${statSync(path.join(root, rel)).size}`);
    }
    return out.sort();
  };
  try {
    return list(a).join('|') === list(b).join('|');
  } catch {
    return false;
  }
}

// --- 4d. one junction: <repo>/node_modules -> <workspace>/node_modules --------
/**
 * The ONLY link in the whole layout, and the reason the page libs need none.
 *
 * The pages stay in their repo (wui-pages-root.json says where), but their bare
 * imports — '@wincc-oa/…', 'three', '@novnc/novnc' — must resolve, and Node walks
 * up from the IMPORTER, i.e. from the repo, which owns no node_modules. Pointing
 * <repo>/node_modules at the workspace's makes ordinary Node resolution work:
 *
 *   • `exports` conditions are honoured. Aliasing a package to a directory path
 *     instead BYPASSES them, which silently picks the browser build — vitest in
 *     the 'node' environment then dies on `self is not defined`.
 *   • the page libs' own vitest.config.ts files run unchanged, from the repo.
 *   • a spec that walks up looking for node_modules/… finds it
 *     (libs/wui-gis/src/gis/icons.spec.ts does exactly that).
 *   • nothing to generate and nothing to keep in sync with the dep list.
 *
 * Why this link is safe where 27 lib links were not: nothing in this codebase
 * scans node_modules looking for pages, so no `dirent.isDirectory()` filter can
 * mis-detect it, and its failure mode is a loud "Cannot find package", never a
 * silent empty build. It is also gitignored by default.
 */
function linkNodeModules() {
  if (!separateWorkspace) {
    log('•', 'node_modules link not needed (workspace IS the repo)');
    return;
  }
  const linkPath = path.join(repoRoot, 'node_modules');
  const target = path.join(workspace, 'node_modules');

  if (!existsSync(target)) {
    log('!', 'workspace has no node_modules — run npm install there first');
    process.exitCode = 1;
    return;
  }

  let current;
  try {
    current = lstatSync(linkPath).isSymbolicLink()
      ? path.resolve(readlinkSync(linkPath).replace(/[\\/]+$/, ''))
      : undefined;
  } catch {
    current = undefined; // absent
  }

  if (current === path.resolve(target)) {
    log('•', 'node_modules already linked');
    return;
  }
  // A real node_modules here is someone's own install: never touch it.
  if (current === undefined && existsSync(linkPath)) {
    log('!', 'node_modules exists as a real directory — remove it by hand, then re-run');
    process.exitCode = 1;
    return;
  }
  if (checkOnly) {
    log('→', `node_modules WOULD be linked -> ${target}`);
    pending += 1;
    return;
  }
  if (current !== undefined) {
    // Stale link (workspace moved). rmdir unlinks without touching the target.
    try {
      unlinkSync(linkPath);
    } catch {
      rmdirSync(linkPath);
    }
  }
  symlinkSync(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
  log('✓', `node_modules -> ${target}`);
  changed += 1;
}

// --- 4e. vite: serve page sources that live outside the workspace --------------
// Vite refuses to serve files outside its root, so the repo has to be added to
// server.fs.allow or every page 403s in `npm start`. Build-only config
// (vite.config.pages.ts) never serves, so it needs nothing.
function patchViteServeOutOfRoot() {
  if (!separateWorkspace) {
    log('•', 'vite server.fs patch not needed (workspace IS the repo)');
    return;
  }
  const repoPosix = repoRoot.replaceAll('\\', '/');
  patchFile(
    'apps/dashboard-wc/vite.config.ts',
    (c) => c.includes('fs: { allow:'),
    (c) =>
      replaceAnchor(
        c,
        `\n    base: '',\n`,
        `\n    base: '',\n\n    // Serve the page sources from the separate source repo (npm start).\n    server: { fs: { allow: ['.', '${repoPosix}'] } },\n`,
        'vite.config.ts (server.fs.allow)'
      )
  );
}

// --- 5. tsconfig.base.json ----------------------------------------------------
/**
 * Build `@visuelconcept/wui-*\/*` -> the repo's `libs/wui-*\/src/*`.
 *
 * Always scans the REPO's libs — that is the source of truth — and emits paths
 * relative to the workspace root (tsconfig `paths` resolve against `baseUrl`,
 * which is `.`). With the scaffold on top that yields `libs/wui-x/src/*`; with a
 * separate workspace it yields `../libs/wui-x/src/*`, which TypeScript accepts.
 */
function visuelconceptPaths() {
  const entries = {};
  if (!existsSync(repoLibs)) return entries;
  for (const dirent of readdirSync(repoLibs, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !dirent.name.startsWith('wui-')) continue;
    const target = path
      .relative(workspace, path.join(repoLibs, dirent.name, 'src'))
      .replaceAll('\\', '/');
    entries[`@visuelconcept/${dirent.name}/*`] = [`${target}/*`];
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

// --- 6. webui-app-ix.ts (chromeless embed mode for Mosaïque tiles) ------------
// The Mosaïque page embeds internal dashboard views as iframes in chromeless mode
// (…/index.html#/route?embed=1 — flag inside the hash so it survives the root
// redirect and the SPA router). The shell must honor it by rendering only the
// routed outlet — no header, no menu. Without this, embedded tiles (e.g. a
// fleet-3d atelier) show the full app chrome. default-components is scaffolded by
// webui-runtime-init, so this is re-applied after every re-scaffold, like the vite
// patches above.
function patchWebuiAppEmbed() {
  patchFile(
    'libs/default-components/src/lib/webui-app-ix.ts',
    (c) => c.includes('const EMBEDDED'),
    (c) => {
      let out = replaceAnchor(
        c,
        `addIcons({ 'rotate-180': iconRotate180 });`,
        `addIcons({ 'rotate-180': iconRotate180 });\n\n` +
          `/**\n` +
          ` * "Chromeless" / embedded mode for Mosaïque tiles. A tile embeds an internal\n` +
          ` * view as \`…/index.html#/route?embed=1\` — when the \`embed\` flag is set the shell\n` +
          ` * renders only the routed page content (no header, no menu).\n` +
          ` *\n` +
          ` * The flag is read from the hash region (\`#/route?embed=1\`) OR a legacy pre-hash\n` +
          ` * \`?embed\` query. The hash is where it durably lives: the root redirect in\n` +
          ` * index.html preserves only \`location.hash\`, and the SPA router rewrites the URL\n` +
          ` * keeping the route's own query inside the hash — both of which would drop a\n` +
          ` * pre-hash \`?embed\`. It is also latched once at module load (early pre-hash flag),\n` +
          ` * and \`isEmbedded()\` falls back to a live read of the durable hash so detection\n` +
          ` * never flips back to chrome mid-session.\n` +
          ` */\n` +
          `function hasEmbedFlag(): boolean {\n` +
          `  const loc = globalThis.location;\n` +
          `  if (new URLSearchParams(loc.search).has('embed')) {\n` +
          `    return true;\n` +
          `  }\n` +
          `  const queryIndex = loc.hash.indexOf('?');\n` +
          `  return (\n` +
          `    queryIndex !== -1 &&\n` +
          `    new URLSearchParams(loc.hash.slice(queryIndex)).has('embed')\n` +
          `  );\n` +
          `}\n\n` +
          `const EMBEDDED: boolean = (() => {\n` +
          `  try {\n` +
          `    return hasEmbedFlag();\n` +
          `  } catch {\n` +
          `    return false;\n` +
          `  }\n` +
          `})();\n\n` +
          `function isEmbedded(): boolean {\n` +
          `  if (EMBEDDED) {\n` +
          `    return true;\n` +
          `  }\n` +
          `  try {\n` +
          `    return hasEmbedFlag();\n` +
          `  } catch {\n` +
          `    return false;\n` +
          `  }\n` +
          `}`,
        'webui-app-ix.ts (isEmbedded helper)'
      );
      out = replaceAnchor(
        out,
        `  protected override renderTemplate(): TemplateResult {\n    return html\`<wui-ix-template>`,
        `  protected override renderTemplate(): TemplateResult {\n` +
          `    // Embedded mode: only the routed page content (no header / menu chrome).\n` +
          `    if (isEmbedded()) {\n` +
          `      return html\`<div id="outlet" class="embed-outlet"></div>\`;\n` +
          `    }\n` +
          `    return html\`<wui-ix-template>`,
        'webui-app-ix.ts (renderTemplate)'
      );
      return out;
    }
  );
}

// --- 7. route-generator-utils.ts (robust page-module loading) -----------------
// The scaffolded loadModuleWithFallback gated the dynamic import() behind a
// /WebUI_Settings probe + a service-worker cache lookup; right after a
// "Clear site data" (empty SW cache) a transient probe failure made it SKIP the
// import and return a redirect — which the route action (step 8) ignored,
// rendering a blank page that only loaded on a 2nd visit. Replace it with:
// always attempt the import (the import is the real connectivity test), redirect
// to /error only on a genuine failure. Also drop the now-unused cache helpers.
function patchRouteModuleLoader() {
  patchFile(
    'libs/default-components/src/lib/route-generators/route-generator-utils.ts',
    (c) => c.includes('Failed to load route module'),
    (c) => {
      let out = replaceAnchor(
        c,
        `/** Cached modules to avoid redundant fetch checks */\nconst moduleMap = new Set<string>();\n\n/** HTTP status codes at or above this threshold indicate an error */\nconst HTTP_ERROR_THRESHOLD = 400;\n\n/**\n * Check if a module is cached in the service worker scripts cache.\n * @param moduleName - Module name to search for in cache\n * @returns Cached response if found, null otherwise\n */\nasync function getMatchedResponse(moduleName: string) {\n  const cache = await caches.open('scripts');\n  const keys = await cache.keys();\n\n  for (const request of keys) {\n    if (request.url.includes(moduleName)) {\n      return await cache.match(request);\n    }\n  }\n  return null;\n}\n\n`,
        ``,
        'route-generator-utils.ts (drop SW cache/probe helpers)'
      );
      out = replaceAnchor(
        out,
        `/**\n * Custom import with error page handler, redirect, and cache check.\n * Handles offline scenarios by checking service worker cache.\n *\n * @param commands - Vaadin Router commands for redirect\n * @param moduleName - Module path for cache lookup and tracking\n * @param moduleLoader - Async function that performs the actual import\n * @returns Redirect result on error, undefined on success\n */\nexport async function loadModuleWithFallback(\n  commands: Commands,\n  moduleName: string,\n  moduleLoader: () => Promise<unknown>\n) {\n  const isLoaded = moduleMap.has(moduleName)\n    ? { status: 200 }\n    : await fetch('/WebUI_Settings').catch((error) => {\n        return { status: error.status };\n      });\n\n  const regModuleName = moduleName.split('/').pop() || ' ';\n  const cachedModule = await getMatchedResponse(regModuleName);\n\n  const tryLoadModule = async () => {\n    return await moduleLoader()\n      .then(() => {\n        moduleMap.add(moduleName);\n      })\n      .catch(() => {\n        return commands.redirect('/error');\n      });\n  };\n\n  if (cachedModule || isLoaded.status < HTTP_ERROR_THRESHOLD) {\n    return tryLoadModule();\n  }\n\n  return commands.redirect('/error');\n}`,
        `/**\n * Import a route's page module, redirecting to the error page only if the\n * import actually fails. The scaffolded version gated the import behind a\n * /WebUI_Settings probe + service-worker cache lookup; right after a\n * "Clear site data" (empty SW cache) a transient probe failure made it SKIP the\n * import and return a redirect that callers ignored -> blank page. The dynamic\n * import() is itself the connectivity test: attempt it, fall back to /error\n * only on a genuine load failure.\n */\nexport async function loadModuleWithFallback(\n  commands: Commands,\n  moduleName: string,\n  moduleLoader: () => Promise<unknown>\n) {\n  try {\n    await moduleLoader();\n    return undefined;\n  } catch (error) {\n    console.warn("Failed to load route module '" + moduleName + "':", error);\n    return commands.redirect('/error');\n  }\n}`,
        'route-generator-utils.ts (loadModuleWithFallback)'
      );
      return out;
    }
  );
}

// --- 8. webui-ix-routes.service.ts (honor the loader's redirect) --------------
// The page route action awaited loadModuleWithFallback but DISCARDED its return
// value, then created the element regardless — so when the loader returned a
// redirect (failed/skipped import) the action rendered an undefined element
// (blank). Capture and return the redirect instead.
function patchRouteActionRedirect() {
  patchFile(
    'libs/default-components/src/lib/services/webui-ix-routes.service.ts',
    (c) => c.includes('if (redirect) return redirect'),
    (c) =>
      replaceAnchor(
        c,
        `        // Only import if module path is provided\n        if (modulePath) {\n          await loadModuleWithFallback(\n            commands,\n            modulePath,\n            () => import(/* @vite-ignore */ modulePath)\n          );\n        }`,
        `        // Only import if module path is provided\n        if (modulePath) {\n          const redirect = await loadModuleWithFallback(\n            commands,\n            modulePath,\n            () => import(/* @vite-ignore */ modulePath)\n          );\n          // Honor the loader's redirect (don't fall through to a blank element).\n          if (redirect) return redirect;\n        }`,
        'webui-ix-routes.service.ts (honor loader redirect)'
      )
  );
}

// --- run ----------------------------------------------------------------------
console.log(
  `Wiring dev workspace (${checkOnly ? 'check' : 'apply'}): ${workspace}`
);
try {
  deployHelpers();
  writePagesRoot();
  copySkills();
  linkNodeModules();
  patchViteServeOutOfRoot();
  patchViteShared();
  patchViteConfig();
  patchViteConfigPages();
  patchViteConfigPagesChunkHash();
  patchViteConfigAppsec();
  patchViteConfigPagesAppsec();
  patchTsconfigPaths();
  patchWebuiAppEmbed();
  patchRouteModuleLoader();
  patchRouteActionRedirect();
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

// --- last step: the pages' third-party deps ------------------------------------
// Chained here on purpose, so ONE command makes a freshly scaffolded workspace
// usable. It must run AFTER the wiring: it reads the page libs' manifests through
// the layout this script just established. `--no-deps` skips it (offline, or when
// you know nothing changed).
if (!hasFlag('no-deps')) {
  const dependencies = path.join(__dirname, 'install-page-dependencies.mjs');
  console.log('\nPage dependencies');
  const result = spawnSync(
    process.execPath,
    [dependencies, '--workspace', workspace],
    { stdio: 'inherit' }
  );
  if (result.status !== 0) {
    console.error(
      `\n✗ install-page-dependencies failed (exit ${result.status}). The wiring itself is done;\n` +
        `  fix the install and re-run:  node tools/install-page-dependencies.mjs --workspace "${workspace}"`
    );
    process.exit(1);
  }
}

console.log(
  changed
    ? `\nDone — ${changed} change(s). Start the dev server:  npm start  (from ${workspace})`
    : `\nAlready fully wired. Start the dev server:  npm start  (from ${workspace})`
);
