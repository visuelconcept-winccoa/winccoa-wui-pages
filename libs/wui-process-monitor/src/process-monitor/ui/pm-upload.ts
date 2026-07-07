// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Project upload panel: pick a .zip, optionally select folders to purge before
 * extraction, optionally restart after deploy (with a confirmation), then upload
 * (chunked) and deploy. Emits `pm:deployed { fileName, clearFolders, restart, result }`
 * so the page can trace the operation and refresh the console.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir, serverLabel } from '../i18n.js';
import { PROTECTED_FOLDERS, PURGEABLE_FOLDERS } from '../types.js';
import type { DeployServerResult } from '../types.js';
import { deployZip } from '../data/api.js';

const PCT = 100;

@customElement('pm-upload')
export class PmUpload extends LitElement {
  static override readonly styles = [IXCoreStyles, uploadStyles()];

  @property({ type: Boolean }) canEdit = false;
  @property({ attribute: false }) servers: { system: string; hostname: string }[] = [];

  @state() private file: File | null = null;
  @state() private clearFolders = new Set<string>();
  @state() private restart = false;
  @state() private busy = false;
  @state() private progress = 0;
  @state() private phase: 'idle' | 'uploading' | 'deploying' = 'idle';
  @state() private confirmOpen = false;
  @state() private message = '';
  @state() private failed = false;
  @state() private serverResults: DeployServerResult[] = [];

  @query('.file-input') private fileInput!: HTMLInputElement;

  // eslint-disable-next-line max-lines-per-function, sonarjs/cognitive-complexity -- single panel template
  override render(): TemplateResult {
    return html`
      <div class="box">
        <h3>${localizeDir(MSG.upload.title)}</h3>

        <div class="drop" @click=${() => this.fileInput.click()}>
          <input class="file-input" type="file" accept=".zip" hidden @change=${this.onFile} />
          ${this.file
            ? html`<span class="picked">${this.file.name} · ${fmtSize(this.file.size)}</span>`
            : html`<span class="hint">${localizeDir(MSG.upload.pick)}</span>
                <span class="muted">${localizeDir(MSG.upload.hint)}</span>`}
        </div>

        <div class="purge">
          <span class="lbl">${localizeDir(MSG.upload.purgeTitle)}</span>
          <div class="purge-list">
            ${PURGEABLE_FOLDERS.map(
              (f) => html`<label class="check">
                <input
                  type="checkbox"
                  ?checked=${this.clearFolders.has(f)}
                  @change=${(e: Event) => this.togglePurge(f, (e.target as HTMLInputElement).checked)}
                />
                <code>${f}</code>
              </label>`
            )}
          </div>
          <span class="muted">${localizeDir(MSG.upload.purgeHint)}</span>
          <span class="lbl protected-lbl">${localizeDir(MSG.upload.protectedTitle)}</span>
          <div class="purge-list">
            ${PROTECTED_FOLDERS.map((f) => html`<code class="protected">${f}</code>`)}
          </div>
          <span class="muted">${localizeDir(MSG.upload.protectedHint)}</span>
        </div>

        <label class="check">
          <input type="checkbox" ?checked=${this.restart} @change=${(e: Event) => (this.restart = (e.target as HTMLInputElement).checked)} />
          ${localizeDir(MSG.upload.restart)}
        </label>
        ${this.restart ? html`<div class="warn">${localizeDir(MSG.upload.restartWarn)}</div>` : nothing}

        <div class="target">
          <ix-icon name="network-device" size="16"></ix-icon>
          <span>${localizeDir(MSG.upload.targetAll)}${this.servers.length > 0 ? html` (${this.servers.length})` : nothing}</span>
          ${this.servers.map((s) => html`<span class="chip">${serverLabel(s)}</span>`)}
        </div>

        <ix-button ?disabled=${!this.canEdit || !this.file || this.busy} @click=${() => (this.confirmOpen = true)}>
          <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.upload.deploy)}
        </ix-button>

        ${this.busy
          ? html`<div class="progress">
              <div class="progress-status">
                <span>${localizeDir(this.phase === 'uploading' ? MSG.upload.uploading : MSG.upload.deploying)}</span>
                <span>${Math.round(this.progress * PCT)}%</span>
              </div>
              <div class="track"><div class="fill" style="width:${this.progress * PCT}%"></div></div>
            </div>`
          : nothing}
        ${this.message
          ? html`<div class="result ${this.failed ? 'err' : 'ok'}">
              <ix-icon name=${this.failed ? 'warning' : 'check'}></ix-icon>${this.message}
            </div>`
          : nothing}
        ${this.serverResults.length > 0
          ? html`<div class="server-results">
              ${this.serverResults.map(
                (r) => html`<div class="srv-line ${r.ok ? 'ok' : 'err'}">
                  <ix-icon name=${r.ok ? 'check' : 'warning'} size="16"></ix-icon>
                  <span class="srv-name">${serverLabel(r)}</span>
                  ${r.skipped && r.skipped.length > 0 ? html`<span class="srv-note">skipped: ${r.skipped.join(', ')}</span>` : nothing}
                  ${r.error ? html`<span class="srv-note">${r.error}</span>` : nothing}
                </div>`
              )}
            </div>`
          : nothing}
      </div>

      ${this.confirmOpen
        ? html`<div class="overlay" @click=${() => (this.confirmOpen = false)}>
            <div class="dialog" @click=${(e: Event) => e.stopPropagation()}>
              <h3>${localizeDir(MSG.upload.confirmTitle)}</h3>
              <p>${localizeDir(MSG.upload.confirmBody)}</p>
              ${this.restart ? html`<p class="warn">${localizeDir(MSG.upload.restartWarn)}</p>` : nothing}
              <div class="dialog-foot">
                <ix-button variant="secondary" outline @click=${() => (this.confirmOpen = false)}>
                  ${localizeDir(MSG.upload.cancel)}
                </ix-button>
                <ix-button @click=${() => void this.deploy()}>${localizeDir(MSG.upload.confirmYes)}</ix-button>
              </div>
            </div>
          </div>`
        : nothing}
    `;
  }

