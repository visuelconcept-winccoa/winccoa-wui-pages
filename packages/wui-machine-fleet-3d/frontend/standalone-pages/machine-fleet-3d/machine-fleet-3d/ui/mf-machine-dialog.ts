/**
 * Modal dialog to edit one machine: identity + geometry, the state-datapoint
 * binding (with a selectable state mapping), and up to MAX_PARAMS KPI
 * parameters, each bound to a datapoint, one of which can be highlighted in the
 * machine's floating bubble.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import {
  DEFAULT_TRS_REFRESH_MIN,
  DEFAULT_TRS_WINDOW,
  DASHBOARD_LINK_ICONS,
  DASHBOARD_MODE_LABEL,
  DEFAULT_DASHBOARD_LINK_ICON,
  DISPLAY_KIND_LABEL,
  KPI_TYPE_INFO,
  MACHINE_PROCESS_LABEL,
  MAX_DASHBOARD_LINKS,
  MAX_PARAMS,
  PORTIQUE_SPANS,
  TRS_WINDOW_LABELS,
  resolveDashboardMode,
  resolveDisplaySlots,
  resolveProcess,
  type DashboardLink,
  type DashboardMode,
  type DashboardOption,
  type DisplayEntry,
  type DisplaySlot,
  type GlbResource,
  type Kpi,
  type KpiType,
  type MachineDef,
  type MachineKpi,
  type MachineProcess,
  type MachineType,
  type PortiqueSize,
  type StateMapping,
  type TrsThresholds,
  type TrsWindow
} from '../types.js';
import '../../_vendor/wui-kit/ui/wui-dp-input.js';
import { SEMIFAB_ICONS } from '../data/semifab-icons.js';
import type { FleetStore } from '../data/fleet-store.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string | number;
}
interface IxCheckedEvent {
  detail: boolean;
}

/** The gantry-with-rotary-table machine type (referenced in several places). */
const PORTIQUE_TABLE: MachineType = 'portique-table';

const MACHINE_TYPES: MachineType[] = [
  'four',
  'robot',
  'positionneur',
  'tour',
  'fraiseuse',
  'scie',
  'brocheuse',
  'ressuage',
  'portique',
  PORTIQUE_TABLE,
  'basculeur',
  'cabinet',
  'billboard',
  'glb'
];

const PORTIQUE_SIZES: PortiqueSize[] = ['XS', 'S', 'M', 'L', 'XL'];
const MACHINE_PROCESSES: MachineProcess[] = ['generic', 'usinage', 'soudage'];
const DASHBOARD_MODES: DashboardMode[] = ['default', 'oa'];
/** Tab labels for the machine dialog (wrapping bar, no overflow arrows). */
const TAB_LABELS = [
  'Général',
  'État & production',
  'Paramètres',
  'Dashboard',
  'Archivage',
  'KPI',
  'Affichage'
];
const TRS_WINDOWS = Object.keys(TRS_WINDOW_LABELS) as TrsWindow[];
const KPI_TYPES = Object.keys(KPI_TYPE_INFO) as KpiType[];
/** Built-in SemiFab icon library + the "no library" bucket (billboard picker). */
const SEMIFAB_LIB = 'SemiFab';
const UNCLASSIFIED_LIB = '__none__';
const TRS_REFRESH_MIN_BOUND = 1;
const TRS_REFRESH_MAX_BOUND = 1440;
const ROTATIONS = [0, 45, 90, 135, 180, 225, 270, 315];
const HEIGHT_BASE = 3;
const HEIGHT_FACTOR = 0.45;
const LEG_BASE = 0.5;
const LEG_FACTOR = 0.03;
const BASCULEUR_DEFAULTS = { w: 4, h: 3.5, d: 3 };

