# IP pre-audit — `winccoa-wui-pages`

> **Status: AUDIT — no license applied, no commit made (at the time this was written).**
> Document produced at step 1 of the open-source release. It had to be validated
> **before** any license/header was applied (steps 2 to 7).
> Date: 2026-06-28. Scope: full working tree excluding `node_modules/`, `dist/`, `.git/`, `.nx/`.

---

## 1. Method

- Inventory of files by type (working tree, excluding dependencies / build outputs).
- Search for third-party ownership markers: `Siemens`, `ETM`, `@wincc-oa`, `@etm-professional-control`, `copyright` headers, `@license`, `SPDX`, OSS licenses.
- Targeted inspection of the risk areas (scaffolded shell, backend, assets, `.zip` archive).
- Verification of the **actual Git status** (tracked / untracked) of each area — decisive, because a large part of the tree is currently untracked (a regenerated scaffold).

> ⚠️ **Important limitation.** This audit identifies the **probable origin** of files from headers, `package.json` metadata, structures and conventions. It is **not legal advice**. The items marked "TO VERIFY" require a human decision (and, for the Siemens/ETM-derived code, ideally confirmation from the parties involved).

---

## 2. Inventory by type (working tree, excluding `node_modules`/`dist`)

| Type | Count | Notes |
|---|---:|---|
| `.ts` | 692 | TypeScript source. ~285 tracked (VC libs), the rest in untracked `apps/`+`packages/` (scaffold + generated pages) |
| `.md` | 151 | Documentation (VC) |
| `.js` | 145 | Includes the backend managers — **of which 127 third-party ETM files (mcpServer)** |
| `.json` | 127 | Configs, `module.json`, manifests |
| `.mjs` | 37 | Tooling scripts (VC) |
| `.svg` | 36 | **33 = `semifab-icons` (origin to confirm)** + 2 docs (VC) + 1 third-party shell logo |
| `.jsonc` | 35 | Menu/config fragments (VC) |
| `.png` | 26 | 24 doc screenshots (VC) + `logo.png` + **`sie-light.png` = ETM@Siemens logo (third-party)** |
| `.example` | 3 | `.env.example` (2× mcpServer third-party, 1× aliMcp VC) |
| `.html` | 2 | `apps/dashboard-wc/index.html` (VC) + `docs/diagrams/decision-tree.html` (VC) |
| `.zip` | 1 | **`winccoa_projectmanager.zip` — WinCC OA project archive, mixed at-risk content** |
| others | — | `.scss`, `.css`, `.gitkeep`, lint/prettier configs (VC) |

**Git status (what is actually committed today)**:

| Area | Git tracked | Dominant origin |
|---|---|---|
| `libs/wui-*` (20 libs, 285 files) | ✅ tracked | **VC original** |
| `docs/` (67) | ✅ tracked | VC |
| `tools/` (12) | ✅ tracked | VC |
| `webserver/` (10) | ✅ tracked | VC |
| `backend/` (161) | ✅ tracked | VC **except** `backend/managers/mcpServer/` = **127 third-party ETM files** |
| `LICENSE` | ✅ tracked | **upstream MIT @wincc-oa (to be replaced)** |
| `package.json` (root), `apps/`, `packages/`, `libs/default-components/`, `oa-data/`, `winccoa_projectmanager.zip` | ❌ **untracked** | regenerated ETM scaffold + bundled pages + archive |

> 🔑 **Direct consequence**: today the committed repo is mostly **clean** VC code, except for one large third-party block: `backend/managers/mcpServer/` (127 ETM files). The other third-party items (the `default-components` shell, the ETM `package.json`, the `.zip` archive) are **untracked** — they will only be published if you decide to commit the full tree. **This is the first decision to make** (see §6).

---

## 3. AT-RISK files (third-party / non-VC origin)

### 🔴 R1 — `LICENSE` (root): upstream MIT @wincc-oa license
- Content: `MIT License — Copyright (c) 2023 @wincc-oa/webui-runtime`.
- This is the license of the **ETM/Siemens upstream project** `webui-runtime`, not VC's. **Tracked by Git.**
- **Recommendation: REMOVE / REPLACE** with VC's chosen license (AGPL-3.0 or BSL depending on the path). To be handled in step 2.

