// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * GIS — Standalone page (WinCC OA WebUI Runtime).
 *
 * Map-based supervision, on MapLibre GL over OpenStreetMap (both BSD/ODbL — no
 * licence cost), and the shell + router for it:
 *  - `/gis` → the overview of every site, which is also the multi-site view
 *    (`gis-site-table`, with a live "in alarm" count per site)
 *  - `/gis/:siteid` → one site's map (`gis-map`) with its inspector
 *
 * Each site is persisted as one WinCC OA datapoint (auto-created DP type `GIS_Site`)
 * via {@link GisStore}. The route param `:siteid` is delivered as the `siteid`
 * attribute by the router (see WebuiIXRoutesService.applyAttributes), and navigation
 * uses `RouterEvent`, so the router recreates the element per route — which is what
 * gives the map a clean WebGL lifecycle.
 *
 * **The drill-down.** map → area → asset → the view that explains it. Selecting an
 * area zooms to it and narrows the asset list; selecting an asset opens the
 * inspector; from there the asset's configured route opens its process or 3D view,
 * and its primary datapoint opens the Alarms page scoped to it. The target is config
 * rather than code because this dashboard has no single "process view" page — see
 * `./gis/drill.ts`.
 *
 * **What is live and what is stored.** Only bindings are stored. Values come from one
 * isolated `dpConnect` per datapoint element, and the alarm highlight is the DP's own
 * `_alert_hdl.._act_state_color`, so the map agrees with the alarm list by
 * construction (see `./gis/data/live.ts`).
 *
 * MapLibre is bundled into this page by `build:pages` (no CDN, no import map).
 */
import {
  hasRole$,
  registerModuleRoles,
  type AppModuleRoles
} from '@visuelconcept/wui-kit/data/app-security.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import {
  LitElement,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult
} from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import appSecurityRoles from './app-security.roles.json';
import { GisStore } from './gis/data/gis-store.js';
import { LiveBindings, normDp, type LiveState } from './gis/data/live.js';
import { demoSites } from './gis/data/demo.js';
import {
  baseName,
  exportSiteGeoJson,
  exportSiteJson,
  exportSitesJson,
  ImportError,
  parseImport,
  type ImportResult
} from './gis/data/io.js';
import { AREA_PALETTE } from './gis/ai-context.js';
import {
  applySitePatch,
  replacePatchOf,
  type SitePatch
} from './gis/data/site-patch.js';
import { bareDp } from './gis/drill.js';
import {
  MSG,
  alarmCountMsg,
  assetCountMsg,
  confirmDeleteSiteMsg,
  localize,
  localizeDir
} from './gis/i18n.js';
import { isEmbedded, nowLocal, uid } from './gis/page-utils.js';
import './gis/ui/gis-ai-assistant.js';
import './gis/ui/gis-area-panel.js';
import './gis/ui/gis-inspector.js';
import './gis/ui/gis-site-dialog.js';
import './gis/ui/gis-site-table.js';
import './gis/ui/gis-map.js';
import type { GisMap, MapTool } from './gis/ui/gis-map.js';
import { nextAreaColor, pageStyles } from './gis/ui/page-styles.js';
import { MIN_RING } from './gis/map/style.js';
import {
  areaAt,
  blankArea,
  isValidLatLon,
  type Area,
  type Asset,
  type Site
} from './gis/types.js';

/**
 * Localise an import failure. `io.ts` throws a problem CODE rather than a string, so the
 * layering stays right — the data module knows what went wrong, the page knows how to say it.
 */
function importMessage(error: unknown): string {
  if (error instanceof ImportError) {
    return localize(
      error.problem === 'not-json' ? MSG.io.notJson : MSG.io.noSite
    );
  }
  return error instanceof Error ? error.message : localize(MSG.io.importFailed);
}

/** Application-Security module id (= the page id). */
const MODULE_ID = 'gis';

/** Page header config — the shell renders the title from it. */
const HEADER_CONFIG = {
  headerTitle: { context: 'translate', config: MSG.page.title },
  headerSubtitle: { context: 'translate', config: MSG.page.subtitle }
} as const;

/** The two authoring tools, named — the toolbar reads each state more than once. */
const TOOL_ASSET: MapTool = 'place-asset';
const TOOL_AREA: MapTool = 'draw-area';

