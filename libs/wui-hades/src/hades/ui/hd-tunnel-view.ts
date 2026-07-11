// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tunnel workspace — the four tabs over one tunnel: the 3D digital twin
 * (TunnelScene), the segment editor with the compliance advisor, the linear
 * synoptic and the operating modes. Owns the live datapoint binding (one
 * dpConnect over the whole plant, shared by every tab), the equipment dialog,
 * and the command pipeline: every write (manual command or mode engagement)
 * passes a confirmation dialog and runs through the audited CommandRunner.
 */
import { WuiToastService } from '@wincc-oa/wui-shared/services/wui-toast/wui-toast.service.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { container } from 'tsyringe';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import { currentAuditUser } from '@visuelconcept/wui-kit/data/audit-trail.js';
import { CommandRunner, type CommandResult } from '../data/commands.js';
import { ExerciseEngine, type ExerciseReport, type Scenario } from '../data/exercise.js';
import { exportTunnel } from '../data/io.js';
import { LiveBinding, type StateTransition } from '../data/live.js';
import { LogbookStore, type Incident, type LogEntry } from '../data/logbook.js';
import { openSafetyReport } from '../data/safety-report.js';
import {
  MSG,
  localize,
  localizeDir,
  alarmTransitionMsg,
  commandResultMsg,
  deleteModeMsg,
  engageModeMsg,
  exerciseEndMsg,
  exerciseStartMsg,
  modeEngagedMsg,
  simulatedCommandMsg
} from '../i18n.js';
import { TunnelScene, type ViewMode, type ViewStyle } from '../scene/tunnel-scene.js';
import type { EquipmentDef, OperatingMode, Tunnel } from '../types.js';
import { STATE_FAULT, STATE_RUN, STATE_WARNING } from '../types.js';
import './hd-editor.js';
import './hd-equipment-dialog.js';
import './hd-exercise.js';
import './hd-logbook.js';
import './hd-mode-dialog.js';
import './hd-modes.js';
import './hd-synoptic.js';
import type { CommandRequest } from './hd-equipment-dialog.js';
import type { OpenIncidentDetail } from './hd-logbook.js';

type Tab = '3d' | 'editor' | 'synoptic' | 'modes' | 'logbook' | 'exercise';
const TABS: readonly Tab[] = ['3d', 'editor', 'synoptic', 'modes', 'logbook', 'exercise'];
/** Exercise clock tick (ms). */
const EXERCISE_TICK_MS = 1000;
/** localStorage key of the preferred 3D render style. */
const STYLE_STORAGE_KEY = 'hades.viewStyle';
/** localStorage key of the preferred 3D shell mode (closed / cutaway / x-ray). */
const MODE_STORAGE_KEY = 'hades.viewMode';
/** PK cut slider bounds/step (m). */
const CUT_MIN_M = 50;
const CUT_STEP_M = 10;

function storedStyle(): ViewStyle {
  return localStorage.getItem(STYLE_STORAGE_KEY) === 'simple' ? 'simple' : 'modern';
}

function storedMode(): ViewMode {
  const raw = localStorage.getItem(MODE_STORAGE_KEY);
  return raw === 'closed' || raw === 'xray' ? raw : 'cutaway';
}

/** Chainage notation of a PK in metres (e.g. `PK 1+500`). */
function formatPkLabel(pkM: number): string {
  const rounded = Math.round(pkM);
  return `PK ${Math.floor(rounded / 1000)}+${String(rounded % 1000).padStart(3, '0')}`;
}

@customElement('hd-tunnel-view')
export class HdTunnelView extends LitElement {
  static override readonly styles = [IXCoreStyles, viewStyles()];

  @property({ attribute: false }) tunnel: Tunnel | null = null;
  @property({ type: Boolean }) canEdit = false;
  @property({ type: Boolean }) offline = false;

