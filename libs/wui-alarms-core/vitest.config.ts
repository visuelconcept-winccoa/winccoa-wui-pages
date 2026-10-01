// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // No tsconfig discovery: the compiler options the tests need are given here,
  // so the tests run from the lib alone, whatever surrounds it.
  // Type checking is `npm run typecheck` (tsconfig.standalone).
  esbuild: {
    tsconfigRaw: '{"compilerOptions":{"target":"ES2022","verbatimModuleSyntax":false}}'
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node'
  }
});
