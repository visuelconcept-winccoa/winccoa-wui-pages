// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Single source of truth for the third-party npm packages that page libs pull
// in BEYOND what the @wincc-oa/webui-runtime workspace already provides.
//
// Keyed by the import specifier seen in page source; value is
// [installName, versionRange]. Page lib package.json files pin these as "*", so
// the authoritative version lives here.
//
// Consumed by:
//   - tools/build-package.mjs             (detect deps in vendored page output)
//   - tools/install-page-dependencies.mjs (install them into a dev workspace)
//
// Notes:
//   - `echarts` is satisfied by @siemens/ix-echarts (already a runtime dep).
//   - @novnc/novnc MUST stay pinned EXACTLY at 1.4.0 — ^1.4.0 floats to 1.7.0,
//     whose `exports` forbid the deep import @novnc/novnc/core/rfb.js
//     (see DEVELOPMENT.md).
//   - maplibre-gl MUST stay on 5.x. A page ships as ONE self-contained ESM chunk
//     dynamically imported from /data/dashboard-wc/pages/<page>.js, and 5.x inlines
//     its tile worker as a blob: URL — no extra URL to resolve against a base path
//     and nothing new for the service worker to cache. 6.x emits the worker as a
//     separate real URL and also drops WebGL1; neither buys the GIS page anything.
//     `dist/maplibre-gl-csp.js` is the fallback if a deployment ever forbids
//     blob: workers via CSP (see docs/wui-gis/NOTES.md).
// -----------------------------------------------------------------------------
export const EXTERNAL_DEPENDENCIES = {
  echarts: ['@siemens/ix-echarts', '~3.0.0'],
  '@siemens/ix-echarts': ['@siemens/ix-echarts', '~3.0.0'],
  three: ['three', '^0.169.0'],
  'maplibre-gl': ['maplibre-gl', '^5.24.0'],
  '@novnc/novnc': ['@novnc/novnc', '1.4.0'],
  '@cycjimmy/jsmpeg-player': ['@cycjimmy/jsmpeg-player', '^6.1.2']
};
