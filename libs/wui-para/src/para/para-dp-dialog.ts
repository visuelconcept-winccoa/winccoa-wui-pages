// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA "manage datapoint" dialog - create, rename or delete datapoint(s).
 *
 * A single dialog driven by `mode`, talking to the webserver.js PARA extension
 * (same origin):
 *   create       -> POST   /api/para/dp/create   { dpName, dpType }
 *   rename       -> POST   /api/para/dp/rename   { oldName, newName, expectedType }
 *   delete       -> DELETE /api/para/dp/:name?dpType=
 *   delete-multi -> DELETE /api/para/dp/:name?dpType=  sequentially for each
 *                   entry of `dps` (the nav tree's checkbox selection); failed
 *                   entries stay listed so the user can retry or cancel.
 *
 * Emits `wui:done` with `{ changed, deletedDps }` so the parent can close,
 * refresh and prune the nav selection. The type guard (expectedType / ?dpType=)
 * scopes every operation to the owning datapoint type, matching the backend
 * 409 contract (an empty dpType skips the guard).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import {
  MSG,
  dpCouldNotReachApiMsg,
  dpDeleteMultiConfirmMsg,
  dpDeleteMultiResultMsg,
  dpDeletingProgressMsg,
  dpRequestFailedMsg,
  localize,
  localizeDir
} from './i18n.js';

/** webserver.js PARA extension endpoints (relative = same origin). */
const CREATE_DP_URL = '/api/para/dp/create';
const RENAME_DP_URL = '/api/para/dp/rename';
/** DELETE target is `${DELETE_DP_BASE}/${encodeURIComponent(name)}`. */
const DELETE_DP_BASE = '/api/para/dp';

export type DpDialogMode = 'create' | 'rename' | 'delete' | 'delete-multi';

/** One datapoint targeted by a multi-delete (dpType '' = no type guard). */
export interface DpDeleteTarget {
  dp: string;
  dpType: string;
}

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
      .dp-list {
        margin: 0;
        padding-left: 1.25rem;
        max-height: 14rem;
        overflow: auto;
        font-size: 0.8125rem;
      }
    `
  ];

  /** Operation to perform. */
  @property({ type: String }) mode: DpDialogMode = 'create';
  /** Owning datapoint type - used as create type and as type guard. */
  @property({ type: String }) dpType = '';
  /** Existing datapoint name (rename / delete). */
  @property({ type: String }) dp = '';
  /** Datapoints targeted by a multi-delete (delete-multi mode only). */
  @property({ attribute: false }) dps: DpDeleteTarget[] = [];

  @state() private name = '';
  @state() private busy = false;
  @state() private error = '';
  /** Progress line while a multi-delete runs ("Deleting… 2/5"). */
  @state() private progress = '';
  /** Names already deleted in this dialog (reported to the parent on close). */
  private deletedDps: string[] = [];

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
            <ix-button outline @click=${this.cancel}>${localizeDir(MSG.dpDialog.cancel)}</ix-button>
            <ix-button
              variant=${this.isDelete() ? 'danger-primary' : 'primary'}
              ?disabled=${this.busy || (this.mode === 'delete-multi' && this.dps.length === 0)}
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
    if (this.mode === 'delete-multi') {
      return html`
        <div>${dpDeleteMultiConfirmMsg(this.dps.length)} ${localizeDir(MSG.dpDialog.cannotUndo)}</div>
        <ul class="dp-list">
          ${this.dps.map(
            (target) => html`<li><strong>${target.dp}</strong>${target.dpType === '' ? nothing : html` <span class="type-line">(${target.dpType})</span>`}</li>`
          )}
        </ul>
        ${this.progress === '' ? nothing : html`<div class="type-line">${this.progress}</div>`}
        ${this.error === '' ? nothing : html`<div class="error">${this.error}</div>`}
      `;
    }
    if (this.mode === 'delete') {
      return html`
        <div>${localizeDir(MSG.dpDialog.deleteConfirmPre)} <strong>${this.dp}</strong>? ${localizeDir(MSG.dpDialog.cannotUndo)}</div>
        <div class="type-line">${localizeDir(MSG.dpDialog.typePrefix)}: <code>${this.dpType}</code></div>
        ${this.error === '' ? nothing : html`<div class="error">${this.error}</div>`}
      `;
    }
    return html`
      <div class="type-line">${localizeDir(MSG.dpDialog.typePrefix)}: <code>${this.dpType}</code></div>
      <ix-input
        label=${localize(this.mode === 'rename' ? MSG.dpDialog.newDpName : MSG.dpDialog.dpName)}
        .value=${this.name}
        placeholder=${localize(MSG.dpDialog.dpNamePlaceholder)}
        @valueChange=${(e: Event) => (this.name = (e.target as HTMLInputElement).value)}
        @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.submit()}
      ></ix-input>
      ${this.error === '' ? nothing : html`<div class="error">${this.error}</div>`}
    `;
  }

  private isDelete(): boolean {
    return this.mode === 'delete' || this.mode === 'delete-multi';
  }

  private headerIcon(): string {
    if (this.isDelete()) {
      return 'trashcan';
    }
    return this.mode === 'rename' ? 'pen' : 'add-circle';
  }

  private headerTitle(): string {
    if (this.mode === 'delete-multi') {
      return localize(MSG.dpDialog.deleteMultiTitle);
    }
    if (this.mode === 'delete') {
      return localize(MSG.dpDialog.deleteTitle);
    }
    return localize(this.mode === 'rename' ? MSG.dpDialog.renameTitle : MSG.dpDialog.createTitle);
  }

  private submitLabel(): string {
    if (this.isDelete()) {
      return localize(MSG.dpDialog.delete);
    }
    return localize(this.mode === 'rename' ? MSG.dpDialog.rename : MSG.dpDialog.create);
  }

  private cancel(): void {
    // A partially completed multi-delete still changed data: let the parent refresh.
    this.emitDone(this.deletedDps.length > 0);
  }

  private done(): void {
    this.emitDone(true);
  }

  private emitDone(changed: boolean): void {
    this.dispatchEvent(
      new CustomEvent('wui:done', {
        detail: { changed, deletedDps: [...this.deletedDps] },
        bubbles: true,
        composed: true
      })
    );
  }

  private async submit(): Promise<void> {
    if (this.busy) {
      return;
    }
    if (this.mode === 'delete-multi') {
      await this.submitMultiDelete();
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
        if (this.mode === 'delete') {
          this.deletedDps.push(this.dp);
        }
        this.done();
      } else {
        this.error = result.error ?? dpRequestFailedMsg(response.status);
      }
    } catch (error) {
      this.error = dpCouldNotReachApiMsg(String(error));
    } finally {
      this.busy = false;
    }
  }

  /**
   * Delete the `dps` targets one by one (the backend deletes a single DP per
   * request). Failed targets stay listed with a summary error so the user can
   * retry them or cancel; the parent still gets the already-deleted names.
   */
  private async submitMultiDelete(): Promise<void> {
    if (this.dps.length === 0) {
      return;
    }
    this.busy = true;
    this.error = '';
    const total = this.dps.length;
    const failures: { target: DpDeleteTarget; error: string }[] = [];
    let done = 0;
    try {
      for (const target of this.dps) {
        this.progress = dpDeletingProgressMsg(done, total);
        const request = this.buildDeleteRequest(target.dp, target.dpType);
        try {
          const response = await fetch(request.url, request.init);
          const result = await response.json().catch(() => ({}));
          if (response.ok && result.ok) {
            this.deletedDps.push(target.dp);
          } else {
            failures.push({ target, error: result.error ?? dpRequestFailedMsg(response.status) });
          }
        } catch (error) {
          failures.push({ target, error: dpCouldNotReachApiMsg(String(error)) });
        }
        done += 1;
      }
    } finally {
      this.busy = false;
      this.progress = '';
    }
    if (failures.length === 0) {
      this.done();
      return;
    }
    // Keep only the failed targets listed so a retry does not re-delete.
    this.dps = failures.map((failure) => failure.target);
    this.error = `${dpDeleteMultiResultMsg(total - failures.length, total)} ${failures
      .map((failure) => `${failure.target.dp} (${failure.error})`)
      .join(', ')}`;
  }

  private buildDeleteRequest(dp: string, dpType: string): { url: string; init: RequestInit } {
    const query = dpType === '' ? '' : `?dpType=${encodeURIComponent(dpType)}`;
    return { url: `${DELETE_DP_BASE}/${encodeURIComponent(dp)}${query}`, init: { method: 'DELETE' } };
  }

  private buildRequest(): { url: string; init: RequestInit } | null {
    if (this.mode === 'delete') {
      return this.buildDeleteRequest(this.dp, this.dpType);
    }

    const name = this.name.trim();
    if (name === '') {
      this.error = localize(MSG.dpDialog.nameRequired);
      return null;
    }
    if (this.mode === 'rename') {
      if (name === this.dp) {
        this.error = localize(MSG.dpDialog.nameMustDiffer);
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
