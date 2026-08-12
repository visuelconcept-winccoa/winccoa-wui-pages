// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The map itself: a MapLibre GL canvas with the site's areas as GL polygons and its
 * assets as HTML markers.
 *
 * **Why the assets are HTML markers and not a GL layer.** A marker element is
 * ordinary DOM inside this component's shadow root, so it is styled by the same
 * stylesheet and the same `--theme-*` tokens as the rest of the page, it can host an
 * `ix-icon`, and its live value updates by re-rendering a Lit template. A GL symbol
 * layer would need a `glyphs` font endpoint (fatal for the offline basemap) and an
 * SDF sprite per asset kind. The trade is scale: HTML markers cost a DOM node each,
 * so a site is comfortable up to a few hundred assets — see docs/wui-gis/NOTES.md.
 *
 * **Lifecycle.** The WebGL context is created in `firstUpdated` and released in
 * `disconnectedCallback`; the router recreates the element per route, so a site
 * change never leaks a context. Everything else is idempotent re-synchronisation
 * driven from `updated()`: `syncStyle`, `syncAreas`, `syncMarkers`.
 *
 * Emits:
 * - `wui:select` `{ kind: 'asset' | 'area' | 'none', id }` — selection changed.
 * - `wui:open`   `{ kind: 'asset' | 'area', id }` — drill-down asked for.
 * - `wui:place`  `{ lat, lon }` — edit mode, the map was clicked to place an asset.
 * - `wui:move`   `{ id, lat, lon }` — edit mode, a marker was dragged.
 * - `wui:draft`  `{ points }` — edit mode, the ring being drawn changed.
 * - `wui:tilesfailed` — the basemap tiles could not be loaded.
 * - `wui:cspblocked` — the basemap host is refused by the page's Content-Security-Policy.
 * - `wui:webglfailed` — no usable WebGL context; the map cannot be drawn.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import {
  LitElement,
  css,
  html,
  render,
  type PropertyValues,
  type TemplateResult
} from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { bareDp } from '../drill.js';
import { formatValue, normDp, type LiveState } from '../data/live.js';
import { MSG, assetKindLabel, clusterTitle, localize } from '../i18n.js';
import { groupSite, type Cluster } from '../map/cluster.js';
import { assetIcon } from '../map/glyphs.js';
import maplibregl, {
  MAPLIBRE_STYLES,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapLibreMap,
  type MapMouseEvent,
  type Marker
} from '../map/maplibre.js';
import {
  AREA_FILL_LAYER,
  AREA_SOURCE,
  DRAFT_SOURCE,
  EMPTY_COLLECTION,
  MIN_RING,
  areaCollection,
  areaLayers,
  buildStyle,
  draftCollection,
  draftLayers,
  styleChanged,
  tileUrl
} from '../map/style.js';
import {
  areaBounds,
  boundsOf,
  isValidLatLon,
  siteBounds,
  type Area,
  type Asset,
  type Bounds,
  type Site
} from '../types.js';

/** What the map does with a click on empty space. */
export type MapTool = 'select' | 'place-asset' | 'draw-area';

/** Padding, in pixels, left around the content when fitting the view to it. */
const FIT_PADDING = 56;
/** Zoom `fitBounds` will not go past — a single asset must not zoom to the pavement. */
const FIT_MAX_ZOOM = 17;
/** Animation used for every programmatic camera move, in milliseconds. */
const MOVE_DURATION = 450;
/** Gap between the cursor and the area tooltip above it, in pixels. */
const AREA_TIP_OFFSET_PX = 14;

