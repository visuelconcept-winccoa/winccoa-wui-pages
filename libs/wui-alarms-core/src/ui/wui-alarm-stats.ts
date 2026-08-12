// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm statistics banner: the unacknowledged counter, the configured ranges
 * (which double as the range filter), the last alarm in clear, the EEMUA-191
 * flood histogram and the bad-actor top.
 *
 * The chips are built from the PROJECT's ranges — their label, their colour and
 * even how many there are come from the configuration datapoint, not from this
 * file. The histogram's caption is likewise derived from the histogram it is
 * given: it claims "per 10 minutes / last 3 hours" only when that is what the
 * bars actually are, because an archived period is bucketed to fit the period.
 *
 * `compact` collapses everything to a single strip (ranges + last alarm) for an
 * embedded panel.
 */
import { localizeDate } from '@wincc-oa/wui-i18n-shared/localize-date.js';
import { DatetimeFormat } from '@wincc-oa/wui-models/enums/wui-i18n/datetime-format.js';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir, perBucketMsg } from '../i18n.js';
import {
  DEFAULT_RANGES,
  type ActorGrouping,
  type AlarmCounters,
  type AlarmHistogram,
  type AlarmRange,
  type BadActor,
  type HistogramBucket
} from '../types.js';
import { rangeAbbr, rangeColor, severityTokens } from './alarm-tokens.js';
import { alarmStatsStyles } from './wui-alarm-stats.styles.js';

/** Head-room above the EEMUA threshold so the dashed line is never on the edge. */
const HISTOGRAM_HEADROOM = 2;
const CLOCK_CHARS = 5;

/** A theme token resolved against the host — the canvas cannot use `var()`. */
function cssToken(host: Element, name: string): string {
  return getComputedStyle(host).getPropertyValue(name).trim();
}

/** `HH:mm` for a histogram axis label. */
function clockLabel(ms: number): string {
  return localizeDate(new Date(ms), undefined, DatetimeFormat.TimeWithSeconds).slice(0, CLOCK_CHARS);
}

export class WuiAlarmStats extends LitElement {
  static override readonly styles = [severityTokens(), alarmStatsStyles()];

  @property({ attribute: false }) counters: AlarmCounters | null = null;
  @property({ attribute: false }) histogram: AlarmHistogram | null = null;
  @property({ attribute: false }) actors: readonly BadActor[] = [];
  /** The project's priority ranges — one chip each, in configured order. */
  @property({ attribute: false }) ranges: readonly AlarmRange[] = DEFAULT_RANGES;
  /** Ranks currently kept by the range filter; empty = all. */
  @property({ attribute: false }) selected: readonly number[] = [];
  @property() grouping: ActorGrouping = 'text';
  /** What the histogram and the actor top span, in clear. */
  @property({ attribute: 'window-label' }) windowLabel = '';
  /** Single-strip variant for an embedded panel. */
  @property({ type: Boolean, reflect: true }) compact = false;

  /** Hovered bar, as CSS pixels inside the chart plus the bucket under the cursor. */
  @state() private tip: { x: number; y: number; bucket: HistogramBucket } | null = null;

  /** Bar geometry of the last paint — how a pointer position maps back to a bucket. */
  private geometry: { padLeft: number; barWidth: number; ratio: number } | null = null;

  override render(): TemplateResult {
    if (this.compact) {
      return html`<div class="banner">${this.renderRanges()} ${this.renderLast()}</div>`;
    }
    return html`
      <div class="banner">
        ${this.renderUnack()}
        <div class="card mid">${this.renderRanges()} ${this.renderLast()}</div>
        ${this.renderHistogram()} ${this.actors.length === 0 ? nothing : this.renderActors()}
      </div>
    `;
  }

  protected override updated(_changed: PropertyValues): void {
    this.drawHistogram();
  }

  private renderUnack(): TemplateResult {
    const counters = this.counters;
    return html`
      <div class="card unack">
        <div class="title">${localizeDir(MSG.counters.unacknowledged)}</div>
        <b>${counters?.unacknowledged ?? '—'}</b>
        <div class="hint">${localizeDir(MSG.counters.goalZero)}</div>
        <div class="hint" style="margin-top:0.25rem">${localizeDir(MSG.counters.goalHint)}</div>
      </div>
    `;
  }

