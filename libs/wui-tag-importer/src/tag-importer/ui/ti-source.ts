// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Step 2 — pick the import source for the chosen connection: an OPC UA NodeSet2
 * XML file (offline structure) or live browsing of the connection. Emits
 * `wui:mode` and `wui:file` ({ name, text }); the connection is already selected
 * in the previous step.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { MSG, localizeDir } from '../i18n.js';

type Mode = 'file' | 'online';

export class TiSource extends LitElement {
  static override readonly styles = [IXCoreStyles, sourceStyles()];

  @property({ type: String }) mode: Mode | '' = '';
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) canImportFile = true;
  @property({ type: Boolean }) canBrowse = true;

  @state() private dragOver = false;

  override render(): TemplateResult {
    return html`
      <div class="modes">
        ${this.modeCard('file', MSG.source.fromFile, MSG.source.fromFileHint, 'document', this.canImportFile)}
        ${this.modeCard('online', MSG.source.fromServer, MSG.source.fromServerHint, 'connected', this.canBrowse)}
      </div>
      ${this.mode === 'file' ? this.renderFile() : nothing}
    `;
  }

  private emitMode(mode: Mode): void {
    this.dispatchEvent(new CustomEvent('wui:mode', { detail: mode, bubbles: true, composed: true }));
  }

  private async onFile(file: File | undefined): Promise<void> {
    if (!file) return;
    const text = await file.text();
    this.dispatchEvent(new CustomEvent('wui:file', { detail: { name: file.name, text }, bubbles: true, composed: true }));
  }

  private onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver = false;
    void this.onFile(e.dataTransfer?.files?.[0]);
  }

  private modeCard(mode: Mode, title: typeof MSG.source.fromFile, hint: typeof MSG.source.fromFileHint, icon: string, enabled: boolean): TemplateResult {
    return html`<button class="mode ${this.mode === mode ? 'active' : ''}" ?disabled=${!enabled} @click=${() => enabled && this.emitMode(mode)}>
      <ix-icon name=${icon} size="24"></ix-icon>
      <span class="mode-title">${localizeDir(title)}</span>
      <span class="mode-hint">${localizeDir(hint)}</span>
    </button>`;
  }

  private renderFile(): TemplateResult {
    return html`<div
      class="drop ${this.dragOver ? 'over' : ''}"
      @dragover=${(e: DragEvent) => {
        e.preventDefault();
        this.dragOver = true;
      }}
      @dragleave=${() => (this.dragOver = false)}
      @drop=${(e: DragEvent) => this.onDrop(e)}
      @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>('#file')?.click()}
    >
      <ix-icon name="upload" size="32"></ix-icon>
      <div>${localizeDir(MSG.file.drop)}</div>
      <div class="hint">${localizeDir(MSG.file.hint)}</div>
      <input
        id="file"
        type="file"
        accept=".xml,application/xml,text/xml"
        hidden
        @change=${(e: Event) => void this.onFile((e.target as HTMLInputElement).files?.[0])}
      />
    </div>`;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function sourceStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .modes {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .mode {
      flex: 1 1 260px;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      align-items: flex-start;
      text-align: left;
      padding: 1rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
      background: var(--theme-color-1);
      color: var(--theme-color-text);
      cursor: pointer;
    }
    .mode:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .mode.active {
      border-color: var(--theme-color-primary);
      box-shadow: inset 0 0 0 1px var(--theme-color-primary);
    }
    .mode-title {
      font-weight: 600;
    }
    .mode-hint {
      font-size: 0.8rem;
      opacity: 0.8;
    }
    .drop {
      margin-top: 1rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.4rem;
      padding: 2rem;
      border: 2px dashed var(--theme-color-soft-bdr);
      border-radius: 6px;
      cursor: pointer;
      color: var(--theme-color-text);
    }
    .drop.over {
      border-color: var(--theme-color-primary);
      background: var(--theme-color-2);
    }
    .drop .hint {
      font-size: 0.8rem;
      opacity: 0.7;
    }
  `;
}

if (!customElements.get('ti-source')) {
  customElements.define('ti-source', TiSource);
}
