# wui-gis — business & architecture notes

WinCC OA WebUI page module, **Tier 1** (frontend only: no backend route, no manager).
Routes `/gis` and `/gis/:siteid`, component `wui-gis`.

## Domain / purpose

A **site** is one geographic supervision scope. It holds:

- **assets** — geo-located things bound to project datapoints (a pump, a reservoir, a
  traffic light, a lighting cabinet);
- **areas** — polygons that group them (a distribution sector, a district, a catchment).
  An asset can belong to **several**: a booster pump on a sector boundary is in both, a
  shared cabinet feeds two districts, and each of them lists and counts it.
- **connections** — supervised links between two assets (a metro segment, a feeder, a main,
  a road), grouped into named **routes** (« Ligne 1 »);
- **layers** — free information tags on assets and connections, switched on and off in the
  layer browser;
- a **basemap** — where the background map comes from, per site.

Two flagship experiences ship as the demo seed, because they are the two shapes the map
has to serve: a **drinking-water network** (abstraction → treatment → pumping → storage →
three distribution sectors) and a **smart-city district** (traffic lights, air quality,
tunnel ventilation, lighting cabinets, EV chargers).

### One asset, several areas

`Asset.areaIds` is an ordered list. Two rules keep that from being ambiguous:

- **Membership is a set** for everything that lists or counts: the area panel, the area
  filter, the roll-up counts. `inArea(asset, id)` and `assetsOfArea(site, id)`.
- **Drawing needs an owner.** A marker is drawn once, so exactly one area may swallow it
  when areas collapse: `areaIds[0]`, the *primary* area (`primaryArea(asset)`). Order is
  therefore meaningful and the inspector says which one is primary when there are several.
  Without this the same asset would be counted into two badges and the conservation
  invariant — no asset lost or duplicated — would break.

A datapoint written before this existed holds a single `areaId`. The store folds it into
the list on read, and the sanitiser accepts both shapes: a file exported by the old version,
and a language model that has seen far more of the old shape than the new one.

## Coordinates

WGS 84 **degrees**, everywhere, unprojected — the coordinate space MapLibre and OSM
already speak, so nothing is projected on the way in or out. Area rings are stored as
`[lon, lat]` pairs (GeoJSON axis order) so they pass straight to MapLibre; single points
are `{ lat, lon }` objects, where naming beats remembering an order.

## What is live and what is stored

**Only the binding is stored.** Values, and the alarm colour, are resolved at runtime and
never persisted (`gis/data/live.ts`).

Two rules shape that file, and both were chosen against a specific failure:

**One `dpConnect` per datapoint element.** `dpConnect` fails the *whole* subscription as
soon as any name in its array is invalid (see the `oa-rx-js-api` README), and a map is
exactly where unresolvable names collect: a site gets authored before its datapoints
exist, a demo binds to `ExampleDP_*` that a production project lacks, an operator
mistypes one binding out of eighty. Batched, one bad name would freeze every value on the
map. Isolated, a bad binding is the only thing that stays blank.

**The alarm state comes from WinCC OA, not from a threshold in this page.** The marker
colour is the datapoint's own `_alert_hdl.._act_state_color`. So the map agrees with the
Alarms page and with every other client *by construction* — there is no second definition
of "in alarm" to drift. A datapoint with no alert config errors on that one subscription
and stays un-highlighted, which is the correct outcome rather than a failure.

The alert config lives on the **datapoint**, so a binding to an element
(`Pump01.flow`) is widened to its datapoint (`Pump01`) before its alert state is followed
— otherwise an alarm raised on `Pump01` would be missed. The same widening scopes the
Alarms drill-down.

### A quiet datapoint is not an absent one

The snapshot has **three** states per binding, not two: no entry at all (the datapoint could
not be followed — it does not exist, or there is no alert config), `''` (it resolved and has
**no active alert**), and a colour (in alarm). Every consumer must treat the first two the
same, and `??` does not: it only replaces the absent one.

That cost the network its whole rendering once the bindings pointed at datapoints that exist.
`alarm ?? routeColour` kept the empty string, `line-color: ''` is not a colour, and MapLibre
drew **no line at all** — while the markers, which test the same value for truthiness, were
perfectly fine. The mirror image of the same slip made `alarmColors.get(dp) !== undefined`
report every quiet asset as being in alarm, so each zone badge showed a red count of all its
members. Both are now one named function each, `inAlarm` and `alarmColorOr` in
`map/style.ts`, tested in `map/alarm-color.spec.ts` — the trap is invisible until a site is
bound to real datapoints, which is exactly when a demo becomes a deployment.

Emissions are **coalesced to one notification per animation frame**. A site can bind two
hundred elements, and a plant that has just been switched on emits an initial value for
every one of them within milliseconds; notifying per emission would repaint the whole map
two hundred times.

### What the overview subscribes to

The overview's **In alarm** column is live, so it follows the alarm state of *every* site
— but only the alarm state, not every reading of every site. A site's map follows both.
That asymmetry is the `sync({ values, alarms })` signature.

## The drill-down

map → area → asset → the view that explains it.

- **area** — selecting one zooms the map to its ring, narrows the asset list to it, and
  fills the right-hand panel with **one card per asset, each showing what that asset
  currently reads**. That is the point of stopping at this level: the map answers *where*
  the equipment is, the panel answers *what it says* — without clicking every marker in
  turn. A card whose asset is in alarm takes the alert colour on its left edge, and clicking
  a card opens that asset (the map pans to it, since the panel is about to be replaced by
  the inspector).
- **asset** — selecting one opens the inspector; double-clicking goes straight to its
  target view.