  private onFile(e: Event): void {
    const input = e.target as HTMLInputElement;
    this.file = input.files?.[0] ?? null;
    this.message = '';
  }

  private togglePurge(folder: string, on: boolean): void {
    const next = new Set(this.clearFolders);
    if (on) next.add(folder);
    else next.delete(folder);
    this.clearFolders = next;
  }

  private async deploy(): Promise<void> {
    this.confirmOpen = false;
    if (!this.file) return;
    const file = this.file;
    const clearFolders = [...this.clearFolders];
    const restart = this.restart;
    this.busy = true;
    this.failed = false;
    this.message = '';
    this.serverResults = [];
    this.phase = 'uploading';
    this.progress = 0;
    try {
      const result = await deployZip(file, {
        clearFolders,
        restart,
        target: 'all',
        onProgress: (f) => {
          this.progress = f;
          if (f >= 1) this.phase = 'deploying';
        }
      });
      this.failed = !result.ok;
      this.serverResults = result.results ?? [];
      this.message = result.ok ? localize(MSG.upload.deployed) : `${localize(MSG.upload.failed)} ${result.error ?? ''}`;
      this.dispatchEvent(
        new CustomEvent('wui:deployed', {
          detail: { fileName: file.name, clearFolders, restart, result },
          bubbles: true,
          composed: true
        })
      );
    } catch (error) {
      this.failed = true;
      this.message = `${localize(MSG.upload.failed)} ${error instanceof Error ? error.message : String(error)}`;
      this.dispatchEvent(
        new CustomEvent('wui:deployed', {
          detail: { fileName: file.name, clearFolders, restart, result: { ok: false, error: this.message } },
          bubbles: true,
          composed: true
        })
      );
    } finally {
      this.busy = false;
      this.phase = 'idle';
    }
  }
}

function fmtSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function uploadStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .box {
      max-width: 640px;
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    h3 {
      margin: 0;
    }
    .drop {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.25rem;
      padding: 1.5rem;
      border: 2px dashed var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      cursor: pointer;
      text-align: center;
    }
    .drop:hover {
      border-color: var(--theme-color-primary);
    }
    .picked {
      font-weight: 600;
    }
    .hint {
      color: var(--theme-color-std-text);
    }
    .muted {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .purge {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      padding: 0.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .lbl {
      font-weight: 600;
      font-size: 0.85rem;
    }
    .purge-list {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1.2rem;
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
    }
    code {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
    }
    .warn {
      font-size: 0.82rem;
      color: var(--theme-color-warning, #f59e0b);
    }
    .protected-lbl {
      margin-top: 0.5rem;
    }
    code.protected {
      color: var(--theme-color-alarm, #ef4444);
      opacity: 0.9;
    }
    .target {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .target .chip {
      padding: 0.05rem 0.45rem;
      border-radius: 999px;
      background: var(--theme-color-2);
      color: var(--theme-color-text);
      font-size: 0.75rem;
    }
    .server-results {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .srv-line {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.82rem;
    }
    .srv-line.ok {
      color: var(--theme-color-success, #10b981);
    }
    .srv-line.err {
      color: var(--theme-color-alarm, #ef4444);
    }
    .srv-name {
      font-weight: 600;
    }
    .srv-note {
      color: var(--theme-color-soft-text);
      font-weight: 400;
    }
    .progress {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .progress-status {
      display: flex;
      justify-content: space-between;
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .track {
      height: 6px;
      border-radius: 999px;
      background: var(--theme-color-1);
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: var(--theme-color-primary);
      transition: width 0.2s;
    }
    .result {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border-radius: var(--theme-default-border-radius);
    }
    .result.ok {
      border: 1px solid var(--theme-color-success, #10b981);
      color: var(--theme-color-success, #10b981);
      background: color-mix(in srgb, var(--theme-color-success, #10b981) 12%, transparent);
    }
    .result.err {
      border: 1px solid var(--theme-color-alarm, #ef4444);
      color: var(--theme-color-alarm, #ef4444);
      background: color-mix(in srgb, var(--theme-color-alarm, #ef4444) 12%, transparent);
    }
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }
    .dialog {
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 1rem 1.25rem;
      width: 460px;
      max-width: 92vw;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    }
    .dialog-foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
  `;
}