### 🔴 R2 — `package.json` (root): ETM template metadata
- `name: "@wincc-oa/webui-runtime"`, `author: ETM <npm.user@etm.at>`, `homepage: winccoa.com`, `license: MIT`, `bin: webui-runtime-init`.
- The repo is **built on top of the ETM `webui-runtime` scaffold**; this metadata belongs to ETM, not VC. **Untracked by Git.**
- **Recommendation: ISOLATE + FIX** — rename (`@visuelconcept/winccoa-wui-pages`), `author = VISUEL CONCEPT`, adjust `license`/`homepage`/`repository`. Do not apply a VC header while the ETM metadata remains.

### 🔴 R3 — `libs/default-components/`: ETM application shell (MIT)
- `package.json`: `name: "@wincc-oa/default-components"`, `author: ETM`, `license: MIT`, `homepage: winccoa.com`.
- This is the **app shell library, ETM property**, scaffolded then re-patched by VC via `tools/wire-workspace.mjs` (cf. the project memory "never hand-edit the scaffolded default-components"). **Untracked by Git.**
- Contains a third-party logo (see R6) and ETM `webui-*.ts` files with re-applied VC patches.
- **Recommendation: KEEP + ISOLATE** if published — **keep the MIT license + ETM copyright**, do **NOT** apply a VC AGPL header to it (MIT is compatible but the original copyright must be kept; VC patches may be noted separately). Ideally leave it **untracked/regenerated** rather than vendoring it into the public repo.

### 🔴 R4 — `backend/managers/mcpServer/`: ETM Control MCP server (ISC) — **127 files, TRACKED by Git**
- `package.json`: `name: "@etm-professional-control/winccoa-mcp-server"`, `author: "ETM Control GesmbH"`, `license: "ISC"`, `repository: github.com/winccoa/winccoa-ae-js-mcpserver`.
- Source headers: `index_http.js` / `index_stdio.js` line 4-5: *"This file was initially creates by Martin Kumhera and extended by AI with CNS (UNS) functions!"*.
- `helpers/icons/IconList.js`: a list of **1,407 Siemens iX icon names** (names, no embedded SVGs).
- This is the **largest third-party block actually committed** (~79% of `backend/`). ETM Control code, derived from an upstream repo.
- **Recommendation: ISOLATE (keep ISC license + attribution) or REMOVE.** Decision to make (§6): (a) take it out of the repo and consume it as the npm dependency `@etm-professional-control/winccoa-mcp-server`, or (b) keep it vendored **with its ISC `LICENSE` and original `NOTICE`**, **outside the AGPL scope** (no VC header). A 2nd copy exists under `packages/wui-machine-fleet-3d/manager/mcpServer/` (untracked).

### 🔴 R5 — `winccoa_projectmanager.zip`: WinCC OA project archive, mixed content — **untracked but referenced**
Once unpacked, it contains 25 files mixing **Siemens/SDK-derived material** and **VC material**:
- **WinCC OA SDK-derived (high risk)**: `scripts/webclient_http.ctl`, `scripts/libs/classes/MyHttpServer.ctl` (`class MyHttpServer : HttpServer`, `#uses CtrlHTTP/CtrlXml/CtrlPv2Admin` — the pattern of the `webclient_http` example manager shipped with WinCC OA), GEDI panels `panels/gedi/*.xml`.
- **Siemens branding**: `data/html/proj.html` embeds a *"WinCC OA Logo SVG"* + the title *"WinCC Open Architecture - Project manager"*.
- **VC**: `ProjectUploaderLib.ctl` (header `@copyright MIT @author orelmi`), `projectdownload.ctl` (FR comments, VC conventions).
- Referenced by tracked code: `backend/managers/processMonitor/index.js`, `libs/wui-process-monitor/src/process-monitor.ts` (likely only a "legacy" design reference).
- **Recommendation: REMOVE from the public repo** (or, if needed, refactor: extract only the VC-authored `.ctl` under a clear license, **delete** the WinCC OA logo and the SDK-derived `.ctl`/panels). A binary `.zip` blob mixing branding + SDK code is unsuitable for an open-source release. **First verify the functional impact** of the two references above.

