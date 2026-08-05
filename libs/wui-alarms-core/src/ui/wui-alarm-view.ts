// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `<wui-alarm-view>` — the embeddable alarm view. THE component to mutualise.
 *
 * One element serves the standalone Alarms page and any panel of another page
 * (a machine dashboard, a mosaic tile…), because everything that changes between
 * those uses is an input:
 *
 * ```html
 * <!-- standing alarms of the whole system, full page -->
 * <wui-alarm-view></wui-alarm-view>
 *
 * <!-- one machine, panel density, host-driven period, no statistics -->
 * <wui-alarm-view
 *   layout="panel"
 *   hide-stats
 *   hide-period
 *   source="history"
 *   .from=${range.start}
 *   .to=${range.end}
 *   .scope=${['System1:Press01']}
 * ></wui-alarm-view>
 * ```
 *
 * `source` chooses the snapshot: `active` subscribes to the live alarms, `history`
 * queries the archive over the resolved period. The period is either given
 * explicitly (`from` / `to`, epoch ms — the case when a host page already owns a
 * period selector) or picked in the view (`period` / `shift` / `custom-start` /
 * `custom-end`).
 *
 * A live list re-orders itself under the cursor, which makes acknowledging
 * error-prone; so as soon as the operator has a selection, incoming updates are
 * HELD (the status dot turns amber) and applied when the selection is released.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { localizeDate } from '@wincc-oa/wui-i18n-shared/localize-date.js';
import { DatetimeFormat } from '@wincc-oa/wui-models/enums/wui-i18n/datetime-format.js';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { MSG, filteredOfTotalMsg, localize, localizeDir, rangeLabelMsg, selectedMsg } from '../i18n.js';
import { ALARM_PERIODS, resolvePeriod, type AlarmPeriod, type Range } from '../period.js';
import { applyQuery, selectAll, DEFAULT_PAGE_SIZE, type AlarmPage, type AlarmQuery, type AlarmSource } from '../query.js';
import { inScope, parseScopeAttribute } from '../scope.js';
import type { SortDir, SortField } from '../severity.js';
import { DEFAULT_WINDOW_MS, alarmHistogram, bucketFor, countAlarms, topActors } from '../statistics.js';
import { DEFAULT_PRIORITY_BANDS, type ActorGrouping, type Alarm, type PriorityBand, type Severity } from '../types.js';
import { AlarmStore, DEFAULT_MAX_RESULTS } from '../data/alarm-store.js';
import { severityTokens } from './alarm-tokens.js';
import { alarmViewStyles } from './wui-alarm-view.styles.js';
import './wui-alarm-stats.js';
import './wui-alarm-table.js';

/** Density preset. `panel` is the embedded variant. */
export type AlarmViewLayout = 'page' | 'panel';

/** Inputs that invalidate the snapshot and force a reload. */
const RELOAD_KEYS = ['source', 'period', 'shift', 'customStart', 'customEnd', 'from', 'to', 'maxResults', 'bands'] as const;

interface IxValueEvent {
  detail: string | string[];
}

/** The toolbar-driven inputs {@link WuiAlarmView.patch} may change at once. */
interface ViewPatch {
  source?: AlarmSource;
  period?: AlarmPeriod;
  shift?: number;
  customStart?: string;
  customEnd?: string;
  search?: string;
  unackOnly?: boolean;
  severities?: readonly Severity[];
}

/** Coerce an `ix-select` value (string | string[]) to a single string. */
function firstValue(detail: string | string[]): string {
  return Array.isArray(detail) ? (detail[0] ?? '') : detail;
}

/** A period bound in the reader's locale (date + time). */
function stampLabel(ms: number): string {
  return localizeDate(new Date(ms), undefined, DatetimeFormat.Default);
}

export class WuiAlarmView extends LitElement {
  static override readonly styles = [IXCoreStyles, severityTokens(), alarmViewStyles()];

