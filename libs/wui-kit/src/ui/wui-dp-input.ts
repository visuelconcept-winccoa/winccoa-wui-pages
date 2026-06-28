// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Datapoint input with live autocomplete + browse button (shared kit component).
 *
 * Wraps `ix-input` and queries `OaRxJsApi.dpNames(pattern)` (debounced) to
 * suggest matching datapoint (element) names. The magnifier button forces a
 * lookup with the current text. Emits `wui:change` with the chosen value.
 * Degrades to a plain input when no backend connection is available.
 *
 * Moved out of the machine-fleet-3d page (was `mf-dp-input`) so report pages and
 * any other page can reuse it without reaching across page folders. Registered
 * under the shared tag `wui-dp-input` with a guard (safe in a shared chunk).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';

interface IxValueEvent {
  detail: string;
}

const DP_INPUT_TAG = 'wui-dp-input';
const DEBOUNCE_MS = 250;
const MAX_SUGGESTIONS = 40;
const MIN_QUERY_LEN = 1;

/**
 * A top-level DP (no element part) must end with a dot to be a valid DPE. Add it
 * when missing; leave element/already-dotted paths untouched.
 */
function ensureTrailingDot(dpe: string): string {
  const v = dpe.trim();
  if (v === '' || v.includes('.')) return v;
  return `${v}.`;
}

export class WuiDpInput extends LitElement {
  static override readonly styles = [IXCoreStyles, dpInputStyles()];

  @property() value = '';
  @property() label = '';
  @property() placeholder = 'System1:Datapoint.value';

  @state() private suggestions: string[] = [];
  @state() private open = false;

  private readonly api = this.resolveApi();
  private querySub = new Subscription();
  private debounce = 0;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.querySub.unsubscribe();
    clearTimeout(this.debounce);
  }

  override render(): TemplateResult {
    return html`
      <div class="wrap">
        <ix-input
          class="field"
          label=${this.label}
          placeholder=${this.placeholder}
          .value=${this.value}
          @valueChange=${(e: IxValueEvent) => this.onInput(e.detail)}
          @ixBlur=${this.onBlur}
        ></ix-input>
        <ix-icon-button
          class="browse"
          ghost
          icon="search"
          title="Rechercher un datapoint"
          @click=${this.browse}
        ></ix-icon-button>
        ${this.open && this.suggestions.length > 0
          ? html`<div class="suggestions">
              ${this.suggestions.map(
                (s) => html`<div class="item" @pointerdown=${() => this.choose(s)}>${s}</div>`
              )}
            </div>`
          : ''}
      </div>
    `;
  }

  private onInput(value: string): void {
    this.value = value;
    this.emit(value);
    clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => this.query(value), DEBOUNCE_MS);
  }

  private browse(): void {
    this.query(this.value || '*');
  }

  private query(text: string): void {
    if (!this.api) return;
    const trimmed = text.trim();
    if (trimmed.length < MIN_QUERY_LEN) {
      this.open = false;
      return;
    }
    const pattern = trimmed.includes('*') ? trimmed : `*${trimmed}*`;
    this.querySub.unsubscribe();
    this.querySub = new Subscription();
    try {
      this.querySub.add(
        this.api.dpNames(pattern, '').subscribe((names: string[]) => {
          this.suggestions = names.slice(0, MAX_SUGGESTIONS);
          this.open = this.suggestions.length > 0;
        })
      );
    } catch {
      this.open = false;
    }
  }

  private choose(name: string): void {
    this.open = false;
    this.commit(ensureTrailingDot(name));
  }

  private onBlur(): void {
    const fixed = ensureTrailingDot(this.value);
    if (fixed !== this.value) this.commit(fixed);
  }

  private commit(value: string): void {
    this.value = value;
    this.emit(value);
  }

  private emit(value: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:change', { detail: { value }, bubbles: true, composed: true })
    );
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

if (!customElements.get(DP_INPUT_TAG)) {
  customElements.define(DP_INPUT_TAG, WuiDpInput);
}

function dpInputStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .wrap {
      position: relative;
      display: flex;
      align-items: flex-end;
      gap: 0.25rem;
    }
    .field {
      flex: 1;
    }
    .suggestions {
      position: absolute;
      top: 100%;
      left: 0;
      right: 2rem;
      z-index: 20;
      max-height: 12rem;
      overflow-y: auto;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    }
    .item {
      padding: 0.3rem 0.5rem;
      cursor: pointer;
      font-size: 0.8rem;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .item:hover {
      background: var(--theme-color-2);
    }
  `;
}