### 🔴 R6 — `libs/default-components/src/assets/sie-light.png`: "ETM@Siemens" logo
- Referenced as the default logo: `webui-config.service.ts:12,154`, `webui-app-ix.ts:15` with `alt="ETM@Siemens" title="ETM@Siemens"` (`webui-app-ix.ts:142-143`).
- **Siemens/ETM branding — not relicensable.**
- **Recommendation: REPLACE** with a VISUEL CONCEPT logo (and fix `alt/title`) before publication. Lives inside the third-party shell R3.

### 🟡 R7 — `apps/dashboard-wc/public/semifab-icons/image1..33.svg`: 33 industrial symbols, unconfirmed origin
- SVG industrial symbols (tanks, pumps, valves…) with **German-localized** metadata: `id="Ebene_1"` ("Layer_1"), `Unbenannter_Verlauf` ("unnamed gradient") — the signature of an export from a German-locale vector tool. **Untracked by Git.**
- No copyright notice inside, **but** the "P&ID/SCADA symbol library" look + the German locale raise a doubt: **VC original** artwork? export from a **Siemens/WinCC OA symbol catalog**? a **third-party** symbol pack?
- **Recommendation: TO VERIFY (human).** Confirm these 33 symbols were created by VC or are royalty-free. If derived from a Siemens/third-party library → **ISOLATE/REMOVE**.

---

## 4. SAFE files (VISUEL CONCEPT — original) — recommendation: KEEP

| Area | Files | Verdict | Evidence |
|---|---|---|---|
| `libs/wui-*` (20 page libraries) | 285 tracked | **VC original** | `package.json` `author: "Visuel Concept"`; descriptive source headers without third-party copyright; Git history 100% `orelmi`/visuelconcept |
| `backend/managers/*` **except** mcpServer (aiAssistant, aliMcp, dplAscii, kpiCalc, machineSim, processMonitor, productInfo, productionOrdersKpi, rtspProxy, vncProxy) | ~30 | **VC original** | VC headers; standard `winccoa-manager` usage; "Siemens PIH" referenced only as an **external HTTP API**, not embedded |
| `backend/routes/*` | ~ | **VC original** | HTTP→vRPC controllers, bridge to the managers |
| `webserver/` | 10 | **VC original** | `@visuelconcept/wui-webserver`, depends on `@winccoa/backend` (dependency, not embedded) |
| `tools/` (`wire-workspace.mjs`, `dev-wiring/`, `scripts/`) | 12 | **VC original** | Own tooling, no third-party attribution |
| `apps/dashboard-wc/src/` + Vite configs | untracked | **VC original** (minimal entry point) bootstrapping the scaffolded shell | `main.ts`, `polyfills.ts`, VC Vite plugins |
| `packages/*/_vendor/` | untracked | **Internal duplication** of VC libs (`wui-kit`, `wui-fleet-core`, `wui-ai-kit`…) for bundling the standalone pages — **VC property** | file-by-file comparison with `libs/` |
| `docs/`, `docs/images/manual/*.png` screenshots, SVG/HTML diagrams | 67 | **VC original** | Documentation and application screenshots |

> Note: the **`@siemens/ix*`, `@wincc-oa/wui-*`, `@etm-professional-control/oa-rx-js-api`** dependencies are **external** npm packages (in `node_modules`, **not committed**) — out of relicensing scope. Their licenses (Siemens iX = MIT, ETM = MIT, etc.) remain theirs; to be documented in step 7 (THIRD-PARTY/`dep5`).

---

## 5. Recommendations summary (keep / isolate / remove)

