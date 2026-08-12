// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Standalone demo build: resolves the workspace packages straight to their
 * TypeScript sources (no runtime workspace, no built kits).
 *
 * The page sources live OUTSIDE this demo folder, so Vite resolves their bare
 * imports from `libs/wui-eng-studio/node_modules` upwards — which reaches the
 * WORKSPACE ROOT `node_modules`. That is where `@siemens/ix`, `@siemens/ix-icons`
 * and `@wincc-oa/wui-shared` come from (the iX design system the page uses, like
 * every other page of the suite), so nothing has to be duplicated here.
 *
 * `lit` is aliased explicitly because that upward walk must land on ONE copy: two
 * Lit instances mean two `ReactiveElement` registries and silently broken property
 * updates. The demo's own install wins when it exists (so the folder stays usable on
 * its own), and the workspace root is the fallback.
 */
const engCore = fileURLToPath(new URL('../../wui-eng-core/src', import.meta.url));
const engStudio = fileURLToPath(new URL('../src', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const demoLit = fileURLToPath(new URL('./node_modules/lit', import.meta.url));
const rootLit = fileURLToPath(new URL('../../../node_modules/lit', import.meta.url));
const litDir = existsSync(demoLit) ? demoLit : rootLit;

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: {
    alias: [
      { find: /^@visuelconcept\/wui-eng-core\/(.*)$/, replacement: `${engCore}/$1` },
      { find: '@visuelconcept/wui-eng-core', replacement: `${engCore}/index.ts` },
      { find: '@visuelconcept/wui-eng-studio', replacement: engStudio },
      { find: 'lit/decorators.js', replacement: `${litDir}/decorators.js` },
      { find: 'lit/directives/', replacement: `${litDir}/directives/` },
      { find: 'lit', replacement: `${litDir}/index.js` }
    ]
  },
  // Vite only serves files under its own root by default; the sources and the iX
  // packages above live above it, hence the explicit allow-list.
  server: { port: 4310, strictPort: true, fs: { allow: [repoRoot] } },
  esbuild: { tsconfigRaw: '{"compilerOptions":{"experimentalDecorators":true,"useDefineForClassFields":false}}' }
});
