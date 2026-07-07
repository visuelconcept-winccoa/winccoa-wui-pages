// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Full report view ("rapport") for one charge: identity header, treatment recipe
 * table, the temperature curve (actual vs setpoint + tolerance band, read from
 * the furnace archives — synthesised when none is available), the cycle summary,
 * the quality-control results table and the conformity verdict. Offers print
 * (opens a self-contained printable document including the chart image) plus
 * edit / validate / reject actions.
 *
 * Emits: `wui:back`, `wui:edit` (`{ id }`) and `wui:status` (`{ id, target }`).
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { hasRole$ } from '@visuelconcept/wui-kit/data/app-security.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import {
  buildProfile,
  evaluateCycle,
  readActualCurve,
  recipeDurationMs,
  synthesizeActual,
  type CycleSummary,
  type ProfilePoint,
  type Sample
} from '../engine.js';
import { buildPrintHtml } from '../print.js';
import {
  CONFORMITY_COLORS,
  CONFORMITY_LABELS,
  QUENCH_LABELS,
  STATUS_COLORS,
  STATUS_LABELS,
  TREATMENT_LABELS,
  resultConform,
  type ReportStatus,
  type ThermalReport
} from '../types.js';
import { TtTempChart } from './tt-temp-chart.js';
import './tt-temp-chart.js';

const GOOD_BAND_PCT = 95;

/** Format an optional acceptance bound for display ("—" when unset). */
function fmtBound(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : '—';
}

@customElement('tt-report-detail')
export class TtReportDetail extends LitElement {
  static override readonly styles = [IXCoreStyles, detailStyles()];

  @property({ attribute: false }) report!: ThermalReport;

  @state() private profile: ProfilePoint[] = [];
  @state() private actual: Sample[] = [];
  @state() private summary: CycleSummary | null = null;
  @state() private simulated = false;
  @state() private curveLoading = false;

  /** Application-Security grant for the 'edit' role (open until assigned). */
  @state() private canEdit = true;

