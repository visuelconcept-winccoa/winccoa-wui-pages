// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Middleware-Script master panel: TASKS and reusable MODELS behind a mode
 * switch.
 *
 * Tasks render with their trigger kind, enabled state, model badge and LIVE
 * execution status (fed by the page through the `statuses` map — dpConnect on
 * the tasks' `.status` elements); models render with their instance count.
 * Emits `wui:taskselect` / `wui:modelselect` with the id, and `wui:modechange`
 * when switching lists.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir, modelUsedByMsg, taskModelBadgeMsg } from './i18n.js';
import type { MsModel, MsTask, MsTaskStatus } from './types.js';

export type MsListMode = 'tasks' | 'models';

export class WuiMsTaskList extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        border-right: 1px solid var(--theme-color-soft-bdr);
        background: var(--theme-color-1);
      }
      .toolbar {
        padding: 0.5rem;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
        flex-shrink: 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .mode {
        display: flex;
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
        overflow: hidden;
      }
      .mode button {
        flex: 1;
        padding: 0.375rem 0.5rem;
        border: none;
        background: transparent;
        color: var(--theme-color-soft-text);
        font: inherit;
        font-size: 0.8125rem;
        cursor: pointer;
      }
      .mode button.active {
        background: var(--theme-color-primary);
        color: var(--theme-color-primary--contrast);
        font-weight: 600;
      }
      .rows {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .row {
        display: flex;
        flex-direction: column;
        gap: 0.125rem;
        width: 100%;
        text-align: left;
        padding: 0.5rem 0.75rem;
        border: none;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }
      .row:hover {
        background: var(--theme-color-2);
      }
      .row.selected {
        background: var(--theme-color-primary);
        color: var(--theme-color-primary--contrast);
      }
      .row .title {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-weight: 600;
      }
      .row .title .name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .row .meta {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.6875rem;
        color: var(--theme-color-soft-text);
      }
      .row.selected .meta {
        color: inherit;
      }
      .dot {
        width: 0.5rem;
        height: 0.5rem;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--theme-color-soft-bdr);
      }
      .dot.idle {
        background: var(--theme-color-success);
      }
      .dot.running {
        background: var(--theme-color-dynamic);
      }
      .dot.error {
        background: var(--theme-color-alarm);
      }
      .badge {
        font-size: 0.625rem;
        line-height: 1;
        padding: 0.125rem 0.3125rem;
        border-radius: var(--theme-default-border-radius);
        border: 1px solid var(--theme-color-soft-bdr);
        font-family: monospace;
        white-space: nowrap;
      }
      .message {
        padding: 0.75rem;
        color: var(--theme-color-soft-text);
        font-size: 0.8125rem;
      }
    `
  ];

  @property({ attribute: false }) tasks: MsTask[] = [];
  @property({ attribute: false }) models: MsModel[] = [];
  /** Model id → number of tasks instantiating it. */
  @property({ attribute: false }) usage = new Map<string, number>();
  @property({ attribute: false }) statuses = new Map<string, MsTaskStatus>();
  @property({ type: String }) mode: MsListMode = 'tasks';
  @property({ type: String }) selectedId: string | null = null;

  @state() private filter = '';

  override render(): TemplateResult {
    const needle = this.filter.trim().toLowerCase();
    return html`
      <div class="toolbar">
        <div class="mode">
          <button class=${this.mode === 'tasks' ? 'active' : ''} @click=${() => this.setMode('tasks')}>
            ${localizeDir(MSG.list.modeTasks)}
          </button>
          <button class=${this.mode === 'models' ? 'active' : ''} @click=${() => this.setMode('models')}>
            ${localizeDir(MSG.list.modeModels)}
          </button>
        </div>
        <ix-input
          .value=${this.filter}
          placeholder=${localize(MSG.list.filter)}
          @valueChange=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
        ></ix-input>
      </div>
      <div class="rows">${this.mode === 'models' ? this.renderModels(needle) : this.renderTasks(needle)}</div>
    `;
  }

  private renderTasks(needle: string): TemplateResult {
    const visible = needle === '' ? this.tasks : this.tasks.filter((task) => task.name.toLowerCase().includes(needle));
    if (visible.length === 0) {
      return html`<div class="message">${localizeDir(MSG.page.noTasks)}</div>`;
    }
    return html`${visible.map((task) => this.renderRow(task))}`;
  }

  private renderModels(needle: string): TemplateResult {
    const visible = needle === '' ? this.models : this.models.filter((model) => model.name.toLowerCase().includes(needle));
    if (visible.length === 0) {
      return html`<div class="message">${localizeDir(MSG.page.noModels)}</div>`;
    }
    return html`${visible.map(
      (model) => html`
        <button class="row ${model.id === this.selectedId ? 'selected' : ''}" @click=${() => this.selectModel(model)}>
          <span class="title">
            <span class="name">${model.name}</span>
          </span>
          <span class="meta">
            <span class="badge">${modelUsedByMsg(this.usage.get(model.id) ?? 0)}</span>
            <span>${model.description}</span>
          </span>
        </button>
      `
    )}`;
  }

  private setMode(mode: MsListMode): void {
    if (mode !== this.mode) {
      this.dispatchEvent(new CustomEvent('wui:modechange', { detail: { mode }, bubbles: true, composed: true }));
    }
  }

  private selectModel(model: MsModel): void {
    this.dispatchEvent(new CustomEvent('wui:modelselect', { detail: { id: model.id }, bubbles: true, composed: true }));
  }

  private renderRow(task: MsTask): TemplateResult {
    const status = this.statuses.get(task.id);
    return html`
      <button class="row ${task.id === this.selectedId ? 'selected' : ''}" @click=${() => this.select(task)}>
        <span class="title">
          <span class="dot ${this.dotClass(task, status)}" title=${this.stateLabel(task, status)}></span>
          <span class="name">${task.name}</span>
        </span>
        <span class="meta">
          <span class="badge">${localize(task.trigger.kind === 'cyclic' ? MSG.list.triggerCyclic : MSG.list.triggerDpe)}</span>
          ${task.modelId != null
            ? html`<span class="badge">${taskModelBadgeMsg(this.models.find((m) => m.id === task.modelId)?.name ?? task.modelId)}</span>`
            : ''}
          <span>${localize(task.enabled ? MSG.list.enabled : MSG.list.disabled)}</span>
          ${status?.lastError ? html`<span title=${status.lastError}>⚠</span>` : ''}
        </span>
      </button>
    `;
  }

  private dotClass(task: MsTask, status: MsTaskStatus | undefined): string {
    if (!task.enabled) return '';
    if (status == null) return '';
    if (status.state === 'error') return 'error';
    if (status.state === 'running') return 'running';
    return 'idle';
  }

  private stateLabel(task: MsTask, status: MsTaskStatus | undefined): string {
    if (!task.enabled) return localize(MSG.list.stateDisabled);
    if (status == null) return localize(MSG.list.stateUnknown);
    if (status.state === 'error') return `${localize(MSG.list.stateError)}: ${status.lastError ?? ''}`;
    return localize(status.state === 'running' ? MSG.list.stateRunning : MSG.list.stateIdle);
  }

  private select(task: MsTask): void {
    this.dispatchEvent(new CustomEvent('wui:taskselect', { detail: { id: task.id }, bubbles: true, composed: true }));
  }
}

if (!customElements.get('wui-ms-task-list')) {
  customElements.define('wui-ms-task-list', WuiMsTaskList);
}
