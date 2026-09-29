// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Each module OWNS its backend — the single place that says what it deploys.
 *
 *   libs/wui-<page>/backend/<file>.ts        webserver route sources (TypeScript,
 *                                            compiled by the webserver's own tsc)
 *   libs/wui-<owner>/managers/<name>/        JavaScript managers
 *   libs/wui-<page>/package.json#wuiPage.backend:
 *     mount, routeClass, routeFile           the module descriptor (index.ts)
 *     relayFn, relayFile                     optional raw ws relay
 *     files: [...]                           this module's backend/ files
 *     shared: ["<lib package>/<file>", ...]  another lib's backend/ file, copied
 *                                            into this module (appSecurityGuard.ts)
 *     vendorPackages: [...]                  workspace libs the routes import
 *     managers: ["<name>", ...]              by NAME — found in any lib's managers/
 *     notes / dependsOn                      human-readable only
 *
 * Read by deploy-backend.mjs, deploy-release.mjs and build-package.mjs, and by
 * wui-toolkit (`wui build`) with the same contract — which is what lets a site
 * repo ship modules with their own backend. tools/specs.json keeps only the
 * packaging metadata (title, tier, description).
 */
import fs from 'node:fs';
import path from 'node:path';

const isDirectory = (target) => fs.existsSync(target) && fs.statSync(target).isDirectory();

function readLibs(libsDir) {
  return fs
    .readdirSync(libsDir)
    .map((name) => path.join(libsDir, name))
    .filter((dir) => isDirectory(dir) && fs.existsSync(path.join(dir, 'package.json')))
    .map((dir) => ({ dir, manifest: JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) }));
}

/**
 * @returns {Map<string, {page, lib, backend?, managers}>} page id → what it deploys.
 *   backend.files = [{ name, source }] (own + shared, in copy order);
 *   managers = [{ name, source }].
 */
export function loadModuleBackends(root) {
  const libs = readLibs(path.join(root, 'libs'));
  const byName = new Map(libs.map((lib) => [lib.manifest.name, lib]));
  const managerDirs = new Map();
  for (const lib of libs) {
    const managersDir = path.join(lib.dir, 'managers');
    if (!isDirectory(managersDir)) continue;
    for (const name of fs.readdirSync(managersDir)) {
      if (!isDirectory(path.join(managersDir, name))) continue;
      if (managerDirs.has(name)) throw new Error(`manager "${name}" is defined twice: ${managerDirs.get(name)} and ${path.join(managersDir, name)}`);
      managerDirs.set(name, path.join(managersDir, name));
    }
  }

  const modules = new Map();
  for (const lib of libs) {
    const spec = lib.manifest.wuiPage?.backend;
    if (!spec || (!spec.mount && !spec.managers?.length)) continue;
    const page = path.basename(lib.dir).replace(/^wui-/, '');
    const own = (spec.files ?? []).map((name) => ({ name, source: path.join(lib.dir, 'backend', name) }));
    const shared = (spec.shared ?? []).map((reference) => {
      const slash = reference.lastIndexOf('/');
      const owner = byName.get(reference.slice(0, slash));
      if (!owner) throw new Error(`${lib.manifest.name}: shared "${reference}" names no lib`);
      const name = reference.slice(slash + 1);
      return { name, source: path.join(owner.dir, 'backend', name) };
    });
    const files = [...own, ...shared];
    for (const file of files) {
      if (!fs.existsSync(file.source)) throw new Error(`${lib.manifest.name}: backend file not found: ${file.source}`);
    }
    const managers = (spec.managers ?? []).map((name) => {
      const source = managerDirs.get(name);
      if (!source) throw new Error(`${lib.manifest.name}: manager "${name}" is in no lib's managers/ folder`);
      return { name, source };
    });
    modules.set(page, {
      page,
      lib: lib.dir,
      backend: spec.mount
        ? {
            mount: spec.mount,
            routeClass: spec.routeClass,
            routeFile: spec.routeFile,
            relayFn: spec.relayFn,
            relayFile: spec.relayFile,
            vendorPackages: spec.vendorPackages ?? [],
            files
          }
        : undefined,
      managers
    });
  }
  return modules;
}
