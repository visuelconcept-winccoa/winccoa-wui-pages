<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Ampère standalone harness — « sans WinCC OA »

Run the `wui-ampere` page **without any WinCC OA backend and without any
`@wincc-oa/*` runtime package**, to demo the module and capture screenshots of
its built-in demo networks (`libs/wui-ampere/src/ampere/data/demo.ts`).

## How it works

- Every shell import (`@wincc-oa/*`, `@etm-professional-control/oa-rx-js-api`)
  is aliased in `vite.config.mjs` to a local stub under `src/stubs/`. The
  `OaRxJsApi` stub **throws on construction**, so the pages' own
  `container.resolve()` try/catch yields the clean offline path.
- The page's designed offline fallback does the rest: `DpJsonStore` seeds the
  in-memory demo networks and flips the offline notice.
- `@visuelconcept/wui-kit` / `wui-ai-kit` resolve straight to their sources in
  `libs/` — no build step.
- Navigation: `?network=<id>` opens a network; `?embed=1&network=<id>` uses the
  page's own chromeless fitted rendering (the mosaic-tile contract).

## Usage

```bash
cd tools/ampere-standalone
npm install
npm run dev                 # http://127.0..0.1:4310
# screenshots (Chromium; set CHROMIUM_PATH if not /opt/pw-browsers/chromium):
npm run shoot               # -> out/ampere.png, ampere-detail.png, ampere-railway.png
```

Note: Vite reads `libs/wui-ampere/tsconfig.json`, which extends the repo's
generated `tsconfig.base.json`. If the workspace has never been wired, create a
minimal one at the repo root (`experimentalDecorators: true`,
`useDefineForClassFields: false`) — see `DEVELOPMENT.md` for the full setup.

Screenshots land in `out/` (git-ignored); the curated copies used by the manual
live in `docs/images/manual/ampere*.png`.
