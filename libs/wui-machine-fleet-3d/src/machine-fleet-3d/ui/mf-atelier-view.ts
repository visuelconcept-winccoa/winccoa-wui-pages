// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * 3D view of a single atelier: the Three.js scene plus the integrated config UI
 * (building dialog, per-machine dialog with DP bindings, state-mapping dialog,
 * right drawer, detail card) and live datapoint binding.
 *
 * Driven by an `Atelier` object passed in by the page shell. Edits update local
 * working copies and emit a debounced `wui:save` carrying the full atelier; a
 * back button emits `wui:back`. The Three.js scene modules are reused as-is.
 *
 * Display-only mode (`display-only`, set by the public `<wui-fleet-3d-view>`
 * of src/fleet-view.ts — the SAME view, no second scene implementation): camera
 * navigation, live machine states, labels, machine selection and its detail
 * card, the machine list; no edit, no atelier management (rename / delete /
 * import / export / building / mappings / graphics catalog), no AI prompt, no
 * navigation away (no back button, no dashboard or custom links), never a
 * `wui:save` (the display toggles stay local). The stop-cause catalog then comes
 * from the host (`stopCauseCatalog`) instead of the store, so the view reads no
 * configuration datapoint itself. `hide-toolbar` / `hide-nav` hide the top bar
 * and the navigation pad + viewpoint bar (both modes); `fullscreen-button` adds
 * a full-screen toggle that emits `wui:fullscreen` (the embedding element
 * does the request), `fullscreenActive` picks its icon.
 *
 * Lifecycle: the WebGL scene, the resize / visibility observers and the live
 * `dpConnect` are created when the view is first rendered and released on
 * disconnect (`SceneController.dispose` → scene/dispose.ts, renderer disposed
 * and its context lost); a view connected again rebuilds them on a fresh canvas.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { DashboardService } from '@wincc-oa/wui-dashboard-data/services/dashboard/dashboard.service.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { Subscription, firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import {
  buildDashboardSettings,
  buildMachineWidgets,
  isMachineWidget
} from '../data/dashboard-export.js';
import { AliAssetReader, type AliAssetInfo } from '../data/ali-assets.js';
import { normDp, toNumber } from '../data/dp-utils.js';
import type { FleetStore } from '../data/fleet-store.js';
import { MSG, confirmDeleteAtelierMsg, localize, localizeDir } from '../i18n.js';
import { SceneController } from '../scene/scene-controller.js';
import type { OtherSymbol } from './mf-symbol-wizard.js';
import {
  loadDefaultPage,
  loadUserViews,
  saveDefaultPage,
  saveUserViews,
  type UserAtelierViews
} from '@visuelconcept-winccoa/wui-fleet-core/user-views.js';

/** Viewpoints of the atelier, for everyone (role `edit`), or the user's own (#60). */
type VpScope = 'public' | 'mine';
import './mf-symbol-wizard.js';
import {
  DEFAULT_NAV_CORNER,
  DEFAULT_STATE_MAPPINGS,
  DEFAULT_TRS_THRESHOLDS,
  DISCONNECTED_LABEL,
  KPI_TYPE_INFO,
  atelierStates,
  formatParamValue,
  formatStopCause,
  isRunningState,
  mappingStates,
  MAX_DASHBOARD_LINKS,
  appLinkHref,
  followMarkers,
  fleetStats,
  nextMarkerNumber,
  isDisconnected,
  placeMachine,
  resolveConnected,
  resolveDashboardMode,
  resolveDisplaySlots,
  resolveState,
  resolveTrsColor,
  stateColor,
  stateLabel,
  type Atelier,
  type DisplaySlot,
  type BuildingConfig,
  type DashboardOption,
  type DisplayConfig,
  type GlbResource,
  type Machine,
  type MachineDef,
  type PlacementMarker,
  type StateMapping,
  type StopCause,
  type TrsThresholds,
  type Viewpoint
} from '../types.js';
import {
  loadDisplayPrefs,
  saveDisplayPrefs,
  type AtelierDisplayPrefs
} from '@visuelconcept-winccoa/wui-fleet-core/bubble-prefs.js';
import '@visuelconcept-winccoa/wui-fleet-core/fleet-settings-service.js';
import { settingsCache } from '@visuelconcept-winccoa/wui-fleet-core/settings-cache.js';
import {
  filterDimensions,
  isFilterActive,
  loadFleetFilter,
  loadStateFilter,
  matchesFilter,
  pruneFilter,
  saveFleetFilter,
  saveStateFilter,
  type FleetFilter
} from '@visuelconcept-winccoa/wui-fleet-core/filters.js';
import './mf-ai-prompt.js';
import './mf-building-dialog.js';
import './mf-config-panel.js';
import '@visuelconcept-winccoa/wui-kit/ui/wui-confirm-dialog.js';
import './mf-graphics-catalog.js';
import './mf-filter-bar.js';
import './mf-machine-dashboard.js';
import './mf-machine-dialog.js';
import './mf-state-mapping-dialog.js';
import './mf-trs-thresholds-dialog.js';

interface DpEmission {
  dp: string[];
  value: unknown[];
}
type DpKind =
  | 'state'
  | 'kpi'
  | 'kpiCalc'
  | 'stopCause'
  | 'workOrder'
  | 'operation'
  | 'alarmCode'
  | 'comm'
  | 'tilt';
interface DpTarget {
  machineId: string;
  kind: DpKind;
  kpiIndex?: number;
  /** For kind 'kpiCalc': the MachineKpi.id this server DP feeds. */
  kpiCalcId?: string;
}

/** DP-name prefix used by the kpiCalc manager for its per-KPI datapoints. */
const KPI_CALC_PREFIX = 'MachineFleet3D_Kpi_';
/** Mirror of the manager's id→DP-name sanitiser. */
function sanitizeKpiId(id: string): string {
  return id.replaceAll(/[^A-Za-z0-9_]/g, '_');
}

const SAVE_DEBOUNCE_MS = 500;
const ORBIT_STEP = 0.26;
const TILT_STEP = 0.18;
const ZOOM_IN = 0.85;
const ZOOM_OUT = 1.18;

/** Coerce a datapoint value (possibly array-wrapped) to a scalar for display. */
function scalarValue(raw: unknown): string | number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v === 'number' || typeof v === 'string') return v;
  return v == null ? '' : String(v);
}