| # | Item | Git status | Origin | Recommendation |
|---|---|---|---|---|
| R1 | root `LICENSE` (MIT @wincc-oa) | tracked | ETM/upstream | **REMOVE → replace** (step 2) |
| R2 | root `package.json` (ETM metadata) | untracked | ETM | **ISOLATE + fix** (name/author/license) |
| R3 | `libs/default-components/` | untracked | ETM (MIT) | **KEEP + ISOLATE** (keep MIT+ETM, no AGPL header); ideally not vendored |
| R4 | `backend/managers/mcpServer/` (127 files) | **tracked** | ETM Control (ISC) | **ISOLATE (ISC license + NOTICE) or REMOVE** → decision §6 |
| R5 | `winccoa_projectmanager.zip` | untracked | mixed Siemens-SDK + VC | **REMOVE** (or refactor + remove logo & SDK .ctl) |
| R6 | `sie-light.png` (ETM@Siemens logo) | untracked | Siemens/ETM | **REPLACE** with VC logo |
| R7 | `semifab-icons/*.svg` (33) | untracked | **uncertain** | **TO VERIFY** (human) before relicensing |
| — | `libs/wui-*`, `backend/*` (except mcpServer), `webserver/`, `tools/`, `docs/`, `apps/src`, `_vendor/` | mixed | **VC** | **KEEP** → targets of the SPDX headers (step 4) |

---

## 6. Decisions required BEFORE applying a license (step 2+)

I stop here as requested. To continue, I need your decisions:

1. **Published scope** — do we publish the **full working tree** (apps/, packages/, default-components, package.json, zip… currently untracked) or a **curated subset** (essentially `libs/wui-*` + VC backend + docs)? This determines how many of the third-party items above are actually involved.

2. **R4 `mcpServer` ETM (ISC)** — (a) **remove** it from the repo and consume it via npm, (b) **keep** it vendored with its ISC license + ETM Control attribution (outside AGPL), or (c) other? (It is the largest third-party block currently committed.)

3. **R5 `winccoa_projectmanager.zip`** — confirm we can **remove** it (verify the impact of the 2 references in `processMonitor`/`wui-process-monitor`), or do you want to refactor it?

4. **R7 `semifab-icons` (33 SVG)** — can you confirm they were **created by VISUEL CONCEPT** (or are royalty-free)? Otherwise they must be isolated/removed.

5. **R6 logo** — OK to **replace** `sie-light.png` with a VC logo (and fix `alt/title="ETM@Siemens"`)?

> Once these points are decided, I will proceed to steps 2→7 (LICENSE, NOTICE, SPDX headers on the **VC code only**, CONTRIBUTING+CLA, README, `.reuse/dep5`), then I will prepare **a single commit** (not pushed) and show you the diff. No license or header will be applied to the third-party items R1–R7 until you have validated it.

---

## 7. Decision tracking (update)

Decisions validated by the user on 2026-06-28: **scope = curated subset**;
**R4 mcpServer → remove** (consume via npm); **R5 .zip → remove**; **R7 semifab-icons = third-party** (do not relicense).

| # | Decision | Action taken |
|---|---|---|
| R1 | Replace the upstream MIT LICENSE | **Done** — `LICENSE` = verbatim AGPL-3.0 text (*licensing* commit) |
| R4 | Remove `backend/managers/mcpServer/` (third-party ETM, ISC) | **Done** — `git rm` (127 files); removed from `tools/specs.json`; added to `.gitignore`; machine-fleet-3d/MANUAL/README docs updated (MCP = optional external server via npm `@etm-professional-control/winccoa-mcp-server`); ISC stanza removed from `.reuse/dep5` (*IP cleanup* commit) |
| R5 | Remove `winccoa_projectmanager.zip` | **Not published** (untracked) + added to `.gitignore`; references = comments only (no functional impact) |
| R7 | `semifab-icons` (third-party) | **Not published** (untracked, under `apps/`) + added to `.gitignore`; **to be replaced** with original/licensed symbols |
| R2/R3/R6 | ETM `package.json` / `default-components` / `sie-light.png` logo | **Out of published scope** (untracked scaffold, excluded from the curated subset) — to be fixed only if the full tree is ever published |

> Remaining for VC: replace the `semifab-icons` with clean assets; if a public root
> `package.json` is ever committed, fix `name`/`author`/`license` (currently ETM
> metadata). The AI assistant works without the MCP server (no tools); for MCP tools,
> install the ETM npm package separately.
