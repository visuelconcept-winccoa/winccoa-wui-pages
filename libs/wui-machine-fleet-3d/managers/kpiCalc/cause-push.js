// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

/**
 * The stop-cause catalogue sent to a machine's controller (winccoa-fra-msp-stma#375): a symbol declares where its
 * controller takes the causes (`MachineDef.stopCauseTargets`: one slot per cause, the datapoint elements of its
 * code, label and class, the longest code and label, the value of each class); the state manager writes there the
 * causes of the symbol's catalogue, in order, whenever they differ (recorder.js). Pure functions, tested.
 */

/** `_address.._direction` of an input-only address (OPC UA: subscription, single query, polling): a write would not reach the controller. */
const INPUT_ONLY = new Set([2, 3, 4]);

const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The slots a symbol declares (none: null), each with at least one datapoint element. */
function targetsOf(m) {
  const t = m && m.stopCauseTargets;
  if (!t || !Array.isArray(t.slots)) return null;
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const slots = t.slots
    .map((s) => ({ code: text(s && s.code), label: text(s && s.label), class: text(s && s.class) }))
    .filter((s) => s.code || s.label || s.class);
  if (!slots.length) return null;
  const classValues = t.classValues && typeof t.classValues === 'object' ? t.classValues : null;
  return { slots, codeMax: positive(t.codeMax), labelMax: positive(t.labelMax), classValues };
}

/**
 * Values to write: `values` Map(DPE → value), the slots left over emptied ('' and 0, or '' for a class written as
 * text); `skipped` codes of a class without a value, `truncated` codes cut, `overflow` causes without a slot.
 */
function causeWrites(targets, causes) {
  const rows = [];
  const skipped = [];
  const truncated = [];
  for (const c of causes || []) {
    const code = String((c && c.code) || '').trim();
    if (!code) continue;
    const cls = c.classification === 'planned' ? 'planned' : c.classification === 'unplanned' ? 'unplanned' : '';
    const value = targets.classValues ? targets.classValues[cls] : cls || undefined;
    if (value === undefined || value === null || value === '') { skipped.push(code); continue; }
    const label = String(c.description || '');
    const cutCode = targets.codeMax ? code.slice(0, targets.codeMax) : code;
    const cutLabel = targets.labelMax ? label.slice(0, targets.labelMax) : label;
    if (cutCode !== code || cutLabel !== label) truncated.push(code);
    rows.push({ code: cutCode, label: cutLabel, cls: value });
  }
  const numericClass = !targets.classValues || Object.values(targets.classValues).every((v) => typeof v === 'number');
  const values = new Map();
  targets.slots.forEach((s, i) => {
    const r = rows[i];
    if (s.code) values.set(s.code, r ? r.code : '');
    if (s.label) values.set(s.label, r ? r.label : '');
    if (s.class) values.set(s.class, r ? r.cls : numericClass && targets.classValues ? 0 : '');
  });
  return { values, skipped, truncated, overflow: Math.max(0, rows.length - targets.slots.length) };
}

/** A communication value as up / down (bool, or int: 0 = down, > 0 = up), as the views read it; undefined unknown. */
function isUp(v) {
  const x = Array.isArray(v) ? v[0] : v;
  if (x === undefined || x === null || x === '') return undefined;
  if (typeof x === 'boolean') return x;
  const n = Number(x);
  if (Number.isFinite(n)) return n > 0;
  return String(x).toLowerCase() === 'true';
}

module.exports = { INPUT_ONLY, targetsOf, causeWrites, isUp };
