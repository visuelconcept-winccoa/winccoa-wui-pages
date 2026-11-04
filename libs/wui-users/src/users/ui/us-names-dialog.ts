// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** The names of the 32 permission levels. Emits `wui:write` (`/permissions/names`) and `wui:cancel`. */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type CSSResult, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { dialogCore } from '@visuelconcept-winccoa/wui-kit/ui/dialog-styles.js';
import { MSG, localizeDir } from '../i18n.js';
import type { WriteIntent } from '../types.js';

@customElement('us-names-dialog')
export class UsNamesDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  @property({ attribute: false }) names: string[] = [];

  @state() private values: string[] = [];

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('names')) this.values = Array.from({ length: 32 }, (_, i) => this.names[i] ?? '');
  }

  override render(): TemplateResult {
    const c = MSG.common;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.namesDialog.title)}</ix-typography>
          </div>
          <div class="panel-body">
            <div class="hint">${localizeDir(MSG.namesDialog.hint)}</div>
            <div class="names">
              ${this.values.map(
                (value, i) => html`<label>${i + 1}</label>
                  <ix-input .value=${value} @valueChange=${(e: CustomEvent<string>) => this.set(i, String(e.detail))}></ix-input>`
              )}
            </div>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(c.cancel)}</ix-button>
            <ix-button @click=${this.save}><ix-icon name="disk" slot="icon"></ix-icon>${localizeDir(c.save)}</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private set(index: number, value: string): void {
    this.values = this.values.map((v, i) => (i === index ? value : v));
  }

  private save(): void {
    const detail: WriteIntent = { ops: [{ path: '/permissions/names', body: { names: this.values } }] };
    this.dispatchEvent(new CustomEvent('wui:write', { detail, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 720px;
    }
    .names {
      display: grid;
      grid-template-columns: 2rem 1fr 2rem 1fr;
      gap: 0.3rem 0.5rem;
      align-items: center;
    }
    .names label {
      text-align: right;
      color: var(--theme-color-soft-text);
    }
  `;
}
