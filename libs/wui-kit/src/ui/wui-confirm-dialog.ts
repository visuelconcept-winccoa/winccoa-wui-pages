// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Neutral, reusable confirmation dialog (modal overlay) shown before destructive
 * actions. Single source of truth for every standalone page (replaces the former
 * per-page `*-confirm-dialog` copies). Emits `wui:confirm` on accept and
 * `wui:cancel` on dismiss. Registered under the shared tag `wui-confirm-dialog`
 * with a guard so it is safe in a chunk imported by several pages.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { dialogCore } from './dialog-styles.js';

const CONFIRM_TAG = 'wui-confirm-dialog';

export class WuiConfirmDialog extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      ${dialogCore()}
      .panel.confirm {
        width: 420px;
      }
    `
  ];

  @property() heading = 'Confirmer la suppression';
  @property() message = '';
  @property() confirmLabel = 'Supprimer';

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel confirm" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head"><ix-typography format="h3">${this.heading}</ix-typography></div>
          <div class="panel-body">${this.message}</div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>Annuler</ix-button>
            <ix-button @click=${this.confirm}>
              <ix-icon name="trashcan" slot="icon"></ix-icon>${this.confirmLabel}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private confirm(): void {
    this.dispatchEvent(new CustomEvent('wui:confirm', { bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

if (!customElements.get(CONFIRM_TAG)) {
  customElements.define(CONFIRM_TAG, WuiConfirmDialog);
}
