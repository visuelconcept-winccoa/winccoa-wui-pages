// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Task persistence for the Middleware-Script page.
 *
 * Wraps the shared kit {@link DpJsonStore} (one `MiddlewareScript_Task_<id>` DP
 * per task, GxP audit rows into `AuditTrail_MiddlewareScript`) with one twist:
 * the backing DP type carries a THIRD String element `.status`, written ONLY by
 * the `middlewareScript` manager (execution state) — so the type is ensured
 * here, with all three elements, BEFORE the kit store's own 2-element
 * `ensureType` probe runs (the probe then finds it and creates nothing).
 *
 * Live status is exposed as an observable keyed by task id (one dpConnect over
 * every `.status` element, re-issued on `watchStatuses` calls after the task
 * list changed).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { Observable, map } from 'rxjs';
import { container } from 'tsyringe';
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { localize, ml } from './i18n.js';
import { newTask, normalizeModel, normalizeTask, type MsModel, type MsTask, type MsTaskStatus } from './types.js';

export const TASK_TYPE = 'MiddlewareScript_Task';
export const TASK_PREFIX = 'MiddlewareScript_Task_';
export const MODEL_TYPE = 'MiddlewareScript_Model';
export const MODEL_PREFIX = 'MiddlewareScript_Model_';

const CREATE_TYPE_URL = '/api/para/dptype/create';
const TYPE_PROBE_URL = `/api/para/dptype/${encodeURIComponent(TASK_TYPE)}`;
const HTTP_BAD_REQUEST = 400;

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** Offline demo seed (kit-store convention when the backend is unreachable). */
function demoTasks(): MsTask[] {
  const demo = newTask(localize(ml('Demo — level alarm', 'Démo — alarme de niveau', 'Demo — Füllstandsalarm')));
  demo.id = 'demo';
  demo.description = localize(
    ml('Offline example (backend unreachable).', 'Exemple hors-ligne (backend injoignable).', 'Offline-Beispiel (Backend nicht erreichbar).')
  );
  demo.inputs = [{ alias: 'level', dpe: 'System1:ExampleDP_Arg1.' }];
  demo.outputs = [{ alias: 'alarm', dpe: 'System1:ExampleDP_Result.' }];
  demo.script = 'output("alarm", inputs.level > 90);';
  return [demo];
}

export class MsTaskStore {
  private readonly store = new DpJsonStore<MsTask>(
    TASK_TYPE,
    TASK_PREFIX,
    (task) => task.name,
    demoTasks,
    {
      slugFallback: 'task',
      afterRead: normalizeTask,
      audit: { dpName: 'AuditTrail_MiddlewareScript', itemType: 'MiddlewareScript', exclude: ['updatedAt'] }
    }
  );

  private typeEnsured = false;

  get offline(): boolean {
    return this.store.offline;
  }

  async list(): Promise<MsTask[]> {
    await this.ensureTaskType();
    return this.store.list();
  }

  async create(task: MsTask): Promise<MsTask> {
    await this.ensureTaskType();
    return this.store.create(task);
  }

  async save(task: MsTask): Promise<void> {
    await this.store.save(task);
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }

  /** `.status` DPE of a task (manager-written execution state). */
  statusPath(task: MsTask): string {
    return `${task.dp ?? TASK_PREFIX + task.id}.status`;
  }

  /**
   * Live execution status per task id. One dpConnect over every task's
   * `.status`; a task without a running manager simply never emits.
   */
  watchStatuses(tasks: MsTask[]): Observable<Map<string, MsTaskStatus>> {
    const api = this.resolveApi();
    const statuses = new Map<string, MsTaskStatus>();
    if (!api || tasks.length === 0) {
      return new Observable((subscriber) => subscriber.next(statuses));
    }
    const pathToId = new Map(tasks.map((task) => [this.statusPath(task), task.id]));
    return api.dpConnect([...pathToId.keys()], true).pipe(
      map((data) => {
        const dps = Array.isArray(data.dp) ? data.dp : [data.dp];
        const values = Array.isArray(data.value) ? data.value : [data.value];
        for (const [index, path] of dps.entries()) {
          const id = pathToId.get(String(path));
          const parsed = this.parseStatus(values[index]);
          if (id != null && parsed != null) statuses.set(id, parsed);
        }
        return new Map(statuses);
      })
    );
  }

  private parseStatus(raw: unknown): MsTaskStatus | null {
    const text = typeof raw === 'string' ? raw : '';
    if (!text.startsWith('{')) return null;
    try {
      return JSON.parse(text) as MsTaskStatus;
    } catch {
      return null;
    }
  }

  /**
   * Ensure the 3-element task type (name/json/status) exists BEFORE the kit
   * store's 2-element ensureType probe. 400 = already exists (fine).
   */
  private async ensureTaskType(): Promise<void> {
    if (this.typeEnsured) return;
    try {
      const probe = await fetch(TYPE_PROBE_URL);
      if (probe.ok) {
        this.typeEnsured = true;
        return;
      }
      const res = await fetch(
        CREATE_TYPE_URL,
        jsonPost({
          typeName: TASK_TYPE,
          structure: {
            name: TASK_TYPE,
            type: 'Struct',
            children: [
              { name: 'name', type: 'String', refName: '' },
              { name: 'json', type: 'String', refName: '' },
              { name: 'status', type: 'String', refName: '' }
            ]
          }
        })
      );
      this.typeEnsured = res.ok || res.status === HTTP_BAD_REQUEST;
    } catch {
      // Backend unreachable — the kit store flips offline on its own probe.
    }
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

/** Offline demo seed for the models store. */
function demoModels(): MsModel[] {
  return [];
}

/**
 * Reusable script models — plain kit DpJsonStore (2-element name/json type,
 * created by the kit itself; models carry no runtime status element). Audited
 * into the same GxP trail as the tasks, with its own item type.
 */
export class MsModelStore {
  private readonly store = new DpJsonStore<MsModel>(
    MODEL_TYPE,
    MODEL_PREFIX,
    (model) => model.name,
    demoModels,
    {
      slugFallback: 'model',
      afterRead: normalizeModel,
      audit: { dpName: 'AuditTrail_MiddlewareScript', itemType: 'MiddlewareScriptModel', exclude: ['updatedAt'] }
    }
  );

  get offline(): boolean {
    return this.store.offline;
  }

  async list(): Promise<MsModel[]> {
    return this.store.list();
  }

  async create(model: MsModel): Promise<MsModel> {
    return this.store.create(model);
  }

  async save(model: MsModel): Promise<void> {
    await this.store.save(model);
  }

  async remove(id: string): Promise<void> {
    await this.store.remove(id);
  }
}
