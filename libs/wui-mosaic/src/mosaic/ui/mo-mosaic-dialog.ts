// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to create a new mosaic or rename/redescribe an existing one
 * (name + description only — the tiles are edited on the canvas). Emits
 * `wui:save` with the updated {@link Mosaic} and `wui:cancel` on dismiss.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { blankMosaic, type Mosaic } from '../types.js';
import { MSG, localize, localizeDir, renameTitleMsg } from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string;
}

@customElement('mo-mosaic-dialog')
export class MoMosaicDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  /** Mosaic to edit; when null the dialog creates a new one. */
  @property({ attribute: false }) mosaic: Mosaic | null = null;

  @state() private working: Mosaic = blankMosaic();

  override render(): TemplateResult {
    const isNew = !this.mosaic;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel small" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${isNew ? localizeDir(MSG.mosaicDialog.newTitle) : renameTitleMsg(this.working.name)}
            </ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="panel-body">
            <ix-input
              label=${localize(MSG.mosaicDialog.name)}
              .value=${this.working.name}
              @valueChange=${(e: IxValueEvent) => this.patch({ name: e.detail })}
            ></ix-input>
            <ix-input
              label=${localize(MSG.mosaicDialog.description)}
              .value=${this.working.description}
              @valueChange=${(e: IxValueEvent) => this.patch({ description: e.detail })}
            ></ix-input>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.mosaicDialog.cancel)}</ix-button>
            <ix-button ?disabled=${this.working.name.trim() === ''} @click=${this.save}>
              <ix-icon name="check" slot="icon"></ix-icon>${isNew
                ? localizeDir(MSG.mosaicDialog.create)
                : localizeDir(MSG.mosaicDialog.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('mosaic')) {
      this.working = this.mosaic ? structuredClone(this.mosaic) : blankMosaic();
    }
  }

  private patch(part: Partial<Mosaic>): void {
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

function extraStyles(): ReturnType<typeof css> {
  return css`
    .panel.small {
      width: 460px;
    }
  `;
}
