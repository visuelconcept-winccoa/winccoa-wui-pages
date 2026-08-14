// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where the `wui-*` page libs live — the single answer shared by the three
 * dev-wiring plugins deployed next to this file in `apps/dashboard-wc/scripts/`.
 *
 * Two layouts, one resolution rule:
 *
 *   • scaffold-on-top — the runtime workspace IS the source repo, so the pages
 *     sit at `<workspace>/libs`. Nothing to configure; that is the fallback.
 *
 *   • separate workspace — the pages live in their own versioned repo and the
 *     runtime scaffold is a folder of its own (see DEVELOPMENT.md). There is
 *     deliberately NO link between the two: `tools/wire-workspace.mjs` writes
 *     `wui-pages-root.json` next to this file with the absolute path of the
 *     repo's `libs/`, and every scan reads it from here.
 *
 * Why a generated JSON rather than a symlink/junction: a link makes `readdir`
 * report the page libs as `isSymbolicLink`, not `isDirectory`, which silently
 * empties every scan that filters on `isDirectory()` — the build then succeeds
 * with no pages, no menu entries and no roles. Config cannot be mis-detected,
 * works the same on every OS, and survives a zip, a fresh clone or a CI checkout.
 *
 * Why a JSON instead of substituting the path when copying: these files are
 * verbatim copies of `tools/dev-wiring/*`, so they stay diffable against their
 * source. Only the JSON is generated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** scripts/ -> apps/dashboard-wc -> apps -> <workspace root> */
export const workspaceRoot = path.resolve(__dirname, '../../..');

const CONFIG_FILE = path.join(__dirname, 'wui-pages-root.json');

function readConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    // A stale path (repo moved/renamed) must not silently fall back to the
    // workspace's own libs/ — that is the "successful build, empty dashboard"
    // failure. Fail loudly instead; re-running wire-workspace fixes it.
    if (typeof config.libsDirectory !== 'string') return null;
    if (!fs.existsSync(config.libsDirectory)) {
      throw new Error(
        `wui-pages-root.json points at "${config.libsDirectory}", which does not exist.\n` +
          '  The page source repo moved. Re-run:  node tools/wire-workspace.mjs --workspace <this workspace>'
      );
    }
    return config;
  } catch (error) {
    if (error instanceof SyntaxError || error.code === 'ENOENT') return null;
    throw error;
  }
}

const config = readConfig();

/** Absolute path of the directory holding the `wui-*` page libs. */
export const pagesLibsDirectory =
  config?.libsDirectory ?? path.join(workspaceRoot, 'libs');

/** Absolute path of the page source repo (equals workspaceRoot when on top). */
export const pagesRepoRoot = config?.repoRoot ?? workspaceRoot;

/** True when the pages come from a repo outside this workspace. */
export const hasSeparateRepo = config !== null;
