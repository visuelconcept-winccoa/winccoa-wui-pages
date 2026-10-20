// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm table — one page of a query, nothing more.
 *
 * Dumb on purpose: it receives an already filtered / sorted / paged
 * {@link AlarmPage} and reports intent (`wui:sort`, `wui:page`, `wui:selection`,
 * `wui:select`, `wui:ack` for a row acknowledged on its own). The view owns the query, so the page table and an embedded panel
 * table cannot drift apart.
 *
 * The columns are the profile's (see `profile.ts`): the built-in ones are drawn
 * here, an additional one shows its `extra` value — or what an extension's
 * renderer makes of the row.
 */
import { localizeDate } from '@wincc-oa/wui-i18n-shared/localize-date.js';
import { DatetimeFormat } from '@wincc-oa/wui-models/enums/wui-i18n/datetime-format.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { ackText, columnLabel, columnSort, dateTimeText, directionText, levelLabel } from '../columns.js';
import type { AlarmColumnRenderer } from '../extensions.js';
import { MSG, localize, localizeDir, pagerRangeMsg } from '../i18n.js';
import { DEFAULT_PROFILE, columnField, type AlarmColumn } from '../profile.js';
import type { AlarmPage } from '../query.js';
import type { SortDir, SortField } from '../severity.js';
import { canAcknowledge, DEFAULT_RANGES, type Alarm, type AlarmRange } from '../types.js';
import { alarmColor, rangeColor, severityTokens } from './alarm-tokens.js';
import { alarmTableStyles } from './wui-alarm-table.styles.js';

/** Page buttons kept around the current one. */
const PAGER_NEIGHBOURS = 1;

