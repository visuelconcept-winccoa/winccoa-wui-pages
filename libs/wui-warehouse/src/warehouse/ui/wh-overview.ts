// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Warehouse overview: one card per warehouse (mf-atelier-overview style) with an
 * SVG minimap of its zones and a few counters. Presentational — emits
 * `wui:open {id}`, `wui:create`, `wui:editwh {id}`, `wui:delwh {id}`; the page
 * routes / persists. `canEdit` gates create/edit/delete.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { locationUnits } from '../model.js';
import type { StockCell, StorageLocation, Warehouse, Zone } from '../types.js';

@customElement('wh-overview')
export class WhOverview extends LitElement {
  static override readonly styles = [IXCoreStyles, overviewStyles()];

  @property({ attribute: false }) warehouses: Warehouse[] = [];
  @property({ attribute: false }) zones: Zone[] = [];
  @property({ attribute: false }) locations: StorageLocation[] = [];
  @property({ attribute: false }) stock: StockCell[] = [];
  @property({ type: Boolean }) canEdit = false;

  override render(): TemplateResult {
    return html`
      <div class="bar">
        <span class="grow"></span>
        ${this.canEdit
          ? html`<ix-button variant="secondary" outline @click=${() => this.emit('wui:create')}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.warehouses.add)}
            </ix-button>`
          : nothing}
      </div>
      ${this.warehouses.length === 0
        ? html`<div class="empty">${localizeDir(MSG.warehouses.none)}</div>`
        : html`<div class="grid">${this.warehouses.map((w) => this.renderCard(w))}</div>`}
    `;
  }

  private renderCard(warehouse: Warehouse): TemplateResult {
    const zones = this.zones.filter((z) => z.warehouseId === warehouse.id);
    const zoneIds = new Set(zones.map((z) => z.id));
    const locs = this.locations.filter((l) => zoneIds.has(l.zoneId));
    const units = locs.reduce((sum, l) => sum + locationUnits(this.stock, l.id), 0);
    return html`
      <div class="card" style="--accent:${warehouse.color}" @click=${() => this.emit('wui:open', { id: warehouse.id })}>
        <div class="card-head">
          <span class="dot"></span>
          <span class="title">${warehouse.name}</span>
          <span class="grow"></span>
          ${this.canEdit
            ? html`
                <ix-icon-button ghost size="16" icon="pen" title=${localize(MSG.common.edit)}
                  @click=${(e: Event) => this.action(e, 'wui:editwh', warehouse.id)}></ix-icon-button>
                <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.common.delete)}
                  @click=${(e: Event) => this.action(e, 'wui:delwh', warehouse.id)}></ix-icon-button>
              `
            : nothing}
        </div>
        ${warehouse.description ? html`<div class="desc">${warehouse.description}</div>` : nothing}
        <div class="minimap">${this.renderMinimap(zones)}</div>
        <div class="stats">
          <span><b>${zones.length}</b> ${localizeDir(MSG.warehouses.zones)}</span>
          <span><b>${locs.length}</b> ${localizeDir(MSG.warehouses.locations)}</span>
          <span><b>${units.toLocaleString()}</b> ${localizeDir(MSG.common.units)}</span>
        </div>
      </div>
    `;
  }

  private renderMinimap(zones: Zone[]): TemplateResult {
    let w = 10;
    let h = 8;
    for (const z of zones) {
      w = Math.max(w, z.x + z.w);
      h = Math.max(h, z.y + z.h);
    }
    return html`
      <svg viewBox="0 0 ${w + 1} ${h + 1}" preserveAspectRatio="xMidYMid meet">
        ${zones.map((z) => this.renderMinimapZone(z))}
      </svg>
    `;
  }

  private renderMinimapZone(zone: Zone): SVGTemplateResult {
    return svg`<rect x=${zone.x} y=${zone.y} width=${zone.w} height=${zone.h} rx="0.4"
      fill=${zone.color} fill-opacity="0.35" stroke=${zone.color} stroke-width="0.15"></rect>`;
  }

  private action(e: Event, type: 'wui:editwh' | 'wui:delwh', id: string): void {
    e.stopPropagation();
    this.emit(type, { id });
  }

  private emit(type: 'wui:open' | 'wui:create' | 'wui:editwh' | 'wui:delwh', detail: unknown = {}): void {
    // eslint-disable-next-line no-restricted-syntax -- name is statically constrained by the union type above
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function overviewStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .bar {
      display: flex;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .grow {
      flex: 1;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
      gap: 0.75rem;
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-top: 4px solid var(--accent, var(--theme-color-primary));
      border-radius: var(--theme-default-border-radius);
      padding: 0.7rem 0.8rem;
      background: var(--theme-color-1);
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .card:hover {
      background: var(--theme-color-2);
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .dot {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
      background: var(--accent, var(--theme-color-primary));
    }
    .title {
      font-weight: 600;
      font-size: 1.02rem;
    }
    .desc {
      margin-top: 0.15rem;
      font-size: 0.82rem;
      color: var(--theme-color-soft-text);
    }
    .minimap {
      margin: 0.5rem 0;
      height: 120px;
      background: var(--theme-color-2);
      border-radius: var(--theme-default-border-radius);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.35rem;
    }
    .minimap svg {
      width: 100%;
      height: 100%;
    }
    .stats {
      display: flex;
      gap: 1rem;
      font-size: 0.82rem;
      color: var(--theme-color-soft-text);
    }
    .stats b {
      color: var(--theme-color-std-text);
    }
    .empty {
      padding: 2rem;
      text-align: center;
      color: var(--theme-color-soft-text);
    }
  `;
}