@customElement('gis-map')
export class GisMap extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    MAPLIBRE_STYLES,
    mapStyles()
  ];

  @property({ attribute: false }) site: Site | null = null;

  /** Live values + alarm colours; a NEW object identity is what triggers a repaint. */
  @property({ attribute: false }) live: LiveState = {
    values: new Map(),
    alarmColors: new Map()
  };

  /** Id of the selected asset, empty when none. */
  @property() selectedAsset = '';

  /** Id of the selected area, empty when none. */
  @property() selectedArea = '';

  /** Assets the host wants shown (ids); `null` ⇒ all of them. */
  @property({ attribute: false }) visibleAssets: ReadonlySet<string> | null =
    null;

  /** What a click on empty space does. */
  @property() tool: MapTool = 'select';

  /** Markers are draggable only in edit mode. */
  @property({ type: Boolean }) editable = false;

  /**
   * Group the quiet assets into count badges so their discs stop overlapping when the
   * map is zoomed out. Assets **in alarm** are never grouped. On by default; the host's
   * toolbar turns it off to show every asset individually.
   */
  @property({ type: Boolean }) declutter = true;

  /**
   * Id of the area whose outline is being reshaped, `''` for none. Only honoured in edit
   * mode: handles that move a stored polygon have no business existing outside it.
   */
  @property() editingRing = '';

  private map: MapLibreMap | null = null;
  /** One entry per drawn asset: the MapLibre marker and the element we render into. */
  private readonly assetMarkers = new Map<
    string,
    { marker: Marker; element: HTMLElement }
  >();
  /** The tooltip naming the area under the cursor; created on first hover. */
  private areaTip: { marker: Marker; element: HTMLElement } | null = null;
  /** One entry per cluster count badge, keyed by its grid cell id. */
  private readonly clusterMarkers = new Map<
    string,
    { marker: Marker; element: HTMLElement }
  >();
  /** Members behind each badge, so clicking it can zoom to exactly those assets. */
  private readonly clusterBounds = new Map<string, readonly Asset[]>();
  /** Corner and midpoint handles of the outline being reshaped, keyed `v<i>` / `m<i>`. */
  private readonly ringHandles = new Map<
    string,
    { marker: Marker; element: HTMLElement }
  >();
  /**
   * The ring as it looks mid-gesture. Held here rather than pushed to the host on every
   * drag frame: the host owns the site, and re-rendering the whole page per frame would
   * re-run the grouping pass and the marker diff for nothing.
   */
  private ringDraft: { areaId: string; ring: [number, number][] } | null = null;
  /** The ring being drawn, `[lon, lat]` pairs. */
  private draft: [number, number][] = [];
  /** Point count last announced through `wui:draft`, so it fires only on a change. */
  private announcedDraft = 0;
  /** Basemap the current style was built from — the `setStyle` trigger. */
  private styleFrom: Site['basemap'] | undefined = undefined;
  /** Site whose content the view was last fitted to, so it fits once per site. */
  private fittedSiteId = '';
  private resizeObserver: ResizeObserver | null = null;
  /** Set once the style has finished loading; overlays may only be added after. */
  private styleReady = false;
  /** Latched when WebGL is unavailable, so `updated()` stops retrying for ever. */
  private creationFailed = false;
  /** Layer-scoped listeners survive a style swap; bind them exactly once. */
  private areaListenersBound = false;

  /** Points collected for the ring currently being drawn. */
  get draftPoints(): readonly (readonly [number, number])[] {
    return this.draft;
  }

  /** The container MapLibre draws into; it only exists once we have rendered. */
  private get canvasHost(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.canvas');
  }

  override render(): TemplateResult {
    return html`<div class="canvas" part="canvas"></div>`;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener(
      'securitypolicyviolation',
      this.onCspViolation
    );
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    for (const { marker } of this.assetMarkers.values()) marker.remove();
    this.assetMarkers.clear();
    this.areaTip?.marker.remove();
    this.areaTip = null;
    for (const { marker } of this.clusterMarkers.values()) marker.remove();
    this.clusterMarkers.clear();
    this.clusterBounds.clear();
    this.clearRingHandles();
    this.ringDraft = null;
    // Releases the WebGL context. Without it, switching sites a dozen times
    // exhausts the browser's context budget and the map silently stops drawing.
    this.map?.remove();
    this.map = null;
    this.styleReady = false;
  }

  // --- public commands -------------------------------------------------------

  /** Fit the view to everything the site draws, else fall back to its centre/zoom. */
  fitToSite(): void {
    if (!this.site) return;
    const bounds = siteBounds(this.site);
    if (bounds) {
      this.fitBounds(bounds);
      return;
    }
    this.map?.easeTo({
      center: [this.site.center.lon, this.site.center.lat],
      zoom: this.site.zoom,
      duration: MOVE_DURATION
    });
  }

  /** Fit the view to one area (no-op when the area has no drawn ring). */
  fitToArea(areaId: string): void {
    const area = this.site?.areas.find((candidate) => candidate.id === areaId);
    if (!area) return;
    const bounds = areaBounds(area);
    if (bounds) this.fitBounds(bounds);
  }

  /** Centre the view on one asset without changing the zoom. */
  panToAsset(assetId: string): void {
    const asset = this.site?.assets.find(
      (candidate) => candidate.id === assetId
    );
    if (!asset || !isValidLatLon(asset.lat, asset.lon)) return;
    this.map?.easeTo({
      center: [asset.lon, asset.lat],
      duration: MOVE_DURATION
    });
  }

  /**
   * Close the ring being drawn and hand it back, or `null` when it does not
   * enclose anything yet. Clears the draft either way.
   */
  takeDraftRing(): readonly (readonly [number, number])[] | null {
    const ring = this.draft.length >= MIN_RING ? [...this.draft] : null;
    this.clearDraft();
    return ring;
  }

  /** Abandon the ring being drawn. */
  clearDraft(): void {
    this.draft = [];
    this.pushDraft();
  }

  // --- lifecycle -------------------------------------------------------------

  protected override firstUpdated(): void {
    this.createMap();
  }

  protected override updated(changed: PropertyValues): void {
    // The host may resolve its site AFTER the first render (it is read from a
    // datapoint), so map creation is retried here rather than only in firstUpdated.
    if (!this.map) {
      this.createMap();
      return;
    }
    this.syncStyle();
    if (
      changed.has('site') &&
      this.site &&
      this.site.id !== this.fittedSiteId
    ) {
      this.fittedSiteId = this.site.id;
      this.fitToSite();
    }
    this.syncOverlays();
  }

  // --- map creation ----------------------------------------------------------

  private createMap(): void {
    const container = this.canvasHost;
    if (!container || !this.site || this.creationFailed) return;
    const basemap = this.site.basemap;
    try {
      this.map = new maplibregl.Map({
        container,
        style: buildStyle(basemap, this.backgroundColor()),
        center: [this.site.center.lon, this.site.center.lat],
        zoom: this.site.zoom,
        // The compact control is where the tile licence's credit line is shown.
        attributionControl: { compact: true },
        // Nothing on this map is drawn in 3D, and a tilted plane makes a marker's
        // anchor point ambiguous when placing one.
        pitchWithRotate: false,
        dragRotate: false
      });
    } catch {
      // No WebGL: a panel PC with a bare VM graphics driver, typically. Latched —
      // retrying on every render would only repeat the failure and the event.
      this.creationFailed = true;
      this.dispatchEvent(
        new CustomEvent('wui:webglfailed', { bubbles: true, composed: true })
      );
      return;
    }
    this.styleFrom = basemap;
    this.map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right'
    );
    this.map.addControl(
      new maplibregl.ScaleControl({ unit: 'metric' }),
      'bottom-left'
    );
    this.map.on('style.load', () => this.onStyleLoad());
    this.map.on('click', (event: MapMouseEvent) => this.onMapClick(event));
    this.map.on('error', (event) => this.onMapError(event.error));
    // Grouping depends on the zoom, and only on the zoom — the cluster grid is
    // anchored in world pixels, so panning cannot re-bucket anything. Recomputing on
    // `zoomend` rather than on every frame keeps a pinch gesture smooth; MapLibre goes
    // on repositioning the existing markers throughout it.
    this.map.on('zoomend', () => this.syncMarkers());
    // MapLibre observes its container itself, but the page's split layout resizes
    // it through a CSS grid change that the observer can miss on the first pass.
    this.resizeObserver = new ResizeObserver(() => this.map?.resize());
    this.resizeObserver.observe(container);
    // A blocked tile reports as a plain fetch failure, so the real cause has to be
    // caught from the CSP violation itself — see `onCspViolation`.
    document.addEventListener('securitypolicyviolation', this.onCspViolation);
  }

  /**
   * The WebUI shell injects `default-src 'self' … data: blob:` whenever the project
   * setting **allowExternalResources** is off (`GET /WebUI_Settings`, see
   * `WuiCspService`). MapLibre fetches its tiles with the Fetch API, and `connect-src`
   * falls back to `default-src`, so ANY off-origin basemap is refused — the very
   * common case of a site left on the public OpenStreetMap tiles.
   *
   * MapLibre only sees "the request failed", which would send the operator hunting a
   * tile server that is fine. The violation event carries the real cause, so it is
   * reported separately and the page can name the setting to change.
   */
  private readonly onCspViolation = (
    event: SecurityPolicyViolationEvent
  ): void => {
    const tiles = this.site ? tileUrl(this.site.basemap) : '';
    const target =
      this.site?.basemap.kind === 'style' ? this.site.basemap.styleUrl : tiles;
    if (!target || !sameOrigin(event.blockedURI, target)) return;
    this.dispatchEvent(
      new CustomEvent('wui:cspblocked', { bubbles: true, composed: true })
    );
  };

  /** The style finished loading — the overlays can (re)enter it. */
  private onStyleLoad(): void {
    this.styleReady = true;
    this.addOverlayLayers();
    this.syncOverlays();
  }

  /**
   * A tile that would not load is worth telling the operator about — an offline
   * plant sees a blank basemap and needs to know it is the tiles, not the data.
   * Only a fetch failure carries an HTTP `status` (MapLibre throws `AJAXError` for
   * those); style-validation and shader errors do not, and are not the operator's
   * problem to fix.
   */
  private onMapError(error: Error | undefined): void {
    const status = (error as { status?: number } | undefined)?.status;
    if (status === undefined) return;
    this.dispatchEvent(
      new CustomEvent('wui:tilesfailed', { bubbles: true, composed: true })
    );
  }

  private syncStyle(): void {
    const basemap = this.site?.basemap;
    if (!this.map || !basemap || !styleChanged(this.styleFrom, basemap)) return;
    this.styleFrom = basemap;
    this.styleReady = false;
    // `style.load` fires again and re-adds the overlays; markers are DOM and survive.
    this.map.setStyle(buildStyle(basemap, this.backgroundColor()));
  }

  /**
   * Add this page's own sources and layers.
   *
   * Only valid once the style is loaded, and re-entered after every `setStyle` —
   * a style swap discards all sources and layers, so this has to be idempotent.
   * The layer *listeners* are wired once, on first creation: MapLibre keeps
   * layer-scoped handlers keyed by layer id across a style change, so re-binding
   * them would fire the handler once per style swap.
   */
  private addOverlayLayers(): void {
    const map = this.map;
    if (!map) return;
    if (!map.getSource(AREA_SOURCE))
      map.addSource(AREA_SOURCE, { type: 'geojson', data: EMPTY_COLLECTION });
    if (!map.getSource(DRAFT_SOURCE))
      map.addSource(DRAFT_SOURCE, { type: 'geojson', data: EMPTY_COLLECTION });
    for (const layer of [...areaLayers(), ...draftLayers()]) {
      if (!map.getLayer(layer.id)) map.addLayer(layer);
    }
    if (this.areaListenersBound) return;
    this.areaListenersBound = true;
    map.on('click', AREA_FILL_LAYER, (event) =>
      this.onAreaClick(event.features)
    );
    map.on('mouseenter', AREA_FILL_LAYER, () => this.setCursor('pointer'));
    map.on('mousemove', AREA_FILL_LAYER, (event) => this.showAreaTip(event));
    map.on('mouseleave', AREA_FILL_LAYER, () => {
      this.setCursor('');
      this.hideAreaTip();
    });
  }

  private syncOverlays(): void {
    if (!this.styleReady) return;
    this.syncMarkers();
    this.syncAreas();
    this.pushDraft();
  }

  // --- areas -----------------------------------------------------------------

  private syncAreas(): void {
    this.geoJsonSource(AREA_SOURCE)?.setData(
      areaCollection(this.drawnAreas(), this.selectedArea)
    );
    this.syncRingHandles();
  }

  /**
   * The areas as they should currently be *drawn*: the live draft ring substituted for the
   * one being reshaped, so the polygon follows the handle under the cursor without the
   * host having to re-render the whole page on every drag frame.
   */
  private drawnAreas(): Area[] {
    const areas = this.site?.areas ?? [];
    const draft = this.ringDraft;
    if (!draft) return [...areas];
    return areas.map((area) =>
      area.id === draft.areaId ? { ...area, ring: draft.ring } : area
    );
  }

  /** The ring currently under the editor: the live draft, else what is stored. */
  private editedRing(): readonly (readonly [number, number])[] {
    if (this.ringDraft?.areaId === this.editingRing) return this.ringDraft.ring;
    const area = this.site?.areas.find(
      (candidate) => candidate.id === this.editingRing
    );
    return area?.ring ?? [];
  }

  /** One of this page's own GeoJSON sources, once the style holds it. */
  private geoJsonSource(id: string): GeoJSONSource | null {
    const source = this.map?.getSource(id);
    return source && 'setData' in source ? (source as GeoJSONSource) : null;
  }

  /**
   * Name the area under the cursor, in a tooltip that follows it.
   *
   * A tooltip rather than a permanent plate on every outline: the polygon and its colour
   * already say *where* a zone is, and a site with a dozen zones carrying a dozen plates —
   * each of them competing with the asset name plates for the same pixels — is a map nobody
   * reads. The name is what you ask for about one zone, one at a time, which is exactly the
   * shape of a hover.
   *
   * **Every** area under the pointer is named, not just the topmost. Zones may overlap now
   * that an asset can belong to several, and naming only the one MapLibre happens to draw
   * last would hide precisely the ambiguity that is worth resolving.
   */
  private showAreaTip(event: MapLayerMouseEvent): void {
    const map = this.map;
    if (!map) return;
    const hovered = new Set(
      (event.features ?? []).map((feature) =>
        String(feature.properties?.['areaId'] ?? '')
      )
    );
    const names = (this.site?.areas ?? [])
      .filter((area) => hovered.has(area.id) && area.name !== '')
      .map((area) => area.name);
    if (names.length === 0) {
      this.hideAreaTip();
      return;
    }
    const tip = (this.areaTip ??= this.createAreaTip(map));
    tip.element.textContent = names.join(' · ');
    tip.element.hidden = false;
    tip.marker.setLngLat(event.lngLat);
  }

  private hideAreaTip(): void {
    if (this.areaTip) this.areaTip.element.hidden = true;
  }

  /**
   * The single tooltip element, reused for every area. Anchored *below* the cursor's
   * position so the label sits above the pointer and never under the hand holding it.
   */
  private createAreaTip(map: MapLibreMap): {
    marker: Marker;
    element: HTMLElement;
  } {
    const element = document.createElement('div');
    element.className = 'area-tip';
    // The tooltip must never eat the click that selects the area underneath it.
    element.style.pointerEvents = 'none';
    const marker = new maplibregl.Marker({
      element,
      anchor: 'bottom',
      offset: [0, -AREA_TIP_OFFSET_PX]
    })
      .setLngLat([0, 0])
      .addTo(map);
    return { marker, element };
  }

  // --- ring editing ----------------------------------------------------------

  /**
   * The handles for reshaping one area's outline: a solid handle on every corner, and a
   * hollow one at every midpoint.
   *
   * Drag a corner to move it, click a corner to remove it (never below a triangle), click
   * a midpoint to insert a corner there. Insert-by-click rather than insert-by-drag: a
   * midpoint dragged would have to turn into a corner halfway through the gesture, and
   * swapping a MapLibre marker's identity mid-drag is exactly the kind of thing that
   * strands a handle behind.
   *
   * Handles are keyed by index, so the whole set is rebuilt whenever the ring's length
   * changes — cheaper and far more predictable than trying to renumber them in place.
   */
  private syncRingHandles(): void {
    const map = this.map;
    if (!map) return;
    const editing = this.editable && this.editingRing !== '';
    const ring = editing ? this.editedRing() : [];
    if (ring.length < MIN_RING) {
      this.clearRingHandles();
      return;
    }
    const wanted = new Set<string>();
    for (const [index, point] of ring.entries()) {
      wanted.add(this.syncVertex(index, point, ring.length, map));
      const next = ring[(index + 1) % ring.length] as readonly [number, number];
      wanted.add(this.syncMidpoint(index, point, next, map));
    }
    for (const [key, entry] of this.ringHandles) {
      if (wanted.has(key)) continue;
      entry.marker.remove();
      this.ringHandles.delete(key);
    }
  }

  private syncVertex(
    index: number,
    point: readonly [number, number],
    ringLength: number,
    map: MapLibreMap
  ): string {
    const key = `v${index}`;
    let entry = this.ringHandles.get(key);
    if (!entry) {
      const element = document.createElement('button');
      element.className = 'handle vertex';
      element.type = 'button';
      let moved = false;
      const marker = new maplibregl.Marker({
        element,
        anchor: 'center',
        draggable: true
      })
        .setLngLat([point[0], point[1]])
        .addTo(map);
      marker.on('dragstart', () => {
        moved = false;
      });
      marker.on('drag', () => {
        moved = true;
        const { lng, lat } = marker.getLngLat();
        this.updateDraft((ring) =>
          ring.map((p, i) => (i === index ? [lng, lat] : p))
        );
      });
      marker.on('dragend', () => this.commitDraft());
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        // A drag ends with a click on the same element; only a real click deletes.
        if (moved) {
          moved = false;
          return;
        }
        this.removeVertex(index);
      });
      entry = { marker, element };
      this.ringHandles.set(key, entry);
    }
    entry.marker.setLngLat([point[0], point[1]]);
    // Below a triangle there is no polygon left, so the last three corners are protected.
    entry.element.classList.toggle('locked', ringLength <= MIN_RING);
    entry.element.title =
      ringLength > MIN_RING
        ? localize(MSG.ring.vertexHint)
        : localize(MSG.ring.vertexLocked);
    return key;
  }

  private syncMidpoint(
    index: number,
    from: readonly [number, number],
    to: readonly [number, number],
    map: MapLibreMap
  ): string {
    const key = `m${index}`;
    const HALF = 2;
    const middle: [number, number] = [
      (from[0] + to[0]) / HALF,
      (from[1] + to[1]) / HALF
    ];
    let entry = this.ringHandles.get(key);
    if (!entry) {
      const element = document.createElement('button');
      element.className = 'handle midpoint';
      element.type = 'button';
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        this.insertVertex(index);
      });
      const marker = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat(middle)
        .addTo(map);
      entry = { marker, element };
      this.ringHandles.set(key, entry);
    }
    entry.marker.setLngLat(middle);
    entry.element.title = localize(MSG.ring.midpointHint);
    return key;
  }

  /** Apply a change to the live draft ring and repaint the polygon immediately. */
  private updateDraft(
    change: (
      ring: readonly (readonly [number, number])[]
    ) => (readonly [number, number])[]
  ): void {
    const areaId = this.editingRing;
    if (!areaId) return;
    this.ringDraft = {
      areaId,
      ring: change(this.editedRing()) as [number, number][]
    };
    this.geoJsonSource(AREA_SOURCE)?.setData(
      areaCollection(this.drawnAreas(), this.selectedArea)
    );
    this.syncRingHandles();
  }

  /** Hand the finished ring to the host, which owns the site state. */
  private commitDraft(): void {
    const draft = this.ringDraft;
    if (!draft) return;
    this.ringDraft = null;
    this.dispatchEvent(
      new CustomEvent('wui:ring', {
        detail: { areaId: draft.areaId, ring: draft.ring },
        bubbles: true,
        composed: true
      })
    );
  }

  private insertVertex(index: number): void {
    const HALF = 2;
    this.updateDraft((ring) => {
      const from = ring[index] as readonly [number, number];
      const to = ring[(index + 1) % ring.length] as readonly [number, number];
      const middle: [number, number] = [
        (from[0] + to[0]) / HALF,
        (from[1] + to[1]) / HALF
      ];
      return [...ring.slice(0, index + 1), middle, ...ring.slice(index + 1)];
    });
    this.commitDraft();
  }

  private removeVertex(index: number): void {
    if (this.editedRing().length <= MIN_RING) return;
    this.updateDraft((ring) => ring.filter((_, i) => i !== index));
    this.commitDraft();
  }

  private clearRingHandles(): void {
    for (const { marker } of this.ringHandles.values()) marker.remove();
    this.ringHandles.clear();
  }

  // --- asset markers ---------------------------------------------------------

  /** The assets the map may draw at all, before decluttering groups any of them. */
  private drawableAssets(): Asset[] {
    return (this.site?.assets ?? []).filter(
      (asset) =>
        isValidLatLon(asset.lat, asset.lon) &&
        (!this.visibleAssets || this.visibleAssets.has(asset.id))
    );
  }

  private syncMarkers(): void {
    const map = this.map;
    if (!map) return;
    const drawable = this.drawableAssets();
    // The grouping hierarchy: assets → areas → the whole site. With grouping off every
    // asset is its own marker, but the label rule still holds: a name plate is drawn only
    // for a disc that is visually on its own.
    const { singles, clusters } = groupSite(
      this.site,
      drawable,
      map.getZoom(),
      (asset) => this.isInAlarm(asset),
      { group: this.declutter }
    );

    const wanted = new Set<string>();
    for (const single of singles) {
      wanted.add(single.asset.id);
      this.syncMarker(single.asset, single.labelled, map);
    }
    for (const [id, entry] of this.assetMarkers) {
      if (wanted.has(id)) continue;
      entry.marker.remove();
      this.assetMarkers.delete(id);
    }
    this.syncClusters(clusters, map);
  }

  /** True when the asset's primary datapoint carries an active alert state. */
  private isInAlarm(asset: Asset): boolean {
    return this.live.alarmColors.get(alarmKey(asset.dp)) !== undefined;
  }

  /** One count badge per cluster, reused across zooms by its cell id. */
  private syncClusters(clusters: readonly Cluster[], map: MapLibreMap): void {
    const wanted = new Set<string>();
    for (const cluster of clusters) {
      wanted.add(cluster.id);
      let entry = this.clusterMarkers.get(cluster.id);
      if (!entry) {
        const element = document.createElement('button');
        element.className = 'cluster';
        element.type = 'button';
        // Clicking a badge zooms to what it stands for — the conventional way to
        // open a cluster, and it needs no extra affordance to explain.
        element.addEventListener('click', (event) => {
          event.stopPropagation();
          this.zoomToCluster(cluster.id);
        });
        const marker = new maplibregl.Marker({ element, anchor: 'center' })
          .setLngLat([cluster.lon, cluster.lat])
          .addTo(map);
        entry = { marker, element };
        this.clusterMarkers.set(cluster.id, entry);
      }
      entry.marker.setLngLat([cluster.lon, cluster.lat]);
      entry.element.classList.toggle(`kind-area`, cluster.kind === 'area');
      entry.element.classList.toggle(`kind-site`, cluster.kind === 'site');
      entry.element.classList.toggle('has-alarms', cluster.alarms > 0);
      // An area badge takes its area's colour, so it still reads as that area.
      entry.element.style.setProperty(
        '--cluster-color',
        cluster.color || 'var(--theme-color-component-1)'
      );
      render(clusterTemplate(cluster), entry.element);
      entry.element.title = clusterTitle(
        cluster.label,
        cluster.assets.length,
        cluster.alarms
      );
      this.clusterBounds.set(cluster.id, cluster.assets);
    }
    for (const [id, entry] of this.clusterMarkers) {
      if (wanted.has(id)) continue;
      entry.marker.remove();
      this.clusterMarkers.delete(id);
      this.clusterBounds.delete(id);
    }
  }

  /** Zoom the view onto a badge's members, which splits it into smaller badges. */
  private zoomToCluster(id: string): void {
    const members = this.clusterBounds.get(id);
    if (!members || members.length === 0) return;
    const bounds = boundsOf(
      members.map((asset) => ({ lat: asset.lat, lon: asset.lon }))
    );
    if (bounds) this.fitBounds(bounds);
  }

  private syncMarker(asset: Asset, labelled: boolean, map: MapLibreMap): void {
    let entry = this.assetMarkers.get(asset.id);
    if (!entry) {
      const element = document.createElement('div');
      element.className = 'marker';
      element.addEventListener('click', (event) => {
        // Without this the map's own click handler would also fire and, in
        // place-asset mode, drop a new asset on top of the one just clicked.
        event.stopPropagation();
        this.emitSelect('asset', asset.id);
      });
      element.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        this.dispatchEvent(
          new CustomEvent('wui:open', {
            detail: { kind: 'asset', id: asset.id },
            bubbles: true,
            composed: true
          })
        );
      });
      const marker = new maplibregl.Marker({ element, anchor: 'bottom' })
        .setLngLat([asset.lon, asset.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const { lng, lat } = marker.getLngLat();
        this.dispatchEvent(
          new CustomEvent('wui:move', {
            detail: { id: asset.id, lat, lon: lng },
            bubbles: true,
            composed: true
          })
        );
      });
      entry = { marker, element };
      this.assetMarkers.set(asset.id, entry);
    }
    entry.marker.setLngLat([asset.lon, asset.lat]);
    entry.marker.setDraggable(this.editable);
    const alarmColor = this.live.alarmColors.get(alarmKey(asset.dp)) ?? '';
    entry.element.classList.toggle('selected', asset.id === this.selectedAsset);
    entry.element.classList.toggle('in-alarm', alarmColor !== '');
    entry.element.classList.toggle('draggable', this.editable);
    entry.element.style.setProperty(
      '--marker-alarm',
      alarmColor || 'transparent'
    );
    entry.element.title = `${asset.name} — ${assetKindLabel(asset.kind)}`;
    render(this.markerTemplate(asset, labelled), entry.element);
  }

  /**
   * The marker's content: the kind's glyph, and — only when the disc stands alone —
   * the name and on-map values. The plate is dropped rather than shrunk when the disc
   * has neighbours: overlapping text is less readable than no text, and the name is
   * still one hover (the element's `title`) or one click away in the inspector.
   */
  private markerTemplate(asset: Asset, labelled: boolean): TemplateResult {
    const shown = asset.readings.filter((reading) => reading.onMap);
    return html`
      <span class="pin"
        ><ix-icon name=${assetIcon(asset.kind)} size="16"></ix-icon
      ></span>
      ${
        labelled
          ? html`<span class="plate">
              <span class="name">${asset.name}</span>
              ${
                shown.length === 0
                  ? ''
                  : html`<span class="values"
                      >${shown.map(
                        (reading) =>
                          html`<span class="value"
                            >${reading.label ? html`<span class="cap">${reading.label}</span>` : ''}${formatValue(
                              this.live.values.get(normDp(reading.dp)),
                              reading.decimals
                            )}${reading.unit ? html`<span class="unit">${reading.unit}</span>` : ''}</span
                          >`
                      )}</span
                    >`
              }
            </span>`
          : ''
      }
    `;
  }

  // --- interaction -----------------------------------------------------------

  private onMapClick(event: MapMouseEvent): void {
    const { lng, lat } = event.lngLat;
    if (this.tool === 'place-asset') {
      this.dispatchEvent(
        new CustomEvent('wui:place', {
          detail: { lat, lon: lng },
          bubbles: true,
          composed: true
        })
      );
      return;
    }
    if (this.tool === 'draw-area') {
      this.draft = [...this.draft, [lng, lat]];
      this.pushDraft();
      return;
    }
    // A click on the background clears the selection — the same gesture that
    // dismisses the inspector everywhere else in the dashboard.
    this.emitSelect('none', '');
  }

  private onAreaClick(
    features: { properties: Record<string, unknown> | null }[] | undefined
  ): void {
    if (this.tool !== 'select') return;
    const areaId = String(features?.[0]?.properties?.['areaId'] ?? '');
    if (areaId) this.emitSelect('area', areaId);
  }

  private emitSelect(kind: 'asset' | 'area' | 'none', id: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:select', {
        detail: { kind, id },
        bubbles: true,
        composed: true
      })
    );
  }

  /** Push the draft ring to the map and tell the host how many points it holds. */
  private pushDraft(): void {
    this.geoJsonSource(DRAFT_SOURCE)?.setData(draftCollection(this.draft));
    // `syncOverlays` runs on every render, so only announce a real change — a host
    // that acts on this event must not be woken by every unrelated repaint.
    if (this.draft.length === this.announcedDraft) return;
    this.announcedDraft = this.draft.length;
    this.dispatchEvent(
      new CustomEvent('wui:draft', {
        detail: { points: this.draft.length },
        bubbles: true,
        composed: true
      })
    );
  }

  private fitBounds(bounds: Bounds): void {
    const [west, south, east, north] = bounds;
    this.map?.fitBounds([west, south, east, north], {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      duration: MOVE_DURATION
    });
  }

  private setCursor(cursor: string): void {
    const canvas = this.map?.getCanvas();
    if (canvas) canvas.style.cursor = cursor;
  }

  /**
   * The themed colour the `none` basemap paints, resolved from the shell's tokens.
   * MapLibre paints into WebGL and cannot read a CSS variable, so the token has to
   * be computed here; the literal is only reached before the shell's theme applies.
   */
  private backgroundColor(): string {
    const computed = getComputedStyle(this)
      .getPropertyValue('--theme-color-2')
      .trim();
    return computed || '#20232a';
  }
}

