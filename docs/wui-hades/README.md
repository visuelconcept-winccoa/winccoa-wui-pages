# @visuelconcept/wui-hades — source module

The **Hades** road-tunnel management pages (`/hades` + `/hades/:tunnel`):
an integrated tunnel description — PK-referenced segments, typed equipment
bound to datapoints, operating modes — rendered four ways from ONE config:

- **3D twin** — the bore is generated procedurally (three.js) from the
  segment list (length / gradient / curve radius / lanes); equipment
  primitives sit at their PK/side and recolour live from the bound state
  DPEs. Free orbit camera + a "drive through" mode along the centerline.
- **Editor + compliance advisor** — segments and equipment are edited in
  place; every edit is re-checked against the tunnel's **regulatory
  profile** (selectable: EU directive 2004/54/EC, France CETU/IT 2000-63,
  Switzerland ASTRA/OFROU) and deviations (exit/SOS spacing, missing
  ventilation, gradients…) appear immediately with the clause reference.
  The thresholds are a simplified reading — a design aid, not a
  certification (see `src/hades/data/compliance.ts`).
- **Linear synoptic** — the tunnel unrolled on its PK axis (SVG), glyphs
  coloured by live state; the control-room scan view.
- **Operating modes** — reflex sequences (normal / closure / fire) whose
  actions are real field commands: each `dpSet` is **confirmed** in the UI
  and **GxP-traced** into `AuditTrail_Hades` (action `COMMAND`).

## Persistence & data model

One `Hades_Tunnel` datapoint per tunnel (Struct `name` + `json`), managed by
the shared `DpJsonStore` of `@visuelconcept/wui-kit` (auto-created DP type
via the PARA REST API, in-memory offline fallback seeded with the demo
"Tunnel du Styx"). Tunnel CRUD is audited; live telemetry fields are
stripped before diffing. Equipment instances only **reference** field DPEs
(`bindings`: point key → DPE) — the plant keeps its own DP types.

## Manager

**`hadesSim`** (`backend/managers/hadesSim/`) — WinCC OA JS manager that
creates a `HadesSim` DP type + one `HadesSim_<equipmentId>` DP per
configured equipment, auto-maps unbound equipment to the simulation, then
simulates the plant every second (fans/lighting/pumps follow the page's
commands; CO/NO₂/opacity/air-speed drift with the ventilation; random SOS
calls and AID incidents). Register in `config/progs`:

```
node | manual | 30 | 2 | 2 |hadesSim/index.js
```

## Dev notes

- Entry: `libs/wui-hades/src/hades.ts` (`wui-hades`); menu wired by
  `menu.fragment.jsonc` (routes `/hades`, `/hades/:tunnel`).
- `three` is provided by the workspace (already pinned in
  `tools/external-dependencies.mjs` for the fleet pages).
- Edit permission = `canPublish` (shared gate of `wui-kit`); operators
  without it get a view-only page (no save, no commands).