The target is **configuration, not code**: each asset and area carries a free `link`
route. There is no single "process view" page in this dashboard — a plant's process is
shown by whichever page models it (an Ampère single-line diagram, a Machine Fleet 3D
atelier, a Mosaic board, a widget dashboard), and `/process-monitor` is the *pmon manager
console*, not a process synoptic. Hard-coding one target would have been wrong, so the
editor offers presets (`gis/drill.ts`) that merely seed a route the user can then edit.

The **Alarms** drill-down is the exception: it needs no configuration, because any asset
with a primary datapoint can open `/alarms?dp=<dp>` — the Alarms page reads a `dp` query
parameter.


## The network: connections, routes, layers

Three concepts were added on top of zones, and the distinction between them is the whole
design:

| Concept | What it is | Has geometry? |
| --- | --- | --- |
| **Area** | *geography* — a polygon, with assets inside it, used for grouping and roll-ups | a ring |
| **Connection** | *topology* — a supervised link between two assets | derived from its ends |
| **Route** | a *name* for a set of connections (« Ligne 1 ») | none |
| **Layer** | *classification* — a free tag ("critical", "phase 2") | none |

### A connection is an asset in everything but position

It carries a primary datapoint whose alert state **paints the line**, live readings, a
drill-down route, zone membership, layer tags, notes. A line on this map is a supervised
object, not decoration — a feeder has a current, a track section has a status. Without that,
the network would have to be drawn twice: once as geometry, once as invisible assets on top.

It is **not** the same *type* as an asset, though, and that was deliberate. `Asset` is a
point, and the module leans on it hard: `cluster.ts` grids assets in Web-Mercator world
pixels, `enclose.ts` hulls their coordinates, assets render as HTML markers while polylines
must be GL layers, and the sanitiser drops any asset without a usable `lat`/`lon`. Putting
paths into `Site.assets` would have turned every one of those into a branch, and the tested
"no asset lost or duplicated" invariant into a statement with exceptions.

### Its ends are references, not coordinates

`from` and `to` name assets, so **dragging a substation drags every line attached to it** —
for free, with nothing recomputed. Storing endpoint coordinates instead desynchronises the
network on the first edit, which is how this kind of feature ends up switched off. `via`
only *shapes* the line between those two ends.

The consequences are enforced rather than hoped for: a connection whose end no longer
resolves is **dropped** by the sanitiser and counted in the report (an invisible line is
worse than none), deleting an asset takes its connections with it in the page, and a
connection from an asset to itself has no geometry and goes the same way.

### A metro line is not one object

The tempting model is `Route { stops: string[] }` with segments implied between consecutive
stops. **It breaks the first time a station is inserted**: every segment after it shifts by
one, and so does every datapoint binding attached by index — a silent mis-binding, the worst
kind of defect. So segments are explicit objects with stable ids, which is also physically
right: a fault occurs *between* two stations, not on "line 1".

A route therefore **does not list its stops**. The order is derived by walking the
`from`/`to` chain (`routeOrder`), and a branching line — the demo’s `Refoulement`, one plant
feeding three reservoirs — returns `null` rather than an invented sequence. Storing an order
beside the segments would be two versions of the same truth.

### Layers are not zones

A zone is geography; a layer is classification, with no shape and no containment rule.
Forcing one concept to do both jobs is how you end up with zones that overlap for reasons
that have nothing to do with the map.

**Visibility is not stored.** Which layers an operator is looking at is a property of the
operator, not of the site, so it lives in the page for the session — which is also why a
viewer without the `edit` grant can use the browser freely. A stored default would be a
second kind of truth about visibility, and the first question would be whose default it is.

The visibility rule is the one users feel: **an untagged object is never hidden**, and a
tagged one survives while *at least one* of its tags is still on. Hiding everything untagged
the moment one layer is switched off would make the browser unusable.

### Rendering

Three GL layers per connection, in order: an invisible fat **hit line** (clicking a 3.5 px
track is otherwise hopeless — MapLibre hit-tests the rendered geometry), a dark **casing**
that keeps a coloured route legible over a busy raster basemap, then the line itself, dashed
by kind. They sit below the area outlines, and markers are HTML so they are above
everything by construction. No glyphs are involved, so the whole network still draws on an
offline basemap.

Connections are **not** clustered: lines are GL geometry, they do not collide like discs, so
they stay drawn at every zoom — which is how transit maps work anyway, and it means a
faulted feeder is visible even when its zone has collapsed to a badge.

## Rendering

### Assets are HTML markers, areas are GL layers

A marker is ordinary DOM inside the component's shadow root, so it is styled by the same
stylesheet and the same `--theme-*` tokens as the rest of the page, it can host an
`ix-icon`, and its live value updates by re-rendering a Lit template.

The alternative — a GL symbol layer — would need a **`glyphs` font endpoint** for its
text and an SDF sprite per asset kind. The glyphs endpoint is the disqualifier: it would
make every label on the map depend on reaching a font server, which the offline basemap
must not. For the same reason the **area name tooltip is an HTML marker** too: the GL layers
here are only `background`, `raster`, `fill` and `line`, none of which need glyphs.

