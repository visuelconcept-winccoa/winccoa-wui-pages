// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product Information Hub configuration dialog (opened from the Asset Lifecycle
 * toolbar gear, canPublish-gated). Edits the Siemens API base URL, API version
 * and API token, persisted to the `ProductInfo_Config` datapoint via
 * {@link saveProductInfoConfig}. Mirrors the AI-assistant config dialog, with
 * one deliberate difference: the token is write-only (never read back into the
 * UI — only whether one is set), so the key stays server-side.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import {
  DEFAULT_API_VERSION,
  DEFAULT_BASE_URL,
  loadProductInfoConfig,
  saveProductInfoConfig
} from '../data/product-info-config.js';

export class AliProductInfoConfigDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  @state() private baseUrl = DEFAULT_BASE_URL;
  @state() private apiVersion = DEFAULT_API_VERSION;
  @state() private hasKey = false;
  @state() private apiKey = '';
  @state() private credit = 0;
  @state() private saving = false;
  @state() private error = '';

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  // eslint-disable-next-line max-lines-per-function -- single dialog template
  override render(): TemplateResult {
    return html`
      <div class="backdrop" @click=${this.close}></div>
      <div class="dialog" role="dialog" aria-modal="true">
        <div class="head">
          <ix-icon name="cogwheel"></ix-icon><span>${localizeDir(MSG.config.title)}</span>
          <span class="spacer"></span>
          <ix-icon-button ghost icon="close" title=${localize(MSG.config.close)} @click=${this.close}></ix-icon-button>
        </div>
        <div class="body">
          <label class="field">
            <span class="lbl">${localizeDir(MSG.config.baseUrl)}</span>
            <input
              class="in"
              .value=${this.baseUrl}
              placeholder=${DEFAULT_BASE_URL}
              @input=${(e: Event) => (this.baseUrl = (e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span class="lbl">${localizeDir(MSG.config.apiVersion)}</span>
            <input
              class="in"
              .value=${this.apiVersion}
              placeholder=${DEFAULT_API_VERSION}
              @input=${(e: Event) => (this.apiVersion = (e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="field">
            <span class="lbl">${localizeDir(MSG.config.apiKey)}</span>
            <input
              class="in"
              type="password"
              autocomplete="off"
              .value=${this.apiKey}
              placeholder=${localize(MSG.config.keyPlaceholder)}
              @input=${(e: Event) => (this.apiKey = (e.target as HTMLInputElement).value)}
            />
            <span class="lbl">${localizeDir(this.hasKey ? MSG.config.keySet : MSG.config.keyNone)}</span>
          </label>
          <label class="field">
            <span class="lbl">${localizeDir(MSG.config.credit)}</span>
            <input
              class="in"
              type="number"
              min="0"
              step="1"
              .value=${String(this.credit)}
              @input=${(e: Event) => (this.credit = Number((e.target as HTMLInputElement).value) || 0)}
            />
            <span class="lbl">${localizeDir(MSG.config.creditHint)}</span>
          </label>

          <div class="hint">${localizeDir(MSG.config.hint)}</div>
          ${this.error ? html`<div class="err">${this.error}</div>` : ''}
        </div>
        <div class="foot">
          <ix-button variant="secondary" outline @click=${this.close}>${localizeDir(MSG.dialog.cancel)}</ix-button>
          <ix-button @click=${this.save} ?disabled=${this.saving}>
            <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.dialog.save)}
          </ix-button>
        </div>
      </div>
    `;
  }

  private async load(): Promise<void> {
    const cfg = await loadProductInfoConfig();
    this.baseUrl = cfg.baseUrl;
    this.apiVersion = cfg.apiVersion;
    this.hasKey = cfg.hasKey;
    this.credit = cfg.credit;
  }

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };

  private readonly save = async (): Promise<void> => {
    this.saving = true;
    this.error = '';
    try {
      await saveProductInfoConfig(
        { baseUrl: this.baseUrl.trim(), apiVersion: this.apiVersion.trim(), credit: this.credit },
        this.apiKey
      );
      this.close();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  };
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function dialogStyles(): ReturnType<typeof css> {
  return css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
    }
    .dialog {
      position: relative;
      width: 560px;
      max-width: 92vw;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      color: var(--theme-color-std-text);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      font-weight: 600;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      overflow: auto;
    }
    .spacer {
      flex: 1;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .lbl {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .in {
      width: 100%;
      box-sizing: border-box;
      padding: 0.4rem 0.5rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
    }
    .hint {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .err {
      padding: 0.4rem 0.6rem;
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-alarm, #ef4444) 18%, transparent);
      border: 1px solid var(--theme-color-alarm, #ef4444);
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
  `;
}

// Guarded registration (shared CustomElementRegistry across page bundles).
if (!customElements.get('ali-product-info-config-dialog')) {
  customElements.define('ali-product-info-config-dialog', AliProductInfoConfigDialog);
}
