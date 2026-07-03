// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to create a new network or rename/redescribe an existing one
 * (name + description only — the diagram is drawn on the canvas). Emits
 * `wui:save` with the updated {@link Network} and `wui:cancel` on dismiss.
 */
import { dialogCore } from '@visuelconcept/wui-kit/ui/dialog-styles.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { blankNetwork, type Network } from '../types.js';
import { MSG, localize, localizeDir, renameTitleMsg } from '../i18n.js';

interface IxValueEvent {
  detail: string;
}

@customElement('am-network-dialog')
export class AmNetworkDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  /** Network to edit; when null the dialog creates a new one. */
  @property({ attribute: false }) network: Network | null = null;

  @state() private working: Network = blankNetwork();

  override render(): TemplateResult {
    const isNew = !this.network;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${isNew ? localizeDir(MSG.networkDialog.newTitle) : renameTitleMsg(this.working.name)}
            </ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="panel-body">
            <ix-input
              label=${localize(MSG.networkDialog.name)}
              .value=${this.working.name}
              @valueChange=${(e: IxValueEvent) => this.patch({ name: e.detail })}
            ></ix-input>
            <ix-input
              label=${localize(MSG.networkDialog.description)}
              .value=${this.working.description}
              @valueChange=${(e: IxValueEvent) => this.patch({ description: e.detail })}
            ></ix-input>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.networkDialog.cancel)}</ix-button>
            <ix-button ?disabled=${this.working.name.trim() === ''} @click=${this.save}>
              <ix-icon name="check" slot="icon"></ix-icon>${isNew
                ? localizeDir(MSG.networkDialog.create)
                : localizeDir(MSG.networkDialog.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('network')) {
      this.working = this.network ? structuredClone(this.network) : blankNetwork();
    }
  }

  private patch(part: Partial<Network>): void {
    this.working = { ...this.working, ...part };
  }

  private save(): void {
    if (this.working.name.trim() === '') return;
    this.dispatchEvent(new CustomEvent('wui:save', { detail: this.working, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function dialogStyles(): ReturnType<typeof css> {
  return css`
    ${dialogCore()}
    .panel {
      width: 460px;
    }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .panel-body {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .panel-foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
  `;
}
