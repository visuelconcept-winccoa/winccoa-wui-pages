# wui-asset-lifecycle-intelligence — business & architecture notes

Standalone WebUI page **Asset Lifecycle Intelligence** (route `/asset-lifecycle`, custom element `wui-asset-lifecycle`, class `WuiAssetLifecycle`). First level of the **asset-management** feature: inventory of field equipment (asset fleet) with a composite risk scoring engine. UI sub-components prefixed `ali-` (the page element stays `wui-`). Tier 3 (backend `/api` + MSA manager).

## Domain / purpose

Lifecycle and obsolescence-risk management of an **industrial asset fleet**. Each `Asset` groups:
- **Field identity**: MLFB (Siemens product reference), station, IP, workshop/zone, firmware (field + available), successor.
- **Risk inputs**: lifecycle phase (PLM), firmware gap, criticality, supply, vulnerability severity, operating hours, MTBF.
- **Provenance** (`source`: `tia` | `csv` | `manual`), labels + chip colors in `types.ts`.

Demo data: semiconductor fab plant / cleanroom utilities (16 assets: HVAC, Chiller, UPW, ASU air separation, gas cabinet, bulk gas/chemicals, scrubber, power distribution, lithography, wafer inspection, test, wastewater, control room), values tuned to span the full Low→Critical risk range.

### Lifecycle phases (official Siemens PLM)

`LifecyclePhase`, in order:
- **PM300** — active (orderable as a new part)
- **PM400** — phase-out announced (still a new part)
- **PM410** — cancellation (spare part only)
- **PM490** — discontinuation (under warranty)
- **PM500** — end of life

The made-up codes PM100/PM200 were removed. `normalizePhase()` (`types.ts`) migrates legacy codes PM100/PM200 → PM300 and neutralizes unknown values; applied on every read (`asset-store.readAsset`) and import (`io.normalize`). Caution: the old codes had a DIFFERENT meaning (old PM300 "end of production announced" = new PM400) — the remap is done by MEANING, not by code.

## Data model (DPs)

- **Persistence: 1 DP per asset**, type **`AssetLifecycle_Asset`** (Struct String `name` + `json`). The pattern copies FleetStore: auto-creation via PARA REST (`POST /api/para/dptype/create`, `/api/para/dp/create`, `/api/para/dp/set`, `DELETE /api/para/dp/:name?dpType=`); reading via `WuiDpeService.listDatapoints` + `OaRxJsApi.dpGet`.
- **Offline fallback** in memory, seeded with `DEMO_ASSETS` if backend/rights are absent → warning banner.
- **Product-info config: DP `ProductInfo_Config`** (Struct String `apiKey` / `baseUrl` / `apiVersion`), manager-side — API key never exposed to the browser. Seeded on first startup via RAW `dpGet` / `dpSetWait` (do not seed via `readConfig()`: its `||DEFAULT` masking makes the "empty" test always false).

### Import / export

- **JSON export**: `{kind, version, assets}` envelope, full round-trip.
- **CSV export**: adds computed score + level, UTF-8 BOM for Excel (export only).
- **JSON import**: `parseAssets` normalizes onto `blankAsset`, matches by `id` (update otherwise create); records with no explicit `source` are auto-tagged `csv`.
- **AML / TIA import** (`data/aml-import.ts`): parses a TIA Portal "CAx data" `.aml` export (CAEX XML) via `DOMParser`. Walk project → devices (role `Device`) → racks (TypeName `Rack` / name `*Rail*`) → modules; any module with a `TypeIdentifier` `OrderNumber:` becomes an asset (MLFB stripped of spaces, firmware from `FirmwareVersion`, IP from the first descendant `NetworkAddress`). Each asset carries `tiaProject` (AML project name) + `tiaKey` (`device/module#slot`, stable across re-exports). **Re-import**: matches on `tiaProject+tiaKey` and calls `mergeAmlAsset` → refreshes the hardware fields (name/mlfb/station/ip/firmwareField) while **preserving** the user's risk assessment (phase/criticality/supply/vuln/hours/mtbf/area/notes/successor/firmwareAvail).

