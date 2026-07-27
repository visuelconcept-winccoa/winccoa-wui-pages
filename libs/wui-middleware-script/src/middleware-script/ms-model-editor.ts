// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Middleware-Script MODEL editor — a reusable script definition: declared
 * input/output aliases (the contract each instance binds to DPEs), declared
 * parameters (per-instance constants with defaults, `params.<name>` in the
 * script) and the script itself.
 *
 * Emits `wui:modelsave` { model } (validated draft) and `wui:modeldelete`
 * { id }. Deleting is refused while tasks still instantiate the model
 * (`usageCount` prop). The embedded dry-run tests the model with a pseudo-task
 * built from the declarations (parameter DEFAULTS, editable input values).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import './ms-script-editor.js';
import './ms-test-panel.js';
import { MSG, localize, localizeDir, modelUsedByMsg, validationMsg } from './i18n.js';
import { validateModel, type MsIoDecl, type MsModel, type MsParamDecl, type MsTask } from './types.js';

export class WuiMsModelEditor extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
        flex-shrink: 0;
        flex-wrap: wrap;
      }
      .head ix-input {
        flex: 1;
        min-width: 12rem;
      }
      .usage {
        font-size: 0.75rem;
        color: var(--theme-color-soft-text);
        font-family: monospace;
      }
      .dirty {
        font-size: 0.75rem;
        color: var(--theme-color-warning, #d9822b);
      }
      .body {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 0.75rem;
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
      }
      .section {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .section .title {
        font-weight: 600;
        font-size: 0.8125rem;
      }
      .hint {
        font-size: 0.75rem;
        color: var(--theme-color-soft-text);
      }
      .row {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .row .alias {
        flex: 0 0 11rem;
      }
      .row .desc {
        flex: 1;
        min-width: 10rem;
      }
      wui-ms-script-editor {
        min-height: 14rem;
      }
      .errors {
        color: var(--theme-color-alarm);
        font-size: 0.8125rem;
        white-space: pre-line;
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-top: 1px solid var(--theme-color-soft-bdr);
        flex-shrink: 0;
      }
      .footer .status {
        flex: 1;
        font-size: 0.8125rem;
        color: var(--theme-color-success);
      }
    `
  ];

  /** Selected model (the editor works on an internal draft copy). */
  @property({ attribute: false }) model: MsModel | null = null;
  /** How many tasks instantiate this model (delete guard + badge). */
  @property({ type: Number }) usageCount = 0;
  @property({ type: Boolean }) canEdit = true;
  @property({ type: Boolean }) canTest = true;

  @state() private draft: MsModel | null = null;
  @state() private errors: string[] = [];
  @state() private savedFlash = false;

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('model')) {
      const previous = changed.get('model') as MsModel | null | undefined;
      if (this.model == null) {
        this.draft = null;
      } else if (previous == null || previous.id !== this.model.id || this.draft == null) {
        this.draft = structuredClone(this.model);
        this.errors = [];
        this.savedFlash = false;
      }
    }
  }

  override render(): TemplateResult {
    const draft = this.draft;
    if (draft == null) {
      return html`<div class="body"><div class="hint">${localizeDir(MSG.page.selectModel)}</div></div>`;
    }
    return html`
      <div class="head">
        <ix-input
          label=${localize(MSG.modelEditor.name)}
          .value=${draft.name}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: Event) => this.patch({ name: (e.target as HTMLInputElement).value })}
        ></ix-input>
        <span class="usage">${modelUsedByMsg(this.usageCount)}</span>
        ${this.isDirty() ? html`<span class="dirty">● ${localizeDir(MSG.editor.unsaved)}</span>` : nothing}
      </div>
      <div class="body">
        <ix-textarea
          label=${localize(MSG.modelEditor.description)}
          .value=${draft.description}
          rows="2"
          ?disabled=${!this.canEdit}
          @valueChange=${(e: CustomEvent<string>) => this.patch({ description: e.detail })}
        ></ix-textarea>
        <div class="hint">${localizeDir(MSG.modelEditor.declHint)}</div>
        ${this.renderIoDecl('inputs')}
        ${this.renderIoDecl('outputs')}
        ${this.renderParams(draft)}
        <wui-ms-script-editor
          .script=${draft.script}
          .readonly=${!this.canEdit}
          @wui:scriptchange=${(e: CustomEvent<string>) => this.patch({ script: e.detail })}
        ></wui-ms-script-editor>
        <div class="section">
          <span class="title">${localizeDir(MSG.test.head)}</span>
          <div class="hint">${localizeDir(MSG.modelEditor.testDefaultsHint)}</div>
          <wui-ms-test-panel .task=${this.pseudoTask(draft)} .canTest=${this.canTest}></wui-ms-test-panel>
        </div>
      </div>
      <div class="footer">
        <span class="status">${this.savedFlash ? localizeDir(MSG.modelEditor.saved) : ''}</span>
        ${this.errors.length > 0 ? html`<span class="errors">${this.errors.map((key) => validationMsg(key)).join('\n')}</span>` : nothing}
        ${this.canEdit
          ? html`
              <ix-button outline icon="trashcan" @click=${this.remove}>${localizeDir(MSG.modelEditor.delete)}</ix-button>
              <ix-button variant="primary" icon="upload" ?disabled=${!this.isDirty()} @click=${this.save}>
                ${localizeDir(MSG.modelEditor.save)}
              </ix-button>
            `
          : nothing}
      </div>
    `;
  }

  private renderIoDecl(kind: 'inputs' | 'outputs'): TemplateResult {
    const draft = this.draft as MsModel;
    const rows = draft[kind];
    return html`
      <div class="section">
        <span class="title">${localizeDir(kind === 'inputs' ? MSG.modelEditor.inputsDecl : MSG.modelEditor.outputsDecl)}</span>
        ${rows.map(
          (row, index) => html`
            <div class="row">
              <ix-input
                class="alias"
                label=${index === 0 ? localize(MSG.modelEditor.alias) : ''}
                .value=${row.alias}
                ?disabled=${!this.canEdit}
                @valueChange=${(e: Event) => this.patchIoDecl(kind, index, { alias: (e.target as HTMLInputElement).value })}
              ></ix-input>
              <ix-input
                class="desc"
                label=${index === 0 ? localize(MSG.modelEditor.hint) : ''}
                .value=${row.description ?? ''}
                ?disabled=${!this.canEdit}
                @valueChange=${(e: Event) => this.patchIoDecl(kind, index, { description: (e.target as HTMLInputElement).value })}
              ></ix-input>
              ${this.canEdit
                ? html`<ix-icon-button
                    icon="trashcan"
                    size="16"
                    ghost
                    title=${localize(MSG.editor.removeRow)}
                    @click=${() => this.removeIoDecl(kind, index)}
                  ></ix-icon-button>`
                : nothing}
            </div>
          `
        )}
        ${this.canEdit
          ? html`<div>
              <ix-button ghost icon="plus" @click=${() => this.addIoDecl(kind)}>
                ${localizeDir(kind === 'inputs' ? MSG.editor.addInput : MSG.editor.addOutput)}
              </ix-button>
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderParams(draft: MsModel): TemplateResult {
    return html`
      <div class="section">
        <span class="title">${localizeDir(MSG.modelEditor.paramsDecl)}</span>
        ${draft.params.map(
          (param, index) => html`
            <div class="row">
              <ix-input
                class="alias"
                label=${index === 0 ? localize(MSG.modelEditor.paramName) : ''}
                .value=${param.name}
                ?disabled=${!this.canEdit}
                @valueChange=${(e: Event) => this.patchParam(index, { name: (e.target as HTMLInputElement).value })}
              ></ix-input>
              <ix-input
                class="alias"
                label=${index === 0 ? localize(MSG.modelEditor.paramDefault) : ''}
                .value=${param.defaultValue === undefined ? '' : JSON.stringify(param.defaultValue)}
                placeholder='90 · true · "texte"'
                ?disabled=${!this.canEdit}
                @valueChange=${(e: Event) => this.patchParamDefault(index, (e.target as HTMLInputElement).value)}
              ></ix-input>
              <ix-input
                class="desc"
                label=${index === 0 ? localize(MSG.modelEditor.hint) : ''}
                .value=${param.description ?? ''}
                ?disabled=${!this.canEdit}
                @valueChange=${(e: Event) => this.patchParam(index, { description: (e.target as HTMLInputElement).value })}
              ></ix-input>
              ${this.canEdit
                ? html`<ix-icon-button
                    icon="trashcan"
                    size="16"
                    ghost
                    title=${localize(MSG.editor.removeRow)}
                    @click=${() => this.removeParam(index)}
                  ></ix-icon-button>`
                : nothing}
            </div>
          `
        )}
        ${this.canEdit
          ? html`<div>
              <ix-button ghost icon="plus" @click=${this.addParam}>${localizeDir(MSG.modelEditor.addParam)}</ix-button>
            </div>`
          : nothing}
      </div>
    `;
  }

  /** Pseudo-task testing this model: declared aliases, defaults as params. */
  private pseudoTask(draft: MsModel): MsTask {
    const params: Record<string, unknown> = {};
    for (const decl of draft.params) params[decl.name] = decl.defaultValue;
    return {
      id: `model:${draft.id}`,
      name: draft.name,
      description: draft.description,
      enabled: false,
      trigger: { kind: 'dpe' },
      inputs: draft.inputs.map((decl) => ({ alias: decl.alias, dpe: '' })),
      outputs: draft.outputs.map((decl) => ({ alias: decl.alias, dpe: '' })),
      script: draft.script,
      modelId: null,
      params,
      timeoutMs: 1000,
      updatedAt: draft.updatedAt
    };
  }

  // ---- draft mutations --------------------------------------------------------

  private patch(partial: Partial<MsModel>): void {
    if (this.draft == null) return;
    this.draft = { ...this.draft, ...partial };
    this.savedFlash = false;
  }

  private patchIoDecl(kind: 'inputs' | 'outputs', index: number, partial: Partial<MsIoDecl>): void {
    if (this.draft == null) return;
    const rows = this.draft[kind].map((row, i) => (i === index ? { ...row, ...partial } : row));
    this.patch({ [kind]: rows } as Partial<MsModel>);
  }

  private addIoDecl(kind: 'inputs' | 'outputs'): void {
    if (this.draft == null) return;
    const alias = `${kind === 'inputs' ? 'in' : 'out'}${this.draft[kind].length + 1}`;
    this.patch({ [kind]: [...this.draft[kind], { alias }] } as Partial<MsModel>);
  }

  private removeIoDecl(kind: 'inputs' | 'outputs', index: number): void {
    if (this.draft == null) return;
    this.patch({ [kind]: this.draft[kind].filter((_row, i) => i !== index) } as Partial<MsModel>);
  }

  private patchParam(index: number, partial: Partial<MsParamDecl>): void {
    if (this.draft == null) return;
    this.patch({ params: this.draft.params.map((param, i) => (i === index ? { ...param, ...partial } : param)) });
  }

  private patchParamDefault(index: number, text: string): void {
    let value: unknown;
    const trimmed = text.trim();
    if (trimmed === '') {
      value = undefined;
    } else {
      try {
        value = JSON.parse(trimmed);
      } catch {
        value = trimmed; // lenient: bare text stays a string
      }
    }
    this.patchParam(index, { defaultValue: value });
  }

  private addParam = (): void => {
    if (this.draft == null) return;
    this.patch({ params: [...this.draft.params, { name: `param${this.draft.params.length + 1}` }] });
  };

  private removeParam(index: number): void {
    if (this.draft == null) return;
    this.patch({ params: this.draft.params.filter((_param, i) => i !== index) });
  }

  // ---- save / delete ------------------------------------------------------------

  private isDirty(): boolean {
    return this.model != null && this.draft != null && JSON.stringify(this.model) !== JSON.stringify(this.draft);
  }

  private save(): void {
    if (this.draft == null) return;
    const errors = validateModel(this.draft);
    this.errors = errors;
    if (errors.length > 0) return;
    const model: MsModel = { ...this.draft, updatedAt: new Date().toISOString() };
    this.draft = model;
    this.savedFlash = true;
    this.dispatchEvent(new CustomEvent('wui:modelsave', { detail: { model }, bubbles: true, composed: true }));
  }

  private remove(): void {
    if (this.draft == null) return;
    if (this.usageCount > 0) {
      this.errors = ['modelInUse'];
      return;
    }
    // eslint-disable-next-line no-alert -- deliberate minimal confirm for a destructive action
    if (!window.confirm(localize(MSG.modelEditor.deleteConfirm))) return;
    this.dispatchEvent(new CustomEvent('wui:modeldelete', { detail: { id: this.draft.id }, bubbles: true, composed: true }));
  }
}

if (!customElements.get('wui-ms-model-editor')) {
  customElements.define('wui-ms-model-editor', WuiMsModelEditor);
}
