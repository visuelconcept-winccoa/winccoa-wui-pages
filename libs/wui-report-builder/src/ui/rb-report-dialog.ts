// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Create a new report instance from a template: pick the template, set the
 * report number / title / subject and the data period (used by dataset
 * sections). Emits `wui:create` with the instantiated {@link Report}.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { dialogStyles } from './dialog-styles.js';
import { instantiateReport, nowLocal, type Report, type ReportTemplate } from '../types.js';

interface IxValueEvent {
  detail: string | number;
}

const DAY_MS = 86_400_000;
const PAD = 2;

function pad(n: number): string {
  return String(n).padStart(PAD, '0');
}

function localStamp(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

@customElement('rb-report-dialog')
export class RbReportDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  @property({ attribute: false }) templates: ReportTemplate[] = [];

  @state() private templateId = '';
  @state() private reportNo = '';
  @state() private title = '';
  @state() private subject = '';
  @state() private start = localStamp(new Date(Date.now() - DAY_MS));
  @state() private end = localStamp(new Date());

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.templateId && this.templates.length > 0) this.templateId = this.templates[0].id;
  }

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()} style="width:560px">
          <div class="panel-head"><ix-typography format="h3">Nouveau rapport</ix-typography></div>
          <div class="panel-body">
            ${this.templates.length === 0
              ? html`<div class="hint">Aucun modèle disponible. Créez d'abord un modèle dans l'onglet « Modèles ».</div>`
              : html`
                  <ix-select
                    label="Modèle"
                    .value=${this.templateId}
                    @valueChange=${(e: IxValueEvent) => (this.templateId = String(e.detail))}
                  >
                    ${this.templates.map(
                      (t) => html`<ix-select-item label=${t.name || '(sans nom)'} value=${t.id}></ix-select-item>`
                    )}
                  </ix-select>
                  <div class="grid2" style="margin-top:0.75rem">
                    <ix-input label="N° rapport" .value=${this.reportNo} @valueChange=${(e: IxValueEvent) => (this.reportNo = String(e.detail))}></ix-input>
                    <ix-input label="Titre" .value=${this.title} @valueChange=${(e: IxValueEvent) => (this.title = String(e.detail))}></ix-input>
                  </div>
                  <ix-input style="margin-top:0.75rem" label="Objet" .value=${this.subject} @valueChange=${(e: IxValueEvent) => (this.subject = String(e.detail))}></ix-input>
                  <div class="grid2" style="margin-top:0.75rem">
                    <div class="field">
                      <label>Période — début</label>
                      <input type="datetime-local" .value=${this.start} @change=${(e: Event) => (this.start = (e.target as HTMLInputElement).value)} />
                    </div>
                    <div class="field">
                      <label>Période — fin</label>
                      <input type="datetime-local" .value=${this.end} @change=${(e: Event) => (this.end = (e.target as HTMLInputElement).value)} />
                    </div>
                  </div>
                  <div class="hint">La période sert aux sections « Données » (lecture des archives sur cet intervalle).</div>
                `}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>Annuler</ix-button>
            <ix-button ?disabled=${this.templates.length === 0 || !this.templateId} @click=${this.create}>
              <ix-icon name="plus" slot="icon"></ix-icon>Créer
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private create(): void {
    const template = this.templates.find((t) => t.id === this.templateId);
    if (!template) return;
    const report: Report = {
      ...instantiateReport(template),
      reportNo: this.reportNo,
      title: this.title,
      subject: this.subject,
      period: { start: this.start, end: this.end },
      createdAt: nowLocal()
    };
    this.dispatchEvent(new CustomEvent('wui:create', { detail: report, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}
