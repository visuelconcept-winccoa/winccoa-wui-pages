// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Give a cause from the catalog to a stop (#272): to a stop without one, or in place of the one
 * the machine sent. The cause and a reason are both mandatory; the choice is traced in the audit
 * trail by the store. Emits `wui:confirm` with { code, reason } on accept, `wui:cancel` on
 * dismiss. A text selection released outside the panel does not close it (overlay-dismiss).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';
import { overlayClicked, overlayDown } from '@visuelconcept-winccoa/wui-fleet-core/ui/overlay-dismiss.js';
import type { StopCause } from '../types.js';

interface IxValueEvent {
  detail: string;
}

@customElement('mf-qualify-dialog')
export class MfQualifyDialog extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    dialogStyles(),
    css`
      .panel.qualify {
        width: 480px;
      }
      .panel-body {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .stop {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.2rem 0.75rem;
        font-size: 0.85rem;
      }
      .stop span:nth-child(odd) {
        color: var(--theme-color-soft-text);
      }
    `
  ];

  @property({ attribute: false }) causes: StopCause[] = [];
  /** The stop's period, already formatted for display. */
  @property() period = '';
  /** The stop's cause as it stands (machine's or given by hand), already formatted; '' when none. */
  @property() current = '';
  /** Code to preselect (the current one, when it is in the catalog). */
  @property() initialCode = '';

  @state() private code = '';
  @state() private reason = '';

  override connectedCallback(): void {
    super.connectedCallback();
    this.code = this.causes.some((c) => c.code === this.initialCode) ? this.initialCode : '';
  }

  override render(): TemplateResult {
    const ready = this.code !== '' && this.reason.trim() !== '';
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.cancel()}>
        <div class="panel qualify" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.qualify.title)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="stop">
              <span>${localizeDir(MSG.qualify.period)}</span><span>${this.period}</span>
              <span>${localizeDir(MSG.qualify.current)}</span><span>${this.current || '—'}</span>
            </div>
            <ix-select
              label=${localize(MSG.qualify.cause)}
              required
              .value=${this.code}
              @valueChange=${(e: IxValueEvent) => (this.code = String(e.detail ?? ''))}
            >
              ${this.causes.map(
                (c) => html`<ix-select-item label=${`${c.code} — ${c.description}`} value=${c.code}></ix-select-item>`
              )}
            </ix-select>
            <ix-input
              label=${localize(MSG.qualify.reason)}
              required
              .value=${this.reason}
              @valueChange=${(e: IxValueEvent) => (this.reason = String(e.detail ?? ''))}
              @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && ready && this.confirm()}
            ></ix-input>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.qualify.cancel)}</ix-button>
            <ix-button ?disabled=${!ready} @click=${this.confirm}>${localizeDir(MSG.qualify.confirm)}</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private confirm(): void {
    const reason = this.reason.trim();
    if (!this.code || !reason) return;
    this.dispatchEvent(
      new CustomEvent('wui:confirm', { detail: { code: this.code, reason }, bubbles: true, composed: true })
    );
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}
