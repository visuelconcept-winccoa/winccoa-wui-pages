/// <reference types="vitest" />
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/wui-warehouse',
  plugins: [nxViteTsPaths()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.spec.ts'],
    // lit-translate ships extension-less ESM imports — route deps through Vite's
    // resolver (same trick as libs/default-components/vite.config.ts).
    server: {
      deps: {
        inline: [/^(?!.*\bvitest\b|.*\bvite\b)/]
      }
    },
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/unit/libs/wui-warehouse',
      provider: 'istanbul',
      reporter: ['lcov', 'text'],
      exclude: ['**/*.spec.ts', '**/ui/**']
    }
  }
});