## Key algorithms / formulas

### Risk engine (`risk.ts`)

Composite score **0–100** = Σ(componentScore × weight) over **6 weighted components**:

| Component      | Weight |
|----------------|--------|
| Obsolescence   | 0.25   |
| Firmware       | 0.20   |
| Criticality    | 0.20   |
| Supply         | 0.15   |
| Vulnerability  | 0.10   |
| Age            | 0.10   |

Per-component scoring tables + score → level matrix:

| Level     | Range   |
|-----------|---------|
| LOW       | 0–25    |
| MODERATE  | 26–50   |
| HIGH      | 51–75   |
| CRITICAL  | 76–100  |

Each level carries action / review frequency / alarm / color. The demo scores are **computed** (so they don't exactly match the deck's marketing numbers — they are illustrative).

### Product Information Hub mappers (`data/product-info.ts`)

- `phaseFromObsolescence`: derives the PLM phase from the date milestones (most advanced PM milestone passed → PM490/PM410/PM400, otherwise "purchasability" → PM300; PM500 manual).
- `supplyFromDelivery`: converts the new-part delivery lead time (days) into a supply bucket.

## Backend / manager

### Manager `productInfo` (MSA vRPC, pmon index 18)

Cross-references the **MLFB / product reference** with the **Siemens Product Information Hub** (`https://product-information-hub.siemens.cloud`) for obsolescence + delivery lead times. Holds the API key server-side. Single unary vRPC method **`Lookup`**(Variant<JSON `{productNumber, withDelivery?}`>) → Variant<JSON `{obsolescence, delivery, errors}`>. `getResource()` does a GET `/api/products/{n}/{obsolescence|delivery}` with header `Authorization: <apiKey>`. Never throws on HTTP status (a 403/404 on one resource lets the other through); a 401 on obsolescence → vRPC `Unauthenticated`.

### Webserver bridge `/api/product-info`

In the customer-webserver-example (TS): `productInfoController.ts` + `productInfoRoute.ts`, mounted `router.use('/api/product-info', …)` + ACL `fullAccess`. `Vrpc` required in a guarded way; `createAndInitialize` stub cached, recreated on error. Routes:
- `GET /health` → `{ok, service:'product-info', vrpc}`
- `POST /lookup {productNumber, withDelivery?}` → `callFunction('Lookup', …)` → 200 `{ok, ...parsed}` / 502 on error.

Frontend: `data/product-info.ts` → `lookupProductInfo(mlfb)` = `POST /api/product-info/lookup`. Wired in `ui/ali-asset-dialog.ts`: "Recouper via MLFB (Siemens)" button (disabled if MLFB empty) → `.pi-panel` panel (obsolescence + delivery or error) → "Appliquer aux champs" button that patches phase/supply/successor **and `supportUrl`** (when the obsolescence record carries one).

**Support page — one-click from the table**: `ali-asset-table` shows a per-row `export`-icon button that opens the Siemens Industry Online Support page in a new tab. It opens `asset.supportUrl` if stored (from a successful obsolescence lookup), otherwise the URL **derived from the MLFB** — `data/product-info.ts › deriveSupportUrl(mlfb)` = `https://support.industry.siemens.com/cs/ww/{lang}/pv/{MLFB}/pi` (same shape the API returns, localised to the UI language). So it works for every row even though the dev key has 0 obsolescence credit. The button is hidden only when the row has neither a stored URL nor an MLFB.

### Connection config UI (`ProductInfo_Config`)