  /** One chip per configured range: its label, its colour, its tally. */
  private renderRanges(): TemplateResult {
    const counters = this.counters;
    return html`
      <div class="row">
        ${this.ranges.map((range, index) => this.renderRangeChip(range, index + 1, counters))}
        ${counters === null || counters.cleared === 0
          ? nothing
          : html`<span class="muted mono">${counters.cleared} ${localizeDir(MSG.counters.cleared)}</span>`}
      </div>
    `;
  }

  private renderRangeChip(range: AlarmRange, rank: number, counters: AlarmCounters | null): TemplateResult {
    const total = counters?.byRank[rank] ?? 0;
    const acked = counters?.ackedByRank[rank] ?? 0;
    return html`<button
      class="band"
      aria-pressed=${this.selected.includes(rank) ? 'true' : 'false'}
      title=${`${localize(MSG.counters.fromPrior)} ${range.minPrior}`}
      @click=${() => this.toggleRank(rank)}
    >
      <span class="pill" style=${`background:${rangeColor(rank, this.ranges)}`}>${rangeAbbr(rank, this.ranges)}</span>
      <span class="n">${total}</span>
      ${acked === 0 ? nothing : html`<span class="ack">(${acked} ${localize(MSG.counters.acked)})</span>`}
    </button>`;
  }

  private renderLast(): TemplateResult | typeof nothing {
    const last = this.counters?.last;
    if (!last) return nothing;
    return html`
      <div class="last">
        <span class="pill" style=${`background:${rangeColor(last.rank, this.ranges)}`}>
          ${last.abbr || rangeAbbr(last.rank, this.ranges)}
        </span>
        <span class="mono muted">${localizeDate(new Date(last.raised), undefined, DatetimeFormat.TimeWithSeconds)}</span>
        <b class="ell">${last.text || last.dpe}</b>
        <span class="mono muted ell">${last.dpe}</span>
      </div>
    `;
  }

  /**
   * The flood histogram. Its title states the ACTUAL bucket and its caption the
   * actual window — over an archived period both are the period's, not the live
   * view's ten minutes over three hours.
   */
  private renderHistogram(): TemplateResult {
    return html`
      <div class="card">
        <div class="row">
          <span class="title grow">${perBucketMsg(this.histogram?.bucketMs ?? 0)}</span>
          <span class="hint">${this.windowLabel}</span>
        </div>
        <div class="chart">
          <canvas
            @pointermove=${(event: PointerEvent) => this.onHover(event)}
            @pointerleave=${() => (this.tip = null)}
          ></canvas>
          ${this.renderTip()}
        </div>
        <div class="hint">${localizeDir(MSG.histogram.eemua)}</div>
      </div>
    `;
  }

  /** Count under the cursor: the bar alone cannot be read against the scale. */
  private renderTip(): TemplateResult | typeof nothing {
    const tip = this.tip;
    const bucketMs = this.histogram?.bucketMs ?? 0;
    if (tip === null) return nothing;
    const to = clockLabel(tip.bucket.from + bucketMs);
    return html`<div class="tip" style=${`left:${tip.x}px;top:${tip.y}px`}>
      <b>${tip.bucket.count}</b> ${localizeDir(MSG.histogram.alarms)}
      <div class="tip-when mono">${clockLabel(tip.bucket.from)} – ${to}</div>
      ${tip.bucket.overThreshold
        ? html`<div class="tip-over">${localizeDir(MSG.histogram.over)}</div>`
        : nothing}
    </div>`;
  }

  private onHover(event: PointerEvent): void {
    const histogram = this.histogram;
    const geometry = this.geometry;
    const canvas = event.currentTarget as HTMLCanvasElement;
    if (!histogram || !geometry) return;
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const index = Math.floor((x * geometry.ratio - geometry.padLeft) / geometry.barWidth);
    const bucket = histogram.buckets[index];
    if (!bucket) {
      this.tip = null;
      return;
    }
    this.tip = { x, y: event.clientY - bounds.top, bucket };
  }

  private renderActors(): TemplateResult {
    return html`
      <div class="card actors-card">
        <div class="row">
          <button class="tab" aria-current=${this.grouping === 'text' ? 'true' : 'false'} @click=${() => this.emitGrouping('text')}>
            ${localizeDir(MSG.actors.byText)}
          </button>
          <button class="tab" aria-current=${this.grouping === 'dp' ? 'true' : 'false'} @click=${() => this.emitGrouping('dp')}>
            ${localizeDir(MSG.actors.byDp)}
          </button>
          <span class="grow"></span>
          <span class="hint">${this.windowLabel}</span>
        </div>
        <div class="hint" style="margin-bottom:0.375rem">${localizeDir(MSG.actors.hint)}</div>
        <div class="actors">${this.actors.map((actor) => this.renderActor(actor))}</div>
      </div>
    `;
  }

