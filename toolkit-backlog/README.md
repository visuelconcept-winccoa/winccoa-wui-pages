# toolkit-backlog — features waiting for wui-toolkit

The former tooling of this repo (`tools/`, `webserver/`, the `.runtime` workspace)
was replaced by [wui-toolkit](https://github.com/visuelconcept-winccoa/winccoa-wui-tools).
What the toolkit does not do yet is parked here, **as it was** — not wired, not
run, not maintained. Each item is to be reintegrated into the toolkit, then
deleted from here.

| Item | What it did | Gap in wui-toolkit 0.5.0 |
| --- | --- | --- |
| [screenshot-pages.mjs](screenshot-pages.mjs) | Playwright captures of every page (`docs/images/manual/`, used by `docs/MANUAL.md`), logged in against a **live** WinCC OA, optional `--demo` data | Needs a dev server that proxies `/api`, `/WebUI_*`, login and the data WebSocket to a live backend: `wui dev` serves mocks only. Toolkit: a live-backend mode for `wui dev` (e.g. `"targets": { "live": { "backend": "https://…" } }`), then a `wui screenshots` command driving it. |
| Offline backend typecheck | Typecheck a module's `backend/*.ts` against stubbed webserver packages (`ultimate-express`, `@winccoa/backend`, `winccoa-manager`) | Kept per module for now: `libs/wui-eng-studio/typecheck/` (the only module that has it). Toolkit: generic `wui test` step typechecking every selected module's backend `files` + `shared` with shared stubs. |

Not parked — the toolkit covers them: workspace bootstrap and wiring (`wui dev`),
page/backend deployment and the interactive module selection (`wui use` +
`wui build`), per-page distributable packages (`wui pack` + the npm packages),
the webserver and its installer (`wui init target` / `init webserver`), the menu
merge, the runtime's `oa-data` scripts — and, since 0.5.0, the Application Security
manifest (`app-security-manifest.json`) and the libs' vitest unit tests (`wui test`).