A toolbar **gear** (`cogwheel`, `canEditFleet`-gated) opens `ui/ali-product-info-config-dialog.ts` to edit the Siemens API **base URL**, **API version** and **API token**, persisted to the `ProductInfo_Config` DP. Read/write flow mirrors the AI config (`wui-ai-kit/data/ai-store`) and lives in `data/product-info-config.ts`: read via `OaRxJsApi.dpGet`, write via PARA REST (`/api/para/dptype/create` + `/api/para/dp/create` + `/api/para/dp/set`); the type/DP are best-effort ensured so the UI works before the manager has seeded them. **No manager restart needed** — `productInfo` calls `readConfig()` on every lookup. **Security difference vs. the AI dialog**: the token is **write-only** — its value is never read back into the browser (the dialog only learns `hasKey: boolean`), and it is overwritten only when the operator types a new one (empty = keep current). This preserves the "key stays server-side" contract.

### AI assistant scoped to the page's data

The page places `<mf-ai-prompt>` (reused from machine-fleet-3d) in the toolbar, scoped to the managed assets: `data/ai-context.ts` exposes `buildAssetAiSystemPrompt(assets)` (domain + guardrails + compact snapshot of the live inventory: designation/MLFB/computed risk/phase/criticality/supply/vuln/firmware/workshop/station/successor, cap 200) and `ASSET_AI_SUGGESTIONS` (5 preset prompts). The system prompt enforces a final "References" section with canonical URL patterns (Industry Mall, Industry Online Support, Siemens ProductCERT, NVD CVE) to avoid hallucinated deep-links. The system is rebuilt on each render (so it tracks edits). Scoping = "soft" guardrail (prompt + injected data); the winccoa MCP tools stay globally active, not disabled per call.

### Internationalisation (i18n)

All user-visible page strings follow the active WebUI language (EN / FR / DE). Translations live in **`i18n.ts`** as `MultiLangString` maps (`ml(en, fr, de)` helper, base `.utf8` locale keys so any country variant resolves) plus the `MSG` group of static strings and a few interpolated message builders (`confirmDeleteMsg`, `amlImportedMsg`, `obsLevelMsg`, `daysMsg`). The status/lifecycle/criticality/etc. label maps in `types.ts` and the risk-band `label`/`action` in `risk.ts` are themselves `MultiLangString`.

Rendering: use **`localizeDir(map)`** in templates (reactive — re-renders on language change via the shared `lit-translate` singleton, same instance as the app shell) for visible text; **`localize(map)`** for plain-string contexts (tooltips/`title`, error state, `<wui-confirm-dialog>` `message`). Non-UI consumers stay French on purpose: the AI system prompt (`ai-context.ts`) and CSV export (`io.ts`) call `localize(map, 'fr.utf8')`. `lit-translate` + `@wincc-oa/wui-i18n-shared` **must** be shared externals (they are, via the import map) — if a page bundled its own copy, the language singleton would diverge and strings would not follow the user's language.

### Asset grouping & tree view

Each row is **one MLFB** (component). The optional **`assetGroup`** field (Asset interface + editable "Asset" column / dialog field) groups several MLFBs into one logical **asset**. The page has a **Table ⇄ Tree** toggle: the tree (`ui/ali-asset-tree.ts`, built by the pure `data/asset-tree.ts › buildAssetTree`) shows **Workshop (area) → Asset (assetGroup) → Station → MLFB**. Grouping-node aggregation (`data/asset-tree.ts`): the headline **`score` = the WORST component** (max descendant leaf score) — an asset is as risky as its weakest part — and the node is **coloured by that score on the same 0–100 bands as a leaf**, so colour and number always agree. `sum` (total exposure, can exceed 100) and `count` are shown as a **neutral secondary** chip (`N · Σsum`), never colour-coded as a level. (Earlier the badge showed the *sum* coloured by the *worst level* — incoherent: a 5-component asset summing 211 looked "high/orange" while a 3-component asset summing 184 with one critical part looked "critical/red". Max-headline fixes that.) The MCP `ali_group_scores` / `ali_asset_tree` tools use the same model (`score` = worst component, ranked by it; `sum` secondary). Empty `area`/`assetGroup`/`station` fall back to localized placeholders (Ungrouped / No station). Clicking a leaf emits `wui:edit` (opens the editor). Demo fleets ship pre-grouped (see `ASSET_GROUPS` in `demo-assets.ts`; e.g. the semicon **UPW System** bundles its HMI + pump controller).

