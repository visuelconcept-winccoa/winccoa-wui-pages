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
 *
 * <!-- a module's own alarms, its columns and its acknowledgement -->
 * <wui-alarm-view
 *   .profile=${{ columns: ['severity', 'raised', 'source', 'text', { id: 'of', label: 'OF' }, 'state'] }}
 *   .extensions=${[myExtension]}
 *   .filters=${{ classes: ['OOS', 'AOS'] }}
 * ></wui-alarm-view>
 * ```
 *
 * `source` chooses the snapshot: `active` subscribes to the live alarms, `history`
 * queries the archive over the resolved period. The period is either given
 * explicitly (`from` / `to`, epoch ms — the case when a host page already owns a
 * period selector) or picked in the view (`period` / `shift` / `custom-start` /
 * `custom-end`).
 *
 * What the view shows is a PROFILE (`profile.ts`): the kit's defaults, then the
 * host's `.profile`, then the stored profile named by `profile-name`. What it
 * does with a module's own alarms is an EXTENSION (`extensions.ts`): its reading
 * of a row, its columns, its filters, its acknowledgement.
 *
 * A live list re-orders itself under the cursor, which makes acknowledging
 * error-prone; so as soon as the operator has a selection, incoming updates are
 * HELD (the status dot turns amber) and applied when the selection is released.
 */
import { canWriteDatapoints$ } from '@visuelconcept-winccoa/wui-kit/data/permissions.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { localizeDate } from '@wincc-oa/wui-i18n-shared/localize-date.js';
import { DatetimeFormat } from '@wincc-oa/wui-models/enums/wui-i18n/datetime-format.js';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { toCsv } from '../columns.js';
import {
  combinedClassifier,
  partitionAck,
  registeredExtensions,
  type AckResult,
  type AlarmAckHandler,
  type AlarmColumnRenderer,
  type AlarmViewExtension
} from '../extensions.js';
import {
  MSG,
  ackAllMsg,
  ackConfirmMsg,
  ackDoneMsg,
  ackSelectionMsg,
  filteredOfTotalMsg,
  lastHoursMsg,
  localize,
  localizeDir,
  quickPeriodMsg,
  rangeLabelMsg
} from '../i18n.js';
import { QUICK_PERIODS, resolvePeriod, type AlarmPeriod, type Range } from '../period.js';
import {
  mergeProfiles,
  type AlarmColumn,
  type AlarmFieldFilter,
  type AlarmFilterValues,
  type AlarmViewProfile,
  type ResolvedProfile
} from '../profile.js';
import {
  applyQuery,
  fieldValue,
  inSource,
  selectAll,
  DEFAULT_PAGE_SIZE,
  type AlarmPage,
  type AlarmQuery,
  type AlarmSource
} from '../query.js';
import { mergeOccurrences } from '../occurrences.js';
import { inScope, parseScopeAttribute } from '../scope.js';
import type { SortDir, SortField } from '../severity.js';
import { DEFAULT_WINDOW_MS, alarmHistogram, bucketFor, countAlarms, topActors } from '../statistics.js';
import {
  DEFAULT_RANGES,
  canAcknowledge,
  type ActorGrouping,
  type Alarm,
  type AlarmCounters,
  type AlarmRange
} from '../types.js';
import { AlarmStore, DEFAULT_MAX_RESULTS } from '../data/alarm-store.js';
import { ALARM_CONFIG_EVENT, loadAlarmConfig, type AlarmConfig } from '../data/alarm-config-store.js';
import { rangeColor, severityTokens } from './alarm-tokens.js';
import { renderPeriodBar } from './period-bar.js';
import { alarmViewStyles } from './wui-alarm-view.styles.js';
import './wui-alarm-stats.js';
import './wui-alarm-table.js';

const HOUR_MS = 3_600_000;
/** How long a confirmation ("3 alarms acknowledged") stays on screen. */
const FLASH_MS = 4000;

/** Density preset. `panel` is the embedded variant. */
export type AlarmViewLayout = 'page' | 'panel';

/** Inputs that invalidate the snapshot and force a reload. */
const RELOAD_KEYS = [
  'source',
  'period',
  'shift',
  'customStart',
  'customEnd',
  'from',
  'to',
  'maxResults',
  'ranges'
] as const;

/** The toolbar-driven inputs {@link WuiAlarmView.patch} may change at once. */
interface ViewPatch {
  source?: AlarmSource;
  period?: AlarmPeriod;
  shift?: number;
  customStart?: string;
  customEnd?: string;
  search?: string;
  unackOnly?: boolean;
  ranks?: readonly number[];
  classes?: readonly string[];
  fields?: Readonly<Record<string, string>>;
}

/** An open confirmation: its question, and who waits for the answer. */
interface Confirmation {
  title: string;
  lines: string[];
  resolve: (ok: boolean) => void;
}

/** The value of the "all" entry of a filter select (`ix-select` shows no label for an empty value). */
const ALL = '*';

/** `ix-select` / `ix-input` hand their value over as a string or a list. */
interface IxValueEvent {
  detail: string | string[];
}

function firstValue(detail: string | string[]): string {
  return Array.isArray(detail) ? (detail[0] ?? '') : detail;
}

/** A period bound in the reader's locale (date + time). */
function stampLabel(ms: number): string {
  return localizeDate(new Date(ms), undefined, DatetimeFormat.Default);
}

function labelText(label: AlarmFieldFilter['label']): string {
  return typeof label === 'string' ? label : localize(label);
}

/** A stable key of a value's content — a host recomputing an equal object must not reset the view. */
function contentKey(value: unknown): string {
  return value === null || value === undefined ? '' : JSON.stringify(value);
}

export class WuiAlarmView extends LitElement {
  static override readonly styles = [IXCoreStyles, severityTokens(), alarmViewStyles()];

  /** `active` = the standing alarms (live); `history` = the archive of a period. */
  @property({ reflect: true }) source: AlarmSource = 'active';
  /** Hide the Active / History tabs — the host decides which snapshot is shown. */
  @property({ type: Boolean, attribute: 'lock-source' }) lockSource = false;
  @property() period: AlarmPeriod = '24h';
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
  /** No counters and no charts at all. */
  @property({ type: Boolean, attribute: 'hide-stats' }) hideStats = false;
  @property({ type: Boolean, attribute: 'hide-toolbar' }) hideToolbar = false;
  /** Hide the period controls (the host page drives `from` / `to`). */
  @property({ type: Boolean, attribute: 'hide-period' }) hidePeriod = false;
  /**
   * Read-only view: no selection, no acknowledge. The kit's own acknowledgement
   * is ALSO withheld when the user lacks the WinCC OA write permission (see
   * {@link ackDisabled}) — the write would only be refused by the runtime.
   */
  @property({ type: Boolean, attribute: 'no-ack' }) noAck = false;
  @property({ type: Number, attribute: 'page-size' }) pageSize = DEFAULT_PAGE_SIZE;
  @property({ type: Number, attribute: 'max-results' }) maxResults = DEFAULT_MAX_RESULTS;
  /**
   * The levels to use. Left unset, the view reads the project's own from the
   * module's configuration datapoint (shared across every view on the page) and
   * follows it live — so a level edited in the Alarms page re-colours an
   * embedded panel without the host wiring anything.
   */
  @property({ attribute: false }) ranges: readonly AlarmRange[] | null = null;
  /** How far back the occurrence statistics look on the active tab. */
  @property({ type: Number, attribute: 'stats-window' }) statsWindowMs = DEFAULT_WINDOW_MS;
  /** The host module's display profile (code layer, see `profile.ts`). */
  @property({ attribute: false }) profile: AlarmViewProfile | null = null;
  /** A profile stored in the configuration datapoint (engineering layer), by name. */
  @property({ attribute: 'profile-name' }) profileName = '';
  /** The host module's extensions (see `extensions.ts`). */
  @property({ attribute: false }) extensions: readonly AlarmViewExtension[] = [];
  /**
   * Filter values to start on — a link's (`#/alarms?class=OOS`). Applied again
   * whenever their content changes; the operator may clear them.
   */
  @property({ attribute: false }) filters: AlarmFilterValues | null = null;

  @state() private snapshot: readonly Alarm[] = [];
  /** Live updates held back while the operator has a selection. */
  @state() private held: readonly Alarm[] | null = null;
  @state() private ranks: readonly number[] = [];
  @state() private classes: readonly string[] = [];
  @state() private fields: Readonly<Record<string, string>> = {};
  /** The project's configuration once read from the datapoint. */
  @state() private configured: AlarmConfig | null = null;
  /**
   * The OCCURRENCES of the statistics window on the active tab.
   *
   * The live subscription is a snapshot of what is active NOW, so counting
   * recurrences in it is wrong by construction: an alarm that clears leaves the
   * set and its occurrence disappears from the tally, then reappears when it
   * comes back. The window is therefore seeded from the ARCHIVE (the past cannot
   * be reconstructed from the present) and kept up to date by the live stream.
   */
  @state() private windowRows: readonly Alarm[] = [];
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
  @state() private flashText = '';
  @state() private truncated = false;
  @state() private updatedAt = 0;
  @state() private confirmation: Confirmation | null = null;

  /** WinCC OA write permission of the connected user (`dpSet`) — the kit's acknowledgement needs it. */
  @state() private canWrite = true;

  private store: AlarmStore | null = null;
  private sub = new Subscription();
  private permissionSub = new Subscription();
  /** Swallows the `updated()` of the very first render — `firstUpdated` loaded. */
  private firstSettled = false;
  /** Content key of the last seen scope (see {@link updated}). */
  private scopeKey = '';
  /** Content key of the filter values last applied (profile defaults + link). */
  private filtersKey: string | null = null;
  /** Content key of the classifiers the store was built with. */
  private extensionsKey = '';
  private flashTimer = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener(ALARM_CONFIG_EVENT, this.onConfigChanged);
    this.permissionSub = canWriteDatapoints$().subscribe((granted) => (this.canWrite = granted));
    void this.readConfig();
    // Re-attachment (a router swap, a host moving the node) must re-subscribe.
    if (this.hasUpdated) void this.reload();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    globalThis.removeEventListener(ALARM_CONFIG_EVENT, this.onConfigChanged);
    this.sub.unsubscribe();
    this.permissionSub.unsubscribe();
    window.clearTimeout(this.flashTimer);
    this.confirmation?.resolve(false);
    this.confirmation = null;
  }

  protected override willUpdate(changed: PropertyValues): void {
    // The starting filters: the profile's defaults, then the link's. Applied when
    // either CHANGES (by content), never on an unrelated render — the operator's
    // own filtering must survive a live update.
    if (['profile', 'profileName', 'filters', 'configured'].some((key) => changed.has(key))) {
      const resolved = this.resolvedProfile();
      const start = { ...resolved.defaults, ...this.filters };
      const key = contentKey(start);
      if (key !== this.filtersKey) {
        this.filtersKey = key;
        this.applyStart(start);
      }
    }
  }

  override render(): TemplateResult {
    if (this.scopeMissing()) {
      return html`<div class="center">${localizeDir(MSG.view.noScope)}</div>`;
    }
    const profile = this.resolvedProfile();
    const scoped = this.snapshot.filter((alarm) => inScope(alarm, this.effectiveScope()));
    const page = applyQuery(scoped, this.query(), this.reference());
    // The statistics describe the rows of the TAB, not of the whole snapshot: the
    // level tiles double as the level filter, so a tile reading 0 while clicking
    // it reveals rows would be a lie the operator acts on.
    const visible = scoped.filter((alarm) => inSource(alarm, this.source));
    const counters = countAlarms(visible, this.reference());
    return html`
      ${this.renderCounters(profile, counters, visible, scoped)}
      ${this.hideToolbar ? nothing : this.renderToolbar(profile, page, scoped)}
      ${this.renderNotice()}
      <div class=${this.layout === 'panel' ? 'list' : 'card list'}>
        ${this.loading && this.snapshot.length === 0
          ? html`<div class="center"><ix-spinner></ix-spinner></div>`
          : this.renderTable(profile, page, scoped)}
      </div>
      ${this.renderConfirmation()}
    `;
  }

  override updated(changed: PropertyValues<this>): void {
    if (!this.firstSettled) {
      this.firstSettled = true;
      this.scopeKey = this.effectiveScope().join('|');
      this.extensionsKey = this.classifierKey();
      return;
    }
    const classifiers = this.classifierKey();
    if (classifiers !== this.extensionsKey) {
      // A new reading of the rows: the snapshot must be re-mapped.
      this.extensionsKey = classifiers;
      this.store = null;
      void this.reload();
      return;
    }
    if (RELOAD_KEYS.some((key) => changed.has(key))) {
      if (changed.has('ranges')) this.store = null;
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
    await this.acknowledge(this.allSelected());
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.reload();
  }

  // --- profile, extensions -------------------------------------------------

  /** Defaults, then the host's profile, then the stored one it names. */
  private resolvedProfile(): ResolvedProfile {
    const stored = this.profileName === '' ? undefined : this.configured?.profiles[this.profileName];
    return mergeProfiles(this.profile, stored);
  }

  /** The host's extensions, then those the profile names from the registry. */
  private activeExtensions(): AlarmViewExtension[] {
    const named = registeredExtensions(this.resolvedProfile().extensions);
    const out = [...this.extensions];
    for (const extension of named) if (!out.some((known) => known.id === extension.id)) out.push(extension);
    return out;
  }

  private classifierKey(): string {
    return this.activeExtensions()
      .filter((extension) => extension.classify)
      .map((extension) => extension.id)
      .join('|');
  }

  private renderers(): Map<string, AlarmColumnRenderer> {
    const out = new Map<string, AlarmColumnRenderer>();
    for (const extension of this.activeExtensions()) for (const renderer of extension.columns ?? []) out.set(renderer.id, renderer);
    return out;
  }

  /** The profile's field filters, then the extensions' (an id appears once). */
  private fieldFilters(profile: ResolvedProfile): AlarmFieldFilter[] {
    const out = [...profile.filters.fields];
    for (const extension of this.activeExtensions()) {
      for (const filter of extension.filters ?? []) if (!out.some((known) => known.id === filter.id)) out.push(filter);
    }
    return out;
  }

  private columnsFor(profile: ResolvedProfile): AlarmColumn[] {
    if (this.layout === 'panel') return profile.panelColumns;
    return this.source === 'history' ? profile.historyColumns : profile.columns;
  }

  private applyStart(values: AlarmFilterValues): void {
    this.ranks = values.ranks ?? [];
    this.classes = values.classes ?? [];
    this.search = values.search ?? '';
    this.unackOnly = values.unackOnly ?? false;
    this.fields = values.fields ?? {};
    if (values.source && !this.lockSource) this.source = values.source;
    this.pageNo = 1;
  }

  // --- scope, period, configuration ----------------------------------------

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

  /** The host's levels, else the project's, else the seed. */
  private effectiveRanges(): readonly AlarmRange[] {
    return this.ranges ?? this.configured?.ranges ?? DEFAULT_RANGES;
  }

  /** Read the project's configuration once (the read is shared by every view on the page). */
  private async readConfig(): Promise<void> {
    const config = await loadAlarmConfig();
    if (this.configured === config) return;
    this.applyConfig(config);
  }

  /** A level or a profile edited elsewhere must re-rank and re-lay the view. */
  private readonly onConfigChanged = (event: Event): void => {
    const config = (event as CustomEvent<AlarmConfig>).detail;
    if (!config?.ranges) return;
    this.applyConfig(config);
  };

  private applyConfig(config: AlarmConfig): void {
    const rerank = this.ranges === null && contentKey(config.ranges) !== contentKey(this.configured?.ranges);
    this.configured = config;
    if (!rerank) return;
    // The snapshot carries a rank computed with the OLD levels: re-map it.
    this.store = null;
    void this.reload();
  }

  private query(): AlarmQuery {
    return {
      source: this.source,
      scope: this.effectiveScope(),
      ranks: this.ranks,
      classes: this.classes,
      fields: this.fields,
      search: this.search,
      unacknowledgedOnly: this.unackOnly,
      sort: this.sort,
      dir: this.sortDir,
      page: this.pageNo,
      pageSize: this.pageSize
    };
  }

  /** Every row the filters keep, unpaged. */
  private allSelected(): readonly Alarm[] {
    const scoped = this.snapshot.filter((alarm) => inScope(alarm, this.effectiveScope()));
    return selectAll(scoped, this.query());
  }

  // --- acknowledgement availability -----------------------------------------

  private hasAckOverride(): boolean {
    return this.activeExtensions().some((extension) => extension.acknowledge);
  }

  /**
   * Acknowledging is unavailable when the host says so (`no-ack`), or when the
   * user has no WinCC OA write permission AND no extension acknowledges by its
   * own means: the checkboxes and the buttons are then not rendered at all,
   * instead of offering a write the runtime would refuse.
   */
  private get ackDisabled(): boolean {
    return this.noAck || (!this.canWrite && !this.hasAckOverride());
  }

  // --- rendering --------------------------------------------------------------

  /**
   * Counter tiles (page) or the compact strip (panel), then the charts.
   *
   * Two different sets, on purpose: the counters describe the rows of the TAB
   * (the state right now), the histogram and the recurring alarms describe the
   * OCCURRENCES of the window (what happened over it).
   */
  private renderCounters(
    profile: ResolvedProfile,
    counters: AlarmCounters,
    visible: readonly Alarm[],
    scoped: readonly Alarm[]
  ): TemplateResult | typeof nothing {
    if (this.hideStats) return nothing;
    if (this.layout === 'panel') {
      return html`<wui-alarm-stats
        compact
        .counters=${counters}
        .ranges=${this.effectiveRanges()}
        .selected=${this.ranks}
        @wui:ranks=${(event: CustomEvent<number[]>) => this.patch({ ranks: event.detail })}
      ></wui-alarm-stats>`;
    }
    const occurrences = profile.stats ? this.statsRows(scoped) : [];
    return html`
      ${profile.tiles ? this.renderTiles(counters, visible.length) : nothing}
      ${profile.stats
        ? html`<wui-alarm-stats
            charts-only
            .counters=${counters}
            .histogram=${this.histogram(occurrences)}
            .actors=${topActors(occurrences, this.grouping)}
            .ranges=${this.effectiveRanges()}
            .grouping=${this.grouping}
            window-label=${this.windowLabel()}
            @wui:grouping=${(event: CustomEvent<ActorGrouping>) => (this.grouping = event.detail)}
          ></wui-alarm-stats>`
        : nothing}
    `;
  }

  /** The counter tiles: they read the tab and double as its filters. */
  private renderTiles(counters: AlarmCounters, total: number): TemplateResult {
    const ranges = this.effectiveRanges();
    const unfiltered = this.ranks.length === 0 && !this.unackOnly;
    return html`
      <div class="tiles">
        <button class="tile" aria-pressed=${unfiltered ? 'true' : 'false'} @click=${() => this.patch({ ranks: [], unackOnly: false })}>
          <span class="muted">${localizeDir(this.source === 'active' ? MSG.counters.active : MSG.view.sourceHistory)}</span>
          <span class="n">${total}</span>
        </button>
        <button
          class=${counters.unacknowledged > 0 ? 'tile unack' : 'tile'}
          aria-pressed=${this.unackOnly ? 'true' : 'false'}
          @click=${() => this.patch({ unackOnly: !this.unackOnly })}
        >
          <span class="muted">${localizeDir(MSG.counters.unacknowledged)}</span>
          <span class="n">${counters.unacknowledged}</span>
        </button>
        ${ranges.map((range, index) => {
          const rank = index + 1;
          const pressed = this.ranks.length === 1 && this.ranks[0] === rank;
          return html`<button
            class="tile"
            aria-pressed=${pressed ? 'true' : 'false'}
            title=${`${range.label ?? range.abbr} · ${localize(MSG.counters.fromPrior)} ${range.minPrior}`}
            @click=${() => this.patch({ ranks: pressed ? [] : [rank] })}
          >
            <span class=${rank === 1 ? 'sev top' : 'sev'} style=${`--sev-color:${rangeColor(rank, ranges)}`}>${range.label ?? range.abbr}</span>
            <span class="n">${counters.byRank[rank] ?? 0}</span>
            ${counters.ackedByRank[rank] ? html`<span class="legend">${counters.ackedByRank[rank]} ${localize(MSG.counters.acked)}</span>` : nothing}
          </button>`;
        })}
      </div>
    `;
  }

  private renderToolbar(profile: ResolvedProfile, page: AlarmPage, scoped: readonly Alarm[]): TemplateResult {
    const panel = this.layout === 'panel';
    return html`
      <div class=${panel ? 'bar' : 'card bar'}>
        <div class="row">
          ${this.lockSource ? nothing : this.renderTabs(page)}
          ${this.source === 'history' && !this.hidePeriod ? this.renderPeriod() : nothing}
          <span class="grow"></span>
          ${this.renderStatus()}
        </div>
        <div class="row filters">
          ${this.renderFilters(profile, scoped)}
          <span class="muted mono count">${filteredOfTotalMsg(`${page.filtered}`, `${page.total}`)}</span>
          <span class="grow"></span>
          <div class="actions">${this.renderActions(profile, page)}</div>
        </div>
      </div>
    `;
  }

  private renderTabs(page: AlarmPage): TemplateResult {
    return html`
      <div class="tabs" role="tablist">
        <button
          class="tab"
          role="tab"
          aria-selected=${this.source === 'active' ? 'true' : 'false'}
          @click=${() => this.patch({ source: 'active' })}
        >
          ${localizeDir(MSG.view.sourceActive)} ${this.source === 'active' ? html`<span class="mono">${page.filtered}</span>` : nothing}
        </button>
        <button
          class="tab"
          role="tab"
          aria-selected=${this.source === 'history' ? 'true' : 'false'}
          @click=${() => this.patch({ source: 'history' })}
        >
          ${localizeDir(MSG.view.sourceHistory)}
        </button>
      </div>
    `;
  }

  /** The quick periods, the period bar, and the resolved period in clear. */
  private renderPeriod(): TemplateResult {
    const explicit = this.from > 0 && this.to > this.from;
    return html`
      ${explicit
        ? nothing
        : html`<div class="presets">
              ${QUICK_PERIODS.map(
                (period) => html`<button
                  class="preset"
                  aria-pressed=${this.period === period && this.shift === 0 ? 'true' : 'false'}
                  @click=${() => this.patch({ period, shift: 0 })}
                >
                  ${quickPeriodMsg(period)}
                </button>`
              )}
            </div>
            ${renderPeriodBar(this, (change) => this.patch(change))}`}
      <span class="muted range">${this.rangeLabel()}</span>
    `;
  }

  private renderFilters(profile: ResolvedProfile, scoped: readonly Alarm[]): TemplateResult {
    const panel = this.layout === 'panel';
    return html`
      ${profile.filters.severity && !panel ? this.renderSeverityFilter() : nothing}
      ${profile.filters.classes && !panel ? this.renderClassFilter(scoped) : nothing}
      ${panel ? nothing : this.fieldFilters(profile).map((filter) => this.renderFieldFilter(filter, scoped))}
      ${profile.filters.search
        ? html`<label class="f search">
            ${panel ? nothing : html`<span>${localizeDir(MSG.view.searchLabel)}</span>`}
            <ix-input
              type="search"
              placeholder=${localize(MSG.view.search)}
              .value=${this.search}
              @valueChange=${(event: IxValueEvent) => this.patch({ search: firstValue(event.detail) })}
            ></ix-input>
          </label>`
        : nothing}
      ${profile.filters.unackOnly
        ? html`<ix-checkbox
            class="chk"
            label=${localize(MSG.view.unackOnly)}
            .checked=${this.unackOnly}
            @checkedChange=${(event: { detail: boolean }) => this.patch({ unackOnly: event.detail })}
          ></ix-checkbox>`
        : nothing}
      ${this.hasFilters()
        ? html`<ix-button variant="tertiary" class="clear" @click=${() => this.patch({ ranks: [], classes: [], fields: {}, search: '', unackOnly: false })}>
            ${localizeDir(MSG.view.clearFilters)}
          </ix-button>`
        : nothing}
    `;
  }

  private hasFilters(): boolean {
    return (
      this.ranks.length > 0 ||
      this.classes.length > 0 ||
      this.search !== '' ||
      this.unackOnly ||
      Object.values(this.fields).some((value) => value !== '')
    );
  }

  /**
   * "Minimum severity": level N keeps the levels 1…N. Any other set of levels
   * (two tiles picked apart) reads as "custom" and is left as it is.
   */
  private renderSeverityFilter(): TemplateResult {
    const ranges = this.effectiveRanges();
    const contiguous = this.ranks.length > 0 && this.ranks.every((rank, index) => rank === index + 1);
    const value = contiguous ? String(this.ranks.length) : this.ranks.length === 0 ? ALL : 'custom';
    return html`<label class="f">
      <span>${localizeDir(MSG.view.severityMin)}</span>
      <ix-select
        .value=${value}
        @valueChange=${(event: IxValueEvent) => {
          const choice = firstValue(event.detail);
          if (choice === 'custom') return;
          const level = Number(choice);
          this.patch({ ranks: level > 0 ? Array.from({ length: level }, (_, index) => index + 1) : [] });
        }}
      >
        <ix-select-item value=${ALL} label=${localize(MSG.view.all)}></ix-select-item>
        ${value === 'custom'
          ? html`<ix-select-item value="custom" label=${this.ranks.map((rank) => ranges[rank - 1]?.label ?? ranges[rank - 1]?.abbr).join(', ')}></ix-select-item>`
          : nothing}
        ${ranges.map((range, index) => html`<ix-select-item value=${String(index + 1)} label=${range.label ?? range.abbr}></ix-select-item>`)}
      </ix-select>
    </label>`;
  }

  /** The alert classes of the rows, plus the ones a link asked for. */
  private renderClassFilter(scoped: readonly Alarm[]): TemplateResult {
    const present = [...new Set(scoped.map((alarm) => alarm.abbr).filter((abbr) => abbr !== ''))].sort((a, b) =>
      a.localeCompare(b)
    );
    const single = this.classes.length === 1 && !/[*?]/.test(this.classes[0] ?? '') ? (this.classes[0] ?? '') : '';
    const value = this.classes.length === 0 ? ALL : single || 'custom';
    const options = single !== '' && !present.includes(single) ? [single, ...present] : present;
    return html`<label class="f">
      <span>${localizeDir(MSG.view.classes)}</span>
      <ix-select .value=${value} @valueChange=${(event: IxValueEvent) => this.onClassChange(firstValue(event.detail))}>
        <ix-select-item value=${ALL} label=${localize(MSG.view.all)}></ix-select-item>
        ${value === 'custom' ? html`<ix-select-item value="custom" label=${this.classes.join(', ')}></ix-select-item>` : nothing}
        ${options.map((abbr) => html`<ix-select-item value=${abbr} label=${abbr}></ix-select-item>`)}
      </ix-select>
    </label>`;
  }

  private onClassChange(value: string): void {
    if (value === 'custom') return;
    this.patch({ classes: value === ALL || value === '' ? [] : [value] });
  }

  private renderFieldFilter(filter: AlarmFieldFilter, scoped: readonly Alarm[]): TemplateResult {
    const field = filter.field ?? filter.id;
    const options =
      filter.options?.map((option) => ({ value: option.value, label: labelText(option.label) })) ??
      [...new Set(scoped.map((alarm) => fieldValue(alarm, field)).filter((value) => value !== ''))]
        .sort((a, b) => a.localeCompare(b))
        .map((value) => ({ value, label: value }));
    return html`<label class="f">
      <span>${labelText(filter.label)}</span>
      <ix-select
        .value=${this.fields[field] || ALL}
        @valueChange=${(event: IxValueEvent) => {
          const choice = firstValue(event.detail);
          this.patch({ fields: { ...this.fields, [field]: choice === ALL ? '' : choice } });
        }}
      >
        <ix-select-item value=${ALL} label=${localize(MSG.view.all)}></ix-select-item>
        ${options.map((option) => html`<ix-select-item value=${option.value} label=${option.label}></ix-select-item>`)}
      </ix-select>
    </label>`;
  }

  private renderActions(profile: ResolvedProfile, page: AlarmPage): TemplateResult {
    const csv =
      this.source === 'history' && profile.history.csv && this.layout === 'page'
        ? html`<ix-button variant="secondary" ?disabled=${page.filtered === 0} @click=${() => this.exportCsv(profile)}>
            ${localizeDir(MSG.view.exportCsv)}
          </ix-button>`
        : nothing;
    if (this.ackDisabled) return html`${csv}`;
    const selected = this.selectedAlarms();
    const all = profile.ack.all ? this.allSelected().filter((alarm) => canAcknowledge(alarm)) : [];
    return html`
      ${csv}
      ${profile.ack.selection
        ? html`<ix-button
            variant=${profile.ack.all ? 'secondary' : 'primary'}
            ?disabled=${this.busy || selected.length === 0}
            @click=${() => void this.acknowledge(selected)}
          >
            ${ackSelectionMsg(selected.length)}
          </ix-button>`
        : nothing}
      ${profile.ack.all
        ? html`<ix-button ?disabled=${this.busy || all.length === 0} @click=${() => void this.acknowledge(all)}>
            ${ackAllMsg(all.length)}
          </ix-button>`
        : nothing}
    `;
  }

  private renderStatus(): TemplateResult {
    const clock =
      this.updatedAt === 0 ? '--' : localizeDate(new Date(this.updatedAt), undefined, DatetimeFormat.TimeWithSeconds);
    return html`
      <span class="status">
        <span class=${this.held === null ? 'dot' : 'dot held'}></span>
        ${this.source === 'active' ? localizeDir(MSG.view.live) : nothing} ${localizeDir(MSG.view.updatedAt)} ${clock}
      </span>
      <ix-icon-button
        variant="tertiary"
        icon="refresh"
        size="16"
        title=${localize(MSG.view.refresh)}
        ?disabled=${this.loading}
        @click=${() => void this.reload()}
      ></ix-icon-button>
    `;
  }

  private renderNotice(): TemplateResult | typeof nothing {
    const messages = [this.notice, this.truncated ? localize(MSG.view.truncated) : ''].filter((text) => text !== '');
    if (messages.length === 0 && this.flashText === '') return nothing;
    return html`
      ${messages.length === 0
        ? nothing
        : html`<div class="notice" role="alert"><ix-icon name="warning" size="16"></ix-icon>${messages.join(' ')}</div>`}
      ${this.flashText === '' ? nothing : html`<div class="flash" role="status">${this.flashText}</div>`}
    `;
  }

  private renderTable(profile: ResolvedProfile, page: AlarmPage, scoped: readonly Alarm[]): TemplateResult {
    if (page.filtered === 0 && this.layout === 'page') {
      const message = scoped.some((alarm) => inSource(alarm, this.source))
        ? MSG.view.noMatch
        : this.source === 'active'
          ? MSG.view.noActive
          : MSG.view.noHistory;
      return html`<div class="center">${localizeDir(message)}</div>`;
    }
    return html`
      <wui-alarm-table
        .page=${page}
        .sort=${this.sort}
        .sortDir=${this.sortDir}
        .selection=${this.selection}
        .compact=${this.layout === 'panel'}
        .selectable=${!this.ackDisabled}
        .columns=${this.columnsFor(profile)}
        .renderers=${this.renderers()}
        .ranges=${this.effectiveRanges()}
        @wui:sort=${(event: CustomEvent<SortField>) => this.onSort(event.detail)}
        @wui:page=${(event: CustomEvent<number>) => (this.pageNo = event.detail)}
        @wui:selection=${(event: CustomEvent<string[]>) => this.onSelection(event.detail)}
      ></wui-alarm-table>
    `;
  }

  private renderConfirmation(): TemplateResult | typeof nothing {
    const confirmation = this.confirmation;
    if (confirmation === null) return nothing;
    const answer = (ok: boolean): void => {
      this.confirmation = null;
      confirmation.resolve(ok);
    };
    return html`
      <div class="overlay" @click=${() => answer(false)} @keydown=${(event: KeyboardEvent) => event.key === 'Escape' && answer(false)}>
        <div class="dialog" role="dialog" aria-modal="true" aria-label=${confirmation.title} @click=${(event: Event) => event.stopPropagation()}>
          <div class="dialog-head">${confirmation.title}</div>
          <div class="dialog-body">${confirmation.lines.map((line) => html`<p>${line}</p>`)}</div>
          <div class="dialog-foot">
            <ix-button variant="secondary" @click=${() => answer(false)}>${localizeDir(MSG.view.cancel)}</ix-button>
            <ix-button @click=${() => answer(true)}>${localizeDir(MSG.view.ack)}</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  // --- statistics ---------------------------------------------------------------

  /**
   * What the statistics count: OCCURRENCES over a window, not the current state.
   *
   * On the archived tab the snapshot already IS the period. On the live tab the
   * archive-seeded window is merged with the live rows — the live row wins, being
   * the fresher state of the same occurrence — and whatever aged out is dropped.
   */
  private statsRows(scoped: readonly Alarm[]): readonly Alarm[] {
    if (this.source !== 'active') return scoped;
    const scope = this.effectiveScope();
    const archived = this.windowRows.filter((alarm) => inScope(alarm, scope));
    return mergeOccurrences(archived, scoped, Date.now() - this.statsWindowMs);
  }

  /**
   * The histogram shape per tab: the EEMUA ten minutes over the live window, and
   * buckets scaled to the PERIOD (threshold scaled with them) on the archived tab
   * — a 10-minute bucket over seven days would be unreadable.
   */
  private histogram(rows: readonly Alarm[]): ReturnType<typeof alarmHistogram> {
    if (this.source === 'active') return alarmHistogram(rows, Date.now(), this.statsWindowMs);
    const { start, end } = this.range();
    const span = Math.max(1, end - start);
    return alarmHistogram(rows, end, span, bucketFor(span));
  }

  /** What the histogram and the recurring alarms span, said in clear. */
  private windowLabel(): string {
    if (this.source !== 'active') return this.rangeLabel();
    const hours = Math.round(this.statsWindowMs / HOUR_MS);
    return this.statsWindowMs === DEFAULT_WINDOW_MS ? localize(MSG.histogram.window) : lastHoursMsg(hours);
  }

  /** Seed the occurrence window from the archive — the past is not in the live set. */
  private async loadStatsWindow(store: AlarmStore): Promise<void> {
    if (this.source !== 'active' || this.hideStats || this.layout === 'panel' || !this.resolvedProfile().stats) return;
    const end = Date.now();
    try {
      const { alarms } = await store.history({ start: end - this.statsWindowMs, end }, this.maxResults);
      this.windowRows = alarms;
    } catch {
      // No alarm archive: the statistics fall back to what the live set shows —
      // understated for the past, still correct for what is happening now.
      this.windowRows = [];
    }
  }

  private rangeLabel(): string {
    const { start, end } = this.range();
    return rangeLabelMsg(stampLabel(start), stampLabel(end));
  }

  // --- interaction -------------------------------------------------------------

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

  private selectedAlarms(): Alarm[] {
    const byId = new Map(this.snapshot.map((alarm) => [alarm.id, alarm]));
    return [...this.selection].map((id) => byId.get(id)).filter((alarm): alarm is Alarm => alarm !== undefined);
  }

  /** Apply the live updates held back while a selection was open. */
  private release(): void {
    if (this.held === null) return;
    this.snapshot = this.held;
    this.held = null;
  }

  private flash(text: string): void {
    this.flashText = text;
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => (this.flashText = ''), FLASH_MS);
  }

  private exportCsv(profile: ResolvedProfile): void {
    const { start, end } = this.range();
    const stamp = (ms: number): string => new Date(ms).toISOString().slice(0, 16).replaceAll(/[:T]/g, '-');
    const scoped = this.snapshot.filter((alarm) => inScope(alarm, this.effectiveScope()));
    const rows = applyQuery(scoped, { ...this.query(), page: 1, pageSize: Math.max(1, scoped.length) }, this.reference()).rows;
    const blob = new Blob([toCsv(rows, this.columnsFor(profile), this.effectiveRanges())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `alarms_${stamp(start)}_${stamp(end)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // --- data ------------------------------------------------------------------------

  private resolveStore(): AlarmStore | null {
    if (this.store !== null) return this.store;
    try {
      this.store = new AlarmStore(this.effectiveRanges(), combinedClassifier(this.activeExtensions()));
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
      this.sub.add(
        store.live$().subscribe({
          next: (alarms) => this.onLive(alarms),
          error: () => this.onFailure()
        })
      );
      void this.loadStatsWindow(store);
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
    this.mergeWindow(alarms);
    this.emitCounters(alarms);
  }

  /** Fold the live rows into the occurrence window, dropping whatever aged out. */
  private mergeWindow(live: readonly Alarm[]): void {
    if (this.source !== 'active' || this.hideStats) return;
    this.windowRows = mergeOccurrences(this.windowRows, live, Date.now() - this.statsWindowMs);
  }

  private onFailure(): void {
    this.loading = false;
    this.notice = localize(MSG.view.loadFailed);
  }

  private emitCounters(alarms: readonly Alarm[]): void {
    const scoped = alarms.filter((alarm) => inScope(alarm, this.effectiveScope()) && inSource(alarm, this.source));
    this.dispatchEvent(
      new CustomEvent('wui:counters', {
        detail: countAlarms(scoped, this.reference()),
        bubbles: true,
        composed: true
      })
    );
  }

  // --- acknowledgement ---------------------------------------------------------

  /** Ask the operator; resolves false when the dialog is dismissed. */
  private ask(title: string, lines: string[]): Promise<boolean> {
    this.confirmation?.resolve(false);
    return new Promise((resolve) => (this.confirmation = { title, lines, resolve }));
  }

  /**
   * Acknowledge: each alarm goes to the extension that claims it (its own dialog
   * and write — a cause and an action, say), the others to the kit's write.
   *
   * The kit's write is `<dpe>:_alert_hdl.._ack` on the operator's session: it
   * acknowledges every pending alarm of the ELEMENT, which the confirmation says.
   */
  private async acknowledge(alarms: readonly Alarm[]): Promise<void> {
    if (this.ackDisabled || alarms.length === 0) return;
    // Told apart on purpose: a selection with nothing acknowledgeable in it is not
    // a backend failure, and reporting one would send the operator hunting a
    // permission problem that does not exist.
    const targets = alarms.filter((alarm) => canAcknowledge(alarm));
    if (targets.length === 0) {
      this.notice = localize(MSG.view.ackNothing);
      this.onSelection([]);
      return;
    }
    const { handled, native: wanted } = partitionAck(targets, this.activeExtensions());
    const native = this.canWrite ? wanted : [];
    const warnings = native.length < wanted.length ? [localize(MSG.view.ackNoWrite)] : [];
    if (!(await this.confirmAck(native, handled.filter((entry) => !entry.handler.confirms).flatMap((entry) => entry.alarms)))) return;

    this.busy = true;
    this.notice = '';
    let done = 0;
    const errors: string[] = [...warnings];
    try {
      if (native.length > 0) {
        const result = await this.nativeAck(native);
        if (result.ok) done += native.length;
        else errors.push(result.error ?? localize(MSG.view.ackFailed));
      }
      for (const { handler, alarms: owned } of handled) {
        const result = await this.overrideAck(handler, owned);
        if (result === null) continue;
        if (result.ok) done += owned.length;
        else errors.push(result.error ?? localize(MSG.view.ackFailed));
      }
    } finally {
      this.busy = false;
      this.onSelection([]);
    }
    this.notice = errors.join(' ');
    if (done > 0) this.flash(ackDoneMsg(done));
    // The live stream pushes the new ack state on its own; the archive does not.
    if (this.source === 'history') await this.reload();
  }

  /** The confirmation of the profile, for what the extensions do not confirm themselves. */
  private async confirmAck(native: readonly Alarm[], unconfirmed: readonly Alarm[]): Promise<boolean> {
    const asked = [...native, ...unconfirmed];
    if (!this.resolvedProfile().ack.confirm || asked.length === 0) return true;
    const elements = new Set(asked.map((alarm) => alarm.dpe)).size;
    const lines = [ackConfirmMsg(asked.length, elements)];
    if (native.length > 0) lines.push(localize(MSG.view.ackElements));
    return this.ask(localize(MSG.view.ack), lines);
  }

  private async nativeAck(alarms: readonly Alarm[]): Promise<AckResult> {
    const store = this.resolveStore();
    if (store === null) return { ok: false };
    try {
      return await store.acknowledge(alarms);
    } catch (error) {
      const reason = error instanceof Error ? ` (${error.message})` : '';
      return { ok: false, error: `${localize(MSG.view.ackFailed)}${reason}` };
    }
  }

  private async overrideAck(handler: AlarmAckHandler, alarms: readonly Alarm[]): Promise<AckResult | null> {
    try {
      return await handler.acknowledge(alarms, { host: this });
    } catch (error) {
      const reason = error instanceof Error ? ` (${error.message})` : '';
      return { ok: false, error: `${localize(MSG.view.ackFailed)}${reason}` };
    }
  }
}

// Guarded registration: the kit is vendored into several self-contained page
// bundles that share one CustomElementRegistry per SPA session.
if (!customElements.get('wui-alarm-view')) {
  customElements.define('wui-alarm-view', WuiAlarmView);
}