  /** `active` = the standing alarms (live); `history` = the archive of a period. */
  @property({ reflect: true }) source: AlarmSource = 'active';
  /** Hide the Active / History tabs — the host decides which snapshot is shown. */
  @property({ type: Boolean, attribute: 'lock-source' }) lockSource = false;
  @property() period: AlarmPeriod = 'today';
  /** Whole periods to shift back; 0 = the current one. */
  @property({ type: Number }) shift = 0;
  @property({ attribute: 'custom-start' }) customStart = '';
  @property({ attribute: 'custom-end' }) customEnd = '';
  /** Explicit period bounds (epoch ms). Non-zero values win over `period`. */
  @property({ type: Number }) from = 0;
  @property({ type: Number }) to = 0;
  /** Datapoint scope as an attribute: `dps="Press01,System1:Oven*"`. */
  @property() dps = '';
  /** Datapoint scope as a property — wins over `dps` when set. */
  @property({ attribute: false }) scope: readonly string[] | null = null;
  /**
   * Refuse to fall back to the whole system when the scope is empty.
   *
   * An embedded panel MUST set this: a machine with no bound datapoint would
   * otherwise show every alarm of the project as if they were its own.
   */
  @property({ type: Boolean, attribute: 'strict-scope' }) strictScope = false;
  @property({ reflect: true }) layout: AlarmViewLayout = 'page';
  @property({ type: Boolean, attribute: 'hide-stats' }) hideStats = false;
  @property({ type: Boolean, attribute: 'hide-toolbar' }) hideToolbar = false;
  /** Hide the period controls (the host page drives `from` / `to`). */
  @property({ type: Boolean, attribute: 'hide-period' }) hidePeriod = false;
  /** Read-only view: no selection, no acknowledge. */
  @property({ type: Boolean, attribute: 'no-ack' }) noAck = false;
  @property({ type: Number, attribute: 'page-size' }) pageSize = DEFAULT_PAGE_SIZE;
  @property({ type: Number, attribute: 'max-results' }) maxResults = DEFAULT_MAX_RESULTS;
  /** Project-specific `prior` → severity bands (see {@link ../types.ts}). */
  @property({ attribute: false }) bands: readonly PriorityBand[] = DEFAULT_PRIORITY_BANDS;

  @state() private snapshot: readonly Alarm[] = [];
  /** Live updates held back while the operator has a selection. */
  @state() private held: readonly Alarm[] | null = null;
  @state() private severities: readonly Severity[] = [];
  @state() private search = '';
  @state() private unackOnly = false;
  @state() private sort: SortField = 'raised';
  @state() private sortDir: SortDir = 'desc';
  @state() private pageNo = 1;
  @state() private selection: ReadonlySet<string> = new Set<string>();
  @state() private grouping: ActorGrouping = 'text';
  @state() private loading = false;
  @state() private busy = false;
  @state() private notice = '';
  @state() private truncated = false;
  @state() private updatedAt = 0;

  private store: AlarmStore | null = null;
  private sub = new Subscription();
  /** Swallows the `updated()` of the very first render — `firstUpdated` loaded. */
  private firstSettled = false;
  /** Content key of the last seen scope (see {@link updated}). */
  private scopeKey = '';

  override connectedCallback(): void {
    super.connectedCallback();
    // Re-attachment (a router swap, a host moving the node) must re-subscribe.
    if (this.hasUpdated) void this.reload();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.sub.unsubscribe();
  }

  override render(): TemplateResult {
    if (this.scopeMissing()) {
      return html`<div class="center">${localizeDir(MSG.view.noScope)}</div>`;
    }
    const scoped = this.snapshot.filter((alarm) => inScope(alarm, this.effectiveScope()));
    const page = applyQuery(scoped, this.query(), this.reference());
    return html`
      ${this.hideToolbar ? nothing : this.renderToolbar(page)} ${this.renderNotice()}
      ${this.hideStats ? nothing : this.renderStats(scoped)}
      ${this.loading && this.snapshot.length === 0
        ? html`<div class="center"><ix-spinner></ix-spinner></div>`
        : this.renderTable(page)}
    `;
  }

  override updated(changed: PropertyValues<this>): void {
    if (!this.firstSettled) {
      this.firstSettled = true;
      this.scopeKey = this.effectiveScope().join('|');
      return;
    }
    if (RELOAD_KEYS.some((key) => changed.has(key))) {
      if (changed.has('bands')) this.store = null;
      void this.reload();
      return;
    }
    // The scope is compared by CONTENT: a host that recomputes the array on every
    // render (`.scope=${scopeFromDpes(…)}`) must not restart the subscription.
    const scopeKey = this.effectiveScope().join('|');
    if (scopeKey === this.scopeKey) return;
    this.scopeKey = scopeKey;
    // A scope arriving late (the host's config loaded after the first paint)
    // unblocks a strict view that had nothing to show.
    if (this.snapshot.length === 0) void this.reload();
  }