  @state() private tab: Tab = '3d';
  @state() private viewStyle: ViewStyle = storedStyle();
  @state() private viewMode: ViewMode = storedMode();
  /** PK cut scrubber: enabled + current PK (m). */
  @state() private cutOn = false;
  @state() private cutPkM = CUT_MIN_M;
  @state() private labelsOn = false;
  @state() private selectedId = '';
  /** Bumped on every live emission so the open dialog re-renders its values. */
  @state() private liveTick = 0;
  @state() private pendingCommand: CommandRequest | null = null;
  @state() private pendingMode: OperatingMode | null = null;
  @state() private modeResults: CommandResult[] = [];
  @state() private modeResultsId = '';
  @state() private confirmDelete = false;
  /** Mode open in the editor dialog (a fresh one for "new"); null = closed. */
  @state() private editingMode: OperatingMode | null = null;
  @state() private deletingMode: OperatingMode | null = null;
  // Logbook (main courante).
  @state() private logEntries: LogEntry[] = [];
  @state() private activeIncident: Incident | null = null;
  // Exercise (drill).
  @state() private exerciseScenario: Scenario | null = null;
  @state() private exerciseElapsedS = 0;
  @state() private exerciseSatisfied: string[] = [];
  @state() private exerciseReport: ExerciseReport | null = null;

