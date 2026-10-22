// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to manage the placement markers of an atelier (posts or other landmarks): label
 * and floor position. Machines are then placed from a marker in their own dialog.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { type PlacementMarker } from '../types.js';
import { dialogStyles } from './dialog-styles.js';
import { MSG, localize, localizeDir } from '../i18n.js';

interface IxValueEvent {
  detail: string | number;
}

@customElement('mf-markers-dialog')
export class MfMarkersDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) markers: PlacementMarker[] = [];
  /** When false, the dialog is view-only: saving is disabled. */
  @property({ type: Boolean }) canEdit = true;

  @state() private working: PlacementMarker[] = [];

  override render(): TemplateResult {
    const ro = !this.canEdit;
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.markers.title)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="muted small">${localizeDir(MSG.markers.hint)}</div>
            <div class="rows">
              ${this.working.length === 0 ? html`<div class="muted">${localizeDir(MSG.markers.none)}</div>` : ''}
              ${this.working.map(
                (k, i) => html`<div class="row">
                  <ix-input
                    label=${localize(MSG.markers.label)}
                    .value=${k.label}
                    ?readonly=${ro}
                    @valueChange=${(e: IxValueEvent) => this.patch(i, { label: String(e.detail) })}
                  ></ix-input>
                  <ix-number-input
                    label="X"
                    .value=${k.x}
                    ?readonly=${ro}
                    @valueChange=${(e: IxValueEvent) => this.patch(i, { x: Number(e.detail) || 0 })}
                  ></ix-number-input>
                  <ix-number-input
                    label="Z"
                    .value=${k.z}
                    ?readonly=${ro}
                    @valueChange=${(e: IxValueEvent) => this.patch(i, { z: Number(e.detail) || 0 })}
                  ></ix-number-input>
                  <ix-icon-button
                    ghost
                    icon="trashcan"
                    title=${localize(MSG.markers.remove)}
                    ?disabled=${ro}
                    @click=${() => this.removeMarker(i)}
                  ></ix-icon-button>
                </div>`
              )}
            </div>
            ${this.canEdit
              ? html`<ix-button class="link" variant="secondary" @click=${this.add}>
                  <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.markers.add)}
                </ix-button>`
              : ''}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${this.canEdit ? localizeDir(MSG.markers.cancel) : localizeDir(MSG.markers.close)}</ix-button>
            ${this.canEdit ? html`<ix-button @click=${this.apply}>${localizeDir(MSG.markers.save)}</ix-button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('markers')) this.working = structuredClone(this.markers);
  }

  private patch(index: number, patch: Partial<PlacementMarker>): void {
    this.working = this.working.map((k, i) => (i === index ? { ...k, ...patch } : k));
  }

  private add(): void {
    const label = `${localize(MSG.markers.newLabel)} ${this.working.length + 1}`;
    this.working = [...this.working, { id: `mk-${Date.now()}`, label, x: 0, z: 0 }];
  }

  private removeMarker(index: number): void {
    this.working = this.working.filter((_, i) => i !== index);
  }

  private apply(): void {
    this.dispatchEvent(new CustomEvent('wui:apply', { detail: { markers: this.working }, bubbles: true, composed: true }));
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .rows {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-top: 0.6rem;
    }
    .row {
      display: grid;
      grid-template-columns: 1fr 6rem 6rem auto;
      gap: 0.5rem;
      align-items: end;
    }
    .link {
      margin-top: 0.5rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .small {
      font-size: 0.8rem;
    }
  `;
}