  /** Acknowledge every alarm the current filters select, page or not. */
  async acknowledgeAll(): Promise<void> {
    const scoped = this.snapshot.filter((alarm) => inScope(alarm, this.effectiveScope()));
    await this.acknowledge(selectAll(scoped, this.query()));
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.reload();
  }

  /** True when the view is scoped to nothing and must not widen to the system. */
  private scopeMissing(): boolean {
    return this.strictScope && this.effectiveScope().length === 0;
  }

  /** The resolved period of the view — explicit bounds win over the preset. */
  private range(): Range {
    if (this.from > 0 && this.to > this.from) return { start: this.from, end: this.to };
    return resolvePeriod(this.period, Date.now(), {
      shift: this.shift,
      customStart: this.customStart,
      customEnd: this.customEnd
    });
  }

  /** "Now" as the statistics must read it: the clock live, the period's end in history. */
  private reference(): number {
    return this.source === 'active' ? Date.now() : this.range().end;
  }

  private effectiveScope(): readonly string[] {
    return this.scope ?? parseScopeAttribute(this.dps);
  }

  private query(): AlarmQuery {
    return {
      source: this.source,
      scope: this.effectiveScope(),
      severities: this.severities,
      search: this.search,
      unacknowledgedOnly: this.unackOnly,
      sort: this.sort,
      dir: this.sortDir,
      page: this.pageNo,
      pageSize: this.pageSize
    };
  }

  private renderToolbar(page: AlarmPage): TemplateResult {
    return html`
      <div class="toolbar">
        ${this.lockSource ? nothing : this.renderTabs(page)}
        ${this.source === 'history' && !this.hidePeriod ? this.renderPeriod() : nothing}
        <input
          type="search"
          placeholder=${localize(MSG.view.search)}
          .value=${this.search}
          @input=${(event: Event) => this.patch({ search: (event.target as HTMLInputElement).value })}
        />
        <label class="chk">
          <input
            type="checkbox"
            .checked=${this.unackOnly}
            @change=${(event: Event) => this.patch({ unackOnly: (event.target as HTMLInputElement).checked })}
          />
          ${localizeDir(MSG.view.unackOnly)}
        </label>
        <span class="muted mono">${filteredOfTotalMsg(`${page.filtered}`, `${page.total}`)}</span>
        <span class="grow"></span>
        ${this.renderActions()} ${this.renderStatus()}
      </div>
      ${this.source === 'history' && !this.hidePeriod ? html`<div class="status">${this.rangeLabel()}</div>` : nothing}
    `;
  }

  private renderTabs(page: AlarmPage): TemplateResult {
    return html`
      <div class="tabs">
        <button
          class="tab"
          aria-current=${this.source === 'active' ? 'true' : 'false'}
          @click=${() => this.patch({ source: 'active' })}
        >
          ${localizeDir(MSG.view.sourceActive)}
          ${this.source === 'active' ? html`<span class="mono">${page.filtered}</span>` : nothing}
        </button>
        <button
          class="tab"
          aria-current=${this.source === 'history' ? 'true' : 'false'}
          @click=${() => this.patch({ source: 'history' })}
        >
          ${localizeDir(MSG.view.sourceHistory)}
        </button>
      </div>
    `;
  }

  private renderPeriod(): TemplateResult {
    return html`
      <ix-icon-button
        ghost
        icon="chevron-left"
        title=${localize(MSG.period.previous)}
        @click=${() => this.patch({ shift: this.shift + 1 })}
      ></ix-icon-button>
      <label class="ctl">
        <span>${localizeDir(MSG.period.label)}</span>
        <ix-select
          .value=${this.period}
          @valueChange=${(event: IxValueEvent) => this.patch({ period: firstValue(event.detail) as AlarmPeriod, shift: 0 })}
        >
          ${ALARM_PERIODS.map(
            (period) => html`<ix-select-item value=${period} label=${localize(MSG.period[period])}></ix-select-item>`
          )}
        </ix-select>
      </label>
      <ix-icon-button
        ghost
        icon="chevron-right"
        title=${localize(MSG.period.next)}
        ?disabled=${this.shift === 0}
        @click=${() => this.patch({ shift: Math.max(0, this.shift - 1) })}
      ></ix-icon-button>
      ${this.period === 'custom' ? this.renderCustomDates() : nothing}
    `;
  }

