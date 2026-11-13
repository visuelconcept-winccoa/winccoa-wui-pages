// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The state of a machine from its mapping (winccoa-fra-msp-stma#339): the values of the mapping's inputs —
 * the main one ({@link STATE_INPUT}, the symbol's `stateDp`) and the named ones (`StateMapping.inputs`, bound
 * by `MachineDef.inputDps`) — through its ordered rules, the first one that matches giving the state; a rule
 * may give the state by the class of the cause in progress ({@link CAUSE_STATE}). Nothing here knows what an
 * input means: a mapping is written by whoever configures the site.
 *
 * Shared by the live views (browser) and Machine Fleet's state manager, which records the history: both play
 * `state-eval.cases.json`, so that they never differ. No dependency.
 */
import { CAUSE_STATE, DECLARED_INPUT, STATE_INPUT, type MachineDef, type MachineState, type RuleCondition, type StateMapping, type StateRule } from './types.js';

/** What a symbol's state comes from: its id (its declared state), its inputs, its stop-cause sources. */
export type StateSource = Partial<Pick<MachineDef, 'id' | 'stateDp' | 'inputDps' | 'declaredState' | 'stopCauseDp' | 'stopCauseDps'>>;

/** Values of a machine's inputs, by input key (a value not read yet is absent). */
export type InputValues = Readonly<Record<string, unknown>>;

/** Class of the cause in progress: planned, unplanned, or none. */
export type CauseClass = 'planned' | 'unplanned' | '';

/** A datapoint value as a scalar: the first element of an array, else itself. */
function scalar(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

/** A value as a number for a range (a boolean counts 1 / 0, a numeric text its number); NaN otherwise. */
export function inputNumber(v: unknown): number {
  const x = scalar(v);
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'string' && x.trim() !== '') return Number(x);
  return Number.NaN;
}

/** Whether an input has a value: not absent, not null, not an empty array. */
function hasValue(v: unknown): boolean {
  const x = scalar(v);
  return x !== undefined && x !== null;
}

/** A value within bounds (both optional); a value that is not a number is never within. */
function inRange(v: unknown, min: number | undefined, max: number | undefined): boolean {
  const n = inputNumber(v);
  if (Number.isNaN(n)) return false;
  return (min == null || n >= min) && (max == null || n <= max);
}

/** A value equal to the expected one: a boolean as true / false (1 / 0, "true" / "false"), else as a number or a text. */
function isEqual(v: unknown, expected: number | string | boolean): boolean {
  const x = scalar(v);
  if (typeof expected === 'boolean') {
    if (typeof x === 'boolean') return x === expected;
    if (typeof x === 'number') return (x !== 0) === expected;
    if (typeof x === 'string') return x.trim().toLowerCase() === String(expected);
    return false;
  }
  if (typeof expected === 'number') return inputNumber(x) === expected;
  return String(x) === expected;
}

/** One condition of a rule met by the values (`not` inverts it; an input without a value meets none). */
export function conditionMet(c: RuleCondition, values: InputValues): boolean {
  const v = values[c.input];
  if (!hasValue(v)) return false;
  let met = true;
  if (c.equals !== undefined && !isEqual(v, c.equals)) met = false;
  if (met && (c.min != null || c.max != null) && !inRange(v, c.min, c.max)) met = false;
  return c.not ? !met : met;
}

/**
 * The main input for a rule's bounds: a state code, taken to the nearest integer as the views always did (a
 * float datapoint at 1.999 is code 2). The conditions on the named inputs are not rounded.
 */
function stateCode(v: unknown): number {
  const n = inputNumber(v);
  return Number.isNaN(n) ? n : Math.round(n);
}

/** A rule matching the values: its bounds on the main input (rounded), and all its conditions. */
export function ruleMatches(rule: StateRule, values: InputValues): boolean {
  if ((rule.min != null || rule.max != null) && !inRange(stateCode(values[STATE_INPUT]), rule.min, rule.max)) return false;
  return (rule.when ?? []).every((c) => conditionMet(c, values));
}

/**
 * The state the mapping gives for these values: the first rule that matches, else the fallback; a rule whose
 * state is {@link CAUSE_STATE} gives the planned or the unplanned state of the mapping by the class of the cause
 * (the fallback without `causeStates`). No mapping: `ok`, as before.
 */
export function evaluateState(mapping: StateMapping | undefined, values: InputValues, cause: CauseClass = ''): MachineState {
  if (!mapping) return 'ok';
  const rule = mapping.rules.find((r) => ruleMatches(r, values));
  if (!rule) return mapping.fallback;
  if (rule.state !== CAUSE_STATE) return rule.state;
  if (!mapping.causeStates) return mapping.fallback;
  return cause === 'planned' ? mapping.causeStates.planned : mapping.causeStates.unplanned;
}

/**
 * Datapoints of a machine's inputs, by input key: the main one (`stateDp`), the named ones bound, and its declared
 * state ({@link DECLARED_INPUT}, Machine Fleet's own datapoint) when it accepts one.
 */
export function inputDpsOf(m: StateSource): Record<string, string> {
  const out: Record<string, string> = {};
  if (m.stateDp?.trim()) out[STATE_INPUT] = m.stateDp.trim();
  for (const [key, dp] of Object.entries(m.inputDps ?? {})) if (key !== STATE_INPUT && key !== DECLARED_INPUT && dp?.trim()) out[key] = dp.trim();
  if (m.declaredState && m.id) out[DECLARED_INPUT] = `${stateRecordDp(m.id)}.declared`;
  return out;
}

