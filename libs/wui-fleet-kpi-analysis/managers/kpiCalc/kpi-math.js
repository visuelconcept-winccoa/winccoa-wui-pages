// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

/**
 * kpiCalc's computation, without WinCC OA (tested by test/kpi-math.spec.mjs): the intervals of a recorded
 * state history (fleetState, winccoa-fra-msp-stma#339: state keys of the machine's mapping) and the KPI
 * over a window. `computeValue` classifies a cause code with the `classify` it is given (index.js: the
 * machine's catalogue).
 */

const MS_PER_MINUTE = 60_000;
const ROUND = 100;

/** Sort + merge overlapping {s,e} intervals (already clipped). */
function clipMerge(list) {
  const valid = list.filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const out = [];
  for (const i of valid) {
    const last = out.at(-1);
    if (last && i.s <= last.e) last.e = Math.max(last.e, i.e);
    else out.push({ s: i.s, e: i.e });
  }
  return out;
}

/** Parts of [s,e) not covered by the (sorted, merged) `closed` intervals. */
function subtract(s, e, closed) {
  const parts = [];
  let cur = s;
  for (const c of closed) {
    if (c.e <= cur || c.s >= e) continue;
    if (c.s > cur) parts.push({ s: cur, e: Math.min(c.s, e) });
    cur = Math.max(cur, c.e);
    if (cur >= e) break;
  }
  if (cur < e) parts.push({ s: cur, e });
  return parts;
}

function sumLength(list) {
  return list.reduce((acc, i) => acc + (i.e - i.s), 0);
}

/** Raw cause spans within a stop (codes may be empty). */
function causeBoundaries(stop, causeSamples) {
  const spans = [];
  let cursor = stop.s;
  let active = codeAt(causeSamples, stop.s);
  for (const sample of causeSamples) {
    if (sample.t <= stop.s || sample.t >= stop.e) continue;
    if (sample.t > cursor) spans.push({ start: cursor, end: sample.t, code: active });
    cursor = sample.t;
    active = sample.v == null ? '' : String(sample.v).trim();
  }
  if (cursor < stop.e) spans.push({ start: cursor, end: stop.e, code: active });
  return spans;
}

/**
 * Partition a stop into contiguous (code) sub-segments. A leading span with no
 * cause is back-filled to the first assigned cause of the stop ("la cause est
 * prise en compte depuis le début de l'arrêt"); empty spans afterwards carry the
 * previous cause forward. A stop with no cause at all stays empty → unplanned.
 */
function partitionByCause(stop, causeSamples) {
  const boundaries = causeBoundaries(stop, causeSamples);
  const firstNonEmpty = (boundaries.find((b) => b.code !== '') || {}).code || '';
  let carried = firstNonEmpty;
  const out = [];
  for (const seg of boundaries) {
    const code = seg.code === '' ? carried : seg.code;
    carried = code;
    const last = out.at(-1);
    if (last && last.code === code) last.end = seg.end;
    else out.push({ start: seg.start, end: seg.end, code });
  }
  return out;
}

/** True when the state counts as producing: its `running` flag when the mapping declares
 *  its own states (wui-fleet-core isRunningState), else the built-in 'ok'. */
function isRunningState(mapping, key) {
  const states = mapping && Array.isArray(mapping.states) && mapping.states.length ? mapping.states : null;
  if (!states) return key === 'ok';
  const def = states.find((s) => s.key === key);
  return Boolean(def && def.running);
}

/** A recorded sample as a state key ('' none): the recorder writes the state its mapping gives. */
function recordedState(v) {
  const x = Array.isArray(v) ? v[0] : v;
  return x == null ? '' : String(x);
}

/** Datapoint of a machine's recorded state (fleetState `stateDpName`, wui-fleet-core `stateRecordDp`). */
function stateRecordDp(id) {
  return `MachineFleet3D_State_${String(id).replace(/[^A-Za-z0-9_]/g, '_')}`;
}

/** A machine binds an input of its mapping (`stateDp` or a named input): it has a recorded state. */
function recordsState(m) {
  if (m.stateDp && String(m.stateDp).trim()) return true;
  return Object.values(m.inputDps || {}).some((dp) => dp && String(dp).trim());
}

/** True when the time in that state is taken out of the opening time (wui-fleet-core isOutsideOpening). */
function isOutsideOpening(mapping, key) {
  const states = mapping && Array.isArray(mapping.states) ? mapping.states : [];
  const def = states.find((s) => s.key === key);
  return Boolean(def && def.outsideOpening && !def.running);
}