/** Serialise a value to a pretty JSON file and trigger a browser download. */
function downloadJson(data: unknown, filename: string): void {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Resolve a dashboard's MultiLangString name to a display label (any locale). */
function dashboardLabel(name: Record<string, string | undefined> | undefined, id: number): string {
  const label = name ? Object.values(name).find((v) => v != null && v !== '') : undefined;
  return label ?? `Dashboard ${id}`;
}

@customElement('mf-atelier-view')
export class MfAtelierView extends LitElement {
  static override readonly styles = [IXCoreStyles, viewStyles()];

  @property({ attribute: false }) atelier!: Atelier;
  @property({ attribute: false }) store: FleetStore | null = null;
  /** Combined edit grant (canPublish && 'edit' role), provided by the page shell. */
  @property({ type: Boolean }) canEdit = true;
  /** Application-Security 'ai' grant — gates the AI-assistant affordance. */
  @property({ type: Boolean }) roleAi = true;
  /** Display only (the embeddable view): no edit, no management, no navigation away, no save. */
  @property({ type: Boolean, attribute: 'display-only' }) displayOnly = false;
  /** Hide the top bar (title + toolbar). */
  @property({ type: Boolean, attribute: 'hide-toolbar' }) hideToolbar = false;
  /** Hide the navigation pad and the saved-viewpoint bar (mouse / touch navigation stays). */
  @property({ type: Boolean, attribute: 'hide-nav' }) hideNav = false;
  /** Show a full-screen toggle in the toolbar (emits `wui:fullscreen`). */
  @property({ type: Boolean, attribute: 'fullscreen-button' }) fullscreenButton = false;
  /** Whether the embedding element is full screen (icon of the toggle). */
  @property({ type: Boolean }) fullscreenActive = false;
  /** Display only: the stop-cause catalog, given by the host (null = read through the store). */
  @property({ attribute: false }) stopCauseCatalog: StopCause[] | null = null;

  @query('canvas') private canvasEl!: HTMLCanvasElement;
  @query('.overlay-layer') private overlayEl!: HTMLElement;
  @query('.viewport') private viewportEl!: HTMLElement;
  @query('.import-input') private importInput!: HTMLInputElement;

  @state() private building!: BuildingConfig;
  @state() private display!: DisplayConfig;
  @state() private machines: MachineDef[] = [];
  /** Remembered machine filter (shared with the overview); machines left out are hidden. */
  @state() private filter: FleetFilter = loadFleetFilter();
  /** Remembered state filter (state keys); machines in another state are hidden. */
  @state() private stateFilter: string[] = loadStateFilter();
  /** The viewer's own display toggles (their user settings), over the atelier's outside edit mode. */
  @state() private userDisplay: AtelierDisplayPrefs = {};
  @state() private mappings: StateMapping[] = [];
  @state() private thresholds: TrsThresholds[] = [];
  @state() private markers: PlacementMarker[] = [];
  /** The plant's machines an integration offers to add (MachineFleet3D_Catalog). */
  @state() private catalog: MachineDef[] = [];
  @state() private thresholdsOpen = false;
  /** Right machine-list drawer — hidden by default; shown on demand. */
  @state() private panelOpen = false;
  @state() private selectedId: string | null = null;
  /** Machine whose built-in dashboard overlay is open (null = closed). */
  @state() private dashboardMachineId: string | null = null;
  /** Scene camera mode: 3D (perspective) or 2D (orthographic plan). */
  @state() private cameraMode: '2d' | '3d' = '3d';
  @state() private editing: MachineDef | null = null;
  /** The "add a symbol" wizard (#67), and the other ateliers' symbols it offers. */
  @state() private wizardOpen = false;
  @state() private otherSymbols: OtherSymbol[] = [];
  @state() private buildingOpen = false;
  @state() private mappingOpen = false;
  @state() private atelierName = '';
  @state() private renaming = false;
  @state() private confirmDeleteOpen = false;
  @state() private viewpoints: Viewpoint[] = [];
  @state() private defaultViewpointId = '';
  /** The user's own viewpoints of this atelier and their default (their user settings, #60). */
  @state() private myViews: UserAtelierViews = { viewpoints: [] };
  /** The user's own default page is this atelier. */
  @state() private myLanding = false;
  @state() private viewpointsOpen = false;
  @state() private renamingVpId: string | null = null;
  /** A new placement pin follows the pointer until a click on the floor drops it (#63). */
  @state() private placingPin = false;
  /** The pin being renamed / deleted, and where its editor opens (viewport px). */
  @state() private pinEdit: { id: string; x: number; y: number; label: string } | null = null;
  @state() private vpRenameValue = '';
  @state() private glbResources: GlbResource[] = [];
  @state() private billboardResources: GlbResource[] = [];
  @state() private resourcesOpen = false;
  @state() private editMode = false;
  @state() private dashboards: DashboardOption[] = [];
  @state() private stopCauses: StopCause[] = [];
  /** Assets from the Asset Lifecycle Intelligence module (machine link + obsolescence). */
  @state() private aliAssets: AliAssetInfo[] = [];

  private scene: SceneController | null = null;
  private readonly aliReader = new AliAssetReader();
  private resizeObserver: ResizeObserver | null = null;
  private visibility: IntersectionObserver | null = null;
  private readonly api = this.resolveApi();
  private dpSubscription = new Subscription();
  /** The viewer's settings (filters, bubbles, display toggles), read again on every login. */
  private settingsSub: Subscription | null = null;
  // One DP can drive several targets (e.g. the same DP bound to the state AND a
  // KPI of the same machine), so each key maps to a LIST of targets.
  private dpTargets = new Map<string, DpTarget[]>();
  /** Bumped each (re)subscribe so stale async validation results are ignored. */
  private subGen = 0;
  private saveTimer = 0;
  private loaded = false;
  /** The canvas's WebGL context was released (forceContextLoss): a new scene needs a new canvas. */
  private contextReleased = false;
  /** The scene was built once (by `updated`); later ones come from a reconnect. */
  private sceneBuilt = false;

  override connectedCallback(): void {
    super.connectedCallback();
    // Connected again after a disconnect (moved in the DOM): rebuild what disconnect released.
    if (this.sceneBuilt && !this.scene) this.setupScene();
    this.settingsSub = settingsCache.watch(['fleet-filter', 'fleet-ateliers', 'fleet-views'], () => this.restoreSettings());
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.settingsSub?.unsubscribe();
    this.settingsSub = null;
    this.releaseScene();
  }

  /** The viewer's settings, once loaded (and after a login). */
  private restoreSettings(): void {
    this.filter = loadFleetFilter();
    this.stateFilter = loadStateFilter();
    if (!this.atelier) return;
    this.userDisplay = loadDisplayPrefs(this.atelier.id);
    this.myViews = loadUserViews(this.atelier.id);
    this.myLanding = loadDefaultPage() === this.atelier.id;
  }

  override render(): TemplateResult {
    if (!this.building || !this.display) return html``;
    return html`
      <div class="page">
        ${this.renderTopbar()}
        ${this.renderFilters()}
        <div class="stage">
          <div class="viewport">
            <canvas></canvas>
            <div class="overlay-layer"></div>
            ${this.renderViewpoints()} ${this.renderPinEdit()} ${this.renderDetail()}
            ${this.hideNav ? nothing : html`${this.renderNav()} ${this.renderViewBar()}`}
          </div>
          ${this.renderPanel()}
        </div>
        ${this.renderDialogs()}
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    // Edit grant revoked live (role assignment / canPublish) → drop out of edit mode.
    if ((changed.has('canEdit') || changed.has('displayOnly')) && !this.editable && this.editMode) {
      this.toggleEditMode();
    }
    if (changed.has('atelier') && this.atelier && !this.loaded) {
      this.loaded = true;
      // Display only: the catalog is the host's, known before the first live value.
      if (this.displayOnly) this.stopCauses = this.stopCauseCatalog ?? [];
      this.atelierName = this.atelier.name;
      this.building = structuredClone(this.atelier.building);
      this.display = structuredClone(this.atelier.display);
      this.machines = structuredClone(this.atelier.machines);
      this.mappings = structuredClone(this.atelier.mappings);
      this.thresholds = structuredClone(this.atelier.trsThresholds ?? DEFAULT_TRS_THRESHOLDS);
      this.markers = structuredClone(this.atelier.markers ?? []);
      this.viewpoints = structuredClone(this.atelier.viewpoints ?? []);
      this.defaultViewpointId = this.atelier.defaultViewpointId ?? '';
      this.myViews = loadUserViews(this.atelier.id);
      this.myLanding = loadDefaultPage() === this.atelier.id;
        this.userDisplay = loadDisplayPrefs(this.atelier.id);
    }
  }

  protected override updated(changed: PropertyValues): void {
    // The first render that has the canvas (an atelier) builds the scene once.
    if (!this.scene && this.building && this.isConnected && !this.sceneBuilt) {
      this.sceneBuilt = true;
      this.setupScene();
      if (!this.displayOnly) {
        // Editing data: graphics library, WinCC OA dashboards, the catalogs through the store.
        void this.loadResources();
        void this.loadDashboards();
        void this.loadStopCauses();
        void this.loadCatalog();
      }
      void this.loadAliAssets();
    }
    if (changed.has('filter') || changed.has('stateFilter') || changed.has('machines')) {
      const out = this.filteredOutIds();
      this.scene?.setFilteredOut(out);
      // The card of a machine the filter leaves out closes with it.
      if (this.selectedId && out.has(this.selectedId)) this.selectedId = null;
    }
    if (changed.has('userDisplay')) this.applyDisplay();
  }

  /** Edit affordances: the combined grant, never in display-only mode. */
  private get editable(): boolean {
    return this.canEdit && !this.displayOnly;
  }

  /** Create the WebGL scene, its observers and the live datapoint subscription. */
  private setupScene(): void {
    if (this.contextReleased) {
      // A released canvas keeps its lost WebGL context: draw on a fresh one.
      this.canvasEl.replaceWith(document.createElement('canvas'));
      this.contextReleased = false;
    }
    this.scene = new SceneController(
      this.canvasEl,
      this.overlayEl,
      this.viewportEl,
      (id) => this.onSelect(id)
    );
    const store = this.store;
    if (store) this.scene.setResourceResolver((ref) => store.readResourceDataUrl(ref));
    this.scene.setOnMachineMove((id, x, z) => this.onMachineMove(id, x, z));
    this.scene.setOnMarkerMove((id, x, z) => this.onMarkerMove(id, x, z));
    this.scene.setOnMarkerPick((id, sx, sy) => this.openPinEdit(id, sx, sy));
    this.scene.setOnBubbleEdit((id, patch) => this.onBubbleEdit(id, patch));
    this.scene.setEditMode(this.editMode);
    this.scene.setOnRotate(this.onCameraRotate);
    this.scene.setBuilding(this.building);
    this.scene.setMarkers(this.markers);
    this.scene.setMachines(this.machines);
    this.applyStateColors();
    this.applyDisplay();
    this.scene.resize();
    this.scene.start();
    this.applyDefaultViewpoint();
    this.resubscribeDps();

    this.resizeObserver = new ResizeObserver(() => this.scene?.resize());
    this.resizeObserver.observe(this.viewportEl);
    this.visibility = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) this.scene?.start();
      else this.scene?.stop();
    });
    this.visibility.observe(this.viewportEl);
  }

  /** Release everything setupScene created: timers, observers, live data, WebGL. */
  private releaseScene(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.visibility?.disconnect();
    this.visibility = null;
    // A dpGet validation still in flight must not open a dpConnect after this.
    this.subGen += 1;
    this.dpSubscription.unsubscribe();
    this.dpTargets = new Map();
    if (this.scene) {
      this.scene.dispose();
      this.scene = null;
      this.contextReleased = true;
    }
  }

  /** Live counts beside the atelier's name, faults and stops first (#65); the filter bar applies. */
  private renderStats(): TemplateResult {
    const out = this.filteredOutIds();
    const shown = this.machines.filter((m) => !out.has(m.id));
    const stats = fleetStats(shown, atelierStates(this.mappings.length ? this.mappings : DEFAULT_STATE_MAPPINGS));
    const item = (cls: string, n: number, label: string): TemplateResult =>
      html`<span class="stat ${cls}" title=${label} aria-label=${`${label} : ${n}`}><span class="stat__dot"></span>${n}<span class="stat__label">${label}</span></span>`;
    return html`<div class="stats">
      ${item('stat--fault', stats.fault, localize(MSG.view.statFault))}
      ${item('stat--stop', stats.stop, localize(MSG.view.statStop))}
      ${item('stat--prod', stats.production, localize(MSG.view.statProduction))}
      ${stats.offline > 0 ? item('stat--offline', stats.offline, DISCONNECTED_LABEL) : ''}
    </div>`;
  }

  private renderTopbar(): TemplateResult | typeof nothing {
    if (this.hideToolbar) return nothing;
    if (this.displayOnly) {
      return html`
        <div class="topbar">
          <ix-typography class="title" format="h3">${this.atelierName || localize(MSG.view.atelier)}</ix-typography>
          ${this.renderStats()}
          <span class="topbar-spacer"></span>
          ${this.renderDisplayToolbar()}
        </div>
      `;
    }
    return html`
      <div class="topbar">
        <ix-icon-button ghost icon="arrow-left" title=${localize(MSG.view.backToAteliers)} @click=${this.back}></ix-icon-button>
        ${this.renaming
          ? html`<ix-input
                class="title-input"
                .value=${this.atelierName}
                @valueChange=${(e: CustomEvent<string>) => (this.atelierName = String(e.detail))}
                @keydown=${this.onRenameKey}
              ></ix-input>
              <ix-icon-button ghost icon="check" title=${localize(MSG.view.confirm)} @click=${this.commitRename}></ix-icon-button>`
          : html`<ix-typography class="title" format="h3">${this.atelierName || localize(MSG.view.atelier)}</ix-typography>
              ${this.editable
                ? html`<ix-icon-button ghost icon="pen" title=${localize(MSG.view.renameAtelier)} @click=${this.startRename}></ix-icon-button>`
                : ''}`}
        ${this.renderStats()}
        <span class="topbar-spacer"></span>
        ${this.renderToolbar()}
        ${this.editable
          ? html`<ix-icon-button ghost icon="trashcan" title=${localize(MSG.view.deleteAtelier)} @click=${() => (this.confirmDeleteOpen = true)}></ix-icon-button>`
          : ''}
        ${this.roleAi ? html`<mf-ai-prompt></mf-ai-prompt>` : ''}
      </div>
    `;
  }

  /** Display-only toolbar: what changes the view, never the atelier. */
  private renderDisplayToolbar(): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-icon-button icon="undo" ghost title=${localize(MSG.view.resetView)} @click=${() => this.scene?.resetView()}></ix-icon-button>
        ${this.renderDisplayToggles()}
        <ix-icon-button icon="screenshot" ghost title=${localize(MSG.view.viewpoints)} variant=${this.viewpointsOpen ? 'primary' : 'secondary'} @click=${() => (this.viewpointsOpen = !this.viewpointsOpen)}></ix-icon-button>
        <ix-icon-button icon="app-menu" ghost title=${localize(MSG.view.machines)} variant=${this.panelOpen ? 'primary' : 'secondary'} @click=${() => (this.panelOpen = !this.panelOpen)}></ix-icon-button>
        ${this.renderFullscreenButton()}
      </div>
    `;
  }

  /** Roof / labels / alerts-only toggles (saved with the atelier, except in display-only mode). */
  private renderDisplayToggles(): TemplateResult {
    return html`
      <ix-icon-button icon="home" ghost title=${localize(MSG.view.roof)} variant=${this.shownDisplay.roof ? 'primary' : 'secondary'} @click=${() => this.toggleDisplay('roof')}></ix-icon-button>
      <ix-icon-button icon="label" ghost title=${localize(MSG.view.labels)} variant=${this.shownDisplay.labels ? 'primary' : 'secondary'} @click=${() => this.toggleDisplay('labels')}></ix-icon-button>
      <ix-icon-button icon="warning" ghost title=${localize(MSG.view.alertsOnly)} variant=${this.shownDisplay.alertOnly ? 'primary' : 'secondary'} @click=${() => this.toggleDisplay('alertOnly')}></ix-icon-button>
    `;
  }

  private renderFullscreenButton(): TemplateResult | typeof nothing {
    if (!this.fullscreenButton) return nothing;
    const title = this.fullscreenActive ? MSG.view.exitFullscreen : MSG.view.fullscreen;
    return html`<ix-icon-button
      class="fullscreen-btn"
      icon=${this.fullscreenActive ? 'minimize' : 'maximize'}
      ghost
      title=${localize(title)}
      @click=${() => this.dispatchEvent(new CustomEvent('wui:fullscreen'))}
    ></ix-icon-button>`;
  }

  private renderToolbar(): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-icon-button icon="undo" ghost title=${localize(MSG.view.resetView)} @click=${() => this.scene?.resetView()}></ix-icon-button>
        ${this.editable
          ? html`<ix-icon-button icon="move" ghost title=${localize(MSG.view.editMode)} variant=${this.editMode ? 'primary' : 'secondary'} @click=${this.toggleEditMode}></ix-icon-button>
              <ix-icon-button icon="eye" ghost title=${localize(MSG.bubble.hoverMode)} variant=${this.display.bubblesOnHover ? 'primary' : 'secondary'} @click=${this.toggleBubblesOnHover}></ix-icon-button>
              <ix-icon-button icon="location" ghost title=${localize(MSG.markers.place)} variant=${this.placingPin ? 'primary' : 'secondary'} @click=${this.placePin}></ix-icon-button>`
          : ''}
        ${this.renderDisplayToggles()}
        <ix-icon-button icon="screenshot" ghost title=${localize(MSG.view.viewpoints)} variant=${this.viewpointsOpen ? 'primary' : 'secondary'} @click=${() => (this.viewpointsOpen = !this.viewpointsOpen)}></ix-icon-button>
        <ix-icon-button icon="box-open" ghost title=${localize(MSG.view.graphicsCatalogGlb)} @click=${() => (this.resourcesOpen = true)}></ix-icon-button>
        <ix-icon-button icon="building1" ghost title=${localize(MSG.view.configureBuilding)} @click=${() => (this.buildingOpen = true)}></ix-icon-button>
        <ix-icon-button icon="configuration" ghost title=${localize(MSG.view.stateMappings)} @click=${() => (this.mappingOpen = true)}></ix-icon-button>
        ${this.editable
          ? html`<ix-icon-button icon="upload" ghost title=${localize(MSG.view.importAtelier)} @click=${this.triggerImport}></ix-icon-button>`
          : ''}
        <ix-icon-button icon="download" ghost title=${localize(MSG.view.exportAtelier)} @click=${this.exportAtelier}></ix-icon-button>
        <ix-icon-button icon="app-menu" ghost title=${localize(MSG.view.machines)} variant=${this.panelOpen ? 'primary' : 'secondary'} @click=${() => (this.panelOpen = !this.panelOpen)}></ix-icon-button>
        ${this.renderFullscreenButton()}
      </div>
      <input
        type="file"
        accept="application/json,.json"
        class="import-input"
        @change=${this.onImportFile}
      />
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- compact navigation pad markup
  private renderNav(): TemplateResult {
    const corner = this.building.navCorner ?? DEFAULT_NAV_CORNER;
    return html`
      <div class="nav nav--${corner}">
        <div class="nav-pad">
          <span></span>
          <ix-icon-button ghost icon="chevron-up" title=${localize(MSG.view.tiltUp)} @click=${() => this.scene?.orbitBy(0, -TILT_STEP)}></ix-icon-button>
          <span></span>
          <ix-icon-button ghost icon="chevron-left" title=${localize(MSG.view.rotateLeft)} @click=${() => this.scene?.orbitBy(-ORBIT_STEP, 0)}></ix-icon-button>
          <ix-icon-button ghost icon="home" title=${localize(MSG.view.defaultView)} @click=${() => this.goHome()}></ix-icon-button>
          <ix-icon-button ghost icon="chevron-right" title=${localize(MSG.view.rotateRight)} @click=${() => this.scene?.orbitBy(ORBIT_STEP, 0)}></ix-icon-button>
          <span></span>
          <ix-icon-button ghost icon="chevron-down" title=${localize(MSG.view.tiltDown)} @click=${() => this.scene?.orbitBy(0, TILT_STEP)}></ix-icon-button>
          <span></span>
        </div>
        <div class="nav-zoom">
          <ix-icon-button ghost icon="zoom-in" title=${localize(MSG.view.zoomIn)} @click=${() => this.scene?.zoomBy(ZOOM_IN)}></ix-icon-button>
          <ix-icon-button ghost icon="zoom-out" title=${localize(MSG.view.zoomOut)} @click=${() => this.scene?.zoomBy(ZOOM_OUT)}></ix-icon-button>
        </div>
        <div class="nav-views">
          <ix-button outline @click=${() => this.applyPreset('top')}>${localizeDir(MSG.view.presetTop)}</ix-button>
          <ix-button outline @click=${() => this.applyPreset('front')}>${localizeDir(MSG.view.presetFront)}</ix-button>
          <ix-button outline @click=${() => this.applyPreset('side')}>${localizeDir(MSG.view.presetSide)}</ix-button>
          <ix-button outline @click=${() => this.applyPreset('iso')}>${localizeDir(MSG.view.presetIso)}</ix-button>
        </div>
        <div class="mode-toggle" role="group" title=${localize(MSG.view.cameraModeToggle)}>
          <button
            type="button"
            class="mode-btn ${this.cameraMode === '3d' ? 'mode-btn--on' : ''}"
            @click=${() => this.setCameraMode('3d')}
          >3D</button>
          <button
            type="button"
            class="mode-btn ${this.cameraMode === '2d' ? 'mode-btn--on' : ''}"
            @click=${() => this.setCameraMode('2d')}
          >2D</button>
        </div>
      </div>
    `;
  }

  /** Flip the active camera type without changing the viewpoint. */
  private switchCamera(mode: '2d' | '3d'): void {
    if (this.cameraMode === mode) return;
    this.cameraMode = mode;
    this.scene?.setCameraMode(mode);
  }

  /** 2D/3D toggle button: 2D ⇒ plan (top) view; 3D ⇒ default viewpoint / home. */
  private setCameraMode(mode: '2d' | '3d'): void {
    this.switchCamera(mode);
    if (mode === '2d') this.scene?.setView('top');
    else this.goHome();
  }

  /** User rotated the camera — only possible in 3D (in 2D rotate inputs pan, #57). */
  private readonly onCameraRotate = (): void => {
    if (this.cameraMode === '2d') this.switchCamera('3d');
  };

  /** Camera-preset button: changing to a non-top angle leaves 2D for 3D first. */
  private applyPreset(preset: 'top' | 'front' | 'side' | 'iso'): void {
    if (this.cameraMode === '2d' && preset !== 'top') this.switchCamera('3d');
    this.scene?.setView(preset);
  }

  /** The filter bar over this atelier's machines (filter pruned to what still exists), plus their state. */
  private renderFilters(): TemplateResult {
    const dims = filterDimensions(this.machines);
    const states = this.stateValues();
    if (dims.length === 0 && states.length === 0) return html``;
    const stateDim = localize(MSG.view.filterState);
    const filter: FleetFilter = { ...pruneFilter(this.filter, dims) };
    const stateSelected = states.filter((s) => s.keys.some((k) => this.stateFilter.includes(k))).map((s) => s.label);
    if (stateSelected.length > 0) filter[stateDim] = stateSelected;
    return html`<mf-filter-bar
      class="filters"
      .dimensions=${[...dims, { key: stateDim, values: states.map((s) => s.label) }]}
      .filter=${filter}
      .shown=${this.machines.length - this.filteredOutIds().size}
      .total=${this.machines.length}
      @wui:filter=${(e: CustomEvent<FleetFilter>) => this.onFilter(e.detail, stateDim)}
    ></mf-filter-bar>`;
  }

  private onFilter(filter: FleetFilter, stateDim: string): void {
    const { [stateDim]: stateLabels = [], ...tags } = filter;
    this.filter = tags;
    saveFleetFilter(tags);
    this.stateFilter = this.stateValues()
      .filter((s) => stateLabels.includes(s.label))
      .flatMap((s) => s.keys);
    saveStateFilter(this.stateFilter);
  }

  /**
   * The states the machines of this atelier can take (their mappings'), one per label: two mappings
   * may name a state alike under different keys (« Production » of the built-in states and of a
   * mapping with its own), and the filter shows it once for all of them.
   */
  private stateValues(): { label: string; keys: string[] }[] {
    const out: { label: string; keys: string[] }[] = [];
    for (const m of this.machines) {
      for (const s of mappingStates(this.mappingFor(m))) {
        const same = out.find((o) => o.label === s.label);
        if (!same) out.push({ label: s.label, keys: [s.key] });
        else if (!same.keys.includes(s.key)) same.keys.push(s.key);
      }
    }
    return out;
  }

  /** Ids of the machines the filter leaves out (tags, then state). */
  private filteredOutIds(): Set<string> {
    const filter = pruneFilter(this.filter, filterDimensions(this.machines));
    const byState = this.stateFilter.length > 0;
    if (!isFilterActive(filter) && !byState) return new Set();
    return new Set(
      this.machines
        .filter((m) => !matchesFilter(m, filter) || (byState && !this.stateFilter.includes(m.state)))
        .map((m) => m.id)
    );
  }

  /** Always-on bottom bar of ghost buttons to jump between saved camera views. */

  private renderViewBar(): TemplateResult {
    if (this.viewpoints.length === 0) return html``;
    return html`
      <div class="viewbar">
        <ix-icon class="viewbar-icon" name="eye"></ix-icon>
        ${this.viewpoints.map(
          (vp) => html`<ix-button
            class="viewbar-btn"
            ghost
            @click=${() => this.applyViewpoint(vp)}
          >${vp.name}</ix-button>`
        )}
      </div>
    `;
  }

  /** Public viewpoints (the atelier's, role `edit`) and the user's own (#60), with the default pages. */
  private renderViewpoints(): TemplateResult {
    if (!this.viewpointsOpen) return html``;
    return html`
      <div class="viewpoints">
        ${this.renderVpGroup('public')} ${this.displayOnly ? '' : this.renderVpGroup('mine')}
        ${this.displayOnly
          ? ''
          : html`<div class="vp-pages">
              <label>
                <input type="checkbox" .checked=${this.myLanding} @change=${(e: Event) => this.setMyLanding((e.target as HTMLInputElement).checked)} />
                ${localizeDir(MSG.view.myLanding)}
              </label>
              ${this.editable
                ? html`<label>
                    <input type="checkbox" .checked=${this.atelier.landing === true} @change=${(e: Event) => this.setPublicLanding((e.target as HTMLInputElement).checked)} />
                    ${localizeDir(MSG.view.publicLanding)}
                  </label>`
                : ''}
            </div>`}
      </div>
    `;
  }

  private renderVpGroup(scope: VpScope): TemplateResult {
    const list = this.vpList(scope);
    const canWrite = scope === 'mine' || this.editable;
    return html`
      <div class="vp-head">
        <span>${localizeDir(scope === 'public' ? MSG.view.publicViews : MSG.view.myViews)}</span>
        ${canWrite
          ? html`<ix-button variant="secondary" @click=${() => this.saveViewpoint(scope)}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.view.saveView)}
            </ix-button>`
          : ''}
      </div>
      ${list.length === 0
        ? html`<div class="muted">${localizeDir(MSG.view.noViewpoints)}</div>`
        : html`<div class="vp-list">${list.map((vp) => this.renderViewpointRow(vp, scope))}</div>`}
    `;
  }

  private renderViewpointRow(vp: Viewpoint, scope: VpScope): TemplateResult {
    const canWrite = scope === 'mine' || this.editable;
    if (this.renamingVpId === vp.id) {
      return html`<div class="vp-row">
        <ix-input
          class="vp-input"
          .value=${this.vpRenameValue}
          @valueChange=${(e: CustomEvent<string>) => (this.vpRenameValue = String(e.detail))}
          @keydown=${(e: KeyboardEvent) => this.onVpRenameKey(e, vp, scope)}
        ></ix-input>
        <ix-icon-button ghost size="16" icon="check" title=${localize(MSG.view.confirm)} @click=${() => this.commitVpRename(vp, scope)}></ix-icon-button>
      </div>`;
    }
    const isDefault = vp.id === this.vpDefaultId(scope);
    return html`<div class="vp-row">
      <span class="vp-name" title=${localize(MSG.view.goToView)} @click=${() => this.applyViewpoint(vp)}>
        ${vp.name}${vp.mode === '2d' ? ' (2D)' : ''}${isDefault ? html`<ix-icon class="vp-default-badge" name="star-filled" size="12"></ix-icon>` : ''}
      </span>
      ${canWrite
        ? html`<ix-icon-button
              ghost
              size="16"
              icon=${isDefault ? 'star-filled' : 'star'}
              variant=${isDefault ? 'primary' : 'secondary'}
              title=${isDefault
                ? localize(MSG.view.defaultViewpointOn)
                : localize(MSG.view.defaultViewpointOff)}
              @click=${() => this.setDefaultViewpoint(vp.id, scope)}
            ></ix-icon-button>
            <ix-icon-button ghost size="16" icon="refresh" title=${localize(MSG.view.refreshFromCamera)} @click=${() => this.updateViewpoint(vp.id, scope)}></ix-icon-button>
            <ix-icon-button ghost size="16" icon="pen" title=${localize(MSG.view.rename)} @click=${() => this.startVpRename(vp)}></ix-icon-button>
            <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.view.delete)} @click=${() => this.deleteViewpoint(vp.id, scope)}></ix-icon-button>`
        : ''}
    </div>`;
  }

  private renderPanel(): TemplateResult {
    if (!this.panelOpen) return html``;
    return html`
      <div class="drawer">
        <mf-config-panel
          .machines=${this.machines}
          .states=${atelierStates(this.mappings.length ? this.mappings : DEFAULT_STATE_MAPPINGS)}
          .canEdit=${this.editable}
          ?list-only=${this.displayOnly}
          @wui:focus=${(e: CustomEvent<{ id: string }>) => this.onFocus(e.detail.id)}
          @wui:edit=${(e: CustomEvent<{ id: string }>) => this.onEdit(e.detail.id)}
          @wui:delete=${(e: CustomEvent<{ id: string }>) => this.onDelete(e.detail.id)}
          @wui:add=${() => this.openWizard()}
        ></mf-config-panel>
      </div>
    `;
  }

  private renderDetail(): TemplateResult {
    if (!this.selectedId) return html``;
    const m = this.scene?.getMachine(this.selectedId);
    if (!m) return html``;
    const offline = isDisconnected(m);
    const mapping = this.mappingFor(m);
    const headColor = stateColor(mapping, offline ? 'disconnected' : m.state);
    return html`
      <div class="detail">
        <div class="detail__head">
          <span class="dot" style="background:${headColor}"></span>
          <ix-typography class="name" format="h3" title=${m.name}>${m.name}</ix-typography>
          <ix-chip outline>${m.loc ?? m.type}</ix-chip>
          ${this.displayOnly
            ? nothing
            : html`<ix-icon-button ghost icon=${this.editable ? 'pen' : 'eye'} title=${this.editable ? localize(MSG.view.edit) : localize(MSG.view.viewOnly)} @click=${() => this.onEdit(m.id)}></ix-icon-button>`}
          <ix-icon-button ghost icon="close" title=${localize(MSG.view.close)} @click=${() => (this.selectedId = null)}></ix-icon-button>
        </div>
        ${offline
          ? html`<div class="detail__offline" style="--c:${stateColor(mapping, 'disconnected')}">${DISCONNECTED_LABEL}</div>`
          : this.renderInfoRows(m)}
        ${this.displayOnly ? nothing : this.renderDashboardLink(m)}
      </div>
    `;
  }

  private renderDashboardLink(m: Machine): TemplateResult {
    // Always offer a dashboard: the built-in contextualised one, or — when the
    // machine is configured for it — a specific WinCC OA dashboard. Plus any
    // custom URL links (each opens in a new tab).
    // A machine whose links stay within the application shows only those (appLinksOnly).
    const links = (m.dashboardLinks ?? [])
      .filter((l) => l.url.trim() !== '' && (!m.appLinksOnly || appLinkHref(l.url) !== undefined))
      .slice(0, MAX_DASHBOARD_LINKS);
    return html`
      <ix-button class="dash-btn" variant="primary" @click=${() => this.openMachineDashboard(m)}>
        <ix-icon name="ontology" slot="icon"></ix-icon>${localizeDir(MSG.view.openDashboard)}
      </ix-button>
      ${links.map(
        (l) => html`<ix-button
          class="dash-btn"
          variant="secondary"
          icon=${l.icon || 'ontology'}
          title=${l.url}
          @click=${() => this.openLink(l.url, m.appLinksOnly === true)}
        >${l.label || localize(MSG.view.link)}</ix-button>`
      )}
    `;
  }

  /**
   * Open a configured dashboard-link URL in a new browser tab — or, for a link that stays
   * within the application (`inApp`), in the application itself.
   */
  private openLink(raw: string, inApp = false): void {
    if (inApp) {
      const href = appLinkHref(raw);
      if (href) window.location.assign(href);
      return;
    }
    const url = raw.trim();
    if (!url) return;
    // Accept full URLs and site-relative paths; otherwise assume https.
    const href = /^(https?:\/\/|\/)/i.test(url) ? url : `https://${url}`;
    window.open(href, '_blank', 'noopener,noreferrer');
  }

  /** Popup info rows — ordered & filtered by the per-machine "Affichage" config. */
  private renderInfoRows(m: Machine): TemplateResult {
    const rows = resolveDisplaySlots(m)
      .filter((s) => s.inPopup)
      .map((s) => this.popupRow(s, m))
      .filter((r): r is TemplateResult => r !== null);
    if (rows.length === 0) return html`<div class="muted">${localizeDir(MSG.view.noInformation)}</div>`;
    return html`<div class="detail__info">${rows}</div>`;
  }

  private popupRow(slot: DisplaySlot, m: Machine): TemplateResult | null {
    const cell = this.popupCell(slot, m);
    if (!cell) return null;
    return html`
      <div class="kpi">
        <span class="kpi__label">${cell.label}</span>
        <span class="kpi__value" style=${cell.style ?? ''}>${cell.value}</span>
      </div>
    `;
  }

  private popupCell(
    slot: DisplaySlot,
    m: Machine
  ): { label: string; value: string | number; style?: string } | null {
    if (slot.kind === 'state') {
      return {
        label: localize(MSG.view.state),
        value: stateLabel(this.mappingFor(m), m.state),
        style: `color:${stateColor(this.mappingFor(m), m.state)};font-weight:700`
      };
    }
    if (slot.kind === 'stopCause') {
      const cause = isRunningState(this.mappingFor(m), m.state) ? undefined : (m.stopCauseLabel || m.stopCause);
      return cause != null && cause !== '' ? { label: localize(MSG.view.stopCause), value: cause } : null;
    }
    if (slot.kind === 'workOrder') {
      return m.workOrder != null && m.workOrder !== ''
        ? { label: localize(MSG.view.workOrder), value: m.workOrder }
        : null;
    }
    if (slot.kind === 'operation') {
      return m.operation != null && m.operation !== ''
        ? { label: localize(MSG.view.operation), value: m.operation }
        : null;
    }
    if (slot.kind === 'alarmCode') {
      // Shown while the machine is not producing (stop, maintenance…), as the stop cause.
      const code = isRunningState(this.mappingFor(m), m.state) ? undefined : m.alarmCode;
      return code != null && code !== '' ? { label: localize(MSG.view.alarmCode), value: code } : null;
    }
    if (slot.kind === 'param') {
      const p = slot.param;
      if (!p) return null;
      const value = p.value == null ? '—' : `${formatParamValue(p.value, p.decimals)}${p.unit ? ` ${p.unit}` : ''}`;
      return { label: p.label || slot.label, value };
    }
    if (slot.kind === 'obsolescence') {
      if (m.aliRiskScore == null) return null;
      const level = m.aliRiskLabel ? ` — ${m.aliRiskLabel}` : '';
      return {
        label: localize(MSG.view.obsolescenceAli),
        value: `${m.aliRiskScore}${level}`,
        style: m.aliRiskColor ? `color:${m.aliRiskColor};font-weight:700` : ''
      };
    }
    // kind === 'kpi'
    const k = slot.kpi;
    if (!k) return null;
    const v = (m.kpiCalcValues ?? {})[k.id];
    const info = KPI_TYPE_INFO[k.type];
    const value = v == null ? '—' : `${formatParamValue(v)} ${info.unit}`;
    const color = (m.kpiCalcColors ?? {})[k.id];
    return { label: slot.label, value, style: color ? `color:${color};font-weight:700` : '' };
  }

  private renderDialogs(): TemplateResult {
    return html`
      ${this.buildingOpen
        ? html`<mf-building-dialog
            .building=${this.building}
            .canEdit=${this.editable}
            @wui:apply=${(e: CustomEvent<{ building: BuildingConfig }>) => this.onBuilding(e.detail.building)}
            @wui:close=${() => (this.buildingOpen = false)}
          ></mf-building-dialog>`
        : ''}
      ${this.wizardOpen
        ? html`<mf-symbol-wizard
            .catalog=${this.catalog.filter((c) => !this.machines.some((m) => m.id === c.id))}
            .others=${this.otherSymbols}
            @wui:addsymbol=${(e: CustomEvent<{ def: MachineDef; keepId: boolean }>) => this.onAddSymbol(e.detail.def, e.detail.keepId)}
            @wui:close=${() => (this.wizardOpen = false)}
          ></mf-symbol-wizard>`
        : ''}
      ${this.editing
        ? html`<mf-machine-dialog
            .machine=${this.editing}
            .markers=${this.markers}
            .store=${this.store}
            .mappings=${this.mappings}
            .thresholds=${this.thresholds}
            .glbResources=${this.glbResources}
            .billboardResources=${this.billboardResources}
            .dashboards=${this.dashboards}
            .aliAssets=${this.aliAssets}
            .canEdit=${this.editable}
            @wui:apply=${(e: CustomEvent<{ machine: MachineDef }>) => this.onMachineApply(e.detail.machine)}
            @wui:mapping=${() => (this.mappingOpen = true)}
            @wui:thresholds=${() => (this.thresholdsOpen = true)}
            @wui:resources=${() => (this.resourcesOpen = true)}
            @wui:dashboardcreate=${(e: CustomEvent<{ machine: MachineDef }>) => this.onDashboardCreate(e.detail.machine)}
            @wui:dashboardexport=${(e: CustomEvent<{ machine: MachineDef }>) => this.onDashboardExport(e.detail.machine)}
            @wui:close=${() => (this.editing = null)}
          ></mf-machine-dialog>`
        : ''}
      ${this.mappingOpen
        ? html`<mf-state-mapping-dialog
            .mappings=${this.mappings}
            .canEdit=${this.editable}
            @wui:apply=${(e: CustomEvent<{ mappings: StateMapping[] }>) => this.onMappings(e.detail.mappings)}
            @wui:close=${() => (this.mappingOpen = false)}
          ></mf-state-mapping-dialog>`
        : ''}
      ${this.thresholdsOpen
        ? html`<mf-trs-thresholds-dialog
            .thresholds=${this.thresholds}
            .canEdit=${this.editable}
            @wui:apply=${(e: CustomEvent<{ thresholds: TrsThresholds[] }>) => this.onThresholds(e.detail.thresholds)}
            @wui:close=${() => (this.thresholdsOpen = false)}
          ></mf-trs-thresholds-dialog>`
        : ''}
      ${this.confirmDeleteOpen
        ? html`<wui-confirm-dialog
            heading=${localize(MSG.view.confirmDeleteHeading)}
            message=${confirmDeleteAtelierMsg(this.atelierName)}
            @wui:confirm=${this.confirmDelete}
            @wui:cancel=${() => (this.confirmDeleteOpen = false)}
          ></wui-confirm-dialog>`
        : ''}
      ${this.resourcesOpen
        ? html`<mf-graphics-catalog
            .store=${this.store}
            .canEdit=${this.editable}
            @wui:change=${() => this.loadResources()}
            @wui:close=${() => (this.resourcesOpen = false)}
          ></mf-graphics-catalog>`
        : ''}
      ${this.renderMachineDashboard()}
    `;
  }

  /** Built-in contextualised machine dashboard overlay (mode 'default'). */
  private renderMachineDashboard(): TemplateResult {
    const m = this.dashboardMachineId ? this.scene?.getMachine(this.dashboardMachineId) : null;
    if (!m) return html``;
    return html`<mf-machine-dashboard
      .machine=${m}
      .mapping=${this.mappingFor(m)}
      .stopCauses=${this.stopCauses}
      .api=${this.api}
      atelierId=${this.atelier.id}
      atelierName=${this.atelierName}
      @wui:close=${() => (this.dashboardMachineId = null)}
    ></mf-machine-dashboard>`;
  }

  private async loadResources(): Promise<void> {
    if (!this.store) return;
    this.glbResources = await this.store.listResources('glb');
    this.billboardResources = await this.store.listResources('billboard');
  }

  private async loadCatalog(): Promise<void> {
    if (this.store) this.catalog = await this.store.listCatalog();
  }

  private async loadStopCauses(): Promise<void> {
    if (!this.store) return;
    this.stopCauses = await this.store.listStopCauses();
    // Re-resolve any already-received stop-cause codes against the fresh catalog.
    let touched = false;
    for (const m of this.machines) {
      if (m.stopCause == null || m.stopCause === '') continue;
      const label = formatStopCause(this.stopCauses, m.stopCause);
      if (label !== m.stopCauseLabel) {
        m.stopCauseLabel = label;
        this.scene?.updateMachineLive(m.id, { stopCauseLabel: label });
        touched = true;
      }
    }
    if (touched) this.machines = [...this.machines];
  }

  /** Load the ALI asset inventory (read-only) and resolve linked machines' risk. */
  private async loadAliAssets(): Promise<void> {
    this.aliAssets = await this.aliReader.list();
    this.applyAliRisk();
  }

  /** Resolve each linked machine's composite ALI risk from the loaded inventory
   * and push it onto the scene (bubble / popup show it via the Affichage config). */
  private applyAliRisk(): void {
    const byId = new Map(this.aliAssets.map((a) => [a.id, a]));
    let touched = false;
    for (const m of this.machines) {
      const info = m.aliAssetId ? byId.get(m.aliAssetId) : undefined;
      const score = info?.risk.score;
      const label = info?.risk.label;
      const color = info?.risk.color;
      if (m.aliRiskScore === score && m.aliRiskLabel === label && m.aliRiskColor === color) continue;
      m.aliRiskScore = score;
      m.aliRiskLabel = label;
      m.aliRiskColor = color;
      this.scene?.updateMachineLive(m.id, { aliRiskScore: score, aliRiskLabel: label, aliRiskColor: color });
      touched = true;
    }
    if (touched) this.machines = [...this.machines];
  }

  private async loadDashboards(): Promise<void> {
    let service: DashboardService;
    try {
      service = container.resolve(DashboardService);
    } catch {
      return; // Service unavailable (e.g. offline preview) — manual entry only.
    }
    try {
      const list = await firstValueFrom(service.list());
      this.dashboards = list.map((d) => ({ id: d.id, name: dashboardLabel(d.settings.name, d.id) }));
    } catch {
      // Backend not connected — keep the empty list (dialog falls back to a number field).
    }
  }

  /** Open the machine's dashboard: a specific WinCC OA one (mode 'oa' + id) or
   * the built-in contextualised machine dashboard (overlay). */
  private openMachineDashboard(m: Machine): void {
    if (this.displayOnly) return;
    if (resolveDashboardMode(m) === 'oa' && m.dashboardId != null) {
      this.dispatchEvent(new RouterEvent(`/dashboard/${m.dashboardId}`));
      return;
    }
    this.dashboardMachineId = m.id;
  }

  /** Resolve the state mapping bound to a machine (for the dashboard Gantt). */
  private mappingFor(m: Pick<MachineDef, 'stateMappingId'>): StateMapping {
    return (
      this.mappings.find((mp) => mp.id === m.stateMappingId) ??
      this.mappings[0] ??
      DEFAULT_STATE_MAPPINGS[0]
    );
  }

  /** Atelier-wide mapping used for scene/label colours (the default, else first). */
  private primaryMapping(): StateMapping {
    return (
      this.mappings.find((mp) => mp.id === 'default') ??
      this.mappings[0] ??
      DEFAULT_STATE_MAPPINGS[0]
    );
  }

  /**
   * Push the atelier's states to the scene (dots, leaders, bubbles): those of every mapping
   * of the atelier — a machine may use another mapping than the primary one — with the
   * primary mapping's "not connected" overlay colour.
   */
  private applyStateColors(): void {
    const defs = atelierStates(this.mappings.length ? this.mappings : DEFAULT_STATE_MAPPINGS);
    const colors: Record<string, string> = Object.fromEntries(defs.map((s) => [s.key, s.color]));
    colors['disconnected'] = stateColor(this.primaryMapping(), 'disconnected');
    this.scene?.setStateColors(colors);
    this.scene?.setStateDefs(defs);
  }

  private resolveDashboardService(): DashboardService | null {
    try {
      return container.resolve(DashboardService);
    } catch {
      return null;
    }
  }

  private async onDashboardCreate(machine: MachineDef): Promise<void> {
    const service = this.resolveDashboardService();
    if (!service) return;
    try {
      const widgets = buildMachineWidgets(machine, this.atelier.id, this.atelierName || this.atelier.name);
      const settings = buildDashboardSettings(machine);
      const { id } = await firstValueFrom(service.create(settings, widgets, true));
      // Reflect the new association in the open dialog working copy.
      if (this.editing && this.editing.id === machine.id) {
        this.editing = { ...this.editing, dashboardId: id };
      }
      await this.loadDashboards();
    } catch {
      // Backend unavailable or no write rights — leave config unchanged.
    }
  }

  private async onDashboardExport(machine: MachineDef): Promise<void> {
    const service = this.resolveDashboardService();
    if (!service || machine.dashboardId == null) return;
    try {
      const dashboard = await firstValueFrom(service.get(machine.dashboardId));
      const kept = (dashboard.widgets ?? []).filter((w: { id: string }) => !isMachineWidget(w, machine.id));
      dashboard.widgets = [
        ...kept,
        ...buildMachineWidgets(machine, this.atelier.id, this.atelierName || this.atelier.name)
      ];
      await firstValueFrom(service.set(dashboard));
    } catch {
      // Backend unavailable or dashboard missing — nothing exported.
    }
  }

  // --- handlers --------------------------------------------------------------

  private onSelect(id: string): void {
    this.selectedId = id;
  }

  private onFocus(id: string): void {
    this.selectedId = id;
    this.scene?.focusMachine(id);
  }

  private toggleEditMode(): void {
    this.editMode = !this.editMode;
    this.scene?.setEditMode(this.editMode);
    if (!this.editMode) {
      this.placingPin = false;
      this.pinEdit = null;
    }
  }

  /** Toolbar pin button: a new marker dropped by a click on the floor, then named (#63). */
  private placePin(): void {
    if (!this.scene) return;
    if (this.placingPin) {
      this.scene.cancelMarkerPlacement();
      this.placingPin = false;
      return;
    }
    if (!this.editMode) this.toggleEditMode();
    this.pinEdit = null;
    this.placingPin = true;
    this.scene.startMarkerPlacement((x, z) => {
      this.placingPin = false;
      const label = `${localize(MSG.markers.newLabel)} ${nextMarkerNumber(this.markers)}`;
      const marker = { id: `mk-${Date.now()}`, label, x, z };
      this.onMarkers([...this.markers, marker]);
    });
  }

  /** A pin clicked in edit mode: its editor (name, delete) opens beside it. */
  private openPinEdit(id: string, clientX: number, clientY: number): void {
    const marker = this.markers.find((k) => k.id === id);
    if (!marker) return;
    const rect = this.viewportEl.getBoundingClientRect();
    this.pinEdit = { id, x: clientX - rect.left, y: clientY - rect.top, label: marker.label };
  }

  private renderPinEdit(): TemplateResult {
    const edit = this.pinEdit;
    if (!edit) return html``;
    const commit = (): void => {
      const label = edit.label.trim();
      if (label) this.onMarkers(this.markers.map((k) => (k.id === edit.id ? { ...k, label } : k)));
      this.pinEdit = null;
    };
    const remove = (): void => {
      this.onMarkers(this.markers.filter((k) => k.id !== edit.id));
      this.pinEdit = null;
    };
    return html`
      <div class="pin-edit" style="left: ${edit.x + 12}px; top: ${edit.y + 12}px">
        <ix-input
          label=${localize(MSG.markers.label)}
          .value=${edit.label}
          @valueChange=${(e: CustomEvent<string>) => (this.pinEdit = { ...edit, label: String(e.detail) })}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === 'Enter') commit();
            else if (e.key === 'Escape') this.pinEdit = null;
          }}
        ></ix-input>
        <ix-icon-button ghost size="16" icon="check" title=${localize(MSG.view.confirm)} @click=${commit}></ix-icon-button>
        <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.markers.remove)} @click=${remove}></ix-icon-button>
        <ix-icon-button ghost size="16" icon="close" title=${localize(MSG.markers.close)} @click=${() => (this.pinEdit = null)}></ix-icon-button>
      </div>
    `;
  }

  private onMachineMove(id: string, x: number, z: number): void {
    // Moved by the user: placed, so its "à placer" mark goes (saved with the atelier).
    this.machines = this.machines.map((m) =>
      m.id === id ? placeMachine(m, Math.round(x * 10) / 10, Math.round(z * 10) / 10) : m
    );
    this.scene?.updateMachineLive(id, { toPlace: undefined });
    this.scheduleSave();
  }

  /** The display toggles shown: the atelier's, with the viewer's own over them. */
  private get shownDisplay(): DisplayConfig {
    return { ...this.display, ...this.userDisplay };
  }

  /**
   * A display toggle: in edit mode it changes the atelier's own (everyone's default, saved with
   * the atelier); otherwise only the viewer's, kept in their user settings.
   */
  private toggleDisplay(key: keyof AtelierDisplayPrefs): void {
    const value = !this.shownDisplay[key];
    const others = { ...this.userDisplay };
    delete others[key];
    if (this.editMode && this.editable) {
      this.display = { ...this.display, [key]: value };
      this.userDisplay = others;
      this.scheduleSave();
    } else {
      this.userDisplay = { ...others, [key]: value };
    }
    saveDisplayPrefs(this.atelier.id, this.userDisplay);
    this.applyDisplay();
  }

  private onBuilding(building: BuildingConfig): void {
    this.building = building;
    this.scene?.setBuilding(building);
    this.buildingOpen = false;
    this.scheduleSave();
  }

  /** "Add a symbol": the wizard, with the other ateliers' symbols to copy (#67). */
  private async openWizard(): Promise<void> {
    if (!this.editable) return;
    this.wizardOpen = true;
    this.otherSymbols = [];
    if (!this.store) return;
    try {
      const ateliers = await this.store.listAteliers();
      this.otherSymbols = ateliers
        .filter((a) => a.id !== this.atelier.id)
        .flatMap((a) => a.machines.map((machine) => ({ atelier: a.name, machine })));
    } catch {
      // Backend unreachable: the other sources stay usable.
    }
  }

  /**
   * A symbol from the wizard: the site's catalogue keeps its id (the site's machine), the others
   * get a new one; not bound to a marker, "à placer" at the centre of the floor, shown at once.
   */
  private onAddSymbol(source: MachineDef, keepId: boolean): void {
    if (!this.editable) return;
    if (keepId && this.machines.some((m) => m.id === source.id)) return;
    const def: MachineDef = { ...source, id: keepId ? source.id : `machine-${Date.now()}`, x: 0, z: 0, toPlace: true };
    delete def.markerId;
    delete def.bubbleOffset;
    this.machines = [...this.machines, def];
    this.wizardOpen = false;
    this.rebuildMachines();
    this.onFocus(def.id);
  }

  private onEdit(id: string): void {
    if (this.displayOnly) return;
    const m = this.machines.find((x) => x.id === id);
    if (m) this.editing = { ...m, kpis: (m.kpis ?? []).map((k) => ({ ...k })) };
  }

  private onMachineApply(machine: MachineDef): void {
    // A position changed in the dialog places the machine too.
    this.machines = this.machines.map((m) => {
      if (m.id !== machine.id) return m;
      const moved = machine.toPlace && (machine.x !== m.x || machine.z !== m.z);
      return moved ? placeMachine(machine, machine.x, machine.z) : machine;
    });
    this.editing = null;
    this.rebuildMachines();
  }

  private onDelete(id: string): void {
    if (!this.editable) return;
    this.machines = this.machines.filter((m) => m.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.rebuildMachines();
  }

  private onMappings(mappings: StateMapping[]): void {
    this.mappings = mappings;
    this.mappingOpen = false;
    this.applyStateColors();
    this.resubscribeDps();
    this.scheduleSave();
  }

  /**
   * New markers, placed, renamed, deleted or dragged as pins in edit mode: the machines bound to a
   * moved marker follow it (SDS 2.2 SL-IMP-02).
   */
  private onMarkers(markers: PlacementMarker[]): void {
    this.machines = followMarkers(this.machines, this.markers, markers);
    this.markers = markers;
    this.scene?.setMarkers(markers);
    this.rebuildMachines();
  }

  private onMarkerMove(id: string, x: number, z: number): void {
    this.onMarkers(this.markers.map((k) => (k.id === id ? { ...k, x, z } : k)));
  }

  private onThresholds(thresholds: TrsThresholds[]): void {
    this.thresholds = thresholds;
    this.thresholdsOpen = false;
    this.scheduleSave();
  }

  private applyDisplay(): void {
    const shown = this.shownDisplay;
    this.scene?.setRoofVisible(shown.roof);
    this.scene?.setLabelsEnabled(shown.labels);
    this.scene?.setAlertOnly(shown.alertOnly);
    // The atelier's own setting, never a viewer's (#56).
    this.scene?.setBubblesOnHover(this.display.bubblesOnHover === true);
  }

  /** A bubble moved / resized by hand in edit mode, or back to automatic (null): saved (#59). */
  private onBubbleEdit(id: string, patch: { bubbleScale?: number | null; bubbleOffset?: [number, number] | null }): void {
    this.machines = this.machines.map((m) => {
      if (m.id !== id) return m;
      const next = { ...m };
      if (patch.bubbleScale === null) delete next.bubbleScale;
      else if (patch.bubbleScale !== undefined) next.bubbleScale = patch.bubbleScale;
      if (patch.bubbleOffset === null) delete next.bubbleOffset;
      else if (patch.bubbleOffset !== undefined) next.bubbleOffset = patch.bubbleOffset;
      return next;
    });
    this.scheduleSave();
  }

  /** Edit toolbar: bubbles always shown, or on hover only — for this atelier and everyone (#56). */
  private toggleBubblesOnHover(): void {
    this.display = { ...this.display, bubblesOnHover: !this.display.bubblesOnHover };
    this.applyDisplay();
    this.scheduleSave();
  }

  private rebuildMachines(): void {
    this.scene?.setMachines(this.machines);
    this.applyAliRisk();
    this.resubscribeDps();
    this.scheduleSave();
  }

  private back(): void {
    this.dispatchEvent(new CustomEvent('wui:back', { bubbles: true, composed: true }));
  }

  private startRename(): void {
    this.renaming = true;
  }

  private onRenameKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') this.commitRename();
    else if (e.key === 'Escape') {
      this.renaming = false;
      this.atelierName = this.atelier.name;
    }
  }

  private commitRename(): void {
    this.renaming = false;
    const name = this.atelierName.trim();
    if (name === '') {
      this.atelierName = this.atelier.name;
      return;
    }
    this.atelierName = name;
    this.scheduleSave();
  }

  private confirmDelete(): void {
    this.confirmDeleteOpen = false;
    this.dispatchEvent(new CustomEvent('wui:remove', { bubbles: true, composed: true }));
  }

  private vpList(scope: VpScope): Viewpoint[] {
    return scope === 'public' ? this.viewpoints : this.myViews.viewpoints;
  }

  private vpDefaultId(scope: VpScope): string {
    return scope === 'public' ? this.defaultViewpointId : (this.myViews.defaultViewpointId ?? '');
  }

  /** New list (and default) of a scope: the atelier's saved with it, the user's in their settings. */
  private setVps(scope: VpScope, list: Viewpoint[], defaultId: string): void {
    const def = list.some((v) => v.id === defaultId) ? defaultId : '';
    if (scope === 'public') {
      this.viewpoints = list;
      this.defaultViewpointId = def;
      this.scheduleSave();
      return;
    }
    this.myViews = def ? { viewpoints: list, defaultViewpointId: def } : { viewpoints: list };
    saveUserViews(this.atelier.id, this.myViews);
  }

  /** Save the current camera (and its 2D / 3D mode) as a new viewpoint of the scope. */
  private saveViewpoint(scope: VpScope): void {
    if (!this.scene) return;
    const pose = this.scene.captureView();
    const list = this.vpList(scope);
    const vp: Viewpoint = {
      id: `vp-${Date.now()}`,
      name: `${localize(MSG.view.viewLabel)} ${list.length + 1}`,
      pos: pose.pos,
      target: pose.target,
      mode: this.cameraMode
    };
    this.setVps(scope, [...list, vp], this.vpDefaultId(scope));
  }

  private applyViewpoint(vp: Viewpoint): void {
    if (vp.mode === '2d') {
      this.switchCamera('2d');
    } else {
      // A viewpoint seen at an angle cannot be shown in the plan: it returns to 3D (#57).
      const topDown = Math.hypot(vp.pos[0] - vp.target[0], vp.pos[2] - vp.target[2]) < 0.1 * Math.abs(vp.pos[1] - vp.target[1]);
      if (this.cameraMode === '2d' && (!topDown || vp.mode === '3d')) this.switchCamera('3d');
    }
    this.scene?.applyView(vp.pos, vp.target);
  }

  /** Overwrite a saved viewpoint's pose (and mode) with the current camera. */
  private updateViewpoint(id: string, scope: VpScope): void {
    if (!this.scene) return;
    const pose = this.scene.captureView();
    const list = this.vpList(scope).map((v) =>
      v.id === id ? { ...v, pos: pose.pos, target: pose.target, mode: this.cameraMode } : v
    );
    this.setVps(scope, list, this.vpDefaultId(scope));
  }

  /** The viewpoint applied on load: the user's own default, else the atelier's. */
  private defaultViewpoint(): Viewpoint | undefined {
    const mine = this.myViews.defaultViewpointId;
    const own = mine ? this.myViews.viewpoints.find((v) => v.id === mine) : undefined;
    if (own) return own;
    return this.defaultViewpointId
      ? this.viewpoints.find((v) => v.id === this.defaultViewpointId)
      : undefined;
  }

  /** Apply the default viewpoint, if any, when the view first loads. */
  private applyDefaultViewpoint(): void {
    const vp = this.defaultViewpoint();
    if (vp) this.applyViewpoint(vp);
  }

  /** Home button: jump to the default viewpoint if defined, else reset the camera. */
  private goHome(): void {
    const vp = this.defaultViewpoint();
    if (vp) this.applyViewpoint(vp);
    else this.scene?.resetView();
  }

  /** Toggle a viewpoint as the scope's one applied on load. */
  private setDefaultViewpoint(id: string, scope: VpScope): void {
    this.setVps(scope, this.vpList(scope), this.vpDefaultId(scope) === id ? '' : id);
  }

  private deleteViewpoint(id: string, scope: VpScope): void {
    this.setVps(scope, this.vpList(scope).filter((v) => v.id !== id), this.vpDefaultId(scope));
  }

  private startVpRename(vp: Viewpoint): void {
    this.renamingVpId = vp.id;
    this.vpRenameValue = vp.name;
  }

  private onVpRenameKey(e: KeyboardEvent, vp: Viewpoint, scope: VpScope): void {
    if (e.key === 'Enter') this.commitVpRename(vp, scope);
    else if (e.key === 'Escape') this.renamingVpId = null;
  }

  private commitVpRename(vp: Viewpoint, scope: VpScope): void {
    const name = this.vpRenameValue.trim();
    this.renamingVpId = null;
    if (name === '' || name === vp.name) return;
    this.setVps(scope, this.vpList(scope).map((v) => (v.id === vp.id ? { ...v, name } : v)), this.vpDefaultId(scope));
  }

  /** This atelier as the user's own default page (their settings), or back to the public one. */
  private setMyLanding(on: boolean): void {
    this.myLanding = on;
    saveDefaultPage(on ? this.atelier.id : undefined);
  }

  /** This atelier as the public default page (role `edit`); the shell clears it on the others. */
  private setPublicLanding(on: boolean): void {
    this.atelier = { ...this.atelier, landing: on || undefined };
    this.scheduleSave();
  }

  private buildAtelier(): Atelier {
    return {
      ...this.atelier,
      name: this.atelierName || this.atelier.name,
      building: this.building,
      display: this.display,
      machines: this.machines,
      mappings: this.mappings,
      trsThresholds: this.thresholds,
      ...(this.markers.length > 0 || this.atelier.markers ? { markers: this.markers } : {}),
      viewpoints: this.viewpoints,
      defaultViewpointId: this.defaultViewpointId || undefined
    };
  }

  private scheduleSave(): void {
    // Display only: the view never writes the atelier (its display toggles stay local).
    if (this.displayOnly) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      this.dispatchEvent(
        new CustomEvent('wui:save', { detail: this.buildAtelier(), bubbles: true, composed: true })
      );
    }, SAVE_DEBOUNCE_MS);
  }

  private exportAtelier(): void {
    downloadJson(this.buildAtelier(), `atelier-${this.atelier.id}.json`);
  }

  private triggerImport(): void {
    this.importInput.value = '';
    this.importInput.click();
  }

  private async onImportFile(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    let imported: Partial<Atelier>;
    try {
      imported = JSON.parse(await file.text()) as Partial<Atelier>;
    } catch {
      return; // Invalid JSON — keep the current atelier.
    }
    // Keep this atelier's identity (id / dp); replace its content.
    if (imported.name) this.atelierName = imported.name;
    if (imported.building) this.building = imported.building;
    if (imported.display) this.display = imported.display;
    if (Array.isArray(imported.mappings)) this.mappings = imported.mappings;
    if (Array.isArray(imported.trsThresholds)) this.thresholds = imported.trsThresholds;
    if (Array.isArray(imported.viewpoints)) this.viewpoints = imported.viewpoints;
    this.defaultViewpointId = imported.defaultViewpointId ?? '';
    if (Array.isArray(imported.machines)) this.machines = imported.machines;
    if (Array.isArray(imported.markers)) this.markers = imported.markers;
    this.scene?.setBuilding(this.building);
    this.scene?.setMarkers(this.markers);
    this.applyDisplay();
    this.rebuildMachines();
  }

  // --- live datapoint binding ------------------------------------------------

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  private addTarget(dp: string, target: DpTarget): void {
    const key = normDp(dp);
    const list = this.dpTargets.get(key) ?? [];
    list.push(target);
    this.dpTargets.set(key, list);
  }

  private resubscribeDps(): void {
    this.dpSubscription.unsubscribe();
    this.dpSubscription = new Subscription();
    this.dpTargets = new Map();

    const dps: string[] = [];
    for (const m of this.machines) {
      if (m.stateDp) {
        // Key by normalized name: the server echoes a canonical DP name
        // (system prefix, :_original.._value, trailing dot) that won't match
        // the raw bound string otherwise.
        this.addTarget(m.stateDp, { machineId: m.id, kind: 'state' });
        dps.push(m.stateDp);
      }
      const kpis = m.kpis ?? [];
      for (const [kpiIndex, k] of kpis.entries()) {
        if (k.dp) {
          this.addTarget(k.dp, { machineId: m.id, kind: 'kpi', kpiIndex });
          dps.push(k.dp);
        }
      }
      // Server-computed KPIs: read the value the kpiCalc manager writes/archives.
      for (const k of m.kpiCalcs ?? []) {
        const dp = `${KPI_CALC_PREFIX}${sanitizeKpiId(m.id)}_${sanitizeKpiId(k.id)}.value`;
        this.addTarget(dp, { machineId: m.id, kind: 'kpiCalc', kpiCalcId: k.id });
        dps.push(dp);
      }
      const infoDps: [string | undefined, DpKind][] = [
        [m.stopCauseDp, 'stopCause'],
        [m.workOrderDp, 'workOrder'],
        [m.operationDp, 'operation'],
        [m.alarmCodeDp, 'alarmCode'],
        [m.commDp, 'comm'],
        [m.tiltDp, 'tilt']
      ];
      for (const [dp, kind] of infoDps) {
        if (dp) {
          this.addTarget(dp, { machineId: m.id, kind });
          dps.push(dp);
        }
      }
    }
    const api = this.api;
    if (!api || dps.length === 0) return;
    void this.connectValidDps(api, [...new Set(dps)], ++this.subGen);
  }

  /**
   * Validate the candidate datapoints with a one-shot dpGet (which doubles as an
   * initial value seed), drop the ones that don't exist / aren't readable, then
   * open a single `dpConnect` block for the survivors. The generation token
   * discards results from a subscription that has since been superseded.
   */
  private async connectValidDps(api: OaRxJsApi, dps: string[], gen: number): Promise<void> {
    const results = await Promise.allSettled(dps.map((dp) => firstValueFrom(api.dpGet(dp))));
    if (gen !== this.subGen) return;
    const valid: string[] = [];
    let touched = false;
    for (const [i, dp] of dps.entries()) {
      const result = results[i];
      if (result.status !== 'fulfilled') continue; // missing / unreadable → exclude
      valid.push(dp);
      for (const target of this.dpTargets.get(normDp(dp)) ?? []) {
        if (this.applyDpValue(target, result.value)) touched = true;
      }
    }
    if (touched) this.machines = [...this.machines];
    if (valid.length === 0) return;
    try {
      this.dpSubscription.add(
        api.dpConnect(valid, true).subscribe({
          next: (data: DpEmission) => this.onDpData(data),
          error: () => {
            // Live channel dropped — keep the seeded values.
          }
        })
      );
    } catch {
      // Backend not connected — keep the seeded values.
    }
  }

  private onDpData(data: DpEmission): void {
    let touched = false;
    for (const [i, dp] of data.dp.entries()) {
      for (const target of this.dpTargets.get(normDp(dp)) ?? []) {
        if (this.applyDpValue(target, data.value[i])) touched = true;
      }
    }
    // New array reference so the machine-list drawer (mf-config-panel) and the
    // detail card re-render with the updated in-place state / KPI values.
    if (touched) this.machines = [...this.machines];
  }

  private applyDpValue(target: DpTarget, raw: unknown): boolean {
    const machine = this.machines.find((m) => m.id === target.machineId);
    if (!machine) return false;
    if (target.kind === 'state') {
      // Fall back to the assigned mapping, else the atelier's first mapping,
      // else the built-in default — never leave the value unmapped (which would
      // always resolve to "ok").
      const mapping =
        this.mappings.find((mp) => mp.id === machine.stateMappingId) ??
        this.mappings[0] ??
        DEFAULT_STATE_MAPPINGS[0];
      // State codes are discrete: cast float datapoints to the nearest integer
      // so e.g. 2.0 (or 1.999…) matches the mapping rule for 2.
      machine.state = resolveState(mapping, Math.round(toNumber(raw)));
      this.scene?.updateMachineLive(machine.id, { state: machine.state });
      return true;
    }
    if (target.kind === 'kpi') {
      const kpis = machine.kpis ?? [];
      const kpi = kpis[target.kpiIndex ?? -1];
      if (!kpi) return false;
      kpi.value = scalarValue(raw);
      this.scene?.updateMachineLive(machine.id, { kpis });
      return true;
    }
    if (target.kind === 'kpiCalc') {
      const id = target.kpiCalcId;
      if (id == null) return false;
      const value = toNumber(raw);
      const kpiCalcValues = { ...machine.kpiCalcValues, [id]: value };
      machine.kpiCalcValues = kpiCalcValues;
      // Colour TRS values by their threshold band (value is already a percentage).
      let kpiCalcColors = machine.kpiCalcColors;
      const kpi = (machine.kpiCalcs ?? []).find((k) => k.id === id);
      if (kpi?.type === 'TRS') {
        const config = this.thresholds.find((t) => t.id === kpi.thresholdId) ?? this.thresholds[0];
        kpiCalcColors = { ...machine.kpiCalcColors, [id]: resolveTrsColor(config, value) };
        machine.kpiCalcColors = kpiCalcColors;
      }
      this.scene?.updateMachineLive(machine.id, { kpiCalcValues, kpiCalcColors });
      return true;
    }
    if (target.kind === 'comm') {
      machine.connected = resolveConnected(raw);
      this.scene?.updateMachineLive(machine.id, { connected: machine.connected });
      return true;
    }
    if (target.kind === 'tilt') {
      const angle = toNumber(raw);
      machine.tiltAngle = angle;
      const TILT_INVERT_MAX = 90;
      const effective = machine.tiltInvert ? TILT_INVERT_MAX - angle : angle;
      this.scene?.updateMachineLive(machine.id, { tiltAngle: effective });
      return true;
    }
    // Production tracking DPs (stop cause, work order, operation).
    const value = scalarValue(raw);
    if (target.kind === 'stopCause') {
      machine.stopCause = value;
      machine.stopCauseLabel = formatStopCause(this.stopCauses, value);
      this.scene?.updateMachineLive(machine.id, {
        stopCause: value,
        stopCauseLabel: machine.stopCauseLabel
      });
    } else if (target.kind === 'workOrder') {
      machine.workOrder = value;
      this.scene?.updateMachineLive(machine.id, { workOrder: value });
    } else if (target.kind === 'alarmCode') {
      machine.alarmCode = value;
      this.scene?.updateMachineLive(machine.id, { alarmCode: value });
    } else {
      machine.operation = value;
      this.scene?.updateMachineLive(machine.id, { operation: value });
    }
    return true;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function viewStyles() {
  return css`
    :host {
      display: block;
      height: 100%;
      background: transparent;
    }
    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .ai-strip {
      display: block;
      padding: 0.5rem 0.75rem 0;
    }
    .topbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
    }
    .topbar .title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .topbar .title-input {
      min-width: 12rem;
    }
    .topbar-spacer {
      flex: 1;
    }
    .stage {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
    .viewport {
      position: relative;
      flex: 1;
      min-width: 0;
      overflow: hidden;
      border-radius: var(--theme-default-border-radius);
    }
    canvas:focus:not(:focus-visible) {
      outline: none;
    }
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
    }
    .overlay-layer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      gap: 0.25rem;
      flex-shrink: 0;
    }
    .import-input {
      display: none;
    }
    .filters {
      padding: 0.4rem 0.75rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .viewbar {
      position: absolute;
      bottom: 0.75rem;
      left: 50%;
      transform: translateX(-50%);
      z-index: 7;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 0.25rem;
      max-width: 70%;
      padding: 0.2rem 0.75rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--theme-color-1) 55%, transparent);
      backdrop-filter: blur(3px);
      opacity: 0.7;
      transition: opacity 0.15s ease;
    }
    .viewbar:hover {
      opacity: 1;
    }
    .viewbar-icon {
      color: var(--theme-color-soft-text);
      margin: 0 0.2rem;
    }
    .nav {
      position: absolute;
      z-index: 7;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem;
      background: transparent;
      border: none;
      box-shadow: none;
      opacity: 0.5;
      transition: opacity 0.15s ease;
    }
    .nav--bottom-right {
      bottom: 0.75rem;
      right: 0.75rem;
    }
    .nav--bottom-left {
      bottom: 0.75rem;
      left: 0.75rem;
    }
    .nav--top-right {
      top: 0.75rem;
      right: 0.75rem;
    }
    .nav--top-left {
      top: 0.75rem;
      left: 0.75rem;
    }
    .nav:hover {
      opacity: 1;
    }
    .nav-pad {
      display: grid;
      grid-template-columns: repeat(3, auto);
      gap: 0.05rem;
      justify-items: center;
      align-items: center;
    }
    .nav-zoom {
      display: flex;
      gap: 0.25rem;
    }
    .nav-views {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      justify-content: center;
      max-width: 9.5rem;
    }
    .mode-toggle {
      display: flex;
      width: 4.75rem;
      margin: 0.25rem auto 0;
      border: 1px solid var(--theme-color-primary);
      border-radius: var(--theme-default-border-radius);
      overflow: hidden;
    }
    .mode-btn {
      flex: 1;
      padding: 0.2rem 0;
      font-size: 0.72rem;
      font-weight: 600;
      border: none;
      background: transparent;
      color: var(--theme-color-primary);
      cursor: pointer;
    }
    .mode-btn--on {
      background: var(--theme-color-primary);
      color: var(--theme-color-primary-contrast, #fff);
    }
    .stats {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-left: 0.75rem;
      font-weight: 700;
      white-space: nowrap;
    }
    .stat {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      color: var(--theme-color-std-text);
    }
    .stat__dot {
      width: 0.65rem;
      height: 0.65rem;
      border-radius: 50%;
      background: var(--c);
    }
    .stat__label {
      font-weight: 400;
      color: var(--theme-color-soft-text);
    }
    .stat--fault {
      --c: var(--theme-color-alarm);
    }
    .stat--stop {
      --c: var(--theme-color-warning);
    }
    .stat--prod {
      --c: var(--theme-color-success);
    }
    .stat--offline {
      --c: var(--theme-color-neutral);
    }
    .mf-label__resize,
    .mf-label__reset {
      display: none;
    }
    .mf-label--editable {
      cursor: move;
      overflow: visible;
    }
    .mf-label--editable .mf-label__resize {
      display: block;
      position: absolute;
      right: -0.3rem;
      bottom: -0.3rem;
      width: 0.8rem;
      height: 0.8rem;
      cursor: nwse-resize;
      background: var(--theme-color-primary);
      border-radius: 2px;
    }
    .mf-label--editable.mf-label--manual .mf-label__reset {
      display: block;
      position: absolute;
      top: -0.6rem;
      right: -0.6rem;
      width: 1.2rem;
      height: 1.2rem;
      padding: 0;
      font-size: 0.8rem;
      line-height: 1;
      cursor: pointer;
      color: var(--theme-color-std-text);
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 50%;
    }
    .vp-pages {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
      font-size: 0.85rem;
    }
    .pin-edit {
      position: absolute;
      z-index: 10;
      display: flex;
      align-items: flex-end;
      gap: 0.25rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      padding: 0.5rem;
    }
    .mf-pin {
      position: absolute;
      top: 0;
      left: 0;
      display: flex;
      align-items: flex-end;
      gap: 0.2rem;
      /* The icon's tip on the anchor: shifted up by its height, left by half its width. */
      margin: -2rem 0 0 -1rem;
      pointer-events: auto;
      cursor: grab;
      z-index: 7;
      user-select: none;
    }
    .mf-pin__icon {
      color: var(--theme-color-alarm);
      filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.6));
    }
    .mf-pin__name {
      margin-bottom: 1.2rem;
      padding: 0.05rem 0.35rem;
      font-size: 0.75rem;
      font-weight: 700;
      white-space: nowrap;
      color: var(--theme-color-std-text);
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .mf-pin--ghost {
      opacity: 0.7;
      pointer-events: none;
    }
    .viewpoints {
      position: absolute;
      top: 0.5rem;
      left: 0.5rem;
      z-index: 9;
      width: 240px;
      max-width: 70%;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      padding: 0.5rem;
    }
    .vp-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .vp-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      max-height: 40vh;
      overflow-y: auto;
    }
    .vp-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .vp-name {
      flex: 1;
      cursor: pointer;
      padding: 0.2rem 0.3rem;
      border-radius: var(--theme-default-border-radius);
      display: flex;
      align-items: center;
      gap: 0.3rem;
    }
    .vp-default-badge {
      color: var(--theme-color-primary);
    }
    .vp-input {
      flex: 1;
    }
    .vp-name:hover {
      background: var(--theme-color-1);
    }
    .drawer {
      position: relative;
      width: 340px;
      max-width: 48%;
      flex-shrink: 0;
      height: 100%;
      background: var(--theme-color-1);
      border-left: 1px solid var(--theme-color-soft-bdr);
      overflow: hidden;
    }
    .detail {
      position: absolute;
      bottom: 0.75rem;
      left: 0.75rem;
      width: 360px;
      max-width: 70%;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
      padding: 0.75rem;
      z-index: 8;
    }
    .detail__head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      min-width: 0;
    }
    .detail__head .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .detail__head .dot {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .detail__head ix-chip,
    .detail__head ix-icon-button {
      flex-shrink: 0;
    }
    .detail__kpis {
      margin-top: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .detail__offline {
      margin-top: 0.5rem;
      padding: 0.3rem 0.5rem;
      border-radius: var(--theme-default-border-radius);
      font-weight: 600;
      text-align: center;
      color: var(--c, var(--theme-color-soft-text));
      border: 1px solid var(--c, var(--theme-color-soft-bdr));
      background: color-mix(in srgb, var(--c) 14%, transparent);
    }
    .detail__info {
      margin-top: 0.5rem;
      padding-top: 0.5rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .kpi {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.75rem;
      padding: 0.25rem 0;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .kpi:last-child {
      border-bottom: none;
    }
    .kpi__label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .kpi__value {
      flex-shrink: 0;
      text-align: right;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .dash-btn {
      display: block;
      width: 100%;
      margin-top: 0.6rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .mf-dot {
      position: absolute;
      top: 0;
      left: 0;
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
      background: var(--mf-state, var(--theme-color-primary));
      border: 2px solid color-mix(in srgb, var(--mf-state, var(--theme-color-primary)) 35%, #fff);
      box-shadow: 0 0 6px rgba(0, 0, 0, 0.6);
      pointer-events: auto;
      cursor: pointer;
      z-index: 6;
    }
    .mf-leader {
      position: absolute;
      top: 0;
      left: 0;
      height: 0;
      border-top: 1px solid var(--mf-state, var(--theme-color-primary));
      transform-origin: 0 0;
      opacity: 0.55;
      pointer-events: none;
      z-index: 5;
      transition:
        border-top-width 0.1s ease,
        opacity 0.1s ease;
    }
    .mf-leader--hover {
      border-top-width: 3px;
      opacity: 1;
      z-index: 8;
    }
    .mf-label {
      position: absolute;
      top: 0;
      left: 0;
      box-sizing: border-box;
      width: 13.194em;
      pointer-events: auto;
      cursor: pointer;
      z-index: 7;
      background: color-mix(in srgb, var(--theme-color-1) 86%, transparent);
      border: 1px solid var(--mf-state, var(--theme-color-primary));
      border-left: 3px solid var(--mf-state, var(--theme-color-primary));
      border-radius: var(--theme-default-border-radius);
      padding: 0.625em 0.764em;
      /* One third larger than the first 0.72rem (#59); every size inside is in em, so a
       * machine's own bubble scale (--mf-bubble-scale) enlarges the whole bubble. */
      font-size: calc(0.96rem * var(--mf-bubble-scale, 1));
      line-height: 1.35;
      overflow: hidden;
      color: var(--theme-color-std-text);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      gap: 0.417em;
    }
    .mf-label__name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mf-label__lines {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.417em;
      width: 100%;
    }
    .mf-label__badge:not(:empty) {
      align-self: flex-start;
      padding: 0.139em 0.625em;
      border-radius: 0.972em;
      font-size: 0.944em;
      font-weight: 600;
      color: var(--mf-state, var(--theme-color-primary));
      border: 1px solid var(--mf-state, var(--theme-color-primary));
      background: color-mix(in srgb, var(--mf-state) 16%, transparent);
    }
    .mf-label__to-place {
      align-self: flex-start;
      padding: 0.139em 0.625em;
      border-radius: 0.417em;
      font-size: 0.944em;
      font-weight: 700;
      color: var(--theme-color-std-text);
      border: 1px dashed var(--theme-color-warning);
      background: color-mix(in srgb, var(--theme-color-warning) 22%, transparent);
    }
    .mf-dot--to-place {
      outline: 2px dashed var(--theme-color-warning);
      outline-offset: 2px;
    }
    .mf-label__cause:not(:empty) {
      font-size: 0.917em;
      font-weight: 600;
      color: var(--mf-state, var(--theme-color-std-text));
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mf-label__kpi-line {
      color: var(--theme-color-soft-text);
      font-variant-numeric: tabular-nums;
      max-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mf-label__trs:not(:empty) {
      align-self: flex-start;
      padding: 0.139em 0.625em;
      border-radius: 0.417em;
      font-size: 1em;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--theme-color-std-text);
      background: color-mix(in srgb, var(--mf-trs, var(--theme-color-primary)) 22%, transparent);
      border: 1px solid var(--mf-trs, var(--theme-color-primary));
    }
    .mf-label__prod-line {
      align-self: stretch;
      padding: 0.278em 0.556em;
      border-left: 2px solid var(--theme-color-primary);
      border-radius: 0.278em;
      background: color-mix(in srgb, var(--theme-color-primary) 14%, transparent);
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .mf-label--dot {
      width: 0.7rem;
      height: 0.7rem;
      padding: 0;
      gap: 0;
      border-radius: 50%;
      background: var(--mf-state, var(--theme-color-primary));
      border: none;
    }
    .mf-label--dot .mf-label__name,
    .mf-label--dot .mf-label__badge,
    .mf-label--dot .mf-label__trs,
    .mf-label--dot .mf-label__cause,
    .mf-label--dot .mf-label__prod,
    .mf-label--dot .mf-label__kpi {
      display: none;
    }
  `;
}
