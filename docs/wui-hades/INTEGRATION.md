# wui-hades — integration guide

How Hades couples to a WinCC OA project: datapoints, REST routes, managers,
permissions. Read this before deploying or wiring the page to a real plant.

## Runtime requirements

| Dependency | Why | Without it |
| --- | --- | --- |
| PARA REST route (`/api/para`, from `wui-para`'s backend) | Auto-creates `Hades_Tunnel` / audit DP types, writes config values, drives NGA archive switches | Page falls back to **offline** mode (in-memory demo, no persistence, no archiving) |
| `OaRxJsApi` WebSocket (runtime shell) | Live equipment states/measures (`dpConnect`), field commands (`dpSet`) | Static states, commands disabled |
| `hadesSim` manager (optional) | Demo/simulation: creates `HadesSim_*` DPs, auto-maps unbound equipment, animates the plant | Bind the real plant DPEs manually instead |
| NGA archive group(s) (`_NGA_Group`, active, non-alert) | The equipment dialog's "NGA archiving" section | Section shows "no group discovered" |

## Datapoints

- **`Hades_Tunnel`** (auto-created Struct `name`+`json`): one per tunnel — the
  whole config (tubes/segments, equipment + bindings, operating modes).
- **`AuditTrail_Hades`** (auto-created `_AuditTrail`): tunnel CRUD
  (`itemType: Tunnel`), every field command (`itemType: Command`, action
  `COMMAND`, item = target DPE, reason = mode/equipment context), and archive
  switches (`itemType: ArchiveConfig`).
- **`HadesSim_*`** (created by the manager): one per equipment when simulating.
- The real plant keeps its own DP types — Hades only **references** DPEs via
  each equipment's `bindings` (point key → DPE).

## Commands & permissions

- Edit/operate permission = `WuiUserService.canPublish` (same gate as the
  fleet pages). Without it the page is view-only: no save, no commands, no
  mode engagement, no archive switches.
- Every write to the field goes through a **confirmation dialog** and is
  **audited**. Unbound actions are skipped and reported in the mode card.
- Commands are plain `dpSet`s: interlocks/priority handling remain the
  responsibility of the target PLC/CTRL logic, as for any SCADA HMI.

## Regulatory profiles

`eu-2004-54` / `fr-cetu` / `ch-astra`, selectable per tunnel in the editor.
The advisor's thresholds are a **simplified reading** (see
`src/hades/data/compliance.ts` — each rule carries the clause it
approximates); the auto-fix buttons generate UNBOUND equipment at compliant
spacings. With `ch-astra` the equipment dialog also shows an **indicative
AKS-CH designation** per kind (LUE, BEL, SOS, FLW, VID, MES, BMA, SIG, ABS,
ENT, ENE, FUN, LOE) as a naming hint — the project's real AKS-CH structure
remains the integrator's decision.

## Deploy

- Curated deploy: `node tools/scripts/deploy-release.mjs --project <project>`
  (hades ships its manager via `tools/specs.json`; register `hadesSim` in
  `config/progs`: `node | manual | 30 | 2 | 2 |hadesSim/index.js`).
- Distributable package: `node tools/build-package.mjs tools/specs.json`
  → `packages/wui-hades/` (vendored `wui-kit`, manager, `module.json`,
  `install.mjs`).
- After any deploy: browser **`Clear site data`** (the service worker caches
  `menuconfig.json`).

## Tests

Unit specs colocated in `src/**/*.spec.ts` (vitest): compliance rules per
profile/direction, auto-fix convergence, centerline/bore geometry. They run
in any workspace with vitest; the only stubbed import is
`@wincc-oa/wui-i18n-shared/localize-multilang.js`.
