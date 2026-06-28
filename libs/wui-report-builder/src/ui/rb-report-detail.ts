// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Report instance view/editor: fill each section's data (text/comment, key-value
 * fields with conformity, manual table, datapoint dataset aggregations + chart,
 * checklist), drive the configurable workflow (sign & advance / reject) with the
 * connected user recorded on each signature, and print. A final state locks the
 * report read-only. Emits `wui:back` and `wui:save` (the edited {@link Report}).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { container } from 'tsyringe';
import './rb-dataset-chart.js';
import './rb-signature-dialog.js';
import { buildPrintHtml } from '../print.js';
import {
  applyReject,
  applySignature,
  canAdvance,
  computeDataset,
  currentState,
  isLocked
} from '../engine.js';
import { AGG_LABELS, fieldConform, type Report, type SectionData, type TemplateSection } from '../types.js';
import type { RbDatasetChart } from './rb-dataset-chart.js';

interface IxCheckedEvent {
  detail: boolean;
}

function inputType(t: string): string {
  if (t === 'number') return 'number';
  if (t === 'date') return 'date';
  return 'text';
}

@customElement('rb-report-detail')
export class RbReportDetail extends LitElement {
  static override readonly styles = [IXCoreStyles, detailStyles()];

  @property({ attribute: false }) report!: Report;
  @property({ type: Boolean }) canPublish = false;
  @property() signerName = '';
  @property() signerId = '';

  @state() private working!: Report;
  @state() private signOpen = false;

  private readonly api = this.resolveApi();