The trade is scale — see [Limits](#limits).

### Decluttering when zoomed out

Marker discs collide into an unreadable pile as soon as the map is zoomed out, so
**grouping is on by default** (`gis/map/cluster.ts`), as a three-rung hierarchy. Clicking
any badge zooms to exactly its members, which splits it into the next rung down — the
conventional progressive drill-in. The toolbar toggle (*Group when zoomed out*) turns the
whole thing off to draw every asset individually.

| Rung | What is drawn | Trigger |
| --- | --- | --- |
| **asset** | every asset individually; a flat 80 px grid still collapses neighbours that would overlap | zoomed in |
| **area** | one badge per area **that has an alarm**, stating how many — ringed in the area's colour, so it says which zone. An area with no alarm draws nothing but its polygon. Areas are independent: a small district collapses while a large one beside it does not | the area is too small on screen for its assets |
| **site** | one badge for the whole site, stating the site-wide alarm count — and no badge at all when the site is quiet | the site is too small for its area badges to sit side by side |

On the two demo sites that lands as: water — site at z6–9, areas at z10–11, assets from z12;
smart city — site to z10, areas z11–14, all individual from z15.

#### An area is grouped whole, or not at all

**Invariant: at any zoom, every asset of an area is either in that area's badge, or drawn
individually. Never a mixture.** Getting this wrong is what made grouping look broken — the
map showed a few loose markers *plus an anonymous grey badge holding the rest of the same
area*, so an area appeared half-grouped. Three things caused it, all now fixed:

- **The area was judged by its ring, not by its assets.** The question is whether the
  *markers* can still be told apart, which has nothing to do with how big the polygon drawn
  around them is. A wide sector holding tightly packed equipment stayed "expanded" while its
  assets already overlapped, so they fell through to the flat grid.
- **The extent was measured with `fitBounds` padding.** `boundsOf` pads by ~200 m by default,
  because its other caller wants slack so an edge marker is not clipped. For a
  district-sized area that padding is a large fraction of its width, and it delayed the
  collapse by a whole zoom level.
- **Nothing forbade the mixture.** In automatic mode an area now also collapses whenever the
  flat grid *would* merge any two of its assets — so the alternative to one named, coloured
  area badge is always "all of them individual", never an anonymous sub-group. An explicit
  `groupZoom` is still taken literally: there the user has said where the line is.

The badge is anchored on **the assets it stands for**, not on the ring centroid, so a badge
whose members are bunched in one corner of a large sector is drawn where they actually are —
and clicking it zooms to the same place it was pointing at.

Assets belonging to **no** area are never area-grouped (there is nothing to group them by);
they stay on the flat grid, which is also the entire behaviour of a site with no areas.

#### The thresholds, and why one is derived from the other

Both rungs are configurable — `groupZoom` on the area and on the site — where **0 means
automatic**, which is what almost every site should use, because the zoom at which a
district becomes a dot depends on how big that district is.

- **Area, automatic:** collapse when its extent falls under `assets × 44 px` (floored at
  120 px) — it scales with how many discs have to fit inside it, so it is right for a dense
  district and a two-asset sector alike.
- **Site, automatic:** **derived from the area thresholds** — 1.5 zoom levels below the
  point where the last area has collapsed, bounded by the zoom at which the area badges
  themselves would overlap.

That derivation is not decoration. Choosing the two thresholds independently *does not
work*: with three areas tiling a site each area spans about 0.6 of the site, so any fixed
pair of pixel thresholds puts both collapses inside the same integer zoom step and **the
area rung is never actually seen**. That is exactly what the first implementation did, and
what the hierarchy tests caught. Deriving one from the other guarantees a band at least one
whole zoom level wide where areas are grouped and the site is not.

#### What a badge says: the alarm count, or nothing at all

**A badge is a fault synthesis and nothing else. It draws the number of its members in
alarm — and a group with no alarm has no badge.** Zoomed out the map is therefore *zones plus
trouble*: the area polygons say where the equipment is, and a bubble appears only where
something is wrong. A bubble with nothing to synthesise was still an object the eye had to
check and discard, which is the opposite of what a synthesis is for.

The drop happens **in the view**, not by removing quiet groups from the grouping. The model
still accounts for every asset, so *"no asset lost or duplicated"* remains a testable
statement about `cluster.ts`; what is drawn is a separate, deliberately narrower question.
One consequence to know: at the flat-grid rung, quiet assets whose discs would overlap are
folded into a group that is then not drawn, so they are absent from the map until you zoom in
far enough for them to stand apart — there is no polygon standing in for a grid cell the way
there is for an area.

That replaced a badge carrying its member count, and the reasoning is worth keeping. Zoomed
out, nobody is asking how many things are inside a bubble: the number changes with every pan,
and there is no action attached to it. A map whose every badge carries a large neutral figure
is a map the eye has to filter before it can find the one badge that matters. The member
count is still one hover away, in the badge's tooltip, next to the alarm figure.

For that number to exist, **an alarmed asset is grouped like any other**. Earlier it escaped
every badge below the site rung, on the principle that an alarm must never be hidden. The
principle stands; the mechanism changed. An alarm folded into a badge is not hidden — the
badge is alarm-coloured, states how many it swallowed, and zooms to exactly those assets when
clicked. And keeping alarms out had a real cost of its own: a plant in trouble, viewed from
far out, became a field of loose indistinguishable discs — the very pile grouping exists to
prevent. Information gets more synthetic the further out you go, ending at one dot reading
"3" on an otherwise quiet map.

#### Labels

An asset's name plate is drawn only for a disc that is **visually on its own**: the nearest
other asset must be at least 40 world pixels away (the 28 px disc plus its border and alarm
halo). That is a real distance, grid-accelerated through the cluster cells — a grid *answer*
was the first attempt and it labelled two discs 37 px apart that happened to straddle a cell
boundary. The rule applies with grouping off too, so turning grouping off does not produce
label soup.

An **area** is not labelled on the map at all: its name appears in a **tooltip that follows
the cursor** while the pointer is over its outline. A dozen zones carrying a dozen permanent
plates — each competing with the asset name plates for the same pixels — is unreadable, and
the polygon and its colour already say where a zone is. A name is what you ask about one zone
at a time, which is the shape of a hover. Every area under the pointer is named, not only the
topmost: zones may overlap now that an asset can belong to several, and naming just one would
hide exactly the ambiguity worth resolving.

#### Stability

The grid is anchored in Web Mercator **world** pixels, not screen space. A screen-space grid
re-buckets every asset the moment the map is panned, so badges would jump and their counts
flicker under the cursor. World-pixel cells are fixed to the projection: only a zoom change
re-groups anything. Grouping is recomputed on `zoomend`, not per frame — MapLibre keeps
repositioning the existing markers throughout a pinch, so only the grouping is briefly
stale.

#### What was verified

46 checks over the demo sites across zooms 4–22: nothing lost or duplicated at any zoom or
rung; the three rungs all reachable and strictly ordered;
rung; an alarmed asset grouped like any other, with the badge that swallowed it reporting
exactly one alarm and its neighbours reporting none; per-area and per-site overrides honoured; a site with no areas still decluttering; grouping independent
of pan and of input order; the label rule holding as an exact biconditional; and the poles
yielding a valid cell.

### Why maplibre-gl is pinned to 5.x

A page ships as **one self-contained ESM chunk**, dynamically imported from
`/data/dashboard-wc/pages/gis.js`. MapLibre 5.x inlines its tile worker as a `blob:` URL,
so there is no extra URL to resolve against a base path and nothing new for the service
worker to cache. 6.x emits the worker as a separate real URL and additionally drops
WebGL1 support; neither buys this page anything.

`maplibre-gl` 5.x also publishes **one UMD bundle** while declaring `"type": "module"`.
The **default import** is what survives both the dev server (esbuild interop) and
`build:pages` (Rollup's commonjs transform, enabled by `transformMixedEsModules`); named
value imports are not reliable across both. That is why `gis/map/maplibre.ts` is the
single place the library is imported.

The shell's Content-Security-Policy (see [Content-Security-Policy](#content-security-policy))
**allows `blob:`**, so 5.x's inline worker runs under it unchanged. Should a deployment
ever forbid `blob:` workers, `maplibre-gl/dist/maplibre-gl-csp.js` is the drop-in
replacement — change the import in that one file.

## Content-Security-Policy

**This is the single most likely reason a fresh install shows no basemap.**

The WebUI shell reads `allowExternalResources` from `GET /WebUI_Settings`. When it is
**off** — the default — `WuiCspService` injects

```
default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:
```

as a `<meta http-equiv="Content-Security-Policy">`. MapLibre fetches tiles with the
**Fetch API**, and `connect-src` falls back to `default-src`, so **every off-origin
basemap is refused** — including the public OpenStreetMap tiles a new site defaults to.
The browser reports `Refused to connect because it violates the document's Content
Security Policy`.

Three ways out, in the order they should be considered:

1. **Enable "Allow external resources"** in the WinCC OA WebUI settings. Note the shell
   *also* forces the flag back off if the webserver itself sends a restrictive CSP header
   — `isCspRestrictive` treats a `script-src`/`default-src` without `*`, `https:` or
   `http:` as restrictive — so a server-side header has to be relaxed too.
2. **Serve tiles from the same origin** — a raster basemap whose URL is a relative or
   same-origin path is allowed by `'self'` with no setting change. This is the better
   answer for a plant that should not reach the internet anyway.
3. **Switch the site to *No basemap*** — assets and areas keep working.

MapLibre only reports "the request failed", which would send an operator hunting a tile
server that is perfectly healthy. So `gis-map.ts` listens for `securitypolicyviolation`,
matches the blocked URI's origin against the site's configured basemap, and raises
`wui:cspblocked` — and the page then names the setting to change instead of showing the
generic tile warning.

### The stylesheet in the Shadow DOM

MapLibre positions its canvas, controls and popups from `dist/maplibre-gl.css`. The map
lives in a shadow root, which document-level CSS cannot reach, and the pages build would
emit a separate `.css` asset that nothing loads. So it is imported with Vite's `?inline`,
which yields the stylesheet as a **string**, and adopted into the component's own
`static styles`. The page therefore stays one chunk with no CSS asset.

## The AI assistant

A **proposal-only** helper for the slow part of this page: authoring a site's areas and
assets from scratch. It reuses the shared plumbing of `@visuelconcept/wui-ai-kit` (the
`askAi` bridge to `/api/ai/chat`, the markdown renderer, the config dialog) and follows
the same contract as the Ampère assistant.

- **Read-only tools.** Every prompt is sent with `mcpMode: 'read-only'`: the assistant gets
  the project's *configured* MCP servers, minus every mutating tool, filtered in the manager
  before the model is told the tool exists. So it can look things up — which datapoints
  exist, a type's structure, a geocoder if one is configured — and still cannot act. The
  guarantee is now "no mutating tool", enforced by what the tool list contains, and it is
  stronger than a prompt rule: a tool that was never declared cannot be called.
- **The tools it used are shown.** Each answer carries its tool calls; the chips expand to
  the request and the head of the result (`mf-ai-tool-trace` in the kit). Without that, a
  grounded answer and a plausible one look identical. The trace is *post hoc*: the bridge is
  one unary vRPC call, so the manager runs the whole agentic loop and answers once — there
  is no channel on which a call could be announced while it runs.
- **Gated twice.** It renders nothing unless the deploy enabled `aiAssistant` in
  `dashboard-features.json`, and nothing unless the user holds the Application-Security
  `edit` role — it exists to author sites, so it is not offered to someone who cannot
  save one.
- **Data in, patch out.** The prompt carries the open site **as JSON** — ids, rings,
  readings and all — and the answer is a *patch* against those ids, not a new document.
  Applying it on the overview *creates* a site; inside an open site it *completes* it and
  drops the user into edit mode, so the usual "Done" is still what writes the datapoint.
- **It never binds datapoints.** The prompt forbids emitting `dp` at all: the model does
  not know the project's datapoints, an invented name would be a dead binding that looks
  live, and an empty one would erase a real binding. It *does* propose readings (label,
  unit, decimals), which is most of the tedium. The context says `"bound": true` instead of
  the name, so it knows what is already wired without being handed the naming.

### Why a patch, and not a whole site

The first version emitted a complete `Site`, so every proposal — even "add two boreholes" —
overwrote the open one. That was not a prompt failure to be argued away: a whole-document
answer was the only sentence the contract allowed, and the context the model receives is
deliberately partial, so it *cannot* rewrite a site faithfully. Telling it "complete, don't
replace" while handing it a document-shaped schema loses to the schema every time.

So the vocabulary is operations (`libs/wui-gis/src/gis/data/site-patch.ts`), and the merge
is code, not prose:

- `upsert` **by id** — a known id merges field by field, an unknown one creates. A patch
  emits only the fields that change, and **everything it omits is preserved**: that is what
  keeps `dp`, `readings` and `notes` alive across an amendment.
- `remove` by id only, never implied by omission.
- `generate` — one parametric op (`line` / `grid` / `ring`, a `count`, a `nameTemplate`)
  stands in for hundreds of assets. This is the only reliable way to create in bulk:
  writing the objects out one by one runs into the model's output budget and the block
  arrives truncated (and an unparsable block is dropped rather than half-applied).
- `mode: "replace"` — the old behaviour, kept for an explicit "start over", and no longer
  warned about in the abstract: the diff *counts* what it destroys.

The merge runs on the raw objects and hands the result to `normalizeSite`, so there is one
sanitiser rather than two that drift. Ids survive that pass because existing objects keep
their position and claim their own slug first — reusing the sanitiser naively would have
suffixed a re-emitted id to `pompe-1-2` and created a duplicate instead of an update.

The guarantee lives in `site-patch.spec.ts` (dp preserved through a partial upsert, no
duplicate on a known id, no removal without `remove`, generate geometry and caps), not in
the wording of the prompt.

### The diff is the review surface

`diffSites` compares the sanitised *result* against the current site, so the apply button
is labelled with what will actually be written — "3 ajout(s) · 1 modification" with the
object names on hover — and a patch that changes nothing says so instead of offering a
button that does nothing. The preview is recomputed at render time and the merge is redone
at click time in `gis.ts`, so an answer left sitting in the conversation while the user kept
editing can never resurrect a stale version of the site.

### Ceilings

64 areas and 10 000 assets per site (`normalize.ts`), 2000 points per `generate` op. The
output budget is configurable per project (`AI_Assistant_Config.maxTokens`, default 32768)
and a budget-capped answer is reported as truncated rather than silently offered. The
agentic loop has its own ceiling (`AI_Assistant_Config.maxToolRounds`, default 12 LLM⇄tool
round-trips): exploring a site through the MCP tools eats rounds quickly, and a prompt that
exhausts them still answers — the last round runs with the tools disabled, so the assistant
concludes from what it collected instead of losing the whole prompt.

**That sanitiser ceiling is a guard against a runaway answer, not a capacity claim.** Three
real limits sit below it, and none of them moved when it was raised from 1000 — in the order
they bite:

| Ceiling | Where | What it costs at 10 000 assets |
| --- | --- | --- |
| One `dpConnect` per datapoint element | `data/live.ts`, deliberately — a batched subscription fails wholesale on one bad name | ~30 000 individual subscriptions for a primary DP plus two readings each |
| One HTML marker per drawn asset | `ui/gis-map.ts` | Grouping holds the count down while zoomed out, but zoomed in — or with grouping off — every asset standing alone is a DOM node MapLibre repositions each frame |
| The site JSON in **one WinCC OA String element** | `data/gis-store.ts` (`DpJsonStore`) | ~250 bytes per asset, so a couple of megabytes in a single DPE |

Moving the real limit means chunking the store, drawing assets as a GL layer instead of
markers, and sharing subscriptions — three separate pieces of work, none of them a constant.
A site in the low thousands is comfortable today; ten thousand on one map is not something
this page has been shown to do.

### Coordinates are the honest weak point

A language model has no geocoder. It knows roughly where a named town is and can lay a
plausible network around a stated centre, but it cannot place a real pumping station to the
metre. The prompt says so, the apply affordance repeats it, and the review-then-apply flow
exists precisely so the engineer drags the markers onto their true positions. Treat a
proposal as a **draft skeleton**, not as survey data.

### Everything a proposal says is sanitised

`gis/data/normalize.ts` coerces an untrusted site into a valid one, because the input is
*plausible* rather than valid. It never throws, and it reports what it dropped so the UI
can say so instead of quietly truncating. In particular:

| Risk | Handling |
| --- | --- |
| `lat`/`lon` as strings, `NaN`, or out of range | Coerced; an asset without a usable position is **dropped** (an invisible marker in the datapoint is worse than none) |
| An unknown `kind` | Falls back to `generic`, which has a glyph |
| `areaId` naming an area that was not proposed | Cleared, so the asset cannot be orphaned out of the area filter |
| A `link` pointing off-site (`https://…`, `//host`) | **Stripped.** A proposal must never be able to point the dashboard at an external URL |
| Duplicate ids | Made unique |
| A ring with fewer than 3 usable points | Cleared; the area survives as a grouping label with no outline |
| An area with neither a name nor a ring | Dropped — it carries no information |
| Thousands of assets | Capped at 250 areas/24 zones and reported as truncated |
| Rambling free text | Capped per field |

The `[lon, lat]` order of a ring versus the named `lat`/`lon` of an asset is the mistake a
model makes most often, so the prompt calls it out explicitly and the sanitiser validates
both forms independently.

## Fitting an outline to its assets

**Fit around the assets** redraws a selected area's outline around the assets it lists
(`gis/enclose.ts`). Three decisions, each taken against a way the outline looked wrong.

**Concave, not the convex hull.** The first version was the convex hull, and on a real
network it reads as *"it joined the last asset back to the first"*: the hull's closing edge is
a long chord across empty ground, and a C-shaped or L-shaped layout has its bay swallowed
whole. A water network follows mains and a district follows streets — both concave. The hull
is therefore **dug inwards** (a *chi-shape*): the longest boundary edge is replaced by two
edges through the nearest asset not yet on the boundary, repeatedly, as long as that keeps
the polygon simple.

Two things about the digging are worth keeping, because both were wrong first:

- **The detour is bounded, not required to shrink.** The textbook rule accepts an insertion
  only when both new edges are shorter than the one they replace. That rule *cannot carve a
  square bay*: reaching the inner corner of an arm always costs one edge longer than the
  chord across the mouth, so the bay stayed filled. What actually bounds the work is the
  pool, not the geometry — every insertion consumes an asset for good, and a refused edge is
  abandoned for good, so it terminates either way.
- **The threshold is measured in asset spacings**, so one default fits a city district and a
  15 km main: an edge spanning several asset-gaps is bridging a hole, whatever the scale.
  The usable band is narrow and was *measured*, not guessed — a clearly C-shaped layout has a
  mouth only about **two** spacings wide, so any factor above 2 leaves the bay filled. That
  is exactly what the first calibration (1.5–12, default ≈ 5.7) did: it never dug anything.
  The band is now 1.2–3 with the default at 1.74.

Aggressive digging is safer than it looks: an insertion can only ever use an asset that is
**not** on the hull, so a sparse layout has nothing to reach for and stays convex regardless.

**The margin is proportional to the group.** 150 m — the first version, fixed — is most of a
pumping station and a rounding error on a 12 km sector. The outline sits at **8 % of the
group's diagonal**, floored at 50 m and capped at 500 m.

**Corners are rounded, so no marker sits on the boundary.** The ring is the *offset* of the
dug polygon: each side pushed out along its outward normal, each convex corner turned into a
short arc, each reflex corner mitred (and, past a mitre four margins long, cut off rather
than allowed to shoot away). One asset therefore becomes a disc and a straight run of valves
a capsule — a polygon with no area, which the earlier version could produce, has no fill to
show.

### Guarantees, and how they are kept

| Guarantee | How |
| --- | --- |
| Every asset the area lists is inside | Digging only moves the boundary onto assets; the offset then moves it outwards. Asserted over the demo sites and 60 pseudo-random layouts |
| The ring never crosses itself | Insertions are rejected when they would cross; the offset is validated and retried at half the margin, then falls back to the convex outline, which is always offsettable |
| The ring is at most 64 points | The sanitiser keeps 64 (`MAX_RING_POINTS`), and a truncated ring is a *different shape*. Corners are capped at 20 and the arc detail is fitted into what is left; corners the margin would hide are dropped first, and a hull still over budget after that — a genuinely round blob of a hundred assets — becomes the enclosing disc |

It uses every asset the area **lists**, shared ones included: the outline should enclose what
the area claims, not only what it happens to own for drawing.

## Editing an area's outline

Select an area in edit mode and **Edit the outline** puts handles on its ring: a solid one
on every corner, a hollow smaller one at every midpoint. Drag a corner to move it, click a
corner to remove it, click a midpoint to insert one.

Three decisions are worth recording:

- **Insert by clicking a midpoint, not by dragging it.** A dragged midpoint would have to
  become a corner halfway through the gesture, which means swapping a MapLibre marker's
  identity mid-drag — a reliable way to strand a handle behind. Clicking is also the only
  gesture that works the same on a touch panel.
- **A triangle is the floor.** Below three corners there is no polygon left, so the last
  three corners refuse to be removed and say so in their tooltip.
- **The drag is buffered in the map component.** The reshaped ring is held locally and
  pushed to the page only on `dragend`. Emitting per frame would re-render the whole page,
  re-running the grouping pass and the marker diff for every mouse move; the polygon still
  follows the cursor because the component repaints its own GeoJSON source directly.

Handles are keyed by index and the whole set is rebuilt whenever the ring's length changes
— cheaper and far more predictable than renumbering in place after an insert or a delete.

An area with **no** ring is legitimate (it groups its assets and draws nothing), so the
panel offers *Draw the outline* for it, which fills that area instead of creating a new one.

Verified with 16 checks: move touches only the dragged corner; insert lands on the clicked
edge's midpoint, preserves winding order, and wraps correctly on the closing edge; remove
drops the right corner and refuses below a triangle; and 40 mixed operations leave the ring
drawable, closed, and still answering point-in-area correctly.

## Import / export

Two formats, because they answer two different needs (`gis/data/io.ts`).

| | Native **JSON** | **GeoJSON** |
| --- | --- | --- |
| Envelope | `{ kind: 'gis-sites', version, sites }` | `FeatureCollection` |
| Carries | *everything* — bindings, readings, drill-down routes, basemap, grouping thresholds, area ids | geometry plus those same fields as feature properties |
| For | moving a configuration between projects, backups, reviewing a diff | QGIS / ArcGIS interop — and **bringing surveyed coordinates in** |
| Scope | all sites, or one | one site |

**GeoJSON is the answer to the assistant's approximate coordinates.** Draft the site with
the AI, export it, open it in QGIS beside the real survey, correct the positions, import it
back. Areas become `Polygon` features and assets `Point` features, so the exchange works in
both directions with tools nobody had to teach about this page.

A **foreign** layer — one this page did not write — imports too. Features from this module
carry a `gisType` property, but a QGIS export will not, so the **geometry decides**: a
polygon becomes an area, a point becomes an asset, anything else (a `LineString`, say) is
ignored. That is what makes a plain survey layer usable without preparation.

### Where an import lands

- **Native JSON** carries whole sites, so it **creates** them.
- **GeoJSON** is geometry, so it fills the site that is **open** — through the very same
  apply path the AI assistant uses, which means edit mode, review on the map, then **Done**.
  With no site open it creates one, named from the file.

Reusing the assistant's apply path is deliberate: a GeoJSON layer and an AI proposal are the
same kind of object (an untrusted draft of areas and assets), so they get the same review
gate rather than two code paths that could drift apart.

### Everything imported is sanitised

Through `normalizeSite`, the same coercion the assistant's proposals go through — a file is
exactly as untrusted as a language model, being hand-edited, foreign, or simply from an older
version of this page. See [the table above](#everything-a-proposal-says-is-sanitised); in
particular an off-site `link` is stripped, so a crafted file cannot point the dashboard at an
external URL.

One coercion exists **because of** import: the basemap. An AI proposal never carries one, so
it was originally always reset to the OSM default — which would have silently wiped a
deployment's own tile server on every round-trip through a file. It is now coerced field by
field and only defaulted when genuinely absent.

Verified with 47 checks: a full native round-trip of both demo sites (every ring to the last
decimal, every binding, every reading, membership, drill-down, basemap, thresholds); a
non-default tile server surviving; a GeoJSON round-trip including ring closing and re-opening;
a foreign layer with no `gisType`; and clear errors — never a crash — for malformed, empty and
non-JSON input.

## When a site is written

On leaving **edit** mode — not on every keystroke or marker drag. Each write is a
datapoint write *and* an audit-trail record, so writing per event would produce an audit
trail nobody can read. The audit baseline is captured when edit mode is entered, so the
"Done" record is a single old → new diff of the whole session.

Site *settings* (name, basemap, centre) save when their dialog is confirmed, since that
dialog is already an explicit commit.

## Offline / air-gapped

A basemap kind of **`none`** is a first-class option, not a degraded state: assets and
areas draw over a themed background and nothing on the page touches the network. This
matters because a large share of industrial sites cannot reach a tile server at all, and
a map module that assumed otherwise would be unusable there.

When tiles *are* configured but fail to load, the page says so explicitly — an operator
seeing a blank background needs to know it is the tile server and not the data. Only an
HTTP fetch failure raises that notice; style-validation and shader errors are not the
operator's problem to fix.

## The network simulator (`gisSim`)

An **optional** manager (`backend/managers/gisSim/`), for demos, training and
commissioning a site before its real datapoints exist. The page stays **Tier 1**: it does
not know the simulator exists, and nothing here changes if it is not running.

Four decisions carry it.

### It simulates the network, not 200 independent values

The site already holds a topology — `Connection.from`/`.to` name assets — so a consumer's
demand can be served *by the sources the graph actually connects it to, through the segments
that actually join them*. A tick is one allocation over that graph (`network.js`), which is
what makes the map behave like a plant rather than like a screensaver:

- a plant taken out stops feeding, and the cities it fed are picked up by the plants that
  remain — every remaining line's flux rises;
- a **tripped segment** leaves the graph, so the flow reroutes if another path exists and the
  consumer is visibly short if none does (`couverture` drops and alarms);
- a segment's flux is the **sum of what transits it**, so it agrees with both of its ends.

The allocation is a two-step proportional split — each source's capacity shared between the
consumers that can reach it, in proportion to their demand, then two rebalancing rounds
handing unserved demand to spare capacity — with **one shortest path per (source, consumer)
pair** and no routing through another consumer. It is a supervision demo, not a load flow: a
meshed network loads one path instead of splitting by impedance, so a segment's `charge` is a
plausible figure and not an engineering one.

### A route is the second topological coupling

A network that carries no *flow* has a topology worth simulating all the same. A metro is the
case that showed it: nothing is consumed, so the allocation above has nothing to allocate —
and yet closing one tunnel section is exactly the event an operator has to see.

So a segment also belongs to a **route**, and the route's state is derived: a line with any
section out of service runs *thinned* on every section that is still open, its delays rise
along the whole line, and the stations at both ends of each segment inherit the worst service
of the lines that touch them. The other line on the same map is untouched. That is a property
of the drawing — of which segments the author put on which route — and it needs no
configuration at all.

Which is also why `metro` and `rail` are two families rather than one: a metro section is
supervised on its tunnel temperature and its third-rail voltage, and a mainline section is
not.

### The family comes from the kind CROSSED WITH the links

`AssetKind` says what glyph to draw, not what the thing does: a `station` is a power plant in
one site and a pumping station in another. The only evidence in the model is **what it is
wired with** — `power` connections make it electrical, `pipe` connections hydraulic — so the
family is resolved from the pair (`families.js`), and a site drawn by hand comes out
simulated correctly with nothing to configure. `sim:famille=` in an object's `notes` is the
escape hatch, because the domain model has no field for this and a demo occasionally needs
one.

### One FLAT datapoint per value, not one struct per asset

`GisSim_<assetId>_<element>`, `GisLink_<connectionId>_<element>`. The reason is how this page
resolves an alarm: `alarmColor` widens `asset.dp` to its **datapoint** (`bareDp`) and follows
that datapoint's `_alert_hdl.._act_state_color`. On a struct that root is the struct node,
which would need a **summary-alert** config; on a flat datapoint the alert sits exactly where
the page looks, using the plain binary/analog alert configuration. It is also the shape the
page's own demo binds to (`ExampleDP_*`).

So the element that carries the alert is a Bool, `defaut`, and that is what an asset's `dp`
is bound to — it is the alarm state and the Alarms drill-down scope, never a displayed value.
`etat` (0 arrêt, 1 marche, 2 défaut, 3 maintenance) and the measurements are separate
datapoints, some with their own analog thresholds. The cost of flat is the count (a couple of
hundred datapoints for a site of thirty assets) and a drill-down scoped to one datapoint
rather than to a whole asset; both were worth paying for an alarm path that works.

The manager configures alerts **only on the datapoints it has just created**, so a threshold
retuned in PARA is never overwritten, and every failure is logged and survived — a project
without the standard alarm classes loses the highlighting, not the values.

### It never writes to a site

A binding is the page's business. The manager creates and drives datapoints; the **naming
rule above is the contract**, and the companion CLI `bind-site.js` writes exactly those names
into an exported site (same catalogue, so the two cannot drift). An asset left unbound is
still simulated — only nothing on the map reads it yet, and the manager names such bindings
in its log.

The alternative — the `AUTO_MAP` that `machineSim` performs on its ateliers — would have the
manager rewrite the `GIS_Site` datapoint behind the page's back, bypassing its audit trail
and racing an open edit session. Import a bound file instead; the round-trip is a reviewed
one.

### Sizing, and why it is capped by the topology

Capacity and demand come from `sim:capacite=` / `sim:demande=` in the notes when stated —
which is how a demo carries the installed power of a real plant — else from the family
default spread by a **stable hash of the id**, so two plants are not clones and a restart does
not change the shape of the demo. Any other `sim:` key naming an element of the family sets
**that element's** baseline (`sim:affluence=2600` on an interchange station), because the hash
spread applies to a capacity and a demand, never to a free value: scaling a baseline that
happens to be a voltage or a temperature by ±40 % would produce a 240 kV grid and a 15 °C
platform. Unstated demands are then scaled to ~78 % of the production
available *in their domain*, and **capped at what the topology can actually bring to that
consumer**: a node wired to one 3 660 MW plant is served by 3 660 MW however large the fleet
on the map is, and sizing it beyond that would leave it permanently short — an alarm about the
sizing rather than about the plant. A **stated** demand is never capped, only reported when
its sources cannot follow: the author said what they meant, and an under-served consumer may
well be the point.

### Its limits

- **Asset and connection ids are unique within a site**, not across sites, so two sites that
  both hold an asset `paris` would claim the same datapoints. The second is skipped and named
  in the log rather than driven from two places.
- **No persistence.** Levels and totalisers restart from their defaults when the manager
  does; only the *configuration* survives (it is re-read from the sites every minute).
- **Reachability is recomputed every tick**, which is fine for the sites this page is meant
  for and would need caching at a few thousand assets.
- **Nothing is written to the process.** The simulator drives its own datapoints only; it
  never touches an asset's real bindings.

## Limits

- **Assets per site: comfortable to a few hundred.** HTML markers cost a DOM node each.
  Decluttering keeps the *drawn* count low whatever the site holds, but the clustering
  pass itself is O(assets) per zoom change, so a site with thousands of assets still wants
  a GL layer instead — which means accepting a glyphs endpoint (or dropping on-map labels).
- **A badge cannot say *which* asset is in alarm**, only how many. That is the price of
  folding alarms into badges; the answer is one click, which zooms to exactly those assets.
  The *In alarm only* filter narrows the map to them at any zoom.
- **Area rings are simple polygons** — one ring, no holes, no multi-polygons. Enough for
  a sector or a district; not a cadastral boundary.
- **Point-in-area is planar.** Assigning a dropped asset to the area it landed in treats
  degrees as a plane. Over a district-sized ring the error is far below the size of a
  marker; it is not a geodesic test.
- **An area's name is only ever shown on hover**, so it cannot be read from a printed
  screenshot or by an operator who never moves the pointer. The area panel names it in text.
- **No geodesic measurement.** The page shows a scale bar; it does not measure distances,
  lengths or areas.

## Deliberate gaps

- **No tile caching or offline tile packaging.** Serving tiles is a tile server's job;
  this page consumes them.
- **No asset import** (CSV / GeoJSON / shapefile). Sites are authored on the map or
  written into the `GIS_Site` datapoint by whatever provisioning the project already has.
- **No routing, geocoding or spatial queries.** No search-by-address, no
  nearest-asset, no "assets within 500 m".
- **No writing to the process.** The page is read-only towards the plant: it displays
  datapoints and navigates, it never commands one. Editing changes the *site*, never the
  assets' own datapoints.
- **No datapoints created by the page.** The demo binds to the standard `ExampleDP_*`
  datapoints, which a new/example project already drives; those are **absent from a
  production project** (see
  `docs/knowledge/project/webui-runtime-example-datapoints.md` in the dashboard repo).
  Rebinding them is what the asset inspector is for — or the **optional `gisSim`
  manager**, which creates datapoints of its own and drives them (see
  [The network simulator](#the-network-simulator-gissim)). The page itself never creates a
  process datapoint, with or without it.

## Known duplication

The isolated-`dpConnect` + `_act_state_color` pattern in `gis/data/live.ts` also exists,
inline, in `libs/wui-ampere/src/ampere.ts`. Both pages arrived at it for the same reason.
It is a fair candidate for extraction into `@visuelconcept/wui-kit`, which is why it is
noted here rather than silently copied a third time — that change touches the shared kit
and belongs in its own review.
