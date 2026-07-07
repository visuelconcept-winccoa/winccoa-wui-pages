// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Template editor: parameterise a report's sections (text, comment, key/value
 * fields, manual table, datapoint dataset+aggregation, checklist) and its
 * configurable state workflow with multi-level signatures. Emits `wui:save`
 * with the edited {@link ReportTemplate}, `wui:close` on dismiss.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@visuelconcept/wui-kit/ui/wui-dp-input.js';
import { dialogStyles } from './dialog-styles.js';
import { DEFAULTS_MSG, MSG, localize, localizeDir } from '../i18n.js';
import {
  AGG_LABELS,
  AGG_OPS,
  FIELD_TYPE_LABELS,
  SECTION_KIND_LABELS,
  STATE_COLORS,
  STATE_KIND_LABELS,
  blankChecklistItem,
  blankColumn,
  blankDataset,
  blankField,
  blankSection,
  uid,
  type AggOp,
  type ChecklistItem,
  type ColumnDef,
  type DatasetDef,
  type FieldDef,
  type FieldType,
  type ReportTemplate,
  type SectionKind,
  type StateKind,
  type TemplateSection,
  type WorkflowState
} from '../types.js';

interface IxValueEvent {
  detail: string | number;
}
interface IxCheckedEvent {
  detail: boolean;
}

const SECTION_KINDS: SectionKind[] = ['fields', 'table', 'dataset', 'checklist', 'text', 'comment'];
const FIELD_TYPES: FieldType[] = ['text', 'number', 'date'];
const STATE_KINDS: StateKind[] = ['start', 'intermediate', 'final', 'rejected'];

