# Integrate the GIS pages (`@visuelconcept/wui-gis`) — source mode, Tier 1

**Standalone WinCC OA WebUI pages** on **`/gis`** (all sites) and **`/gis/:siteid`** (one
site's map): geo-located assets bound to datapoints, live values on the markers, alarm
highlighting from the datapoints' own alert state, areas grouping the assets, and a
configurable drill-down to each asset's process or 3D view.

**Tier 1**: frontend only — no backend route of its own, no manager. One npm dependency
(`maplibre-gl`) is installed into the workspace and bundled into the page.

**Self-contained source** distribution: the shared kit (`wui-kit`) is **vendored** under
`_vendor/`, and the page is **compiled against the target's runtime workspace** (bundle =
correct version).

## Prerequisites

1. A **WebUI Runtime workspace** (`@wincc-oa/webui-runtime`) — the `--workspace`.
2. **WebGL** in the client browser. MapLibre renders on the GPU; without a usable
   context the page reports it rather than showing an empty frame.
3. For an **off-origin basemap** (the public OpenStreetMap tiles included):
   **"Allow external resources"** enabled in the WinCC OA WebUI settings. Otherwise the
   shell injects `default-src 'self' …` and the browser refuses the tile requests. A
   **same-origin** tile server needs no such setting. See
   [NOTES.md](./NOTES.md#content-security-policy).
4. To **persist** sites: **`@visuelconcept/wui-para`** installed in the project, because
   the page creates the `GIS_Site` DP type and its datapoints through `/api/para`
   (`OaRxJsApi` can read and write values but not create types or datapoints). Without
   it the page runs on in-memory demo sites and shows a non-blocking notice saying so.
5. In the project: the **process datapoints** the assets will bind to, and `_alert_hdl`
   on those you want to see highlight in alarm.

## Install (one command)

```bash
node install.mjs --workspace <runtime-workspace> --project <project-root>
```

Example (WebDemo2):

```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```

The installer:

1. copies the **source** (kit vendored under `_vendor/`) → `<workspace>/…/standalone-pages/`;
2. inserts the **two menu entries** → the workspace's `menuconfig.jsonc` (idempotent by `routeId`);
3. `npm install`s **`maplibre-gl@^5.24.0`** in the workspace (so `build:pages` can bundle it);
4. merges the module's **role catalog** into `app-security-manifest.json` (idempotent by module id);
5. runs **`build:pages`** (`OUT_DIR=<project>/data/dashboard-wc`).

## After install

1. **Browser**: reload logged in (**F5**). The build bumps `index.html`, so the service
   worker purges its caches by itself; a second reload may be needed for the purge to show.

## Verify

1. Logged in → the **GIS (map)** menu entry opens `/gis`.
2. On a project with no `GIS_Site` datapoint you get the notice *"Demo sites: no GIS_Site
   datapoint found…"* and a **Load the demo sites** button. Loading it writes two real
   sites (a water network and a smart-city district) and the notice goes away — that is
   the end-to-end proof that persistence works.
3. Open a site → the basemap draws, markers sit on it, area polygons are filled.
4. Click a marker → the inspector opens with the asset's live values.
5. Click an **area** (its polygon, or pick it in the Area filter) → the right-hand panel
   lists its assets as cards, each showing that asset's live values, with an alarm-coloured
   edge when it is in alarm. Clicking a card opens that asset.
6. Hover an area's polygon → a tooltip names it, and names **every** zone under the cursor
   where two overlap. The name is not drawn permanently on the map.
7. Zoom out → the assets collapse per **area**, then for the **whole site**. A badge appears
   **only where there is an alarm**, carrying that count in red and ringed in the area's
   colour; a zone with nothing wrong shows just its polygon. So a quiet plant zoomed out is a
   quiet map, and anything you can see is something to go and look at. The member count is in
   the badge's tooltip, and clicking it zooms to exactly its members. *Group when zoomed out*
   turns the behaviour off, and the collapse zoom is configurable per area (area panel) and
   per site (site settings) — 0 = automatic.
8. **No basemap but markers present** ⇒ the tiles are the problem, not the data, and the
   page says which one:
   - *"blocked by the page's security policy"* → enable **"Allow external resources"** in
     the WinCC OA WebUI settings, or move to a same-origin tile server. This is the usual
     outcome of a fresh install left on the public OSM tiles.
   - *"tiles could not be loaded"* → the tile server itself is unreachable. Check it, or
     switch the site to *No basemap*.

## Authoring a site with the AI assistant

Fastest route, when the assistant is enabled at deploy time and you hold the **`edit`**
role. From `/gis` (creates a site) or from inside a site (fills it):

1. Open the **AI** button, describe the site — *"un réseau d'eau potable autour d'Annecy :
   3 secteurs, une usine de traitement, 2 stations de pompage, 3 réservoirs"*.
2. The assistant answers with a short explanation and a proposal card stating what it
   contains, that the **coordinates are approximate**, and — inside an open site — that
   applying **replaces** its areas and assets.
3. **Create this site** / **Apply to this site** loads the draft. Inside a site you land in
   edit mode: nothing is written until you press **Done**.
4. **Check every marker on the map and drag it into place.** The assistant has no geocoder.
5. Bind the datapoints in the inspector — the assistant never binds any, on purpose. It
   does propose the readings (label, unit, decimals), which is most of the typing.

Its prerequisites and limits are in [NOTES.md](./NOTES.md#the-ai-assistant).

## Authoring a site by hand

Needs the Application-Security **`edit`** role (see below).

1. `/gis` → **New site**. Give it a name, a category (free text — it groups the
   overview), the map centre and zoom, and **choose the basemap** (see the table in
   [README.md](./README.md#basemaps)).
2. Open the site → **Edit**.
3. **Draw an area**: click each corner, then **Close the area** (3 points minimum).
   Rename it and give it a colour in the panel that opens.
   - **Reshape it later**: select the area → **Edit the outline**. Corner handles appear on
     every vertex and hollow midpoint handles between them. **Drag** a corner to move it,
     **click** a corner to remove it (a triangle is the floor and its corners are locked),
     **click** a hollow midpoint to insert a corner there. **Finish the outline** closes the
     editor; as always, nothing is written until **Done**.
   - An area with **no outline** (hand-made, or proposed by the assistant without a usable
     ring) shows **Draw the outline** instead, which draws one for that area rather than
     creating a new one.
   - **Fit it around its assets**: once the area has assets, **Fit around the assets**
     redraws the outline to hug them. The outline is **concave** — it follows the shape the
     equipment actually makes, so a C-shaped or L-shaped run keeps its bay instead of being
     wrapped in one big polygon — with rounded corners and a margin scaled to the group
     (8 % of its extent), so no marker ends up sitting on the boundary. A single asset gives
     a disc, a straight run of valves a capsule. Quicker and tidier than dragging corners
     after the equipment has moved, or after the assistant has proposed assets into an area
     drawn too wide.
4. **Place an asset**: click **Place an asset**, then click the map. An asset dropped
   inside an area is assigned to it automatically — to **every** area whose outline covers
   that point, where they overlap.
   - An asset can belong to **several areas**: in the inspector, **Areas** is a
     multiple-choice list. Useful where equipment is genuinely shared — a booster pump on a
     sector boundary, a cabinet feeding two districts. Every area it belongs to lists it in
     its panel and counts it in its badge.
   - The **first** area in the list is its *primary* one, and the inspector names it. It is
     the area whose badge absorbs the marker when the map zooms out — a marker is drawn
     once, so only one badge may claim it.
5. In the inspector: set its **name** and **kind** (the kind picks the map glyph), then
   bind its **primary datapoint** — the one whose alarm state colours the marker and
   which the Alarms drill-down is scoped to.
6. Add **live values**: one row per datapoint element, with a caption, a unit and the
   decimals. Tick **On the map** for the one or two that belong on the marker itself;
   the rest stay in the inspector.
7. Set the **drill-down**: pick a target view and fill in the id — e.g.
   `/fleet-3d/pompage-nord` for a 3D atelier, `/ampere/tgbt-usine` for a single-line
   diagram, `/mosaic/<board>` for a display wall. Any in-app route starting with `/`
   works; the presets are only shortcuts.
8. **Done** writes the site to its datapoint, once, with one audit-trail record.
   Nothing is written while you drag markers or type — see
   [NOTES.md](./NOTES.md#when-a-site-is-written).

Positions can also be typed as latitude/longitude in the inspector, which is usually how
surveyed coordinates arrive.

## Import / export

On **`/gis`**: **Export all** writes every site as one native JSON file; **Import** accepts
either format. On a site: **Export (JSON)**, **Export (GeoJSON)**, and **Import**.

| Format | Round-trips | Use it to |
| --- | --- | --- |
| Native **JSON** | everything — bindings, readings, drill-down, basemap, grouping thresholds | move a configuration between projects, back one up, review it in a diff |
| **GeoJSON** | geometry + the same fields as feature properties | open a site in QGIS/ArcGIS, and **bring surveyed coordinates back in** |

Importing **native JSON creates** sites. Importing **GeoJSON fills the open site** (edit mode,
review on the map, then **Done**) or creates one when none is open. A **foreign** layer works
too: with no `gisType` property the geometry decides — polygons become areas, points become
assets, other geometries are ignored.

Everything imported is sanitised exactly like an AI proposal, so a malformed or hostile file
cannot reach a datapoint — see [NOTES.md](./NOTES.md#import--export).

> The practical workflow for real coordinates: draft the site with the assistant, export
> GeoJSON, correct the positions in QGIS against the survey, import it back.

## Application Security

Module id **`gis`**, two roles (both **open until a group is assigned** to them, the
convention of this dashboard):

| Role | Grants |
| --- | --- |
| `view` | Open the pages. Without it the page shows a "not allowed" notice. |
| `edit` | Create sites, place and move assets, draw areas, bind datapoints, set drill-down targets, delete. |

Revoking `edit` while someone is editing closes their edit session immediately.

## Datapoints

| What | Name |
| --- | --- |
| One datapoint per site | `GIS_<slug>` of auto-created type **`GIS_Site`** (Struct: `name`, `json`) |
| Audit trail | `AuditTrail_Gis` of type `_AuditTrail` — one record per site create / update / delete |

The site's assets, areas, bindings and basemap all live in the `json` element. The assets'
**own** process datapoints are referenced by name and never modified by this page.

## Embedding

The map alone, chromeless, embeds in a **Mosaic** board (or any same-origin iframe) with
the `embed=1` flag **inside the hash**, after the route:

```
…/index.html#/gis/reseau-eau?embed=1
```

It renders read-only: the map, its markers and its areas, with no header, toolbar or
inspector.