function codeAt(samples, t) {
  let code = '';
  for (const s of samples) {
    if (s.t > t) break;
    code = s.v == null ? '' : String(s.v).trim();
  }
  return code;
}

/** Merged non-production intervals within [start,end] from state history. */
function nonProductionIntervals(samples, mapping, start, end, minStopMs = 0) {
  if (samples.length === 0) return [];
  const intervals = [];
  for (let i = 0; i < samples.length; i++) {
    // Whole periods first (unclipped start): a short stop is judged on its full length.
    const segStart = samples[i].t;
    const segEnd = Math.min(samples[i + 1] ? samples[i + 1].t : end, end);
    if (segEnd <= segStart) continue;
    const state = recordedState(samples[i].v);
    if (isRunningState(mapping, state) || isOutsideOpening(mapping, state)) continue;
    const last = intervals.at(-1);
    if (last && last.e >= segStart) last.e = Math.max(last.e, segEnd);
    else intervals.push({ s: segStart, e: segEnd });
  }
  // A period shorter than the machine's minimum stop is production (MachineDef.minStopSec).
  return intervals
    .filter((iv) => iv.e - iv.s >= minStopMs)
    .map((iv) => ({ s: Math.max(iv.s, start), e: Math.min(iv.e, end) }))
    .filter((iv) => iv.e > iv.s);
}

/** Merged intervals within [start,end] spent in a state taken out of the opening time. */
function offOpeningIntervals(samples, mapping, start, end) {
  const intervals = [];
  for (let i = 0; i < samples.length; i++) {
    const segStart = Math.max(samples[i].t, start);
    const segEnd = Math.min(samples[i + 1] ? samples[i + 1].t : end, end);
    if (segEnd <= segStart) continue;
    if (!isOutsideOpening(mapping, recordedState(samples[i].v))) continue;
    intervals.push({ s: segStart, e: segEnd });
  }
  return clipMerge(intervals);
}

function computeValue(type, stateSamples, causeSamples, mapping, closures, start, end, minStopMs = 0, catalogId = '', classify = () => 'unplanned') {
  const windowMs = end - start;
  // Opening time = window minus non-worked periods: closures, and time in off-opening states.
  const closed = clipMerge([...closures, ...offOpeningIntervals(stateSamples, mapping, start, end)]);
  const openingMs = Math.max(0, windowMs - sumLength(closed));
  const stops = nonProductionIntervals(stateSamples, mapping, start, end, minStopMs);
  let plannedMs = 0;
  let unplannedMs = 0;
  let failures = 0;
  for (const stop of stops) {
    let stopUnplanned = 0;
    // Partition the whole stop by cause (cause back-filled to the stop start),
    // then count only the worked portions (closures excluded).
    for (const seg of partitionByCause(stop, causeSamples)) {
      const planned = classify(seg.code, catalogId) === 'planned';
      for (const w of subtract(seg.start, seg.end, closed)) {
        const dur = w.e - w.s;
        if (planned) plannedMs += dur;
        else {
          unplannedMs += dur;
          stopUnplanned += dur;
        }
      }
    }
    if (stopUnplanned > 0) failures += 1;
  }
  const requiredMs = Math.max(0, openingMs - plannedMs);
  // MTBF/MTTR consider ONLY unplanned stops: planned downtime is treated as
  // operating time (it does not reduce the mean-time metrics). MTBF = uptime
  // (opening minus unplanned repair) per failure; MTTR = unplanned per failure.
  const upBetweenFailuresMs = Math.max(0, openingMs - unplannedMs);
  let value = 0;
  if (type === 'TRS') {
    value = requiredMs > 0 ? Math.max(0, (requiredMs - unplannedMs) / requiredMs) * ROUND : ROUND;
  } else if (type === 'MTBF') {
    value = upBetweenFailuresMs / Math.max(failures, 1) / MS_PER_MINUTE;
  } else {
    value = failures > 0 ? unplannedMs / failures / MS_PER_MINUTE : 0;
  }
  return Math.round(value * ROUND) / ROUND;
}

module.exports = { clipMerge, subtract, sumLength, causeBoundaries, partitionByCause, isRunningState, recordedState, stateRecordDp, recordsState, isOutsideOpening, codeAt, nonProductionIntervals, offOpeningIntervals, computeValue };
