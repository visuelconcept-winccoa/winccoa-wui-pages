// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Filter bar: one multi-select per tag dimension found on the machines (see
 * wui-fleet-core filters.ts), combinable, plus a reset. Emits `wui:filter` with the new
 * selection; the host remembers it and filters what it shows. Renders nothing when the
 * machines carry no tags.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import {
  isFilterActive,
  type FilterDimension,
  type FleetFilter
} from '@visuelconcept-winccoa/wui-fleet-core/filters.js';
import { MSG, localize, localizeDir } from '../i18n.js';

interface IxValueEvent {
  detail: string | string[];
}

@customElement('mf-filter-bar')
export class MfFilterBar extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: block;
      }
      .bar {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
      }
      .icon {
        color: var(--theme-color-soft-text);
      }
      ix-select {
        min-width: 11rem;
        max-width: 18rem;
      }
      .count {
        font-size: 0.8rem;
        color: var(--theme-color-soft-text);
      }
    `
  ];

  @property({ attribute: false }) dimensions: FilterDimension[] = [];
  @property({ attribute: false }) filter: FleetFilter = {};
  /** Optional "n of m machines" shown next to the selects. */
  @property({ attribute: false }) shown: number | null = null;
  @property({ attribute: false }) total: number | null = null;

  override render(): TemplateResult {
    if (this.dimensions.length === 0) return html``;
    const active = isFilterActive(this.filter);
    return html`
      <div class="bar" role="group" aria-label=${localize(MSG.filterBar.label)}>
        <ix-icon class="icon" name="filter" size="16"></ix-icon>
        ${this.dimensions.map(
          (d) => html`<ix-select
            mode="multiple"
            allow-clear
            i18n-placeholder=${d.key}
            title=${d.key}
            .value=${this.filter[d.key] ?? []}
            @valueChange=${(e: IxValueEvent) => this.set(d.key, e.detail)}
          >
            ${d.values.map((v) => html`<ix-select-item value=${v} label=${v}></ix-select-item>`)}
          </ix-select>`
        )}
        ${active
          ? html`<ix-button ghost @click=${this.reset}>
              <ix-icon name="clear-filter" slot="icon"></ix-icon>${localizeDir(MSG.filterBar.reset)}
            </ix-button>`
          : ''}
        ${active && this.shown != null && this.total != null
          ? html`<span class="count">${this.shown} / ${this.total} ${localize(MSG.filterBar.machines)}</span>`
          : ''}
      </div>
    `;
  }

  private set(key: string, detail: string | string[]): void {
    const values = (Array.isArray(detail) ? detail : [detail]).filter((v) => v !== '');
    const next: FleetFilter = { ...this.filter, [key]: values };
    if (values.length === 0) delete next[key];
    this.emit(next);
  }

  private readonly reset = (): void => this.emit({});

  private emit(filter: FleetFilter): void {
    this.dispatchEvent(new CustomEvent('wui:filter', { detail: filter, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'mf-filter-bar': MfFilterBar;
  }
}
