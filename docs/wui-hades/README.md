# @visuelconcept/wui-hades — source module

The **Hades** road-tunnel management pages (`/hades` + `/hades/:tunnel`):
an integrated tunnel description — PK-referenced segments, typed equipment
bound to datapoints, operating modes — rendered four ways from ONE config:

- **3D twin** — the bore is generated procedurally (three.js) from the
  segment list (length / gradient / curve radius / lanes); equipment
  primitives sit at their PK/side and recolour live from the bound state
  DPEs (faults pulse). Free orbit camera + a "drive through" mode along the
  centerline. Two selectable render styles (persisted per browser):
  **modern** — light concrete, cool lighting and continuous cyan LED
  light-lines along both walls and the crown — and **simple** — the sober
  engineering look. Optional projected **name labels** (state dot, click to
  open) via the toolbar toggle.
- **Editor + compliance advisor** — segments and equipment are edited in
  place; every edit is re-checked against the tunnel's **regulatory
  profile** (selectable: EU directive 2004/54/EC, France CETU/IT 2000-63,
  Switzerland ASTRA/OFROU) and deviations (exit/SOS spacing — direction
  aware, missing ventilation, gradients…) appear immediately with the
  clause reference and, where possible, a **Fix** button that generates the
  missing equipment at compliant spacings. Bulk placement via
  **"Place a series…"** (one SOS niche every 200 m). The thresholds are a
  simplified reading — a design aid, not a certification (see
  `src/hades/data/compliance.ts`).
- **Linear synoptic** — the tunnel unrolled on its PK axis (SVG), glyphs
  coloured by live state (faults pulse); clickable **state counters**
  (fault/warning/run/off) that filter the band, a **kind filter** and an
  optional name layer — the control-room scan view.
- **Operating modes** — reflex sequences (normal / closure / fire) whose
  actions are real field commands: each `dpSet` is **confirmed** in the UI
  and **GxP-traced** into `AuditTrail_Hades` (action `COMMAND`). Modes are
  **composed in the UI** (mode dialog: identity + ordered command list over
  the commandable equipment).

- **Logbook ("main courante")** — the timestamped operations journal,
  auto-fed (alarm transitions, commands, mode engagements) plus operator
  notes, with the **incident lifecycle** (open → attach entries → close).
  Stored per tunnel in a capped `Hades_Logbook_<id>` DP.
- **Safety-file report** — one click generates a dated, printable HTML
  report (geometry, inventory with binding status, compliance findings with
  clause references, modes, incident record) for the periodic safety
  documentation.
- **Exercise mode (drills)** — built-in scenarios (HGV fire, accident + SOS,
  ventilation failure) injected into the twin (smoke in the 3D); every
  operator command is **intercepted and simulated** (safe on a live plant),
  timed against the expected-actions checklist and **scored**.
- **Observation (retrofit) mode** — per-tunnel read-only toggle: live
  reading of an existing GTC's datapoints, zero writes (see
  [RETROFIT.md](./RETROFIT.md)).

Camera equipment can be **linked to an RTSP stream** of the
`wui-camera-streams` module (tier 3: rtspProxy manager + `/api/rtsp`): the
equipment dialog then embeds the live video through the chromeless
`/camera-streams/<id>` route. Three importable **demo tunnels** (Styx —
EU reference, Léthé — Swiss twin-tube motorway, Achéron — French short
urban bidirectional) exercise every profile and direction.

Also: tunnel **export/import as JSON** and one-click **duplication**
(overview cards + workspace toolbar), **NGA archiving** of the bound DPEs
from the equipment dialog (group discovery + audited switches), painted
**lane-direction arrows** in the 3D roadway (counter-flow in bidirectional
tubes), and an indicative **AKS-CH designation** per equipment kind when the
Swiss profile is selected. See [INTEGRATION.md](./INTEGRATION.md) for the
backend coupling and [the unit specs](../../libs/wui-hades/src/hades/data/compliance.spec.ts)
for the rule-by-rule behaviour.

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