  private renderActor(actor: BadActor): TemplateResult {
    return html`<div class="actor">
      <span class="pill" style=${`background:${rangeColor(actor.rank, this.ranges)}`}>
        ${rangeAbbr(actor.rank, this.ranges)}
      </span>
      <span style="min-width:0">
        <div class="ell" title=${actor.label}>${actor.label}</div>
        <div class="sub ell" title=${actor.sublabel}>${actor.sublabel}</div>
      </span>
      <span class="n">${actor.count}</span>
    </div>`;
  }

  private toggleRank(rank: number): void {
    const next = this.selected.includes(rank)
      ? this.selected.filter((value) => value !== rank)
      : [...this.selected, rank];
    this.dispatchEvent(new CustomEvent('wui:ranks', { detail: [...next].sort(), bubbles: true, composed: true }));
  }

  private emitGrouping(grouping: ActorGrouping): void {
    this.dispatchEvent(new CustomEvent('wui:grouping', { detail: grouping, bubbles: true, composed: true }));
  }

  private drawHistogram(): void {
    const canvas = this.renderRoot.querySelector('canvas');
    const histogram = this.histogram;
    if (!canvas || !histogram || histogram.buckets.length === 0) return;
    const ratio = globalThis.devicePixelRatio ?? 1;
    const width = (canvas.width = canvas.clientWidth * ratio);
    const height = (canvas.height = canvas.clientHeight * ratio);
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    this.paint(context, histogram, { width, height, ratio });
  }

  private paint(
    context: CanvasRenderingContext2D,
    histogram: AlarmHistogram,
    box: { width: number; height: number; ratio: number }
  ): void {
    const { width, height, ratio } = box;
    const pad = { left: 20 * ratio, right: 2 * ratio, top: 4 * ratio, bottom: 12 * ratio };
    const max = Math.max(histogram.threshold + HISTOGRAM_HEADROOM, ...histogram.buckets.map((bucket) => bucket.count));
    const plot = height - pad.top - pad.bottom;
    const barWidth = (width - pad.left - pad.right) / histogram.buckets.length;
    this.geometry = { padLeft: pad.left, barWidth, ratio };

    context.fillStyle = cssToken(this, '--theme-color-soft-text');
    context.font = `${9 * ratio}px ui-monospace, monospace`;
    context.fillText(String(max), 2 * ratio, pad.top + 7 * ratio);

    // A bucket over the operator-load ceiling is drawn in the most urgent range's
    // own colour, so "too many alarms" reads in the project's own scale.
    const over = this.ranges[0]?.color || cssToken(this, '--theme-color-alarm');
    for (const [index, bucket] of histogram.buckets.entries()) {
      const barHeight = (bucket.count / max) * plot;
      context.fillStyle = bucket.overThreshold ? over : cssToken(this, '--theme-color-primary');
      context.fillRect(
        pad.left + index * barWidth + ratio,
        height - pad.bottom - barHeight,
        Math.max(1, barWidth - 2 * ratio),
        barHeight
      );
    }

    const thresholdY = height - pad.bottom - (histogram.threshold / max) * plot;
    context.setLineDash([3 * ratio, 3 * ratio]);
    context.strokeStyle = cssToken(this, '--theme-color-warning');
    context.beginPath();
    context.moveTo(pad.left, thresholdY);
    context.lineTo(width - pad.right, thresholdY);
    context.stroke();
    context.setLineDash([]);

    const first = histogram.buckets[0];
    const last = histogram.buckets.at(-1);
    if (!first || !last) return;
    context.fillStyle = cssToken(this, '--theme-color-soft-text');
    context.fillText(clockLabel(first.from), pad.left, height - 2 * ratio);
    context.fillText(clockLabel(last.from), width - 32 * ratio, height - 2 * ratio);
  }
}

// Guarded registration: the kit is vendored into several self-contained page
// bundles that share one CustomElementRegistry per SPA session.
if (!customElements.get('wui-alarm-stats')) {
  customElements.define('wui-alarm-stats', WuiAlarmStats);
}
