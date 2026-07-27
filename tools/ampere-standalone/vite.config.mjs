// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
//
// Vite config for the wui-ampere standalone harness ("sans WinCC OA"):
// every @wincc-oa/* and oa-rx-js-api import is aliased to a local stub, and the
// @visuelconcept workspace libs resolve straight to their sources. The page's
// own offline fallback (DpJsonStore -> demo seed) does the rest.
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const stub = (f) => path.resolve(here, 'src/stubs', f);

export default defineConfig({
  root: here,
  server: { port: 4310, host: '127.0.0.1' },
  resolve: {
    alias: [
      { find: '@etm-professional-control/oa-rx-js-api', replacement: stub('oa-rx-js-api.ts') },
      { find: '@wincc-oa/wui-i18n-shared/localize-multilang.js', replacement: stub('localize-multilang.ts') },
      { find: '@wincc-oa/wui-models/interfaces/multi-lang-string.js', replacement: stub('multi-lang-string.ts') },
      { find: '@wincc-oa/wui-models/events/router-event.js', replacement: stub('router-event.ts') },
      { find: '@wincc-oa/wui-shared/styles/ix-core.js', replacement: stub('ix-core.ts') },
      { find: '@wincc-oa/wui-iam-data/user-service.js', replacement: stub('user-service.ts') },
      { find: '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js', replacement: stub('dpe-service.ts') },
      { find: '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js', replacement: stub('content-header.ts') },
      {
        find: '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js',
        replacement: stub('context-generator.ts')
      },
      { find: '@visuelconcept/wui-kit', replacement: path.resolve(repo, 'libs/wui-kit/src') },
      { find: '@visuelconcept/wui-ai-kit', replacement: path.resolve(repo, 'libs/wui-ai-kit/src') },
      // libs/ sources live outside this package root: pin bare deps to the
      // harness node_modules so imports from libs/** resolve.
      { find: 'lit', replacement: path.resolve(here, 'node_modules/lit') },
      { find: 'rxjs', replacement: path.resolve(here, 'node_modules/rxjs') },
      { find: 'tsyringe', replacement: path.resolve(here, 'node_modules/tsyringe') },
      { find: 'reflect-metadata', replacement: path.resolve(here, 'node_modules/reflect-metadata') }
    ]
  },
  optimizeDeps: {
    include: ['lit', 'rxjs', 'tsyringe', 'reflect-metadata']
  },
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        experimentalDecorators: true,
        useDefineForClassFields: false
      }
    }
  }
});
