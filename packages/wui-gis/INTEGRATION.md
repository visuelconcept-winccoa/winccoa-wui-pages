# Integrate the GIS pages (`@visuelconcept/wui-gis`) — source mode, Tier 1

**Standalone WinCC OA WebUI pages** on **`/gis`** (all sites) and **`/gis/:siteid`** (one
site's map): geo-located assets bound to datapoints, live values on the markers, alarm
highlighting from the datapoints' own alert state, areas grouping the assets, and a
configurable drill-down to each asset's process or 3D view.

**Tier 1**: frontend only — no backend route of its own, and no manager the page needs. One
npm dependency (`maplibre-gl`) is installed into the workspace and bundled into the page. An
**optional** simulator manager ships alongside for demos and commissioning; the page is
unchanged without it — see
[The network simulator](#the-network-simulator-optional).

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
5. copies the **optional** `gisSim` manager → `<project>/javascript/gisSim/` (with
   `--register-pmon`, adds its line to `config/progs`) — it stays stopped until you start it;
6. runs **`build:pages`** (`OUT_DIR=<project>/data/dashboard-wc`).

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
8. Hover a **line** → the tooltip names it (its route, then the segment) and shows what it
   reads. Click it → the connection panel opens. A line whose datapoint is in alarm is drawn
   in the alert colour, at every zoom.
9. Open **Layers** (the toolbar icon) → the browser lists the site's tags with how many
   objects carry each. The eye hides one, the funnel isolates one, and the map follows
   immediately. Nothing is written: visibility is per session, so a viewer can use it too.
10. Select an asset → the top of its panel shows chips for its **zones, layers and lines**.
    Clicking a zone chip goes to that zone; clicking a line chip opens its segment here.
11. **No basemap but markers present** ⇒ the tiles are the problem, not the data, and the
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
5. **Draw a line**: click **Tracer une ligne** (needs at least two assets), pick which line
   the segments join in the dropdown beside it — an existing one, *Standalone*, or
   **New line…** which creates one there and then — and click the assets **one after
   another**. Each click after the first closes a segment and opens the next, so a 20-stop
   line is one continuous gesture. A click on the map *between* two assets adds a shaping
   point, so a track follows its real alignment instead of a straight chord. *Cancel* stops.
   - The ends are assets, so dragging a marker later drags its lines with it. To change an
     end, redraw the segment.
   - Select a line to set its **datapoint** (this is what colours it in alarm), its kind,
     its line, its drill-down and its notes — or to **straighten** it, dropping the shaping
     points.
   - Deleting an asset deletes the connections that reached it.
6. **Tag with layers**: in the asset panel, the **Layers** field is a tag list — pick
   existing tags, or **type a new name to create the layer** on the spot. Manage them (name,
   colour, delete) in the layer browser.
7. In the inspector: set its **name** and **kind** (the kind picks the map glyph), then
   bind its **primary datapoint** — the one whose alarm state colours the marker and
   which the Alarms drill-down is scoped to.
8. Add **live values**: one row per datapoint element, with a caption, a unit and the
   decimals. Tick **On the map** for the one or two that belong on the marker itself;
   the rest stay in the inspector.
9. Set the **drill-down**: pick a target view and fill in the id — e.g.
   `/fleet-3d/pompage-nord` for a 3D atelier, `/ampere/tgbt-usine` for a single-line
   diagram, `/mosaic/<board>` for a display wall. Any in-app route starting with `/`
   works; the presets are only shortcuts.
10. **Done** writes the site to its datapoint, once, with one audit-trail record.
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

## The network simulator (optional)

`gisSim` is a WinCC OA **JavaScript manager** shipped beside the page, for demos, training
and commissioning a site before its real datapoints exist. The page is **unchanged** by it
and stays Tier 1 — nothing below is needed to run `/gis`.

It reads the project's `GIS_Site` datapoints, gives every asset and every connection a
**family** (its kind crossed with the kind of its links), creates **one flat datapoint per
simulated value** and drives them by solving the flows over the site's own topology. What it
buys you on the map: take a plant out and the others pick up its cities, trip a segment and
the flow reroutes or the consumer goes visibly short.

### Install

The installer deploys it with the page:

```bash
node install.mjs --workspace <runtime-workspace> --project <project-root> --register-pmon
```

`--register-pmon` appends its line to `<project>/config/progs` as `always` (it comes back up
with the project). Without the flag, register it yourself in the WinCC OA console — and use
`manual` if you would rather start the simulator by hand:

```
node | manual | 30 | 2 | 2 |gisSim/index.js
```

Either way, **start `gisSim`** in the console after the deployment: a manager that is already
running keeps the code it loaded at startup. From this repository the same deployment is
`node tools/scripts/deploy-backend.mjs --project <project> --only gis`.

> Start it on a **demo or engineering project**. It creates datapoints and alarm
> configurations; that is its job, and not something to run on a production system by
> accident.

### Bind a site to it

The manager **never writes to a site** — a binding is the page's business. The naming rule is
the contract (`GisSim_<assetId>_<element>`, `GisLink_<connectionId>_<element>`) and the
companion CLI writes exactly those names into an exported site:

```bash
node manager/gisSim/bind-site.js my-site.json --out my-site-bound.json
#   --force    rebind objects that already carry bindings (default: only fill what is empty)
#   --system   system prefix of the bindings, `--system ''` for none (default System1:)
```

Export from `/gis` (**Export all** or **Export (JSON)**), run the command, import the result
back. Positions, zones, layers, routes and notes come out exactly as they went in.

`manager/gisSim/examples/gis-france-nucleaire.json` is a ready-to-import site — 19 EDF
plants, 8 consumption poles, 19 lines — already bound: import it, start the manager, and the
map is live.

### Say what an object really is

Simulation facts live in an object's **notes**, where the page keeps them verbatim and shows
them in the inspector:

| Directive | On | Effect |
| --- | --- | --- |
| `sim:capacite=5460` | source / transit / segment | Capacity, in the family's own unit (MW, m³/h, trains/h…) |
| `sim:demande=15000` | consumer | Peak demand, before the daily curve |
| `sim:volume=2500` | storage | Usable volume the level is integrated over |
| `sim:etat=0` | anything | Forces the state for good (0 arrêt, 1 marche, 2 défaut, 3 maintenance) |
| `sim:famille=pompage` | anything | Overrides the family resolved from the kind and the links |
| `sim:<element>=2600` | anything | Baseline of **that element** — `sim:affluence=2600` on a station, `sim:trafic=18` on a track section, `sim:temperature=38` on a tunnel |

Examples: `Puissance installée nette 5460 MW (6 × 910). sim:capacite=5460`, or
`Station de correspondance. sim:affluence=2600`. Anything unstated is sized from a stable
hash of the object's id and capped by what the topology can actually bring to it — so two
stations of the same family would otherwise differ only by their wander, and a busy
interchange would read like a quiet terminus. A `sim:` key that names neither a reserved word
nor an element of the object's family is **reported in the log**, never silently ignored.

### Two ready-made sites

Both are already bound: import one on `/gis`, start the manager, and the map is live.

| File | What it exercises |
| --- | --- |
| `examples/gis-france-nucleaire.json` | 19 EDF plants, 8 consumption poles, 19 lines — the **flow allocation**: take a plant out and the others pick up its cities |
| `examples/gis-dubai-metro.json` | 13 underground stations, 13 track sections, 2 lines — the **route service**: close one tunnel section and the whole line thins out, delays rise on its sections and on its platforms, while the other line is untouched |

### Verify

1. The manager's log opens with the model it built — `27 asset(s) et 19 liaison(s)
   simulé(s) : 19×production-electrique, 8×consommation-electrique…` — then how many
   datapoints and alarm configurations it created.
2. In PARA, `GisSim_*` and `GisLink_*` datapoints exist and their values move.
3. On the map, the readings update, and a marker or a line turns to the alarm colour when its
   `defaut` is raised (~30 s state ticks).
4. The log names anything that did not work rather than failing: bindings pointing at a
   datapoint it does not drive (a typo, or a site bound with a different rule), ids claimed by
   two sites, alarm configurations the project refused.

### Know before you rely on it

- **Asset and connection ids are unique within a site, not across sites.** Two sites both
  holding an asset `paris` would claim the same datapoints; the second is skipped and named
  in the log.
- **Alarm configurations are written only on the datapoints it has just created**, so a
  threshold retuned in PARA is never overwritten.
- **It never touches your process datapoints** — only its own.
- Levels and totalisers restart with the manager; the site configuration is re-read every
  minute, so an asset added on the map is simulated without a restart.

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
