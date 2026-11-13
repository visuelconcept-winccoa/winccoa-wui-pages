// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to edit one machine: identity + geometry, the state-datapoint
 * binding (with a selectable state mapping), its parameters, each bound to a
 * datapoint, and what its bubble and popup show (at most MAX_SHOWN lines each).
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
  MAX_SHOWN,
  PORTIQUE_SPANS,
  TRS_WINDOW_LABELS,
  appLinkHref,
  resolveDashboardMode,
  shownSlots,
  resolveProcess,
  shownCounts,
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
  placeFromMarker,
  type PlacementMarker,
  type StateMapping,
  type TrsThresholds,
  type TrsWindow
} from '../types.js';
import './mf-dp-field.js';
import './mf-graphic-picker.js';
import type { AliAssetInfo } from '../data/ali-assets.js';
import type { FleetStore } from '../data/fleet-store.js';
import { dialogStyles } from './dialog-styles.js';
import { overlayClicked, overlayDown } from '@visuelconcept-winccoa/wui-fleet-core/ui/overlay-dismiss.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { MSG, localize, localizeDir, linkFallbackMsg, dashboardLinksHintMsg, machineTypeLabel } from '../i18n.js';
import { nameTaken } from '../symbol-names.js';
import { dashboardTicks, isProcessSlot, type DashboardDisplayEntry } from '../dashboard-lines.js';
import { SYMBOL_SCALE_MAX, SYMBOL_SCALE_MIN, storedScale, symbolScale, type ScaledMachineDef } from '../symbol-scale.js';

interface IxValueEvent {
  detail: string | number;
}
interface IxCheckedEvent {
  detail: boolean;
}

/** The gantry-with-rotary-table machine type (referenced in several places). */
const PORTIQUE_TABLE: MachineType = 'portique-table';