  private scene: TunnelScene | null = null;
  private readonly live = new LiveBinding(
    () => this.onLive(),
    (t) => this.onTransition(t)
  );
  private readonly commands = new CommandRunner();
  private resizeObserver: ResizeObserver | null = null;
  private logbook: LogbookStore | null = null;
  private logbookTunnelId = '';
  private exercise: ExerciseEngine | null = null;
  private exerciseStartMs = 0;
  private exerciseTimer = 0;
  /** Pre-exercise live snapshot, restored when the drill ends. */
  private exerciseSnapshot = new Map<string, { state?: number; measures?: Record<string, number> }>();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.clearInterval(this.exerciseTimer);
    this.live.disconnect();
    this.resizeObserver?.disconnect();
    this.scene?.dispose();
    this.scene = null;
  }

  protected override firstUpdated(): void {
    const canvas = this.renderRoot.querySelector<HTMLCanvasElement>('canvas.scene');
    const host = this.renderRoot.querySelector<HTMLElement>('.scene-host');
    if (!canvas || !host) return;
    this.scene = new TunnelScene(canvas, host, (id) => this.onSelect(id));
    const labelHost = this.renderRoot.querySelector<HTMLElement>('.scene-labels');
    if (labelHost) this.scene.setLabelHost(labelHost);
    this.scene.setStyle(this.viewStyle);
    this.scene.setMode(this.viewMode);
    this.resizeObserver = new ResizeObserver(() => this.scene?.resize());
    this.resizeObserver.observe(host);
    this.applyTunnel();
    this.scene.start();
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('tunnel')) this.applyTunnel();
    if (changed.has('tab') && this.scene) {
      if (this.tab === '3d') {
        this.scene.resize();
        this.scene.start();
      } else {
        this.scene.stop();
      }
    }
  }

  private applyTunnel(): void {
    const tunnel = this.tunnel;
    if (!tunnel) return;
    this.scene?.setTunnel(tunnel);
    // Live binding stays frozen while a drill drives the twin.
    if (!this.exercise) this.live.connect(tunnel);
    if (this.logbookTunnelId !== tunnel.id) {
      this.logbookTunnelId = tunnel.id;
      this.logbook = new LogbookStore(tunnel.id);
      void this.refreshLogbook(true);
    }
  }

  private async refreshLogbook(load = false): Promise<void> {
    if (!this.logbook) return;
    const data = load ? await this.logbook.load() : this.logbook.current;
    this.logEntries = [...data.entries];
    this.activeIncident = this.logbook.activeIncident ?? null;
  }

  /** Whether operator commands are allowed right now (drills always are). */
  private get canOperate(): boolean {
    if (this.exercise) return this.canEdit;
    return this.canEdit && !this.offline && this.tunnel?.shadowMode !== true;
  }

  private onLive(): void {
    if (this.tunnel) this.scene?.updateStates(this.tunnel);
    this.liveTick += 1;
  }

  /** Alarm edges → logbook (fault/warning onset and return to service). */
  private onTransition(transition: StateTransition): void {
    const { equipment, previous, next } = transition;
    const relevant =
      next === STATE_FAULT ||
      next === STATE_WARNING ||
      ((previous === STATE_FAULT || previous === STATE_WARNING) && next === STATE_RUN);
    if (!relevant || previous === undefined) return;
    void this.logbook
      ?.addEntry('alarm', alarmTransitionMsg(equipment.name, next), {
        equipmentId: equipment.id,
        pkM: equipment.pkM
      })
      .then(() => this.refreshLogbook());
  }

  override render(): TemplateResult | typeof nothing {
    const tunnel = this.tunnel;
    if (!tunnel) return nothing;
    const selected = tunnel.equipment.find((e) => e.id === this.selectedId) ?? null;
    return html`
      <div class="page">
        <div class="toolbar">
          <ix-icon-button
            icon="arrow-left"
            variant="secondary"
            ghost
            title=${localize(MSG.view.back)}
            @click=${() => this.dispatchEvent(new CustomEvent('wui:back'))}
          ></ix-icon-button>
          <ix-typography format="h3" class="title">${tunnel.name}</ix-typography>
          <ix-tabs .selected=${TABS.indexOf(this.tab)} @selectedChange=${(e: CustomEvent<number>) => this.onTab(e.detail)}>
            <ix-tab-item>${localizeDir(MSG.view.tab3d)}</ix-tab-item>
            <ix-tab-item>${localizeDir(MSG.view.tabEditor)}</ix-tab-item>
            <ix-tab-item>${localizeDir(MSG.view.tabSynoptic)}</ix-tab-item>
            <ix-tab-item>${localizeDir(MSG.view.tabModes)}</ix-tab-item>
            <ix-tab-item>${localizeDir(MSG.view.tabLogbook)}</ix-tab-item>
            <ix-tab-item>${localizeDir(MSG.view.tabExercise)}</ix-tab-item>
          </ix-tabs>
          ${tunnel.shadowMode && !this.exercise
            ? html`<span class="shadow-chip" title=${localize(MSG.view.shadowHint)}>
                <ix-icon name="eye" size="16"></ix-icon>${localizeDir(MSG.view.shadowChip)}
              </span>`
            : nothing}
          ${this.exercise
            ? html`<span class="drill-chip">
                <ix-icon name="analysis" size="16"></ix-icon>${localizeDir(MSG.exercise.runningTag)}
              </span>`
            : nothing}
          <div class="spacer"></div>
          ${this.tab === '3d'
            ? html`
                <ix-select
                  class="mode-select"
                  .value=${this.viewMode}
                  @valueChange=${(e: CustomEvent<string>) => this.onMode(String(e.detail) as ViewMode)}
                >
                  <ix-select-item label=${localize(MSG.view.modeCutaway)} value="cutaway"></ix-select-item>
                  <ix-select-item label=${localize(MSG.view.modeXray)} value="xray"></ix-select-item>
                  <ix-select-item label=${localize(MSG.view.modeClosed)} value="closed"></ix-select-item>
                </ix-select>
                <ix-select
                  class="style-select"
                  .value=${this.viewStyle}
                  @valueChange=${(e: CustomEvent<string>) => this.onStyle(String(e.detail) as ViewStyle)}
                >
                  <ix-select-item label=${localize(MSG.view.styleModern)} value="modern"></ix-select-item>
                  <ix-select-item label=${localize(MSG.view.styleSimple)} value="simple"></ix-select-item>
                </ix-select>
                <ix-icon-button
                  icon="cut"
                  variant=${this.cutOn ? 'primary' : 'secondary'}
                  ghost
                  title=${localize(MSG.view.cutToggle)}
                  @click=${() => this.toggleCut()}
                ></ix-icon-button>
                ${this.cutOn
                  ? html`<label class="cut-slider">
                      <input
                        type="range"
                        min=${CUT_MIN_M}
                        max=${Math.max(CUT_MIN_M, this.tunnelLengthM())}
                        step=${CUT_STEP_M}
                        .value=${String(this.cutPkM)}
                        @input=${(e: Event) => this.onCutInput((e.target as HTMLInputElement).value)}
                      />
                      <span class="cut-pk">${formatPkLabel(this.cutPkM)}</span>
                    </label>`
                  : nothing}
                <ix-icon-button
                  icon="label"
                  variant=${this.labelsOn ? 'primary' : 'secondary'}
                  ghost
                  title=${localize(MSG.view.toggleLabels)}
                  @click=${() => this.toggleLabels()}
                ></ix-icon-button>
                <ix-button variant="secondary" @click=${() => this.toggleDrive()}>
                  <ix-icon name=${this.scene?.isDriving ? 'eye' : 'play'} slot="icon"></ix-icon>
                  ${this.scene?.isDriving ? localizeDir(MSG.view.orbitMode) : localizeDir(MSG.view.driveMode)}
                </ix-button>
                <ix-icon-button
                  icon="refresh"
                  variant="secondary"
                  ghost
                  title=${localize(MSG.view.resetView)}
                  @click=${() => this.scene?.frameTunnel()}
                ></ix-icon-button>
              `
            : nothing}
          <ix-icon-button
            icon="document"
            variant="secondary"
            ghost
            title=${localize(MSG.view.safetyReport)}
            @click=${() => this.onSafetyReport(tunnel)}
          ></ix-icon-button>
          <ix-icon-button
            icon="export"
            variant="secondary"
            ghost
            title=${localize(MSG.view.exportTunnel)}
            @click=${() => exportTunnel(tunnel)}
          ></ix-icon-button>
          <ix-icon-button
            icon="trashcan"
            variant="secondary"
            ghost
            ?disabled=${!this.canEdit}
            title=${localize(MSG.view.deleteTunnel)}
            @click=${() => (this.confirmDelete = true)}
          ></ix-icon-button>
        </div>

        <div class="content">
          <div class="scene-host" ?hidden=${this.tab !== '3d'}>
            <canvas class="scene"></canvas>
            <div class="scene-labels"></div>
            <div class="scene-hint">${localizeDir(MSG.view.sceneHint)}</div>
          </div>
          ${this.tab === 'editor'
            ? html`<hd-editor
                .tunnel=${tunnel}
                ?canEdit=${this.canEdit}
                @wui:save=${(e: CustomEvent<Tunnel>) => this.save(e.detail)}
                @wui:equipment=${(e: CustomEvent<{ equipment: EquipmentDef; tunnel: Tunnel | null }>) =>
                  this.onEditorEquipment(e.detail)}
              ></hd-editor>`
            : nothing}
          ${this.tab === 'synoptic'
            ? html`<hd-synoptic
                .tunnel=${tunnel}
                .liveTick=${this.liveTick}
                @wui:equipment=${(e: CustomEvent<EquipmentDef>) => this.onSelect(e.detail.id)}
              ></hd-synoptic>`
            : nothing}
          ${this.tab === 'modes'
            ? html`<hd-modes
                .tunnel=${tunnel}
                ?canOperate=${this.canOperate}
                ?canEdit=${this.canEdit}
                .results=${this.modeResults}
                resultsModeId=${this.modeResultsId}
                @wui:engage=${(e: CustomEvent<OperatingMode>) => (this.pendingMode = e.detail)}
                @wui:create-mode=${() => (this.editingMode = freshMode())}
                @wui:edit-mode=${(e: CustomEvent<OperatingMode>) => (this.editingMode = e.detail)}
                @wui:delete-mode=${(e: CustomEvent<OperatingMode>) => (this.deletingMode = e.detail)}
              ></hd-modes>`
            : nothing}
          ${this.tab === 'logbook'
            ? html`<hd-logbook
                .entries=${this.logEntries}
                .activeIncident=${this.activeIncident}
                ?canEdit=${this.canEdit}
                @wui:note=${(e: CustomEvent<string>) => this.onNote(e.detail)}
                @wui:open-incident=${(e: CustomEvent<OpenIncidentDetail>) => this.onOpenIncident(e.detail)}
                @wui:close-incident=${() => this.onCloseIncident()}
              ></hd-logbook>`
            : nothing}
          ${this.tab === 'exercise'
            ? html`<hd-exercise
                ?canRun=${this.canEdit}
                .scenario=${this.exerciseScenario}
                .elapsedS=${this.exerciseElapsedS}
                .satisfied=${this.exerciseSatisfied}
                .report=${this.exerciseReport}
                @wui:start-exercise=${(e: CustomEvent<Scenario>) => this.startExercise(e.detail)}
                @wui:stop-exercise=${() => this.finishExercise()}
              ></hd-exercise>`
            : nothing}
        </div>
      </div>

      <hd-mode-dialog
        .tunnel=${tunnel}
        .mode=${this.editingMode}
        @wui:close=${() => (this.editingMode = null)}
        @wui:save=${(e: CustomEvent<OperatingMode>) => this.saveMode(e.detail)}
      ></hd-mode-dialog>

      <hd-equipment-dialog
        .tunnel=${tunnel}
        .equipment=${selected}
        .liveTick=${this.liveTick}
        ?canEdit=${this.canEdit}
        ?canOperate=${this.canOperate}
        @wui:close=${() => (this.selectedId = '')}
        @wui:save=${(e: CustomEvent<EquipmentDef>) => this.saveEquipment(e.detail)}
        @wui:remove=${(e: CustomEvent<string>) => this.removeEquipment(e.detail)}
        @wui:command=${(e: CustomEvent<CommandRequest>) => (this.pendingCommand = e.detail)}
      ></hd-equipment-dialog>

      ${this.renderConfirms(tunnel)}
    `;
  }

  private renderConfirms(tunnel: Tunnel): TemplateResult | typeof nothing {
    if (this.pendingCommand) {
      return html`<wui-confirm-dialog
        heading=${localize(MSG.confirm.commandHeading)}
        message=${this.pendingCommand.label}
        confirmLabel=${localize(MSG.confirm.execute)}
        @wui:confirm=${() => this.runPendingCommand()}
        @wui:cancel=${() => (this.pendingCommand = null)}
      ></wui-confirm-dialog>`;
    }
    if (this.pendingMode) {
      return html`<wui-confirm-dialog
        heading=${localize(MSG.confirm.modeHeading)}
        message=${engageModeMsg(this.pendingMode.name, this.pendingMode.actions.length)}
        confirmLabel=${localize(MSG.confirm.engage)}
        @wui:confirm=${() => this.runPendingMode()}
        @wui:cancel=${() => (this.pendingMode = null)}
      ></wui-confirm-dialog>`;
    }
    if (this.deletingMode) {
      return html`<wui-confirm-dialog
        message=${deleteModeMsg(this.deletingMode.name)}
        @wui:confirm=${() => this.removeMode()}
        @wui:cancel=${() => (this.deletingMode = null)}
      ></wui-confirm-dialog>`;
    }
    if (this.confirmDelete) {
      return html`<wui-confirm-dialog
        message=${localize(MSG.confirm.deleteTunnel)}
        @wui:confirm=${() => this.removeTunnel(tunnel)}
        @wui:cancel=${() => (this.confirmDelete = false)}
      ></wui-confirm-dialog>`;
    }
    return nothing;
  }

  /** Merge the edited/new mode into the tunnel and persist. */
  private saveMode(mode: OperatingMode): void {
    const tunnel = this.tunnel;
    this.editingMode = null;
    if (!tunnel) return;
    const exists = tunnel.modes.some((m) => m.id === mode.id);
    this.save({
      ...tunnel,
      modes: exists ? tunnel.modes.map((m) => (m.id === mode.id ? mode : m)) : [...tunnel.modes, mode]
    });
  }

  private removeMode(): void {
    const tunnel = this.tunnel;
    const mode = this.deletingMode;
    this.deletingMode = null;
    if (!tunnel || !mode) return;
    this.save({ ...tunnel, modes: tunnel.modes.filter((m) => m.id !== mode.id) });
  }

  // --- interactions -----------------------------------------------------------

  private onTab(index: number): void {
    this.tab = TABS[index] ?? '3d';
  }

  private onStyle(style: ViewStyle): void {
    this.viewStyle = style;
    localStorage.setItem(STYLE_STORAGE_KEY, style);
    this.scene?.setStyle(style);
  }

  private onMode(mode: ViewMode): void {
    this.viewMode = mode;
    localStorage.setItem(MODE_STORAGE_KEY, mode);
    this.scene?.setMode(mode);
  }

  /** Length (m) of the first tube — the PK cut scrubber range. */
  private tunnelLengthM(): number {
    const segments = this.tunnel?.tubes[0]?.segments ?? [];
    return segments.reduce((sum, s) => sum + s.lengthM, 0);
  }

  private toggleCut(): void {
    this.cutOn = !this.cutOn;
    if (this.cutOn) {
      this.cutPkM = Math.min(Math.max(CUT_MIN_M, this.cutPkM), this.tunnelLengthM());
      this.scene?.setCutPk(this.cutPkM, true);
    } else {
      this.scene?.setCutPk(null);
    }
  }

  private onCutInput(raw: string): void {
    const pk = Number(raw);
    if (!Number.isFinite(pk)) return;
    this.cutPkM = pk;
    this.scene?.setCutPk(pk, true);
  }

  private toggleLabels(): void {
    this.labelsOn = !this.labelsOn;
    this.scene?.setLabelsVisible(this.labelsOn);
  }

  private toggleDrive(): void {
    this.scene?.setDriving(!this.scene.isDriving);
    this.requestUpdate();
  }

  private onSelect(id: string): void {
    this.selectedId = id;
    // With the PK cut armed, selecting (e.g. from the synoptic) slices there.
    const pk = this.tunnel?.equipment.find((e) => e.id === id)?.pkM;
    if (this.cutOn && pk != null) {
      this.cutPkM = Math.max(CUT_MIN_M, pk + CUT_STEP_M);
      this.scene?.setCutPk(this.cutPkM, true);
      return;
    }
    this.scene?.flyTo(id);
  }

  private onEditorEquipment(detail: { equipment: EquipmentDef; tunnel: Tunnel | null }): void {
    // Unsaved editor changes (e.g. a freshly added equipment) must be persisted
    // first so the dialog and the tunnel prop stay one single source of truth.
    if (detail.tunnel) this.save(detail.tunnel);
    this.selectedId = detail.equipment.id;
  }

  private save(tunnel: Tunnel): void {
    this.dispatchEvent(new CustomEvent<Tunnel>('wui:save', { detail: tunnel }));
  }

  private saveEquipment(equipment: EquipmentDef): void {
    const tunnel = this.tunnel;
    if (!tunnel) return;
    this.save({
      ...tunnel,
      equipment: tunnel.equipment.map((e) => (e.id === equipment.id ? equipment : e))
    });
    this.selectedId = '';
  }

  private removeEquipment(id: string): void {
    const tunnel = this.tunnel;
    if (!tunnel) return;
    this.save({ ...tunnel, equipment: tunnel.equipment.filter((e) => e.id !== id) });
    this.selectedId = '';
  }

  private removeTunnel(tunnel: Tunnel): void {
    this.confirmDelete = false;
    this.dispatchEvent(new CustomEvent<string>('wui:remove', { detail: tunnel.id }));
  }

  private async runPendingCommand(): Promise<void> {
    const request = this.pendingCommand;
    const tunnel = this.tunnel;
    this.pendingCommand = null;
    if (!request || !tunnel) return;
    const equipment = tunnel.equipment.find((e) => e.id === request.equipmentId);
    if (!equipment) return;
    // Drill: intercept — record against the expectations, never dpSet.
    if (this.exercise) {
      this.interceptDrillCommand(equipment, request.pointKey, request.value, request.label);
      return;
    }
    if (!this.canOperate) return;
    const result = await this.commands.runCommand(
      equipment,
      request.pointKey,
      request.value,
      request.label,
      tunnel.name
    );
    void this.logbook?.addEntry('command', request.label, {
      equipmentId: equipment.id,
      pkM: equipment.pkM
    }).then(() => this.refreshLogbook());
    this.notify([result]);
  }

  private async runPendingMode(): Promise<void> {
    const mode = this.pendingMode;
    const tunnel = this.tunnel;
    this.pendingMode = null;
    if (!mode || !tunnel) return;
    // Drill: every action of the sequence is simulated and scored.
    if (this.exercise) {
      for (const action of mode.actions) {
        const equipment = tunnel.equipment.find((e) => e.id === action.equipmentId);
        if (equipment) this.interceptDrillCommand(equipment, action.pointKey, action.value, action.label);
      }
      this.modeResults = mode.actions.map((a) => ({ label: a.label, dpe: '', ok: true }));
      this.modeResultsId = mode.id;
      return;
    }
    if (!this.canOperate) return;
    const results = await this.commands.runActions(tunnel, mode.actions, `${tunnel.name} / ${mode.name}`);
    this.modeResults = results;
    this.modeResultsId = mode.id;
    void this.logbook?.addEntry('mode', modeEngagedMsg(mode.name), {}).then(() => this.refreshLogbook());
    this.notify(results);
  }

  // --- logbook -----------------------------------------------------------------

  private onNote(text: string): void {
    void this.logbook?.addEntry('note', text).then(() => this.refreshLogbook());
  }

  private onOpenIncident(detail: OpenIncidentDetail): void {
    void this.logbook?.openIncident(detail.title, detail.severity).then(() => this.refreshLogbook());
  }

  private onCloseIncident(): void {
    void this.logbook?.closeIncident(localize(MSG.logbook.closedNote)).then(() => this.refreshLogbook());
  }

  private async onSafetyReport(tunnel: Tunnel): Promise<void> {
    let user = '—';
    try {
      user = (await currentAuditUser()).name || '—';
    } catch {
      // keep the placeholder
    }
    openSafetyReport(tunnel, this.logbook?.current, user);
  }

  // --- exercise (drill) ----------------------------------------------------------

  private startExercise(scenario: Scenario): void {
    const tunnel = this.tunnel;
    if (!tunnel || this.exercise) return;
    // Freeze the real telemetry and snapshot the current states for restore.
    this.live.disconnect();
    this.exerciseSnapshot = new Map(
      tunnel.equipment.map((e) => [e.id, { state: e.state, measures: e.measures ? { ...e.measures } : undefined }])
    );
    this.exercise = new ExerciseEngine(scenario, tunnel);
    this.exerciseScenario = scenario;
    this.exerciseReport = null;
    this.exerciseSatisfied = [];
    this.exerciseElapsedS = 0;
    this.exerciseStartMs = Date.now();
    void this.logbook?.addEntry('exercise', exerciseStartMsg(localize(scenario.name)), { exercise: true })
      .then(() => this.refreshLogbook());
    this.exerciseTimer = window.setInterval(() => this.tickExercise(), EXERCISE_TICK_MS);
  }

  private tickExercise(): void {
    const engine = this.exercise;
    const tunnel = this.tunnel;
    if (!engine || !tunnel) return;
    const elapsedS = (Date.now() - this.exerciseStartMs) / 1000;
    this.exerciseElapsedS = Math.floor(elapsedS);
    for (const fired of engine.tick(elapsedS)) {
      const { injection, equipment } = fired;
      if (injection.state !== undefined) equipment.state = injection.state;
      if (injection.measures) equipment.measures = { ...equipment.measures, ...injection.measures };
      if (injection.smoke !== undefined) this.scene?.setSmoke(injection.pkM, injection.smoke);
      void this.logbook?.addEntry('exercise', fired.text, {
        equipmentId: equipment.id,
        pkM: equipment.pkM,
        exercise: true
      }).then(() => this.refreshLogbook());
    }
    this.scene?.updateStates(tunnel);
    this.liveTick += 1;
    if (engine.isOver(elapsedS)) this.finishExercise();
  }

  /** Drill command: score it, journal it, reflect it on the twin — no dpSet. */
  private interceptDrillCommand(equipment: EquipmentDef, pointKey: string, value: number, label: string): void {
    const engine = this.exercise;
    if (!engine) return;
    const elapsedS = (Date.now() - this.exerciseStartMs) / 1000;
    engine.recordAction(equipment.kind, pointKey, value, elapsedS);
    this.exerciseSatisfied = engine.progress().satisfied;
    void this.logbook?.addEntry('exercise', simulatedCommandMsg(label), {
      equipmentId: equipment.id,
      pkM: equipment.pkM,
      exercise: true
    }).then(() => this.refreshLogbook());
    const toast = this.resolveToast();
    if (toast) void toast.success(simulatedCommandMsg(label));
  }

  private finishExercise(): void {
    const engine = this.exercise;
    const tunnel = this.tunnel;
    if (!engine) return;
    window.clearInterval(this.exerciseTimer);
    const elapsedS = (Date.now() - this.exerciseStartMs) / 1000;
    const report = engine.report(elapsedS);
    this.exercise = null;
    this.exerciseScenario = null;
    this.exerciseReport = report;
    this.exerciseSatisfied = [];
    this.scene?.clearSmoke();
    if (tunnel) {
      // Restore the pre-drill states, then let the live binding refresh them.
      for (const equipment of tunnel.equipment) {
        const snapshot = this.exerciseSnapshot.get(equipment.id);
        if (snapshot) {
          equipment.state = snapshot.state;
          equipment.measures = snapshot.measures;
        }
      }
      this.scene?.updateStates(tunnel);
      this.live.connect(tunnel);
    }
    void this.logbook?.addEntry('exercise', exerciseEndMsg(report.score), { exercise: true })
      .then(() => this.refreshLogbook());
    this.tab = 'exercise';
  }

  private notify(results: CommandResult[]): void {
    const toast = this.resolveToast();
    if (!toast) return;
    const failed = results.filter((r) => !r.ok).length;
    const message = commandResultMsg(results.length - failed, failed);
    if (failed > 0) void toast.warning(message);
    else void toast.success(message);
  }

  private resolveToast(): WuiToastService | null {
    try {
      return container.resolve(WuiToastService);
    } catch {
      return null;
    }
  }
}

