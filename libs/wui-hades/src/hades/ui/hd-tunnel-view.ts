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
import { CommandRunner, type CommandResult } from '../data/commands.js';
import { exportTunnel } from '../data/io.js';
import { LiveBinding } from '../data/live.js';
import { MSG, localize, localizeDir, deleteModeMsg, engageModeMsg, commandResultMsg } from '../i18n.js';
import { TunnelScene } from '../scene/tunnel-scene.js';
import type { EquipmentDef, OperatingMode, Tunnel } from '../types.js';
import './hd-editor.js';
import './hd-equipment-dialog.js';
import './hd-mode-dialog.js';
import './hd-modes.js';
import './hd-synoptic.js';
import type { CommandRequest } from './hd-equipment-dialog.js';

type Tab = '3d' | 'editor' | 'synoptic' | 'modes';
const TABS: readonly Tab[] = ['3d', 'editor', 'synoptic', 'modes'];

@customElement('hd-tunnel-view')
export class HdTunnelView extends LitElement {
  static override readonly styles = [IXCoreStyles, viewStyles()];

  @property({ attribute: false }) tunnel: Tunnel | null = null;
  @property({ type: Boolean }) canEdit = false;
  @property({ type: Boolean }) offline = false;

  @state() private tab: Tab = '3d';
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

  private scene: TunnelScene | null = null;
  private readonly live = new LiveBinding(() => this.onLive());
  private readonly commands = new CommandRunner();
  private resizeObserver: ResizeObserver | null = null;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
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
    if (!this.tunnel) return;
    this.scene?.setTunnel(this.tunnel);
    this.live.connect(this.tunnel);
  }

  private onLive(): void {
    if (this.tunnel) this.scene?.updateStates(this.tunnel);
    this.liveTick += 1;
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
          </ix-tabs>
          <div class="spacer"></div>
          ${this.tab === '3d'
            ? html`
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
                ?canOperate=${this.canEdit && !this.offline}
                ?canEdit=${this.canEdit}
                .results=${this.modeResults}
                resultsModeId=${this.modeResultsId}
                @wui:engage=${(e: CustomEvent<OperatingMode>) => (this.pendingMode = e.detail)}
                @wui:create-mode=${() => (this.editingMode = freshMode())}
                @wui:edit-mode=${(e: CustomEvent<OperatingMode>) => (this.editingMode = e.detail)}
                @wui:delete-mode=${(e: CustomEvent<OperatingMode>) => (this.deletingMode = e.detail)}
              ></hd-modes>`
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

  private toggleDrive(): void {
    this.scene?.setDriving(!this.scene.isDriving);
    this.requestUpdate();
  }

  private onSelect(id: string): void {
    this.selectedId = id;
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
    const result = await this.commands.runCommand(
      equipment,
      request.pointKey,
      request.value,
      request.label,
      tunnel.name
    );
    this.notify([result]);
  }

  private async runPendingMode(): Promise<void> {
    const mode = this.pendingMode;
    const tunnel = this.tunnel;
    this.pendingMode = null;
    if (!mode || !tunnel) return;
    const results = await this.commands.runActions(tunnel, mode.actions, `${tunnel.name} / ${mode.name}`);
    this.modeResults = results;
    this.modeResultsId = mode.id;
    this.notify(results);
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
