// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Inventory panel with two modes driven by the page's `openCampaign`:
 *  - list of campaigns (scope · status · counted progress · net variance) with
 *    open / validate / delete actions;
 *  - the count sheet of the opened campaign — one row per stock line, the book
 *    (system) quantity, an editable physical count and the live variance.
 *
 * Presentational — emits `wui:new`, `wui:open {id}`, `wui:back`, `wui:del {id}`,
 * `wui:save {counts}` (persist entered counts) and `wui:valid {id}` (validate →
 * the page confirms, writes counts to stock, closes the campaign). `canManage`
 * gates every write affordance.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, dateLabel, localize, localizeDir } from '../i18n.js';
import type { InventoryCampaign, InventoryLine, Product, StorageLocation, Zone } from '../types.js';

interface IxValueEvent {
  detail: string | number;
}

/** One saved count reported to the page. */
export interface CountEntry {
  locationId: string;
  productId: string;
  counted: number | null;
}

function lineKey(line: { locationId: string; productId: string }): string {
  return `${line.locationId}__${line.productId}`;
}

@customElement('wh-inventory')
export class WhInventory extends LitElement {
  static override readonly styles = [IXCoreStyles, inventoryStyles()];

  @property({ attribute: false }) campaigns: InventoryCampaign[] = [];
  @property({ attribute: false }) openCampaign: InventoryCampaign | null = null;
  @property({ attribute: false }) products: Product[] = [];
  @property({ attribute: false }) locations: StorageLocation[] = [];
  @property({ attribute: false }) zones: Zone[] = [];
  @property({ type: Boolean }) canManage = false;

