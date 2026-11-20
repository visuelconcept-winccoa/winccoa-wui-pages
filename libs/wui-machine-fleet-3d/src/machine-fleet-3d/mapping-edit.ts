// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Editing a state mapping with several inputs (winccoa-fra-msp-stma#339), without UI (tested by
 * mapping-edit.spec.ts): its named inputs (kept consistent with the rules that name them), the conditions of a
 * rule as the editor shows them (an operator and its values), the bounds of a rule left empty, the order of the
 * rules (the first one that matches wins).
 */
import { CAUSE_STATE, DECLARED_INPUT, STATE_INPUT, type MappingInput, type RuleCondition, type StateMapping, type StateRule } from '@visuelconcept-winccoa/wui-fleet-core/types.js';

/** Operators of a condition in the editor: equal, not equal, within bounds, outside bounds. */
export type ConditionOp = 'eq' | 'ne' | 'in' | 'out';

/** A condition as the editor shows it. */
export interface ConditionView {
  input: string;
  op: ConditionOp;
  /** Expected value (eq / ne), as typed. */
  value: string;
  /** Bounds (in / out), as typed; empty = no bound. */
  min: string;
  max: string;
}

export { CAUSE_STATE, DECLARED_INPUT, STATE_INPUT };

/** A typed value as a condition expects it: true / false, a number, else the text itself. */
export function parseConditionValue(text: string): number | string | boolean {
  const t = text.trim();
  if (t.toLowerCase() === 'true' || t.toLowerCase() === 'vrai') return true;
  if (t.toLowerCase() === 'false' || t.toLowerCase() === 'faux') return false;
  if (t !== '' && !Number.isNaN(Number(t.replace(',', '.')))) return Number(t.replace(',', '.'));
  return t;
}

/** A typed bound: a number, or undefined when empty or not a number. */
export function parseBound(text: string): number | undefined {
  const t = text.trim().replace(',', '.');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isNaN(n) ? undefined : n;
}

/** A bound as the editor shows it ('' none). */
export function boundText(n: number | undefined): string {
  return n == null ? '' : String(n);
}

/** A condition as the editor shows it. */
export function conditionView(c: RuleCondition): ConditionView {
  const ranged = c.equals === undefined;
  const op: ConditionOp = ranged ? (c.not ? 'out' : 'in') : c.not ? 'ne' : 'eq';
  return { input: c.input, op, value: c.equals === undefined ? '' : String(c.equals), min: boundText(c.min), max: boundText(c.max) };
}

/** The condition the editor's fields give. */
export function conditionOf(v: ConditionView): RuleCondition {
  const out: RuleCondition = { input: v.input };
  if (v.op === 'eq' || v.op === 'ne') out.equals = parseConditionValue(v.value);
  else {
    const min = parseBound(v.min);
    const max = parseBound(v.max);
    if (min !== undefined) out.min = min;
    if (max !== undefined) out.max = max;
  }
  if (v.op === 'ne' || v.op === 'out') out.not = true;
  return out;
}

/** Why an input key is refused ('' valid): a letter then letters, digits, `_`; not a reserved input; unique. */
export function inputKeyError(key: string, others: readonly string[]): string {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(key)) return 'format';
  if (key === STATE_INPUT || key === DECLARED_INPUT) return 'reserved';
  if (others.includes(key)) return 'taken';
  return '';
}

/** A new input's key: `entree<n>`, the first free one. */
export function newInputKey(mapping: StateMapping): string {
  const keys = new Set((mapping.inputs ?? []).map((i) => i.key));
  let n = keys.size + 1;
  while (keys.has(`entree${n}`)) n++;
  return `entree${n}`;
}

/** An input added at the end. */
export function addInput(mapping: StateMapping, label: string): StateMapping {
  return { ...mapping, inputs: [...(mapping.inputs ?? []), { key: newInputKey(mapping), label }] };
}

/** An input renamed, and the conditions that name it; a refused key changes nothing. */
export function renameInput(mapping: StateMapping, index: number, key: string): StateMapping {
  const inputs = mapping.inputs ?? [];
  const old = inputs[index]?.key;
  if (!old || key === old || inputKeyError(key, inputs.filter((_, i) => i !== index).map((i) => i.key))) return mapping;
  return {
    ...mapping,
    inputs: inputs.map((inp, i) => (i === index ? { ...inp, key } : inp)),
    rules: mapping.rules.map((r) => (r.when ? { ...r, when: r.when.map((c) => (c.input === old ? { ...c, input: key } : c)) } : r))
  };
}

/** An input's label changed. */
export function relabelInput(mapping: StateMapping, index: number, label: string): StateMapping {
  return { ...mapping, inputs: (mapping.inputs ?? []).map((inp, i) => (i === index ? { ...inp, label } : inp)) };
}

/** An input removed, and the conditions that named it. */
export function removeInput(mapping: StateMapping, index: number): StateMapping {
  const inputs = mapping.inputs ?? [];
  const key = inputs[index]?.key;
  if (!key) return mapping;
  const rest: MappingInput[] = inputs.filter((_, i) => i !== index);
  return {
    ...mapping,
    inputs: rest.length ? rest : undefined,
    rules: mapping.rules.map((r) => (r.when ? withWhen(r, r.when.filter((c) => c.input !== key)) : r))
  };
}

/** A rule with these conditions (none: no `when`). */
export function withWhen(rule: StateRule, when: RuleCondition[]): StateRule {
  const out: StateRule = { ...rule };
  if (when.length) out.when = when;
  else delete out.when;
  return out;
}

/** A rule's bounds on the main input as typed (empty = no bound). */
export function withBounds(rule: StateRule, min: string, max: string): StateRule {
  const out: StateRule = { ...rule };
  const lo = parseBound(min);
  const hi = parseBound(max);
  if (lo === undefined) delete out.min;
  else out.min = lo;
  if (hi === undefined) delete out.max;
  else out.max = hi;
  return out;
}

/** A rule moved up (-1) or down (+1); the first rule that matches wins. */
export function moveRule(mapping: StateMapping, index: number, dir: -1 | 1): StateMapping {
  const j = index + dir;
  if (index < 0 || j < 0 || j >= mapping.rules.length) return mapping;
  const rules = [...mapping.rules];
  [rules[index], rules[j]] = [rules[j], rules[index]];
  return { ...mapping, rules };
}

/** The mapping gives a state by cause: some rule names {@link CAUSE_STATE}. */
export function usesCause(mapping: StateMapping): boolean {
  return mapping.rules.some((r) => r.state === CAUSE_STATE);
}

/** Inputs a condition may name: the main one, the declared state, then the mapping's named inputs. */
export function conditionInputs(mapping: StateMapping): MappingInput[] {
  return [{ key: STATE_INPUT, label: '' }, { key: DECLARED_INPUT, label: '' }, ...(mapping.inputs ?? [])];
}