@customElement('rb-template-editor')
export class RbTemplateEditor extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), editorStyles()];

  @property({ attribute: false }) template!: ReportTemplate;
  @property({ type: Boolean }) canEdit = true;

  @state() private working!: ReportTemplate;
  @state() private tab = 0;

  override render(): TemplateResult {
    if (!this.working) return html``;
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${this.working.id ? localizeDir(MSG.editor.template) : localizeDir(MSG.editor.newTemplate)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="grid2">
              <ix-input label=${localize(MSG.editor.name)} .value=${this.working.name} @valueChange=${(e: IxValueEvent) => this.patch({ name: String(e.detail) })}></ix-input>
              <ix-input label=${localize(MSG.editor.description)} .value=${this.working.description} @valueChange=${(e: IxValueEvent) => this.patch({ description: String(e.detail) })}></ix-input>
            </div>
            <div class="tabs" role="tablist">
              <button type="button" class="tab ${this.tab === 0 ? 'tab--active' : ''}" @click=${() => (this.tab = 0)}>${localizeDir(MSG.editor.tabSections)} (${this.working.sections.length})</button>
              <button type="button" class="tab ${this.tab === 1 ? 'tab--active' : ''}" @click=${() => (this.tab = 1)}>${localizeDir(MSG.editor.tabWorkflow)} (${this.working.workflow.length})</button>
            </div>
            ${this.tab === 0 ? this.renderSections() : this.renderWorkflow()}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${this.canEdit ? localizeDir(MSG.editor.cancel) : localizeDir(MSG.editor.close)}</ix-button>
            ${this.canEdit ? html`<ix-button @click=${this.save}>${localizeDir(MSG.editor.save)}</ix-button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('template') && this.template && this.working?.id !== this.template.id) {
      this.working = structuredClone(this.template);
      this.tab = 0;
    }
  }

  // --- sections --------------------------------------------------------------

  private renderSections(): TemplateResult {
    return html`
      <div class="subhead">
        ${localizeDir(MSG.editor.reportSections)}<span class="grow"></span>
        <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${this.addSection}>
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addSection)}
        </ix-button>
      </div>
      ${this.working.sections.length === 0 ? html`<div class="hint">${localizeDir(MSG.editor.noSection)}</div>` : ''}
      ${this.working.sections.map((s, i) => this.renderSectionCard(s, i))}
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- one section card template
  private renderSectionCard(section: TemplateSection, i: number): TemplateResult {
    return html`
      <div class="card">
        <div class="card-head">
          <ix-select
            class="kind-select"
            .value=${section.kind}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.changeKind(i, String(e.detail) as SectionKind)}
          >
            ${SECTION_KINDS.map((k) => html`<ix-select-item label=${localize(SECTION_KIND_LABELS[k])} value=${k}></ix-select-item>`)}
          </ix-select>
          <ix-input
            class="grow"
            placeholder=${localize(MSG.editor.sectionTitlePlaceholder)}
            .value=${section.title}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.patchSection(i, { title: String(e.detail) })}
          ></ix-input>
          <div class="row-actions">
            <ix-icon-button ghost size="16" icon="chevron-up" title=${localize(MSG.editor.moveUp)} ?disabled=${!this.canEdit || i === 0} @click=${() => this.moveSection(i, -1)}></ix-icon-button>
            <ix-icon-button ghost size="16" icon="chevron-down" title=${localize(MSG.editor.moveDown)} ?disabled=${!this.canEdit || i === this.working.sections.length - 1} @click=${() => this.moveSection(i, 1)}></ix-icon-button>
            <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.editor.remove)} ?disabled=${!this.canEdit} @click=${() => this.removeSection(i)}></ix-icon-button>
          </div>
        </div>
        ${this.renderSectionConfig(section, i)}
      </div>
    `;
  }

  private renderSectionConfig(section: TemplateSection, i: number): TemplateResult {
    switch (section.kind) {
      case 'text':
      case 'comment': {
        return html`<ix-input
          label=${localize(MSG.editor.placeholderHelp)}
          .value=${section.placeholder ?? ''}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.patchSection(i, { placeholder: String(e.detail) })}
        ></ix-input>`;
      }
      case 'fields': {
        return this.renderFieldsConfig(section, i);
      }
      case 'table': {
        return this.renderColumnsConfig(section, i);
      }
      case 'dataset': {
        return this.renderDatasetConfig(section, i);
      }
      case 'checklist': {
        return this.renderChecklistConfig(section, i);
      }
      default: {
        return html``;
      }
    }
  }

  private renderFieldsConfig(section: TemplateSection, si: number): TemplateResult {
    const fields = section.fields ?? [];
    return html`
      ${fields.map(
        (f, fi) => html`<div class="nested">
          <ix-input class="grow" placeholder=${localize(MSG.editor.fieldLabel)} .value=${f.label} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchField(si, fi, { label: String(e.detail) })}></ix-input>
          <ix-input class="unit" placeholder=${localize(MSG.editor.fieldUnit)} .value=${f.unit} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchField(si, fi, { unit: String(e.detail) })}></ix-input>
          <ix-select class="type" .value=${f.type} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchField(si, fi, { type: String(e.detail) as FieldType })}>
            ${FIELD_TYPES.map((t) => html`<ix-select-item label=${localize(FIELD_TYPE_LABELS[t])} value=${t}></ix-select-item>`)}
          </ix-select>
          ${f.type === 'number'
            ? html`<ix-number-input class="bound" placeholder=${localize(MSG.editor.boundMin)} .value=${f.min ?? ''} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchField(si, fi, { min: numOrNull(e.detail) })}></ix-number-input>
                <ix-number-input class="bound" placeholder=${localize(MSG.editor.boundMax)} .value=${f.max ?? ''} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchField(si, fi, { max: numOrNull(e.detail) })}></ix-number-input>`
            : ''}
          <ix-icon-button ghost size="16" icon="trashcan" ?disabled=${!this.canEdit} @click=${() => this.removeField(si, fi)}></ix-icon-button>
        </div>`
      )}
      <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.addField(si)}><ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addField)}</ix-button>
    `;
  }

  private renderColumnsConfig(section: TemplateSection, si: number): TemplateResult {
    const cols = section.columns ?? [];
    return html`
      <div class="hint">${localizeDir(MSG.editor.columnsHint)}</div>
      ${cols.map(
        (c, ci) => html`<div class="nested">
          <ix-input class="grow" placeholder=${localize(MSG.editor.column)} .value=${c.label} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchColumn(si, ci, { label: String(e.detail) })}></ix-input>
          <ix-select class="type" .value=${c.type} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchColumn(si, ci, { type: String(e.detail) as FieldType })}>
            ${FIELD_TYPES.map((t) => html`<ix-select-item label=${localize(FIELD_TYPE_LABELS[t])} value=${t}></ix-select-item>`)}
          </ix-select>
          <ix-icon-button ghost size="16" icon="trashcan" ?disabled=${!this.canEdit} @click=${() => this.removeColumn(si, ci)}></ix-icon-button>
        </div>`
      )}
      <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.addColumn(si)}><ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addColumn)}</ix-button>
    `;
  }

  private renderDatasetConfig(section: TemplateSection, si: number): TemplateResult {
    const datasets = section.datasets ?? [];
    return html`
      <label class="toggle-line">
        <ix-toggle ?checked=${section.chart !== false} ?disabled=${!this.canEdit} @checkedChange=${(e: IxCheckedEvent) => this.patchSection(si, { chart: e.detail })}></ix-toggle>
        ${localizeDir(MSG.editor.showChart)}
      </label>
      ${datasets.map((d, di) => this.renderDatasetRow(si, d, di))}
      <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.addDataset(si)}><ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addMeasure)}</ix-button>
    `;
  }

  private renderDatasetRow(si: number, d: DatasetDef, di: number): TemplateResult {
    return html`<div class="ds-row">
      <div class="ds-top">
        <ix-input class="grow" placeholder=${localize(MSG.editor.measureLabelPlaceholder)} .value=${d.label} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchDataset(si, di, { label: String(e.detail) })}></ix-input>
        <ix-icon-button ghost size="16" icon="trashcan" ?disabled=${!this.canEdit} @click=${() => this.removeDataset(si, di)}></ix-icon-button>
      </div>
      <wui-dp-input label=${localize(MSG.editor.datapoint)} .value=${d.dp} @wui:change=${(e: CustomEvent<{ value: string }>) => this.patchDataset(si, di, { dp: e.detail.value })}></wui-dp-input>
      <div class="op-chips">
        ${AGG_OPS.map(
          (op) => html`<button type="button" class="op-chip ${d.ops.includes(op) ? 'op-chip--on' : ''}" ?disabled=${!this.canEdit} @click=${() => this.toggleOp(si, di, op)}>${localizeDir(AGG_LABELS[op])}</button>`
        )}
      </div>
    </div>`;
  }

  private renderChecklistConfig(section: TemplateSection, si: number): TemplateResult {
    const items = section.items ?? [];
    return html`
      ${items.map(
        (it, ii) => html`<div class="nested">
          <ix-input class="grow" placeholder=${localize(MSG.editor.checklistItemPlaceholder)} .value=${it.label} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchItem(si, ii, { label: String(e.detail) })}></ix-input>
          <label class="toggle-line"><ix-toggle ?checked=${it.required} ?disabled=${!this.canEdit} @checkedChange=${(e: IxCheckedEvent) => this.patchItem(si, ii, { required: e.detail })}></ix-toggle>${localizeDir(MSG.editor.mandatory)}</label>
          <ix-icon-button ghost size="16" icon="trashcan" ?disabled=${!this.canEdit} @click=${() => this.removeItem(si, ii)}></ix-icon-button>
        </div>`
      )}
      <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.addItem(si)}><ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addItem)}</ix-button>
    `;
  }

  // --- workflow --------------------------------------------------------------

  private renderWorkflow(): TemplateResult {
    return html`
      <div class="subhead">
        ${localizeDir(MSG.editor.statesSignatures)}<span class="grow"></span>
        <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${this.addState}>
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addState)}
        </ix-button>
      </div>
      <div class="hint">${localizeDir(MSG.editor.workflowHint)}</div>
      ${this.working.workflow.map((s, i) => this.renderStateCard(s, i))}
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- one workflow-state card template
  private renderStateCard(s: WorkflowState, i: number): TemplateResult {
    const others = this.working.workflow.filter((x) => x.id !== s.id);
    return html`
      <div class="card">
        <div class="card-head">
          <span class="state-dot" style="background:${s.color}"></span>
          <ix-input class="grow" placeholder=${localize(MSG.editor.stateLabelPlaceholder)} .value=${s.label} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchState(i, { label: String(e.detail) })}></ix-input>
          <ix-select class="kind" .value=${s.kind} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchState(i, { kind: String(e.detail) as StateKind, color: STATE_COLORS[String(e.detail) as StateKind] })}>
            ${STATE_KINDS.map((k) => html`<ix-select-item label=${localize(STATE_KIND_LABELS[k])} value=${k}></ix-select-item>`)}
          </ix-select>
          <div class="row-actions">
            <ix-icon-button ghost size="16" icon="chevron-up" ?disabled=${!this.canEdit || i === 0} @click=${() => this.moveState(i, -1)}></ix-icon-button>
            <ix-icon-button ghost size="16" icon="chevron-down" ?disabled=${!this.canEdit || i === this.working.workflow.length - 1} @click=${() => this.moveState(i, 1)}></ix-icon-button>
            <ix-icon-button ghost size="16" icon="trashcan" ?disabled=${!this.canEdit} @click=${() => this.removeState(i)}></ix-icon-button>
          </div>
        </div>
        <label class="toggle-line">
          <ix-toggle ?checked=${s.advance != null} ?disabled=${!this.canEdit} @checkedChange=${(e: IxCheckedEvent) => this.toggleAdvance(i, e.detail)}></ix-toggle>
          ${localizeDir(MSG.editor.advanceToggle)}
        </label>
        ${s.advance
          ? html`<div class="signoff">
              <div class="grid3">
                <ix-input label=${localize(MSG.editor.action)} .value=${s.advance.actionLabel} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchAdvance(i, { actionLabel: String(e.detail) })}></ix-input>
                <ix-input label=${localize(MSG.editor.roleLevel)} .value=${s.advance.roleLabel} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchAdvance(i, { roleLabel: String(e.detail) })}></ix-input>
                <ix-number-input label=${localize(MSG.editor.level)} min="1" .value=${s.advance.level} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchAdvance(i, { level: Number(e.detail) || 1 })}></ix-number-input>
              </div>
              <ix-select label=${localize(MSG.editor.targetState)} .value=${s.advance.toStateId} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchAdvance(i, { toStateId: String(e.detail) })}>
                ${others.map((o) => html`<ix-select-item label=${o.label} value=${o.id}></ix-select-item>`)}
              </ix-select>
              <div class="toggle-row2">
                <label class="toggle-line"><ix-toggle ?checked=${s.advance.requirePermission} ?disabled=${!this.canEdit} @checkedChange=${(e: IxCheckedEvent) => this.patchAdvance(i, { requirePermission: e.detail })}></ix-toggle>${localizeDir(MSG.editor.requirePermission)}</label>
                <label class="toggle-line"><ix-toggle ?checked=${s.advance.requireChecklist} ?disabled=${!this.canEdit} @checkedChange=${(e: IxCheckedEvent) => this.patchAdvance(i, { requireChecklist: e.detail })}></ix-toggle>${localizeDir(MSG.editor.requireChecklist)}</label>
              </div>
            </div>`
          : ''}
        <label class="toggle-line">
          <ix-toggle ?checked=${s.reject != null} ?disabled=${!this.canEdit} @checkedChange=${(e: IxCheckedEvent) => this.toggleReject(i, e.detail)}></ix-toggle>
          ${localizeDir(MSG.editor.rejectToggle)}
        </label>
        ${s.reject
          ? html`<div class="signoff grid2">
              <ix-input label=${localize(MSG.editor.action)} .value=${s.reject.actionLabel} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchReject(i, { actionLabel: String(e.detail) })}></ix-input>
              <ix-select label=${localize(MSG.editor.targetState)} .value=${s.reject.toStateId} ?disabled=${!this.canEdit} @valueChange=${(e: IxValueEvent) => this.patchReject(i, { toStateId: String(e.detail) })}>
                ${others.map((o) => html`<ix-select-item label=${o.label} value=${o.id}></ix-select-item>`)}
              </ix-select>
            </div>`
          : ''}
      </div>
    `;
  }

  // --- mutations -------------------------------------------------------------

  private patch(part: Partial<ReportTemplate>): void {
    this.working = { ...this.working, ...part };
  }

  private replaceSection(i: number, section: TemplateSection): void {
    this.patch({ sections: this.working.sections.map((s, idx) => (idx === i ? section : s)) });
  }

  private patchSection(i: number, part: Partial<TemplateSection>): void {
    this.patch({ sections: this.working.sections.map((s, idx) => (idx === i ? { ...s, ...part } : s)) });
  }

  private readonly addSection = (): void => {
    this.patch({ sections: [...this.working.sections, blankSection('fields')] });
  };

  private changeKind(i: number, kind: SectionKind): void {
    const prev = this.working.sections[i];
    this.replaceSection(i, { ...blankSection(kind), id: prev.id, title: prev.title });
  }

  private removeSection(i: number): void {
    this.patch({ sections: this.working.sections.filter((_, idx) => idx !== i) });
  }

  private moveSection(i: number, dir: number): void {
    this.patch({ sections: move(this.working.sections, i, dir) });
  }

  private fieldsOf(si: number): FieldDef[] {
    return this.working.sections[si].fields ?? [];
  }
  private addField(si: number): void {
    this.patchSection(si, { fields: [...this.fieldsOf(si), blankField()] });
  }
  private removeField(si: number, fi: number): void {
    this.patchSection(si, { fields: this.fieldsOf(si).filter((_, idx) => idx !== fi) });
  }
  private patchField(si: number, fi: number, part: Partial<FieldDef>): void {
    this.patchSection(si, { fields: this.fieldsOf(si).map((f, idx) => (idx === fi ? { ...f, ...part } : f)) });
  }

  private colsOf(si: number): ColumnDef[] {
    return this.working.sections[si].columns ?? [];
  }
  private addColumn(si: number): void {
    this.patchSection(si, { columns: [...this.colsOf(si), blankColumn()] });
  }
  private removeColumn(si: number, ci: number): void {
    this.patchSection(si, { columns: this.colsOf(si).filter((_, idx) => idx !== ci) });
  }
  private patchColumn(si: number, ci: number, part: Partial<ColumnDef>): void {
    this.patchSection(si, { columns: this.colsOf(si).map((c, idx) => (idx === ci ? { ...c, ...part } : c)) });
  }

  private dsOf(si: number): DatasetDef[] {
    return this.working.sections[si].datasets ?? [];
  }
  private addDataset(si: number): void {
    this.patchSection(si, { datasets: [...this.dsOf(si), blankDataset()] });
  }
  private removeDataset(si: number, di: number): void {
    this.patchSection(si, { datasets: this.dsOf(si).filter((_, idx) => idx !== di) });
  }
  private patchDataset(si: number, di: number, part: Partial<DatasetDef>): void {
    this.patchSection(si, { datasets: this.dsOf(si).map((d, idx) => (idx === di ? { ...d, ...part } : d)) });
  }
  private toggleOp(si: number, di: number, op: AggOp): void {
    const d = this.dsOf(si)[di];
    const ops = d.ops.includes(op) ? d.ops.filter((o) => o !== op) : [...d.ops, op];
    this.patchDataset(si, di, { ops });
  }

  private itemsOf(si: number): ChecklistItem[] {
    return this.working.sections[si].items ?? [];
  }
  private addItem(si: number): void {
    this.patchSection(si, { items: [...this.itemsOf(si), blankChecklistItem()] });
  }
  private removeItem(si: number, ii: number): void {
    this.patchSection(si, { items: this.itemsOf(si).filter((_, idx) => idx !== ii) });
  }
  private patchItem(si: number, ii: number, part: Partial<ChecklistItem>): void {
    this.patchSection(si, { items: this.itemsOf(si).map((it, idx) => (idx === ii ? { ...it, ...part } : it)) });
  }

  private patchState(i: number, part: Partial<WorkflowState>): void {
    this.patch({ workflow: this.working.workflow.map((s, idx) => (idx === i ? { ...s, ...part } : s)) });
  }
  private readonly addState = (): void => {
    const stateId = uid('st');
    this.patch({ workflow: [...this.working.workflow, { id: stateId, label: localize(DEFAULTS_MSG.newState), color: STATE_COLORS.intermediate, kind: 'intermediate' }] });
  };
  private removeState(i: number): void {
    this.patch({ workflow: this.working.workflow.filter((_, idx) => idx !== i) });
  }
  private moveState(i: number, dir: number): void {
    this.patch({ workflow: move(this.working.workflow, i, dir) });
  }
  private toggleAdvance(i: number, on: boolean): void {
    const other = this.working.workflow.find((x) => x.id !== this.working.workflow[i].id);
    this.patchState(i, {
      advance: on
        ? { toStateId: other?.id ?? '', actionLabel: localize(DEFAULTS_MSG.advanceSign), roleLabel: localize(DEFAULTS_MSG.roleSigner), level: 1, requirePermission: true, requireChecklist: false }
        : undefined
    });
  }
  private patchAdvance(i: number, part: Partial<NonNullable<WorkflowState['advance']>>): void {
    const advance = this.working.workflow[i].advance;
    if (advance) this.patchState(i, { advance: { ...advance, ...part } });
  }
  private toggleReject(i: number, on: boolean): void {
    const other = this.working.workflow.find((x) => x.id !== this.working.workflow[i].id);
    this.patchState(i, { reject: on ? { toStateId: other?.id ?? '', actionLabel: localize(DEFAULTS_MSG.reject) } : undefined });
  }
  private patchReject(i: number, part: Partial<NonNullable<WorkflowState['reject']>>): void {
    const reject = this.working.workflow[i].reject;
    if (reject) this.patchState(i, { reject: { ...reject, ...part } });
  }

  private save(): void {
    this.dispatchEvent(new CustomEvent('wui:save', { detail: this.working, bubbles: true, composed: true }));
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}

function numOrNull(v: string | number): number | null {
  const n = Number(v);
  return v === '' || !Number.isFinite(n) ? null : n;
}

function move<T>(arr: T[], i: number, dir: number): T[] {
  const j = i + dir;
  if (j < 0 || j >= arr.length) return arr;
  const out = [...arr];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function editorStyles(): ReturnType<typeof css> {
  return css`
    .tabs {
      display: flex;
      gap: 0.25rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      margin: 1rem 0 0.75rem;
    }
    .tab {
      appearance: none;
      border: none;
      background: transparent;
      color: var(--theme-color-soft-text);
      font: inherit;
      padding: 0.4rem 0.7rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      border-radius: var(--theme-default-border-radius) var(--theme-default-border-radius) 0 0;
    }
    .tab--active {
      color: var(--theme-color-primary);
      border-bottom-color: var(--theme-color-primary);
      font-weight: 600;
    }
    .kind-select {
      min-width: 11rem;
    }
    .nested {
      display: flex;
      align-items: flex-end;
      gap: 0.4rem;
      margin-bottom: 0.4rem;
    }
    .nested .unit {
      width: 5rem;
    }
    .nested .type {
      width: 7rem;
    }
    .nested .bound {
      width: 5rem;
    }
    .ds-row {
      border-top: 1px solid var(--theme-color-soft-bdr);
      padding-top: 0.5rem;
      margin-top: 0.5rem;
    }
    .ds-top {
      display: flex;
      align-items: flex-end;
      gap: 0.4rem;
    }
    .op-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-top: 0.4rem;
    }
    .op-chip {
      appearance: none;
      font: inherit;
      font-size: 0.78rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-soft-text);
      cursor: pointer;
    }
    .op-chip--on {
      border-color: var(--theme-color-primary);
      color: #fff;
      background: var(--theme-color-primary);
    }
    .toggle-line {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      margin: 0.3rem 0;
    }
    .toggle-row2 {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .signoff {
      border-left: 2px solid var(--theme-color-primary);
      padding-left: 0.6rem;
      margin: 0.25rem 0 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .state-dot {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
      flex: 0 0 auto;
    }
    .kind {
      width: 11rem;
    }
  `;
}
