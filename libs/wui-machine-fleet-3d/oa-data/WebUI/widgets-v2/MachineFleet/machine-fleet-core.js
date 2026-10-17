// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared engine of the **Machine Fleet dashboard widgets** (`machine-fleet-gantt`,
 * `machine-fleet-dt-analysis`).
 *
 * A browser-side port of the fleet's stop-analysis engine
 * (`libs/wui-fleet-core/src/engine.ts`) and of the segment builder of the built-in
 * machine dashboard (`mf-machine-dashboard.ts`), reduced to what a dashboard
 * widget can know: the archived **state** and **stop-cause** histories of ONE
 * machine, already fetched by the dashboard's `data-point` context over the
 * widget's time range, plus the atelier's **state mapping** and the fleet's
 * **stop-cause catalog** (both JSON, read live off their datapoints or pasted).
 *
 * Datapoint interface (deduced from the fleet's data model):
 *   - `MachineSim_<machine>.state`  Int, NGA-archived → history `{values, timestamps}`
 *   - `MachineSim_<machine>.cause`  String (catalog code, '' in production), archived
 *   - `MachineFleet3D_<atelier>.json` serialised `Atelier` → `mappings[]`, `machines[]`
 *   - `MachineFleet3D_StopCauses.json` serialised `StopCause[]`
 *
 * Pure functions, no DOM, no backend access — widgets stay "dumb".
 */
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { parseTimeRange } from '@wincc-oa/wui-shared/parseTimeRange.js';

/** Build a multi-language string in the shape `localize()` understands. */
export function ml(en, fr, de) {
  return { 'en_US.utf8': en, 'fr_FR.utf8': fr, 'de_AT.utf8': de };
}

/** Resolve a multi-language string (or pass a plain string through). */
export function t(message) {
  return typeof message === 'string'
    ? message
    : String(localize(message) ?? '');
}

export const ALL_STATES = ['ok', 'warn', 'stop', 'maint'];

export const STATE_LABELS = {
  ok: ml('Production', 'Production', 'Produktion'),
  warn: ml('Fault', 'Défaut', 'Störung'),
  stop: ml('Stop', 'Arrêt', 'Stillstand'),
  maint: ml('Maintenance', 'Maintenance', 'Wartung')
};

export const CLASS_LABELS = {
  unplanned: ml('Unplanned', 'Non planifié', 'Ungeplant'),
  planned: ml('Planned', 'Planifié', 'Geplant'),
  production: ml('Production', 'Production', 'Produktion')
};

/** Default colours of the fleet (mirrors `STATE_COLORS` + `DISCONNECTED_COLOR`). */
export const DEFAULT_STATE_COLORS = {
  ok: '#10b981',
  warn: '#ef4444',
  stop: '#f59e0b',
  maint: '#3b82f6',
  disconnected: '#8b5cf6'
};

/** The fleet's standard mapping (0=stop, 1=ok, 2=fault, 3=maintenance). */
export const DEFAULT_STATE_MAPPING = {
  id: 'default',
  name: 'Standard',
  fallback: 'stop',
  rules: [
    { state: 'stop', min: 0, max: 0 },
    { state: 'ok', min: 1, max: 1 },
    { state: 'warn', min: 2, max: 2 },
    { state: 'maint', min: 3, max: 3 }
  ]
};

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

const NO_CAUSE_KEY = '__none__';
const NO_CAUSE_LABEL = ml(
  'No cause assigned',
  'Sans cause assignée',
  'Keine Ursache zugewiesen'
);

// --- JSON inputs --------------------------------------------------------------

/** Parse a JSON string leniently; objects pass through; anything else → undefined. */
export function parseJson(raw) {
  if (raw == undefined) return;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim();
  if (text === '') return;
  try {
    return JSON.parse(text);
  } catch {
    return;
  }
}

/**
 * Resolve the state mapping from what the editor bound:
 *   - a serialised `Atelier` (`MachineFleet3D_<atelier>.json`): the mapping of
 *     `machineId` (its `stateMappingId`), else `mappingId`, else the first one;
 *   - an array of mappings: by `mappingId`, else the first one;
 *   - a single mapping object (`{ rules, fallback, colors? }`).
 * Returns undefined when nothing usable was bound.
 */
export function parseMapping(raw, mappingId = '', machineId = '') {
  const v = parseJson(raw);
  if (!v) return;
  if (!Array.isArray(v) && Array.isArray(v.rules)) return normaliseMapping(v);
  let list;
  let wantedId = mappingId;
  if (Array.isArray(v)) {
    list = v;
  } else if (Array.isArray(v.mappings)) {
    list = v.mappings;
    if (machineId && Array.isArray(v.machines)) {
      const machine = v.machines.find((m) => m && m.id === machineId);
      if (machine && machine.stateMappingId) wantedId = machine.stateMappingId;
    }
  } else {
    return;
  }
  const pick =
    (wantedId && list.find((m) => m && m.id === wantedId)) || list[0];
  return pick && Array.isArray(pick.rules) ? normaliseMapping(pick) : undefined;
}

function normaliseMapping(m) {
  const rules = m.rules
    .filter((r) => r && ALL_STATES.includes(r.state))
    .map((r) => ({
      state: r.state,
      min: numberOrUndefined(r.min),
      max: numberOrUndefined(r.max)
    }));
  const fallback = ALL_STATES.includes(m.fallback) ? m.fallback : 'stop';
  const colors =
    m.colors && typeof m.colors === 'object' ? { ...m.colors } : undefined;
  return {
    id: String(m.id ?? ''),
    name: String(m.name ?? ''),
    rules,
    fallback,
    colors
  };
}

function numberOrUndefined(v) {
  if (v == undefined || v === '') return;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** Parse the stop-cause catalog (`MachineFleet3D_StopCauses.json`). */
export function parseCatalog(raw) {
  const v = parseJson(raw);
  if (!Array.isArray(v)) return [];
  return v
    .filter((c) => c && c.code != undefined)
    .map((c) => ({
      code: String(c.code),
      description: String(c.description ?? ''),
      classification:
        c.classification === 'planned' || c.classification === 'production'
          ? c.classification
          : 'unplanned',
      isDefault: c.isDefault === true
    }));
}

// --- state / cause helpers ----------------------------------------------------

export function resolveState(mapping, value) {
  const mp = mapping ?? DEFAULT_STATE_MAPPING;
  for (const rule of mp.rules) {
    const okMin = rule.min == undefined || value >= rule.min;
    const okMax = rule.max == undefined || value <= rule.max;
    if (okMin && okMax) return rule.state;
  }
  return mp.fallback;
}

export function stateColor(mapping, key) {
  return (
    (mapping && mapping.colors && mapping.colors[key]) ||
    DEFAULT_STATE_COLORS[key]
  );
}

/** States a mapping can produce (rules + fallback), in canonical order. */
export function mappingStates(mapping) {
  const mp = mapping ?? DEFAULT_STATE_MAPPING;
  const present = new Set(mp.rules.map((r) => r.state));
  present.add(mp.fallback);
  return ALL_STATES.filter((s) => present.has(s));
}

/** `"code — description"`; unknown codes fold onto the catalog's default entry. */
export function formatStopCause(catalog, code) {
  if (code == undefined || code === '') return '';
  const key = String(code);
  const entry = catalog.find((c) => c.code === key);
  if (entry) return `${entry.code} — ${entry.description}`;
  const fallback = catalog.find((c) => c.isDefault);
  return fallback ? `${fallback.code} — ${fallback.description}` : key;
}

// --- history samples ----------------------------------------------------------

/**
 * Normalise a historic data-point value (`{ values, timestamps }`, as delivered
 * by the `data-point` context with `fetchMethod: historic`) into time-sorted
 * `{ t, v }` samples. Anything else (a live scalar, an error payload) → [].
 */
export function toSamples(historic) {
  if (!historic || typeof historic !== 'object') return [];
  const values = Array.isArray(historic.values) ? historic.values : [];
  const times = Array.isArray(historic.timestamps) ? historic.timestamps : [];
  const samples = [];
  for (const [index, raw] of times.entries()) {
    const ms = toMs(raw);
    if (Number.isFinite(ms)) samples.push({ t: ms, v: values[index] });
  }
  samples.sort((a, b) => a.t - b.t);
  return samples;
}

function toMs(raw) {
  if (typeof raw === 'number') return raw;
  if (raw instanceof Date) return raw.getTime();
  return new Date(String(raw)).getTime();
}

/**
 * The widget's time window `[start, end]` for a dashboard `sTimeRange` string
 * (`"now/d"`, `"24h"`, `"1w/w-1w/w"`, ISO pairs…), parsed by the same helper the
 * historic context uses. Falls back to the extent of the samples (ending now)
 * when the string is missing or unparseable. `live` = the window ends at now.
 */
export function resolveWindow(sTimeRange, samples = []) {
  if (sTimeRange) {
    try {
      const { start, end, live } = parseTimeRange(sTimeRange);
      const s = start.getTime();
      const endMs = end.getTime();
      if (Number.isFinite(s) && Number.isFinite(endMs) && endMs > s)
        return { start: s, end: endMs, live: live !== false };
    } catch {
      // fall through to the sample extent
    }
  }
  const now = Date.now();
  const first = samples.length > 0 ? samples[0].t : now - MS_PER_DAY;
  return { start: Math.min(first, now - MS_PER_MINUTE), end: now, live: true };
}

// --- Gantt segments -----------------------------------------------------------

/**
 * Proportional state timeline: one segment per state run inside `[ws, we]`, each
 * carrying the stop cause active at its start (non-production states only).
 * The first segment starts at the first archived sample — the state before it
 * is unknown to the widget and is NOT invented.
 */
export function buildSegments(
  stateSamples,
  causeSamples,
  mapping,
  catalog,
  ws,
  we
) {
  // 1. The state runs inside the window.
  const runs = [];
  for (const [index, s] of stateSamples.entries()) {
    const segStart = Math.max(s.t, ws);
    const next = stateSamples[index + 1];
    const segEnd = Math.min(next ? next.t : we, we);
    if (segEnd <= segStart) continue;
    runs.push({
      state: resolveState(mapping, Math.round(toNumber(s.v))),
      startMs: segStart,
      endMs: segEnd
    });
  }
  // 2. A contiguous non-production stretch is one "stop" — the unit the downtime
  //    analysis attributes. Partition it by cause with the SAME rules (leading
  //    span back-filled to the first cause, later gaps carrying the previous one)
  //    and cut the runs on the cause boundaries, so the Gantt bubbles agree with
  //    the Pareto and a stop with two causes shows two bubbles.
  const segs = [];
  let index = 0;
  while (index < runs.length) {
    const run = runs[index];
    if (run.state === 'ok') {
      pushSegment(segs, { ...run, causeLabel: '' });
      index += 1;
      continue;
    }
    let endIndex = index;
    while (
      endIndex + 1 < runs.length &&
      runs[endIndex + 1].state !== 'ok' &&
      runs[endIndex + 1].startMs <= runs[endIndex].endMs
    ) {
      endIndex += 1;
    }
    const parts = partitionByCause(
      { s: run.startMs, e: runs[endIndex].endMs },
      causeSamples
    );
    for (const r of runs.slice(index, endIndex + 1)) {
      for (const part of parts) {
        const from = Math.max(r.startMs, part.start);
        const to = Math.min(r.endMs, part.end);
        if (to <= from) continue;
        pushSegment(segs, {
          state: r.state,
          startMs: from,
          endMs: to,
          causeLabel: formatStopCause(catalog, part.code)
        });
      }
    }
    index = endIndex + 1;
  }
  return segs;
}

/** Append a segment, merging it into the previous one when nothing changed. */
function pushSegment(segs, seg) {
  const last = segs.at(-1);
  if (
    last &&
    last.state === seg.state &&
    last.causeLabel === seg.causeLabel &&
    last.endMs >= seg.startMs
  ) {
    last.endMs = Math.max(last.endMs, seg.endMs);
  } else {
    segs.push(seg);
  }
}

// --- downtime analysis --------------------------------------------------------

/**
 * Decompose the machine's downtime over `[ws, we]` by stop cause.
 *
 * Non-production = every state other than `ok`. Each stop interval is
 * partitioned by the cause active over it, with the fleet's two boundary rules:
 * a leading span without cause is **back-filled** to the first cause of the
 * stop, later gaps **carry** the previous cause forward. Unknown codes fold onto
 * the catalog's default entry.
 *
 * Returns `{ rows, stops, coveredMs, okMs }`:
 *  - `rows`   one aggregate per cause: assignedMs (partition, sums to the stop
 *             time), downtimeMs (whole stops the cause appears in), occurrences;
 *  - `stops`  every stop interval with the classifications found in it;
 *  - `coveredMs` the part of the window actually described by samples;
 *  - `okMs`   production time inside the covered part.
 */
export function analyseStops(
  stateSamples,
  causeSamples,
  mapping,
  catalog,
  ws,
  we
) {
  const agg = new Map();
  const stops = [];
  let okMs = 0;
  let coveredStart = we;
  for (const [index, s] of stateSamples.entries()) {
    const segStart = Math.max(s.t, ws);
    const next = stateSamples[index + 1];
    const segEnd = Math.min(next ? next.t : we, we);
    if (segEnd <= segStart) continue;
    coveredStart = Math.min(coveredStart, segStart);
    const state = resolveState(mapping, Math.round(toNumber(s.v)));
    if (state === 'ok') {
      okMs += segEnd - segStart;
      continue;
    }
    const last = stops.at(-1);
    if (last && last.e >= segStart) last.e = Math.max(last.e, segEnd);
    else stops.push({ s: segStart, e: segEnd, classifications: [] });
  }
  for (const stop of stops) attributeStop(stop, causeSamples, catalog, agg);
  return {
    rows: [...agg.values()],
    stops,
    coveredMs: Math.max(0, we - coveredStart),
    okMs
  };
}

function attributeStop(stop, causeSamples, catalog, agg) {
  const stopMs = stop.e - stop.s;
  if (stopMs <= 0) return;
  const perKey = new Map();
  for (const seg of partitionByCause(stop, causeSamples)) {
    const { key } = resolveGroup(catalog, seg.code);
    perKey.set(key, (perKey.get(key) ?? 0) + (seg.end - seg.start));
  }
  const classes = new Set();
  for (const [key, ms] of perKey) {
    if (ms <= 0) continue;
    const row = ensureRow(agg, catalog, key);
    row.assignedMs += ms;
    row.downtimeMs += stopMs;
    row.occurrences += 1;
    classes.add(row.classification);
  }
  stop.classifications = [...classes];
}

export function partitionByCause(stop, causeSamples) {
  const boundaries = causeBoundaries(stop, causeSamples);
  const segments = [];
  let carried = boundaries.find((b) => b.code !== '')?.code ?? '';
  for (const seg of boundaries) {
    const code = seg.code === '' ? carried : seg.code;
    carried = code;
    const last = segments.at(-1);
    if (last && last.code === code) last.end = seg.end;
    else segments.push({ start: seg.start, end: seg.end, code });
  }
  return segments;
}

function causeBoundaries(stop, causeSamples) {
  const spans = [];
  let cursor = stop.s;
  let active = codeAt(causeSamples, stop.s);
  for (const sample of causeSamples) {
    if (sample.t <= stop.s || sample.t >= stop.e) continue;
    if (sample.t > cursor)
      spans.push({ start: cursor, end: sample.t, code: active });
    cursor = sample.t;
    active = normCode(sample.v);
  }
  if (cursor < stop.e) spans.push({ start: cursor, end: stop.e, code: active });
  return spans;
}

/** Cause code active at `at` (last sample at-or-before it), '' when none. */
function codeAt(causeSamples, at) {
  let code = '';
  for (const s of causeSamples) {
    if (s.t > at) break;
    code = normCode(s.v);
  }
  return code;
}

function normCode(v) {
  return v == undefined ? '' : String(v).trim();
}

function toNumber(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function resolveGroup(catalog, code) {
  if (code !== '') {
    const entry = catalog.find((c) => c.code === code);
    if (entry) {
      return {
        key: entry.code,
        label: `${entry.code} — ${entry.description}`,
        classification: entry.classification
      };
    }
  }
  const fallback = catalog.find((c) => c.isDefault);
  if (fallback) {
    return {
      key: fallback.code,
      label: `${fallback.code} — ${fallback.description}`,
      classification: fallback.classification
    };
  }
  if (code === '')
    return {
      key: NO_CAUSE_KEY,
      label: t(NO_CAUSE_LABEL),
      classification: 'unplanned'
    };
  return { key: code, label: code, classification: 'unplanned' };
}

function ensureRow(agg, catalog, key) {
  const existing = agg.get(key);
  if (existing) return existing;
  const group = resolveGroup(catalog, key === NO_CAUSE_KEY ? '' : key);
  const row = {
    key,
    label: group.label,
    classification: group.classification,
    assignedMs: 0,
    downtimeMs: 0,
    occurrences: 0
  };
  agg.set(key, row);
  return row;
}

/** Sort rows by `downtime` | `assigned` | `occurrences`, descending (new array). */
export function sortRows(rows, key) {
  const metric =
    {
      assigned: (r) => r.assignedMs,
      downtime: (r) => r.downtimeMs,
      occurrences: (r) => r.occurrences
    }[key] ?? ((r) => r.downtimeMs);
  return [...rows].sort(
    (a, b) => metric(b) - metric(a) || a.label.localeCompare(b.label)
  );
}

// --- formatting ---------------------------------------------------------------

const UNIT_DAY = ml('d', 'j', 'T');
const UNIT_HOUR = 'h';
const UNIT_MIN = 'min';
const UNIT_SEC = 's';

/** "3 d 04 h", "12 h 30 min", "45 min", "12 s". */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return `0 ${UNIT_SEC}`;
  const days = Math.floor(ms / MS_PER_DAY);
  const hours = Math.floor((ms % MS_PER_DAY) / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  if (days > 0) return `${days} ${t(UNIT_DAY)} ${pad2(hours)} ${UNIT_HOUR}`;
  if (hours > 0) return `${hours} ${UNIT_HOUR} ${pad2(minutes)} ${UNIT_MIN}`;
  if (minutes > 0) return `${minutes} ${UNIT_MIN}`;
  return `${Math.floor(ms / MS_PER_SECOND)} ${UNIT_SEC}`;
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function locale() {
  return document.documentElement.lang || navigator.language || 'en';
}

/** `dd/mm/yyyy hh:mm:ss` in the page locale — to the SECOND, like the fleet dashboard. */
export function formatDateTimeSec(ms) {
  return new Intl.DateTimeFormat(locale(), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date(ms));
}

/** Short tick label for a time axis spanning `spanMs`. */
export function formatTick(ms, spanMs) {
  let options = { day: '2-digit', month: '2-digit' };
  if (spanMs <= 2 * MS_PER_DAY) {
    options = { hour: '2-digit', minute: '2-digit' };
  } else if (spanMs <= 14 * MS_PER_DAY) {
    options = {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    };
  }
  return new Intl.DateTimeFormat(locale(), options).format(new Date(ms));
}

const TICK_STEPS = [
  MS_PER_MINUTE,
  5 * MS_PER_MINUTE,
  10 * MS_PER_MINUTE,
  15 * MS_PER_MINUTE,
  30 * MS_PER_MINUTE,
  MS_PER_HOUR,
  2 * MS_PER_HOUR,
  3 * MS_PER_HOUR,
  6 * MS_PER_HOUR,
  12 * MS_PER_HOUR,
  MS_PER_DAY,
  2 * MS_PER_DAY,
  7 * MS_PER_DAY,
  14 * MS_PER_DAY,
  30 * MS_PER_DAY
];

/** Evenly spaced "nice" tick timestamps inside `[ws, we]` (at most ~`max`). */
export function niceTicks(ws, we, max = 6) {
  const span = we - ws;
  if (span <= 0) return [];
  const step = TICK_STEPS.find((s) => span / s <= max) ?? TICK_STEPS.at(-1);
  const ticks = [];
  let cursor;
  if (step >= MS_PER_DAY) {
    // Align day-sized steps on local midnight rather than on UTC.
    const d = new Date(ws);
    d.setHours(0, 0, 0, 0);
    if (d.getTime() < ws) d.setDate(d.getDate() + 1);
    cursor = d.getTime();
  } else {
    cursor = Math.ceil(ws / step) * step;
  }
  while (cursor <= we && ticks.length < max + 2) {
    ticks.push(cursor);
    cursor += step;
  }
  return ticks;
}

/** Percentage with one decimal, e.g. "97.3 %". */
export function formatPercent(ratio) {
  if (!Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(1)} %`;
}

// --- CSV export ---------------------------------------------------------------

/** Download `rows` as a `;`-separated CSV with a BOM (Excel-friendly). */
export function downloadCsv(filename, rows) {
  const body = rows
    .map((r) => r.map((cell) => csvCell(cell)).join(';'))
    .join('\r\n');
  const blob = new Blob([`﻿${body}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** Sanitise a free text into a file-name fragment. */
export function fileSlug(text) {
  return (
    String(text ?? '')
      .replaceAll(/[^\w-]+/g, '_')
      .slice(0, 40) || 'machine'
  );
}

export { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE };
