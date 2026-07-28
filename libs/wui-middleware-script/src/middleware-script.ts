// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Middleware-Script page — author small sandboxed JavaScript tasks that
 * implement logic BETWEEN datapoints.
 *
 * Master/detail: wui-ms-task-list (tasks + live execution status) on the left,
 * wui-ms-editor (Script / IO & trigger / Test tabs) on the right.
 *
 * - Tasks persist as `MiddlewareScript_Task_<id>` DPs via the kit DpJsonStore
 *   (`.json` config written here; `.status` written ONLY by the manager).
 * - Execution happens server-side on the `middlewareScript` JS manager (worker
 *   sandbox, declared-outputs-only writes); this page only edits and tests.
 * - Dry-run tests go through `POST /api/middleware-script/test` (bridge to the
 *   MiddlewareScript MSA service). Without the manager the page still edits
 *   tasks — only Test answers 503 and the status dots stay grey.
 *
 * Application-Security roles (registered from app-security.roles.json):
 * `view`, `edit` (fields + save/delete), `test` (dry-run), `control` (enable).
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import './middleware-script/ms-editor.js';
import './middleware-script/ms-model-editor.js';
import './middleware-script/ms-task-list.js';
import type { MsListMode } from './middleware-script/ms-task-list.js';
import { MSG, localize, localizeDir, loadFailedMsg, saveFailedMsg } from './middleware-script/i18n.js';
import { MsModelStore, MsTaskStore } from './middleware-script/store.js';
import { newModel, newTask, type MsModel, type MsTask, type MsTaskStatus } from './middleware-script/types.js';