export const MACHINE_TYPES: MachineType[] = [
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
const TAB_LABELS: MultiLangString[] = [
  MSG.machineDialog.tabGeneral,
  MSG.machineDialog.tabStateProduction,
  MSG.machineDialog.tabParams,
  MSG.machineDialog.tabDashboard,
  MSG.machineDialog.tabArchiving,
  MSG.machineDialog.tabKpi,
  MSG.machineDialog.tabDisplay
];
const TRS_WINDOWS = Object.keys(TRS_WINDOW_LABELS) as TrsWindow[];
const KPI_TYPES = Object.keys(KPI_TYPE_INFO) as KpiType[];
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
  /** The atelier's symbols, for the unique-name check (#276). */
  @property({ attribute: false }) siblings: ReadonlyArray<{ id: string; name: string }> = [];
  @property({ attribute: false }) mappings: StateMapping[] = [];
  @property({ attribute: false }) thresholds: TrsThresholds[] = [];
  /** Placement markers of the atelier, to place the machine from one (SDS 2.2 SL-IMP-02). */
  @property({ attribute: false }) markers: PlacementMarker[] = [];
  @property({ attribute: false }) glbResources: GlbResource[] = [];
  @property({ attribute: false }) billboardResources: GlbResource[] = [];
  @property({ attribute: false }) dashboards: DashboardOption[] = [];
  /** Assets from the Asset Lifecycle Intelligence module, for the État-tab link. */
  @property({ attribute: false }) aliAssets: AliAssetInfo[] = [];
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

  override render(): TemplateResult {
    if (!this.working) return html``;
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.close()}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.machineDialog.editTitlePrefix)} — ${this.working.name}</ix-typography>
            <span class="head-spacer"></span>
            <ix-icon-button
              ghost
              icon="download"
              title=${localize(MSG.machineDialog.importMachine)}
              @click=${this.triggerImport}
            ></ix-icon-button>
            <ix-icon-button
              ghost
              icon="upload"
              title=${localize(MSG.machineDialog.exportMachine)}
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
                ${localizeDir(label)}
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
            <ix-button variant="secondary" @click=${this.close}>${this.canEdit ? localizeDir(MSG.machineDialog.cancel) : localizeDir(MSG.machineDialog.close)}</ix-button>
            ${this.canEdit
              ? html`${this.nameError ? html`<span class="foot-error">${this.nameError}</span>` : ''}
                  <ix-button ?disabled=${this.nameError !== ''} @click=${this.apply}>${localizeDir(MSG.machineDialog.save)}</ix-button>`
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
      { label: localize(MSG.machineDialog.machineState), dp: m.stateDp },
      { label: localize(MSG.machineDialog.commLabel), dp: m.commDp },
      { label: localize(MSG.machineDialog.stopCauseLabel), dp: m.stopCauseDp },
      { label: localize(MSG.machineDialog.workOrderLabel), dp: m.workOrderDp },
      { label: localize(MSG.machineDialog.operationLabel), dp: m.operationDp },
      { label: localize(MSG.machineDialog.alarmCodeLabel), dp: m.alarmCodeDp },
      { label: localize(MSG.machineDialog.tiltAngleLabel), dp: m.tiltDp },
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
    if (!this.store) return html`<div class="hint">${localizeDir(MSG.machineDialog.backendUnavailable)}</div>`;
    const dps = this.boundDps();
    const kpis = this.working.kpiCalcs ?? [];
    if (dps.length === 0 && kpis.length === 0) {
      return html`<div class="hint">
        ${localizeDir(MSG.machineDialog.archivingEmpty)}
      </div>`;
    }
    return html`
      ${this.archiveGroups.length === 0
        ? html`<div class="hint">${localizeDir(MSG.machineDialog.noArchiveGroup)}</div>`
        : ''}
      ${dps.length > 0
        ? html`<div class="subhead">${localizeDir(MSG.machineDialog.archivingDpsTitle)}</div>
            <div class="hint">
              ${localizeDir(MSG.machineDialog.archivingDpsHint)}
            </div>
            <div class="params">${dps.map((d) => this.renderArchiveRow(d))}</div>`
        : ''}
      ${kpis.length > 0
        ? html`<div class="subhead">${localizeDir(MSG.machineDialog.archivingKpiTitle)}</div>
            <div class="hint">
              ${localizeDir(MSG.machineDialog.archivingKpiHint)}
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
      <div class="subhead">${localizeDir(MSG.machineDialog.kpiRealtimeTitle)}</div>
      <div class="hint">
        ${localizeDir(MSG.machineDialog.kpiRealtimeHint)}
      </div>
      <div class="kpi-head">
        <span class="spacer"></span>
        <ix-button variant="secondary" @click=${this.addKpi}>
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.addKpi)}
        </ix-button>
      </div>
      ${kpis.length === 0
        ? html`<div class="hint">${localizeDir(MSG.machineDialog.noKpi)}</div>`
        : kpis.map((k, i) => this.renderKpiRow(k, i))}
      <ix-button class="link" variant="secondary" @click=${this.openThresholds}>
        <ix-icon name="cogwheel" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.manageThresholds)}
      </ix-button>
    `;
  }

  private renderKpiRow(k: MachineKpi, i: number): TemplateResult {
    return html`
      <div class="kpi-card">
        <div class="kpi-card-head">
          <span class="kpi-card-title">${KPI_TYPE_INFO[k.type].label}</span>
          <span class="spacer"></span>
          <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.machineDialog.removeKpi)}
            @click=${() => this.removeKpi(i)}></ix-icon-button>
        </div>
        <div class="grid2">
          <ix-select
            label=${localize(MSG.machineDialog.kpiTypeLabel)}
            .value=${k.type}
            @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { type: String(e.detail) as KpiType })}
          >
            ${KPI_TYPES.map(
              (t) => html`<ix-select-item label=${KPI_TYPE_INFO[t].label} value=${t}></ix-select-item>`
            )}
          </ix-select>
          <ix-input
            label=${localize(MSG.machineDialog.kpiNameOptional)}
            .value=${k.label ?? ''}
            @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { label: String(e.detail) })}
          ></ix-input>
        </div>
        <div class="grid2">
          <ix-select
            label=${localize(MSG.machineDialog.kpiWindowLabel)}
            .value=${k.window}
            @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { window: String(e.detail) as TrsWindow })}
          >
            ${TRS_WINDOWS.map(
              (w) => html`<ix-select-item label=${TRS_WINDOW_LABELS[w]} value=${w}></ix-select-item>`
            )}
          </ix-select>
          <ix-number-input
            label=${localize(MSG.machineDialog.kpiRefreshLabel)}
            min=${TRS_REFRESH_MIN_BOUND}
            max=${TRS_REFRESH_MAX_BOUND}
            .value=${k.refreshMin}
            @valueChange=${(e: IxValueEvent) => this.patchKpi(i, { refreshMin: this.clampRefresh(Number(e.detail)) })}
          ></ix-number-input>
        </div>
        ${k.type === 'TRS'
          ? html`<ix-select
              label=${localize(MSG.machineDialog.kpiThresholdsLabel)}
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
          <span class="archive-dp">${localizeDir(MSG.machineDialog.kpiValueComputed)}</span>
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
      <div class="subhead">${localizeDir(MSG.machineDialog.identity)}</div>
      <div class="grid2">
        <ix-input
          label=${localize(MSG.machineDialog.fieldName)}
          class=${this.nameError ? 'ix-invalid' : ''}
          invalid-text=${this.nameError}
          .value=${m.name}
          @valueChange=${(e: IxValueEvent) => this.patch({ name: String(e.detail) })}
        ></ix-input>
        <ix-select
          label=${localize(MSG.machineDialog.fieldType)}
          .value=${m.type}
          @valueChange=${(e: IxValueEvent) => this.patch({ type: e.detail as MachineType })}
        >
          ${MACHINE_TYPES.map((t) => html`<ix-select-item label=${machineTypeLabel(t)} value=${t}></ix-select-item>`)}
        </ix-select>
        <ix-select
          label=${localize(MSG.machineDialog.processLabel)}
          .value=${resolveProcess(m)}
          @valueChange=${(e: IxValueEvent) => this.patch({ process: e.detail as MachineProcess })}
        >
          ${MACHINE_PROCESSES.map(
            (p) => html`<ix-select-item label=${MACHINE_PROCESS_LABEL[p]} value=${p}></ix-select-item>`
          )}
        </ix-select>
        <ix-input
          label=${localize(MSG.machineDialog.fieldLoc)}
          .value=${m.loc ?? ''}
          @valueChange=${(e: IxValueEvent) => this.patch({ loc: String(e.detail) })}
        ></ix-input>
        <ix-input
          label=${localize(MSG.machineDialog.cardTags)}
          helper-text=${localize(MSG.machineDialog.cardTagsHint)}
          .value=${(m.cardTags ?? []).join(', ')}
          @valueChange=${(e: IxValueEvent) => this.patchCardTags(String(e.detail))}
        ></ix-input>
        ${this.renderMarker()}
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
            label=${localize(MSG.machineDialog.fieldHeight)}
            .value=${m.y ?? 0}
            @valueChange=${(e: IxValueEvent) => this.patch({ y: Number(e.detail) })}
          ></ix-number-input>
        </div>
      </div>
    `;
  }

  /** Free tags of the machine in this atelier, typed comma-separated (cardTags). */
  private patchCardTags(raw: string): void {
    const tags = [...new Set(raw.split(',').map((t) => t.trim()).filter((t) => t !== ''))];
    this.patch({ cardTags: tags.length > 0 ? tags : undefined });
  }

  private renderAppearance(): TemplateResult {
    const m = this.working;
    const rotation = m.rotationY ?? 0;
    const color = m.color ?? '#3B82F6';
    return html`
      <div class="subhead">${localizeDir(MSG.machineDialog.appearance)}</div>
      <div class="grid2">
        <ix-select
          label=${localize(MSG.machineDialog.rotationLabel)}
          .value=${String(rotation)}
          @valueChange=${(e: IxValueEvent) => this.patch({ rotationY: Number(e.detail) })}
        >
          ${ROTATIONS.map((r) => html`<ix-select-item label=${`${r}°`} value=${String(r)}></ix-select-item>`)}
        </ix-select>
        <ix-number-input
          label=${localize(MSG.machineDialog.scaleLabel)}
          helper-text=${localize(MSG.machineDialog.scaleHint)}
          min=${SYMBOL_SCALE_MIN}
          max=${SYMBOL_SCALE_MAX}
          step="0.1"
          .value=${symbolScale(m as ScaledMachineDef)}
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ symbolScale: storedScale(Number(e.detail)) } as Partial<ScaledMachineDef>)}
        ></ix-number-input>
        <div class="color-field">
          <span class="color-label">${localizeDir(MSG.machineDialog.colour)}</span>
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
              title=${localize(MSG.machineDialog.defaultColour)}
              ?disabled=${m.color == null}
              @click=${() => this.patch({ color: undefined })}
            ></ix-icon-button>
          </div>
        </div>
      </div>
      ${this.labeledToggle(localize(MSG.machineDialog.showInScene), !m.hidden, (v) =>
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
    const slots = shownSlots(this.working);
    const ticks = dashboardTicks(this.working, slots);
    const shown = { ...shownCounts(slots), dashboard: [...ticks.values()].filter(Boolean).length };
    return html`
      <div class="subhead">${localizeDir(MSG.machineDialog.displayTitle)}</div>
      <div class="hint">
        ${localizeDir(MSG.machineDialog.displayHint)}
      </div>
      <div class="disp-row disp-row--head">
        <span class="disp-label">${localizeDir(MSG.machineDialog.colInformation)}</span>
        <span class="disp-tog">${localizeDir(MSG.machineDialog.colBubble)}<br />${shown.bubble} / ${MAX_SHOWN}</span>
        <span class="disp-tog">${localizeDir(MSG.machineDialog.colPopup)}<br />${shown.popup} / ${MAX_SHOWN}</span>
        <span class="disp-tog">${localizeDir(MSG.machineDialog.colDashboard)}<br />${shown.dashboard} / ${MAX_SHOWN}</span>
        <span class="disp-ord">${localizeDir(MSG.machineDialog.colOrder)}</span>
      </div>
      <div class="disp-list">${slots.map((s, i) => this.renderDisplayRow(s, i, slots.length, shown, ticks))}</div>
    `;
  }

  private renderDisplayRow(
    slot: DisplaySlot,
    i: number,
    count: number,
    shown: { bubble: number; popup: number; dashboard: number },
    ticks: Map<string, boolean>
  ): TemplateResult {
    // A line not shown yet cannot be ticked once MAX_SHOWN lines are: untick another first.
    const bubbleFull = !slot.inBubble && shown.bubble >= MAX_SHOWN;
    const popupFull = !slot.inPopup && shown.popup >= MAX_SHOWN;
    const inDashboard = ticks.get(slot.ref) === true;
    const dashboardFull = !inDashboard && shown.dashboard >= MAX_SHOWN;
    const fullTitle = localize(MSG.machineDialog.displayFull);
    return html`
      <div class="disp-row">
        <span class="disp-label">
          ${slot.label}<em class="disp-kind">${DISPLAY_KIND_LABEL[slot.kind]}</em>
        </span>
        <ix-toggle
          class="disp-tog"
          hide-text
          ?checked=${slot.inBubble}
          ?disabled=${bubbleFull}
          title=${bubbleFull ? fullTitle : ''}
          @checkedChange=${(e: IxCheckedEvent) => this.patchDisplay(slot.ref, { inBubble: e.detail })}
        ></ix-toggle>
        <ix-toggle
          class="disp-tog"
          hide-text
          ?checked=${slot.inPopup}
          ?disabled=${popupFull}
          title=${popupFull ? fullTitle : ''}
          @checkedChange=${(e: IxCheckedEvent) => this.patchDisplay(slot.ref, { inPopup: e.detail })}
        ></ix-toggle>
        ${isProcessSlot(slot)
          ? html`<ix-toggle
              class="disp-tog"
              hide-text
              ?checked=${inDashboard}
              ?disabled=${dashboardFull}
              title=${dashboardFull ? fullTitle : ''}
              @checkedChange=${(e: IxCheckedEvent) => this.patchDisplay(slot.ref, { inDashboard: e.detail })}
            ></ix-toggle>`
          : html`<span class="disp-tog disp-na">—</span>`}
        <span class="disp-ord">
          <ix-icon-button
            ghost
            size="16"
            icon="chevron-up"
            title=${localize(MSG.machineDialog.moveUp)}
            ?disabled=${i === 0}
            @click=${() => this.moveDisplay(i, -1)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="chevron-down"
            title=${localize(MSG.machineDialog.moveDown)}
            ?disabled=${i === count - 1}
            @click=${() => this.moveDisplay(i, 1)}
          ></ix-icon-button>
        </span>
      </div>
    `;
  }

  /**
   * The resolved slots as `display` entries, the dashboard tick of each process
   * parameter included (taken as resolved, so a default becomes explicit).
   */
  private displaySnapshot(): DashboardDisplayEntry[] {
    const slots = shownSlots(this.working);
    const ticks = dashboardTicks(this.working, slots);
    return slots.map((s) => ({
      ref: s.ref,
      inBubble: s.inBubble,
      inPopup: s.inPopup,
      ...(ticks.has(s.ref) ? { inDashboard: ticks.get(s.ref) } : {})
    }));
  }

  /** Snapshot the resolved slots into `display`, overriding one item's visibility. */
  private patchDisplay(ref: string, patch: Partial<DashboardDisplayEntry>): void {
    const display: DisplayEntry[] = this.displaySnapshot().map((e) => (e.ref === ref ? { ...e, ...patch } : e));
    this.patch({ display });
  }

  /** Move a display item up (dir = -1) or down (dir = +1). */
  private moveDisplay(i: number, dir: number): void {
    const display: DisplayEntry[] = this.displaySnapshot();
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
      <div class="subhead">${localizeDir(MSG.machineDialog.portiqueDimensions)}</div>
      <div class="slider-field">
        <div class="slider-head"><span>${localizeDir(MSG.machineDialog.span)}</span><span class="slider-val">${span} m</span></div>
        <ix-slider
          .value=${span}
          min="2"
          max="50"
          step="0.5"
          @valueChange=${(e: IxValueEvent) => this.patch({ portiqueSpan: Number(e.detail) })}
        ></ix-slider>
      </div>
      <div class="slider-field">
        <div class="slider-head"><span>${localizeDir(MSG.machineDialog.height)}</span><span class="slider-val">${height} m</span></div>
        <ix-slider
          .value=${height}
          min="2"
          max="30"
          step="0.5"
          @valueChange=${(e: IxValueEvent) => this.patch({ portiqueHeight: Number(e.detail) })}
        ></ix-slider>
      </div>
      <div class="slider-field">
        <div class="slider-head"><span>${localizeDir(MSG.machineDialog.pillars)}</span><span class="slider-val">${legW} m</span></div>
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
          <span>${localizeDir(MSG.machineDialog.tableDiameter)}</span><span class="slider-val">${d} m</span>
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
      <div class="subhead">${localizeDir(MSG.machineDialog.basculeurDimensions)}</div>
      ${this.dimSlider(localize(MSG.machineDialog.width), w, 2, 10, (v) => this.patch({ basculeurW: v }))}
      ${this.dimSlider(localize(MSG.machineDialog.height), h, 2, 8, (v) => this.patch({ basculeurH: v }))}
      ${this.dimSlider(localize(MSG.machineDialog.depth), d, 2, 8, (v) => this.patch({ basculeurD: v }))}
      <mf-dp-field
        label=${localize(MSG.machineDialog.tiltDpLabel)}
        .value=${this.working.tiltDp ?? ''}
        @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ tiltDp: e.detail.value })}
      ></mf-dp-field>
      ${this.labeledToggle(
        localize(MSG.machineDialog.tiltInvert),
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
      <div class="subhead">${localizeDir(MSG.machineDialog.billboardTitle)}</div>
      <mf-graphic-picker
        kind="billboard"
        .value=${this.working.billboardUrl ?? ''}
        .billboardResources=${this.billboardResources}
        .store=${this.store}
        @wui:change=${(e: CustomEvent<{ value?: string }>) => this.patch({ billboardUrl: e.detail.value })}
      ></mf-graphic-picker>
      <div class="slider-field">
        <div class="slider-head"><span>${localizeDir(MSG.machineDialog.size)}</span><span class="slider-val">${size} m</span></div>
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

  private renderGlb(): TemplateResult {
    if (this.working.type !== 'glb') return html``;
    return html`
      <div class="subhead">${localizeDir(MSG.machineDialog.glbTitle)}</div>
      <mf-graphic-picker
        kind="glb"
        .value=${this.working.glbUrl ?? ''}
        .glbResources=${this.glbResources}
        @wui:change=${(e: CustomEvent<{ value?: string }>) => this.patch({ glbUrl: e.detail.value })}
      ></mf-graphic-picker>
    `;
  }

  private renderState(): TemplateResult {
    const m = this.working;
    return html`
      <div class="subhead">${localizeDir(MSG.machineDialog.machineState)}</div>
      <div class="grid2">
        <mf-dp-field
          label=${localize(MSG.machineDialog.stateDpLabel)}
          .value=${m.stateDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ stateDp: e.detail.value })}
        ></mf-dp-field>
        <ix-select
          label=${localize(MSG.machineDialog.stateMappingLabel)}
          .value=${m.stateMappingId ?? ''}
          @valueChange=${(e: IxValueEvent) => this.patch({ stateMappingId: String(e.detail) })}
        >
          ${this.mappings.map(
            (mp) => html`<ix-select-item label=${mp.name} value=${mp.id}></ix-select-item>`
          )}
        </ix-select>
      </div>
      <ix-button class="link" variant="secondary" @click=${this.openMappings}>
        <ix-icon name="cogwheel" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.manageStateMappings)}
      </ix-button>
      <mf-dp-field
        label=${localize(MSG.machineDialog.commDpLabel)}
        .value=${m.commDp ?? ''}
        @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ commDp: e.detail.value })}
      ></mf-dp-field>
      ${this.renderAliLink()}
    `;
  }

  /** Link this machine to an Asset Lifecycle Intelligence (ALI) asset, so its
   * composite obsolescence/risk score can be displayed (see the Affichage tab). */
  private renderAliLink(): TemplateResult {
    const selectedId = this.working.aliAssetId ?? '';
    const selected = this.aliAssets.find((a) => a.id === selectedId);
    return html`
      <div class="subhead">${localizeDir(MSG.machineDialog.aliTitle)}</div>
      <div class="hint">
        ${localizeDir(MSG.machineDialog.aliHint)}
      </div>
      ${this.aliAssets.length === 0
        ? html`<div class="hint">
            ${localizeDir(MSG.machineDialog.aliEmpty)}
          </div>`
        : html`<ix-select
            label=${localize(MSG.machineDialog.aliLinkedAsset)}
            allow-clear
            .value=${selectedId}
            @valueChange=${(e: IxValueEvent) =>
              this.patch({ aliAssetId: e.detail ? String(e.detail) : undefined })}
          >
            ${this.aliAssets.map(
              (a) => html`<ix-select-item label=${this.aliAssetLabel(a)} value=${a.id}></ix-select-item>`
            )}
          </ix-select>`}
      ${selected
        ? html`<div class="ali-risk" style="--c:${selected.risk.color}">
            <span class="ali-risk__score">${selected.risk.score}</span>
            <span class="ali-risk__level">${selected.risk.label}</span>
          </div>`
        : ''}
    `;
  }

  private aliAssetLabel(a: AliAssetInfo): string {
    const parts = [a.name];
    if (a.mlfb) parts.push(a.mlfb);
    if (a.area) parts.push(a.area);
    return parts.join(' · ');
  }

  /** Placed from a marker: its choice and the offset, the position following from them. */
  private renderMarker(): TemplateResult {
    if (this.markers.length === 0) return html``;
    const m = this.working;
    const marker = this.markers.find((k) => k.id === m.markerId);
    return html`
      <div class="grid3">
        <ix-select
          label=${localize(MSG.markers.placeFrom)}
          .value=${marker?.id ?? ''}
          @valueChange=${(e: IxValueEvent) => this.bindMarker(String(e.detail))}
        >
          <ix-select-item label=${localize(MSG.markers.noMarker)} value=""></ix-select-item>
          ${this.markers.map((k) => html`<ix-select-item label=${k.label} value=${k.id}></ix-select-item>`)}
        </ix-select>
        ${marker
          ? html`<ix-number-input
                label=${localize(MSG.markers.offsetX)}
                .value=${Math.round((m.x - marker.x) * 10) / 10}
                @valueChange=${(e: IxValueEvent) => this.patch(placeFromMarker(m, marker, Number(e.detail) || 0, m.z - marker.z))}
              ></ix-number-input>
              <ix-number-input
                label=${localize(MSG.markers.offsetZ)}
                .value=${Math.round((m.z - marker.z) * 10) / 10}
                @valueChange=${(e: IxValueEvent) => this.patch(placeFromMarker(m, marker, m.x - marker.x, Number(e.detail) || 0))}
              ></ix-number-input>`
          : ''}
      </div>
    `;
  }

  /** Bind the machine to a marker (placed on it, no offset) or free it (position kept). */
  private bindMarker(id: string): void {
    const marker = this.markers.find((k) => k.id === id);
    if (marker) {
      this.patch(placeFromMarker(this.working, marker, 0, 0));
    } else {
      const free = { ...this.working };
      delete free.markerId;
      this.working = free;
    }
  }

  private renderProduction(): TemplateResult {
    const m = this.working;
    return html`
      <div class="subhead">${localizeDir(MSG.machineDialog.production)}</div>
      <div class="grid2">
        <mf-dp-field
          label=${localize(MSG.machineDialog.stopCauseDpLabel)}
          .value=${m.stopCauseDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ stopCauseDp: e.detail.value })}
        ></mf-dp-field>
        <mf-dp-field
          label=${localize(MSG.machineDialog.workOrderDpLabel)}
          .value=${m.workOrderDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ workOrderDp: e.detail.value })}
        ></mf-dp-field>
        <mf-dp-field
          label=${localize(MSG.machineDialog.operationDpLabel)}
          .value=${m.operationDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ operationDp: e.detail.value })}
        ></mf-dp-field>
        <mf-dp-field
          label=${localize(MSG.machineDialog.alarmCodeDpLabel)}
          .value=${m.alarmCodeDp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patch({ alarmCodeDp: e.detail.value })}
        ></mf-dp-field>
        <ix-number-input
          label=${localize(MSG.machineDialog.minStopLabel)}
          helper-text=${localize(MSG.machineDialog.minStopHint)}
          min="0"
          .value=${m.minStopSec ?? 0}
          @valueChange=${(e: IxValueEvent) => this.patch({ minStopSec: Math.max(0, Number(e.detail) || 0) })}
        ></ix-number-input>
      </div>
    `;
  }

  private renderDashboard(): TemplateResult {
    const current = this.working.dashboardId;
    const mode = resolveDashboardMode(this.working);
    return html`
      <div class="subhead">${localizeDir(MSG.machineDialog.dashboardMachine)}</div>
      <ix-select
        label=${localize(MSG.machineDialog.dashboardModeLabel)}
        .value=${mode}
        @valueChange=${(e: IxValueEvent) => this.patch({ dashboardMode: e.detail as DashboardMode })}
      >
        ${DASHBOARD_MODES.map(
          (dm) => html`<ix-select-item label=${DASHBOARD_MODE_LABEL[dm]} value=${dm}></ix-select-item>`
        )}
      </ix-select>
      ${mode === 'default'
        ? html`<div class="hint">
            ${localizeDir(MSG.machineDialog.dashboardDefaultHint)}
          </div>`
        : html`
            ${this.dashboards.length > 0
              ? html`<ix-select
                  label=${localize(MSG.machineDialog.dashboardLinkedLabel)}
                  allow-clear
                  .value=${current == null ? '' : String(current)}
                  @valueChange=${(e: IxValueEvent) => this.setDashboard(e.detail)}
                >
                  ${this.dashboards.map(
                    (d) => html`<ix-select-item label=${d.name} value=${String(d.id)}></ix-select-item>`
                  )}
                </ix-select>`
              : html`<ix-number-input
                  label=${localize(MSG.machineDialog.dashboardNumberLabel)}
                  .value=${current ?? ''}
                  @valueChange=${(e: IxValueEvent) => this.setDashboard(e.detail)}
                ></ix-number-input>`}
            <div class="dash-actions">
              <ix-button variant="secondary" @click=${this.createDashboard}>
                <ix-icon name="add-circle" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.createDashboard)}
              </ix-button>
              <ix-button
                variant="secondary"
                ?disabled=${current == null}
                title=${current == null ? localize(MSG.machineDialog.exportParamsTitleDisabled) : localize(MSG.machineDialog.exportParamsTitle)}
                @click=${this.exportDashboard}
              >
                <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.exportParams)}
              </ix-button>
            </div>
          `}
      ${this.renderDashboardLinks()}
    `;
  }

  /** Configure up to MAX_DASHBOARD_LINKS custom URL buttons (shown in the popup). */
  private renderDashboardLinks(): TemplateResult {
    const links = this.working.dashboardLinks ?? [];
    // Links that stay within the application (appLinksOnly): addresses of the application only.
    const inApp = this.working.appLinksOnly === true;
    return html`
      <div class="subhead">${localizeDir(inApp ? MSG.machineDialog.appLinks : MSG.machineDialog.externalLinks)}</div>
      <div class="hint">
        ${inApp ? localizeDir(MSG.machineDialog.appLinksHint) : dashboardLinksHintMsg(MAX_DASHBOARD_LINKS)}
      </div>
      <div class="kpi-head">
        <span class="spacer"></span>
        <ix-button
          variant="secondary"
          ?disabled=${links.length >= MAX_DASHBOARD_LINKS}
          @click=${this.addDashboardLink}
        >
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.addLink)}
        </ix-button>
      </div>
      ${links.length === 0
        ? html`<div class="hint">${localizeDir(MSG.machineDialog.noExternalLink)}</div>`
        : links.map((l, i) => this.renderDashboardLinkRow(l, i))}
    `;
  }

  private renderDashboardLinkRow(link: DashboardLink, i: number): TemplateResult {
    const icon = link.icon || DEFAULT_DASHBOARD_LINK_ICON;
    const inApp = this.working.appLinksOnly === true;
    return html`
      <div class="kpi-card">
        <div class="kpi-card-head">
          <span class="kpi-card-title">${link.label || linkFallbackMsg(i + 1)}</span>
          <span class="spacer"></span>
          <ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title=${localize(MSG.machineDialog.removeLink)}
            @click=${() => this.removeDashboardLink(i)}
          ></ix-icon-button>
        </div>
        <div class="grid2">
          <ix-input
            label=${localize(MSG.machineDialog.buttonLabel)}
            .value=${link.label}
            @valueChange=${(e: IxValueEvent) => this.patchDashboardLink(i, { label: String(e.detail) })}
          ></ix-input>
          <div class="icon-field">
            <span class="icon-field__label">${localizeDir(MSG.machineDialog.buttonIcon)}</span>
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
          label=${localize(inApp ? MSG.machineDialog.appUrlLabel : MSG.machineDialog.urlLabel)}
          placeholder=${localize(inApp ? MSG.machineDialog.appUrlPlaceholder : MSG.machineDialog.urlPlaceholder)}
          .value=${link.url}
          @valueChange=${(e: IxValueEvent) => this.patchDashboardLink(i, { url: String(e.detail) })}
        ></ix-input>
        ${inApp && link.url.trim() !== '' && appLinkHref(link.url) === undefined
          ? html`<div class="hint" style="color: var(--theme-color-alarm)">${localizeDir(MSG.machineDialog.appUrlInvalid)}</div>`
          : ''}
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
    return DASHBOARD_LINK_ICONS.find((ic) => ic.value === icon)?.label ?? localize(MSG.machineDialog.chooseEllipsis);
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
      <div class="subhead">${localizeDir(MSG.machineDialog.paramsTitle)} (${params.length})</div>
      <div class="params">${params.map((p, i) => this.renderParamRow(p, i))}</div>
      <ix-button
        class="link"
        variant="secondary"
        @click=${this.addParam}
      >
        <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.machineDialog.addParam)}
      </ix-button>
    `;
  }

  private renderParamRow(p: Kpi, i: number): TemplateResult {
    return html`
      <div class="param-row">
        <ix-input
          class="p-label"
          placeholder=${localize(MSG.machineDialog.paramLabel)}
          .value=${p.label}
          @valueChange=${(e: IxValueEvent) => this.patchParam(i, { label: String(e.detail) })}
        ></ix-input>
        <mf-dp-field
          class="p-dp"
          .value=${p.dp ?? ''}
          @wui:change=${(e: CustomEvent<{ value: string }>) => this.patchParam(i, { dp: e.detail.value })}
        ></mf-dp-field>
        <ix-input
          class="p-unit"
          placeholder=${localize(MSG.machineDialog.paramUnit)}
          .value=${p.unit ?? ''}
          @valueChange=${(e: IxValueEvent) => this.patchParam(i, { unit: String(e.detail) })}
        ></ix-input>
        <ix-icon-button
          ghost
          icon="trashcan"
          title=${localize(MSG.machineDialog.delete)}
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
    kpis.push({ key: `p${kpis.length + 1}`, label: localize(MSG.machineDialog.defaultParamName), showInCard: true });
    this.patch({ kpis });
  }

  private removeParam(index: number): void {
    const kpis = (this.working.kpis ?? []).filter((_, i) => i !== index);
    this.patch({ kpis });
  }

  private openMappings(): void {
    this.dispatchEvent(new CustomEvent('wui:mapping', { bubbles: true, composed: true }));
  }

  /** Empty, or the reason the name is refused: required, and unique in the atelier (#276). */
  private get nameError(): string {
    const name = this.working?.name ?? '';
    if (name.trim() === '') return localize(MSG.machineDialog.nameRequired);
    return nameTaken(name, this.working.id, this.siblings) ? localize(MSG.machineDialog.nameTaken) : '';
  }

  private apply(): void {
    if (this.nameError) return;
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
    .foot-error {
      margin-right: auto;
      color: var(--theme-color-alarm);
      font-size: 0.8rem;
    }
    .link {
      margin-top: 0.5rem;
    }
    .ali-risk {
      display: inline-flex;
      align-items: baseline;
      gap: 0.4rem;
      margin-top: 0.5rem;
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--c, var(--theme-color-soft-bdr));
      border-left: 4px solid var(--c, var(--theme-color-soft-bdr));
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--c, transparent) 12%, transparent);
    }
    .ali-risk__score {
      font-size: 1.2rem;
      font-weight: 700;
      color: var(--c, var(--theme-color-std-text));
    }
    .ali-risk__level {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .disp-list {
      display: flex;
      flex-direction: column;
    }
    .disp-row {
      display: grid;
      grid-template-columns: 1fr 4rem 4rem 5.5rem 4.5rem;
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
    .disp-na {
      color: var(--theme-color-soft-text);
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
