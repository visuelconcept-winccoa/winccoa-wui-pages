// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Standalone demo build: resolves the workspace packages straight to their
 * TypeScript sources (no runtime workspace, no built kits) so the demo runs
 * with only `lit` + `vite` installed here.
 */
const engCore = fileURLToPath(new URL('../../wui-eng-core/src', import.meta.url));
const engStudio = fileURLToPath(new URL('../src', import.meta.url));
// The page sources live OUTSIDE this demo folder, so Vite can't walk up to a
// node_modules for `lit`. Alias lit's entrypoints to the copy installed here.
const litDir = fileURLToPath(new URL('./node_modules/lit', import.meta.url));

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
  server: { port: 4310, strictPort: true },
  esbuild: { tsconfigRaw: '{"compilerOptions":{"experimentalDecorators":true,"useDefineForClassFields":false}}' }
});
