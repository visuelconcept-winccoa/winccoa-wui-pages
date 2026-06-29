// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to create or edit one thermal treatment report: identity, the
 * treatment recipe (a repeatable list of paliers + quench), the furnace link
 * (cascading atelier→furnace selects fed by the Machine Fleet 3D fleet) and the
 * temperature DPE to read from the archives, the cycle window, the quality
 * results, and the workflow fields.
 *
 * Emits `wui:save` with the edited report, `wui:cancel` on dismiss.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Atelier, MachineDef } from '@visuelconcept/wui-fleet-core/types.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import {
  CONFORMITY_LABELS,
  QUENCH_LABELS,
  STATUS_LABELS,
  TREATMENT_LABELS,
  blankReport,
  blankResult,
  blankStep,
  tempDpForMachine,
  type Conformity,
  type QuenchMedium,
  type ReportStatus,
  type ThermalReport,
  type TreatmentType
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string | number;
}

function options<T extends string>(labels: Record<T, MultiLangString>): { value: T; label: MultiLangString }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

const TREATMENT_OPTIONS = options<TreatmentType>(TREATMENT_LABELS);
const QUENCH_OPTIONS = options<QuenchMedium>(QUENCH_LABELS);
const STATUS_OPTIONS = options<ReportStatus>(STATUS_LABELS);
const CONFORMITY_OPTIONS = options<Conformity>(CONFORMITY_LABELS);

