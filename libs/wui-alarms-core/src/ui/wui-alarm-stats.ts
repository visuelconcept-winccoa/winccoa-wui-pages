// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm statistics banner: the unacknowledged counter, the severity bands
 * (which double as the priority filter), the last alarm in clear, the EEMUA-191
 * flood histogram and the bad-actor top.
 *
 * `compact` collapses it to a single strip (bands + unacknowledged + last alarm)
 * for an embedded panel — the numbers an operator glances at, without the two
 * analysis blocks that need room to be readable.
 */
import { localizeDate } from '@wincc-oa/wui-i18n-shared/localize-date.js';
import { DatetimeFormat } from '@wincc-oa/wui-models/enums/wui-i18n/datetime-format.js';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { SEVERITIES, type ActorGrouping, type AlarmCounters, type AlarmHistogram, type BadActor, type Severity } from '../types.js';
import { alarmColor, severityTokens } from './alarm-tokens.js';
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
  @property({ attribute: false }) selected: readonly Severity[] = [];
  @property() grouping: ActorGrouping = 'text';
  /** Single-strip variant for an embedded panel. */
  @property({ type: Boolean, reflect: true }) compact = false;

  override render(): TemplateResult {
    if (this.compact) {
      return html`<div class="banner">
        ${this.renderBands()} ${this.renderLast()}
      </div>`;
    }
    return html`
      <div class="banner">
        ${this.renderUnack()}
        <div class="card mid">${this.renderBands()} ${this.renderLast()}</div>
        ${this.renderHistogram()}
      </div>
      ${this.actors.length === 0 ? nothing : this.renderActors()}
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

  private renderBands(): TemplateResult {
    const counters = this.counters;
    return html`
      <div class="row">
        ${SEVERITIES.map((severity) => {
          const total = counters?.bySeverity[severity] ?? 0;
          const acked = counters?.ackedBySeverity[severity] ?? 0;
          return html`<button
            class="band"
            aria-pressed=${this.selected.includes(severity) ? 'true' : 'false'}
            @click=${() => this.toggleBand(severity)}
          >
            <span class="pill sev-${severity}">P${severity}</span>
            <span class="n">${total}</span>
            ${acked === 0 ? nothing : html`<span class="ack">(${acked} ${localize(MSG.counters.acked)})</span>`}
          </button>`;
        })}
        ${counters === null || counters.cleared === 0
          ? nothing
          : html`<span class="muted mono">${counters.cleared} ${localizeDir(MSG.counters.cleared)}</span>`}
      </div>
    `;
  }

  private renderLast(): TemplateResult | typeof nothing {
    const last = this.counters?.last;
    if (!last) return nothing;
    return html`
      <div class="last">
        <span class="pill" style=${`background:${alarmColor(last)}`}>${last.abbr || `P${last.severity}`}</span>
        <span class="mono muted">${localizeDate(new Date(last.raised), undefined, DatetimeFormat.TimeWithSeconds)}</span>
        <b class="ell">${last.text || last.dpe}</b>
        <span class="mono muted ell">${last.dpe}</span>
      </div>
    `;
  }

  private renderHistogram(): TemplateResult {
    return html`
      <div class="card">
        <div class="row">
          <span class="title grow">${localizeDir(MSG.histogram.title)}</span>
          <span class="hint">${localizeDir(MSG.histogram.window)}</span>
        </div>
        <canvas></canvas>
        <div class="hint">${localizeDir(MSG.histogram.eemua)}</div>
      </div>
    `;
  }

  private renderActors(): TemplateResult {
    return html`
      <div class="card" style="margin-top:0.625rem">
        <div class="row">
          <button
            class="tab"
            aria-current=${this.grouping === 'text' ? 'true' : 'false'}
            @click=${() => this.emitGrouping('text')}
          >
            ${localizeDir(MSG.actors.byText)}
          </button>
          <button class="tab" aria-current=${this.grouping === 'dp' ? 'true' : 'false'} @click=${() => this.emitGrouping('dp')}>
            ${localizeDir(MSG.actors.byDp)}
          </button>
        </div>
        <div class="hint" style="margin-bottom:0.375rem">${localizeDir(MSG.actors.hint)}</div>
        <div class="actors">
          ${this.actors.map(
            (actor) => html`<div class="actor">
              <span class="pill" style=${`background:${alarmColor(actor)}`}>P${actor.severity}</span>
              <span style="min-width:0">
                <div class="ell" title=${actor.label}>${actor.label}</div>
                <div class="sub ell" title=${actor.sublabel}>${actor.sublabel}</div>
              </span>
              <span class="n">${actor.count}</span>
            </div>`
          )}
        </div>
      </div>
    `;
  }

  private toggleBand(severity: Severity): void {
    const next = this.selected.includes(severity)
      ? this.selected.filter((value) => value !== severity)
      : [...this.selected, severity];
    this.dispatchEvent(new CustomEvent('wui:bands', { detail: [...next].sort(), bubbles: true, composed: true }));
  }

  private emitGrouping(grouping: ActorGrouping): void {
    this.dispatchEvent(new CustomEvent('wui:grouping', { detail: grouping, bubbles: true, composed: true }));
  }

  /** The flood histogram, with the EEMUA threshold drawn as a dashed line. */
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

    context.fillStyle = cssToken(this, '--theme-color-soft-text');
    context.font = `${9 * ratio}px ui-monospace, monospace`;
    context.fillText(String(max), 2 * ratio, pad.top + 7 * ratio);

    for (const [index, bucket] of histogram.buckets.entries()) {
      const barHeight = (bucket.count / max) * plot;
      context.fillStyle = bucket.overThreshold ? cssToken(this, '--wui-alarm-severity-1') : cssToken(this, '--theme-color-primary');
      context.fillRect(pad.left + index * barWidth + ratio, height - pad.bottom - barHeight, Math.max(1, barWidth - 2 * ratio), barHeight);
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
