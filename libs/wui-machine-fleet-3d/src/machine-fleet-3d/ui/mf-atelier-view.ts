/**
 * 3D view of a single atelier: the Three.js scene plus the integrated config UI
 * (building dialog, per-machine dialog with DP bindings, state-mapping dialog,
 * right drawer, detail card) and live datapoint binding.
 *
 * Driven by an `Atelier` object passed in by the page shell. Edits update local
 * working copies and emit a debounced `wui:save` carrying the full atelier; a
 * back button emits `wui:back`. The Three.js scene modules are reused as-is.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { DashboardService } from '@wincc-oa/wui-dashboard-data/services/dashboard/dashboard.service.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { Subscription, firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import {
  buildDashboardSettings,
  buildMachineWidgets,
  isMachineWidget
} from '../data/dashboard-export.js';
import { normDp, toNumber } from '../data/dp-utils.js';
import type { FleetStore } from '../data/fleet-store.js';
import { canEditFleet, canEditFleet$ } from '../data/permissions.js';
import { SceneController } from '../scene/scene-controller.js';
import {
  DEFAULT_NAV_CORNER,
  DEFAULT_STATE_MAPPINGS,
  DEFAULT_TRS_THRESHOLDS,
  DISCONNECTED_LABEL,
  KPI_TYPE_INFO,
  STATE_LABELS,
  formatStopCause,
  MAX_DASHBOARD_LINKS,
  isDisconnected,
  resolveConnected,
  resolveDashboardMode,
  resolveDisplaySlots,
  resolveState,
  resolveStateColors,
  resolveTrsColor,
  stateColor,
  type Atelier,
  type DisplaySlot,
  type BuildingConfig,
  type DashboardOption,
  type DisplayConfig,
  type GlbResource,
  type Machine,
  type MachineDef,
  type StateMapping,
  type StopCause,
  type TrsThresholds,
  type Viewpoint
} from '../types.js';
import './mf-ai-prompt.js';
import './mf-building-dialog.js';
import './mf-config-panel.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './mf-graphics-catalog.js';
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

  @query('canvas') private canvasEl!: HTMLCanvasElement;
  @query('.overlay-layer') private overlayEl!: HTMLElement;
  @query('.viewport') private viewportEl!: HTMLElement;
  @query('.import-input') private importInput!: HTMLInputElement;

  @state() private building!: BuildingConfig;
  @state() private display!: DisplayConfig;
  @state() private machines: MachineDef[] = [];
  @state() private mappings: StateMapping[] = [];
  @state() private thresholds: TrsThresholds[] = [];
  @state() private thresholdsOpen = false;
  /** Right machine-list drawer — hidden by default; shown on demand. */
  @state() private panelOpen = false;
  @state() private selectedId: string | null = null;
  /** Machine whose built-in dashboard overlay is open (null = closed). */
  @state() private dashboardMachineId: string | null = null;
  /** Scene camera mode: 3D (perspective) or 2D (orthographic plan). */
  @state() private cameraMode: '2d' | '3d' = '3d';
  @state() private editing: MachineDef | null = null;
  @state() private buildingOpen = false;
  @state() private mappingOpen = false;
  @state() private atelierName = '';
  @state() private renaming = false;
  @state() private confirmDeleteOpen = false;
  @state() private viewpoints: Viewpoint[] = [];
  @state() private defaultViewpointId = '';
  @state() private viewpointsOpen = false;
  @state() private renamingVpId: string | null = null;
  @state() private vpRenameValue = '';
  @state() private glbResources: GlbResource[] = [];
  @state() private billboardResources: GlbResource[] = [];
  @state() private resourcesOpen = false;
  @state() private editMode = false;
  @state() private dashboards: DashboardOption[] = [];
  @state() private stopCauses: StopCause[] = [];
  /** Edit permission (canPublish); when false the UI is view-only. */
  @state() private canEdit = canEditFleet();

  private scene: SceneController | null = null;
  private permSub = new Subscription();
  private resizeObserver: ResizeObserver | null = null;
  private visibility: IntersectionObserver | null = null;
  private readonly api = this.resolveApi();
  private dpSubscription = new Subscription();
  // One DP can drive several targets (e.g. the same DP bound to the state AND a
  // KPI of the same machine), so each key maps to a LIST of targets.
  private dpTargets = new Map<string, DpTarget[]>();
  /** Bumped each (re)subscribe so stale async validation results are ignored. */
  private subGen = 0;
  private saveTimer = 0;
  private loaded = false;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.saveTimer);
    this.resizeObserver?.disconnect();
    this.visibility?.disconnect();
    this.dpSubscription.unsubscribe();
    this.permSub.unsubscribe();
    this.scene?.dispose();
    this.scene = null;
  }

  override render(): TemplateResult {
    if (!this.building || !this.display) return html``;
    return html`
      <div class="page">
        <div class="topbar">
          <ix-icon-button ghost icon="arrow-left" title="Retour aux ateliers" @click=${this.back}></ix-icon-button>
          ${this.renaming
            ? html`<ix-input
                  class="title-input"
                  .value=${this.atelierName}
                  @valueChange=${(e: CustomEvent<string>) => (this.atelierName = String(e.detail))}
                  @keydown=${this.onRenameKey}
                ></ix-input>
                <ix-icon-button ghost icon="check" title="Valider" @click=${this.commitRename}></ix-icon-button>`
            : html`<ix-typography class="title" format="h3">${this.atelierName || 'Atelier'}</ix-typography>
                ${this.canEdit
                  ? html`<ix-icon-button ghost icon="pen" title="Renommer l'atelier" @click=${this.startRename}></ix-icon-button>`
                  : ''}`}
          <span class="topbar-spacer"></span>
          ${this.renderToolbar()}
          ${this.canEdit
            ? html`<ix-icon-button ghost icon="trashcan" title="Supprimer l'atelier" @click=${() => (this.confirmDeleteOpen = true)}></ix-icon-button>`
            : ''}
          <mf-ai-prompt></mf-ai-prompt>
        </div>
        <div class="stage">
          <div class="viewport">
            <canvas></canvas>
            <div class="overlay-layer"></div>
            ${this.renderViewpoints()} ${this.renderDetail()} ${this.renderNav()}
            ${this.renderViewBar()}
          </div>
          ${this.renderPanel()}
        </div>
        ${this.renderDialogs()}
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('atelier') && this.atelier && !this.loaded) {
      this.loaded = true;
      this.atelierName = this.atelier.name;
      this.building = structuredClone(this.atelier.building);
      this.display = structuredClone(this.atelier.display);
      this.machines = structuredClone(this.atelier.machines);
      this.mappings = structuredClone(this.atelier.mappings);
      this.thresholds = structuredClone(this.atelier.trsThresholds ?? DEFAULT_TRS_THRESHOLDS);
      this.viewpoints = structuredClone(this.atelier.viewpoints ?? []);
      this.defaultViewpointId = this.atelier.defaultViewpointId ?? '';
    }
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    this.scene = new SceneController(
      this.canvasEl,
      this.overlayEl,
      this.viewportEl,
      (id) => this.onSelect(id)
    );
    const store = this.store;
    if (store) {
      this.scene.setResourceResolver((ref) => store.readResourceDataUrl(ref));
      void this.loadResources();
    }
    void this.loadDashboards();
    void this.loadStopCauses();
    this.scene.setOnMachineMove((id, x, z) => this.onMachineMove(id, x, z));
    this.scene.setOnRotate(this.onCameraRotate);
    this.scene.setBuilding(this.building);
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

    // Re-evaluate the edit permission once the user settings load (canPublish).
    this.permSub = canEditFleet$().subscribe((allowed) => {
      this.canEdit = allowed;
      if (!allowed && this.editMode) this.toggleEditMode();
    });
  }

  private renderToolbar(): TemplateResult {
    return html`
      <div class="toolbar">
        <ix-icon-button icon="undo" ghost title="Réinitialiser la vue" @click=${() => this.scene?.resetView()}></ix-icon-button>
        ${this.canEdit
          ? html`<ix-icon-button icon="move" ghost title="Mode édition (déplacer les machines)" variant=${this.editMode ? 'primary' : 'secondary'} @click=${this.toggleEditMode}></ix-icon-button>`
          : ''}
        <ix-icon-button icon="home" ghost title="Toiture du bâtiment" variant=${this.display.roof ? 'primary' : 'secondary'} @click=${() => this.onDisplay({ ...this.display, roof: !this.display.roof })}></ix-icon-button>
        <ix-icon-button icon="label" ghost title="Étiquettes des machines" variant=${this.display.labels ? 'primary' : 'secondary'} @click=${() => this.onDisplay({ ...this.display, labels: !this.display.labels })}></ix-icon-button>
        <ix-icon-button icon="warning" ghost title="Afficher seulement les alertes" variant=${this.display.alertOnly ? 'primary' : 'secondary'} @click=${() => this.onDisplay({ ...this.display, alertOnly: !this.display.alertOnly })}></ix-icon-button>
        <ix-icon-button icon="document" ghost title="Afficher l'OF et l'opération sur les bulles" variant=${this.display.production ? 'primary' : 'secondary'} @click=${() => this.onDisplay({ ...this.display, production: !this.display.production })}></ix-icon-button>
        <ix-icon-button icon="screenshot" ghost title="Points de vue" variant=${this.viewpointsOpen ? 'primary' : 'secondary'} @click=${() => (this.viewpointsOpen = !this.viewpointsOpen)}></ix-icon-button>
        <ix-icon-button icon="box-open" ghost title="Catalogue de graphiques (GLB / billboards)" @click=${() => (this.resourcesOpen = true)}></ix-icon-button>
        <ix-icon-button icon="building1" ghost title="Configurer le bâtiment" @click=${() => (this.buildingOpen = true)}></ix-icon-button>
        <ix-icon-button icon="configuration" ghost title="Mappings d'état" @click=${() => (this.mappingOpen = true)}></ix-icon-button>
        ${this.canEdit
          ? html`<ix-icon-button icon="upload" ghost title="Importer l'atelier (JSON)" @click=${this.triggerImport}></ix-icon-button>`
          : ''}
        <ix-icon-button icon="download" ghost title="Exporter l'atelier (JSON)" @click=${this.exportAtelier}></ix-icon-button>
        <ix-icon-button icon="app-menu" ghost title="Machines" variant=${this.panelOpen ? 'primary' : 'secondary'} @click=${() => (this.panelOpen = !this.panelOpen)}></ix-icon-button>
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
          <ix-icon-button ghost icon="chevron-up" title="Incliner vers le haut" @click=${() => this.scene?.orbitBy(0, -TILT_STEP)}></ix-icon-button>
          <span></span>
          <ix-icon-button ghost icon="chevron-left" title="Pivoter à gauche" @click=${() => this.scene?.orbitBy(-ORBIT_STEP, 0)}></ix-icon-button>
          <ix-icon-button ghost icon="home" title="Vue par défaut" @click=${() => this.goHome()}></ix-icon-button>
          <ix-icon-button ghost icon="chevron-right" title="Pivoter à droite" @click=${() => this.scene?.orbitBy(ORBIT_STEP, 0)}></ix-icon-button>
          <span></span>
          <ix-icon-button ghost icon="chevron-down" title="Incliner vers le bas" @click=${() => this.scene?.orbitBy(0, TILT_STEP)}></ix-icon-button>
          <span></span>
        </div>
        <div class="nav-zoom">
          <ix-icon-button ghost icon="zoom-in" title="Zoom avant" @click=${() => this.scene?.zoomBy(ZOOM_IN)}></ix-icon-button>
          <ix-icon-button ghost icon="zoom-out" title="Zoom arrière" @click=${() => this.scene?.zoomBy(ZOOM_OUT)}></ix-icon-button>
        </div>
        <div class="nav-views">
          <ix-button outline @click=${() => this.applyPreset('top')}>Dessus</ix-button>
          <ix-button outline @click=${() => this.applyPreset('front')}>Face</ix-button>
          <ix-button outline @click=${() => this.applyPreset('side')}>Côté</ix-button>
          <ix-button outline @click=${() => this.applyPreset('iso')}>Iso</ix-button>
        </div>
        <div class="mode-toggle" role="group" title="Vue 3D (perspective) / 2D (dessus)">
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

  /** User rotated the camera: leave 2D (plan) mode automatically, keeping angle. */
  private readonly onCameraRotate = (): void => {
    if (this.cameraMode === '2d') this.switchCamera('3d');
  };

  /** Camera-preset button: changing to a non-top angle leaves 2D for 3D first. */
  private applyPreset(preset: 'top' | 'front' | 'side' | 'iso'): void {
    if (this.cameraMode === '2d' && preset !== 'top') this.switchCamera('3d');
    this.scene?.setView(preset);
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

  private renderViewpoints(): TemplateResult {
    if (!this.viewpointsOpen) return html``;
    return html`
      <div class="viewpoints">
        <div class="vp-head">
          <span>Points de vue</span>
          ${this.canEdit
            ? html`<ix-button variant="secondary" @click=${this.saveViewpoint}>
                <ix-icon name="plus" slot="icon"></ix-icon>Enregistrer la vue
              </ix-button>`
            : ''}
        </div>
        ${this.viewpoints.length === 0
          ? html`<div class="muted">Aucun point de vue enregistré</div>`
          : html`<div class="vp-list">
              ${this.viewpoints.map((vp) => this.renderViewpointRow(vp))}
            </div>`}
      </div>
    `;
  }

  private renderViewpointRow(vp: Viewpoint): TemplateResult {
    if (this.renamingVpId === vp.id) {
      return html`<div class="vp-row">
        <ix-input
          class="vp-input"
          .value=${this.vpRenameValue}
          @valueChange=${(e: CustomEvent<string>) => (this.vpRenameValue = String(e.detail))}
          @keydown=${(e: KeyboardEvent) => this.onVpRenameKey(e, vp)}
        ></ix-input>
        <ix-icon-button ghost size="16" icon="check" title="Valider" @click=${() => this.commitVpRename(vp)}></ix-icon-button>
      </div>`;
    }
    const isDefault = vp.id === this.defaultViewpointId;
    return html`<div class="vp-row">
      <span class="vp-name" title="Aller à cette vue" @click=${() => this.applyViewpoint(vp)}>
        ${vp.name}${isDefault ? html`<ix-icon class="vp-default-badge" name="star-filled" size="12"></ix-icon>` : ''}
      </span>
      ${this.canEdit
        ? html`<ix-icon-button
              ghost
              size="16"
              icon=${isDefault ? 'star-filled' : 'star'}
              variant=${isDefault ? 'primary' : 'secondary'}
              title=${isDefault
                ? 'Vue par défaut au chargement (cliquer pour retirer)'
                : 'Définir comme vue par défaut au chargement'}
              @click=${() => this.setDefaultViewpoint(vp.id)}
            ></ix-icon-button>
            <ix-icon-button ghost size="16" icon="refresh" title="Actualiser depuis la vue caméra actuelle" @click=${() => this.updateViewpoint(vp.id)}></ix-icon-button>
            <ix-icon-button ghost size="16" icon="pen" title="Renommer" @click=${() => this.startVpRename(vp)}></ix-icon-button>
            <ix-icon-button ghost size="16" icon="trashcan" title="Supprimer" @click=${() => this.deleteViewpoint(vp.id)}></ix-icon-button>`
        : ''}
    </div>`;
  }

  private renderPanel(): TemplateResult {
    if (!this.panelOpen) return html``;
    return html`
      <div class="drawer">
        <mf-config-panel
          .machines=${this.machines}
          .canEdit=${this.canEdit}
          @wui:focus=${(e: CustomEvent<{ id: string }>) => this.onFocus(e.detail.id)}
          @wui:edit=${(e: CustomEvent<{ id: string }>) => this.onEdit(e.detail.id)}
          @wui:delete=${(e: CustomEvent<{ id: string }>) => this.onDelete(e.detail.id)}
          @wui:add=${() => this.onAdd()}
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
          <ix-icon-button ghost icon=${this.canEdit ? 'pen' : 'eye'} title=${this.canEdit ? 'Éditer' : 'Visualiser'} @click=${() => this.onEdit(m.id)}></ix-icon-button>
          <ix-icon-button ghost icon="close" title="Fermer" @click=${() => (this.selectedId = null)}></ix-icon-button>
        </div>
        ${offline
          ? html`<div class="detail__offline" style="--c:${stateColor(mapping, 'disconnected')}">${DISCONNECTED_LABEL}</div>`
          : this.renderInfoRows(m)}
        ${this.renderDashboardLink(m)}
      </div>
    `;
  }

  private renderDashboardLink(m: Machine): TemplateResult {
    // Always offer a dashboard: the built-in contextualised one, or — when the
    // machine is configured for it — a specific WinCC OA dashboard. Plus any
    // custom URL links (each opens in a new tab).
    const links = (m.dashboardLinks ?? [])
      .filter((l) => l.url.trim() !== '')
      .slice(0, MAX_DASHBOARD_LINKS);
    return html`
      <ix-button class="dash-btn" variant="primary" @click=${() => this.openMachineDashboard(m)}>
        <ix-icon name="ontology" slot="icon"></ix-icon>Ouvrir le tableau de bord
      </ix-button>
      ${links.map(
        (l) => html`<ix-button
          class="dash-btn"
          variant="secondary"
          icon=${l.icon || 'ontology'}
          title=${l.url}
          @click=${() => this.openLink(l.url)}
        >${l.label || 'Lien'}</ix-button>`
      )}
    `;
  }

  /** Open a configured dashboard-link URL in a new browser tab. */
  private openLink(raw: string): void {
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
    if (rows.length === 0) return html`<div class="muted">Aucune information</div>`;
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
        label: 'État',
        value: STATE_LABELS[m.state],
        style: `color:${stateColor(this.mappingFor(m), m.state)};font-weight:700`
      };
    }
    if (slot.kind === 'stopCause') {
      const cause = m.state === 'ok' ? undefined : (m.stopCauseLabel || m.stopCause);
      return cause != null && cause !== '' ? { label: "Cause d'arrêt", value: cause } : null;
    }
    if (slot.kind === 'workOrder') {
      return m.workOrder != null && m.workOrder !== ''
        ? { label: 'OF en cours', value: m.workOrder }
        : null;
    }
    if (slot.kind === 'operation') {
      return m.operation != null && m.operation !== ''
        ? { label: 'Opération', value: m.operation }
        : null;
    }
    if (slot.kind === 'param') {
      const p = slot.param;
      if (!p) return null;
      const value = `${p.value ?? '—'}${p.value != null && p.unit ? ` ${p.unit}` : ''}`;
      return { label: p.label || slot.label, value };
    }
    // kind === 'kpi'
    const k = slot.kpi;
    if (!k) return null;
    const v = (m.kpiCalcValues ?? {})[k.id];
    const info = KPI_TYPE_INFO[k.type];
    const value = v == null ? '—' : `${Number.isInteger(v) ? v : v.toFixed(2)} ${info.unit}`;
    const color = (m.kpiCalcColors ?? {})[k.id];
    return { label: slot.label, value, style: color ? `color:${color};font-weight:700` : '' };
  }

  private renderDialogs(): TemplateResult {
    return html`
      ${this.buildingOpen
        ? html`<mf-building-dialog
            .building=${this.building}
            .canEdit=${this.canEdit}
            @wui:apply=${(e: CustomEvent<{ building: BuildingConfig }>) => this.onBuilding(e.detail.building)}
            @wui:close=${() => (this.buildingOpen = false)}
          ></mf-building-dialog>`
        : ''}
      ${this.editing
        ? html`<mf-machine-dialog
            .machine=${this.editing}
            .store=${this.store}
            .mappings=${this.mappings}
            .thresholds=${this.thresholds}
            .glbResources=${this.glbResources}
            .billboardResources=${this.billboardResources}
            .dashboards=${this.dashboards}
            .canEdit=${this.canEdit}
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
            .canEdit=${this.canEdit}
            @wui:apply=${(e: CustomEvent<{ mappings: StateMapping[] }>) => this.onMappings(e.detail.mappings)}
            @wui:close=${() => (this.mappingOpen = false)}
          ></mf-state-mapping-dialog>`
        : ''}
      ${this.thresholdsOpen
        ? html`<mf-trs-thresholds-dialog
            .thresholds=${this.thresholds}
            .canEdit=${this.canEdit}
            @wui:apply=${(e: CustomEvent<{ thresholds: TrsThresholds[] }>) => this.onThresholds(e.detail.thresholds)}
            @wui:close=${() => (this.thresholdsOpen = false)}
          ></mf-trs-thresholds-dialog>`
        : ''}
      ${this.confirmDeleteOpen
        ? html`<wui-confirm-dialog
            heading="Supprimer l'atelier"
            message=${`Supprimer définitivement l'atelier « ${this.atelierName} » et son datapoint ?`}
            @wui:confirm=${this.confirmDelete}
            @wui:cancel=${() => (this.confirmDeleteOpen = false)}
          ></wui-confirm-dialog>`
        : ''}
      ${this.resourcesOpen
        ? html`<mf-graphics-catalog
            .store=${this.store}
            .canEdit=${this.canEdit}
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
    if (resolveDashboardMode(m) === 'oa' && m.dashboardId != null) {
      this.dispatchEvent(new RouterEvent(`/dashboard/${m.dashboardId}`));
      return;
    }
    this.dashboardMachineId = m.id;
  }

  /** Resolve the state mapping bound to a machine (for the dashboard Gantt). */
  private mappingFor(m: Machine): StateMapping {
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

  /** Push the resolved state/overlay colours to the scene (dots, leaders, bubbles). */
  private applyStateColors(): void {
    this.scene?.setStateColors(resolveStateColors(this.primaryMapping()));
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
      const kept = (dashboard.widgets ?? []).filter((w) => !isMachineWidget(w, machine.id));
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
  }

  private onMachineMove(id: string, x: number, z: number): void {
    this.machines = this.machines.map((m) =>
      m.id === id ? { ...m, x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 } : m
    );
    this.scheduleSave();
  }

  private onDisplay(display: DisplayConfig): void {
    this.display = display;
    this.applyDisplay();
    this.scheduleSave();
  }

  private onBuilding(building: BuildingConfig): void {
    this.building = building;
    this.scene?.setBuilding(building);
    this.buildingOpen = false;
    this.scheduleSave();
  }

  private onAdd(): void {
    const def: MachineDef = {
      id: `machine-${Date.now()}`,
      name: 'Nouvelle machine',
      type: 'cabinet',
      x: 0,
      z: 0,
      state: 'ok',
      kpis: []
    };
    this.machines = [...this.machines, def];
    this.editing = def;
    this.rebuildMachines();
  }

  private onEdit(id: string): void {
    const m = this.machines.find((x) => x.id === id);
    if (m) this.editing = { ...m, kpis: (m.kpis ?? []).map((k) => ({ ...k })) };
  }

  private onMachineApply(machine: MachineDef): void {
    this.machines = this.machines.map((m) => (m.id === machine.id ? machine : m));
    this.editing = null;
    this.rebuildMachines();
  }

  private onDelete(id: string): void {
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

  private onThresholds(thresholds: TrsThresholds[]): void {
    this.thresholds = thresholds;
    this.thresholdsOpen = false;
    this.scheduleSave();
  }

  private applyDisplay(): void {
    this.scene?.setRoofVisible(this.display.roof);
    this.scene?.setLabelsEnabled(this.display.labels);
    this.scene?.setAlertOnly(this.display.alertOnly);
    this.scene?.setShowProduction(this.display.production ?? false);
  }

  private rebuildMachines(): void {
    this.scene?.setMachines(this.machines);
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

  private saveViewpoint(): void {
    if (!this.scene) return;
    const pose = this.scene.captureView();
    this.viewpoints = [
      ...this.viewpoints,
      {
        id: `vp-${Date.now()}`,
        name: `Vue ${this.viewpoints.length + 1}`,
        pos: pose.pos,
        target: pose.target
      }
    ];
    this.scheduleSave();
  }

  private applyViewpoint(vp: Viewpoint): void {
    this.scene?.applyView(vp.pos, vp.target);
  }

  /** Overwrite a saved viewpoint's pose with the current camera plane. */
  private updateViewpoint(id: string): void {
    if (!this.scene) return;
    const pose = this.scene.captureView();
    this.viewpoints = this.viewpoints.map((v) =>
      v.id === id ? { ...v, pos: pose.pos, target: pose.target } : v
    );
    this.scheduleSave();
  }

  /** The viewpoint configured as default for this atelier, if it still exists. */
  private defaultViewpoint(): Viewpoint | undefined {
    return this.defaultViewpointId
      ? this.viewpoints.find((v) => v.id === this.defaultViewpointId)
      : undefined;
  }

  /** Apply the configured default viewpoint, if any, when the view first loads. */
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

  /** Toggle a viewpoint as the one applied on load (canPublish-gated in the UI). */
  private setDefaultViewpoint(id: string): void {
    this.defaultViewpointId = this.defaultViewpointId === id ? '' : id;
    this.scheduleSave();
  }

  private deleteViewpoint(id: string): void {
    this.viewpoints = this.viewpoints.filter((v) => v.id !== id);
    if (this.defaultViewpointId === id) this.defaultViewpointId = '';
    this.scheduleSave();
  }

  private startVpRename(vp: Viewpoint): void {
    this.renamingVpId = vp.id;
    this.vpRenameValue = vp.name;
  }

  private onVpRenameKey(e: KeyboardEvent, vp: Viewpoint): void {
    if (e.key === 'Enter') this.commitVpRename(vp);
    else if (e.key === 'Escape') this.renamingVpId = null;
  }

  private commitVpRename(vp: Viewpoint): void {
    const name = this.vpRenameValue.trim();
    this.renamingVpId = null;
    if (name === '' || name === vp.name) return;
    this.viewpoints = this.viewpoints.map((v) => (v.id === vp.id ? { ...v, name } : v));
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
      viewpoints: this.viewpoints,
      defaultViewpointId: this.defaultViewpointId || undefined
    };
  }

  private scheduleSave(): void {
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
    this.scene?.setBuilding(this.building);
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
      width: 9.5rem;
      pointer-events: auto;
      cursor: pointer;
      z-index: 7;
      background: color-mix(in srgb, var(--theme-color-1) 86%, transparent);
      border: 1px solid var(--mf-state, var(--theme-color-primary));
      border-left: 3px solid var(--mf-state, var(--theme-color-primary));
      border-radius: var(--theme-default-border-radius);
      padding: 0.45rem 0.55rem;
      font-size: 0.72rem;
      line-height: 1.35;
      overflow: hidden;
      color: var(--theme-color-std-text);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4);
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
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
      gap: 0.3rem;
      width: 100%;
    }
    .mf-label__badge:not(:empty) {
      align-self: flex-start;
      padding: 0.1rem 0.45rem;
      border-radius: 0.7rem;
      font-size: 0.68rem;
      font-weight: 600;
      color: var(--mf-state, var(--theme-color-primary));
      border: 1px solid var(--mf-state, var(--theme-color-primary));
      background: color-mix(in srgb, var(--mf-state) 16%, transparent);
    }
    .mf-label__cause:not(:empty) {
      font-size: 0.66rem;
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
      padding: 0.1rem 0.45rem;
      border-radius: 0.3rem;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--theme-color-std-text);
      background: color-mix(in srgb, var(--mf-trs, var(--theme-color-primary)) 22%, transparent);
      border: 1px solid var(--mf-trs, var(--theme-color-primary));
    }
    .mf-label__prod-line {
      align-self: stretch;
      padding: 0.2rem 0.4rem;
      border-left: 2px solid var(--theme-color-primary);
      border-radius: 0.2rem;
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
