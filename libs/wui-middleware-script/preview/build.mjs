#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Build (or serve, with --serve) the WinCC-OA-free preview of the
// Middleware-Script page: bundles ../src/middleware-script.ts with the
// runtime-only imports aliased to ./stubs/*. The Siemens iX packages are NOT
// bundled — index.html loads their Stencil loaders straight from node_modules
// (lazy chunks resolve over HTTP), which is why the dev server's root is this
// directory.
//
//   node build.mjs            one-shot build into dist/
//   node build.mjs --serve    watch + serve http://127.0.0.1:4600
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = (file) => path.join(here, 'stubs', file);
const serve = process.argv.includes('--serve');

const options = {
  entryPoints: [path.join(here, 'entry.js')],
  outdir: path.join(here, 'dist'),
  bundle: true,
  format: 'esm',
  sourcemap: true,
  logLevel: 'info',
  loader: { '.json': 'json' },
  // The page sources live OUTSIDE this directory (../src), so their bare
  // imports (lit, rxjs, tsyringe) must fall back to the preview's own deps.
  nodePaths: [path.join(here, 'node_modules')],
  // The repo's tsconfig.base.json only exists in a wired runtime workspace —
  // supply the two options the Lit TS decorators require.
  tsconfigRaw: {
    compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false }
  },
  alias: {
    '@wincc-oa/wui-shared/styles/ix-core.js': stub('ix-core.js'),
    '@wincc-oa/wui-i18n-shared/localize-multilang.js': stub('localize-multilang.js'),
    '@visuelconcept/wui-kit/data/app-security.js': stub('app-security.js'),
    '@visuelconcept/wui-kit/data/dp-json-store.js': stub('dp-json-store.js'),
    '@etm-professional-control/oa-rx-js-api': stub('oa-rx-js-api.js'),
    '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js': stub('wui-content-header.js'),
    '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js': stub('wui-context-generator.js')
  }
};

if (serve) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { hosts, port } = await ctx.serve({ servedir: here, port: 4600 });
  console.log(`Preview: http://${hosts?.[0] ?? '127.0.0.1'}:${port}/`);
} else {
  await esbuild.build(options);
}
