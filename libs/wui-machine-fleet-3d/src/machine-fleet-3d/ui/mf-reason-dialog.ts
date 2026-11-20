// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Confirmation of a destructive action with a mandatory reason (e.g. deleting an atelier): the
 * confirm button stays disabled until a reason is typed; the reason goes to the audit trail.
 * Emits `wui:confirm` with { reason } on accept, `wui:cancel` on dismiss. A text selection
 * released outside the panel does not close it (overlay-dismiss).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';
import { overlayClicked, overlayDown } from '@visuelconcept-winccoa/wui-fleet-core/ui/overlay-dismiss.js';

interface IxValueEvent {
  detail: string;
}

@customElement('mf-reason-dialog')
export class MfReasonDialog extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    dialogStyles(),
    css`
      .panel.reason {
        width: 440px;
      }
      .panel-body {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
    `
  ];

  @property() heading = '';
  @property() message = '';
  @property() confirmLabel = '';

  @state() private reason = '';

  override render(): TemplateResult {
    const empty = this.reason.trim() === '';
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.cancel()}>
        <div class="panel reason" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${this.heading}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div>${this.message}</div>
            <ix-input
              label=${localize(MSG.reasonDialog.reason)}
              required
              .value=${this.reason}
              @valueChange=${(e: IxValueEvent) => (this.reason = String(e.detail ?? ''))}
              @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && !empty && this.confirm()}
            ></ix-input>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.reasonDialog.cancel)}</ix-button>
            <ix-button ?disabled=${empty} @click=${this.confirm}>
              <ix-icon name="trashcan" slot="icon"></ix-icon>${this.confirmLabel || localize(MSG.reasonDialog.confirm)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private confirm(): void {
    const reason = this.reason.trim();
    if (!reason) return;
    this.dispatchEvent(new CustomEvent('wui:confirm', { detail: { reason }, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}