@customElement('tt-report-dialog')
export class TtReportDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  /** Report to edit; when null the dialog creates a new one. */
  @property({ attribute: false }) report: ThermalReport | null = null;

  /** Fleet catalogue used to populate the atelier / furnace selects. */
  @property({ attribute: false }) ateliers: Atelier[] = [];

  /** Local working copy so parent re-renders never discard in-progress edits. */
  @state() private working: ThermalReport = blankReport();

  // eslint-disable-next-line max-lines-per-function -- single form template
  override render(): TemplateResult {
    const isNew = !this.report;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${isNew
                ? localizeDir(MSG.dialog.newReport)
                : html`${localizeDir(MSG.dialog.editPrefix)} — ${this.working.reportNo}`}
            </ix-typography>
          </div>

          <div class="panel-body">
            <div class="subhead">${localizeDir(MSG.dialog.secIdentity)}</div>
            <div class="grid3">
              ${this.textField(MSG.dialog.fReportNo, 'reportNo')}
              ${this.textField(MSG.dialog.fCharge, 'charge')}
              ${this.textField(MSG.dialog.fOrder, 'orderNo')}
              ${this.textField(MSG.dialog.fPart, 'part')}
              ${this.textField(MSG.dialog.fMaterial, 'material')}
              ${this.numberField(MSG.dialog.fQuantity, 'quantity')}
            </div>

            <div class="subhead">${localizeDir(MSG.dialog.secTreatment)}</div>
            <div class="grid3">
              ${this.selectField(MSG.dialog.fTreatment, 'treatment', TREATMENT_OPTIONS)}
              ${this.textField(MSG.dialog.fAtmosphere, 'atmosphere')}
              ${this.selectField(MSG.dialog.fQuench, 'quench', QUENCH_OPTIONS)}
            </div>

            <div class="subhead">${localizeDir(MSG.dialog.secFurnace)}</div>
            <div class="grid3">
              ${this.atelierField()} ${this.furnaceField()}
              <div class="field">
                <label>${localizeDir(MSG.dialog.fCycleStart)}</label>
                <input
                  class="dt"
                  type="datetime-local"
                  .value=${this.working.startTime}
                  @change=${(e: Event) => this.patch({ startTime: (e.target as HTMLInputElement).value })}
                />
              </div>
            </div>
            <div class="grid3">
              <div class="field span2">
                <label>${localizeDir(MSG.dialog.fTempDp)}</label>
                <ix-input
                  placeholder=${localize(MSG.dialog.tempDpPlaceholder)}
                  .value=${this.working.tempDp}
                  @valueChange=${(e: IxValueEvent) => this.patch({ tempDp: String(e.detail) })}
                ></ix-input>
              </div>
              <div class="field">
                <label>${localizeDir(MSG.dialog.fCycleEnd)}</label>
                <input
                  class="dt"
                  type="datetime-local"
                  .value=${this.working.endTime}
                  @change=${(e: Event) => this.patch({ endTime: (e.target as HTMLInputElement).value })}
                />
              </div>
            </div>

            <div class="subhead">
              ${localizeDir(MSG.dialog.secRecipe)}
              <span class="grow"></span>
              <ix-button variant="secondary" outline @click=${this.addStep}>
                <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.dialog.addStep)}
              </ix-button>
            </div>
            ${this.renderSteps()}

            <div class="subhead">
              ${localizeDir(MSG.dialog.secQuality)}
              <span class="grow"></span>
              <ix-button variant="secondary" outline @click=${this.addResult}>
                <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.dialog.addControl)}
              </ix-button>
            </div>
            ${this.renderResults()}

            <div class="subhead">${localizeDir(MSG.dialog.secTracking)}</div>
            <div class="grid3">
              ${this.selectField(MSG.dialog.fStatus, 'status', STATUS_OPTIONS)}
              ${this.selectField(MSG.dialog.fConformity, 'conformity', CONFORMITY_OPTIONS)}
              ${this.textField(MSG.dialog.fOperator, 'operator')}
            </div>
            <div class="field">
              <label>${localizeDir(MSG.dialog.fNotes)}</label>
              <ix-input
                .value=${this.working.notes}
                @valueChange=${(e: IxValueEvent) => this.patch({ notes: String(e.detail) })}
              ></ix-input>
            </div>
          </div>

          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.dialog.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${this.working.reportNo.trim() === ''}>
              <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.dialog.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('report')) {
      this.working = this.report ? structuredClone(this.report) : blankReport();
    }
  }

  // --- recipe steps ----------------------------------------------------------

  private renderSteps(): TemplateResult {
    if (this.working.steps.length === 0) {
      return html`<p class="hint">${localizeDir(MSG.dialog.noStep)}</p>`;
    }
    return html`
      <div class="rows">
        <div class="row head">
          <span>${localizeDir(MSG.dialog.colStep)}</span>
          <span>${localizeDir(MSG.dialog.colSetpoint)}</span>
          <span>${localizeDir(MSG.dialog.colDuration)}</span>
          <span>${localizeDir(MSG.dialog.colTolMinus)}</span>
          <span>${localizeDir(MSG.dialog.colTolPlus)}</span>
          <span>${localizeDir(MSG.dialog.colAtmosphere)}</span>
          <span></span>
        </div>
        ${this.working.steps.map((step, i) => this.renderStepRow(step, i))}
      </div>
    `;
  }

  private renderStepRow(step: ThermalReport['steps'][number], i: number): TemplateResult {
    return html`
      <div class="row">
        <input class="cell" .value=${step.label} @input=${(e: Event) => this.updateStep(i, { label: val(e) })} />
        <input class="cell num" type="number" .value=${String(step.setpoint)} @input=${(e: Event) => this.updateStep(i, { setpoint: num(e) })} />
        <input class="cell num" type="number" .value=${String(step.durationMin)} @input=${(e: Event) => this.updateStep(i, { durationMin: num(e) })} />
        <input class="cell num" type="number" .value=${String(step.tolMinus)} @input=${(e: Event) => this.updateStep(i, { tolMinus: num(e) })} />
        <input class="cell num" type="number" .value=${String(step.tolPlus)} @input=${(e: Event) => this.updateStep(i, { tolPlus: num(e) })} />
        <input class="cell" .value=${step.atmosphere} @input=${(e: Event) => this.updateStep(i, { atmosphere: val(e) })} />
        <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.dialog.remove)} @click=${() => this.removeStep(i)}></ix-icon-button>
      </div>
    `;
  }

  private renderResults(): TemplateResult {
    if (this.working.results.length === 0) {
      return html`<p class="hint">${localizeDir(MSG.dialog.noControl)}</p>`;
    }
    return html`
      <div class="rows">
        <div class="row res head">
          <span>${localizeDir(MSG.dialog.colControl)}</span>
          <span>${localizeDir(MSG.dialog.colValue)}</span>
          <span>${localizeDir(MSG.dialog.colUnit)}</span>
          <span>${localizeDir(MSG.dialog.colMin)}</span>
          <span>${localizeDir(MSG.dialog.colMax)}</span>
          <span></span>
        </div>
        ${this.working.results.map((res, i) => this.renderResultRow(res, i))}
      </div>
    `;
  }

  private renderResultRow(res: ThermalReport['results'][number], i: number): TemplateResult {
    return html`
      <div class="row res">
        <input class="cell" .value=${res.label} @input=${(e: Event) => this.updateResult(i, { label: val(e) })} />
        <input class="cell num" type="number" .value=${String(res.value)} @input=${(e: Event) => this.updateResult(i, { value: num(e) })} />
        <input class="cell" .value=${res.unit} @input=${(e: Event) => this.updateResult(i, { unit: val(e) })} />
        <input class="cell num" type="number" .value=${res.min == null ? '' : String(res.min)} @input=${(e: Event) => this.updateResult(i, { min: optNum(e) })} />
        <input class="cell num" type="number" .value=${res.max == null ? '' : String(res.max)} @input=${(e: Event) => this.updateResult(i, { max: optNum(e) })} />
        <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.dialog.remove)} @click=${() => this.removeResult(i)}></ix-icon-button>
      </div>
    `;
  }

  // --- generic fields --------------------------------------------------------

  private textField(label: MultiLangString, key: keyof ThermalReport): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-input
          .value=${String(this.working[key] ?? '')}
          @valueChange=${(e: IxValueEvent) => this.patch({ [key]: String(e.detail) } as Partial<ThermalReport>)}
        ></ix-input>
      </div>
    `;
  }

  private numberField(label: MultiLangString, key: 'quantity'): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-number-input
          .value=${this.working[key]}
          @valueChange=${(e: IxValueEvent) => this.patch({ [key]: Number(e.detail) } as Partial<ThermalReport>)}
        ></ix-number-input>
      </div>
    `;
  }

  private selectField<T extends string>(
    label: MultiLangString,
    key: keyof ThermalReport,
    opts: { value: T; label: MultiLangString }[]
  ): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-select
          .value=${String(this.working[key])}
          @valueChange=${(e: IxValueEvent) => this.patch({ [key]: String(e.detail) } as Partial<ThermalReport>)}
        >
          ${opts.map((o) => html`<ix-select-item label=${localize(o.label)} value=${o.value}></ix-select-item>`)}
        </ix-select>
      </div>
    `;
  }

  private atelierField(): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(MSG.dialog.fWorkshop)}</label>
        <ix-select
          .value=${this.working.atelierId}
          @valueChange=${(e: IxValueEvent) => this.onAtelierChange(String(e.detail))}
        >
          ${this.ateliers.map((a) => html`<ix-select-item label=${a.name} value=${a.id}></ix-select-item>`)}
        </ix-select>
      </div>
    `;
  }

  private furnaceField(): TemplateResult {
    const machines = this.furnaceChoices();
    return html`
      <div class="field">
        <label>${localizeDir(MSG.dialog.fFurnace)}</label>
        <ix-select
          .value=${this.working.machineId}
          ?disabled=${machines.length === 0}
          @valueChange=${(e: IxValueEvent) => this.onMachineChange(String(e.detail))}
        >
          ${machines.map((m) => html`<ix-select-item label=${m.name} value=${m.id}></ix-select-item>`)}
        </ix-select>
      </div>
    `;
  }

  /** Furnaces of the selected atelier (type `four`), else all its machines. */
  private furnaceChoices(): MachineDef[] {
    const atelier = this.ateliers.find((a) => a.id === this.working.atelierId);
    const machines = atelier?.machines ?? [];
    const furnaces = machines.filter((m) => m.type === 'four');
    return furnaces.length > 0 ? furnaces : machines;
  }

  // --- mutations -------------------------------------------------------------

  private onAtelierChange(atelierId: string): void {
    const atelier = this.ateliers.find((a) => a.id === atelierId);
    this.patch({ atelierId, atelierName: atelier?.name ?? '', machineId: '', machineName: '' });
  }

  private onMachineChange(machineId: string): void {
    const atelier = this.ateliers.find((a) => a.id === this.working.atelierId);
    const machine = atelier?.machines.find((m) => m.id === machineId);
    // Auto-fill the temperature DPE unless the user set a custom one.
    const autoPrev = tempDpForMachine(this.working.machineId);
    const patch: Partial<ThermalReport> = { machineId, machineName: machine?.name ?? '' };
    if (this.working.tempDp === '' || this.working.tempDp === autoPrev) {
      patch.tempDp = tempDpForMachine(machineId);
    }
    this.patch(patch);
  }

  private addStep(): void {
    this.working = { ...this.working, steps: [...this.working.steps, blankStep()] };
  }

  private updateStep(i: number, part: Partial<ThermalReport['steps'][number]>): void {
    const steps = this.working.steps.map((s, idx) => (idx === i ? { ...s, ...part } : s));
    this.working = { ...this.working, steps };
  }

  private removeStep(i: number): void {
    this.working = { ...this.working, steps: this.working.steps.filter((_, idx) => idx !== i) };
  }

  private addResult(): void {
    this.working = { ...this.working, results: [...this.working.results, blankResult()] };
  }

  private updateResult(i: number, part: Partial<ThermalReport['results'][number]>): void {
    const results = this.working.results.map((r, idx) => (idx === i ? { ...r, ...part } : r));
    this.working = { ...this.working, results };
  }

  private removeResult(i: number): void {
    this.working = { ...this.working, results: this.working.results.filter((_, idx) => idx !== i) };
  }

  private patch(part: Partial<ThermalReport>): void {
    this.working = { ...this.working, ...part };
  }

  private save(): void {
    if (this.working.reportNo.trim() === '') return;
    this.dispatchEvent(
      new CustomEvent('wui:save', { detail: this.working, bubbles: true, composed: true })
    );
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function val(e: Event): string {
  return (e.target as HTMLInputElement).value;
}

function num(e: Event): number {
  return Number((e.target as HTMLInputElement).value) || 0;
}

/** Optional number: empty input → undefined (no bound). */
function optNum(e: Event): number | undefined {
  const raw = (e.target as HTMLInputElement).value.trim();
  if (raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function extraStyles(): ReturnType<typeof css> {
  return css`
    .span2 {
      grid-column: span 2;
    }
    .dt {
      width: 100%;
      box-sizing: border-box;
      padding: 0.4rem 0.5rem;
      color: var(--theme-color-std-text);
      background: var(--theme-color-component-1, var(--theme-color-1));
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      font-family: inherit;
      font-size: 0.9rem;
    }
    .dt::-webkit-calendar-picker-indicator {
      filter: invert(0.7);
      cursor: pointer;
    }
    .hint {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
      margin: 0.25rem 0;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .row {
      display: grid;
      grid-template-columns: 1.4fr 0.8fr 0.8fr 0.6fr 0.6fr 1fr auto;
      gap: 0.4rem;
      align-items: center;
    }
    .row.res {
      grid-template-columns: 1.6fr 0.8fr 0.7fr 0.7fr 0.7fr auto;
    }
    .row.head {
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
    }
    .cell {
      width: 100%;
      box-sizing: border-box;
      padding: 0.3rem 0.45rem;
      color: var(--theme-color-std-text);
      background: var(--theme-color-component-1, var(--theme-color-1));
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      font-family: inherit;
      font-size: 0.85rem;
    }
    .cell.num {
      text-align: right;
      font-family: var(--theme-font-mono, monospace);
    }
  `;
}
