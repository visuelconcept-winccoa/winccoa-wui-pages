# @visuelconcept/wui-gis — source module (Tier 1)

**GIS** pages for a WinCC OA WebUI dashboard: **`/gis`** (every site — also the
multi-site view) and **`/gis/:siteid`** (one site's map).

Map-based monitoring on **MapLibre GL** over **OpenStreetMap** — both free of licence
cost (MapLibre GL JS is BSD-3-Clause, OSM data is ODbL). Each site carries:

- **geo-located assets** bound to project datapoints, with **live values on the marker**;
- **alarm highlighting** taken from the datapoint's own alert state, so the map and the
  Alarms page agree by construction;
- **grouping when zoomed out** (on by default), as a hierarchy: assets → one badge per
  **area** → one badge for the whole **site**. A badge is a **fault synthesis and nothing
  else**: it states how many of its assets are in alarm, and a group with no alarm draws no
  badge at all. A quiet plant zoomed out is a quiet map, and anything visible on it is
  something to go and look at; clicking a badge zooms to exactly its members. Both thresholds
  are configurable, per area and per site, and default to automatic;
- **areas** (districts, sectors, catchments) drawn as polygons that group the assets. An
  asset can belong to **several** — shared equipment on a sector boundary is counted by
  every zone that claims it — and an area's outline can be **fitted around its assets** in
  one click (a concave outline following the shape they make, not a hull closed by a chord
  across empty ground) or reshaped corner by corner. Zone names show on hover, so a dozen
  zones do not put a dozen labels on the map;
- **connections**: supervised links between two assets — a metro segment, a feeder, a main,
  a road — each with its own datapoint, its own alarm colour and its own drill-down, grouped
  into named **lines**. Their ends are the assets themselves, so moving a marker moves every
  line attached to it;
- **information layers**: free tags on assets and connections, created from the layer browser
  or straight from an asset, and switched on and off to filter the map;
- a configurable **drill-down**: map → area → asset → its process or 3D view;
- **import / export**: native JSON for a complete round-trip (bindings, readings,
  drill-down, basemap), and **GeoJSON** for QGIS interop — which is also how surveyed
  coordinates get in;
- a **proposal-only AI assistant** that drafts a site — its areas and its assets — from a
  sentence, and then *amends* it: it receives the open site as data and answers with a
  patch, so a follow-up completes the site instead of overwriting it, and the apply button
  shows the resulting diff (added / modified / removed). One parametric op creates assets in
  bulk (a line of valves, a grid of lamps). Everything is reviewed on the map before
  anything is saved (off unless the deploy enables it).

Self-contained **source** distribution: the shared kit is **vendored** under
`gis/_vendor/wui-kit/` (no `@visuelconcept/*` prerequisite), and the page is built on
the target's runtime workspace, so the bundle always matches its version.

## Install (one command)

```bash
node install.mjs --workspace <runtime-workspace> --project <winccoa-project-root>
```

- `--workspace` = the `@wincc-oa/webui-runtime` workspace that builds this project's dashboard (e.g. `…/WebDemo2/webui-workspace`).
- `--project` = the WinCC OA project root (its `data/dashboard-wc/` is the deploy target).

It (1) copies the page source (kit vendored) into the workspace, (2) adds the two menu
entries, (3) `npm install`s **`maplibre-gl@^5.24.0`** into the workspace so
`build:pages` can bundle it, (4) merges the role catalog into
`app-security-manifest.json`, then (5) runs `build:pages` into
`<project>/data/dashboard-wc/`.

## After install

1. **Browser:** reload logged in. The build touches `index.html`, so the service worker
   purges its runtime caches and a plain **F5** is enough.

## Prerequisites

- A **WebUI Runtime workspace** for the target project (the `--workspace`).
- **WebGL** in the client browser — MapLibre draws the map on the GPU. A panel PC with
  a bare VM graphics driver has none; the page then says so instead of showing a blank
  frame.
- **`@visuelconcept/wui-para`** (the `/api/para` route) if the sites are to be
  **persisted**. The page auto-creates the `GIS_Site` DP type and its datapoints
  through that API; without it the page still runs, read-only, on the demo sites and
  says so.
- No backend route and no manager the page needs (**Tier 1**). One **optional** manager
  ships beside it for demos and commissioning — see
  [The network simulator](#the-network-simulator-gissim).
- **For the AI assistant only** (optional): the `/api/ai` bridge and an assistant enabled
  at deploy time (`dashboard-features.json`). Without either, the page is unchanged and the
  assistant simply does not appear.

## Prerequisites (runtime)

- **The datapoints the assets bind to must already exist.** This page binds, it never
  creates process datapoints — pick them with the autocomplete in the asset inspector, or
  let the optional [simulator](#the-network-simulator-gissim) create and drive a set of its
  own.
- **For a marker to highlight in alarm**, its primary datapoint needs `_alert_hdl`
  configured in the project (the PARA page's *Alarming* tab does that). A datapoint
  without it simply never highlights.
- **A basemap the browser is allowed to reach.** Any **off-origin** basemap (including the
  public OpenStreetMap tiles a new site defaults to) needs **"Allow external resources"**
  enabled in the WinCC OA WebUI settings. Without it the shell injects
  `default-src 'self' …`, and the browser refuses the tile requests — the page detects
  this and names the setting. See [Basemaps](#basemaps).

## Basemaps

Per site, in *Site settings → Basemap*:

| Kind | What it fetches | When |
| --- | --- | --- |
| **OpenStreetMap (public tiles)** | `tile.openstreetmap.org` | Demo and evaluation. Free of licence cost, but the **OSMF tile usage policy** caps it at light traffic — it is not a production tile source. |
| **Own raster tile server (XYZ)** | your `{z}/{x}/{y}` template | The normal production choice: your own OSM mirror, or any XYZ service you are entitled to use. |
| **Own vector style (MapLibre JSON)** | your style JSON URL | When you already run a vector tile stack. Its own sources, layers and fonts apply. |
| **No basemap (offline)** | nothing | **Air-gapped plants.** Assets and areas still draw, over a themed background. Nothing on this page needs the network. |

> **Off-origin tiles need "Allow external resources".** The WebUI shell injects
> `default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:` whenever the project
> setting `allowExternalResources` (from `GET /WebUI_Settings`) is off. MapLibre fetches
> tiles with the Fetch API, `connect-src` inherits from `default-src`, and every external
> host is refused. Enable the setting, or use a **same-origin** tile server (allowed by
> `'self'` with no setting change), or *No basemap*. Full detail in
> [NOTES.md](./NOTES.md#content-security-policy).

The **Attribution** field is what the map's corner credit shows; keep whatever the tile
licence requires (OSM data requires crediting OpenStreetMap contributors).

## The network simulator (`gisSim`)

**Optional**, for a demo, a training session, or a site drawn before its real datapoints
exist. A WinCC OA JavaScript manager that reads the project's `GIS_Site` datapoints and
brings the map to life — the page is unchanged and does not know it is there.

What makes it worth having over a random-value generator: it simulates **the network**. Each
asset gets a *family* from its kind **crossed with the kind of its links** (a `station` wired
with `power` connections is a power plant, the same `station` wired with `pipe` connections is
a pumping station), and each tick allocates the consumers' demand over the site's own
topology. So:

- take a plant out → the cities it fed are picked up by the plants that remain, and every
  remaining line's flux rises;
- trip a segment → the flow reroutes, or the consumer is visibly short and its `couverture`
  alarms;
- a segment's flux is the sum of what transits it, so it agrees with both of its ends;
- close one tunnel section of a metro line → the **whole line** thins out, delays rise on its
  other sections and on its platforms, and the other line is untouched. Nothing is consumed on
  a metro, so this second coupling comes from the **routes** rather than from the flow.

It creates **one flat datapoint per simulated value** — `GisSim_<assetId>_<element>`,
`GisLink_<connectionId>_<element>` — and the alert configuration on the ones it creates, so
markers and lines actually colour in alarm. It **never writes to a site**: the naming rule is
the contract, and the companion CLI writes those names into an exported site.

```bash
# 1) bind an exported site to the simulator (writes dp + readings, touches nothing else)
node backend/managers/gisSim/bind-site.js my-site.json --out my-site-bound.json
# 2) import the result on /gis, then deploy + start the manager (see INTEGRATION.md)
```

Two ready-to-import sites ship already bound, in `backend/managers/gisSim/examples/`:
**gis-france-nucleaire.json** (19 EDF plants, 8 consumption poles, 19 lines — the flow
allocation) and **gis-dubai-metro.json** (13 underground stations, 13 track sections, 2 lines
— the route service).

Real figures go in an object's **notes**, as directives the page keeps verbatim:
`sim:capacite=5460`, `sim:demande=15000`, `sim:etat=0` (a plant shut down for good),
`sim:volume=` (a reservoir), `sim:famille=` (override the resolution), and
`sim:<element>=` for any element of the family (`sim:affluence=2600` on an interchange
station). Anything unstated is sized from a stable hash of the id and capped by what the
topology can actually bring.

Full detail in [INTEGRATION.md](./INTEGRATION.md#the-network-simulator-optional) and the
design decisions in [NOTES.md](./NOTES.md#the-network-simulator-gissim).

## Contents

```
module.json / install.mjs
frontend/standalone-pages/gis.ts + gis/     (page SOURCE; kit vendored in gis/_vendor/)
frontend/menu.fragment.jsonc                (2 entries: /gis list + /gis/:siteid detail)
manager/gisSim/                             (OPTIONAL network simulator + bind-site.js + examples/)
```

## Documentation

- [INTEGRATION.md](./INTEGRATION.md) — install, wire, verify, and how to author a site.
- [NOTES.md](./NOTES.md) — domain model, the live/alarm contract, and the deliberate limits.
