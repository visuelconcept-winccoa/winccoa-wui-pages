// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Middleware-Script task model.
 *
 * A task is a small sandboxed JavaScript body executed server-side by the
 * `middlewareScript` manager. Its I/O surface is DECLARED: the script reads the
 * `inputs` aliases and writes ONLY through `output(alias, value)` on declared
 * output aliases — it has no arbitrary dpSet. The task config persists in the
 * `.json` element of a `MiddlewareScript_Task_<id>` DP (written by the page);
 * the manager reports execution state in the sibling `.status` element (two
 * writers, two elements — no contention, same design as AppSecurity_Module).
 */

/** One declared script input or output: a script-visible alias bound to a DPE. */
export interface MsIoBinding {
  alias: string;
  dpe: string;
}

/** Model-side I/O declaration: the alias contract, without any DPE binding. */
export interface MsIoDecl {
  alias: string;
  description?: string;
}

/** Declared model parameter — a per-instance constant (`params.<name>`). */
export interface MsParamDecl {
  name: string;
  description?: string;
  defaultValue?: unknown;
}

/**
 * Reusable script model. A task INSTANTIATES a model by referencing its id:
 * the script and the alias contract come from the model, the task only binds
 * the aliases to its own DPEs and sets its parameter values. Editing a model
 * updates every instance (the manager re-resolves on hot reload).
 */
export interface MsModel {
  id: string;
  dp?: string;
  name: string;
  description: string;
  inputs: MsIoDecl[];
  outputs: MsIoDecl[];
  params: MsParamDecl[];
  script: string;
  updatedAt: string;
}

/** When the task runs: on any declared-input change, or on a fixed period. */
export interface MsTrigger {
  kind: 'dpe' | 'cyclic';
  /** dpe trigger: quiet time (ms) after a burst of changes before running. */
  debounceMs?: number;
  /** cyclic trigger: period in seconds. */
  intervalS?: number;
}

/** Task config — the `.json` element payload (page-written). */
export interface MsTask {
  id: string;
  dp?: string;
  name: string;
  description: string;
  enabled: boolean;
  trigger: MsTrigger;
  inputs: MsIoBinding[];
  outputs: MsIoBinding[];
  /** Synchronous JS body run as `(inputs, output, log, params) => { <script> }`. */
  script: string;
  /** Reusable model instantiated by this task (the script comes from the model). */
  modelId?: string | null;
  /** Parameter values of the instance (over the model's declared defaults). */
  params: Record<string, unknown>;
  /** Hard execution timeout (the worker is terminated past it). */
  timeoutMs: number;
  updatedAt: string;
}

/** Execution state — the `.status` element payload (manager-written). */
export interface MsTaskStatus {
  state: 'idle' | 'running' | 'error' | 'disabled';
  lastRunAt?: string;
  lastDurationMs?: number;
  lastError?: string;
  runCount?: number;
  /** `log(…)` lines of the LAST run (manager-capped), shown in the Journal tab. */
  lastLogs?: string[];
}

/** Result of a sandbox dry-run (POST /api/middleware-script/test). */
export interface MsTestResult {
  ok: boolean;
  outputs?: Record<string, unknown>;
  logs?: string[];
  durationMs?: number;
  error?: string;
}

export const DEFAULT_TIMEOUT_MS = 1000;
export const DEFAULT_DEBOUNCE_MS = 200;
export const DEFAULT_INTERVAL_S = 60;

/** Script-alias rule: a JS identifier, so `inputs.<alias>` always works. */
const ALIAS_RE = /^[A-Za-z_$][\w$]*$/;

/** A fresh, valid, disabled task draft. */
export function newTask(name: string): MsTask {
  return {
    id: '',
    name,
    description: '',
    enabled: false,
    trigger: { kind: 'dpe', debounceMs: DEFAULT_DEBOUNCE_MS },
    inputs: [],
    outputs: [],
    script: '',
    modelId: null,
    params: {},
    timeoutMs: DEFAULT_TIMEOUT_MS,
    updatedAt: new Date().toISOString()
  };
}

/** A fresh model draft. */
export function newModel(name: string): MsModel {
  return {
    id: '',
    name,
    description: '',
    inputs: [],
    outputs: [],
    params: [],
    script: '',
    updatedAt: new Date().toISOString()
  };
}

