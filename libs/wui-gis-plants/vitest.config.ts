// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Same as wui-gis: bypass tsconfig discovery so the tests run in a standalone checkout.
  esbuild: {
    tsconfigRaw:
      '{"compilerOptions":{"target":"ES2022","verbatimModuleSyntax":false}}'
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node'
  }
});
