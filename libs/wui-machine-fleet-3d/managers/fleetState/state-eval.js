// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

/**
 * State of a machine from its mapping (winccoa-fra-msp-stma#339) — the manager's copy of wui-fleet-core
 * `state-eval.ts`, which the live views use. The two must give the same state for the same values: both play
 * `wui-fleet-core/src/state-eval.cases.json` (test/fleet-state.spec.mjs), a difference fails the tests.
 * A manager is deployed on its own (javascript/fleetState): it cannot import the page's TypeScript.
 */

const STATE_INPUT = 'state';
const CAUSE_STATE = '@cause';
/** Input of the state declared by an operator (wui-fleet-core types.ts `DECLARED_INPUT`). */
const DECLARED_INPUT = 'declared';

/** Datapoint of a symbol's recorded state (wui-fleet-core `stateRecordDp`). */
function stateRecordDp(id) {
  return `MachineFleet3D_State_${String(id).replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function scalar(v) {
  return Array.isArray(v) ? v[0] : v;
}

/** A value as a number for a range (a boolean counts 1 / 0, a numeric text its number); NaN otherwise. */
function inputNumber(v) {
  const x = scalar(v);
  if (typeof x === 'number') return x;
  if (typeof x === 'boolean') return x ? 1 : 0;
  if (typeof x === 'string' && x.trim() !== '') return Number(x);
  return Number.NaN;
}

function hasValue(v) {
  const x = scalar(v);
  return x !== undefined && x !== null;
}

function inRange(v, min, max) {
  const n = inputNumber(v);
  if (Number.isNaN(n)) return false;
  return (min == null || n >= min) && (max == null || n <= max);
}

function isEqual(v, expected) {
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
function conditionMet(c, values) {
  const v = values[c.input];
  if (!hasValue(v)) return false;
  let met = true;
  if (c.equals !== undefined && !isEqual(v, c.equals)) met = false;
  if (met && (c.min != null || c.max != null) && !inRange(v, c.min, c.max)) met = false;
  return c.not ? !met : met;
}

/** The main input for a rule's bounds: a state code, taken to the nearest integer (as the views). */
function stateCode(v) {
  const n = inputNumber(v);
  return Number.isNaN(n) ? n : Math.round(n);
}

function ruleMatches(rule, values) {
  if ((rule.min != null || rule.max != null) && !inRange(stateCode(values[STATE_INPUT]), rule.min, rule.max)) return false;
  return (rule.when || []).every((c) => conditionMet(c, values));
}

/** The state the mapping gives for these values (see wui-fleet-core state-eval.ts `evaluateState`). */
function evaluateState(mapping, values, cause = '') {
  if (!mapping) return 'ok';
  const rule = (mapping.rules || []).find((r) => ruleMatches(r, values));
  if (!rule) return mapping.fallback;
  if (rule.state !== CAUSE_STATE) return rule.state;
  if (!mapping.causeStates) return mapping.fallback;
  return cause === 'planned' ? mapping.causeStates.planned : mapping.causeStates.unplanned;
}

/** Datapoints of a machine's inputs, by input key: the main one, the named ones bound, its declared state (if accepted). */
function inputDpsOf(m) {
  const out = {};
  if (m.stateDp && String(m.stateDp).trim()) out[STATE_INPUT] = String(m.stateDp).trim();
  for (const [key, dp] of Object.entries(m.inputDps || {})) if (key !== STATE_INPUT && key !== DECLARED_INPUT && dp && String(dp).trim()) out[key] = String(dp).trim();
  if (m.declaredState && m.id) out[DECLARED_INPUT] = `${stateRecordDp(m.id)}.declared`;
  return out;
}

/** Stop-cause datapoints of a machine, by priority: `stopCauseDp`, then `stopCauseDps`, each once. */
function causeDpsOf(m) {
  const out = [];
  for (const dp of [m.stopCauseDp, ...(m.stopCauseDps || [])]) {
    const d = dp == null ? '' : String(dp).trim();
    if (d && !out.includes(d)) out.push(d);
  }
  return out;
}

/** The cause in progress: the first of the values that is not empty; '' none. */
function currentCause(values) {
  for (const v of values) {
    const x = scalar(v);
    const s = x === undefined || x === null ? '' : String(x).trim();
    if (s) return s;
  }
  return '';
}

/** Class of the cause in progress: planned for a cause classified planned, unplanned for any other, '' without cause. */
function causeClassOf(code, causes) {
  if (!code) return '';
  const c = (causes || []).find((x) => x && x.code === code);
  return c && c.classification === 'planned' ? 'planned' : 'unplanned';
}

// ---- references (winccoa-fra-msp-stma#376), as wui-fleet-core state-eval.ts ------------------------------------

const REF_PATTERN = /\{([A-Za-z0-9_-]+)\}/g;

/** The references of a symbol, by name: the datapoint elements whose value names a datapoint. */
function refDpsOf(m) {
  const out = {};
  for (const [name, dpe] of Object.entries((m && m.refDps) || {})) if (/^[A-Za-z0-9_-]+$/.test(name) && dpe && String(dpe).trim()) out[name] = String(dpe).trim();
  return out;
}

/** A binding written with a reference (`{name}`). */
function usesRef(binding) {
  return typeof binding === 'string' && /\{[A-Za-z0-9_-]+\}/.test(binding);
}

/** The datapoint a reference's value names: its system name and a trailing dot left out; '' without a value. */
function refValue(v) {
  const x = scalar(v);
  if (x === undefined || x === null) return '';
  return String(x).trim().replace(/^[^:.]*:/, '').replace(/\.$/, '');
}

/**
 * A binding with its references replaced by the datapoints they name now (`read`: a reference's value); the binding
 * itself when it uses none; undefined when one of them is unknown to the symbol or has no value.
 */
function resolveBinding(binding, refs, read) {
  if (typeof binding !== 'string' || !usesRef(binding)) return binding;
  let missing = false;
  const out = binding.replace(REF_PATTERN, (_all, name) => {
    const dpe = refs[name];
    const value = dpe ? refValue(read(dpe)) : '';
    if (!value) missing = true;
    return value;
  });
  return missing ? undefined : out;
}

/** A symbol's inputs and causes with their references resolved (unresolved ones left out), as the views do. */
function resolveSources(inputs, causes, refs, read) {
  const outInputs = {};
  for (const [key, dpe] of Object.entries(inputs)) {
    const v = resolveBinding(dpe, refs, read);
    if (v !== undefined) outInputs[key] = v;
  }
  const outCauses = causes.map((dpe) => resolveBinding(dpe, refs, read)).filter((v) => v !== undefined);
  return { inputs: outInputs, causes: [...new Set(outCauses)] };
}

module.exports = {
  STATE_INPUT, CAUSE_STATE, DECLARED_INPUT, stateRecordDp, inputNumber, conditionMet, ruleMatches, evaluateState, inputDpsOf, causeDpsOf,
  currentCause, causeClassOf, refDpsOf, usesRef, refValue, resolveBinding, resolveSources
};