@customElement('mf-machine-dialog')
export class MfMachineDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) machine!: MachineDef;
  @property({ attribute: false }) mappings: StateMapping[] = [];
  @property({ attribute: false }) thresholds: TrsThresholds[] = [];
  @property({ attribute: false }) glbResources: GlbResource[] = [];
  @property({ attribute: false }) billboardResources: GlbResource[] = [];
  @property({ attribute: false }) dashboards: DashboardOption[] = [];
  @property({ attribute: false }) store: FleetStore | null = null;
  /** When false, the dialog is view-only: saving is disabled. */
  @property({ type: Boolean }) canEdit = true;

  @query('.import-input') private importInput!: HTMLInputElement;

  /** Local working copy — re-seeded only when a different machine is opened, so
   * frequent parent re-renders (live datapoint updates) never discard edits. */
  @state() private working!: MachineDef;
  @state() private tab = 0;
  /** Index of the dashboard-link row whose icon picker is open (-1 = none). */
  @state() private iconPickerRow = -1;
  @state() private archiveGroups: string[] = [];
  @state() private archiveStatus = new Map<string, { enabled: boolean; group: string }>();
  /** Selected billboard library filter ('' = SemiFab built-in, else a library). */
  @state() private bbLibrary = '';
  /** Resolved data URLs for imported billboard previews, keyed by resource id. */
  @state() private bbPreviews: Record<string, string> = {};

  override render(): TemplateResult {
    if (!this.working) return html``;
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">Édition — ${this.working.name}</ix-typography>
            <span class="head-spacer"></span>
            <ix-icon-button
              ghost
              icon="upload"
              title="Importer la machine (JSON)"
              @click=${this.triggerImport}
            ></ix-icon-button>
            <ix-icon-button
              ghost
              icon="download"
              title="Exporter la machine (JSON)"
              @click=${this.exportMachine}
            ></ix-icon-button>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <input
            type="file"
            accept="application/json,.json"
            class="import-input"
            @change=${this.onImportFile}
          />
          <div class="dialog-tabs" role="tablist">
            ${TAB_LABELS.map(
              (label, i) => html`<button
                type="button"
                role="tab"
                class="dtab ${this.tab === i ? 'dtab--active' : ''}"
                aria-selected=${this.tab === i ? 'true' : 'false'}
                @click=${() => this.onTab(i)}
              >
                ${label}
              </button>`
            )}
          </div>
          <div class="panel-body">
            ${this.tab === 0
              ? html`${this.renderIdentity()} ${this.renderAppearance()} ${this.renderPortique()}
                  ${this.renderBasculeur()} ${this.renderBillboard()} ${this.renderGlb()}`
              : ''}
            ${this.tab === 1 ? html`${this.renderState()} ${this.renderProduction()}` : ''}
            ${this.tab === 2 ? this.renderParams() : ''}
            ${this.tab === 3 ? this.renderDashboard() : ''}
            ${this.tab === 4 ? this.renderArchiving() : ''}
            ${this.tab === 5 ? this.renderKpi() : ''}
            ${this.tab === 6 ? this.renderDisplay() : ''}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${this.canEdit ? 'Annuler' : 'Fermer'}</ix-button>
            ${this.canEdit
              ? html`<ix-button @click=${this.apply}>Enregistrer</ix-button>`
              : ''}
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('machine') && this.machine && this.working?.id !== this.machine.id) {
      this.working = structuredClone(this.machine);
      this.tab = 0;
      this.iconPickerRow = -1;
      this.archiveStatus = new Map();
      this.bbLibrary = this.initialBbLibrary();
    }
    if (changed.has('billboardResources')) void this.loadBillboardPreviews();
  }

  /** Pick the library tab to open for the current billboard selection. */
  private initialBbLibrary(): string {
    const ref = this.machine?.billboardUrl ?? '';
    const res = this.billboardResources.find((r) => r.ref === ref);
    if (res) return res.library || UNCLASSIFIED_LIB;
    return SEMIFAB_LIB;
  }

  /** Resolve imported billboards' data URLs for the picker thumbnails. */
  private async loadBillboardPreviews(): Promise<void> {
    const store = this.store;
    if (!store) return;
    for (const r of this.billboardResources) {
      if (this.bbPreviews[r.id]) continue;
      // eslint-disable-next-line no-await-in-loop -- a handful of resources
      const url = await store.readResourceDataUrl(r.ref);
      if (url) this.bbPreviews = { ...this.bbPreviews, [r.id]: url };
    }
  }

  private onTab(index: number): void {
    this.tab = index;
    if (index === 4) void this.loadArchiving();
  }

  /** Datapoints bound to this machine, eligible for archiving. */
  private boundDps(): { label: string; dp: string }[] {
    const m = this.working;
    const rows: { label: string; dp?: string }[] = [
      { label: 'État machine', dp: m.stateDp },
      { label: 'Communication', dp: m.commDp },
      { label: "Cause d'arrêt", dp: m.stopCauseDp },
      { label: 'OF en cours', dp: m.workOrderDp },
      { label: 'Opération', dp: m.operationDp },
      { label: 'Angle basculement', dp: m.tiltDp },
      ...(m.kpis ?? []).map((k) => ({ label: k.label || k.key, dp: k.dp }))
    ];
    const seen = new Set<string>();
    const result: { label: string; dp: string }[] = [];
    for (const r of rows) {
      if (r.dp && !seen.has(r.dp)) {
        seen.add(r.dp);
        result.push({ label: r.label, dp: r.dp });
      }
    }
    return result;
  }

  private async loadArchiving(): Promise<void> {
    if (!this.store) return;
    this.archiveGroups = await this.store.listArchiveGroups();
    const status = new Map<string, { enabled: boolean; group: string }>();
    for (const { dp } of this.boundDps()) {
      // eslint-disable-next-line no-await-in-loop -- a handful of DPs, sequential is fine
      status.set(dp, await this.store.readArchiveStatus(dp));
    }
    this.archiveStatus = status;
  }

  private renderArchiving(): TemplateResult {
    if (!this.store) return html`<div class="hint">Backend indisponible.</div>`;
    const dps = this.boundDps();
    const kpis = this.working.kpiCalcs ?? [];
    if (dps.length === 0 && kpis.length === 0) {
      return html`<div class="hint">
        Aucun datapoint lié ni KPI configuré. Configurez d'abord les DP / KPI dans les autres onglets.
      </div>`;
    }
    return html`
      ${this.archiveGroups.length === 0
        ? html`<div class="hint">Aucun groupe d'archive actif découvert (type _NGA_Group).</div>`
        : ''}
      ${dps.length > 0
        ? html`<div class="subhead">Archivage NGA des datapoints</div>
            <div class="hint">
              Activez l'archivage et choisissez un groupe d'archive pour historiser ces datapoints
              (état machine, cause d'arrêt, paramètres…).
            </div>
            <div class="params">${dps.map((d) => this.renderArchiveRow(d))}</div>`
        : ''}
      ${kpis.length > 0
        ? html`<div class="subhead">Archivage des KPI temps réel</div>
            <div class="hint">
              Active l'archivage de la valeur calculée par le manager (pour tracer des courbes) et
              choisit le groupe d'archive.
            </div>
            <div class="params">${kpis.map((k, i) => this.renderKpiArchive(k, i))}</div>`
        : ''}
    `;
  }

  private renderArchiveRow(d: { label: string; dp: string }): TemplateResult {
    const st = this.archiveStatus.get(d.dp) ?? { enabled: false, group: '' };
    const group = st.group || this.archiveGroups[0] || '';
    return html`
      <div class="archive-row">
        <div class="archive-info">
          <span class="archive-label">${d.label}</span>
          <span class="archive-dp" title=${d.dp}>${d.dp}</span>
        </div>
        <ix-select
          class="archive-group"
          ?disabled=${this.archiveGroups.length === 0}
          .value=${group}
          @valueChange=${(e: IxValueEvent) => this.onArchiveGroup(d.dp, String(e.detail))}
        >
          ${this.archiveGroups.map((g) => html`<ix-select-item label=${g} value=${g}></ix-select-item>`)}
        </ix-select>
        <ix-toggle
          hide-text
          ?checked=${st.enabled}
          @checkedChange=${(e: IxCheckedEvent) => this.onArchiveToggle(d.dp, e.detail, group)}
        ></ix-toggle>
      </div>
    `;
  }

  private async onArchiveToggle(dp: string, enabled: boolean, group: string): Promise<void> {
    if (!this.store) return;
    if (enabled && group === '') return; // need a group to enable
    await this.store.setArchive(dp, enabled, group);
    await this.refreshArchive(dp);
  }

  private async onArchiveGroup(dp: string, group: string): Promise<void> {
    if (!this.store || group === '') return;
    await this.store.setArchive(dp, true, group);
    await this.refreshArchive(dp);
  }

  private async refreshArchive(dp: string): Promise<void> {
    if (!this.store) return;
    const st = await this.store.readArchiveStatus(dp);
    this.archiveStatus = new Map(this.archiveStatus).set(dp, st);
  }

  private renderKpi(): TemplateResult {
    const kpis = this.working.kpiCalcs ?? [];
    return html`
      <div class="subhead">KPI temps réel (calcul serveur, archivés)</div>
      <div class="hint">
        Chaque KPI est calculé côté serveur (manager kpiCalc) sur une fenêtre glissante et écrit
        dans un datapoint <em>archivé</em> — ce qui permet d'en tracer des courbes. Choisissez le
        type (la formule en découle), la période d'agrégation et la fréquence d'actualisation.
      </div>
      <div class="kpi-head">
        <span class="spacer"></span>
        <ix-button variant="secondary" @click=${this.addKpi}>
          <ix-icon name="plus" slot="icon"></ix-icon>Ajouter un KPI
        </ix-button>
      </div>
      ${kpis.length === 0
        ? html`<div class="hint">Aucun KPI configuré.</div>`
        : kpis.map((k, i) => this.renderKpiRow(k, i))}
      <ix-button class="link" variant="secondary" @click=${this.openThresholds}>
        <ix-icon name="cogwheel" slot="icon"></ix-icon>Gérer les seuils (couleurs)…
      </ix-button>
    `;
  }

  private renderKpiRow(k: MachineKpi, i: number): TemplateResult {
    return html`
      <div class="kpi-card">
        <div class="kpi-card-head">
          <span class="kpi-card-title">${KPI_TYPE_INFO[k.type].label}</span>
          <span class="spacer"></span>
          <ix-icon-button ghost size="16" icon="trashcan" title="Retirer ce KPI"
            @click=${() => this.removeKpi(i)}></ix-icon-button>
        </div>
        <div class="grid2">
          <ix-select
            label="Type (détermine la formule)"
            .value=${k.type}
            @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { type: String(e.detail) as KpiType })}
          >
            ${KPI_TYPES.map(
              (t) => html`<ix-select-item label=${KPI_TYPE_INFO[t].label} value=${t}></ix-select-item>`
            )}
          </ix-select>
          <ix-input
            label="Nom (optionnel)"
            .value=${k.label ?? ''}
            @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { label: String(e.detail) })}
          ></ix-input>
        </div>
        <div class="grid2">
          <ix-select
            label="Période d'agrégation (fenêtre glissante)"
            .value=${k.window}
            @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { window: String(e.detail) as TrsWindow })}
          >
            ${TRS_WINDOWS.map(
              (w) => html`<ix-select-item label=${TRS_WINDOW_LABELS[w]} value=${w}></ix-select-item>`
            )}
          </ix-select>
          <ix-number-input
            label="Actualisation (min)"
            min=${TRS_REFRESH_MIN_BOUND}
            max=${TRS_REFRESH_MAX_BOUND}
            .value=${k.refreshMin}
            @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { refreshMin: this.clampRefresh(Number(e.detail)) })}
          ></ix-number-input>
        </div>
        ${k.type === 'TRS'
          ? html`<ix-select
              label="Seuils (couleurs)"
              .value=${k.thresholdId ?? this.thresholds[0]?.id ?? ''}
              @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { thresholdId: String(e.detail) })}
            >
              ${this.thresholds.map(
                (t) => html`<ix-select-item label=${t.name} value=${t.id}></ix-select-item>`
              )}
            </ix-select>`
          : ''}
      </div>
    `;
  }

  /** Per-KPI archiving row (shown in the Archivage tab): enable/disable + NGA group. */
  private renderKpiArchive(k: MachineKpi, i: number): TemplateResult {
    const archive = k.archive !== false;
    const group = k.archiveGroup || this.archiveGroups[0] || '';
    const name = k.label && k.label !== '' ? k.label : KPI_TYPE_INFO[k.type].label;
    return html`
      <div class="archive-row">
        <div class="archive-info">
          <span class="archive-label">${name}</span>
          <span class="archive-dp">Valeur KPI calculée (courbes)</span>
        </div>
        <ix-select
          class="archive-group"
          ?disabled=${!archive || this.archiveGroups.length === 0}
          .value=${group}
          @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { archiveGroup: String(e.detail) })}
        >
          ${this.archiveGroups.map((g) => html`<ix-select-item label=${g} value=${g}></ix-select-item>`)}
        </ix-select>
        <ix-toggle
          hide-text
          ?checked=${archive}
          @checkedChange=${(e: IxCheckedEvent) =>
            this.patchKpi(i, { archive: e.detail, archiveGroup: e.detail ? group : k.archiveGroup })}
        ></ix-toggle>
      </div>
    `;
  }

  private readonly openThresholds = (): void => {
    this.dispatchEvent(new CustomEvent('wui:thresholds', { bubbles: true, composed: true }));
  };

  private readonly addKpi = (): void => {
    const kpi: MachineKpi = {
      id: `kpi-${Math.floor(Date.now()).toString(36)}-${(this.working.kpiCalcs ?? []).length}`,
      type: 'TRS',
      window: DEFAULT_TRS_WINDOW,
      refreshMin: DEFAULT_TRS_REFRESH_MIN,
      showInBubble: (this.working.kpiCalcs ?? []).length === 0,
      showInPopup: true,
      archive: true
    };
    this.patch({ kpiCalcs: [...(this.working.kpiCalcs ?? []), kpi] });
  };

  private removeKpi(i: number): void {
    this.patch({ kpiCalcs: (this.working.kpiCalcs ?? []).filter((_, idx) => idx !== i) });
  }

  private patchKpi(i: number, patch: Partial<MachineKpi>): void {
    this.patch({
      kpiCalcs: (this.working.kpiCalcs ?? []).map((k, idx) => (idx === i ? { ...k, ...patch } : k))
    });
  }

  private clampRefresh(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_TRS_REFRESH_MIN;
    return Math.min(TRS_REFRESH_MAX_BOUND, Math.max(TRS_REFRESH_MIN_BOUND, Math.round(value)));
  }

  private renderIdentity(): TemplateResult {
    const m = this.working;
    return html`
      <div class="subhead">Identité</div>
      <div class="grid2">
        <ix-input
          label="Nom"
          .value=${m.name}
          @valueChange=${(e: IxValueEvent) => this.patch({ name: String(e.detail) })}
        ></ix-input>
        <ix-select
          label="Type"
          .value=${m.type}
          @valueChange=${(e: IxValueEvent) => this.patch({ type: e.detail as MachineType })}
        >
          ${MACHINE_TYPES.map((t) => html`<ix-select-item label=${t} value=${t}></ix-select-item>`)}
        </ix-select>
        <ix-select
          label="Métier (paramètres simulés)"
          .value=${resolveProcess(m)}
          @valueChange=${(e: IxValueEvent) => this.patch({ process: e.detail as MachineProcess })}
        >
          ${MACHINE_PROCESSES.map(
            (p) => html`<ix-select-item label=${MACHINE_PROCESS_LABEL[p]} value=${p}></ix-select-item>`
          )}
        </ix-select>
        <ix-input
          label="Repère (ex. C7)"
          .value=${m.loc ?? ''}
          @valueChange=${(e: IxValueEvent) => this.patch({ loc: String(e.detail) })}
        ></ix-input>
        <div class="grid3">
          <ix-number-input
            label="X"
            .value=${m.x}
            @valueChange=${(e: IxValueEvent) => this.patch({ x: Number(e.detail) })}
          ></ix-number-input>
          <ix-number-input
            label="Z"
            .value=${m.z}
            @valueChange=${(e: IxValueEvent) => this.patch({ z: Number(e.detail) })}
          ></ix-number-input>
          <ix-number-input
            label="Hauteur"
            .value=${m.y ?? 0}
            @valueChange=${(e: IxValueEvent) => this.patch({ y: Number(e.detail) })}
          ></ix-number-input>
        </div>
      </div>
    `;
  }

  private renderAppearance(): TemplateResult {
    const m = this.working;
    const rotation = m.rotationY ?? 0;
    const color = m.color ?? '#3B82F6';
    return html`
      <div class="subhead">Apparence</div>
      <div class="grid2">
        <ix-select
          label="Rotation (axe vertical)"
          .value=${String(rotation)}
          @valueChange=${(e: IxValueEvent) => this.patch({ rotationY: Number(e.detail) })}
        >
          ${ROTATIONS.map((r) => html`<ix-select-item label=${`${r}°`} value=${String(r)}></ix-select-item>`)}
        </ix-select>
        <div class="color-field">
          <span class="color-label">Couleur</span>
          <div class="color-controls">
            <input
              type="color"
              class="color-input"
              .value=${color}
              @input=${(e: Event) => this.patch({ color: (e.target as HTMLInputElement).value })}
            />
            <ix-icon-button
              ghost
              icon="undo"
              title="Couleur par défaut"
              ?disabled=${m.color == null}
              @click=${() => this.patch({ color: undefined })}
            ></ix-icon-button>
          </div>
        </div>
      </div>
      ${this.labeledToggle('Afficher la machine dans la scène 3D', !m.hidden, (v) =>
        this.patch({ hidden: !v })
      )}
    `;
  }

  private labeledToggle(
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void
  ): TemplateResult {
    return html`
      <div class="toggle-row">
        <span>${label}</span>
        <ix-toggle
          hide-text
          ?checked=${checked}
          @checkedChange=${(e: IxCheckedEvent) => onChange(e.detail)}
        ></ix-toggle>
      </div>
    `;
  }

  /** "Affichage" tab — visibility (bubble / popup) and order for every info item. */
  private renderDisplay(): TemplateResult {
    const slots = resolveDisplaySlots(this.working);
    return html`
      <div class="subhead">Affichage (bulle &amp; popup)</div>
      <div class="hint">
        Pour chaque information (état, suivi de production, paramètres et KPI), choisissez sa
        visibilité dans la <strong>bulle</strong> machine et dans le <strong>popup</strong> (au clic),
        et réglez son <strong>ordre</strong> d'affichage avec les flèches.
      </div>
      <div class="disp-row disp-row--head">
        <span class="disp-label">Information</span>
        <span class="disp-tog">Bulle</span>
        <span class="disp-tog">Popup</span>
        <span class="disp-ord">Ordre</span>
      </div>
      <div class="disp-list">${slots.map((s, i) => this.renderDisplayRow(s, i, slots.length))}</div>
    `;
  }

  private renderDisplayRow(slot: DisplaySlot, i: number, count: number): TemplateResult {
    return html`
      <div class="disp-row">
        <span class="disp-label">
          ${slot.label}<em class="disp-kind">${DISPLAY_KIND_LABEL[slot.kind]}</em>
        </span>
        <ix-toggle
          class="disp-tog"
          hide-text
          ?checked=${slot.inBubble}
          @checkedChange=${(e: IxCheckedEvent) => this.patchDisplay(slot.ref, { inBubble: e.detail })}
        ></ix-toggle>
        <ix-toggle
          class="disp-tog"
          hide-text
          ?checked=${slot.inPopup}
          @checkedChange=${(e: IxCheckedEvent) => this.patchDisplay(slot.ref, { inPopup: e.detail })}
        ></ix-toggle>
        <span class="disp-ord">
          <ix-icon-button
            ghost
            size="16"
            icon="chevron-up"
            title="Monter"
            ?disabled=${i === 0}
            @click=${() => this.moveDisplay(i, -1)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="chevron-down"
            title="Descendre"
            ?disabled=${i === count - 1}
            @click=${() => this.moveDisplay(i, 1)}
          ></ix-icon-button>
        </span>
      </div>
    `;
  }

  /** Snapshot the resolved slots into `display`, overriding one item's visibility. */
  private patchDisplay(ref: string, patch: Partial<DisplayEntry>): void {
    const display: DisplayEntry[] = resolveDisplaySlots(this.working).map((s) => ({
      ref: s.ref,
      inBubble: s.ref === ref ? (patch.inBubble ?? s.inBubble) : s.inBubble,
      inPopup: s.ref === ref ? (patch.inPopup ?? s.inPopup) : s.inPopup
    }));
    this.patch({ display });
  }

  /** Move a display item up (dir = -1) or down (dir = +1). */
  private moveDisplay(i: number, dir: number): void {
    const display: DisplayEntry[] = resolveDisplaySlots(this.working).map((s) => ({
      ref: s.ref,
      inBubble: s.inBubble,
      inPopup: s.inPopup
    }));
    const j = i + dir;
    if (j < 0 || j >= display.length) return;
    [display[i], display[j]] = [display[j], display[i]];
    this.patch({ display });
  }

  private renderPortique(): TemplateResult {
    if (this.working.type !== 'portique' && this.working.type !== PORTIQUE_TABLE) return html``;
    const presetSpan = typeof this.working.variant === 'string'
      ? PORTIQUE_SPANS[this.working.variant as PortiqueSize]
      : undefined;
    const span = this.working.portiqueSpan ?? presetSpan ?? PORTIQUE_SPANS.M;
    const height = this.working.portiqueHeight ?? Math.round((HEIGHT_BASE + span * HEIGHT_FACTOR) * 10) / 10;
    const legW = this.working.portiqueLegW ?? Math.round((LEG_BASE + span * LEG_FACTOR) * 10) / 10;
    return html`
      <div class="subhead">Dimensions du portique</div>
      <div class="slider-field">
        <div class="slider-head"><span>Portée</span><span class="slider-val">${span} m</span></div>
        <ix-slider
          .value=${span}
          min="2"
          max="50"
          step="0.5"
          @valueChange=${(e: IxValueEvent) => this.patch({ portiqueSpan: Number(e.detail) })}
        ></ix-slider>
      </div>
      <div class="slider-field">
        <div class="slider-head"><span>Hauteur</span><span class="slider-val">${height} m</span></div>
        <ix-slider
          .value=${height}
          min="2"
          max="30"
          step="0.5"
          @valueChange=${(e: IxValueEvent) => this.patch({ portiqueHeight: Number(e.detail) })}
        ></ix-slider>
      </div>
      <div class="slider-field">
        <div class="slider-head"><span>Piliers</span><span class="slider-val">${legW} m</span></div>
        <ix-slider
          .value=${legW}
          min="0.3"
          max="5"
          step="0.1"
          @valueChange=${(e: IxValueEvent) => this.patch({ portiqueLegW: Number(e.detail) })}
        ></ix-slider>
      </div>
      <div class="preset-row">
        ${PORTIQUE_SIZES.map(
          (s) => html`<ix-chip
            outline
            class="preset-chip"
            @click=${() => this.patch({ portiqueSpan: PORTIQUE_SPANS[s], variant: s })}
            >${s} · ${PORTIQUE_SPANS[s]} m</ix-chip
          >`
        )}
      </div>
      ${this.working.type === PORTIQUE_TABLE ? this.renderTableDiameter() : ''}
    `;
  }

  private renderTableDiameter(): TemplateResult {
    const d = this.working.tableDiameter ?? 3;
    return html`
      <div class="slider-field">
        <div class="slider-head">
          <span>Diamètre de la table rotative</span><span class="slider-val">${d} m</span>
        </div>
        <ix-slider
          .value=${d}
          min="0.8"
          max="12"
          step="0.1"
          @valueChange=${(e: IxValueEvent) => this.patch({ tableDiameter: Number(e.detail) })}
        ></ix-slider>
      </div>
    `;
  }

  private renderBasculeur(): TemplateResult {
    if (this.working.type !== 'basculeur') return html``;
    const w = this.working.basculeurW ?? BASCULEUR_DEFAULTS.w;
    const h = this.working.basculeurH ?? BASCULEUR_DEFAULTS.h;
    const d = this.working.basculeurD ?? BASCULEUR_DEFAULTS.d;
    return html`
      <div class="subhead">Dimensions du basculeur</div>
      ${this.dimSlider('Largeur', w, 2, 10, (v) => this.patch({ basculeurW: v }))}
      ${this.dimSlider('Hauteur', h, 2, 8, (v) => this.patch({ basculeurH: v }))}
      ${this.dimSlider('Profondeur', d, 2, 8, (v) => this.patch({ basculeurD: v }))}
      <wui-dp-input
        label="DP angle de basculement (°, 0 = à plat)"
        .value=${this.working.tiltDp ?? ''}
        @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ tiltDp: e.detail.value })}
      ></wui-dp-input>
      ${this.labeledToggle(
        "Inverser l'angle d'animation (0 ↔ 90)",
        this.working.tiltInvert ?? false,
        (v) => this.patch({ tiltInvert: v })
      )}
    `;
  }

  // eslint-disable-next-line max-params -- a labelled slider needs its bounds
  private dimSlider(
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void
  ): TemplateResult {
    return html`
      <div class="slider-field">
        <div class="slider-head"><span>${label}</span><span class="slider-val">${value} m</span></div>
        <ix-slider
          .value=${value}
          min=${min}
          max=${max}
          step="0.5"
          @valueChange=${(e: IxValueEvent) => onChange(Number(e.detail))}
        ></ix-slider>
      </div>
    `;
  }

  private renderBillboard(): TemplateResult {
    if (this.working.type !== 'billboard') return html``;
    const size = this.working.billboardW ?? 6;
    return html`
      <div class="subhead">Icône (billboard)</div>
      <div class="hint">
        Choisissez une bibliothèque, puis l'icône représentant ce poste (ou importez-en via le
        catalogue).
      </div>
      <div class="bb-toolbar">
        <ix-select
          label="Bibliothèque"
          .value=${this.bbLibrary}
          @valueChange=${(e: IxValueEvent) => (this.bbLibrary = String(e.detail))}
        >
          ${this.billboardLibraryOptions().map(
            (o) => html`<ix-select-item label=${o.label} value=${o.value}></ix-select-item>`
          )}
        </ix-select>
        <ix-button class="link" variant="secondary" @click=${this.openResources}>
          <ix-icon name="folder" slot="icon"></ix-icon>Gérer le catalogue…
        </ix-button>
      </div>
      ${this.renderBillboardGallery()}
      <div class="slider-field">
        <div class="slider-head"><span>Taille</span><span class="slider-val">${size} m</span></div>
        <ix-slider
          .value=${size}
          min="2"
          max="20"
          step="1"
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ billboardW: Number(e.detail), billboardH: Number(e.detail) })}
        ></ix-slider>
      </div>
    `;
  }

  /** Library options for the billboard picker: SemiFab built-in + imported. */
  private billboardLibraryOptions(): { value: string; label: string }[] {
    const opts = [{ value: SEMIFAB_LIB, label: 'SemiFab (intégrée)' }];
    const libs = [...new Set(this.billboardResources.map((r) => r.library).filter(Boolean))].sort(
      (a, b) => String(a).localeCompare(String(b))
    );
    for (const l of libs) opts.push({ value: String(l), label: String(l) });
    if (this.billboardResources.some((r) => !r.library)) {
      opts.push({ value: UNCLASSIFIED_LIB, label: 'Importées (sans bibliothèque)' });
    }
    return opts;
  }

  /** Icon cells for the selected library. */
  private renderBillboardGallery(): TemplateResult {
    const sel = this.working.billboardUrl ?? '';
    if (this.bbLibrary === SEMIFAB_LIB) {
      return html`<div class="icon-grid">
        ${SEMIFAB_ICONS.map(
          (url) => html`<button
            type="button"
            class="icon-cell ${sel === url ? 'icon-cell--active' : ''}"
            title=${url.split('/').pop() ?? ''}
            @click=${() => this.patch({ billboardUrl: url })}
          >
            <img src=${url} alt="" loading="lazy" />
          </button>`
        )}
      </div>`;
    }
    const items = this.billboardResources.filter((r) =>
      this.bbLibrary === UNCLASSIFIED_LIB ? !r.library : r.library === this.bbLibrary
    );
    if (items.length === 0) return html`<div class="hint">Aucune ressource dans cette bibliothèque.</div>`;
    return html`<div class="icon-grid">
      ${items.map((r) => {
        const preview = this.bbPreviews[r.id];
        return html`<button
          type="button"
          class="icon-cell ${sel === r.ref ? 'icon-cell--active' : ''}"
          title=${r.name}
          @click=${() => this.patch({ billboardUrl: r.ref })}
        >
          ${preview ? html`<img src=${preview} alt="" />` : html`<ix-icon name="image"></ix-icon>`}
        </button>`;
      })}
    </div>`;
  }

  private renderGlb(): TemplateResult {
    if (this.working.type !== 'glb') return html``;
    return html`
      <div class="subhead">Modèle 3D (GLB)</div>
      <div class="glb-row">
        <ix-select
          class="glb-url"
          label="Ressource GLB"
          allow-clear
          .value=${this.working.glbUrl ?? ''}
          @valueChange=${(e: IxValueEvent) => this.patch({ glbUrl: e.detail ? String(e.detail) : undefined })}
        >
          ${this.glbResources.map(
            (r) => html`<ix-select-item label=${r.name} value=${r.ref}></ix-select-item>`
          )}
        </ix-select>
        <ix-button variant="secondary" @click=${this.openResources}>
          <ix-icon name="folder" slot="icon"></ix-icon>Gérer
        </ix-button>
      </div>
      ${this.glbResources.length === 0
        ? html`<div class="hint">Aucune ressource — cliquez « Gérer » pour importer un modèle GLB.</div>`
        : ''}
    `;
  }

  private openResources(): void {
    this.dispatchEvent(new CustomEvent('wui:resources', { bubbles: true, composed: true }));
  }

  private renderState(): TemplateResult {
    const m = this.working;
    return html`
      <div class="subhead">État machine</div>
      <div class="grid2">
        <wui-dp-input
          label="Datapoint d'état"
          .value=${m.stateDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ stateDp: e.detail.value })}
        ></wui-dp-input>
        <ix-select
          label="Mapping d'état"
          .value=${m.stateMappingId ?? ''}
          @valueChange=${(e: IxValueEvent) => this.patch({ stateMappingId: String(e.detail) })}
        >
          ${this.mappings.map(
            (mp) => html`<ix-select-item label=${mp.name} value=${mp.id}></ix-select-item>`
          )}
        </ix-select>
      </div>
      <ix-button class="link" variant="secondary" @click=${this.openMappings}>
        <ix-icon name="cogwheel" slot="icon"></ix-icon>Gérer les mappings d'état…
      </ix-button>
      <wui-dp-input
        label="DP communication (bool, ou int : 0 = hors ligne, ≥ 1 = connectée)"
        .value=${m.commDp ?? ''}
        @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ commDp: e.detail.value })}
      ></wui-dp-input>
    `;
  }

  private renderProduction(): TemplateResult {
    const m = this.working;
    return html`
      <div class="subhead">Suivi production</div>
      <div class="grid2">
        <wui-dp-input
          label="DP cause d'arrêt"
          .value=${m.stopCauseDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ stopCauseDp: e.detail.value })}
        ></wui-dp-input>
        <wui-dp-input
          label="DP OF en cours"
          .value=${m.workOrderDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ workOrderDp: e.detail.value })}
        ></wui-dp-input>
        <wui-dp-input
          label="DP opération en cours"
          .value=${m.operationDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ operationDp: e.detail.value })}
        ></wui-dp-input>
      </div>
    `;
  }

  private renderDashboard(): TemplateResult {
    const current = this.working.dashboardId;
    const mode = resolveDashboardMode(this.working);
    return html`
      <div class="subhead">Dashboard machine</div>
      <ix-select
        label="Tableau de bord ouvert depuis la fiche machine"
        .value=${mode}
        @valueChange=${(e: IxValueEvent) => this.patch({ dashboardMode: e.detail as DashboardMode })}
      >
        ${DASHBOARD_MODES.map(
          (dm) => html`<ix-select-item label=${DASHBOARD_MODE_LABEL[dm]} value=${dm}></ix-select-item>`
        )}
      </ix-select>
      ${mode === 'default'
        ? html`<div class="hint">
            Le tableau de bord machine intégré (Paramètres process, suivi alarmes, KPI : Gantt état
            + Pareto des arrêts) s'affiche, contextualisé avec cette machine. Aucune configuration
            requise.
          </div>`
        : html`
            ${this.dashboards.length > 0
              ? html`<ix-select
                  label="Dashboard WinCC OA lié"
                  allow-clear
                  .value=${current == null ? '' : String(current)}
                  @valueChange=${(e: IxValueEvent) => this.setDashboard(e.detail)}
                >
                  ${this.dashboards.map(
                    (d) => html`<ix-select-item label=${d.name} value=${String(d.id)}></ix-select-item>`
                  )}
                </ix-select>`
              : html`<ix-number-input
                  label="Numéro de dashboard"
                  .value=${current ?? ''}
                  @valueChange=${(e: IxValueEvent) => this.setDashboard(e.detail)}
                ></ix-number-input>`}
            <div class="dash-actions">
              <ix-button variant="secondary" @click=${this.createDashboard}>
                <ix-icon name="add-circle" slot="icon"></ix-icon>Créer un dashboard pour cette machine
              </ix-button>
              <ix-button
                variant="secondary"
                ?disabled=${current == null}
                title=${current == null ? 'Sélectionnez d’abord un dashboard' : 'Exporter les paramètres configurés'}
                @click=${this.exportDashboard}
              >
                <ix-icon name="upload" slot="icon"></ix-icon>Exporter les paramètres (État + KPI)
              </ix-button>
            </div>
          `}
      ${this.renderDashboardLinks()}
    `;
  }

  /** Configure up to MAX_DASHBOARD_LINKS custom URL buttons (shown in the popup). */
  private renderDashboardLinks(): TemplateResult {
    const links = this.working.dashboardLinks ?? [];
    return html`
      <div class="subhead">Liens externes (URL)</div>
      <div class="hint">
        Jusqu'à ${MAX_DASHBOARD_LINKS} liens s'affichent comme boutons dans la fiche machine
        (popup). Chaque lien s'ouvre dans un nouvel onglet.
      </div>
      <div class="kpi-head">
        <span class="spacer"></span>
        <ix-button
          variant="secondary"
          ?disabled=${links.length >= MAX_DASHBOARD_LINKS}
          @click=${this.addDashboardLink}
        >
          <ix-icon name="plus" slot="icon"></ix-icon>Ajouter un lien
        </ix-button>
      </div>
      ${links.length === 0
        ? html`<div class="hint">Aucun lien externe.</div>`
        : links.map((l, i) => this.renderDashboardLinkRow(l, i))}
    `;
  }

  private renderDashboardLinkRow(link: DashboardLink, i: number): TemplateResult {
    const icon = link.icon || DEFAULT_DASHBOARD_LINK_ICON;
    return html`
      <div class="kpi-card">
        <div class="kpi-card-head">
          <span class="kpi-card-title">${link.label || `Lien ${i + 1}`}</span>
          <span class="spacer"></span>
          <ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title="Retirer ce lien"
            @click=${() => this.removeDashboardLink(i)}
          ></ix-icon-button>
        </div>
        <div class="grid2">
          <ix-input
            label="Libellé du bouton"
            .value=${link.label}
            @valueChange=${(e: IxValueEvent) => this.patchDashboardLink(i, { label: String(e.detail) })}
          ></ix-input>
          <div class="icon-field">
            <span class="icon-field__label">Icône du bouton</span>
            <ix-button outline icon=${icon} @click=${() => this.toggleIconPicker(i)}>
              ${this.iconLabelFor(icon)}
            </ix-button>
            ${this.iconPickerRow === i
              ? html`<div class="icon-popover">
                  ${DASHBOARD_LINK_ICONS.map(
                    (ic) => html`<ix-icon-button
                      ghost
                      icon=${ic.value}
                      title=${ic.label}
                      class="icon-opt ${ic.value === icon ? 'icon-opt--sel' : ''}"
                      @click=${() => this.chooseIcon(i, ic.value)}
                    ></ix-icon-button>`
                  )}
                </div>`
              : ''}
          </div>
        </div>
        <ix-input
          label="URL (https://…)"
          placeholder="https://exemple.com/dashboard"
          .value=${link.url}
          @valueChange=${(e: IxValueEvent) => this.patchDashboardLink(i, { url: String(e.detail) })}
        ></ix-input>
      </div>
    `;
  }

  private toggleIconPicker(i: number): void {
    this.iconPickerRow = this.iconPickerRow === i ? -1 : i;
  }

  private chooseIcon(i: number, icon: string): void {
    this.patchDashboardLink(i, { icon });
    this.iconPickerRow = -1;
  }

  private iconLabelFor(icon: string): string {
    return DASHBOARD_LINK_ICONS.find((ic) => ic.value === icon)?.label ?? 'Choisir…';
  }

  private readonly addDashboardLink = (): void => {
    const links = this.working.dashboardLinks ?? [];
    if (links.length >= MAX_DASHBOARD_LINKS) return;
    this.patch({
      dashboardLinks: [...links, { label: '', icon: DEFAULT_DASHBOARD_LINK_ICON, url: '' }]
    });
  };

  private removeDashboardLink(i: number): void {
    this.patch({
      dashboardLinks: (this.working.dashboardLinks ?? []).filter((_, idx) => idx !== i)
    });
  }

  private patchDashboardLink(i: number, patch: Partial<DashboardLink>): void {
    this.patch({
      dashboardLinks: (this.working.dashboardLinks ?? []).map((l, idx) =>
        idx === i ? { ...l, ...patch } : l
      )
    });
  }

  private setDashboard(raw: string | number | null | undefined): void {
    const num = raw === '' || raw == null ? Number.NaN : Number(raw);
    this.patch({ dashboardId: Number.isFinite(num) ? num : undefined });
  }

  private createDashboard(): void {
    this.dispatchEvent(
      new CustomEvent('wui:dashboardcreate', {
        detail: { machine: this.working },
        bubbles: true,
        composed: true
      })
    );
  }

  private exportDashboard(): void {
    this.dispatchEvent(
      new CustomEvent('wui:dashboardexport', {
        detail: { machine: this.working },
        bubbles: true,
        composed: true
      })
    );
  }

  private renderParams(): TemplateResult {
    const params = this.working.kpis ?? [];
    return html`
      <div class="subhead">Paramètres (${params.length}/${MAX_PARAMS})</div>
      <div class="params">${params.map((p, i) => this.renderParamRow(p, i))}</div>
      <ix-button
        class="link"
        variant="secondary"
        ?disabled=${params.length >= MAX_PARAMS}
        @click=${this.addParam}
      >
        <ix-icon name="plus" slot="icon"></ix-icon>Ajouter un paramètre
      </ix-button>
    `;
  }

  private renderParamRow(p: Kpi, i: number): TemplateResult {
    return html`
      <div class="param-row">
        <ix-input
          class="p-label"
          placeholder="Libellé"
          .value=${p.label}
          @valueChange=${(e: IxValueEvent) => this.patchParam(i, { label: String(e.detail) })}
        ></ix-input>
        <wui-dp-input
          class="p-dp"
          .value=${p.dp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patchParam(i, { dp: e.detail.value })}
        ></wui-dp-input>
        <ix-input
          class="p-unit"
          placeholder="Unité"
          .value=${p.unit ?? ''}
          @valueChange=${(e: IxValueEvent) => this.patchParam(i, { unit: String(e.detail) })}
        ></ix-input>
        <ix-icon-button
          ghost
          icon="trashcan"
          title="Supprimer"
          @click=${() => this.removeParam(i)}
        ></ix-icon-button>
      </div>
    `;
  }

  private patch(patch: Partial<MachineDef>): void {
    this.working = { ...this.working, ...patch };
  }

  private patchParam(index: number, patch: Partial<Kpi>): void {
    const kpis = (this.working.kpis ?? []).map((k, i) => (i === index ? { ...k, ...patch } : k));
    this.patch({ kpis });
  }

  private addParam(): void {
    const kpis = [...(this.working.kpis ?? [])];
    if (kpis.length >= MAX_PARAMS) return;
    kpis.push({ key: `p${kpis.length + 1}`, label: 'Paramètre', showInCard: true });
    this.patch({ kpis });
  }

  private removeParam(index: number): void {
    const kpis = (this.working.kpis ?? []).filter((_, i) => i !== index);
    this.patch({ kpis });
  }

  private openMappings(): void {
    this.dispatchEvent(new CustomEvent('wui:mapping', { bubbles: true, composed: true }));
  }

  private apply(): void {
    this.dispatchEvent(
      new CustomEvent('wui:apply', {
        detail: { machine: this.working },
        bubbles: true,
        composed: true
      })
    );
  }

  private exportMachine(): void {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(this.working, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `machine-${this.working.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private triggerImport(): void {
    this.importInput.value = '';
    this.importInput.click();
  }

  private async onImportFile(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text()) as MachineDef;
      // Keep this machine's identity so it replaces the right one on save.
      this.working = { ...imported, id: this.working.id };
    } catch {
      // Invalid JSON — keep the current machine.
    }
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .link {
      margin-top: 0.5rem;
    }
    .disp-list {
      display: flex;
      flex-direction: column;
    }
    .disp-row {
      display: grid;
      grid-template-columns: 1fr 4rem 4rem 4.5rem;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.25rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .disp-row--head {
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .disp-row--head .disp-tog,
    .disp-row--head .disp-ord {
      text-align: center;
    }
    .disp-label {
      display: flex;
      flex-direction: column;
      line-height: 1.2;
    }
    .disp-kind {
      font-size: 0.7rem;
      font-style: normal;
      color: var(--theme-color-soft-text);
    }
    .disp-tog {
      justify-self: center;
    }
    .disp-ord {
      display: flex;
      justify-content: center;
      gap: 0.1rem;
    }
    .params {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .param-row {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .param-row .p-label {
      flex: 2;
    }
    .param-row .p-dp {
      flex: 3;
    }
    .param-row .p-unit {
      flex: 1;
    }
    .grid3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.5rem;
    }
    .glb-row {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
    }
    .glb-row .glb-url {
      flex: 1;
    }
    .glb-err {
      margin-top: 0.4rem;
      color: var(--theme-color-alarm);
      font-size: 0.85rem;
    }
    .dash-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
    .icon-field {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .icon-field__label {
      font-size: 0.78rem;
      color: var(--theme-color-soft-text);
    }
    .icon-popover {
      position: absolute;
      top: 100%;
      left: 0;
      z-index: 30;
      margin-top: 0.25rem;
      display: grid;
      grid-template-columns: repeat(5, 2.25rem);
      gap: 0.15rem;
      padding: 0.4rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    }
    .icon-opt--sel {
      background: color-mix(in srgb, var(--theme-color-primary) 24%, transparent);
      border-radius: var(--theme-default-border-radius);
    }
    .head-spacer {
      flex: 1;
    }
    .import-input {
      display: none;
    }
    .dialog-tabs {
      margin: 0 0 0.75rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .dtab {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--theme-color-soft-text);
      font: inherit;
      padding: 0.4rem 0.7rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      white-space: nowrap;
      border-radius: var(--theme-default-border-radius) var(--theme-default-border-radius) 0 0;
    }
    .dtab:hover {
      color: var(--theme-color-std-text);
      background: color-mix(in srgb, var(--theme-color-primary) 8%, transparent);
    }
    .dtab--active {
      color: var(--theme-color-primary);
      border-bottom-color: var(--theme-color-primary);
      font-weight: 600;
    }
    .icon-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, 64px);
      gap: 0.4rem;
      max-height: 240px;
      overflow-y: auto;
      padding: 0.25rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .icon-cell {
      width: 64px;
      height: 64px;
      padding: 0.2rem;
      background: var(--theme-color-2);
      border: 2px solid transparent;
      border-radius: var(--theme-default-border-radius);
      cursor: pointer;
    }
    .icon-cell:hover {
      border-color: var(--theme-color-soft-bdr);
    }
    .icon-cell--active {
      border-color: var(--theme-color-primary);
      background: color-mix(in srgb, var(--theme-color-primary) 14%, transparent);
    }
    .icon-cell img {
      width: 100%;
      height: 100%;
      object-fit: contain;
      pointer-events: none;
    }
    .bb-toolbar {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .bb-toolbar ix-select {
      flex: 1;
    }
    .icon-cell ix-icon {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--theme-color-soft-text);
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-top: 0.6rem;
    }
    .archive-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .archive-info {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .archive-label {
      font-weight: 600;
    }
    .archive-dp {
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .archive-group {
      width: 11rem;
      flex-shrink: 0;
    }
    .color-field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .color-label {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .color-controls {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .color-input {
      width: 3rem;
      height: 2rem;
      padding: 0;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: none;
      cursor: pointer;
    }
    .slider-field {
      margin-bottom: 0.6rem;
    }
    .slider-head {
      display: flex;
      justify-content: space-between;
      font-size: 0.85rem;
      margin-bottom: 0.2rem;
    }
    .slider-val {
      color: var(--theme-color-soft-text);
    }
    .preset-row {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      margin-top: 0.25rem;
    }
    .preset-chip {
      cursor: pointer;
    }
  `;
}