/**
 * A badge's content: **how many of its assets are in alarm, and nothing at all when none
 * are**.
 *
 * The member count was there first and has been dropped on purpose. Zoomed out, an
 * operator is not asking how many things are inside a bubble — that number changes with
 * every pan and cannot be acted on. They are asking *where the trouble is*, and a map whose
 * badges each carry a large neutral number reads as noise the eye has to filter before it
 * can find the one badge that matters. Silent means nothing to do; a figure means go there.
 *
 * The count is not lost: it stays in the badge's tooltip, next to the alarm figure.
 */
function clusterTemplate(cluster: Cluster): TemplateResult {
  if (cluster.alarms === 0) return html``;
  return html`<span class="alarms"
    ><ix-icon name="alarm-bell" size="16"></ix-icon>${cluster.alarms}</span
  >`;
}

/**
 * True when a blocked URI and the configured basemap URL point at the same host, so
 * only a violation caused by *this map* is reported. The basemap URL is a template
 * (`{z}/{x}/{y}`), which is not a valid URL, so both sides are compared by origin —
 * and a template with no scheme (a relative, same-origin tile path) can never be the
 * cause, because the injected policy already allows `'self'`.
 */
function sameOrigin(blockedUri: string, configuredUrl: string): boolean {
  try {
    return new URL(blockedUri).origin === new URL(configuredUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Alarm-colour map key for an asset's primary binding. Widened from element to
 * datapoint exactly as `alarmDps` keyed it — the alert config lives on the DP.
 */
function alarmKey(dp: string): string {
  const name = dp.trim();
  return name ? normDp(bareDp(name)) : '';
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function mapStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      position: relative;
      min-height: 0;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      overflow: hidden;
    }
    .canvas {
      position: absolute;
      inset: 0;
      background: var(--theme-color-2);
    }

    /* MapLibre's controls carry their own palette; align them with the theme. */
    .maplibregl-ctrl-group {
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
    }
    .maplibregl-ctrl-group button + button {
      border-top-color: var(--theme-color-soft-bdr);
    }
    .maplibregl-ctrl-attrib,
    .maplibregl-ctrl-scale {
      background: color-mix(in srgb, var(--theme-color-1) 82%, transparent);
      color: var(--theme-color-soft-text);
    }
    .maplibregl-ctrl-attrib a {
      color: var(--theme-color-soft-text);
    }
    .maplibregl-ctrl-scale {
      border-color: var(--theme-color-soft-bdr);
    }

    /* --- asset marker ------------------------------------------------------ */
    .marker {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.125rem;
      cursor: pointer;
      /* The label must not swallow clicks meant for the map underneath it. */
      pointer-events: auto;
      user-select: none;
    }
    .marker.draggable {
      cursor: grab;
    }
    .marker .pin {
      display: grid;
      place-items: center;
      width: 1.75rem;
      height: 1.75rem;
      border-radius: 50%;
      color: var(--theme-color-inv-text, #fff);
      background: var(--theme-color-primary);
      border: 2px solid var(--theme-color-1);
      box-shadow: 0 1px 4px rgb(0 0 0 / 45%);
      order: 2;
    }
    .marker .plate {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.0625rem 0.3125rem;
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-1) 88%, transparent);
      border: 1px solid var(--theme-color-soft-bdr);
      font-size: 0.6875rem;
      line-height: 1.25;
      white-space: nowrap;
      order: 1;
    }
    .marker .name {
      color: var(--theme-color-std-text);
      font-weight: 600;
    }
    .marker .values {
      display: flex;
      gap: 0.375rem;
      color: var(--theme-color-soft-text);
      font-variant-numeric: tabular-nums;
    }
    .marker .cap,
    .marker .unit {
      opacity: 0.7;
    }
    .marker .cap {
      margin-right: 0.1875rem;
    }
    .marker .unit {
      margin-left: 0.125rem;
    }

    /* In alarm: the halo and the pin take the colour WinCC OA computed for the
       alert state, so the map agrees with the alarm list by construction. */
    .marker.in-alarm .pin {
      background: var(--marker-alarm);
      box-shadow:
        0 0 0 4px color-mix(in srgb, var(--marker-alarm) 38%, transparent),
        0 1px 4px rgb(0 0 0 / 45%);
    }
    .marker.in-alarm .plate {
      border-color: var(--marker-alarm);
    }
    .marker.selected .pin {
      outline: 2px solid var(--theme-color-primary);
      outline-offset: 3px;
    }
    .marker.selected .plate {
      background: var(--theme-color-1);
    }

    /* --- cluster badge ------------------------------------------------------ */
    /* Twice the asset disc (1.75rem): a badge stands for several assets, so it has to
       read as the heavier object. It keeps that size when it carries no figure —
       the disc itself is what says "a group of assets is folded in here". */
    .cluster {
      display: grid;
      place-items: center;
      min-width: 3.5rem;
      height: 3.5rem;
      padding: 0 0.5rem;
      border-radius: 999px;
      border: 2px solid var(--theme-color-1);
      background: var(--theme-color-4, var(--theme-color-component-1));
      color: var(--theme-color-std-text);
      font: inherit;
      font-size: 1.125rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      line-height: 1.05;
      box-shadow: 0 1px 6px rgb(0 0 0 / 45%);
      cursor: pointer;
      user-select: none;
    }
    .cluster:hover {
      background: var(--theme-color-primary);
      color: var(--theme-color-inv-text, #fff);
    }
    /* An area badge wears its area's colour; the site badge is a step larger again,
       because at that altitude it is the only thing on the map. */
    .cluster.kind-area {
      border-color: var(--cluster-color);
      background: color-mix(
        in srgb,
        var(--cluster-color) 30%,
        var(--theme-color-1)
      );
    }
    .cluster.kind-site {
      min-width: 4.25rem;
      height: 4.25rem;
      font-size: 1.375rem;
    }
    .cluster.has-alarms {
      border-color: var(--theme-color-alarm);
      background: color-mix(
        in srgb,
        var(--theme-color-alarm) 26%,
        var(--theme-color-1)
      );
    }
    /* The alarm figure is now the badge's only content, so it wears the badge's own
       type size rather than sitting beneath a count that is no longer drawn. */
    .cluster .alarms {
      display: inline-flex;
      align-items: center;
      gap: 0.125rem;
      font-weight: 700;
      color: var(--theme-color-alarm);
    }
    .cluster.has-alarms:hover .alarms {
      color: var(--theme-color-inv-text, #fff);
    }
    .cluster:focus-visible {
      outline: 2px solid
        var(--theme-color-focus-bdr, var(--theme-color-primary));
      outline-offset: 2px;
    }

    /* --- outline editing handles -------------------------------------------- */
    .handle {
      padding: 0;
      border-radius: 50%;
      background: var(--theme-color-1);
      box-shadow: 0 1px 3px rgb(0 0 0 / 45%);
      cursor: pointer;
      font: inherit;
      user-select: none;
    }
    /* A corner: solid, grabbable, and visibly the thing that moves. */
    .handle.vertex {
      width: 0.875rem;
      height: 0.875rem;
      border: 2px solid var(--theme-color-primary);
      cursor: grab;
    }
    .handle.vertex:hover {
      background: var(--theme-color-primary);
    }
    /* Protected: the ring is down to a triangle, so this corner cannot be removed. */
    .handle.vertex.locked {
      border-color: var(--theme-color-soft-text);
    }
    /* A midpoint: hollow and smaller, so it never reads as a corner. */
    .handle.midpoint {
      width: 0.625rem;
      height: 0.625rem;
      border: 1px dashed var(--theme-color-primary);
      background: color-mix(in srgb, var(--theme-color-1) 55%, transparent);
    }
    .handle.midpoint:hover {
      border-style: solid;
      background: var(--theme-color-1);
    }

    /* --- area name tooltip -------------------------------------------------- */
    .area-tip {
      padding: 0.0625rem 0.375rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr, var(--theme-color-4));
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      white-space: nowrap;
      box-shadow: 0 1px 6px rgb(0 0 0 / 45%);
      user-select: none;
    }
  `;
}
