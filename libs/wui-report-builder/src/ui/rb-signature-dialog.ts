// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Signature dialog: confirms a workflow sign-off. Shows the action / role /
 * level, the signer (the connected user, recorded with a timestamp) and an
 * optional comment. Emits `wui:sign` with `{ comment }`, or `wui:cancel`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { dialogStyles } from './dialog-styles.js';
import type { SignOff } from '../types.js';

interface IxValueEvent {
  detail: string | number;
}

@customElement('rb-signature-dialog')
export class RbSignatureDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) signOff!: SignOff;
  @property() signerName = '';

  @state() private comment = '';

  override render(): TemplateResult {
    const so = this.signOff;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()} style="width:520px">
          <div class="panel-head"><ix-typography format="h3">${so?.actionLabel ?? 'Signer'}</ix-typography></div>
          <div class="panel-body">
            <div class="meta">
              <div><span class="k">Rôle / niveau</span><span class="v">${so?.roleLabel} · niveau ${so?.level}</span></div>
              <div><span class="k">Signataire</span><span class="v">${this.signerName || 'Utilisateur connecté'}</span></div>
            </div>
            <div class="field" style="margin-top:0.75rem">
              <label>Commentaire (optionnel)</label>
              <ix-input
                .value=${this.comment}
                placeholder="Visa, observations…"
                @valueChange=${(e: IxValueEvent) => (this.comment = String(e.detail))}
              ></ix-input>
            </div>
            <div class="hint">La signature enregistre votre nom et l'horodatage, puis fait avancer l'état du rapport.</div>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>Annuler</ix-button>
            <ix-button @click=${this.sign}><ix-icon name="pen" slot="icon"></ix-icon>Signer</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private sign(): void {
    this.dispatchEvent(
      new CustomEvent('wui:sign', { detail: { comment: this.comment }, bubbles: true, composed: true })
    );
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .meta {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .meta > div {
      display: flex;
      justify-content: space-between;
      gap: 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      padding-bottom: 0.3rem;
    }
    .k {
      color: var(--theme-color-soft-text);
    }
    .v {
      font-weight: 600;
    }
  `;
}