  private renderCustomDates(): TemplateResult {
    return html`
      <label class="ctl">
        <span>${localizeDir(MSG.period.start)}</span>
        <ix-date-input
          format="yyyy-MM-dd"
          .value=${this.customStart}
          @valueChange=${(event: IxValueEvent) => this.patch({ customStart: firstValue(event.detail) })}
        ></ix-date-input>
      </label>
      <label class="ctl">
        <span>${localizeDir(MSG.period.end)}</span>
        <ix-date-input
          format="yyyy-MM-dd"
          .value=${this.customEnd}
          @valueChange=${(event: IxValueEvent) => this.patch({ customEnd: firstValue(event.detail) })}
        ></ix-date-input>
      </label>
    `;
  }

  private renderActions(): TemplateResult | typeof nothing {
    if (this.noAck) return nothing;
    const count = this.selection.size;
    return html`
      <button
        class="act primary"
        ?disabled=${count === 0 || this.busy}
        @click=${() => void this.acknowledgeSelection()}
      >
        ${localizeDir(MSG.view.ack)}${count === 0 ? '' : ` (${count})`}
      </button>
      ${count === 0 ? nothing : html`<span class="muted">${selectedMsg(count)}</span>`}
    `;
  }

  private renderStatus(): TemplateResult {
    const clock =
      this.updatedAt === 0
        ? '--'
        : localizeDate(new Date(this.updatedAt), undefined, DatetimeFormat.TimeWithSeconds);
    return html`
      <span class="status">
        <span class=${this.held === null ? 'dot' : 'dot held'}></span>
        ${this.source === 'active' ? localizeDir(MSG.view.live) : nothing} ${localizeDir(MSG.view.updatedAt)} ${clock}
      </span>
      <button class="act" ?disabled=${this.loading} @click=${() => void this.reload()}>${localizeDir(MSG.view.refresh)}</button>
    `;
  }

  private renderNotice(): TemplateResult | typeof nothing {
    const messages = [this.notice, this.truncated ? localize(MSG.view.truncated) : ''].filter((text) => text !== '');
    if (messages.length === 0) return nothing;
    return html`<div class="notice"><ix-icon name="warning" size="16"></ix-icon>${messages.join(' ')}</div>`;
  }

  private renderStats(scoped: readonly Alarm[]): TemplateResult {
    const reference = this.reference();
    const counters = countAlarms(scoped, reference);
    const compact = this.layout === 'panel';
    return html`
      <wui-alarm-stats
        .compact=${compact}
        .counters=${counters}
        .histogram=${this.histogram(scoped, reference)}
        .actors=${compact ? [] : topActors(scoped, this.grouping)}
        .selected=${this.severities}
        .grouping=${this.grouping}
        @wui:bands=${(event: CustomEvent<Severity[]>) => this.patch({ severities: event.detail })}
        @wui:grouping=${(event: CustomEvent<ActorGrouping>) => (this.grouping = event.detail)}
      ></wui-alarm-stats>
    `;
  }

  private renderTable(page: AlarmPage): TemplateResult {
    return html`
      <wui-alarm-table
        .page=${page}
        .sort=${this.sort}
        .sortDir=${this.sortDir}
        .selection=${this.selection}
        .compact=${this.layout === 'panel'}
        .selectable=${!this.noAck}
        .showCleared=${this.source === 'history'}
        @wui:sort=${(event: CustomEvent<SortField>) => this.onSort(event.detail)}
        @wui:page=${(event: CustomEvent<number>) => (this.pageNo = event.detail)}
        @wui:selection=${(event: CustomEvent<string[]>) => this.onSelection(event.detail)}
      ></wui-alarm-table>
    `;
  }

  /**
   * The histogram shape per snapshot: the EEMUA 10-minute reading for the live
   * list, and buckets scaled to the period (threshold scaled with them) for an
   * archived one — a 10-minute bucket over seven days would be unreadable.
   */
  private histogram(scoped: readonly Alarm[], reference: number): ReturnType<typeof alarmHistogram> {
    if (this.source === 'active') return alarmHistogram(scoped, reference, DEFAULT_WINDOW_MS);
    const { start, end } = this.range();
    const span = Math.max(1, end - start);
    return alarmHistogram(scoped, end, span, bucketFor(span));
  }