/** Normalize a parsed task (fills defaults; used as the store's afterRead). */
export function normalizeTask(task: MsTask): MsTask {
  return {
    ...newTask(task.name ?? ''),
    ...task,
    trigger: { kind: task.trigger?.kind === 'cyclic' ? 'cyclic' : 'dpe', ...task.trigger },
    inputs: Array.isArray(task.inputs) ? task.inputs : [],
    outputs: Array.isArray(task.outputs) ? task.outputs : [],
    modelId: typeof task.modelId === 'string' && task.modelId !== '' ? task.modelId : null,
    params: task.params && typeof task.params === 'object' ? task.params : {},
    timeoutMs: Number(task.timeoutMs) > 0 ? Number(task.timeoutMs) : DEFAULT_TIMEOUT_MS
  };
}

/** Normalize a parsed model (fills defaults; used as the store's afterRead). */
export function normalizeModel(model: MsModel): MsModel {
  return {
    ...newModel(model.name ?? ''),
    ...model,
    inputs: Array.isArray(model.inputs) ? model.inputs : [],
    outputs: Array.isArray(model.outputs) ? model.outputs : [],
    params: Array.isArray(model.params) ? model.params : []
  };
}

/** Effective script of a task: its own, or its model's (null when unresolved). */
export function resolveTaskScript(task: MsTask, model: MsModel | null): string | null {
  if (task.modelId == null) return task.script;
  return model?.script ?? null;
}

/** Effective params of a task: the model's declared defaults overlaid by the instance values. */
export function resolveTaskParams(task: MsTask, model: MsModel | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const decl of model?.params ?? []) out[decl.name] = decl.defaultValue;
  for (const [key, value] of Object.entries(task.params ?? {})) out[key] = value;
  return out;
}

/**
 * Validate a task draft (`model` = the resolved model when the task
 * instantiates one). Returns error KEYS (resolved to localized strings by the
 * caller via i18n `validationMsg`) — empty array = valid.
 */
export function validateTask(task: MsTask, model: MsModel | null = null): string[] {
  const errors: string[] = [];
  if (task.name.trim() === '') errors.push('nameRequired');
  if (task.trigger.kind === 'cyclic' && !(Number(task.trigger.intervalS) > 0)) errors.push('intervalRequired');
  if (task.trigger.kind === 'dpe' && task.inputs.length === 0) errors.push('dpeTriggerNeedsInput');
  const seen = new Set<string>();
  for (const binding of [...task.inputs, ...task.outputs]) {
    if (!ALIAS_RE.test(binding.alias)) errors.push('badAlias');
    if (binding.dpe.trim() === '') errors.push('dpeRequired');
    if (seen.has(binding.alias)) errors.push('duplicateAlias');
    seen.add(binding.alias);
  }
  if (task.modelId != null) {
    if (model == null) {
      errors.push('modelMissing');
    } else if (!ioMatchesModel(task, model)) {
      errors.push('modelIoMismatch');
    }
  } else {
    if (task.script.trim() === '') errors.push('scriptRequired');
    if (scriptSyntaxError(task.script) != null) errors.push('syntax');
  }
  return [...new Set(errors)];
}

/** Validate a model draft. Same error-key convention as {@link validateTask}. */
export function validateModel(model: MsModel): string[] {
  const errors: string[] = [];
  if (model.name.trim() === '') errors.push('nameRequired');
  if (model.script.trim() === '') errors.push('scriptRequired');
  if (scriptSyntaxError(model.script) != null) errors.push('syntax');
  const seen = new Set<string>();
  for (const decl of [...model.inputs, ...model.outputs]) {
    if (!ALIAS_RE.test(decl.alias)) errors.push('badAlias');
    if (seen.has(decl.alias)) errors.push('duplicateAlias');
    seen.add(decl.alias);
  }
  const paramSeen = new Set<string>();
  for (const param of model.params) {
    if (!ALIAS_RE.test(param.name)) errors.push('badParamName');
    if (paramSeen.has(param.name)) errors.push('duplicateParam');
    paramSeen.add(param.name);
  }
  return [...new Set(errors)];
}

/** The task's alias set must exactly cover its model's declared contract. */
function ioMatchesModel(task: MsTask, model: MsModel): boolean {
  const cover = (bindings: MsIoBinding[], decls: MsIoDecl[]): boolean => {
    const bound = new Set(bindings.map((b) => b.alias));
    const declared = new Set(decls.map((d) => d.alias));
    return bound.size === declared.size && [...declared].every((alias) => bound.has(alias));
  };
  return cover(task.inputs, model.inputs) && cover(task.outputs, model.outputs);
}

/**
 * Parse-only syntax probe of a script body (never executes it): the body is
 * compiled as a function with the sandbox's parameter names. Returns the
 * parser message, or null when the script parses.
 */
export function scriptSyntaxError(script: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- parse-only probe, the function is never invoked
    new Function('inputs', 'output', 'log', 'params', script);
    return null;
  } catch (error) {
    return String((error as Error)?.message ?? error);
  }
}
