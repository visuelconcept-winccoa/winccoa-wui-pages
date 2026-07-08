// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Step 1 — pick the OPC UA connection: select an existing `_OPCUAServer`
 * connection, edit it, or create a new one (endpoint + security + driver number).
 * A new connection requires a RUNNING OPC UA driver (`drivers` list); creation is
 * blocked otherwise. Emits `wui:connection` ({ name, dp }) for a selection,
 * `wui:createconnection` (NewConnection) and `wui:updateconnection`
 * ({ dp, cfg }) — the page performs the write and advances on success.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { readConnection, type Connection, type MessageMode, type NewConnection, type SecurityPolicy } from '../data/api.js';
import { MSG, localize, localizeDir } from '../i18n.js';

const POLICIES: SecurityPolicy[] = ['None', 'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss'];
const MODES: MessageMode[] = ['None', 'Sign', 'SignAndEncrypt'];

export class TiConnection extends LitElement {
  static override readonly styles = [IXCoreStyles, connectionStyles()];

  @property({ attribute: false }) connections: Connection[] = [];
  @property({ attribute: false }) drivers: number[] = [];
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) canCreate = true;
  @property({ type: String }) error = '';

  @state() private mode: 'select' | 'create' = 'select';
  @state() private selected = '';
  @state() private form: NewConnection = { endpoint: '', securityPolicy: 'None', messageMode: 'None' };
  /** Non-empty when editing an existing connection (its DP path) rather than creating. */
  @state() private editingDp = '';
  @state() private localError = '';

  override connectedCallback(): void {
    super.connectedCallback();
    if (this.connections.length === 0 && this.canCreate) this.startCreate();
  }

  override render(): TemplateResult {
    const message = this.error || this.localError;
    return html`
      <div class="tabs">
        <button class="tab ${this.mode === 'select' ? 'active' : ''}" @click=${() => (this.mode = 'select')}>
          ${localizeDir(MSG.connection.useExisting)}
        </button>
        ${this.canCreate
          ? html`<button class="tab ${this.mode === 'create' && this.editingDp === '' ? 'active' : ''}" @click=${() => this.startCreate()}>
              ${localizeDir(MSG.connection.createNew)}
            </button>`
          : nothing}
      </div>
      ${message ? html`<ix-message-bar type="alert" .dismissible=${false}>${message}</ix-message-bar>` : nothing}
      ${this.mode === 'select' ? this.renderSelect() : this.renderForm()}
    `;
  }

  private renderSelect(): TemplateResult {
    if (this.connections.length === 0) {
      return html`<div class="empty">${localizeDir(MSG.online.noConnections)}</div>`;
    }
    return html`<div class="row">
      <select .value=${this.selected} @change=${(e: Event) => (this.selected = (e.target as HTMLSelectElement).value)}>
        <option value="" disabled ?selected=${this.selected === ''}>—</option>
        ${this.connections.map(
          (c) => html`<option value=${c.dp} ?selected=${c.dp === this.selected}>
            ${c.name} · ${c.connected ? localize(MSG.online.connected) : localize(MSG.online.disconnected)}
          </option>`
        )}
      </select>
      ${this.canCreate
        ? html`<ix-button variant="secondary" outline ?disabled=${this.selected === '' || this.busy} @click=${() => void this.onEdit()}>
            ${localizeDir(MSG.connection.edit)}
          </ix-button>`
        : nothing}
      <ix-button variant="primary" ?disabled=${this.selected === '' || this.busy} @click=${() => this.onSelect()}>
        ${localizeDir(MSG.connection.continue)}
      </ix-button>
    </div>`;
  }

  private renderForm(): TemplateResult {
    const editing = this.editingDp !== '';
    const noDriver = !editing && this.drivers.length === 0;
    return html`<div class="form">
      ${editing ? html`<div class="editing">${localizeDir(MSG.connection.editing)}: <strong>${this.form.name}</strong></div>` : nothing}
      ${this.field(MSG.connection.name, 'text', this.form.name ?? '', (v) => (this.form = { ...this.form, name: v }))}
      ${this.field(MSG.connection.endpoint, 'text', this.form.endpoint, (v) => (this.form = { ...this.form, endpoint: v }), 'opc.tcp://host:4840')}
      ${this.renderSecurity()}
      ${this.field(MSG.connection.user, 'text', this.form.user ?? '', (v) => (this.form = { ...this.form, user: v }))}
      ${this.field(editing ? MSG.connection.passwordKeep : MSG.connection.password, 'password', this.form.password ?? '', (v) => (this.form = { ...this.form, password: v }))}
      ${editing ? nothing : this.renderDriver()}
      <div class="actions">
        <ix-button variant="primary" ?disabled=${this.busy || this.form.endpoint.trim() === '' || noDriver} @click=${() => this.onSubmit()}>
          ${this.submitLabel(editing)}
        </ix-button>
      </div>
    </div>`;
  }

  private renderSecurity(): TemplateResult {
    return html`
      <label>
        <span>${localizeDir(MSG.connection.security)}</span>
        <select
          .value=${this.form.securityPolicy ?? 'None'}
          @change=${(e: Event) => (this.form = { ...this.form, securityPolicy: (e.target as HTMLSelectElement).value as SecurityPolicy })}
        >
          ${POLICIES.map((p) => html`<option value=${p} ?selected=${p === this.form.securityPolicy}>${p}</option>`)}
        </select>
      </label>
      <label>
        <span>${localizeDir(MSG.connection.mode)}</span>
        <select
          .value=${this.form.messageMode ?? 'None'}
          @change=${(e: Event) => (this.form = { ...this.form, messageMode: (e.target as HTMLSelectElement).value as MessageMode })}
        >
          ${MODES.map((m) => html`<option value=${m} ?selected=${m === this.form.messageMode}>${m}</option>`)}
        </select>
      </label>
    `;
  }

  private renderDriver(): TemplateResult {
    if (this.drivers.length === 0) {
      return html`<div class="warn">${localizeDir(MSG.connection.noDriver)}</div>`;
    }
    return html`<label title=${localize(MSG.connection.driverHint)}>
      <span>${localizeDir(MSG.connection.driver)}</span>
      <select
        .value=${String(this.form.managerNumber ?? this.drivers[0])}
        @change=${(e: Event) => (this.form = { ...this.form, managerNumber: Number((e.target as HTMLSelectElement).value) })}
      >
        ${this.drivers.map((d) => html`<option value=${d} ?selected=${d === this.form.managerNumber}>-num ${d}</option>`)}
      </select>
    </label>`;
  }

  private field(label: typeof MSG.connection.name, type: 'text' | 'password', value: string, set: (v: string) => void, placeholder = ''): TemplateResult {
    return html`<label>
      <span>${localizeDir(label)}</span>
      <input type=${type} .value=${value} placeholder=${placeholder} @change=${(e: Event) => set((e.target as HTMLInputElement).value)} />
    </label>`;
  }

  private submitLabel(editing: boolean): string {
    if (editing) return localize(this.busy ? MSG.connection.saving : MSG.connection.save);
    return localize(this.busy ? MSG.connection.creating : MSG.connection.create);
  }

  private startCreate(): void {
    this.mode = 'create';
    this.editingDp = '';
    this.localError = '';
    this.form = { endpoint: '', securityPolicy: 'None', messageMode: 'None', managerNumber: this.drivers[0] };
  }

  private onSelect(): void {
    const conn = this.connections.find((c) => c.dp === this.selected);
    if (conn) {
      this.dispatchEvent(new CustomEvent('wui:connection', { detail: { name: conn.name, dp: conn.dp }, bubbles: true, composed: true }));
    }
  }

  private async onEdit(): Promise<void> {
    const conn = this.connections.find((c) => c.dp === this.selected);
    if (!conn) return;
    this.localError = '';
    try {
      const cfg = await readConnection(conn.dp);
      this.form = {
        name: conn.name,
        endpoint: cfg.endpoint,
        securityPolicy: cfg.securityPolicy,
        messageMode: cfg.messageMode,
        user: cfg.user,
        password: ''
      };
      this.editingDp = conn.dp;
      this.mode = 'create';
    } catch (error) {
      this.localError = error instanceof Error ? error.message : localize(MSG.connection.readError);
    }
  }

  private onSubmit(): void {
    const cfg: NewConnection = {
      name: this.form.name?.trim() || undefined,
      endpoint: this.form.endpoint.trim(),
      securityPolicy: this.form.securityPolicy,
      messageMode: this.form.messageMode,
      user: this.form.user?.trim() || undefined,
      password: this.form.password || undefined,
      managerNumber: this.form.managerNumber
    };
    if (this.editingDp) {
      this.dispatchEvent(new CustomEvent('wui:updateconnection', { detail: { dp: this.editingDp, cfg }, bubbles: true, composed: true }));
    } else {
      this.dispatchEvent(new CustomEvent('wui:createconnection', { detail: cfg, bubbles: true, composed: true }));
    }
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function connectionStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .tabs {
      display: flex;
      gap: 0.4rem;
      margin-bottom: 0.75rem;
    }
    .tab {
      padding: 0.35rem 0.8rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 999px;
      background: var(--theme-color-1);
      color: var(--theme-color-text);
      cursor: pointer;
      font-size: 0.85rem;
    }
    .tab.active {
      background: var(--theme-color-primary);
      border-color: var(--theme-color-primary);
      color: var(--theme-color-primary-contrast, #fff);
    }
    .row {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      flex-wrap: wrap;
    }
    .empty {
      opacity: 0.75;
      padding: 0.5rem 0;
    }
    .editing {
      font-size: 0.85rem;
      opacity: 0.85;
    }
    .warn {
      font-size: 0.85rem;
      color: var(--theme-color-warning, #c60);
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      max-width: 34rem;
    }
    .form label,
    .row label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.85rem;
    }
    input,
    select {
      padding: 0.4rem;
      background: var(--theme-color-1);
      color: var(--theme-color-text);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
    }
    .form .actions {
      display: flex;
      justify-content: flex-end;
      padding-top: 0.4rem;
    }
  `;
}

if (!customElements.get('ti-connection')) {
  customElements.define('ti-connection', TiConnection);
}
