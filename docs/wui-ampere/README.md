<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# @visuelconcept/wui-ampere — Ampère (electrical single-line diagrams)

**Ampère** is a standalone WinCC OA WebUI page to **draw, wire and animate
single-line (mono-filaire) electrical distribution networks** — substations
(TGBT/TGT), incomers, busbars, disconnectors, circuit breakers, transformers,
feeders, loads and measuring devices.

- `/ampere` — overview list of saved networks
- `/ampere/:networkid` — open one network (display or edit)

Frontend-only (Tier 1): **one datapoint per network** (`Ampere_Network`), with a
transparent in-memory demo fallback when no writable backend is available. No
manager, no webserver rebuild.

## Features

- **In-place edit mode** with a symbol **Toolbox** grouped by family
  (sources & substations, busbars & links, switchgear, measures/loads/earth).
  Pick a symbol → click to place; drag on a magnetic grid; click a port (○) then
  another to draw a wire; `Esc` cancels a wire; `Del`/`⌫` removes the selection.
- **Properties inspector**: label, 90° rotation, and — for switchgear — the
  **free-form state datapoint** (open/closed), the value meaning "closed", and a
  "source" toggle.
- **Live wire energisation**: computed by a graph traversal from the sources
  through the **closed** switchgear (`ampere/topology.ts`). Opening a breaker or
  disconnector (live datapoint) darkens everything downstream — no per-wire
  binding needed.
- **Live measurements**: value labels bound to any datapoint, placed **anchored
  to a symbol** or **free anywhere** in the circuit.
- **AI assistant** (reuses `@visuelconcept/wui-ai-kit`): a proposal-only,
  toolless chat that generates a network model from a prompt; the user reviews
  and applies it to the editor. Hidden unless enabled at deploy time
  (`dashboard-features.json` → `aiAssistant: true`).

## Architecture

```
src/ampere.ts                 <wui-ampere> — master/detail router, live dpConnect,
                              edit orchestration, persistence, AI apply
src/ampere/
  types.ts                    domain model (Network/Node/Edge/Measurement) + geometry
  topology.ts                 energisation graph (BFS from sources through closed switchgear)
  i18n.ts                     FR/EN/DE strings
  ai-context.ts               AI system prompt + JSON network-proposal extraction
  symbols/catalog.ts          IEC 60617-inspired inline-SVG symbol library + ports
  data/ampere-store.ts        DpJsonStore<Network> (type Ampere_Network)
  data/io.ts                  import/export + normalisation (reused by the AI)
  data/demo.ts                offline demo TGBT
  ui/am-canvas.ts             SVG drawing surface (edit + runtime)
  ui/am-toolbox.ts            symbol palette + tool switcher
  ui/am-inspector.ts          properties panel
  ui/am-network-table.ts      overview list
  ui/am-network-dialog.ts     create/rename dialog
  ui/am-ai-assistant.ts       AI chat (wui-ampere-ai-assistant)
```

### Symbols

Symbols are drawn **inline as SVG** in `symbols/catalog.ts` (no external asset,
no network fetch), using `currentColor` so they theme with the dashboard and tint
green when energised. Each symbol declares named connection **ports** (local box
coordinates); the canvas rotates/translates them into world space to route the
orthogonal wires. Add a symbol by extending the `SymbolId` union and the
`SYMBOLS` map — set its `role` (`switch` conducts only when closed; `source`
seeds energisation; everything else conducts through all ports).

### Data binding

Each switchgear symbol binds **freely** to a datapoint element giving its
open/closed position (no naming convention imposed). The page subscribes to all
bound datapoints via `OaRxJsApi.dpConnect`, derives the closed-state map, and
recomputes the energisation on every live change. Measurement labels bind to any
datapoint element and are formatted with the configured unit + decimals.

## Persistence

`AmpereStore extends DpJsonStore<Network>` — one `Ampere_Network` datapoint
(Struct `name` + `json`) per network, auto-created via the PARA REST API, with a
GxP audit trail (`AuditTrail_Ampere`) and an offline in-memory demo fallback.

## Notes / caveats

- Energisation is **derived, never stored** — only the datapoint *bindings* are
  persisted.
- Switchgear with no bound datapoint (or before the first live value) is treated
  as **closed**, so a freshly drawn diagram lights up during design.
- The AI assistant is OFF by default; deploy with
  `tools/scripts/deploy-release.mjs … --ai-assistant` to enable it.
