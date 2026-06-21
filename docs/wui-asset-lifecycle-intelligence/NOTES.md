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

Frontend: `data/product-info.ts` → `lookupProductInfo(mlfb)` = `POST /api/product-info/lookup`. Wired in `ui/ali-asset-dialog.ts`: "Recouper via MLFB (Siemens)" button (disabled if MLFB empty) → `.pi-panel` panel (obsolescence + delivery or error) → "Appliquer aux champs" button that patches phase/supply/successor.

### AI assistant scoped to the page's data

The page places `<mf-ai-prompt>` (reused from machine-fleet-3d) in the toolbar, scoped to the managed assets: `data/ai-context.ts` exposes `buildAssetAiSystemPrompt(assets)` (domain + guardrails + compact snapshot of the live inventory: designation/MLFB/computed risk/phase/criticality/supply/vuln/firmware/workshop/station/successor, cap 200) and `ASSET_AI_SUGGESTIONS` (5 preset prompts). The system prompt enforces a final "References" section with canonical URL patterns (Industry Mall, Industry Online Support, Siemens ProductCERT, NVD CVE) to avoid hallucinated deep-links. The system is rebuilt on each render (so it tracks edits). Scoping = "soft" guardrail (prompt + injected data); the winccoa MCP tools stay globally active, not disabled per call.

## Pitfalls / things to know

- **Siemens gateway — `Api-Version` header**: **never** send it on the product routes; any value (including `v2-earlyaccess`) makes it return **404 "Cannot GET"**. Omitting it uses the default that works. (api-key-details also requires the absence of a version.)
- **Credit limitation (not a bug)**: the dev key has `{delivery:100, obsolescence:0}`. Obsolescence lookups return **403 "Insufficient credit"** → surfaced in `errors.obsolescence`; **delivery works** (price €, lead times in days, country of origin, ECCN…). Check `api-key-details` for the credit if a lookup fails. The page handles this 403 gracefully.
- **Seeding `ProductInfo_Config`**: go through RAW `dpGet`/`dpSetWait`, not `readConfig()` (the `||DEFAULT` masking makes the empty-check always false).
- **iX icons**: the bundled version of `@siemens/ix-icons` in the deployed app is older than `node_modules` — names like `project`/`document` exist as SVG in node_modules but render the "crossed-out rectangle" fallback at runtime. Stick to names already used elsewhere (download/upload/plus/info/warning/trashcan/pen/box-open/add/folder/cogwheel…) or use a CSS text chip.
- **Persistence via REST only**: DP writes go through PARA REST (no direct write), reads via `dpGet` (raw form). See the FleetStore pattern (machine-fleet-3d) for the details.
- **Legacy phase remapping**: old PM300 ≠ new PM300 (different meaning) — any legacy data must be remapped by MEANING, and `normalizePhase()` is applied systematically on read and on import.
