// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The lib's tsconfig.json extends the RUNTIME WORKSPACE's tsconfig.base.json
  // (absent in a standalone checkout). Bypass tsconfig discovery so the tests
  // run anywhere — type checking is the lib's own tsconfig.lib.json.
  esbuild: {
    tsconfigRaw: '{"compilerOptions":{"target":"ES2022","verbatimModuleSyntax":false}}'
  },
  test: {
    include: ['src/**/*.spec.ts'],
    // jsdom, not node: the kit's data modules import the OaRxJsApi browser bundle,
    // which touches `self` at load time. The tests themselves exercise pure logic.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts']
  }
});
