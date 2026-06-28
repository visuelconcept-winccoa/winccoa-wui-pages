// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Menu aggregation for the `libs/wui-*` page libs — dev (serve) AND build.
 *
 * The dashboard nav is driven by config/menuconfig.jsonc, emitted as
 * `<prefix>/menuconfig.json` by copyConfigFilesPlugin. That committed file only
 * lists the pages baked into the host shell, so freshly-developed page libs never
 * show up in the nav even though discoverPageLibs() makes their bundles serveable.
 * Result without this plugin: the page loads if you hit its route directly, but
 * there is no menu entry to click — and an OUT_DIR build deploys a menu missing
 * the pages.
 *
 * This plugin merges every `libs/wui-<page>/menu.fragment.jsonc` into
 * menuconfig.json, idempotent by `routeId` — the same merge the packaging
 * installer (tools/install.template.mjs) performs against a target workspace:
 *
 *   - serve (dev): merged in memory at request time. Nothing on disk is mutated;
 *     the committed menuconfig.jsonc stays the host default. The service worker is
 *     disabled in dev (VitePWA devOptions.enabled = false), so the "SW caches
 *     menuconfig.json" caveat from DEVELOPMENT.md does not apply here.
 *   - build: after copyConfigFilesPlugin has emitted <outDir>/menuconfig.json,
 *     it is rewritten with the fragments merged in, so an `OUT_DIR=… npm run build`
 *     (or build:pages) deploys a menu that includes the dev pages — again without
 *     touching the committed menuconfig.jsonc.
 *
 * Ordering: in dev, list this plugin BEFORE copyConfigFilesPlugin so its
 * middleware handles `<prefix>/menuconfig.json` first (both register a
 * `configureServer` middleware, applied in plugin order). The build path uses
 * `closeBundle`, which runs after every plugin's `writeBundle` regardless of
 * plugin order, so the merged file always wins.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsonComments } from './strip-json-comments.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// scripts/ -> apps/dashboard-wc -> apps -> <workspace root> -> libs
const libsDirectory = path.resolve(__dirname, '../../../libs');

function readJsonc(file) {
  return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')));
}

/** Collect menu entries from every libs/wui-PAGE/menu.fragment.jsonc file. */
function collectMenuFragments() {
  const entries = [];
  if (!fs.existsSync(libsDirectory)) {
    return entries;
  }

  for (const dirent of fs.readdirSync(libsDirectory, { withFileTypes: true })) {
    if (!dirent.isDirectory() || !dirent.name.startsWith('wui-')) {
      continue;
    }

    const fragmentPath = path.resolve(
      libsDirectory,
      dirent.name,
      'menu.fragment.jsonc'
    );
    if (!fs.existsSync(fragmentPath)) {
      continue;
    }

    try {
      const fragment = readJsonc(fragmentPath);
      if (Array.isArray(fragment)) {
        entries.push(...fragment);
      }
    } catch (error) {
      console.warn(
        `[page-menu-merge] skipped ${dirent.name}/menu.fragment.jsonc: ${error.message}`
      );
    }
  }

  return entries;
}

/**
 * Append every wui-* page fragment to `menu.entries`, idempotent by `routeId`
 * (entries already present win). Mutates `menu` in place; returns how many were
 * added.
 */
function mergeFragments(menu) {
  const entries = Array.isArray(menu.entries) ? menu.entries : [];
  const seenRouteIds = new Set(
    entries.map((entry) => entry.routeId).filter(Boolean)
  );

  let added = 0;
  for (const entry of collectMenuFragments()) {
    if (entry.routeId && seenRouteIds.has(entry.routeId)) {
      continue;
    }
    if (entry.routeId) {
      seenRouteIds.add(entry.routeId);
    }
    entries.push(entry);
    added += 1;
  }

  menu.entries = entries;
  return added;
}

/**
 * Vite plugin: serve (dev) and emit (build) a menuconfig.json with all wui-*
 * page menu fragments merged in.
 *
 * @param {{ publicUrlPrefix: string, configDirectory?: string }} options
 */
export function pageMenuMergePlugin({
  publicUrlPrefix,
  configDirectory = 'config'
}) {
  if (!publicUrlPrefix) {
    throw new Error('pageMenuMergePlugin requires a publicUrlPrefix');
  }

  const menuUrl = `${publicUrlPrefix}/menuconfig.json`;
  let menuJsoncPath;
  let outDirectory;
  let isBuild = false;
  let logger = console;

  return {
    name: 'page-menu-merge',

    configResolved(config) {
      menuJsoncPath = path.resolve(
        config.root,
        configDirectory,
        'menuconfig.jsonc'
      );
      // Vite resolves build.outDir relative to root; path.resolve is a no-op when
      // it is already absolute (e.g. an absolute OUT_DIR).
      outDirectory = path.resolve(config.root, config.build?.outDir ?? 'dist');
      isBuild = config.command === 'build';
      logger = config.logger ?? console;
    },

    // --- dev: merge in memory at request time -------------------------------
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || !request.url) {
          return next();
        }

        const [pathname] = request.url.split('?');
        if (pathname !== menuUrl || !fs.existsSync(menuJsoncPath)) {
          return next();
        }

        let menu;
        try {
          menu = readJsonc(menuJsoncPath);
        } catch (error) {
          logger.warn(
            `[page-menu-merge] cannot parse menuconfig.jsonc: ${error.message}`
          );
          return next();
        }

        const added = mergeFragments(menu);
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(JSON.stringify(menu));

        logger.info(
          `[page-menu-merge] menuconfig.json served with +${added} page menu entr${added === 1 ? 'y' : 'ies'}`
        );
      });
    },

    // --- build: rewrite the emitted menuconfig.json with fragments merged in --
    // Runs once after the bundle (and copyConfigFilesPlugin's writeBundle) is
    // written, so the merged file is the final one on disk. Not called in dev.
    closeBundle() {
      // Vite also fires closeBundle on dev-server shutdown; only act on real
      // builds so a dev session never writes to disk (see configureServer above).
      if (!isBuild) return;
      if (!fs.existsSync(menuJsoncPath)) {
        return;
      }

      let menu;
      try {
        menu = readJsonc(menuJsoncPath);
      } catch (error) {
        logger.warn(
          `[page-menu-merge] cannot parse menuconfig.jsonc: ${error.message}`
        );
        return;
      }

      const added = mergeFragments(menu);
      const target = path.join(outDirectory, 'menuconfig.json');
      try {
        fs.mkdirSync(outDirectory, { recursive: true });
        fs.writeFileSync(target, JSON.stringify(menu, null, 2));
      } catch (error) {
        logger.warn(`[page-menu-merge] cannot write ${target}: ${error.message}`);
        return;
      }

      logger.info(
        `[page-menu-merge] ${target} written with +${added} page menu entr${added === 1 ? 'y' : 'ies'}`
      );
    }
  };
}