export class WuiGis extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  /** Route param `/gis/:siteid` → the displayed site (overview when absent). */
  @property({ attribute: 'siteid' }) siteId = '';

  @state() private sites: Site[] = [];
  @state() private loading = true;
  @state() private offline = false;
  @state() private editing = false;
  @state() private tool: MapTool = 'select';
  @state() private selectedAsset = '';
  @state() private selectedArea = '';
  /** Restrict the map and the count to the assets currently in alarm. */
  @state() private alarmsOnly = false;
  /**
   * Group the quiet assets into count badges when the map is zoomed out, so their
   * markers stop overlapping. **On by default** — a site of any size is unreadable
   * zoomed out without it. Assets in alarm are never grouped.
   */
  @state() private declutter = true;
  /** Area whose outline is being reshaped on the map; empty for none. */
  @state() private editingRing = '';
  /**
   * Area the draw tool is drawing an outline FOR. Empty means the draft ring becomes a
   * brand-new area, which is what the toolbar's own "Draw an area" does.
   */
  @state() private drawForArea = '';
  /** Points in the ring being drawn — drives the "Close the area" button. */
  @state() private draftPoints = 0;
  /** Site being created (`null`) or edited (a site); `undefined` = dialog closed. */
  @state() private editingSite: Site | null | undefined = undefined;
  @state() private deletingId = '';
  /** Why the last import was refused, shown on the overview. */
  @state() private importError = '';
  @state() private tilesFailed = false;
  /** The basemap host is refused by the page's CSP — a more specific cause than above. */
  @state() private cspBlocked = false;
  @state() private webglFailed = false;
  /** Live values + alarm colours, as a fresh snapshot per change. */
  @state() private live: LiveState = {
    values: new Map(),
    alarmColors: new Map()
  };

  /** Application-Security grant for the 'view' role (open until assigned). */
  @state() private roleView = true;
  /** Application-Security grant for the 'edit' role (open until assigned). */
  @state() private canEdit = true;

  private readonly store = new GisStore();
  private readonly bindings = new LiveBindings(this.onLiveChange.bind(this));
  private roleSub = new Subscription();
  /** Site state captured when entering edit mode — the audit baseline of the save. */
  private auditBaseline: Site | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles (docs/wui-app-security/INTEGRATION.md).
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$(MODULE_ID, 'view').subscribe(
      (granted) => (this.roleView = granted)
    );
    this.roleSub.add(
      hasRole$(MODULE_ID, 'edit').subscribe((granted) => {
        this.canEdit = granted;
        // Close an editor opened before the grant was revoked.
        if (!granted && this.editing) this.setEditing(false);
      })
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.bindings.dispose();
    this.roleSub.unsubscribe();
  }

  override render(): TemplateResult {
    if (!this.roleView)
      return html`<div class="page">
        <div class="center">${localizeDir(MSG.page.forbidden)}</div>
      </div>`;
    if (isEmbedded()) return this.renderEmbedded();
    return html`
      <div class="page">
        <wui-context-generator .config=${HEADER_CONFIG}>
          <wui-content-header></wui-content-header>
        </wui-context-generator>
        <div class="body">
          ${this.offline ? html`<div class="notice"><ix-icon name="info" size="16"></ix-icon>${localizeDir(MSG.page.offline)}</div>` : nothing}
          ${this.renderMain()}
        </div>
      </div>
      ${this.renderDialogs()}
    `;
  }

  protected override firstUpdated(): void {
    void this.refresh();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('siteId')) {
      // Leaving a site drops everything scoped to it, including the edit session.
      this.editing = false;
      this.tool = 'select';
      this.selectedAsset = '';
      this.selectedArea = '';
      this.alarmsOnly = false;
      this.editingRing = '';
      this.drawForArea = '';
      this.tilesFailed = false;
      this.cspBlocked = false;
    }
  }

  protected override updated(): void {
    // Idempotent: only re-subscribes when the set of bound names actually changed.
    // On a site's map, follow everything that site shows. On the overview, follow
    // only the alarm state of every site — that is what its "in alarm" column needs,
    // and subscribing to every reading of every site would be a needless flood.
    const site = this.currentSite();
    this.bindings.sync(
      site
        ? { values: [site], alarms: [site] }
        : { values: [], alarms: this.sites }
    );
  }

  /** A new live snapshot: a fresh identity, which is what makes the views repaint. */
  private onLiveChange(): void {
    this.live = this.bindings.snapshot();
  }

  /** A Mosaic tile: the map alone, read-only, no chrome and no inspector. */
  private renderEmbedded(): TemplateResult {
    const site = this.currentSite();
    if (!site)
      return html`<div class="center">${localizeDir(MSG.page.loading)}</div>`;
    return html`<gis-map
      class="embedded"
      .site=${site}
      .live=${this.live}
    ></gis-map>`;
  }

  private renderDialogs(): TemplateResult {
    return html`
      ${
        this.editingSite === undefined
          ? nothing
          : html`<gis-site-dialog
              .site=${this.editingSite}
              @wui:save=${(event: CustomEvent<Site>) => void this.onSiteSave(event.detail)}
              @wui:cancel=${() => (this.editingSite = undefined)}
            ></gis-site-dialog>`
      }
      ${
        this.deletingId
          ? html`<wui-confirm-dialog
              message=${confirmDeleteSiteMsg(this.siteName(this.deletingId))}
              @wui:confirm=${() => void this.onDeleteConfirm()}
              @wui:cancel=${() => (this.deletingId = '')}
            ></wui-confirm-dialog>`
          : nothing
      }
    `;
  }

  private renderMain(): TemplateResult {
    if (this.loading)
      return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const site = this.currentSite();
    if (!site) return this.renderOverview();
    return this.renderSite(site);
  }

  // --- overview --------------------------------------------------------------

  private renderOverview(): TemplateResult {
    return html`
      <div class="overview-tools">
        ${
          this.importError
            ? html`<div class="notice warn">
                <ix-icon name="warning" size="16"></ix-icon>${this.importError}
              </div>`
            : nothing
        }
        <span class="grow"></span>
        ${
          this.canEdit
            ? html`<ix-button
                variant="secondary"
                title=${localize(MSG.io.importHint)}
                @click=${this.pickImportFile}
              >
                <ix-icon name="upload" slot="icon"></ix-icon
                >${localizeDir(MSG.io.importLabel)}
              </ix-button>`
            : nothing
        }
        <ix-button
          variant="secondary"
          ?disabled=${this.sites.length === 0}
          title=${localize(MSG.io.exportJsonHint)}
          @click=${() => exportSitesJson(this.sites)}
        >
          <ix-icon name="download" slot="icon"></ix-icon
          >${localizeDir(MSG.io.exportAll)}
        </ix-button>
        ${this.canEdit ? this.renderAssistant(null) : nothing}
      </div>
      <input
        class="import-input"
        type="file"
        accept="application/json,application/geo+json,.json,.geojson"
        hidden
        @change=${this.onImportFile}
      />
      <gis-site-table
        .sites=${this.sites}
        .live=${this.live}
        .canEdit=${this.canEdit}
        .canSeed=${this.sites.length === 0}
        @wui:open=${(event: CustomEvent<{ id: string }>) => this.navigate(event.detail.id)}
        @wui:create=${() => (this.editingSite = null)}
        @wui:seed=${() => void this.seedDemo()}
        @wui:edit=${(event: CustomEvent<{ id: string }>) => (this.editingSite = this.siteById(event.detail.id) ?? null)}
        @wui:delete=${(event: CustomEvent<{ id: string }>) => (this.deletingId = event.detail.id)}
      ></gis-site-table>
    `;
  }

  /**
   * The AI assistant, gated on the `edit` role: it exists to author sites, so it has no
   * business being offered to someone who cannot save one. It renders nothing at all
   * unless the deploy enabled the assistant feature.
   *
   * `site` is the one a proposal patches — `null` on the overview, where applying
   * creates a new site instead of completing an open one. It is handed over whole: the
   * assistant sends it to the model as context AND previews the patch against it.
   */
  private renderAssistant(site: Site | null): TemplateResult {
    return html`<wui-gis-ai-assistant
      .site=${site}
      .siteNames=${this.sites.map((candidate) => candidate.name)}
      @wui:applysite=${(event: CustomEvent<SitePatch>) => void this.onApplyProposal(event.detail, site)}
    ></wui-gis-ai-assistant>`;
  }

  // --- one site --------------------------------------------------------------

  private renderSite(site: Site): TemplateResult {
    const visible = this.visibleAssetIds(site);
    return html`
      ${this.renderToolbar(site, visible.size)}
      ${this.webglFailed ? html`<div class="notice warn"><ix-icon name="warning" size="16"></ix-icon>${localizeDir(MSG.map.webglFailed)}</div>` : nothing}
      ${this.renderBasemapNotice()}
      ${
        site.assets.length === 0 && !this.editing
          ? html`<div class="notice">
              <ix-icon name="info" size="16"></ix-icon
              >${localizeDir(MSG.map.emptySite)}
            </div>`
          : nothing
      }
      <div class="split">
        <gis-map
          id="map"
          .site=${site}
          .live=${this.live}
          .visibleAssets=${this.alarmsOnly || this.selectedArea ? visible : null}
          selectedAsset=${this.selectedAsset}
          selectedArea=${this.selectedArea}
          tool=${this.tool}
          .editable=${this.editing}
          .declutter=${this.declutter}
          editingRing=${this.editingRing}
          @wui:ring=${(
            event: CustomEvent<{ areaId: string; ring: [number, number][] }>
          ) => this.onRingChange(site, event.detail)}
          @wui:select=${this.onMapSelect}
          @wui:open=${this.onMapOpen}
          @wui:place=${(event: CustomEvent<{ lat: number; lon: number }>) => this.onPlace(site, event.detail)}
          @wui:move=${(event: CustomEvent<{ id: string; lat: number; lon: number }>) => this.onMove(site, event.detail)}
          @wui:draft=${(event: CustomEvent<{ points: number }>) => (this.draftPoints = event.detail.points)}
          @wui:tilesfailed=${() => (this.tilesFailed = true)}
          @wui:cspblocked=${() => (this.cspBlocked = true)}
          @wui:webglfailed=${() => (this.webglFailed = true)}
        ></gis-map>
        ${this.renderPanel(site)}
      </div>
    `;
  }

  /**
   * The side panel for whatever is selected. An area and an asset are different
   * objects, so each has its own panel; both speak the same events, so the handlers
   * below are shared.
   */
  private renderPanel(site: Site): TemplateResult {
    const area = this.selectedAreaOf(site);
    if (area) {
      return html`<gis-area-panel
        .site=${site}
        .area=${area}
        .live=${this.live}
        .editable=${this.editing}
        @wui:patch=${(event: CustomEvent<{ area?: Area }>) => this.onPatch(site, event.detail)}
        @wui:delete=${() => this.onDeleteSelection(site)}
        @wui:open=${(event: CustomEvent<{ route: string }>) => this.openRoute(event.detail.route)}
        .editingRing=${this.editingRing === area.id}
        @wui:editring=${() => this.toggleRingEditor(area.id)}
        @wui:drawring=${() => this.startDrawingFor(area.id)}
        @wui:select=${(event: CustomEvent<{ kind: 'asset'; id: string }>) => this.onCardSelect(event.detail.id)}
        @wui:zoomarea=${() => this.map()?.fitToArea(this.selectedArea)}
        @wui:close=${this.clearSelection}
      ></gis-area-panel>`;
    }
    return html`<gis-inspector
      .site=${site}
      .asset=${this.selectedAssetOf(site)}
      .live=${this.live}
      .editable=${this.editing}
      @wui:patch=${(event: CustomEvent<{ asset?: Asset }>) => this.onPatch(site, event.detail)}
      @wui:delete=${() => this.onDeleteSelection(site)}
      @wui:open=${(event: CustomEvent<{ route: string }>) => this.openRoute(event.detail.route)}
      @wui:close=${this.clearSelection}
    ></gis-inspector>`;
  }

  /**
   * Why the basemap is missing, when it is. A CSP block and an unreachable tile
   * server both surface as a failed fetch, but they are fixed in completely
   * different places — so the CSP cause wins whenever it is the one detected.
   */
  private renderBasemapNotice(): TemplateResult | typeof nothing {
    if (this.cspBlocked) return this.warnNotice(MSG.map.cspBlocked);
    if (this.tilesFailed) return this.warnNotice(MSG.map.tilesFailed);
    return nothing;
  }

  private warnNotice(message: MultiLangString): TemplateResult {
    return html`<div class="notice warn">
      <ix-icon name="warning" size="16"></ix-icon>${localizeDir(message)}
    </div>`;
  }

  private renderToolbar(site: Site, shown: number): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-button
          variant="secondary"
          ghost
          @click=${() => this.dispatchEvent(new RouterEvent('/gis'))}
        >
          <ix-icon name="chevron-left" slot="icon"></ix-icon
          >${localizeDir(MSG.map.back)}
        </ix-button>
        <span class="site-name">${site.name}</span>
        ${this.renderAreaFilter(site)}
        <ix-button
          variant=${this.alarmsOnly ? 'primary' : 'secondary'}
          @click=${() => (this.alarmsOnly = !this.alarmsOnly)}
        >
          <ix-icon name="alarm-bell" slot="icon"></ix-icon
          >${localizeDir(MSG.map.alarmsOnly)}
        </ix-button>
        <ix-button
          variant=${this.declutter ? 'primary' : 'secondary'}
          title=${localize(MSG.map.declutterHint)}
          @click=${() => (this.declutter = !this.declutter)}
        >
          <ix-icon name="tiles" slot="icon"></ix-icon
          >${localizeDir(MSG.map.declutter)}
        </ix-button>
        <span class="count">${assetCountMsg(shown, site.assets.length)}</span>
        ${this.renderAlarmSynthesis(site)}
        <span class="grow"></span>
        <ix-icon-button
          ghost
          icon="zoom-in"
          title=${localize(MSG.map.fit)}
          @click=${() => this.map()?.fitToSite()}
        ></ix-icon-button>
        <ix-icon-button
          ghost
          icon="download"
          title=${localize(MSG.io.exportJson)}
          @click=${() => exportSiteJson(site)}
        ></ix-icon-button>
        <ix-icon-button
          ghost
          icon="earth"
          title=${localize(MSG.io.exportGeoJson)}
          @click=${() => exportSiteGeoJson(site)}
        ></ix-icon-button>
        ${
          this.canEdit
            ? html`<ix-icon-button
                ghost
                icon="upload"
                title=${localize(MSG.io.geoJsonReplaces)}
                @click=${this.pickImportFile}
              ></ix-icon-button>`
            : nothing
        }
        ${this.canEdit ? this.renderAssistant(site) : nothing}
        ${this.renderEditControls(site)}
      </div>
      ${this.editing ? this.renderEditHint() : nothing}
    `;
  }

  /**
   * How many assets of the site are in alarm. This is the synthesis that makes the
   * grouped view honest: badges hide the quiet assets, so the count of the ones that
   * matter has to be readable without counting markers. Absent when nothing is in alarm.
   */
  private renderAlarmSynthesis(site: Site): TemplateResult | typeof nothing {
    const count = site.assets.filter((asset) => this.isInAlarm(asset)).length;
    if (count === 0) return nothing;
    return html`<button
      class="alarm-synthesis"
      type="button"
      title=${localize(MSG.map.alarmsOnly)}
      @click=${() => (this.alarmsOnly = true)}
    >
      <ix-icon name="alarm-bell" size="12"></ix-icon>${alarmCountMsg(count)}
    </button>`;
  }

  private renderAreaFilter(site: Site): TemplateResult | typeof nothing {
    if (site.areas.length === 0) return nothing;
    return html`
      <ix-select
        class="area-filter"
        .value=${this.selectedArea}
        @valueChange=${(event: CustomEvent<string | string[]>) => this.onAreaFilter(event.detail)}
      >
        <ix-select-item
          value=""
          label=${localize(MSG.map.allAreas)}
        ></ix-select-item>
        ${site.areas.map((area) => html`<ix-select-item value=${area.id} label=${area.name}></ix-select-item>`)}
      </ix-select>
    `;
  }

  private renderEditControls(site: Site): TemplateResult | typeof nothing {
    if (!this.canEdit) return nothing;
    if (!this.editing) {
      return html`
        <ix-icon-button
          ghost
          icon="cogwheel"
          title=${localize(MSG.overview.rename)}
          @click=${() => (this.editingSite = site)}
        ></ix-icon-button>
        <ix-button variant="secondary" @click=${() => this.setEditing(true)}>
          <ix-icon name="pen" slot="icon"></ix-icon>${localizeDir(MSG.map.edit)}
        </ix-button>
      `;
    }
    return html`
      <ix-button
        variant=${this.tool === TOOL_ASSET ? 'primary' : 'secondary'}
        @click=${() => this.setTool(TOOL_ASSET)}
      >
        <ix-icon name="location" slot="icon"></ix-icon
        >${localizeDir(MSG.map.addAsset)}
      </ix-button>
      <ix-button
        variant=${this.tool === TOOL_AREA ? 'primary' : 'secondary'}
        @click=${() => this.setTool(TOOL_AREA)}
      >
        <ix-icon name="map" slot="icon"></ix-icon
        >${localizeDir(MSG.map.drawArea)}
      </ix-button>
      ${
        this.tool === TOOL_AREA
          ? html`<ix-button
                ?disabled=${this.draftPoints < MIN_RING}
                @click=${() => this.finishArea(site)}
              >
                <ix-icon name="check" slot="icon"></ix-icon
                >${localizeDir(MSG.map.finishArea)}
              </ix-button>
              <ix-button
                variant="secondary"
                ghost
                @click=${() => this.cancelDraw()}
                >${localizeDir(MSG.map.cancel)}</ix-button
              >`
          : nothing
      }
      <ix-button @click=${() => this.setEditing(false)}>
        <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.map.done)}
      </ix-button>
    `;
  }

  private renderEditHint(): TemplateResult | typeof nothing {
    if (this.editingRing)
      return html`<div class="hint">${localizeDir(MSG.ring.hint)}</div>`;
    if (this.drawForArea)
      return html`<div class="hint">${localizeDir(MSG.ring.drawHint)}</div>`;
    if (this.tool === TOOL_ASSET)
      return html`<div class="hint">${localizeDir(MSG.map.addAssetHint)}</div>`;
    if (this.tool === TOOL_AREA)
      return html`<div class="hint">${localizeDir(MSG.map.drawAreaHint)}</div>`;
    return nothing;
  }

  // --- data ------------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    try {
      this.sites = await this.store.listSites();
    } finally {
      this.offline = this.store.offline;
      this.loading = false;
    }
  }

  /**
   * Apply an AI proposal — a {@link SitePatch}, merged HERE rather than in the assistant.
   *
   * The merge happens at click time against the site as it stands now, so an answer that
   * has been sitting in the conversation while the user kept editing cannot resurrect a
   * stale version of it. `applySitePatch` preserves everything the patch does not mention
   * (datapoint bindings above all), and only `mode: "replace"` drops what it omits.
   *
   * On the overview it **creates** a new site and opens it. Inside a site it updates that
   * site's content in memory and drops the user into edit mode, so the draft is reviewed
   * and adjusted on the map before the usual "Done" writes it — an approximate set of
   * coordinates must never reach a datapoint unseen.
   *
   * The site's own identity (id, backing DP, basemap) is kept: the operator configured it,
   * the model did not.
   */
  private async onApplyProposal(
    patch: SitePatch,
    target: Site | null
  ): Promise<void> {
    if (!this.canEdit) return;
    const { site: draft } = applySitePatch(target, patch, AREA_PALETTE);
    if (!target) {
      const created = await this.store.createSite({
        ...draft,
        updatedAt: nowLocal()
      });
      this.sites = [...this.sites, created];
      this.offline = this.store.offline;
      this.navigate(created.id);
      return;
    }
    if (!this.editing) this.setEditing(true);
    this.clearSelection();
    this.patchSite(target, {
      name: draft.name,
      description: draft.description,
      category: draft.category,
      areas: draft.areas,
      assets: draft.assets,
      center: draft.center,
      zoom: draft.zoom
    });
    // Re-frame only when the patch itself asked to: on an additive patch the operator's
    // current view is deliberate, and yanking the map elsewhere loses their place.
    if (
      patch.site?.['center'] !== undefined ||
      patch.site?.['zoom'] !== undefined
    ) {
      this.map()?.fitToSite();
    }
  }

  /** Open the hidden file input — the only way to raise a file dialog from a click. */
  private pickImportFile(): void {
    this.importError = '';
    this.renderRoot.querySelector<HTMLInputElement>('.import-input')?.click();
  }

  /**
   * Import a file.
   *
   * A **native JSON** export carries whole sites, so it creates them. A **GeoJSON** layer is
   * geometry, so it fills the site that is open (through the very same apply path the AI
   * assistant uses — review on the map, then Done) and creates a new site when none is.
   * That is the point of the format here: draft with the assistant, then bring the surveyed
   * positions in from QGIS over the top.
   */
  private async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared straight away, so re-picking the same file fires `change` again.
    input.value = '';
    if (!file) return;
    this.importError = '';
    let result: ImportResult;
    try {
      result = parseImport(await file.text(), baseName(file.name));
    } catch (error) {
      this.importError = importMessage(error);
      return;
    }
    if (result.format === 'geojson') {
      const [imported] = result.sites;
      // A GeoJSON file IS the content — it replaces, unlike an assistant's patch.
      if (imported)
        await this.onApplyProposal(
          replacePatchOf(imported.site),
          this.currentSite()
        );
      return;
    }
    const created = await this.store.importDemo(
      result.sites.map(({ site }) => site)
    );
    this.sites = created.length > 0 ? await this.store.listSites() : this.sites;
    this.offline = this.store.offline;
  }

  /** Seed the two showcase sites into the project (or into memory when offline). */
  private async seedDemo(): Promise<void> {
    this.sites = await this.store.importDemo(demoSites());
    this.offline = this.store.offline;
  }

  private async onSiteSave(site: Site): Promise<void> {
    const existing = site.id ? this.siteById(site.id) : null;
    const stamped = { ...site, updatedAt: nowLocal() };
    if (existing) {
      await this.store.saveSite(stamped, {
        audit: true,
        auditBaseline: existing
      });
      this.sites = this.sites.map((candidate) =>
        candidate.id === stamped.id ? stamped : candidate
      );
    } else {
      const created = await this.store.createSite(stamped);
      this.sites = [...this.sites, created];
      this.navigate(created.id);
    }
    this.offline = this.store.offline;
    this.editingSite = undefined;
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    this.deletingId = '';
    if (!id) return;
    await this.store.deleteSite(id);
    this.sites = this.sites.filter((site) => site.id !== id);
    this.offline = this.store.offline;
    if (this.siteId === id) this.dispatchEvent(new RouterEvent('/gis'));
  }

  /**
   * Persist the site being edited. Called on leaving edit mode rather than on every
   * keystroke: dragging a marker or typing a name would otherwise write a datapoint
   * per event, and each write is an audit-trail record.
   */
  private async persist(site: Site): Promise<void> {
    const stamped = { ...site, updatedAt: nowLocal() };
    this.sites = this.sites.map((candidate) =>
      candidate.id === stamped.id ? stamped : candidate
    );
    await this.store.saveSite(stamped, {
      audit: true,
      auditBaseline: this.auditBaseline ?? undefined
    });
    this.offline = this.store.offline;
  }

  /** Apply an edit to the in-memory site; the write happens on "Done". */
  private patchSite(site: Site, part: Partial<Site>): Site {
    const next = { ...site, ...part };
    this.sites = this.sites.map((candidate) =>
      candidate.id === next.id ? next : candidate
    );
    return next;
  }

  // --- edit session ----------------------------------------------------------

  private setEditing(on: boolean): void {
    const site = this.currentSite();
    if (on) {
      if (!this.canEdit || !site) return;
      this.auditBaseline = structuredClone(site);
      this.editing = true;
      return;
    }
    this.editing = false;
    this.editingRing = '';
    this.drawForArea = '';
    this.setTool('select');
    if (site && this.auditBaseline) void this.persist(site);
    this.auditBaseline = null;
  }

  private setTool(tool: MapTool): void {
    // Re-pressing the active tool releases it; leaving the draw tool drops its ring.
    const next = this.tool === tool ? 'select' : tool;
    if (this.tool === TOOL_AREA && next !== TOOL_AREA) this.map()?.clearDraft();
    this.tool = next;
  }

  /**
   * Turn the outline editor on or off for one area. Selecting the area is part of turning
   * it on: the handles belong to a shape the user can see they have picked.
   */
  private toggleRingEditor(areaId: string): void {
    if (!this.editing) return;
    this.editingRing = this.editingRing === areaId ? '' : areaId;
    if (this.editingRing) {
      this.selectedArea = areaId;
      this.selectedAsset = '';
      this.setTool('select');
    }
  }

  /**
   * Draw an outline FOR an existing area — the case of an area that groups assets without
   * drawing anything (hand-made, or proposed by the assistant without a usable ring).
   */
  private startDrawingFor(areaId: string): void {
    if (!this.editing) return;
    this.editingRing = '';
    this.drawForArea = areaId;
    this.tool = TOOL_AREA;
  }

  /** A handle was dragged, inserted or removed: store the reshaped ring. */
  private onRingChange(
    site: Site,
    change: { areaId: string; ring: readonly (readonly [number, number])[] }
  ): void {
    if (!this.editing) return;
    this.patchSite(site, {
      areas: site.areas.map((area) =>
        area.id === change.areaId ? { ...area, ring: change.ring } : area
      )
    });
  }

  private cancelDraw(): void {
    this.map()?.clearDraft();
    this.tool = 'select';
  }

  private finishArea(site: Site): void {
    const ring = this.map()?.takeDraftRing();
    this.tool = 'select';
    const forArea = this.drawForArea;
    this.drawForArea = '';
    if (!ring) return;
    // Drawing an outline for an area that had none: fill that area rather than add one.
    if (forArea) {
      this.patchSite(site, {
        areas: site.areas.map((area) =>
          area.id === forArea ? { ...area, ring } : area
        )
      });
      this.selectedArea = forArea;
      this.selectedAsset = '';
      this.editingRing = forArea;
      return;
    }
    const id = uid('area');
    const area: Area = {
      ...blankArea(
        id,
        `${localize(MSG.area.createTitle)} ${site.areas.length + 1}`,
        nextAreaColor(site.areas.length)
      ),
      ring
    };
    this.patchSite(site, { areas: [...site.areas, area] });
    // Open it straight away: an area named "New area 3" needs renaming now, not later.
    this.selectedArea = id;
    this.selectedAsset = '';
  }

  private onPlace(site: Site, at: { lat: number; lon: number }): void {
    if (!this.editing || !isValidLatLon(at.lat, at.lon)) return;
    const id = uid('asset');
    const asset: Asset = {
      id,
      name: `${localize(MSG.inspector.title)} ${site.assets.length + 1}`,
      kind: 'generic',
      lat: at.lat,
      lon: at.lon,
      // Dropping a marker inside a drawn area is a statement of belonging.
      areaId: areaAt(site, at.lat, at.lon),
      dp: '',
      readings: [],
      link: '',
      notes: ''
    };
    this.patchSite(site, { assets: [...site.assets, asset] });
    this.selectedAsset = id;
    this.selectedArea = '';
    this.tool = 'select';
  }

  private onMove(
    site: Site,
    moved: { id: string; lat: number; lon: number }
  ): void {
    if (!this.editing) return;
    const assets = site.assets.map((asset) =>
      asset.id === moved.id
        ? {
            ...asset,
            lat: moved.lat,
            lon: moved.lon,
            areaId: areaAt(site, moved.lat, moved.lon)
          }
        : asset
    );
    this.patchSite(site, { assets });
  }

  private onPatch(site: Site, patch: { asset?: Asset; area?: Area }): void {
    if (patch.asset) {
      const edited = patch.asset;
      this.patchSite(site, {
        assets: site.assets.map((asset) =>
          asset.id === edited.id ? edited : asset
        )
      });
      return;
    }
    if (patch.area) {
      const edited = patch.area;
      this.patchSite(site, {
        areas: site.areas.map((area) => (area.id === edited.id ? edited : area))
      });
    }
  }

  private onDeleteSelection(site: Site): void {
    if (!this.editing) return;
    if (this.selectedAsset) {
      const id = this.selectedAsset;
      this.selectedAsset = '';
      this.patchSite(site, {
        assets: site.assets.filter((asset) => asset.id !== id)
      });
      return;
    }
    if (!this.selectedArea) return;
    const id = this.selectedArea;
    this.selectedArea = '';
    // The area's assets outlive it; they only lose their grouping.
    this.patchSite(site, {
      areas: site.areas.filter((area) => area.id !== id),
      assets: site.assets.map((asset) =>
        asset.areaId === id ? { ...asset, areaId: '' } : asset
      )
    });
  }

  // --- selection & navigation ------------------------------------------------

  private onMapSelect(
    event: CustomEvent<{ kind: 'asset' | 'area' | 'none'; id: string }>
  ): void {
    const { kind, id } = event.detail;
    if (kind === 'asset') {
      this.selectedAsset = this.selectedAsset === id ? '' : id;
      this.selectedArea = '';
      return;
    }
    if (kind === 'area') {
      this.selectedArea = this.selectedArea === id ? '' : id;
      this.selectedAsset = '';
      if (this.selectedArea) this.map()?.fitToArea(this.selectedArea);
      return;
    }
    this.clearSelection();
  }

  /**
   * An asset card in the area panel was clicked: open that asset. The map pans to it as
   * well, because the card said what the asset reads and the obvious next question is
   * where it is — the panel is about to be replaced by the inspector, so the map has to
   * answer that.
   */
  private onCardSelect(assetId: string): void {
    this.selectedAsset = assetId;
    this.selectedArea = '';
    this.editingRing = '';
    this.map()?.panToAsset(assetId);
  }

  /** Double-click on a marker: straight to the asset's configured target view. */
  private onMapOpen(event: CustomEvent<{ kind: string; id: string }>): void {
    const site = this.currentSite();
    if (!site || event.detail.kind !== 'asset') return;
    const asset = site.assets.find(
      (candidate) => candidate.id === event.detail.id
    );
    if (asset?.link) this.openRoute(asset.link);
  }

  private onAreaFilter(detail: string | string[]): void {
    const id = Array.isArray(detail) ? (detail[0] ?? '') : detail;
    this.selectedArea = id;
    this.selectedAsset = '';
    if (id) this.map()?.fitToArea(id);
    else this.map()?.fitToSite();
  }

  private clearSelection(): void {
    this.selectedAsset = '';
    this.selectedArea = '';
  }

  /** Drill-down: hand the route to the shell's router. */
  private openRoute(route: string): void {
    if (route.trim()) this.dispatchEvent(new RouterEvent(route.trim()));
  }

  private navigate(id: string): void {
    this.dispatchEvent(new RouterEvent(`/gis/${id}`));
  }

  // --- lookups ---------------------------------------------------------------

  private currentSite(): Site | null {
    return this.siteId ? (this.siteById(this.siteId) ?? null) : null;
  }

  private siteById(id: string): Site | undefined {
    return this.sites.find((site) => site.id === id);
  }

  private siteName(id: string): string {
    return this.siteById(id)?.name ?? id;
  }

  private selectedAssetOf(site: Site): Asset | null {
    return site.assets.find((asset) => asset.id === this.selectedAsset) ?? null;
  }

  private selectedAreaOf(site: Site): Area | null {
    return site.areas.find((area) => area.id === this.selectedArea) ?? null;
  }

  /** The assets the map and the count currently show (area filter, alarm filter). */
  private visibleAssetIds(site: Site): Set<string> {
    const ids = new Set<string>();
    for (const asset of site.assets) {
      if (this.selectedArea && asset.areaId !== this.selectedArea) continue;
      if (this.alarmsOnly && !this.isInAlarm(asset)) continue;
      ids.add(asset.id);
    }
    return ids;
  }

  private isInAlarm(asset: Asset): boolean {
    const dp = asset.dp.trim();
    if (!dp) return false;
    return Boolean(this.live.alarmColors.get(normDp(bareDp(dp))));
  }

  private map(): GisMap | null {
    return this.renderRoot.querySelector<GisMap>('#map');
  }
}

// Guarded registration: the page module may be imported more than once in a
// shared-chunk layout, and a duplicate `define` would throw.
if (!customElements.get('wui-gis')) {
  customElements.define('wui-gis', WuiGis);
}
