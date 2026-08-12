// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm table — one page of a query, nothing more.
 *
 * Dumb on purpose: it receives an already filtered / sorted / paged
 * {@link AlarmPage} and reports intent (`wui:sort`, `wui:page`, `wui:selection`,
 * `wui:select`). The view owns the query, so the page table and an embedded panel
 * table cannot drift apart.
 */
import { localizeDate } from '@wincc-oa/wui-i18n-shared/localize-date.js';
import { DatetimeFormat } from '@wincc-oa/wui-models/enums/wui-i18n/datetime-format.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { MSG, localize, localizeDir, pagerRangeMsg } from '../i18n.js';
import type { AlarmPage } from '../query.js';
import type { SortDir, SortField } from '../severity.js';
import { canAcknowledge, DEFAULT_RANGES, type Alarm, type AlarmRange } from '../types.js';
import { alarmColor, rangeAbbr, rangeColor, severityTokens } from './alarm-tokens.js';
import { alarmTableStyles } from './wui-alarm-table.styles.js';

/** Page buttons kept around the current one. */
const PAGER_NEIGHBOURS = 1;

/**
 * Colour tone of the state chip.
 *
 * Acknowledgement comes FIRST: an alarm that went while nobody took it over is
 * still an open item, so it keeps the alert class' colour instead of the grey of
 * a closed row — greying it out is exactly how a pending acknowledgement gets
 * overlooked.
 */
function stateTone(alarm: Alarm): string {
  if (!alarm.acked) return '';
  return alarm.cleared === null ? 'ok' : 'gone';
}

function ariaSort(active: boolean, dir: SortDir): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none';
  return dir === 'asc' ? 'ascending' : 'descending';
}

function fmtDateTime(ms: number | null): string {
  if (ms === null || ms === 0) return '—';
  return localizeDate(new Date(ms), undefined, DatetimeFormat.Default);
}

function fmtTime(ms: number | null): string {
  if (ms === null || ms === 0) return '—';
  return localizeDate(new Date(ms), undefined, DatetimeFormat.TimeWithSeconds);
}

export class WuiAlarmTable extends LitElement {
  static override readonly styles = [severityTokens(), alarmTableStyles()];

  @property({ attribute: false }) page: AlarmPage | null = null;
  @property() sort: SortField = 'raised';
  @property({ attribute: 'sort-dir' }) sortDir: SortDir = 'desc';
  @property({ attribute: false }) selection: ReadonlySet<string> = new Set<string>();
  /** Dense variant for an embedded panel (fewer columns, smaller type). */
  @property({ type: Boolean, reflect: true }) compact = false;
  /** Show the checkbox column — off when acknowledging is not available. */
  @property({ type: Boolean }) selectable = true;
  /** Show the "cleared" column — only meaningful on an archived period. */
  @property({ type: Boolean, attribute: 'show-cleared' }) showCleared = false;
  /** The project's priority ranges — the pill's label and colour come from them. */
  @property({ attribute: false }) ranges: readonly AlarmRange[] = DEFAULT_RANGES;

  override render(): TemplateResult {
    const rows = this.page?.rows ?? [];
    return html`
      <div class="wrap">
        <table>
          <thead>
            <tr>
              ${this.selectable ? html`<th style="width:1.5rem">${this.renderSelectAll(rows)}</th>` : nothing}
              ${this.renderHead()}
            </tr>
          </thead>
          <tbody>
            ${rows.map((alarm) => this.renderRow(alarm))}
          </tbody>
        </table>
        ${rows.length === 0 ? html`<div class="empty">${localizeDir(MSG.table.empty)}</div>` : nothing}
      </div>
      ${this.page === null ? nothing : this.renderPager(this.page)}
    `;
  }

  private renderHead(): TemplateResult {
    if (this.compact) {
      return html`
        ${this.th('raised', MSG.table.raised)} ${this.th('rank', MSG.table.severity)}
        ${this.th('text', MSG.table.text)} ${this.th('status', MSG.table.status)}
      `;
    }
    return html`
      ${this.th('raised', MSG.table.raised)}
      ${this.showCleared ? this.th('cleared', MSG.table.cleared) : nothing} ${this.th('rank', MSG.table.severity)}
      ${this.th('prior', MSG.table.prior)}
      <th>${localizeDir(MSG.table.class)}</th>
      ${this.th('dp', MSG.table.dpe)} ${this.th('text', MSG.table.text)} ${this.th('value', MSG.table.value)}
      ${this.th('status', MSG.table.status)}
      <th>${localizeDir(MSG.table.ackBy)}</th>
    `;
  }

  private renderRow(alarm: Alarm): TemplateResult {
    const classes = `${alarm.acked ? '' : 'unacked'} ${alarm.cleared === null ? '' : 'cleared'}`;
    return html`
      <tr
        class=${classes}
        style=${`border-left-color:${rangeColor(alarm.rank, this.ranges)}`}
        @click=${() => this.emitSelect(alarm)}
      >
        ${this.selectable ? html`<td>${this.renderCheckbox(alarm)}</td>` : nothing}
        ${this.compact ? this.renderCompactCells(alarm) : this.renderFullCells(alarm)}
      </tr>
    `;
  }

  private renderCompactCells(alarm: Alarm): TemplateResult {
    return html`
      <td class="mono">${fmtTime(alarm.raised)}</td>
      <td>${this.renderRange(alarm)}</td>
      <td class="text">
        ${alarm.text || alarm.dpe}
        <div class="muted mono ell">${alarm.dpe}</div>
      </td>
      <td>${this.renderState(alarm)}</td>
    `;
  }