### Dedicated MCP server (`aliMcp` manager)

A dedicated **Streamable-HTTP MCP server** (`backend/managers/aliMcp/`, manager `aliMcp`, port `ALI_MCP_PORT` default **3100**, `/mcp` + `/health`, optional `ALI_MCP_TOKEN` bearer) exposes ALI-specific tools over the `AssetLifecycle_Asset` datapoints. `ali-core.js` is a **server-side JS port of `risk.ts` + `asset-tree.ts`** (same composite scores as the UI). 13 tools:
- **Read/analyse:** `ali_list_assets` (filters), `ali_get_asset`, `ali_fleet_summary`, `ali_top_risks`, `ali_asset_tree` (summed group scores), `ali_group_scores`, `ali_obsolescence_report`, `ali_search`.
- **Siemens PIH:** `ali_lookup_mlfb`, `ali_refresh_obsolescence` (dry-run by default; `apply:true` persists). Reads the key from `ProductInfo_Config` and calls the hub directly (does **not** go through the productInfo credit meter).
- **Write:** `ali_create_asset`, `ali_update_asset`, `ali_delete_asset` (direct DP ops, same `AssetLifecycle_<id>` / `name`+`json` shape as the UI store).

Deploy: `deploy:backend` copies it + adds the progs line; then **deps + the winccoa-manager junction** are required (see Pitfalls), and start the manager.

## Pitfalls / things to know

- **Siemens gateway — `Api-Version` header**: **never** send it on the product routes; any value (including `v2-earlyaccess`) makes it return **404 "Cannot GET"**. Omitting it uses the default that works. (api-key-details also requires the absence of a version.)
- **Credit limitation (not a bug)**: the dev key has `{delivery:100, obsolescence:0}`. Obsolescence lookups return **403 "Insufficient credit"** → surfaced in `errors.obsolescence`; **delivery works** (price €, lead times in days, country of origin, ECCN…). Check `api-key-details` for the credit if a lookup fails. The page handles this 403 gracefully.
- **Seeding `ProductInfo_Config`**: go through RAW `dpGet`/`dpSetWait`, not `readConfig()` (the `||DEFAULT` masking makes the empty-check always false).
- **iX icons**: the bundled version of `@siemens/ix-icons` in the deployed app is older than `node_modules` — names like `project`/`document` exist as SVG in node_modules but render the "crossed-out rectangle" fallback at runtime. Stick to names already used elsewhere (download/upload/plus/info/warning/trashcan/pen/box-open/add/folder/cogwheel…) or use a CSS text chip.
- **Persistence via REST only**: DP writes go through PARA REST (no direct write), reads via `dpGet` (raw form). See the FleetStore pattern (machine-fleet-3d) for the details.
- **Legacy phase remapping**: old PM300 ≠ new PM300 (different meaning) — any legacy data must be remapped by MEANING, and `normalizePhase()` is applied systematically on read and on import.
- **ESM manager needs a `winccoa-manager` JUNCTION**: an ESM JS manager (`"type":"module"`, like `aliMcp`/`mcpServer`) resolves `import 'winccoa-manager'` through real `node_modules` — it does NOT pick up the global CommonJS resolution that `require('winccoa-manager')` gets (that's why CommonJS managers like `productInfo` need no `node_modules`). So `aliMcp/node_modules/winccoa-manager` must be a **directory junction** to `C:\Siemens\Automation\WinCC_OA\3.21\javascript\winccoa-manager` — a real COPY breaks `binding.js`'s `require('../../../bin/winccoaconnection')` (relative path only resolves from the OA install). `deploy:backend` does NOT npm-install or create this; do it manually (or copy the other deps and `mklink /J` the junction). Symptom when wrong: `Cannot find module '../../../bin/winccoaconnection'` → manager crash-loops to stopped.