  private rangeLabel(): string {
    const { start, end } = this.range();
    return rangeLabelMsg(stampLabel(start), stampLabel(end));
  }

  /** Apply a toolbar change: the page always returns to 1, the selection is dropped. */
  private patch(change: ViewPatch): void {
    Object.assign(this, change);
    this.pageNo = 1;
    if (this.selection.size > 0) this.onSelection([]);
  }

  private onSort(field: SortField): void {
    this.sortDir = this.sort === field && this.sortDir === 'desc' ? 'asc' : 'desc';
    this.sort = field;
    this.pageNo = 1;
  }

  private onSelection(ids: readonly string[]): void {
    this.selection = new Set(ids);
    if (this.selection.size === 0) this.release();
  }

  /** Apply the live updates held back while a selection was open. */
  private release(): void {
    if (this.held === null) return;
    this.snapshot = this.held;
    this.held = null;
  }

  private resolveStore(): AlarmStore | null {
    if (this.store !== null) return this.store;
    try {
      this.store = new AlarmStore(this.bands);
    } catch {
      // No WinCC OA runtime in the container (standalone/demo host).
      this.notice = localize(MSG.view.loadFailed);
      this.store = null;
    }
    return this.store;
  }

  private async reload(): Promise<void> {
    if (this.scopeMissing()) {
      this.sub.unsubscribe();
      this.snapshot = [];
      return;
    }
    const store = this.resolveStore();
    if (store === null) return;
    this.sub.unsubscribe();
    this.sub = new Subscription();
    this.notice = '';
    if (this.source === 'active') {
      this.truncated = false;
      this.loading = this.snapshot.length === 0;
      this.sub.add(store.live$().subscribe({ next: (alarms) => this.onLive(alarms), error: () => this.onFailure() }));
      return;
    }
    await this.loadHistory(store);
  }

  private async loadHistory(store: AlarmStore): Promise<void> {
    this.loading = true;
    try {
      const { alarms, truncated } = await store.history(this.range(), this.maxResults);
      this.snapshot = alarms;
      this.held = null;
      this.truncated = truncated;
      this.updatedAt = Date.now();
      this.emitCounters(alarms);
    } catch {
      this.onFailure();
    } finally {
      this.loading = false;
    }
  }

  private onLive(alarms: readonly Alarm[]): void {
    this.loading = false;
    this.updatedAt = Date.now();
    // Hold the update rather than re-order the table under an open selection.
    if (this.selection.size > 0) {
      this.held = alarms;
      return;
    }
    this.snapshot = alarms;
    this.held = null;
    this.emitCounters(alarms);
  }

  private onFailure(): void {
    this.loading = false;
    this.notice = localize(MSG.view.loadFailed);
  }

  private emitCounters(alarms: readonly Alarm[]): void {
    const scoped = alarms.filter((alarm) => inScope(alarm, this.effectiveScope()));
    this.dispatchEvent(
      new CustomEvent('wui:counters', {
        detail: countAlarms(scoped, this.reference()),
        bubbles: true,
        composed: true
      })
    );
  }

  private async acknowledgeSelection(): Promise<void> {
    const byId = new Map(this.snapshot.map((alarm) => [alarm.id, alarm]));
    const alarms = [...this.selection].map((id) => byId.get(id)).filter((alarm): alarm is Alarm => alarm !== undefined);
    await this.acknowledge(alarms);
  }

  private async acknowledge(alarms: readonly Alarm[]): Promise<void> {
    if (this.noAck || alarms.length === 0) return;
    const store = this.resolveStore();
    if (store === null) return;
    this.busy = true;
    try {
      const applied = await store.acknowledge(alarms);
      this.notice = applied ? '' : localize(MSG.view.ackFailed);
    } catch {
      this.notice = localize(MSG.view.ackFailed);
    } finally {
      this.busy = false;
      this.onSelection([]);
      // The live stream pushes the new ack state on its own; the archive does not.
      if (this.source === 'history') await this.reload();
    }
  }
}

// Guarded registration: the kit is vendored into several self-contained page
// bundles that share one CustomElementRegistry per SPA session.
if (!customElements.get('wui-alarm-view')) {
  customElements.define('wui-alarm-view', WuiAlarmView);
}
