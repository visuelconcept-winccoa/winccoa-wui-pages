// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Application-Security role catalog aggregation for the `libs/wui-*` page libs —
 * dev (serve) AND build. The counterpart of page-menu-merge-plugin, but for the
 * app-security "Discover modules" seed instead of the nav.
 *
 * Each page lib owns its role declaration in `libs/wui-<page>/src/app-security.roles.json`
 * (single source of truth: the module imports the SAME file for its
 * `registerModuleRoles` self-registration). This plugin concatenates every
 * fragment present in the build tree into one asset `<prefix>/app-security-manifest.json`
 * (a JSON array of `{ module, title, roles }`), which the Application Security
 * page fetches for its "Discover modules" seeding. There is NO central manifest:
 * adding or extending a module never touches app-security.
 *
 *   - serve (dev): merged in memory at request time; nothing on disk is mutated.
 *   - build: after the bundle is written, the array is emitted to
 *     `<outDir>/app-security-manifest.json`.
 *
 * Modules built from ANOTHER repository (not present in this tree) are absent
 * from this asset by design — they are discovered at runtime via their own
 * `registerModuleRoles`, or seeded into the workspace copy of the asset by their
 * own installer (tools/install.template.mjs merges each fragment, idempotent by
 * module id). The service-worker cache is self-invalidated by page-menu-merge's
 * index.html touch, which runs in the same build.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// scripts/ -> apps/dashboard-wc -> apps -> <workspace root>
const workspaceRoot = path.resolve(__dirname, '../../..');
// Two layouts carry the fragments:
//   • dev repo (this workspace): libs/wui-<page>/src/app-security.roles.json
//   • installed runtime workspace: pages are vendored (vendor-page.mjs copies the
//     whole src/, incl. the JSON) under default-components/standalone-pages/<page>/.
// A module installed from ANOTHER repo lands in the standalone-pages layout, so
// scanning both makes its fragment show up on the next build:pages — no
// app-security edit, no central list.
const libsDirectory = path.join(workspaceRoot, 'libs');
const standalonePagesDirectory = path.join(
  workspaceRoot,
  'libs',
  'default-components',
  'src',
  'lib',
  'standalone-pages'
);

// Fragments are plain JSON (comment-free), so they are also natively importable
// by each module for its own registerModuleRoles — no comment stripping needed.
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Add a fragment file to `modules` (dedup by module id; first wins). */
function addFragment(modules, seen, fragmentPath, label) {
  if (!fs.existsSync(fragmentPath)) return;
  try {
    const fragment = readJson(fragmentPath);
    if (fragment && typeof fragment.module === 'string' && !seen.has(fragment.module)) {
      seen.add(fragment.module);
      modules.push(fragment);
    }
  } catch (error) {
    console.warn(`[page-appsec-merge] skipped ${label}: ${error.message}`);
  }
}

/** Collect role fragments from both the dev-repo and the vendored layouts. */
function collectRoleFragments() {
  const modules = [];
  const seen = new Set();

  // 1. dev repo: libs/wui-<page>/src/app-security.roles.json (authoritative source).
  if (fs.existsSync(libsDirectory)) {
    for (const dirent of fs.readdirSync(libsDirectory, { withFileTypes: true })) {
      if (!dirent.isDirectory() || !dirent.name.startsWith('wui-')) continue;
      addFragment(
        modules,
        seen,
        path.join(libsDirectory, dirent.name, 'src', 'app-security.roles.json'),
        `${dirent.name}/src/app-security.roles.json`
      );
    }
  }

  // 2. installed workspace: vendored standalone-pages/<page>/app-security.roles.json.
  if (fs.existsSync(standalonePagesDirectory)) {
    for (const dirent of fs.readdirSync(standalonePagesDirectory, { withFileTypes: true })) {
      if (!dirent.isDirectory()) continue;
      addFragment(
        modules,
        seen,
        path.join(standalonePagesDirectory, dirent.name, 'app-security.roles.json'),
        `standalone-pages/${dirent.name}/app-security.roles.json`
      );
    }
  }

  modules.sort((a, b) => a.module.localeCompare(b.module));
  return modules;
}

/**
 * Vite plugin: serve (dev) and emit (build) `<prefix>/app-security-manifest.json`
 * with every wui-* page role fragment aggregated in.
 *
 * @param {{ publicUrlPrefix: string }} options
 */
export function pageAppsecMergePlugin({ publicUrlPrefix }) {
  if (!publicUrlPrefix) {
    throw new Error('pageAppsecMergePlugin requires a publicUrlPrefix');
  }

  const manifestUrl = `${publicUrlPrefix}/app-security-manifest.json`;
  let outDirectory;
  let isBuild = false;
  let logger = console;

  return {
    name: 'page-appsec-merge',

    configResolved(config) {
      // Vite resolves build.outDir relative to root; path.resolve is a no-op when
      // it is already absolute (e.g. an absolute OUT_DIR).
      outDirectory = path.resolve(config.root, config.build?.outDir ?? 'dist');
      isBuild = config.command === 'build';
      logger = config.logger ?? console;
    },

    // --- dev: serve the merged array in memory at request time --------------
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || !request.url) {
          return next();
        }
        const [pathname] = request.url.split('?');
        if (pathname !== manifestUrl) {
          return next();
        }
        const modules = collectRoleFragments();
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(JSON.stringify(modules));
        logger.info(`[page-appsec-merge] app-security-manifest.json served with ${modules.length} module(s)`);
      });
    },

    // --- build: emit the merged array once after the bundle is written ------
    closeBundle() {
      // Vite also fires closeBundle on dev-server shutdown; only act on real builds.
      if (!isBuild) return;
      const modules = collectRoleFragments();
      const target = path.join(outDirectory, 'app-security-manifest.json');
      try {
        fs.mkdirSync(outDirectory, { recursive: true });
        fs.writeFileSync(target, JSON.stringify(modules, null, 2));
      } catch (error) {
        logger.warn(`[page-appsec-merge] cannot write ${target}: ${error.message}`);
        return;
      }
      logger.info(`[page-appsec-merge] ${target} written with ${modules.length} module(s)`);
    }
  };
}