  /** Local raw count inputs keyed by line — seeded whenever the opened campaign changes. */
  @state() private counts: Record<string, string> = {};

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('openCampaign')) this.seedCounts();
  }

  override render(): TemplateResult {
    return this.openCampaign ? this.renderSheet(this.openCampaign) : this.renderList();
  }

  private renderList(): TemplateResult {
    return html`
      <div class="bar">
        <span class="grow"></span>
        ${this.canManage
          ? html`<ix-button variant="secondary" outline @click=${() => this.emit('wui:new')}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.inventory.newCampaign)}
            </ix-button>`
          : nothing}
      </div>
      ${this.campaigns.length === 0
        ? html`<div class="empty">${localizeDir(MSG.inventory.noCampaigns)}</div>`
        : html`<table>
            <thead>
              <tr>
                <th>${localizeDir(MSG.inventory.colName)}</th>
                <th>${localizeDir(MSG.inventory.colZone)}</th>
                <th>${localizeDir(MSG.inventory.colStatus)}</th>
                <th>${localizeDir(MSG.inventory.colCreated)}</th>
                <th class="num">${localizeDir(MSG.inventory.colProgress)}</th>
                <th class="num">${localizeDir(MSG.inventory.colVariance)}</th>
                <th class="actions-col"></th>
              </tr>
            </thead>
            <tbody>
              ${this.campaigns.map((c) => this.renderCampaignRow(c))}
            </tbody>
          </table>`}
    `;
  }

  private renderCampaignRow(campaign: InventoryCampaign): TemplateResult {
    const counted = campaign.lines.filter((l) => l.countedQty != null).length;
    const net = campaign.lines.reduce((sum, l) => sum + (l.countedQty == null ? 0 : l.countedQty - l.systemQty), 0);
    const validated = campaign.status === 'validated';
    return html`
      <tr>
        <td class="strong">${campaign.name}</td>
        <td class="muted">${this.scopeLabel(campaign.zoneId)}</td>
        <td>
          <ix-chip variant=${validated ? 'success' : 'info'} style="--ix-chip-height: 1.25rem;">
            ${localize(validated ? MSG.inventory.statusValidated : MSG.inventory.statusCounting)}
          </ix-chip>
        </td>
        <td class="muted">${dateLabel(campaign.createdAt)}</td>
        <td class="num muted">${counted} / ${campaign.lines.length}</td>
        <td class="num ${this.signClass(net)}">${net > 0 ? '+' : ''}${net.toLocaleString()}</td>
        <td class="actions-col">
          <ix-icon-button ghost size="16" icon="visible" title=${localize(MSG.inventory.open)} @click=${() => this.emit('wui:open', { id: campaign.id })}></ix-icon-button>
          ${this.canManage && !validated
            ? html`<ix-icon-button ghost size="16" icon="success" title=${localize(MSG.inventory.validate)} @click=${() => this.emit('wui:valid', { id: campaign.id })}></ix-icon-button>`
            : nothing}
          ${this.canManage
            ? html`<ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.common.delete)} @click=${() => this.emit('wui:del', { id: campaign.id })}></ix-icon-button>`
            : nothing}
        </td>
      </tr>
    `;
  }

  private renderSheet(campaign: InventoryCampaign): TemplateResult {
    const editable = this.canManage && campaign.status !== 'validated';
    return html`
      <div class="bar">
        <ix-button variant="secondary" outline @click=${() => this.emit('wui:back')}>
          <ix-icon name="arrow-left" slot="icon"></ix-icon>${localizeDir(MSG.common.back)}
        </ix-button>
        <span class="sheet-title">${campaign.name} · ${this.scopeLabel(campaign.zoneId)}</span>
        <span class="grow"></span>
        ${editable
          ? html`
              <ix-button variant="secondary" outline @click=${() => this.emit('wui:save', { counts: this.collectCounts() })}>
                <ix-icon name="save" slot="icon"></ix-icon>${localizeDir(MSG.inventory.saveCounts)}
              </ix-button>
              <ix-button @click=${() => this.emit('wui:valid', { id: campaign.id })}>
                <ix-icon name="success" slot="icon"></ix-icon>${localizeDir(MSG.inventory.validate)}
              </ix-button>
            `
          : nothing}
      </div>
      <div class="hint">${localizeDir(MSG.inventory.countHint)}</div>
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.stock.colProduct)}</th>
            <th>${localizeDir(MSG.stock.colLocation)}</th>
            <th class="num">${localizeDir(MSG.inventory.colSystem)}</th>
            <th class="num">${localizeDir(MSG.inventory.colCounted)}</th>
            <th class="num">${localizeDir(MSG.inventory.colVariance)}</th>
          </tr>
        </thead>
        <tbody>
          ${campaign.lines.map((l) => this.renderLine(l, editable))}
        </tbody>
      </table>
    `;
  }

  private renderLine(line: InventoryLine, editable: boolean): TemplateResult {
    const product = this.products.find((p) => p.id === line.productId);
    const loc = this.locations.find((l) => l.id === line.locationId);
    const counted = this.parseCounted(this.counts[lineKey(line)] ?? '');
    const variance = counted == null ? null : counted - line.systemQty;
    return html`
      <tr>
        <td>
          <div class="strong">${product?.name ?? line.productId}</div>
          <div class="muted mono">${product?.ref ?? ''}</div>
        </td>
        <td class="muted">${loc?.code ?? line.locationId}</td>
        <td class="num">${line.systemQty.toLocaleString()}</td>
        <td class="num">${this.renderCounted(line, editable)}</td>
        <td class="num ${variance == null ? '' : this.signClass(variance)}">${this.varianceText(variance)}</td>
      </tr>
    `;
  }

  private renderCounted(line: InventoryLine, editable: boolean): TemplateResult {
    if (!editable) return html`<span>${line.countedQty == null ? '—' : line.countedQty.toLocaleString()}</span>`;
    return html`<ix-input
      class="count-input"
      .value=${this.counts[lineKey(line)] ?? ''}
      @valueChange=${(e: IxValueEvent) => this.setCount(line, String(e.detail))}
    ></ix-input>`;
  }

  private parseCounted(raw: string): number | null {
    const trimmed = raw.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  private varianceText(variance: number | null): string {
    if (variance == null) return '—';
    return `${variance > 0 ? '+' : ''}${variance.toLocaleString()}`;
  }

  private signClass(n: number): string {
    if (n === 0) return '';
    return n > 0 ? 'pos' : 'neg';
  }

  private scopeLabel(zoneId: string): string {
    if (!zoneId) return localize(MSG.inventory.wholeWarehouse);
    const zone = this.zones.find((z) => z.id === zoneId);
    return zone ? `${zone.code} · ${zone.name}` : zoneId;
  }

  private seedCounts(): void {
    const next: Record<string, string> = {};
    for (const line of this.openCampaign?.lines ?? []) {
      next[lineKey(line)] = line.countedQty == null ? '' : String(line.countedQty);
    }
    this.counts = next;
  }

  private setCount(line: InventoryLine, raw: string): void {
    this.counts = { ...this.counts, [lineKey(line)]: raw };
  }

  private collectCounts(): CountEntry[] {
    return (this.openCampaign?.lines ?? []).map((line) => {
      const raw = (this.counts[lineKey(line)] ?? '').trim();
      const value = raw === '' ? null : Number(raw);
      return { locationId: line.locationId, productId: line.productId, counted: value != null && Number.isFinite(value) ? value : null };
    });
  }

  private emit(
    type: 'wui:new' | 'wui:open' | 'wui:back' | 'wui:del' | 'wui:save' | 'wui:valid',
    detail: unknown = {}
  ): void {
    // eslint-disable-next-line no-restricted-syntax -- name is statically constrained by the union type above
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function inventoryStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
    }
    .bar .grow {
      flex: 1;
    }
    .sheet-title {
      font-weight: 600;
    }
    .hint {
      font-size: 0.82rem;
      color: var(--theme-color-soft-text);
      margin-bottom: 0.5rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    thead th {
      text-align: left;
      padding: 0.4rem 0.6rem;
      border-bottom: 2px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
    }
    th.num,
    td.num {
      text-align: right;
    }
    tbody td {
      padding: 0.35rem 0.6rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: middle;
    }
    tbody tr:hover {
      background: var(--theme-color-2);
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
      font-size: 0.82rem;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
    }
    .count-input {
      max-width: 7rem;
      margin-left: auto;
    }
    .pos {
      color: var(--theme-color-success, #10b981);
      font-weight: 600;
    }
    .neg {
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
  `;
}