export class WuiMiddlewareScript extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
      }
      .topbar {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .topbar wui-context-generator {
        flex: 1;
        min-width: 0;
      }
      .topbar .actions {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        flex-shrink: 0;
        padding-right: 0.75rem;
      }
      .msg {
        font-size: 0.75rem;
        max-width: 22rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .msg.err {
        color: var(--theme-color-alarm);
      }
      .msg.warn {
        color: var(--theme-color-warning, #d9822b);
      }
      .split {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      wui-ms-task-list {
        width: 20rem;
        flex-shrink: 0;
      }
      wui-ms-editor,
      wui-ms-model-editor {
        flex: 1;
        min-width: 0;
      }
      .hidden {
        display: none !important;
      }
    `
  ];

  @state() private tasks: MsTask[] = [];
  @state() private models: MsModel[] = [];
  @state() private statuses = new Map<string, MsTaskStatus>();
  @state() private listMode: MsListMode = 'tasks';
  @state() private selectedId: string | null = null;
  @state() private selectedModelId: string | null = null;
  @state() private error = '';
  @state() private offline = false;

  /** Application-Security grants (open until an admin assigns groups). */
  @state() private roleEdit = true;
  @state() private roleTest = true;
  @state() private roleControl = true;

  private readonly store = new MsTaskStore();
  private readonly modelStore = new MsModelStore();
  private roleSubs = new Subscription();
  private statusSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles (single source of
    // truth: the module's own app-security.roles.json fragment).
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSubs.add(hasRole$('middleware-script', 'edit').subscribe((granted) => (this.roleEdit = granted)));
    this.roleSubs.add(hasRole$('middleware-script', 'test').subscribe((granted) => (this.roleTest = granted)));
    this.roleSubs.add(hasRole$('middleware-script', 'control').subscribe((granted) => (this.roleControl = granted)));
    void this.reload();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSubs.unsubscribe();
    this.roleSubs = new Subscription();
    this.statusSub.unsubscribe();
    this.statusSub = new Subscription();
  }

  /** Model id → number of tasks instantiating it. */
  private modelUsage(): Map<string, number> {
    const usage = new Map<string, number>();
    for (const task of this.tasks) {
      if (task.modelId != null) usage.set(task.modelId, (usage.get(task.modelId) ?? 0) + 1);
    }
    return usage;
  }

  override render(): TemplateResult {
    const selected = this.tasks.find((task) => task.id === this.selectedId) ?? null;
    const selectedModel = this.models.find((model) => model.id === this.selectedModelId) ?? null;
    const usage = this.modelUsage();
    return html`
      <div class="topbar">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'Middleware Script',
                'de_AT.utf8': 'Middleware-Skript'
              }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>
        <div class="actions">
          ${this.error === '' ? nothing : html`<span class="msg err">${this.error}</span>`}
          ${this.offline ? html`<span class="msg warn">${localizeDir(MSG.page.offline)}</span>` : nothing}
          <ix-icon-button icon="refresh" variant="secondary" title=${localize(MSG.list.reload)} @click=${() => void this.reload()}></ix-icon-button>
          ${this.roleEdit
            ? html`<ix-button variant="primary" icon="plus" @click=${() => void this.createEntity()}>
                ${localizeDir(this.listMode === 'models' ? MSG.page.newModel : MSG.page.newTask)}
              </ix-button>`
            : nothing}
        </div>
      </div>
      <div class="split">
        <wui-ms-task-list
          .tasks=${this.tasks}
          .models=${this.models}
          .usage=${usage}
          .statuses=${this.statuses}
          .mode=${this.listMode}
          .selectedId=${this.listMode === 'models' ? this.selectedModelId : this.selectedId}
          @wui:modechange=${(e: CustomEvent<{ mode: MsListMode }>) => (this.listMode = e.detail.mode)}
          @wui:taskselect=${(e: CustomEvent<{ id: string }>) => (this.selectedId = e.detail.id)}
          @wui:modelselect=${(e: CustomEvent<{ id: string }>) => (this.selectedModelId = e.detail.id)}
        ></wui-ms-task-list>
        <!-- Both editors stay mounted; the inactive one is hidden (same pattern
             as the para tabs) so drafts survive switching Tasks <-> Models. -->
        <wui-ms-editor
          class=${this.listMode === 'models' ? 'hidden' : ''}
          .task=${selected}
          .models=${this.models}
          .status=${selected == null ? null : (this.statuses.get(selected.id) ?? null)}
          .canEdit=${this.roleEdit}
          .canControl=${this.roleControl}
          .canTest=${this.roleTest}
          @wui:tasksave=${this.onSave}
          @wui:taskdelete=${this.onDelete}
        ></wui-ms-editor>
        <wui-ms-model-editor
          class=${this.listMode === 'models' ? '' : 'hidden'}
          .model=${selectedModel}
          .usageCount=${selectedModel == null ? 0 : (usage.get(selectedModel.id) ?? 0)}
          .canEdit=${this.roleEdit}
          .canTest=${this.roleTest}
          @wui:modelsave=${this.onModelSave}
          @wui:modeldelete=${this.onModelDelete}
        ></wui-ms-model-editor>
      </div>
    `;
  }

  private async reload(): Promise<void> {
    this.error = '';
    try {
      this.tasks = await this.store.list();
      this.models = await this.modelStore.list();
      this.offline = this.store.offline;
      if (this.selectedId != null && !this.tasks.some((task) => task.id === this.selectedId)) {
        this.selectedId = null;
      }
      if (this.selectedModelId != null && !this.models.some((model) => model.id === this.selectedModelId)) {
        this.selectedModelId = null;
      }
      this.watchStatuses();
    } catch (error) {
      this.error = loadFailedMsg(String(error));
    }
  }

  private createEntity(): Promise<void> {
    return this.listMode === 'models' ? this.createModel() : this.createTask();
  }

  private async createModel(): Promise<void> {
    this.error = '';
    try {
      const created = await this.modelStore.create(newModel(localize(MSG.page.defaultModelName)));
      this.models = [...this.models, created];
      this.selectedModelId = created.id;
    } catch (error) {
      this.error = saveFailedMsg(String(error));
    }
  }

  private async onModelSave(event: CustomEvent<{ model: MsModel }>): Promise<void> {
    this.error = '';
    const model = event.detail.model;
    try {
      await this.modelStore.save(model);
      this.models = this.models.map((item) => (item.id === model.id ? model : item));
    } catch (error) {
      this.error = saveFailedMsg(String(error));
    }
  }

  private async onModelDelete(event: CustomEvent<{ id: string }>): Promise<void> {
    this.error = '';
    try {
      await this.modelStore.remove(event.detail.id);
      this.models = this.models.filter((model) => model.id !== event.detail.id);
      if (this.selectedModelId === event.detail.id) {
        this.selectedModelId = null;
      }
    } catch (error) {
      this.error = saveFailedMsg(String(error));
    }
  }

  /** (Re)subscribe the live `.status` connection over the current task list. */
  private watchStatuses(): void {
    this.statusSub.unsubscribe();
    this.statusSub = new Subscription();
    if (this.offline || this.tasks.length === 0) {
      this.statuses = new Map();
      return;
    }
    this.statusSub.add(
      this.store.watchStatuses(this.tasks).subscribe({
        next: (statuses) => (this.statuses = statuses),
        error: () => {
          /* no live status (manager stopped / connection lost) — dots stay grey */
        }
      })
    );
  }

  private async createTask(): Promise<void> {
    this.error = '';
    try {
      const created = await this.store.create(newTask(localize(MSG.page.defaultTaskName)));
      this.tasks = [...this.tasks, created];
      this.selectedId = created.id;
      this.offline = this.store.offline;
      this.watchStatuses();
    } catch (error) {
      this.error = saveFailedMsg(String(error));
    }
  }

  private async onSave(event: CustomEvent<{ task: MsTask }>): Promise<void> {
    this.error = '';
    const task = event.detail.task;
    try {
      await this.store.save(task);
      this.tasks = this.tasks.map((item) => (item.id === task.id ? task : item));
    } catch (error) {
      this.error = saveFailedMsg(String(error));
    }
  }

  private async onDelete(event: CustomEvent<{ id: string }>): Promise<void> {
    this.error = '';
    try {
      await this.store.remove(event.detail.id);
      this.tasks = this.tasks.filter((task) => task.id !== event.detail.id);
      if (this.selectedId === event.detail.id) {
        this.selectedId = null;
      }
      this.watchStatuses();
    } catch (error) {
      this.error = saveFailedMsg(String(error));
    }
  }
}

if (!customElements.get('wui-middleware-script')) {
  customElements.define('wui-middleware-script', WuiMiddlewareScript);
}
