/**
 * PARA "manage datapoint" dialog - create, rename or delete a datapoint.
 *
 * A single dialog driven by `mode`, talking to the webserver.js PARA extension
 * (same origin):
 *   create -> POST   /api/para/dp/create   { dpName, dpType }
 *   rename -> POST   /api/para/dp/rename   { oldName, newName, expectedType }
 *   delete -> DELETE /api/para/dp/:name?dpType=
 *
 * Emits `wui:done` with `{ changed: boolean }` so the parent can close and
 * refresh. The type guard (expectedType / ?dpType=) scopes every operation to
 * the owning datapoint type, matching the backend 409 contract.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';

/** webserver.js PARA extension endpoints (relative = same origin). */
const CREATE_DP_URL = '/api/para/dp/create';
const RENAME_DP_URL = '/api/para/dp/rename';
/** DELETE target is `${DELETE_DP_BASE}/${encodeURIComponent(name)}`. */
const DELETE_DP_BASE = '/api/para/dp';

export type DpDialogMode = 'create' | 'rename' | 'delete';

/** Build a JSON POST request init for the PARA extension. */
function jsonPost(body: object): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export class WuiParaDpDialog extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      .overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.6);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .panel {
        background: var(--theme-color-2);
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
        width: 460px;
        max-width: 92vw;
        max-height: 88vh;
        display: flex;
        flex-direction: column;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
      }
      .header,
      .footer {
        padding: 0.75rem 1rem;
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .header {
        border-bottom: 1px solid var(--theme-color-soft-bdr);
      }
      .footer {
        border-top: 1px solid var(--theme-color-soft-bdr);
        justify-content: flex-end;
      }
      .body {
        padding: 1rem;
        overflow: auto;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .title {
        font-weight: 600;
        flex: 1;
      }
      .type-line {
        font-size: 0.8125rem;
        color: var(--theme-color-soft-text);
      }
      .type-line code {
        font-family: monospace;
        color: var(--theme-color-std-text);
      }
      .error {
        color: var(--theme-color-alarm);
      }
    `
  ];

  /** Operation to perform. */
  @property({ type: String }) mode: DpDialogMode = 'create';
  /** Owning datapoint type - used as create type and as type guard. */
  @property({ type: String }) dpType = '';
  /** Existing datapoint name (rename / delete). */
  @property({ type: String }) dp = '';

  @state() private name = '';
  @state() private busy = false;
  @state() private error = '';

  override connectedCallback(): void {
    super.connectedCallback();
    // Pre-fill the rename field with the current name for easy editing.
    if (this.mode === 'rename') {
      this.name = this.dp;
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="header">
            <ix-icon name="${this.headerIcon()}" size="24"></ix-icon>
            <span class="title">${this.headerTitle()}</span>
            <ix-icon-button icon="close" ghost @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="body">${this.renderBody()}</div>
          <div class="footer">
            <ix-button outline @click=${this.cancel}>Cancel</ix-button>
            <ix-button
              variant=${this.mode === 'delete' ? 'danger-primary' : 'primary'}
              ?disabled=${this.busy}
              .loading=${this.busy}
              @click=${this.submit}
            >
              ${this.submitLabel()}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderBody(): TemplateResult {
    if (this.mode === 'delete') {
      return html`
        <div>Delete datapoint <strong>${this.dp}</strong>? This cannot be undone.</div>
        <div class="type-line">Type: <code>${this.dpType}</code></div>
        ${this.error === '' ? nothing : html`<div class="error">${this.error}</div>`}
      `;
    }
    return html`
      <div class="type-line">Type: <code>${this.dpType}</code></div>
      <ix-input
        label="${this.mode === 'rename' ? 'New datapoint name' : 'Datapoint name'}"
        .value=${this.name}
        placeholder="MyDatapoint"
        @valueChange=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.submit()}
      ></ix-input>
      ${this.error === '' ? nothing : html`<div class="error">${this.error}</div>`}
    `;
  }

  private headerIcon(): string {
    if (this.mode === 'delete') {
      return 'trashcan';
    }
    return this.mode === 'rename' ? 'pen' : 'add-circle';
  }

  private headerTitle(): string {
    if (this.mode === 'delete') {
      return 'Delete datapoint';
    }
    return this.mode === 'rename' ? 'Rename datapoint' : 'Create datapoint';
  }

  private submitLabel(): string {
    if (this.mode === 'delete') {
      return 'Delete';
    }
    return this.mode === 'rename' ? 'Rename' : 'Create';
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:done', { detail: { changed: false }, bubbles: true, composed: true }));
  }

  private done(): void {
    this.dispatchEvent(new CustomEvent('wui:done', { detail: { changed: true }, bubbles: true, composed: true }));
  }

  private async submit(): Promise<void> {
    if (this.busy) {
      return;
    }
    const request = this.buildRequest();
    if (request === null) {
      return;
    }
    this.busy = true;
    this.error = '';
    try {
      const response = await fetch(request.url, request.init);
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        this.done();
      } else {
        this.error = result.error ?? `Request failed (HTTP ${response.status})`;
      }
    } catch (error) {
      this.error = `Could not reach the PARA API: ${String(error)}`;
    } finally {
      this.busy = false;
    }
  }

  private buildRequest(): { url: string; init: RequestInit } | null {
    if (this.mode === 'delete') {
      const query = this.dpType === '' ? '' : `?dpType=${encodeURIComponent(this.dpType)}`;
      return { url: `${DELETE_DP_BASE}/${encodeURIComponent(this.dp)}${query}`, init: { method: 'DELETE' } };
    }

    const name = this.name.trim();
    if (name === '') {
      this.error = 'A datapoint name is required';
      return null;
    }
    if (this.mode === 'rename') {
      if (name === this.dp) {
        this.error = 'The new name must differ from the current name';
        return null;
      }
      return { url: RENAME_DP_URL, init: jsonPost({ oldName: this.dp, newName: name, expectedType: this.dpType }) };
    }
    return { url: CREATE_DP_URL, init: jsonPost({ dpName: name, dpType: this.dpType }) };
  }
}

if (!customElements.get('wui-para-dp-dialog')) {
  customElements.define('wui-para-dp-dialog', WuiParaDpDialog);
}
