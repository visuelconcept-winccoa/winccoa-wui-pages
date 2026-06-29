// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sortable table of thermal treatment reports. Shows report/charge identity, the
 * part/material, the linked furnace, the cycle window, and coloured
 * treatment/status/conformity chips. Each row opens the report (view), edits or
 * deletes it.
 *
 * Emits: `wui:open` / `wui:edit` / `wui:delete` (all `{ id }`).
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import {
  CONFORMITY_COLORS,
  CONFORMITY_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  TREATMENT_LABELS,
  type ThermalReport
} from '../types.js';

type SortKey = 'reportNo' | 'part' | 'machine' | 'startTime' | 'status';

const PAD_LEN = 2;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

@customElement('tt-report-table')
export class TtReportTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) reports: ThermalReport[] = [];

  @state() private sortKey: SortKey = 'startTime';
  @state() private sortAsc = false;

  override render(): TemplateResult {
    const rows = this.sortedReports();
    return html`
      <table>
        <thead>
          <tr>
            ${this.header(MSG.table.reportNo, 'reportNo')}
            <th>${localizeDir(MSG.table.charge)}</th>
            ${this.header(MSG.table.partMaterial, 'part')}
            <th>${localizeDir(MSG.table.treatment)}</th>
            ${this.header(MSG.table.furnace, 'machine')}
            ${this.header(MSG.table.startTime, 'startTime')}
            ${this.header(MSG.table.status, 'status')}
            <th>${localizeDir(MSG.table.conformity)}</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((report) => this.renderRow(report))}
        </tbody>
      </table>
    `;
  }

  private renderRow(report: ThermalReport): TemplateResult {
    return html`
      <tr @click=${() => this.requestOpen(report.id)} class="clickable">
        <td class="mono strong">${report.reportNo || '—'}</td>
        <td class="mono">${report.charge || '—'}</td>
        <td>
          <div class="strong">${report.part || '—'}</div>
          <div class="muted">${report.material}</div>
        </td>
        <td>${localizeDir(TREATMENT_LABELS[report.treatment])}</td>
        <td>${report.machineName || '—'}</td>
        <td class="mono">${this.fmtDate(report.startTime)}</td>
        <td>
          <span class="chip solid" style="--c:${STATUS_COLORS[report.status]}">
            ${localizeDir(STATUS_LABELS[report.status])}
          </span>
        </td>
        <td>
          <span class="chip" style="--c:${CONFORMITY_COLORS[report.conformity]}">
            ${localizeDir(CONFORMITY_LABELS[report.conformity])}
          </span>
        </td>
        <td class="actions-col" @click=${(e: Event) => e.stopPropagation()}>
          <ix-icon-button
            ghost
            size="16"
            icon="eye"
            title=${localize(MSG.table.openReport)}
            @click=${() => this.requestOpen(report.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="pen"
            title=${localize(MSG.table.edit)}
            @click=${() => this.requestEdit(report.id)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title=${localize(MSG.table.remove)}
            @click=${() => this.requestDelete(report.id)}
          ></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private header(label: MultiLangString, key: SortKey): TemplateResult {
    const active = this.sortKey === key;
    const arrow = active ? (this.sortAsc ? '▲' : '▼') : '';
    return html`
      <th class="sortable" @click=${() => this.setSort(key)}>
        ${localizeDir(label)} <span class="arrow">${arrow}</span>
      </th>
    `;
  }

  private fmtDate(value: string): string {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private sortedReports(): ThermalReport[] {
    const rows = [...this.reports];
    const dir = this.sortAsc ? 1 : -1;
    rows.sort((a, b) => dir * this.compare(a, b));
    return rows;
  }

  private compare(a: ThermalReport, b: ThermalReport): number {
    switch (this.sortKey) {
      case 'reportNo': {
        return a.reportNo.localeCompare(b.reportNo);
      }
      case 'part': {
        return a.part.localeCompare(b.part);
      }
      case 'machine': {
        return a.machineName.localeCompare(b.machineName);
      }
      case 'startTime': {
        return a.startTime.localeCompare(b.startTime);
      }
      case 'status': {
        return a.status.localeCompare(b.status);
      }
      default: {
        return 0;
      }
    }
  }

  private setSort(key: SortKey): void {
    if (this.sortKey === key) this.sortAsc = !this.sortAsc;
    else {
      this.sortKey = key;
      this.sortAsc = true;
    }
  }

  private requestOpen(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:open', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestEdit(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true }));
  }

  private requestDelete(id: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:delete', { detail: { id }, bubbles: true, composed: true })
    );
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function tableStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      overflow: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    thead th {
      text-align: left;
      padding: 0.5rem 0.6rem;
      border-bottom: 2px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
      position: sticky;
      top: 0;
      background: var(--theme-color-1);
      z-index: 1;
    }
    th.sortable {
      cursor: pointer;
      user-select: none;
    }
    th.sortable:hover {
      color: var(--theme-color-std-text);
    }
    .arrow {
      font-size: 0.7rem;
    }
    tbody td {
      padding: 0.45rem 0.6rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: middle;
    }
    tr.clickable {
      cursor: pointer;
    }
    tbody tr:hover {
      background: var(--theme-color-2);
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
      font-size: 0.78rem;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
    }
    .chip {
      display: inline-block;
      white-space: nowrap;
      font-size: 0.78rem;
      font-weight: 600;
      color: var(--c);
      border: 1px solid var(--c);
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
    }
    .chip.solid {
      color: #fff;
      background: var(--c);
      border-color: var(--c);
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
      text-align: right;
    }
  `;
}
