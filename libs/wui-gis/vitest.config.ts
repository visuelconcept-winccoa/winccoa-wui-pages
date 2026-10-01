// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // No tsconfig discovery: the compiler options the tests need are given here,
  // so the tests run from the lib alone, whatever surrounds it.
  esbuild: {
    tsconfigRaw:
      '{"compilerOptions":{"target":"ES2022","verbatimModuleSyntax":false}}'
  },
  // `data/io.ts` imports the shared kit by package name, which nothing resolves
  // here (no install of wui-kit, no tsconfig paths) — so the one alias the
  // tests need is declared here. Without it `io.spec.ts` cannot load at all.
  resolve: {
    alias: {
      '@visuelconcept-winccoa/wui-kit': fileURLToPath(
        new URL('../wui-kit/src', import.meta.url)
      )
    }
  },
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node'
  }
});