/** Stop-cause datapoints of a machine, by priority: `stopCauseDp`, then `stopCauseDps`, each once. */
export function causeDpsOf(m: StateSource): string[] {
  const out: string[] = [];
  for (const dp of [m.stopCauseDp, ...(m.stopCauseDps ?? [])]) {
    const d = dp?.trim();
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** The cause in progress: the first of the values (in the order of {@link causeDpsOf}) that is not empty; '' none. */
export function currentCause(values: readonly unknown[]): string {
  for (const v of values) {
    const x = scalar(v);
    const s = x === undefined || x === null ? '' : String(x).trim();
    if (s) return s;
  }
  return '';
}

/**
 * Class of the cause in progress from the machine's catalogue: planned for a cause classified planned, unplanned
 * for any other (unknown included, as the TRS), '' without cause.
 */
export function causeClassOf(code: string, causes: readonly { code: string; classification: string }[]): CauseClass {
  if (!code) return '';
  return causes.find((c) => c.code === code)?.classification === 'planned' ? 'planned' : 'unplanned';
}

/** Input keys a mapping knows: the main one, then its named inputs. */
export function mappingInputKeys(mapping: StateMapping | undefined): string[] {
  return [STATE_INPUT, ...(mapping?.inputs ?? []).map((i) => i.key).filter((k) => k && k !== STATE_INPUT)];
}

/** Prefix of a symbol's recorded state datapoint (Machine Fleet's state manager, `fleetState`). */
export const STATE_RECORD_PREFIX = 'MachineFleet3D_State_';

/** Datapoint of a symbol's recorded state: its id, every character other than a letter, a digit or `_` as `_`. */
export function stateRecordDp(id: string): string {
  return `${STATE_RECORD_PREFIX}${String(id).replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/**
 * The archived history of a symbol (winccoa-fra-msp-stma#339): its state (a state key of its mapping) and its
 * stop cause in progress, recorded by Machine Fleet's state manager.
 */
export function stateRecordDpes(id: string): { state: string; cause: string } {
  const dp = stateRecordDp(id);
  return { state: `${dp}.state`, cause: `${dp}.cause` };
}

/** The datapoint element of a symbol's declared state (fleetState records it with the state). */
export function declaredStateDpe(id: string): string {
  return `${stateRecordDp(id)}.declared`;
}

/** A recorded sample as a state key ('' none). */
export function recordedState(v: unknown): MachineState {
  const x = scalar(v);
  return x === undefined || x === null ? '' : String(x);
}

/** A symbol records a history: it binds at least one input of its mapping. */
export function recordsState(m: StateSource): boolean {
  return Object.keys(inputDpsOf(m)).length > 0;
}

/** A symbol the stop and KPI analyses offer: it records a history and binds a stop cause. */
export function isAnalysable(m: StateSource): boolean {
  return recordsState(m) && causeDpsOf(m).length > 0;
}

/** One datapoint a live view follows for a symbol's state: an input of its mapping, or a stop-cause source (its rank). */
export interface LiveTarget {
  dpe: string;
  input?: string;
  cause?: number;
}

/** The datapoints a live view follows for a symbol's state and cause: its inputs, then its cause sources. */
export function liveTargets(m: StateSource): LiveTarget[] {
  return [
    ...Object.entries(inputDpsOf(m)).map(([input, dpe]) => ({ dpe, input })),
    ...causeDpsOf(m).map((dpe, cause) => ({ dpe, cause }))
  ];
}

/**
 * Live state and cause of a symbol from the values received (winccoa-fra-msp-stma#339), as the recorder computes
 * them: `inputs` by input key, `causes` by rank of source. `state` is null until an input has a value (the view
 * keeps the state it has); `cause` is the cause in progress ('' none).
 */
export function liveState(
  mapping: StateMapping | undefined,
  inputs: InputValues,
  causes: readonly unknown[],
  catalog: readonly { code: string; classification: string }[]
): { state: MachineState | null; cause: string } {
  const cause = currentCause(causes);
  const hasInput = Object.values(inputs).some((v) => v !== undefined);
  return { state: hasInput ? evaluateState(mapping, inputs, causeClassOf(cause, catalog)) : null, cause };
}

/**
 * A symbol's live state and cause read from a value cache (`read`: a datapoint's last value, undefined when none
 * yet), for views that keep one cache for many symbols (the overview): {@link liveState} over its
 * {@link liveTargets}.
 */
export function machineLiveState(
  m: StateSource,
  mapping: StateMapping | undefined,
  read: (dpe: string) => unknown,
  catalog: readonly { code: string; classification: string }[]
): { state: MachineState | null; cause: string } {
  const inputs: Record<string, unknown> = {};
  const causes: unknown[] = [];
  for (const t of liveTargets(m)) {
    const v = read(t.dpe);
    if (t.input !== undefined) {
      if (v !== undefined) inputs[t.input] = v;
    } else if (t.cause !== undefined) causes[t.cause] = v;
  }
  return liveState(mapping, inputs, causes, catalog);
}
