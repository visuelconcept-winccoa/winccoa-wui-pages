<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Middleware-Script preview — run the page WITHOUT WinCC OA

A self-contained harness that renders the **real page code**
(`../src/middleware-script.ts`, unmodified) with the **real Siemens iX
components** (npm, v2.x — the runtime's generation: `ix-tabs` still emits
`selectedChange`), while the WinCC OA layer is **stubbed** (`stubs/*`):
in-memory task store, simulated live values/statuses, granted roles, and a
fetch mock whose `/api/middleware-script/test` performs a genuine browser-side
dry-run of the draft script.

Use it to **iterate on the module visually** without a WinCC OA project, and
to produce the documentation screenshots.

```bash
cd libs/wui-middleware-script/preview
npm install
npm run dev     # watch + serve  →  http://127.0.0.1:4600
npm run shots   # build + capture docs/images/manual/middleware-script{,-test,-model}.png
```

The demo scene includes a reusable MODEL («Seuil avec hystérésis», declared
aliases + parameters) and a task instantiating it («Alarme température four 2»,
`seuilHaut: 250`) — handy to iterate on the instantiation UX.

A floating **clair / sombre** button (bottom right, preview-only — hidden in
the screenshot captures) toggles the iX theme class on `<body>`, to exercise
the editor's theme-aware syntax palette and the page in light mode.

`npm run shots` uses `playwright-core` with the Chromium pointed to by
`PW_CHROMIUM` (default `/opt/pw-browsers/chromium`, the Claude-Code remote
container's install; point it to any local Chrome/Chromium otherwise).

## Tuning the demo scene

Everything lives in [`seed.js`](./seed.js):

- `__previewSeed` — the demo tasks (the in-memory store is seeded from it);
- `__previewDpValues` — simulated `dpGet` values (Test tab "live" loads);
- `__previewStatuses` — the `.status` payloads behind the list badges;
- `__previewRoles` — e.g. `{ edit: false }` to preview the locked UI;
- `__previewLocale` — `'fr.utf8'` by default (`en_US.utf8`, `de.utf8`).

## What the preview does NOT cover

- The real `middlewareScript` manager (triggers, worker/vm sandbox limits,
  `.status` writes) and the vRPC bridge — the preview dry-run is a plain
  `new Function` in the browser.
- The runtime shell (import maps, service worker, menu, real header) and the
  runtime's exact iX build — always verify on a deployed project before
  releasing (see ../../../docs/wui-middleware-script/INTEGRATION.md).
- Application-Security enforcement (all roles granted by default).

## How the stubbing works

`build.mjs` bundles the page with esbuild and **aliases** the runtime-only
imports to `stubs/*` (`@wincc-oa/wui-shared` styles, i18n localize, wui-kit
app-security + DpJsonStore, `oa-rx-js-api`, the two shell wrapper components).
`lit`, `rxjs`, `tsyringe` are the real packages; iX is loaded un-bundled from
`node_modules` by `index.html` (Stencil lazy chunks over HTTP — hence the dev
server's root is this directory).