  private readonly api = this.resolveApi();
  private lastSig = '';
  private loadToken = 0;
  private roleSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.roleSub = hasRole$('thermal-reports', 'edit').subscribe((granted) => (this.canEdit = granted));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
    this.roleSub = new Subscription();
  }

  override render(): TemplateResult {
    const r = this.report;
    return html`
      ${this.renderToolbar()}
      <div class="sheet">
        ${this.renderHeader()}
        <h3 class="section">${localizeDir(MSG.detail.secRecipe)}</h3>
        ${this.renderRecipe()}
        <h3 class="section">${localizeDir(MSG.detail.secCurve)}</h3>
        ${this.renderCurve()}
        <h3 class="section">${localizeDir(MSG.detail.secQuality)}</h3>
        ${this.renderQuality()}
        ${this.renderConformity()}
        ${r.notes
          ? html`<h3 class="section">${localizeDir(MSG.detail.secNotes)}</h3><p class="notes">${r.notes}</p>`
          : nothing}
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (!changed.has('report') || !this.report) return;
    const r = this.report;
    const startMs = this.startMs();
    this.profile = startMs == null ? [] : buildProfile(r.steps, startMs);
    const sig = JSON.stringify({ s: r.steps, t: r.startTime, e: r.endTime, dp: r.tempDp });
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      void this.loadCurve();
    }
  }

  // --- rendering -------------------------------------------------------------

  private renderToolbar(): TemplateResult {
    const r = this.report;
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" @click=${this.back}>${localizeDir(MSG.detail.back)}</ix-button>
        <span class="title"
          >${r.reportNo || localize(MSG.detail.report)} — ${localizeDir(MSG.detail.charge)} ${r.charge || '—'}</span
        >
        <span class="grow"></span>
        <ix-button variant="secondary" @click=${this.print}>
          <ix-icon name="document" slot="icon"></ix-icon>${localizeDir(MSG.detail.print)}
        </ix-button>
        ${this.canEdit
          ? html`
              <ix-button variant="secondary" @click=${this.edit}>
                <ix-icon name="pen" slot="icon"></ix-icon>${localizeDir(MSG.detail.edit)}
              </ix-button>
              ${r.status === 'validated'
                ? nothing
                : html`
                    <ix-button variant="secondary" @click=${() => this.setStatus('rejected')}>
                      <ix-icon name="close" slot="icon"></ix-icon>${localizeDir(MSG.detail.reject)}
                    </ix-button>
                    <ix-button @click=${() => this.setStatus('validated')}>
                      <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.detail.validate)}
                    </ix-button>
                  `}
            `
          : nothing}
      </div>
    `;
  }

  private renderHeader(): TemplateResult {
    const r = this.report;
    const facts: { label: MultiLangString; value: string }[] = [
      { label: MSG.detail.fReportNo, value: r.reportNo || '—' },
      { label: MSG.detail.fCharge, value: r.charge || '—' },
      { label: MSG.detail.fOrder, value: r.orderNo || '—' },
      { label: MSG.detail.fPart, value: r.part || '—' },
      { label: MSG.detail.fMaterial, value: r.material || '—' },
      { label: MSG.detail.fQuantity, value: r.quantity ? String(r.quantity) : '—' },
      { label: MSG.detail.fTreatment, value: localize(TREATMENT_LABELS[r.treatment]) },
      { label: MSG.detail.fAtmosphere, value: r.atmosphere || '—' },
      { label: MSG.detail.fQuench, value: localize(QUENCH_LABELS[r.quench]) },
      { label: MSG.detail.fFurnace, value: r.machineName || '—' },
      { label: MSG.detail.fWorkshop, value: r.atelierName || '—' },
      { label: MSG.detail.fOperator, value: r.operator || '—' },
      { label: MSG.detail.fCycleStart, value: this.fmt(r.startTime) },
      { label: MSG.detail.fCycleEnd, value: this.fmt(r.endTime) }
    ];
    return html`
      <div class="report-head">
        <div class="report-head-top">
          <ix-typography format="h2">${localizeDir(MSG.detail.docTitle)}</ix-typography>
          <span class="chip solid" style="--c:${STATUS_COLORS[r.status]}">
            ${localizeDir(STATUS_LABELS[r.status])}
          </span>
        </div>
        <div class="facts">
          ${facts.map(
            (f) => html`<div class="fact">
              <span class="fact-label">${localizeDir(f.label)}</span>
              <span class="fact-value">${f.value}</span>
            </div>`
          )}
        </div>
        ${r.validatedBy
          ? html`<div class="validation">
              ${localizeDir(MSG.detail.validatedBy)} <strong>${r.validatedBy}</strong
              >${r.validatedAt ? html` ${localizeDir(MSG.detail.validatedOn)} ${this.fmt(r.validatedAt)}` : ''}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderRecipe(): TemplateResult {
    const r = this.report;
    if (r.steps.length === 0) return html`<p class="muted">${localizeDir(MSG.detail.noStep)}</p>`;
    const totalMin = Math.round(recipeDurationMs(r.steps) / 60_000);
    return html`
      <table class="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>${localizeDir(MSG.detail.colStep)}</th>
            <th>${localizeDir(MSG.detail.colSetpoint)}</th>
            <th>${localizeDir(MSG.detail.colDuration)}</th>
            <th>${localizeDir(MSG.detail.colTolerance)}</th>
            <th>${localizeDir(MSG.detail.colAtmosphere)}</th>
          </tr>
        </thead>
        <tbody>
          ${r.steps.map(
            (s, i) => html`<tr>
              <td class="mono">${i + 1}</td>
              <td>${s.label || '—'}</td>
              <td class="mono">${s.setpoint}</td>
              <td class="mono">${s.durationMin}</td>
              <td class="mono">−${Math.abs(s.tolMinus)} / +${Math.abs(s.tolPlus)}</td>
              <td>${s.atmosphere || '—'}</td>
            </tr>`
          )}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3"></td>
            <td class="mono strong">${totalMin}</td>
            <td colspan="2" class="muted">${localizeDir(MSG.detail.totalDuration)}</td>
          </tr>
        </tfoot>
      </table>
    `;
  }

  private renderCurve(): TemplateResult {
    if (this.startMs() == null || this.report.steps.length === 0) {
      return html`<p class="muted">${localizeDir(MSG.detail.curveHint)}</p>`;
    }
    return html`
      ${this.simulated
        ? html`<div class="notice">
            <ix-icon name="info"></ix-icon>${localizeDir(MSG.detail.simulatedPre)}
            <code>${this.report.tempDp || localize(MSG.detail.noDatapoint)}</code> ${localizeDir(MSG.detail.simulatedPost)}
          </div>`
        : nothing}
      ${this.curveLoading ? html`<div class="loading"><ix-spinner></ix-spinner></div>` : nothing}
      <tt-temp-chart .actual=${this.actual} .profile=${this.profile}></tt-temp-chart>
      ${this.summary ? this.renderSummary(this.summary) : nothing}
    `;
  }

  private renderSummary(s: CycleSummary): TemplateResult {
    const good = s.inBandPct >= GOOD_BAND_PCT;
    return html`
      <div class="summary">
        <div class="metric" style="--c:${good ? CONFORMITY_COLORS.conform : CONFORMITY_COLORS.nonconform}">
          <span class="metric-value">${s.inBandPct}%</span>
          <span class="metric-label">${localizeDir(MSG.detail.inTolerance)}</span>
        </div>
        <div class="metric">
          <span class="metric-value">${s.maxDeviation} °C</span>
          <span class="metric-label">${localizeDir(MSG.detail.maxDeviation)}</span>
        </div>
        <div class="metric">
          <span class="metric-value">${s.minTemp} / ${s.maxTemp} °C</span>
          <span class="metric-label">${localizeDir(MSG.detail.minMax)}</span>
        </div>
      </div>
    `;
  }

  private renderQuality(): TemplateResult {
    const r = this.report;
    if (r.results.length === 0) return html`<p class="muted">${localizeDir(MSG.detail.noResult)}</p>`;
    return html`
      <table class="tbl">
        <thead>
          <tr>
            <th>${localizeDir(MSG.detail.colControl)}</th>
            <th>${localizeDir(MSG.detail.colValue)}</th>
            <th>${localizeDir(MSG.detail.colMin)}</th>
            <th>${localizeDir(MSG.detail.colMax)}</th>
            <th>${localizeDir(MSG.detail.colVerdict)}</th>
          </tr>
        </thead>
        <tbody>
          ${r.results.map((res) => this.renderResultRow(res))}
        </tbody>
      </table>
    `;
  }

  private renderResultRow(res: ThermalReport['results'][number]): TemplateResult {
    const ok = resultConform(res);
    const verdict =
      ok === null
        ? html`<span class="muted">—</span>`
        : html`<span class="chip" style="--c:${ok ? CONFORMITY_COLORS.conform : CONFORMITY_COLORS.nonconform}"
            >${ok ? localizeDir(MSG.detail.ok) : localizeDir(MSG.detail.outOfTolerance)}</span
          >`;
    return html`<tr>
      <td>${res.label || '—'}</td>
      <td class="mono strong">${res.value} ${res.unit}</td>
      <td class="mono">${fmtBound(res.min)}</td>
      <td class="mono">${fmtBound(res.max)}</td>
      <td>${verdict}</td>
    </tr>`;
  }

  private renderConformity(): TemplateResult {
    const r = this.report;
    return html`
      <div class="verdict" style="--c:${CONFORMITY_COLORS[r.conformity]}">
        <span class="verdict-label">${localizeDir(MSG.detail.chargeConformity)}</span>
        <span class="verdict-value">${localizeDir(CONFORMITY_LABELS[r.conformity])}</span>
      </div>
    `;
  }

  // --- data ------------------------------------------------------------------

  private startMs(): number | null {
    const t = new Date(this.report.startTime).getTime();
    return Number.isFinite(t) ? t : null;
  }

  private async loadCurve(): Promise<void> {
    const r = this.report;
    const startMs = this.startMs();
    if (startMs == null || r.steps.length === 0) {
      this.actual = [];
      this.summary = null;
      this.simulated = false;
      return;
    }
    const token = ++this.loadToken;
    this.curveLoading = true;
    const start = new Date(startMs);
    const endMs = new Date(r.endTime).getTime();
    const end = new Date(Number.isFinite(endMs) ? endMs : startMs + recipeDurationMs(r.steps));
    const samples = await readActualCurve(this.api, r.tempDp, start, end);
    if (token !== this.loadToken) return;
    if (samples.length > 0) {
      this.actual = samples;
      this.simulated = false;
    } else {
      this.actual = synthesizeActual(r.steps, startMs);
      this.simulated = true;
    }
    this.summary = evaluateCycle(this.actual, r.steps, startMs);
    this.curveLoading = false;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  // --- actions ---------------------------------------------------------------

  private fmt(value: string): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : d.toLocaleString('fr-FR');
  }

  private back(): void {
    this.dispatchEvent(new CustomEvent('wui:back', { bubbles: true, composed: true }));
  }

  private edit(): void {
    this.dispatchEvent(
      new CustomEvent('wui:edit', { detail: { id: this.report.id }, bubbles: true, composed: true })
    );
  }

  private setStatus(target: ReportStatus): void {
    this.dispatchEvent(
      new CustomEvent('wui:status', {
        detail: { id: this.report.id, target },
        bubbles: true,
        composed: true
      })
    );
  }

  private print(): void {
    const chart = this.renderRoot.querySelector<TtTempChart>('tt-temp-chart');
    const image = chart?.getImageDataUrl() ?? '';
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) return;
    win.document.write(buildPrintHtml(this.report, this.summary, this.simulated, image));
    // The printed document triggers window.print() itself, once the chart image
    // has decoded (see PRINT_SCRIPT) — printing here would race the image load.
    win.document.close();
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function detailStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding-bottom: 0.75rem;
    }
    .toolbar .title {
      font-weight: 600;
      font-size: 1rem;
    }
    .grow {
      flex: 1;
    }
    .sheet {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 0.25rem;
    }
    .section {
      margin: 1.25rem 0 0.5rem;
      font-size: 1rem;
      color: var(--theme-color-soft-text);
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      padding-bottom: 0.25rem;
    }
    .report-head {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 1rem;
      background: var(--theme-color-2);
    }
    .report-head-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.5rem 1rem;
    }
    .fact {
      display: flex;
      flex-direction: column;
    }
    .fact-label {
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
    }
    .fact-value {
      font-size: 0.9rem;
      font-weight: 600;
    }
    .validation {
      margin-top: 0.75rem;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .tbl {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    .tbl th,
    .tbl td {
      border: 1px solid var(--theme-color-soft-bdr);
      padding: 0.35rem 0.55rem;
      text-align: left;
    }
    .tbl thead th {
      background: var(--theme-color-2);
      color: var(--theme-color-soft-text);
      font-weight: 600;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
    }
    .strong {
      font-weight: 700;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .chip {
      display: inline-block;
      font-size: 0.75rem;
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
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-warning);
      color: var(--theme-color-warning);
      background: color-mix(in srgb, var(--theme-color-warning) 12%, transparent);
      font-size: 0.85rem;
    }
    .notice code {
      font-family: var(--theme-font-mono, monospace);
    }
    .loading {
      display: flex;
      justify-content: center;
      padding: 1rem;
    }
    .summary {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      margin-top: 0.75rem;
    }
    .metric {
      flex: 1 1 0;
      min-width: 8rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      padding: 0.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-top: 3px solid var(--c, var(--theme-color-soft-bdr));
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
    }
    .metric-value {
      font-size: 1.3rem;
      font-weight: 700;
      color: var(--c, var(--theme-color-std-text));
    }
    .metric-label {
      font-size: 0.78rem;
      color: var(--theme-color-soft-text);
    }
    .verdict {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 1rem;
      padding: 0.75rem 1rem;
      border: 1px solid var(--c);
      border-left: 5px solid var(--c);
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--c) 10%, transparent);
    }
    .verdict-value {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--c);
    }
    .notes {
      white-space: pre-wrap;
      font-size: 0.9rem;
    }
  `;
}