function ariaSort(active: boolean, dir: SortDir): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none';
  return dir === 'asc' ? 'ascending' : 'descending';
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
  /**
   * Without explicit `columns`: the history columns (the clearing time and who
   * acknowledged) rather than the active ones.
   */
  @property({ type: Boolean, attribute: 'show-cleared' }) showCleared = false;
  /** The columns, in order; the profile defaults when unset. */
  @property({ attribute: false }) columns: readonly AlarmColumn[] | null = null;
  /** How the additional columns are drawn, by column id (from the extensions). */
  @property({ attribute: false }) renderers: ReadonlyMap<string, AlarmColumnRenderer> = new Map();
  /**
   * The alarms acknowledged one at a time (see `AlarmAckHandler.single`): an
   * acknowledge button on their row instead of a checkbox (`wui:ack`).
   */
  @property({ attribute: false }) single: (alarm: Alarm) => boolean = () => false;
  /** The project's levels — the severity's name and colour come from them. */
  @property({ attribute: false }) ranges: readonly AlarmRange[] = DEFAULT_RANGES;

  override render(): TemplateResult {
    const rows = this.page?.rows ?? [];
    const columns = this.effectiveColumns();
    return html`
      <div class="wrap">
        <table>
          <thead>
            <tr>
              ${this.selectable ? html`<th class="chk">${this.renderSelectAll(rows)}</th>` : nothing}
              ${columns.map((column) => this.renderHead(column))}
            </tr>
          </thead>
          <tbody>
            ${rows.map((alarm) => this.renderRow(alarm, columns))}
          </tbody>
        </table>
        ${rows.length === 0 ? html`<div class="empty">${localizeDir(MSG.table.empty)}</div>` : nothing}
      </div>
      ${this.page === null ? nothing : this.renderPager(this.page)}
    `;
  }

  private effectiveColumns(): readonly AlarmColumn[] {
    if (this.columns !== null) return this.columns;
    if (this.compact) return DEFAULT_PROFILE.panelColumns;
    return this.showCleared ? DEFAULT_PROFILE.historyColumns : DEFAULT_PROFILE.columns;
  }

  private renderHead(column: AlarmColumn): TemplateResult {
    const label = columnLabel(column);
    const field = columnSort(column);
    const style = column.width ? `width:${column.width}` : '';
    if (field === null) return html`<th style=${style}>${label}</th>`;
    const active = this.sort === field;
    const glyph = this.sortDir === 'asc' ? '▲' : '▼';
    return html`<th
      class="sortable"
      style=${style}
      aria-sort=${ariaSort(active, this.sortDir)}
      title=${`${localize(MSG.table.sortBy)} ${label}`}
      @click=${() => this.emitSort(field)}
    >
      ${label}${active ? ` ${glyph}` : ''}
    </th>`;
  }

  private renderRow(alarm: Alarm, columns: readonly AlarmColumn[]): TemplateResult {
    const unacked = canAcknowledge(alarm);
    const classes = [
      unacked ? 'unacked' : '',
      alarm.cleared === null ? '' : 'went',
      this.selection.has(alarm.id) ? 'sel' : ''
    ].join(' ');
    return html`
      <tr class=${classes} @click=${() => this.emitSelect(alarm)}>
        ${this.selectable ? html`<td class="chk">${this.renderCheckbox(alarm)}</td>` : nothing}
        ${columns.map((column) => this.renderCell(alarm, column))}
      </tr>
    `;
  }

  // eslint-disable-next-line complexity -- one case per built-in column, flat on purpose
  private renderCell(alarm: Alarm, column: AlarmColumn): TemplateResult {
    switch (column.id) {
      case 'severity': {
        return html`<td>${this.renderSeverity(alarm)}</td>`;
      }
      case 'raised': {
        return html`<td class="nowrap mono">${this.compact ? fmtTime(alarm.raised) : dateTimeText(alarm.raised)}</td>`;
      }
      case 'cleared': {
        return html`<td class="nowrap mono">${dateTimeText(alarm.cleared) || '—'}</td>`;
      }
      case 'class': {
        return html`<td title=${`${alarm.abbr} · ${localize(MSG.table.prior)} ${alarm.prior}`}>
          <span class="pill" style=${`background:${alarmColor(alarm, this.ranges)}`}>${alarm.abbr || '—'}</span>
        </td>`;
      }
      case 'prior': {
        return html`<td class="num mono muted" title=${localize(MSG.table.priorHint)}>${alarm.prior}</td>`;
      }
      case 'source': {
        return html`<td class="wrap">
          <code>${alarm.dpe}</code>
          ${alarm.description && alarm.description !== alarm.dpe ? html`<div class="muted">${alarm.description}</div>` : nothing}
        </td>`;
      }
      case 'dpe': {
        return html`<td class="mono ell dpe" title=${alarm.dpe}>${alarm.dpe}</td>`;
      }
      case 'description': {
        return html`<td class="wrap">${alarm.description}</td>`;
      }
      case 'text': {
        return this.renderText(alarm);
      }
      case 'value': {
        return html`<td class="num mono">${alarm.value || '—'}</td>`;
      }
      case 'state': {
        return html`<td class="nowrap">${this.renderState(alarm)}</td>`;
      }
      case 'ackBy': {
        return html`<td class="nowrap">
          ${alarm.acked ? html`${alarm.ackBy ?? '—'}<div class="legend mono">${dateTimeText(alarm.ackAt)}</div>` : '—'}
        </td>`;
      }
      default: {
        const renderer = this.renderers.get(column.id);
        return html`<td class="wrap">${renderer ? renderer.render(alarm) : (alarm.extra?.[columnField(column)] ?? '')}</td>`;
      }
    }
  }

  /** The level: its colour and its name, never the colour alone. */
  private renderSeverity(alarm: Alarm): TemplateResult {
    const classes = alarm.rank === 1 ? 'sev top' : 'sev';
    return html`<span class=${classes} style=${`--sev-color:${rangeColor(alarm.rank, this.ranges)}`} title=${`prior ${alarm.prior}`}
      >${levelLabel(alarm.rank, this.ranges)}</span
    >`;
  }

  private renderText(alarm: Alarm): TemplateResult {
    if (this.compact) {
      return html`<td class="wrap text">${alarm.text || alarm.dpe}<div class="muted mono ell">${alarm.dpe}</div></td>`;
    }
    return html`<td class="wrap text">
      ${alarm.text || '—'}
      ${alarm.acked && alarm.ackBy ? html`<div class="legend">${localize(MSG.state.ackedBy)} ${alarm.ackBy}</div>` : nothing}
    </td>`;
  }

  /**
   * Direction and acknowledgement, as two badges. An alarm that went while
   * nobody took it over keeps its "to acknowledge" badge: greying it out is
   * exactly how a pending acknowledgement gets overlooked.
   */
  private renderState(alarm: Alarm): TemplateResult {
    const ack = ackText(alarm);
    return html`<span class=${alarm.cleared === null ? 'badge came' : 'badge'}>${directionText(alarm)}</span>
      ${ack === '' ? nothing : html` <span class=${alarm.acked ? 'badge acked' : 'badge to-ack'}>${ack}</span>`}`;
  }

  private renderCheckbox(alarm: Alarm): TemplateResult | typeof nothing {
    if (!canAcknowledge(alarm)) {
      return alarm.ackable ? nothing : html`<span class="muted" title=${localize(MSG.table.notAckable)}>—</span>`;
    }
    if (this.single(alarm)) {
      return html`<ix-icon-button
        class="ack-one"
        variant="tertiary"
        icon="check"
        size="16"
        title=${localize(MSG.table.ackOne)}
        aria-label=${localize(MSG.table.ackOne)}
        @click=${(event: Event) => {
          event.stopPropagation();
          this.emitAck(alarm);
        }}
      ></ix-icon-button>`;
    }
    return html`<input
      type="checkbox"
      aria-label=${localize(MSG.table.select)}
      .checked=${this.selection.has(alarm.id)}
      @click=${(event: Event) => event.stopPropagation()}
      @change=${() => this.toggle(alarm.id)}
    />`;
  }

  private renderSelectAll(rows: readonly Alarm[]): TemplateResult {
    const ackable = rows.filter((alarm) => canAcknowledge(alarm) && !this.single(alarm));
    const all = ackable.length > 0 && ackable.every((alarm) => this.selection.has(alarm.id));
    return html`<input
      type="checkbox"
      aria-label=${localize(MSG.table.selectAll)}
      title=${localize(MSG.table.selectAll)}
      .checked=${all}
      ?disabled=${ackable.length === 0}
      @change=${() => this.emitSelection(all ? [] : ackable.map((alarm) => alarm.id))}
    />`;
  }

  private renderPager(page: AlarmPage): TemplateResult | typeof nothing {
    if (page.pages <= 1 && this.compact) return nothing;
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

  private emitAck(alarm: Alarm): void {
    this.dispatchEvent(new CustomEvent('wui:ack', { detail: alarm, bubbles: true, composed: true }));
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
