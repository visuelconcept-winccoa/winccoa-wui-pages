// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Zones & locations configuration: one card per zone (accent colour, code/name,
 * occupancy) listing its locations in a table. Presentational — emits
 * `wui:addzone`, `wui:editzone {id}`, `wui:delzone {id}`, `wui:addloc {zoneId}`,
 * `wui:editloc {id}`, `wui:delloc {id}`; the page opens the dialog and persists.
 * `canEdit` gates every write affordance.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { locationUnits, occupancyPercent } from '../model.js';
import type { StockCell, StorageLocation, Zone } from '../types.js';

@customElement('wh-zones')
export class WhZones extends LitElement {
  static override readonly styles = [IXCoreStyles, zonesStyles()];

  @property({ attribute: false }) zones: Zone[] = [];
  @property({ attribute: false }) locations: StorageLocation[] = [];
  @property({ attribute: false }) stock: StockCell[] = [];
  @property({ type: Boolean }) canEdit = false;

  override render(): TemplateResult {
    return html`
      <div class="bar">
        <span class="grow"></span>
        ${this.canEdit
          ? html`<ix-button variant="secondary" outline @click=${() => this.emit('wui:addzone')}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.zones.addZone)}
            </ix-button>`
          : nothing}
      </div>
      ${this.zones.length === 0
        ? html`<div class="empty">${localizeDir(MSG.zones.noZones)}</div>`
        : this.zones.map((z) => this.renderZone(z))}
    `;
  }

  private renderZone(zone: Zone): TemplateResult {
    const locs = this.locations.filter((l) => l.zoneId === zone.id);
    // Fill is computed over the CAPPED locations only; uncapped (floor) ones
    // hold units but have no capacity to fill.
    const capped = locs.filter((l) => l.capacity > 0);
    const units = locs.reduce((sum, l) => sum + locationUnits(this.stock, l.id), 0);
    const cappedUnits = capped.reduce((sum, l) => sum + locationUnits(this.stock, l.id), 0);
    const capacity = capped.reduce((sum, l) => sum + l.capacity, 0);
    const pct = occupancyPercent(cappedUnits, capacity);
    return html`
      <div class="card" style="--accent:${zone.color}">
        <div class="card-head">
          <span class="dot"></span>
          <span class="ztitle">${zone.code} · ${zone.name}</span>
          <span class="zmeta">
            ${units.toLocaleString()} ${localize(MSG.common.units)}${pct == null ? '' : ` · ${pct}%`}
          </span>
          <span class="grow"></span>
          ${this.canEdit
            ? html`
                <ix-button variant="secondary" outline size="small" @click=${() => this.emit('wui:addloc', { zoneId: zone.id })}>
                  <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.zones.addLocation)}
                </ix-button>
                <ix-icon-button ghost size="16" icon="pen" title=${localize(MSG.common.edit)} @click=${() => this.emit('wui:editzone', { id: zone.id })}></ix-icon-button>
                <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.common.delete)} @click=${() => this.emit('wui:delzone', { id: zone.id })}></ix-icon-button>
              `
            : nothing}
        </div>
        ${locs.length === 0
          ? html`<div class="empty small">${localizeDir(MSG.zones.noLocations)}</div>`
          : this.renderLocations(locs)}
      </div>
    `;
  }

  private renderLocations(locs: StorageLocation[]): TemplateResult {
    return html`
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.zones.colCode)}</th>
            <th>${localizeDir(MSG.zones.colName)}</th>
            <th>${localizeDir(MSG.zones.colType)}</th>
            <th class="num">${localizeDir(MSG.zones.colCapacity)}</th>
            <th class="num">${localizeDir(MSG.zones.colOccupancy)}</th>
            ${this.canEdit ? html`<th class="actions-col"></th>` : nothing}
          </tr>
        </thead>
        <tbody>
          ${locs.map((l) => this.renderLocationRow(l))}
        </tbody>
      </table>
    `;
  }

  private renderLocationRow(loc: StorageLocation): TemplateResult {
    const units = locationUnits(this.stock, loc.id);
    // Never clamp: an over-filled location must READ as over-filled (e.g. 162%).
    const pct = occupancyPercent(units, loc.capacity);
    return html`
      <tr>
        <td class="strong">${loc.code}</td>
        <td>${loc.label}</td>
        <td class="muted">${localizeDir(MSG.locTypes[loc.type])}</td>
        <td class="num muted">${loc.capacity > 0 ? loc.capacity : '∞'}</td>
        <td class="num">
          ${units.toLocaleString()}${pct == null
            ? nothing
            : html` <span class=${pct > 100 ? 'overcap' : 'muted'}>(${pct}%)</span>`}
        </td>
        ${this.canEdit
          ? html`<td class="actions-col">
              <ix-icon-button ghost size="16" icon="pen" title=${localize(MSG.common.edit)} @click=${() => this.emit('wui:editloc', { id: loc.id })}></ix-icon-button>
              <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.common.delete)} @click=${() => this.emit('wui:delloc', { id: loc.id })}></ix-icon-button>
            </td>`
          : nothing}
      </tr>
    `;
  }

  private emit(
    type: 'wui:addzone' | 'wui:editzone' | 'wui:delzone' | 'wui:addloc' | 'wui:editloc' | 'wui:delloc',
    detail: unknown = {}
  ): void {
    // eslint-disable-next-line no-restricted-syntax -- name is statically constrained by the union type above
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function zonesStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .bar {
      display: flex;
      align-items: center;
      margin-bottom: 0.5rem;
    }
    .bar .grow,
    .card-head .grow {
      flex: 1;
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-left: 4px solid var(--accent, var(--theme-color-primary));
      border-radius: var(--theme-default-border-radius);
      padding: 0.6rem 0.75rem;
      margin-bottom: 0.75rem;
      background: var(--theme-color-1);
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.4rem;
    }
    .dot {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
      background: var(--accent, var(--theme-color-primary));
    }
    .ztitle {
      font-weight: 600;
    }
    .zmeta {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    thead th {
      text-align: left;
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
    }
    th.num,
    td.num {
      text-align: right;
    }
    tbody td {
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    tbody tr:last-child td {
      border-bottom: none;
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .overcap {
      color: var(--theme-color-alarm, #ef4444);
      font-weight: 600;
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
      text-align: right;
    }
    .empty {
      padding: 1.5rem;
      text-align: center;
      color: var(--theme-color-soft-text);
    }
    .empty.small {
      padding: 0.5rem;
      font-size: 0.85rem;
    }
  `;
}
