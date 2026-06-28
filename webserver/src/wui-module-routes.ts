// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// @visuelconcept/wui-webserver — module route auto-discovery
// -----------------------------------------------------------------------------
// Prerequisite for redistributable WinCC OA WebUI page modules that ship a
// backend. Drop a module under  <webserver-src>/modules/<name>/  exposing a
// default export:
//
//   export default {
//     mount: '/api/<x>',              // HTTP mount path
//     acl?: WsjAccessControlList...,  // defaults to fullAccess
//     routes?: () => Router,          // HTTP sub-router (ultimate-express)
//     registerRaw?: (app) => void     // optional raw uWS relay (WebSocket)
//   };
//
// After `npx tsc` it lands at  dist/modules/<name>/index.js  and is mounted
// automatically — NO per-module edit of customerRoutes.ts.
//
// Wire ONCE in your customer webserver:
//   • CustomerRoutes.routes():                 mountModuleRoutes(router);
//   • CustomerDashboardServer.defineRoutes():  mountModuleRelays(this.app);  // before listen
//
// Assumes CommonJS output (require/__dirname), like the standard WinCC OA
// JavaScript-manager webserver. For ESM output, swap require() for a cached
// dynamic import.
// -----------------------------------------------------------------------------

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { WsjAccessControlList, WsjRoutes } from '@winccoa/backend';
import type { Router } from 'ultimate-express';

/** Shape every backend module's default export must satisfy. */
export interface WuiBackendModule {
  mount: string;
  acl?: unknown;
  routes?: () => Router;
  registerRaw?: (app: unknown) => void;
}

function loadModules(): { name: string; mod: WuiBackendModule }[] {
  const dir = join(__dirname, 'modules');
  if (!existsSync(dir)) {
    return [];
  }
  const out: { name: string; mod: WuiBackendModule }[] = [];
  for (const name of readdirSync(dir)) {
    const entry = join(dir, name, 'index.js');
    if (!existsSync(entry)) {
      continue;
    }
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const loaded = require(entry) as { default?: WuiBackendModule } & WuiBackendModule;
    const mod = loaded.default ?? loaded;
    if (mod && typeof mod.mount === 'string') {
      out.push({ name, mod });
    }
  }
  return out;
}

/** Mount every discovered module's HTTP routes + ACL onto the customer router. */
export function mountModuleRoutes(router: Router): void {
  for (const { name, mod } of loadModules()) {
    if (!mod.routes) {
      continue;
    }
    router.use(mod.mount, mod.routes());
    WsjRoutes.acl.set(`${mod.mount}/*`, mod.acl ?? WsjAccessControlList.fullAccess);
    console.info(`[wui-modules] mounted ${name} -> ${mod.mount}`);
  }
}

/** Register every discovered module's raw uWS relay (WebSocket), if any. */
export function mountModuleRelays(app: unknown): void {
  for (const { name, mod } of loadModules()) {
    if (typeof mod.registerRaw !== 'function') {
      continue;
    }
    mod.registerRaw(app);
    console.info(`[wui-modules] relay registered for ${name}`);
  }
}
