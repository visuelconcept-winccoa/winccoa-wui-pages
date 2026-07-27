// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Middleware-Script task editor (detail panel).
 *
 * Edits a DRAFT copy of the selected task in three tabs — Script /
 * IO & trigger / Test — and emits:
 *   `wui:tasksave`   detail { task }  (validated draft)
 *   `wui:taskdelete` detail { id }
 *
 * Role gating (props from the page): `canEdit` opens the fields and Save/
 * Delete; `canControl` opens the enable toggle; `canTest` opens the dry-run.
 * The Test tab always tests the CURRENT draft (unsaved edits included).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import './ms-script-editor.js';
import './ms-test-panel.js';
import { MSG, localize, localizeDir, validationMsg } from './i18n.js';
import {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_INTERVAL_S,
  validateTask,
  type MsIoBinding,
  type MsTask,
  type MsTrigger
} from './types.js';

const TAB_SCRIPT = 0;
const TAB_IO = 1;
const TAB_TEST = 2;

/** DPE existence probes: alias -> ok/ko (transient UI state). */
type ProbeMap = Map<string, boolean>;

export class WuiMsEditor extends LitElement {
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
      .enable {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
      }
      .dirty {
        font-size: 0.75rem;
        color: var(--theme-color-warning, #d9822b);
      }
      ix-tabs {
        flex-shrink: 0;
        padding: 0 0.5rem;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
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
      .body > wui-ms-script-editor {
        flex: 1;
        min-height: 0;
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
      .grid {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        align-items: flex-end;
      }
      .grid > * {
        min-width: 9rem;
      }
      .io-row {
        display: flex;
        align-items: center;
        gap: 0.375rem;
      }
      .io-row .alias {
        flex: 0 0 11rem;
      }
      .io-row .dpe {
        flex: 1;
        min-width: 10rem;
      }
      .probe {
        font-size: 0.75rem;
        width: 1.25rem;
        text-align: center;
      }
      .probe.ok {
        color: var(--theme-color-success);
      }
      .probe.ko {
        color: var(--theme-color-alarm);
      }
      .hint {
        font-size: 0.75rem;
        color: var(--theme-color-soft-text);
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

  /** Selected task (the editor works on an internal draft copy). */
  @property({ attribute: false }) task: MsTask | null = null;
  @property({ type: Boolean }) canEdit = true;
  @property({ type: Boolean }) canControl = true;
  @property({ type: Boolean }) canTest = true;

  @state() private draft: MsTask | null = null;
  @state() private activeTab = TAB_SCRIPT;
  @state() private errors: string[] = [];
  @state() private probes: ProbeMap = new Map();
  @state() private savedFlash = false;

  private readonly api = this.resolveApi();

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('task')) {
      // A (re)selected task resets the draft; same-id refreshes keep local edits.
      const previous = changed.get('task') as MsTask | null | undefined;
      if (this.task == null) {
        this.draft = null;
      } else if (previous == null || previous.id !== this.task.id || this.draft == null) {
        this.draft = structuredClone(this.task);
        this.errors = [];
        this.probes = new Map();
        this.savedFlash = false;
      }
    }
  }

  override render(): TemplateResult {
    const draft = this.draft;
    if (draft == null) {
      return html`<div class="body"><div class="hint">${localizeDir(MSG.page.selectTask)}</div></div>`;
    }
    return html`
      <div class="head">
        <ix-input
          label=${localize(MSG.editor.name)}
          .value=${draft.name}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: Event) => this.patch({ name: (e.target as HTMLInputElement).value })}
        ></ix-input>
        <label class="enable">
          <ix-toggle
            .checked=${draft.enabled}
            ?disabled=${!this.canControl}
            @checkedChange=${(e: Event) => this.patch({ enabled: (e.target as HTMLInputElement).checked })}
          ></ix-toggle>
          ${localizeDir(MSG.editor.enable)}
        </label>
        ${this.isDirty() ? html`<span class="dirty">● ${localizeDir(MSG.editor.unsaved)}</span>` : nothing}
      </div>
      <ix-tabs .selected=${this.activeTab} @selectedChange=${(e: CustomEvent<number>) => (this.activeTab = e.detail)}>
        <ix-tab-item>${localizeDir(MSG.editor.tabScript)}</ix-tab-item>
        <ix-tab-item>${localizeDir(MSG.editor.tabIo)}</ix-tab-item>
        <ix-tab-item>${localizeDir(MSG.editor.tabTest)}</ix-tab-item>
      </ix-tabs>
      <div class="body">${this.renderTab(draft)}</div>
      <div class="footer">
        <span class="status">${this.savedFlash ? localizeDir(MSG.editor.saved) : ''}</span>
        ${this.errors.length > 0 ? html`<span class="errors">${this.errors.map((key) => validationMsg(key)).join('\n')}</span>` : nothing}
        ${this.canEdit
          ? html`
              <ix-button outline icon="trashcan" @click=${this.remove}>${localizeDir(MSG.editor.delete)}</ix-button>
              <ix-button variant="primary" icon="upload" ?disabled=${!this.isDirty()} @click=${this.save}>
                ${localizeDir(MSG.editor.save)}
              </ix-button>
            `
          : nothing}
      </div>
    `;
  }

  private renderTab(draft: MsTask): TemplateResult {
    if (this.activeTab === TAB_IO) {
      return this.renderIoTab(draft);
    }
    if (this.activeTab === TAB_TEST) {
      return html`<wui-ms-test-panel .task=${draft} .canTest=${this.canTest}></wui-ms-test-panel>`;
    }
    return html`
      <ix-textarea
        label=${localize(MSG.editor.description)}
        .value=${draft.description}
        rows="2"
        ?disabled=${!this.canEdit}
        @valueChange=${(e: CustomEvent<string>) => this.patch({ description: e.detail })}
      ></ix-textarea>
      <wui-ms-script-editor
        .script=${draft.script}
        .readonly=${!this.canEdit}
        @wui:scriptchange=${(e: CustomEvent<string>) => this.patch({ script: e.detail })}
      ></wui-ms-script-editor>
    `;
  }

  private renderIoTab(draft: MsTask): TemplateResult {
    return html`
      <div class="section">
        <span class="title">${localizeDir(MSG.editor.triggerHead)}</span>
        <div class="grid">
          <ix-select
            .value=${draft.trigger.kind}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: CustomEvent<string | string[]>) => this.setTriggerKind(e.detail)}
          >
            <ix-select-item label=${localize(MSG.editor.triggerDpe)} value="dpe"></ix-select-item>
            <ix-select-item label=${localize(MSG.editor.triggerCyclic)} value="cyclic"></ix-select-item>
          </ix-select>
          ${draft.trigger.kind === 'cyclic'
            ? html`<ix-number-input
                label=${localize(MSG.editor.interval)}
                min="1"
                .value=${draft.trigger.intervalS ?? DEFAULT_INTERVAL_S}
                ?disabled=${!this.canEdit}
                @valueChange=${(e: CustomEvent<number>) => this.patchTrigger({ intervalS: Number(e.detail) })}
              ></ix-number-input>`
            : html`<ix-number-input
                label=${localize(MSG.editor.debounce)}
                min="0"
                .value=${draft.trigger.debounceMs ?? DEFAULT_DEBOUNCE_MS}
                ?disabled=${!this.canEdit}
                @valueChange=${(e: CustomEvent<number>) => this.patchTrigger({ debounceMs: Number(e.detail) })}
              ></ix-number-input>`}
          <ix-number-input
            label=${localize(MSG.editor.timeout)}
            min="50"
            .value=${draft.timeoutMs}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: CustomEvent<number>) => this.patch({ timeoutMs: Number(e.detail) })}
          ></ix-number-input>
        </div>
      </div>
      <div class="hint">${localizeDir(MSG.editor.ioHint)}</div>
      ${this.renderIoList(draft, 'inputs')}
      ${this.renderIoList(draft, 'outputs')}
    `;
  }

  private renderIoList(draft: MsTask, kind: 'inputs' | 'outputs'): TemplateResult {
    const rows = draft[kind];
    return html`
      <div class="section">
        <span class="title">${localizeDir(kind === 'inputs' ? MSG.editor.inputsHead : MSG.editor.outputsHead)}</span>
        ${rows.map((row, index) => this.renderIoRow(kind, row, index))}
        ${this.canEdit
          ? html`<div>
              <ix-button ghost icon="plus" @click=${() => this.addIoRow(kind)}>
                ${localizeDir(kind === 'inputs' ? MSG.editor.addInput : MSG.editor.addOutput)}
              </ix-button>
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderIoRow(kind: 'inputs' | 'outputs', row: MsIoBinding, index: number): TemplateResult {
    const probe = this.probes.get(`${kind}:${index}`);
    return html`
      <div class="io-row">
        <ix-input
          class="alias"
          label=${index === 0 ? localize(MSG.editor.alias) : ''}
          .value=${row.alias}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: Event) => this.patchIoRow(kind, index, { alias: (e.target as HTMLInputElement).value })}
        ></ix-input>
        <ix-input
          class="dpe"
          label=${index === 0 ? localize(MSG.editor.dpe) : ''}
          .value=${row.dpe}
          placeholder=${localize(MSG.editor.dpePlaceholder)}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: Event) => this.patchIoRow(kind, index, { dpe: (e.target as HTMLInputElement).value })}
        ></ix-input>
        <span class="probe ${probe === true ? 'ok' : probe === false ? 'ko' : ''}"
          title=${probe === true ? localize(MSG.editor.probeOk) : probe === false ? localize(MSG.editor.probeKo) : ''}
          >${probe === true ? '✓' : probe === false ? '✗' : ''}</span
        >
        <ix-icon-button
          icon="search"
          size="16"
          ghost
          ?disabled=${this.api == null || row.dpe.trim() === ''}
          title=${localize(MSG.editor.probe)}
          @click=${() => this.probeDpe(kind, index, row.dpe)}
        ></ix-icon-button>
        ${this.canEdit
          ? html`<ix-icon-button
              icon="trashcan"
              size="16"
              ghost
              title=${localize(MSG.editor.removeRow)}
              @click=${() => this.removeIoRow(kind, index)}
            ></ix-icon-button>`
          : nothing}
      </div>
    `;
  }

  // ---- draft mutations --------------------------------------------------------

  private patch(partial: Partial<MsTask>): void {
    if (this.draft == null) return;
    this.draft = { ...this.draft, ...partial };
    this.savedFlash = false;
  }

  private patchTrigger(partial: Partial<MsTrigger>): void {
    if (this.draft == null) return;
    this.patch({ trigger: { ...this.draft.trigger, ...partial } });
  }

  private setTriggerKind(detail: string | string[]): void {
    const kind = (Array.isArray(detail) ? detail[0] : detail) === 'cyclic' ? 'cyclic' : 'dpe';
    if (this.draft == null) return;
    this.patch({
      trigger:
        kind === 'cyclic'
          ? { kind, intervalS: this.draft.trigger.intervalS ?? DEFAULT_INTERVAL_S }
          : { kind, debounceMs: this.draft.trigger.debounceMs ?? DEFAULT_DEBOUNCE_MS }
    });
  }

  private patchIoRow(kind: 'inputs' | 'outputs', index: number, partial: Partial<MsIoBinding>): void {
    if (this.draft == null) return;
    const rows = this.draft[kind].map((row, i) => (i === index ? { ...row, ...partial } : row));
    this.patch({ [kind]: rows } as Partial<MsTask>);
  }

  private addIoRow(kind: 'inputs' | 'outputs'): void {
    if (this.draft == null) return;
    const alias = `${kind === 'inputs' ? 'in' : 'out'}${this.draft[kind].length + 1}`;
    this.patch({ [kind]: [...this.draft[kind], { alias, dpe: '' }] } as Partial<MsTask>);
  }

  private removeIoRow(kind: 'inputs' | 'outputs', index: number): void {
    if (this.draft == null) return;
    this.patch({ [kind]: this.draft[kind].filter((_row, i) => i !== index) } as Partial<MsTask>);
  }

  /** dpGet existence probe of one DPE (✓ readable / ✗ not). */
  private async probeDpe(kind: 'inputs' | 'outputs', index: number, dpe: string): Promise<void> {
    if (this.api == null) return;
    const key = `${kind}:${index}`;
    try {
      await firstValueFrom(this.api.dpGet(dpe));
      this.probes = new Map(this.probes).set(key, true);
    } catch {
      this.probes = new Map(this.probes).set(key, false);
    }
  }

  // ---- save / delete ------------------------------------------------------------

  private isDirty(): boolean {
    return this.task != null && this.draft != null && JSON.stringify(this.task) !== JSON.stringify(this.draft);
  }

  private save(): void {
    if (this.draft == null) return;
    const errors = validateTask(this.draft);
    this.errors = errors;
    if (errors.length > 0) return;
    const task: MsTask = { ...this.draft, updatedAt: new Date().toISOString() };
    this.draft = task;
    this.savedFlash = true;
    this.dispatchEvent(new CustomEvent('wui:tasksave', { detail: { task }, bubbles: true, composed: true }));
  }

  private remove(): void {
    if (this.draft == null) return;
    // eslint-disable-next-line no-alert -- deliberate minimal confirm for a destructive action
    if (!window.confirm(localize(MSG.editor.deleteConfirm))) return;
    this.dispatchEvent(new CustomEvent('wui:taskdelete', { detail: { id: this.draft.id }, bubbles: true, composed: true }));
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

if (!customElements.get('wui-ms-editor')) {
  customElements.define('wui-ms-editor', WuiMsEditor);
}
