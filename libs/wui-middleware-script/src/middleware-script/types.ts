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
  /** Synchronous JS body run as `(inputs, output, log) => { <script> }`. */
  script: string;
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
    timeoutMs: DEFAULT_TIMEOUT_MS,
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
    timeoutMs: Number(task.timeoutMs) > 0 ? Number(task.timeoutMs) : DEFAULT_TIMEOUT_MS
  };
}

/**
 * Validate a task draft. Returns error KEYS (resolved to localized strings by
 * the caller via i18n `validationMsg`) — empty array = valid.
 */
export function validateTask(task: MsTask): string[] {
  const errors: string[] = [];
  if (task.name.trim() === '') errors.push('nameRequired');
  if (task.script.trim() === '') errors.push('scriptRequired');
  if (task.trigger.kind === 'cyclic' && !(Number(task.trigger.intervalS) > 0)) errors.push('intervalRequired');
  if (task.trigger.kind === 'dpe' && task.inputs.length === 0) errors.push('dpeTriggerNeedsInput');
  const seen = new Set<string>();
  for (const binding of [...task.inputs, ...task.outputs]) {
    if (!ALIAS_RE.test(binding.alias)) errors.push('badAlias');
    if (binding.dpe.trim() === '') errors.push('dpeRequired');
    if (seen.has(binding.alias)) errors.push('duplicateAlias');
    seen.add(binding.alias);
  }
  const syntax = scriptSyntaxError(task.script);
  if (syntax != null) errors.push('syntax');
  return [...new Set(errors)];
}

/**
 * Parse-only syntax probe of a script body (never executes it): the body is
 * compiled as a function with the sandbox's parameter names. Returns the
 * parser message, or null when the script parses.
 */
export function scriptSyntaxError(script: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func -- parse-only probe, the function is never invoked
    new Function('inputs', 'output', 'log', script);
    return null;
  } catch (error) {
    return String((error as Error)?.message ?? error);
  }
}
