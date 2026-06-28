// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Standalone Page Discovery from `libs/wui-*` - AUTO-DISCOVERED
 *
 * Scans the workspace `libs/` directory for page libraries following the
 * convention `wui-<page>/src/<page>.ts` and returns them as standalone-page
 * entry points keyed `pages/<page>` (the same shape produced by
 * `discoverStandalonePages()` in vite.shared.ts).
 *
 * Why a convention instead of reading project.json tags:
 * - A page lib `wui-<page>` always exposes its page entry at `src/<page>.ts`
 *   (e.g. wui-para → src/para.ts, wui-diagnosis → src/diagnosis.ts).
 * - Kit libs (wui-kit, wui-fleet-core, wui-ai-kit) have NO `src/<page>.ts`
 *   matching their folder name, so they are excluded for free — no allow/deny
 *   list to maintain.
 *
 * The `pages/<page>` key matches the `module: "/data/dashboard-wc/pages/<page>.js"`
 * referenced by each lib's menu.fragment.jsonc, so the dev-server `/data` proxy
 * bypass resolves the request straight to this TypeScript source (HMR), and the
 * pages-only build (vite.config.pages.ts) uses it as a Rollup input.
 *
 * Wiring (DEVELOPMENT.md step 2): in vite.shared.ts merge the result into
 * `standalonePages`:
 *
 *   import { discoverPageLibs } from './scripts/discover-page-libs.mjs';
 *   export const standalonePages = { ...discoverStandalonePages(), ...discoverPageLibs() };
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// scripts/ -> apps/dashboard-wc -> apps -> <workspace root> -> libs
const defaultLibsDirectory = path.resolve(__dirname, '../../../libs');

function isTestOrMockFile(filename) {
  return (
    filename.endsWith('.spec.ts') ||
    filename.endsWith('.stories.ts') ||
    filename.endsWith('.mock.ts') ||
    filename.includes('/test/') ||
    filename.includes('/mocks/')
  );
}

/**
 * Discover standalone pages from `libs/wui-<page>/src/<page>.ts`.
 *
 * @param {string} [libsDirectory] Absolute path to the workspace `libs/` directory.
 * @returns {Record<string, string>} Map of `pages/<page>` → absolute source path.
 */
export function discoverPageLibs(libsDirectory = defaultLibsDirectory) {
  /** @type {Record<string, string>} */
  const pages = {};

  if (!fs.existsSync(libsDirectory)) {
    return pages;
  }

  for (const dirent of fs.readdirSync(libsDirectory, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !dirent.name.startsWith('wui-')) {
      continue;
    }

    const page = dirent.name.slice('wui-'.length);
    const entry = path.resolve(libsDirectory, dirent.name, 'src', `${page}.ts`);

    if (!fs.existsSync(entry) || isTestOrMockFile(entry)) {
      continue;
    }

    pages[`pages/${page}`] = entry;
  }

  return pages;
}

export const pageLibs = discoverPageLibs();