  // eslint-disable-next-line max-lines-per-function -- single view template
  override render(): TemplateResult {
    if (!this.working) return html``;
    const locked = isLocked(this.working);
    const state = currentState(this.working);
    return html`
      <div class="wrap">
        <div class="toolbar">
          <ix-icon-button ghost icon="arrow-left" title="Retour" @click=${this.back}></ix-icon-button>
          <div class="titles">
            <div class="rep-no">${this.working.reportNo || '(sans n°)'}</div>
            <div class="rep-title">${this.working.title}</div>
          </div>
          <span class="chip solid" style="--c:${state?.color ?? '#888'}">${state?.label ?? '—'}</span>
          <span class="grow"></span>
          <ix-button variant="secondary" ?disabled=${locked} @click=${this.save}>
            <ix-icon name="floppy-disk" slot="icon"></ix-icon>Enregistrer
          </ix-button>
          <ix-button variant="secondary" @click=${this.print}>
            <ix-icon name="print" slot="icon"></ix-icon>Imprimer
          </ix-button>
        </div>

        <div class="sheet">
          ${this.renderHeader(locked)} ${this.renderWorkflow(locked)}
          ${this.working.sections.map((s) => this.renderSection(s, locked))}
          ${this.renderSignatures()}
        </div>
      </div>
      ${this.signOpen && state?.advance
        ? html`<rb-signature-dialog
            .signOff=${state.advance}
            signerName=${this.signerName}
            @wui:sign=${(e: CustomEvent<{ comment: string }>) => this.confirmSign(e.detail.comment)}
            @wui:cancel=${() => (this.signOpen = false)}
          ></rb-signature-dialog>`
        : ''}
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('report') && this.report && this.working?.id !== this.report.id) {
      this.working = structuredClone(this.report);
    }
  }

  private renderHeader(locked: boolean): TemplateResult {
    return html`
      <div class="head-card">
        <div class="grid3">
          <div class="kv"><span class="k">Modèle</span><span>${this.working.templateName || '—'}</span></div>
          <div class="kv"><span class="k">Objet</span><span>${this.working.subject || '—'}</span></div>
          <div class="kv"><span class="k">Créé le</span><span>${this.working.createdAt || '—'}</span></div>
        </div>
        <div class="grid2" style="margin-top:0.5rem">
          <div class="field">
            <label>Période — début</label>
            <input type="datetime-local" ?disabled=${locked} .value=${this.working.period.start} @change=${(e: Event) => this.patchPeriod('start', (e.target as HTMLInputElement).value)} />
          </div>
          <div class="field">
            <label>Période — fin</label>
            <input type="datetime-local" ?disabled=${locked} .value=${this.working.period.end} @change=${(e: Event) => this.patchPeriod('end', (e.target as HTMLInputElement).value)} />
          </div>
        </div>
      </div>
    `;
  }

  // --- workflow --------------------------------------------------------------

  private renderWorkflow(locked: boolean): TemplateResult {
    const state = currentState(this.working);
    if (!state) return html``;
    const check = canAdvance(this.working, this.canPublish);
    return html`
      <div class="wf-bar">
        ${state.advance
          ? html`<ix-button ?disabled=${!check.ok} title=${check.ok ? '' : check.reason} @click=${() => (this.signOpen = true)}>
              <ix-icon name="pen" slot="icon"></ix-icon>${state.advance.actionLabel}
            </ix-button>`
          : html`${locked ? html`<span class="locked-note"><ix-icon name="lock-closed"></ix-icon>Rapport verrouillé (état final)</span>` : ''}`}
        ${state.reject
          ? html`<ix-button variant="secondary" @click=${this.reject}>
              <ix-icon name="undo" slot="icon"></ix-icon>${state.reject.actionLabel}
            </ix-button>`
          : ''}
        ${state.advance && !check.ok ? html`<span class="wf-reason">${check.reason}</span>` : ''}
      </div>
    `;
  }

  // --- sections --------------------------------------------------------------

  private renderSection(section: TemplateSection, locked: boolean): TemplateResult {
    return html`
      <div class="section">
        <div class="section-title">${section.title}</div>
        ${this.renderSectionBody(section, locked)}
      </div>
    `;
  }

  private renderSectionBody(section: TemplateSection, locked: boolean): TemplateResult {
    const data = this.working.data[section.id] ?? {};
    switch (section.kind) {
      case 'text':
      case 'comment': {
        return html`<textarea
          class="ta"
          rows="3"
          ?disabled=${locked}
          placeholder=${section.placeholder ?? ''}
          .value=${data.content ?? ''}
          @input=${(e: Event) => this.mutate(section.id, (d) => ({ ...d, content: (e.target as HTMLTextAreaElement).value }))}
        ></textarea>`;
      }
      case 'fields': {
        return this.renderFields(section, data, locked);
      }
      case 'table': {
        return this.renderTable(section, data, locked);
      }
      case 'dataset': {
        return this.renderDataset(section, data, locked);
      }
      case 'checklist': {
        return this.renderChecklist(section, data, locked);
      }
      default: {
        return html``;
      }
    }
  }

  private renderFields(section: TemplateSection, data: SectionData, locked: boolean): TemplateResult {
    const values = data.values ?? {};
    return html`<div class="fields">
      ${(section.fields ?? []).map((f) => {
        const v = values[f.id] ?? '';
        const conform = fieldConform(f, v);
        return html`<div class="field">
          <label>${f.label}${f.unit ? html` <span class="unit">(${f.unit})</span>` : ''}</label>
          <div class="field-row">
            <input
              class="inp"
              type=${inputType(f.type)}
              ?disabled=${locked}
              .value=${v}
              @input=${(e: Event) => this.setFieldValue(section.id, f.id, (e.target as HTMLInputElement).value)}
            />
            ${conform === null ? '' : html`<span class="chip ${conform ? 'ok' : 'bad'}">${conform ? 'OK' : 'Hors tolérance'}</span>`}
          </div>
        </div>`;
      })}
    </div>`;
  }

  private renderTable(section: TemplateSection, data: SectionData, locked: boolean): TemplateResult {
    const cols = section.columns ?? [];
    const rows = data.rows ?? [];
    return html`
      <table class="data-table">
        <thead>
          <tr>
            ${cols.map((c) => html`<th>${c.label}</th>`)}<th class="act"></th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(
            (row, ri) => html`<tr>
              ${cols.map(
                (c) => html`<td>
                  <input
                    class="inp"
                    type=${inputType(c.type)}
                    ?disabled=${locked}
                    .value=${row[c.id] ?? ''}
                    @input=${(e: Event) => this.setCell(section.id, ri, c.id, (e.target as HTMLInputElement).value)}
                  />
                </td>`
              )}
              <td class="act">
                <ix-icon-button ghost size="16" icon="trashcan" ?disabled=${locked} @click=${() => this.removeRow(section.id, ri)}></ix-icon-button>
              </td>
            </tr>`
          )}
        </tbody>
      </table>
      <ix-button variant="secondary" ?disabled=${locked} @click=${() => this.addRow(section.id)}>
        <ix-icon name="plus" slot="icon"></ix-icon>Ajouter une ligne
      </ix-button>
    `;
  }

  private renderDataset(section: TemplateSection, data: SectionData, locked: boolean): TemplateResult {
    const datasets = section.datasets ?? [];
    const results = data.results ?? {};
    return html`
      <div class="ds-actions">
        <ix-button variant="secondary" ?disabled=${locked} @click=${() => this.recompute(section)}>
          <ix-icon name="refresh" slot="icon"></ix-icon>Actualiser les données
        </ix-button>
      </div>
      <table class="data-table">
        <thead>
          <tr><th>Mesure</th><th>Indicateurs</th><th>Points</th><th>Calculé le</th></tr>
        </thead>
        <tbody>
          ${datasets.map((d) => {
            const res = results[d.id];
            return html`<tr>
              <td><div class="strong">${d.label}</div><div class="muted mono">${d.dp || '—'}</div></td>
              <td>
                ${res
                  ? d.ops.map((op) => html`<span class="agg"><span class="k">${AGG_LABELS[op]}</span> ${res.agg[op] ?? '—'}</span>`)
                  : html`<span class="muted">— (cliquez « Actualiser »)</span>`}
              </td>
              <td>${res?.n ?? '—'}</td>
              <td class="mono">${res ? this.fmtIso(res.computedAt) : '—'}</td>
            </tr>`;
          })}
        </tbody>
      </table>
      ${section.chart === false
        ? ''
        : html`<rb-dataset-chart .datasets=${datasets} start=${this.working.period.start} end=${this.working.period.end}></rb-dataset-chart>`}
    `;
  }

  private renderChecklist(section: TemplateSection, data: SectionData, locked: boolean): TemplateResult {
    const checked = data.checked ?? {};
    return html`<div class="checklist">
      ${(section.items ?? []).map(
        (it) => html`<label class="check-row">
          <ix-toggle
            ?checked=${checked[it.id] === true}
            ?disabled=${locked}
            @checkedChange=${(e: IxCheckedEvent) => this.setChecked(section.id, it.id, e.detail)}
          ></ix-toggle>
          <span>${it.label}</span>
          ${it.required ? html`<span class="req">obligatoire</span>` : ''}
        </label>`
      )}
    </div>`;
  }

  private renderSignatures(): TemplateResult {
    if (this.working.signatures.length === 0) return html``;
    return html`
      <div class="section">
        <div class="section-title">Signatures</div>
        <table class="data-table">
          <thead>
            <tr><th>Niveau</th><th>Rôle</th><th>Signataire</th><th>Date</th><th>Commentaire</th></tr>
          </thead>
          <tbody>
            ${this.working.signatures.map(
              (s) => html`<tr>
                <td>${s.level}</td>
                <td>${s.roleLabel}</td>
                <td class="strong">${s.signerName}</td>
                <td class="mono">${this.fmtIso(s.timestamp)}</td>
                <td>${s.comment || '—'}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    `;
  }

  // --- mutations + actions ---------------------------------------------------

  private patch(part: Partial<Report>): void {
    this.working = { ...this.working, ...part };
  }

  private mutate(sectionId: string, updater: (d: SectionData) => SectionData): void {
    const current = this.working.data[sectionId] ?? {};
    this.patch({ data: { ...this.working.data, [sectionId]: updater(current) } });
  }

  private patchPeriod(key: 'start' | 'end', value: string): void {
    this.patch({ period: { ...this.working.period, [key]: value } });
  }

  private setFieldValue(sectionId: string, fieldId: string, value: string): void {
    this.mutate(sectionId, (d) => ({ ...d, values: { ...d.values, [fieldId]: value } }));
  }

  private addRow(sectionId: string): void {
    this.mutate(sectionId, (d) => ({ ...d, rows: [...(d.rows ?? []), {}] }));
  }
  private removeRow(sectionId: string, ri: number): void {
    this.mutate(sectionId, (d) => ({ ...d, rows: (d.rows ?? []).filter((_, i) => i !== ri) }));
  }
  private setCell(sectionId: string, ri: number, colId: string, value: string): void {
    this.mutate(sectionId, (d) => ({
      ...d,
      rows: (d.rows ?? []).map((row, i) => (i === ri ? { ...row, [colId]: value } : row))
    }));
  }

  private setChecked(sectionId: string, itemId: string, value: boolean): void {
    this.mutate(sectionId, (d) => ({ ...d, checked: { ...d.checked, [itemId]: value } }));
  }

  private async recompute(section: TemplateSection): Promise<void> {
    const start = new Date(this.working.period.start);
    const end = new Date(this.working.period.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    const results: SectionData['results'] = {};
    for (const d of section.datasets ?? []) {
      // eslint-disable-next-line no-await-in-loop -- a handful of datasets per section
      results[d.id] = await computeDataset(this.api, d.dp, start, end, d.ops);
    }
    this.mutate(section.id, (d) => ({ ...d, results }));
    this.save();
  }

  private confirmSign(comment: string): void {
    this.working = applySignature(this.working, { name: this.signerName, id: this.signerId }, comment);
    this.signOpen = false;
    this.save();
  }

  private reject(): void {
    const reject = currentState(this.working)?.reject;
    if (!reject) return;
    this.working = applyReject(this.working, reject);
    this.save();
  }

  private save(): void {
    this.dispatchEvent(new CustomEvent('wui:save', { detail: this.working, bubbles: true, composed: true }));
  }

  private back(): void {
    this.dispatchEvent(new CustomEvent('wui:back', { bubbles: true, composed: true }));
  }

  private print(): void {
    const charts = [...this.renderRoot.querySelectorAll<RbDatasetChart>('rb-dataset-chart')];
    const images: Record<string, string> = {};
    // Map each dataset section (in order) to its chart image.
    let chartIdx = 0;
    for (const section of this.working.sections) {
      if (section.kind === 'dataset' && section.chart !== false) {
        const img = charts[chartIdx]?.getImageDataUrl() ?? '';
        if (img) images[section.id] = img;
        chartIdx += 1;
      }
    }
    const win = window.open('', '_blank', 'width=900,height=1000');
    if (!win) return;
    win.document.write(buildPrintHtml(this.working, images));
    // The print document calls window.print() itself once images have decoded.
    win.document.close();
  }

  private fmtIso(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('fr-FR');
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function detailStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
    }
    .wrap {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .titles {
      display: flex;
      flex-direction: column;
    }
    .rep-no {
      font-weight: 700;
      font-family: var(--theme-font-mono, monospace);
    }
    .rep-title {
      font-size: 0.82rem;
      color: var(--theme-color-soft-text);
    }
    .grow {
      flex: 1;
    }
    .sheet {
      flex: 1;
      min-height: 0;
      overflow: auto;
      padding: 0.75rem 0.25rem;
    }
    .head-card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.75rem;
      background: var(--theme-color-2);
    }
    .grid2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
    .grid3 {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0.75rem;
    }
    .kv {
      display: flex;
      flex-direction: column;
    }
    .kv .k,
    .field .unit {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .field > label {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .field-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .inp,
    .ta {
      box-sizing: border-box;
      width: 100%;
      padding: 0.4rem 0.5rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
    }
    .wf-bar {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.5rem;
      margin: 0.75rem 0;
    }
    .wf-reason {
      font-size: 0.8rem;
      color: var(--theme-color-warning, #f59e0b);
    }
    .locked-note {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--theme-color-soft-text);
    }
    .section {
      margin-top: 1rem;
    }
    .section-title {
      font-weight: 600;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      padding-bottom: 0.25rem;
      margin-bottom: 0.5rem;
    }
    .fields {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.6rem;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.86rem;
      margin-bottom: 0.5rem;
    }
    .data-table th {
      text-align: left;
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
    }
    .data-table td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .data-table .act {
      width: 1%;
    }
    .strong {
      font-weight: 600;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.8rem;
    }
    .agg {
      display: inline-block;
      margin-right: 0.75rem;
    }
    .agg .k {
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
    }
    .ds-actions {
      margin-bottom: 0.5rem;
    }
    .checklist {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .check-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .req {
      font-size: 0.72rem;
      color: var(--theme-color-warning, #f59e0b);
    }
    .chip {
      display: inline-block;
      white-space: nowrap;
      font-size: 0.74rem;
      font-weight: 600;
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
    }
    .chip.solid {
      color: #fff;
      background: var(--c);
    }
    .chip.ok {
      color: #10b981;
      border: 1px solid #10b981;
    }
    .chip.bad {
      color: #ef4444;
      border: 1px solid #ef4444;
    }
  `;
}
