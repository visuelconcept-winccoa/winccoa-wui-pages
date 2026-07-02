// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tunnel overview — one card per persisted tunnel (length, tubes, equipment
 * count, live compliance summary badge) plus the create dialog (name +
 * regulatory profile) and the demo-tunnel import. Emits `wui:open`,
 * `wui:create` and `wui:import-demo`; the shell owns the store.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ALL_PROFILES, checkCompliance, profileLabel } from '../data/compliance.js';
import { exportTunnel, parseTunnel, readFileText } from '../data/io.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { tunnelLengthM, type RegulatoryProfileId, type Tunnel } from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string;
}

/** Detail of the `wui:create` event. */
export interface CreateTunnelDetail {
  name: string;
  profile: RegulatoryProfileId;
}

@customElement('hd-overview')
export class HdOverview extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), overviewStyles()];

  @property({ attribute: false }) tunnels: Tunnel[] = [];
  @property({ type: Boolean }) offline = false;
  @property({ type: Boolean }) canEdit = false;

  @state() private creating = false;
  @state() private draftName = '';
  @state() private draftProfile: RegulatoryProfileId = 'eu-2004-54';
  @state() private importError = '';

  override render(): TemplateResult {
    return html`
      ${this.offline
        ? html`<ix-typography class="offline" color="soft">
            ${localizeDir(MSG.overview.offlineNotice)}
          </ix-typography>`
        : nothing}
      <div class="toolbar">
        <ix-button ?disabled=${!this.canEdit} @click=${() => this.openCreate()}>
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.overview.newTunnel)}
        </ix-button>
        <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.importDemo()}>
          <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.overview.importDemo)}
        </ix-button>
        <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.pickImportFile()}>
          <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.overview.importJson)}
        </ix-button>
        <input
          class="import-input"
          type="file"
          accept="application/json,.json"
          hidden
          @change=${(e: Event) => void this.onImportFile(e)}
        />
        ${this.importError ? html`<span class="import-error">${this.importError}</span>` : nothing}
      </div>
      ${this.tunnels.length === 0
        ? html`<div class="empty">${localizeDir(MSG.overview.empty)}</div>`
        : html`<div class="grid">${this.tunnels.map((t) => this.renderCard(t))}</div>`}
      ${this.creating ? this.renderCreateDialog() : nothing}
    `;
  }

  private renderCard(tunnel: Tunnel): TemplateResult {
    const issues = checkCompliance(tunnel);
    const errors = issues.filter((i) => i.severity === 'error').length;
    const warnings = issues.filter((i) => i.severity === 'warning').length;
    return html`
      <button class="card" @click=${() => this.open(tunnel.id)}>
        <div class="card-head">
          <ix-typography format="h4">${tunnel.name}</ix-typography>
          ${errors > 0
            ? html`<span class="badge error">${errors}</span>`
            : warnings > 0
              ? html`<span class="badge warning">${warnings}</span>`
              : html`<span class="badge ok"><ix-icon name="check" size="12"></ix-icon></span>`}
        </div>
        <div class="facts">
          <span>${Math.round(tunnelLengthM(tunnel))} m</span>
          <span>${tunnel.tubes.length} ${localizeDir(MSG.overview.tubes)}</span>
          <span>${tunnel.equipment.length} ${localizeDir(MSG.overview.equipmentCount)}</span>
        </div>
        <div class="card-foot">
          <div class="profile">${profileLabel(tunnel.profile)}</div>
          <div class="card-actions">
            <ix-icon-button
              icon="export"
              variant="secondary"
              ghost
              title=${localize(MSG.view.exportTunnel)}
              @click=${(e: Event) => this.onExport(e, tunnel)}
            ></ix-icon-button>
            <ix-icon-button
              icon="add-circle"
              variant="secondary"
              ghost
              ?disabled=${!this.canEdit}
              title=${localize(MSG.overview.duplicate)}
              @click=${(e: Event) => this.onDuplicate(e, tunnel)}
            ></ix-icon-button>
          </div>
        </div>
      </button>
    `;
  }

  private renderCreateDialog(): TemplateResult {
    return html`
      <div class="overlay" @click=${() => (this.creating = false)}>
        <div class="panel create" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.overview.newTunnel)}</ix-typography>
          </div>
          <div class="panel-body">
            <ix-input
              label=${localize(MSG.overview.name)}
              .value=${this.draftName}
              @valueChange=${(e: IxValueEvent) => (this.draftName = e.detail)}
            ></ix-input>
            <ix-select
              label=${localize(MSG.overview.profile)}
              .value=${this.draftProfile}
              @valueChange=${(e: IxValueEvent) => (this.draftProfile = String(e.detail) as RegulatoryProfileId)}
            >
              ${ALL_PROFILES.map(
                (p) => html`<ix-select-item label=${profileLabel(p)} value=${p}></ix-select-item>`
              )}
            </ix-select>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${() => (this.creating = false)}>
              ${localizeDir(MSG.overview.cancel)}
            </ix-button>
            <ix-button ?disabled=${this.draftName.trim() === ''} @click=${() => this.create()}>
              ${localizeDir(MSG.overview.create)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private openCreate(): void {
    this.draftName = '';
    this.draftProfile = 'eu-2004-54';
    this.creating = true;
  }

  private create(): void {
    this.creating = false;
    this.dispatchEvent(
      new CustomEvent<CreateTunnelDetail>('wui:create', {
        detail: { name: this.draftName.trim(), profile: this.draftProfile }
      })
    );
  }

  private importDemo(): void {
    this.dispatchEvent(new CustomEvent('wui:import-demo'));
  }

  private onExport(event: Event, tunnel: Tunnel): void {
    event.stopPropagation();
    exportTunnel(tunnel);
  }

  private onDuplicate(event: Event, tunnel: Tunnel): void {
    event.stopPropagation();
    this.dispatchEvent(new CustomEvent<Tunnel>('wui:duplicate', { detail: tunnel }));
  }

  private pickImportFile(): void {
    this.importError = '';
    this.renderRoot.querySelector<HTMLInputElement>('.import-input')?.click();
  }

  private async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const tunnel = parseTunnel(await readFileText(file));
      this.dispatchEvent(new CustomEvent<Tunnel>('wui:import', { detail: tunnel }));
    } catch (error) {
      this.importError = `${localize(MSG.overview.importFailed)} (${error instanceof Error ? error.message : String(error)})`;
    }
  }

  private open(id: string): void {
    this.dispatchEvent(new CustomEvent<{ id: string }>('wui:open', { detail: { id } }));
  }
}

function overviewStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      padding: 1rem;
      overflow: auto;
    }
    .offline {
      display: block;
      margin-bottom: 0.8rem;
    }
    .toolbar {
      display: flex;
      gap: 0.6rem;
      margin-bottom: 1rem;
    }
    .empty {
      color: var(--theme-color-soft-text);
      padding: 2rem 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
      gap: 1rem;
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 1rem;
      text-align: left;
      color: var(--theme-color-std-text);
      cursor: pointer;
      font: inherit;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .card:hover,
    .card:focus-visible {
      border-color: var(--theme-color-primary);
      outline: none;
    }
    .card-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.4rem;
      height: 1.4rem;
      padding: 0 0.3rem;
      border-radius: 0.7rem;
      font-size: 0.75rem;
      color: var(--theme-color-inv-std-text);
    }
    .badge.error {
      background: var(--theme-color-alarm);
    }
    .badge.warning {
      background: var(--theme-color-warning);
    }
    .badge.ok {
      background: var(--theme-color-success);
    }
    .facts {
      display: flex;
      gap: 1rem;
      color: var(--theme-color-soft-text);
      font-variant-numeric: tabular-nums;
    }
    .card-foot {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
    }
    .card-actions {
      display: flex;
      gap: 0.15rem;
    }
    .profile {
      color: var(--theme-color-weak-text);
      font-size: 0.8rem;
    }
    .import-error {
      color: var(--theme-color-alarm);
      font-size: 0.85rem;
      align-self: center;
    }
    .panel.create {
      width: 420px;
    }
    .panel-body {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-overview': HdOverview;
  }
}
