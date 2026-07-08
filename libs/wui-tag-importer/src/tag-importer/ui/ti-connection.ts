// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Step 1 — pick the OPC UA connection: select an existing `_OPCUAServer`
 * connection or create a new one (endpoint + security). Emits `wui:connection`
 * ({ name }) for a selection and `wui:createconnection` ({ NewConnection }) to
 * request creation (the page calls the backend and advances on success).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { Connection, MessageMode, NewConnection, SecurityPolicy } from '../data/api.js';
import { MSG, localize, localizeDir } from '../i18n.js';

const POLICIES: SecurityPolicy[] = ['None', 'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss'];
const MODES: MessageMode[] = ['None', 'Sign', 'SignAndEncrypt'];

export class TiConnection extends LitElement {
  static override readonly styles = [IXCoreStyles, connectionStyles()];

  @property({ attribute: false }) connections: Connection[] = [];
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) canCreate = true;
  @property({ type: String }) error = '';

  @state() private mode: 'select' | 'create' = 'select';
  @state() private selected = '';
  @state() private form: NewConnection = { endpoint: '', securityPolicy: 'None', messageMode: 'None' };

  override connectedCallback(): void {
    super.connectedCallback();
    // Default to the create form when there is nothing to select.
    if (this.connections.length === 0 && this.canCreate) this.mode = 'create';
  }

  override render(): TemplateResult {
    return html`
      <div class="tabs">
        <button class="tab ${this.mode === 'select' ? 'active' : ''}" @click=${() => (this.mode = 'select')}>
          ${localizeDir(MSG.connection.useExisting)}
        </button>
        ${this.canCreate
          ? html`<button class="tab ${this.mode === 'create' ? 'active' : ''}" @click=${() => (this.mode = 'create')}>
              ${localizeDir(MSG.connection.createNew)}
            </button>`
          : nothing}
      </div>
      ${this.error ? html`<ix-message-bar type="alert" .dismissible=${false}>${this.error}</ix-message-bar>` : nothing}
      ${this.mode === 'select' ? this.renderSelect() : this.renderCreate()}
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
      <ix-button variant="primary" ?disabled=${this.selected === '' || this.busy} @click=${() => this.onSelect()}>
        ${localizeDir(MSG.connection.continue)}
      </ix-button>
    </div>`;
  }

  private onSelect(): void {
    const conn = this.connections.find((c) => c.dp === this.selected);
    if (conn) {
      this.dispatchEvent(new CustomEvent('wui:connection', { detail: { name: conn.name, dp: conn.dp }, bubbles: true, composed: true }));
    }
  }

  private renderCreate(): TemplateResult {
    return html`<div class="form">
      ${this.field(MSG.connection.name, 'text', this.form.name ?? '', (v) => (this.form = { ...this.form, name: v }))}
      ${this.field(MSG.connection.endpoint, 'text', this.form.endpoint, (v) => (this.form = { ...this.form, endpoint: v }), 'opc.tcp://host:4840')}
      <label>
        <span>${localizeDir(MSG.connection.security)}</span>
        <select .value=${this.form.securityPolicy ?? 'None'} @change=${(e: Event) => (this.form = { ...this.form, securityPolicy: (e.target as HTMLSelectElement).value as SecurityPolicy })}>
          ${POLICIES.map((p) => html`<option value=${p} ?selected=${p === this.form.securityPolicy}>${p}</option>`)}
        </select>
      </label>
      <label>
        <span>${localizeDir(MSG.connection.mode)}</span>
        <select .value=${this.form.messageMode ?? 'None'} @change=${(e: Event) => (this.form = { ...this.form, messageMode: (e.target as HTMLSelectElement).value as MessageMode })}>
          ${MODES.map((m) => html`<option value=${m} ?selected=${m === this.form.messageMode}>${m}</option>`)}
        </select>
      </label>
      ${this.field(MSG.connection.user, 'text', this.form.user ?? '', (v) => (this.form = { ...this.form, user: v }))}
      ${this.field(MSG.connection.password, 'password', this.form.password ?? '', (v) => (this.form = { ...this.form, password: v }))}
      <div class="actions">
        <ix-button variant="primary" ?disabled=${this.busy || this.form.endpoint.trim() === ''} @click=${() => this.onCreate()}>
          ${this.busy ? localizeDir(MSG.connection.creating) : localizeDir(MSG.connection.create)}
        </ix-button>
      </div>
    </div>`;
  }

  private field(
    label: typeof MSG.connection.name,
    type: 'text' | 'password',
    value: string,
    set: (v: string) => void,
    placeholder = ''
  ): TemplateResult {
    return html`<label>
      <span>${localizeDir(label)}</span>
      <input type=${type} .value=${value} placeholder=${placeholder} @change=${(e: Event) => set((e.target as HTMLInputElement).value)} />
    </label>`;
  }

  private onCreate(): void {
    const cfg: NewConnection = {
      name: this.form.name?.trim() || undefined,
      endpoint: this.form.endpoint.trim(),
      securityPolicy: this.form.securityPolicy,
      messageMode: this.form.messageMode,
      user: this.form.user?.trim() || undefined,
      password: this.form.password || undefined
    };
    this.dispatchEvent(new CustomEvent('wui:createconnection', { detail: cfg, bubbles: true, composed: true }));
  }
}

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