/** Blank mode handed to the editor dialog by "New mode". */
function freshMode(): OperatingMode {
  return {
    id: `mode-${Date.now().toString(36)}`,
    name: '',
    description: '',
    severity: 'normal',
    actions: []
  };
}

function viewStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
    }
    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.5rem 0.8rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .toolbar .title {
      margin-right: 0.6rem;
      white-space: nowrap;
    }
    .toolbar .spacer {
      flex: 1;
    }
    .shadow-chip,
    .drill-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.15rem 0.6rem;
      border-radius: 1rem;
      font-size: 0.78rem;
      white-space: nowrap;
    }
    .shadow-chip {
      border: 1px solid var(--theme-color-warning);
      color: var(--theme-color-warning);
    }
    .drill-chip {
      border: 1px solid var(--theme-color-info);
      color: var(--theme-color-info);
    }
    hd-logbook,
    hd-exercise {
      position: absolute;
      inset: 0;
    }
    .content {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    .scene-host {
      position: absolute;
      inset: 0;
    }
    .scene-host[hidden] {
      display: none;
    }
    canvas.scene {
      width: 100%;
      height: 100%;
      display: block;
    }
    .scene-labels {
      position: absolute;
      inset: 0;
      overflow: hidden;
      pointer-events: none;
    }
    .scene-labels .hd-3d-label {
      position: absolute;
      transform: translate(-50%, -100%);
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.1rem 0.45rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 1rem;
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
      font-size: 0.72rem;
      white-space: nowrap;
      cursor: pointer;
      pointer-events: auto;
    }
    .scene-labels .hd-3d-label:hover,
    .scene-labels .hd-3d-label:focus-visible {
      border-color: var(--theme-color-primary);
      outline: none;
    }
    .scene-labels .hd-3d-label-dot {
      width: 0.55rem;
      height: 0.55rem;
      border-radius: 50%;
      display: inline-block;
    }
    .style-select {
      width: 11rem;
    }
    .mode-select {
      width: 12rem;
    }
    .cut-slider {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    .cut-slider input[type='range'] {
      width: 11rem;
      accent-color: var(--theme-color-primary, #0ea5e9);
    }
    .cut-pk {
      min-width: 5.2rem;
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .scene-hint {
      position: absolute;
      left: 0.8rem;
      bottom: 0.6rem;
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
      pointer-events: none;
    }
    hd-editor,
    hd-synoptic,
    hd-modes {
      position: absolute;
      inset: 0;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-tunnel-view': HdTunnelView;
  }
}