  private renderFullCells(alarm: Alarm): TemplateResult {
    return html`
      <td class="mono">${fmtDateTime(alarm.raised)}</td>
      ${this.showCleared ? html`<td class="mono">${fmtDateTime(alarm.cleared)}</td>` : nothing}
      <td>${this.renderRange(alarm)}</td>
      <td class="num mono muted" title=${localize(MSG.table.priorHint)}>${alarm.prior}</td>
      <td><span class="pill" style=${`background:${alarmColor(alarm, this.ranges)}`}>${alarm.abbr || '—'}</span></td>
      <td class="mono ell" style="max-width:14rem" title=${alarm.dpe}>${alarm.dpe}</td>
      <td class="text" title=${alarm.description}>${alarm.text || alarm.description || '—'}</td>
      <td class="num mono">${alarm.value || '—'}</td>
      <td>${this.renderState(alarm)}</td>
      <td class="mono muted">${alarm.ackBy ?? '—'}</td>
    `;
  }

  /** The range pill: the project's own label and colour for that priority band. */
  private renderRange(alarm: Alarm): TemplateResult {
    const style = `background:${rangeColor(alarm.rank, this.ranges)}`;
    return html`<span class="pill" style=${style} title=${`prior ${alarm.prior}`}
      >${rangeAbbr(alarm.rank, this.ranges)}</span
    >`;
  }

  private renderState(alarm: Alarm): TemplateResult {
    const tone = stateTone(alarm);
    const style = tone === '' ? `color:${alarmColor(alarm, this.ranges)}` : '';
    const classes = `state ${tone}`;
    return html`<span class=${classes} style=${style}>${localizeDir(MSG.status[alarm.status])}</span>`;
  }

  private renderCheckbox(alarm: Alarm): TemplateResult {
    return html`<input
      type="checkbox"
      title=${alarm.ackable ? '' : localize(MSG.table.notAckable)}
      .checked=${this.selection.has(alarm.id)}
      ?disabled=${!canAcknowledge(alarm)}
      @click=${(event: Event) => event.stopPropagation()}
      @change=${() => this.toggle(alarm.id)}
    />`;
  }

  private renderSelectAll(rows: readonly Alarm[]): TemplateResult {
    const ackable = rows.filter((alarm) => canAcknowledge(alarm));
    const all = ackable.length > 0 && ackable.every((alarm) => this.selection.has(alarm.id));
    return html`<input
      type="checkbox"
      title=${localize(MSG.table.selectAll)}
      .checked=${all}
      ?disabled=${ackable.length === 0}
      @change=${() => this.emitSelection(all ? [] : ackable.map((alarm) => alarm.id))}
    />`;
  }

  private th(field: SortField, label: MultiLangString): TemplateResult {
    const active = this.sort === field;
    const glyph = this.sortDir === 'asc' ? '▲' : '▼';
    return html`<th
      class="sortable"
      aria-sort=${ariaSort(active, this.sortDir)}
      title=${`${localize(MSG.table.sortBy)} ${localize(label)}`}
      @click=${() => this.emitSort(field)}
    >
      ${localizeDir(label)}${active ? ` ${glyph}` : ''}
    </th>`;
  }

  private renderPager(page: AlarmPage): TemplateResult {
    const from = page.filtered === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
    const to = Math.min(page.page * page.pageSize, page.filtered);
    const numbers = [1, page.page - PAGER_NEIGHBOURS, page.page, page.page + PAGER_NEIGHBOURS, page.pages]
      .filter((n, index, all) => n >= 1 && n <= page.pages && all.indexOf(n) === index)
      .sort((a, b) => a - b);
    return html`
      <div class="pager">
        <span class="muted mono">
          ${pagerRangeMsg(page.filtered === 0 ? '0' : `${from}–${to}`, `${page.filtered}`)}
        </span>
        <span class="grow"></span>
        <button ?disabled=${page.page <= 1} @click=${() => this.emitPage(1)}>«</button>
        <button ?disabled=${page.page <= 1} @click=${() => this.emitPage(page.page - 1)}>‹</button>
        ${numbers.map(
          (n) => html`<button aria-current=${n === page.page ? 'true' : 'false'} @click=${() => this.emitPage(n)}>${n}</button>`
        )}
        <button ?disabled=${page.page >= page.pages} @click=${() => this.emitPage(page.page + 1)}>›</button>
        <button ?disabled=${page.page >= page.pages} @click=${() => this.emitPage(page.pages)}>»</button>
      </div>
    `;
  }

  private toggle(id: string): void {
    const next = new Set(this.selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.emitSelection([...next]);
  }

  private emitSelection(ids: readonly string[]): void {
    this.dispatchEvent(new CustomEvent('wui:selection', { detail: [...ids], bubbles: true, composed: true }));
  }

  private emitSort(field: SortField): void {
    this.dispatchEvent(new CustomEvent('wui:sort', { detail: field, bubbles: true, composed: true }));
  }

  private emitPage(page: number): void {
    this.dispatchEvent(new CustomEvent('wui:page', { detail: page, bubbles: true, composed: true }));
  }

  private emitSelect(alarm: Alarm): void {
    this.dispatchEvent(new CustomEvent('wui:select', { detail: alarm, bubbles: true, composed: true }));
  }
}

// Guarded registration: the kit is vendored into several self-contained page
// bundles that share one CustomElementRegistry per SPA session — an unguarded
// `define` would throw on the second page that loads.
if (!customElements.get('wui-alarm-table')) {
  customElements.define('wui-alarm-table', WuiAlarmTable);
}
