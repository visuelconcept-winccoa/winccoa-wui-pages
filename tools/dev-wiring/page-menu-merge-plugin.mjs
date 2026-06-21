/**
 * Dev-only menu aggregation for the `libs/wui-*` page libs.
 *
 * In dev, the dashboard nav is driven by config/menuconfig.jsonc, served as
 * `<prefix>/menuconfig.json` by copyConfigFilesPlugin. That file only lists the
 * pages baked into the host shell, so freshly-developed page libs never show up
 * in the nav even though discoverPageLibs() makes their bundles serveable.
 * Result: the page loads if you hit its route directly, but there is no menu
 * entry to click.
 *
 * This plugin merges every `libs/wui-<page>/menu.fragment.jsonc` into the served
 * menuconfig.json at request time — the same idempotent-by-`routeId` merge the
 * packaging installer (tools/install.template.mjs) performs against a target
 * workspace. Nothing on disk is mutated; the committed menuconfig.jsonc stays
 * the host default. The service worker is disabled in dev (VitePWA
 * devOptions.enabled = false), so the "SW caches menuconfig.json" caveat from
 * DEVELOPMENT.md does not apply here.
 *
 * Ordering: list this plugin BEFORE copyConfigFilesPlugin in the plugins array
 * so its middleware handles `<prefix>/menuconfig.json` first (both register a
 * `configureServer` middleware, applied in plugin order). All other config JSON
 * falls through to copyConfigFilesPlugin via next().
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
 * Vite plugin: serve the host menuconfig.json with all wui-* page menu
 * fragments merged in (dev only).
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

  return {
    name: 'page-menu-merge',
    apply: 'serve',

    configResolved(config) {
      menuJsoncPath = path.resolve(
        config.root,
        configDirectory,
        'menuconfig.jsonc'
      );
    },

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
          console.warn(
            `[page-menu-merge] cannot parse menuconfig.jsonc: ${error.message}`
          );
          return next();
        }

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
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(JSON.stringify(menu));

        server.config.logger.info(
          `[page-menu-merge] menuconfig.json served with +${added} page menu entr${added === 1 ? 'y' : 'ies'}`
        );
      });
    }
  };
}
