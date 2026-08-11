// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The lib's tsconfig.json extends the RUNTIME WORKSPACE's tsconfig.base.json
  // (absent in a standalone checkout). Bypass tsconfig discovery so the tests
  // run anywhere — type checking is the lib's own tsconfig.lib.json.
  esbuild: {
    tsconfigRaw:
      '{"compilerOptions":{"target":"ES2022","verbatimModuleSyntax":false}}'
  },
  // `data/io.ts` imports the shared kit by package name. In the runtime workspace that
  // resolves through the tsconfig paths, which are bypassed above — so the one alias the
  // tests need is declared here. Without it `io.spec.ts` cannot load at all.
  resolve: {
    alias: {
      '@visuelconcept/wui-kit': fileURLToPath(
        new URL('../wui-kit/src', import.meta.url)
      )
    }
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node'
  }
});
