// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The lib's tsconfig.json extends the RUNTIME WORKSPACE's tsconfig.base.json
  // (absent in a standalone checkout). Bypass tsconfig discovery so the tests
  // run anywhere — type checking is `npm run typecheck` (tsconfig.standalone).
  esbuild: {
    tsconfigRaw: '{"compilerOptions":{"target":"ES2022","verbatimModuleSyntax":false}}'
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node'
  }
});
