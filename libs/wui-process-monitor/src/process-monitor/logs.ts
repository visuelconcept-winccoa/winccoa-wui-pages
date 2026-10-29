// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WinCC OA log text → entries, and what the Logs tab does with them (issue 37): `.bak`
 * merge, filters, highlight, live-tail trimming, export. Pure — no DOM, no i18n import —
 * unit-tested in `logs.spec.ts`.
 *
 * A WinCC OA log entry starts with a header line:
 *
 *   WCCOActrl     (1), 2026.10.29 10:12:33.123, CTRL, WARNING,    5/ctrl, Location of the error: …
 *   <manager> (<num>), <date time>,             <category>, <severity>, <code>, <text>
 *
 * and often goes on over several lines (`In …`, a stack, a dump). A line that is not a
 * header is kept as is and attached to the entry before it, so a filter never cuts an
 * entry; lines before the first header of a text are entries of their own.
 */

export type LogSeverity = 'fatal' | 'severe' | 'warning' | 'info' | 'debug' | '';

/** Severities from the least to the most severe (the minimum-severity filter). */
export const SEVERITIES: readonly Exclude<LogSeverity, ''>[] = ['debug', 'info', 'warning', 'severe', 'fatal'];

export interface LogEntry {
  /** Unique, increasing: the render key and the order of entries without a time. */
  seq: number;
  /** Log file the entry was read from (the current file for a merged `.bak`). */
  source: string;
  /** Date/time text of the header ('' for an unrecognised line). */
  time: string;
  /** That time in epoch ms (local time of the browser — same as the host in practice), or null. */
  timeMs: number | null;
  manager: string;
  manNum: number | null;
  /** Upper-case category (`CTRL`, `PARAM`, `SYS`…), '' when unknown. */
  category: string;
  severity: LogSeverity;
  code: string;
  /** Message of the header line. */
  text: string;
  /** Every raw line of the entry, header first. */
  lines: string[];
  /** A marker, not a log entry: where the `.bak` (previous rotation) ends. */
  marker?: 'rotation';
}

let nextSeq = 1;

const HEADER =
  /^\s*([A-Za-z_][\w.-]*)\s*(?:\(\s*(\d+)\s*\))?\s*,\s*(\d{4}[./-]\d{1,2}[./-]\d{1,2}[ T]+\d{1,2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?)\s*,\s*([A-Za-z_]\w*)\s*,\s*([A-Za-z_]+)\s*(?:,\s*(.*))?$/;
const TIME = /^(\d{4})[./-](\d{1,2})[./-](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?$/;

/** A log severity word → its level ('' when unknown). */
export function normalizeSeverity(word: string): LogSeverity {
  const w = word.trim().toUpperCase();
  if (w === 'FATAL') return 'fatal';
  if (w === 'SEVERE' || w === 'ERROR' || w === 'ERR') return 'severe';
  if (w === 'WARNING' || w === 'WARN') return 'warning';
  if (w === 'INFO' || w === 'INFORMATION') return 'info';
  if (w === 'DEBUG' || w === 'TRACE' || w === 'DBG') return 'debug';
  return '';
}

/** `2026.10.29 10:12:33.123` (or with `-` / `/`, a `T`, no seconds) → epoch ms, null if unreadable. */
export function parseLogTime(text: string): number | null {
  const m = TIME.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '0', frac = '0'] = m;
  const ms = Number.parseInt(frac.padEnd(3, '0').slice(0, 3), 10);
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

/** One header line → an entry, or null when the line is not a header. */
export function parseHeader(line: string, source: string): LogEntry | null {
  const m = HEADER.exec(line);
  if (!m) return null;
  const [, manager, num, time, category, severity, rest = ''] = m;
  const comma = rest.indexOf(',');
  const code = (comma < 0 ? '' : rest.slice(0, comma)).trim();
  // Empty fields between the code and the message (`0, , Manager started`) are dropped.
  const text = (comma < 0 ? rest : rest.slice(comma + 1)).replace(/^(\s*,)+/, '').trim();
  return {
    seq: nextSeq++,
    source,
    time,
    timeMs: parseLogTime(time),
    manager,
    manNum: num === undefined ? null : Number(num),
    category: category.toUpperCase(),
    severity: normalizeSeverity(severity),
    code,
    text,
    lines: [line]
  };
}

function rawEntry(line: string, source: string): LogEntry {
  return { seq: nextSeq++, source, time: '', timeMs: null, manager: '', manNum: null, category: '', severity: '', code: '', text: line, lines: [line] };
}

/**
 * Parse `text` (read from `source`) after the entries already read from it: a first line
 * that is not a header continues the last entry (a multi-line entry split between two
 * reads of the live tail). Returns a new array; the entries given are not changed.
 */
export function appendLog(previous: readonly LogEntry[], text: string, source: string): LogEntry[] {
  const out = [...previous];
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  // Unknown lines attach to the last HEADER entry; before any header, each is its own entry.
  let last: LogEntry | null = null;
  const tail = out[out.length - 1];
  if (tail && !tail.marker && tail.time) {
    last = { ...tail, lines: [...tail.lines] };
    out[out.length - 1] = last;
  }
  for (const line of lines) {
    const entry = parseHeader(line, source);
    if (entry) {
      out.push(entry);
      last = entry;
    } else if (last) {
      last.lines.push(line);
    } else {
      out.push(rawEntry(line, source));
    }
  }
  return out;
}

/** Parse a whole text. */
export function parseLog(text: string, source: string): LogEntry[] {
  return appendLog([], text, source);
}

/** The rotation marker shown between a `.bak` and the current file. */
export function rotationMarker(source: string, bakName: string): LogEntry {
  return { ...rawEntry(`----- ${bakName} → ${source} (rotation) -----`, source), marker: 'rotation' };
}

/** The `.bak` (previous rotation) then the current file, as one log with a marker in between. */
export function mergeWithBak(bak: readonly LogEntry[], current: readonly LogEntry[], source: string, bakName: string): LogEntry[] {
  if (bak.length === 0) return [...current];
  return [...bak.map((e) => ({ ...e, source })), rotationMarker(source, bakName), ...current];
}

/**
 * Several files' entries as one list ordered by time. An entry without a time (an
 * unrecognised line, a marker) keeps its place after the entry before it in its file;
 * equal times keep the file order. One list is returned as is.
 */
export function mergeByTime(lists: readonly (readonly LogEntry[])[]): LogEntry[] {
  const nonEmpty = lists.filter((l) => l.length > 0);
  if (nonEmpty.length === 0) return [];
  if (nonEmpty.length === 1) return [...nonEmpty[0]];
  const keyed: { entry: LogEntry; t: number; file: number; pos: number }[] = [];
  nonEmpty.forEach((list, file) => {
    let t = Number.NEGATIVE_INFINITY;
    list.forEach((entry, pos) => {
      if (entry.timeMs !== null) t = entry.timeMs;
      keyed.push({ entry, t, file, pos });
    });
  });
  keyed.sort((a, b) => a.t - b.t || a.file - b.file || a.pos - b.pos);
  return keyed.map((k) => k.entry);
}

/** Number of raw lines of some entries (markers excluded). */
export function lineCount(entries: readonly LogEntry[]): number {
  return entries.reduce((n, e) => n + (e.marker ? 0 : e.lines.length), 0);
}

/** The newest entries holding at most `maxLines` lines (the last entry is always kept). */
export function keepLastLines(entries: readonly LogEntry[], maxLines: number): LogEntry[] {
  let n = 0;
  let from = entries.length;
  while (from > 0) {
    const e = entries[from - 1];
    const add = e.marker ? 0 : e.lines.length;
    if (n + add > maxLines && from < entries.length) break;
    n += add;
    from -= 1;
  }
  const kept = entries.slice(from);
  // A marker left at the top separates nothing.
  while (kept.length > 0 && kept[0].marker) kept.shift();
  return kept;
}

export interface LogFilter {
  /** Categories to show; empty = all. */
  categories: readonly string[];
  /** Minimum severity; '' = all (entries without a severity included). */
  minSeverity: LogSeverity;
  /** Free text ('' = none), case-insensitive. */
  text: string;
  /** `text` is a regular expression. */
  regex: boolean;
}

export interface TextMatcher {
  test(line: string): boolean;
  /** [start, end) ranges of the matches in a line, for the highlight. */
  ranges(line: string): [number, number][];
}

/** The matcher of the free-text filter, or `{ error }` for an invalid regular expression. */
export function makeMatcher(text: string, regex: boolean): TextMatcher | { error: string } | null {
  if (!text) return null;
  let re: RegExp;
  try {
    re = new RegExp(regex ? text : text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    test: (line) => {
      re.lastIndex = 0;
      return re.test(line);
    },
    ranges: (line) => {
      const out: [number, number][] = [];
      re.lastIndex = 0;
      for (let m = re.exec(line); m !== null; m = re.exec(line)) {
        if (m[0].length === 0) {
          re.lastIndex += 1; // an empty match (e.g. `a*`) highlights nothing
          continue;
        }
        out.push([m.index, m.index + m[0].length]);
      }
      return out;
    }
  };
}

export function isMatcherError(m: TextMatcher | { error: string } | null): m is { error: string } {
  return m !== null && 'error' in m;
}

const severityRank = (s: LogSeverity): number => (s ? SEVERITIES.indexOf(s) : -1);

/**
 * The entries that pass every filter. A multi-line entry passes or fails whole (the text
 * filter looks at all its lines). Markers always pass. An invalid regular expression
 * filters nothing and is reported in `error`.
 */
export function filterEntries(entries: readonly LogEntry[], filter: LogFilter): { entries: LogEntry[]; error: string } {
  const matcher = makeMatcher(filter.text, filter.regex);
  const error = isMatcherError(matcher) ? matcher.error : '';
  const text = isMatcherError(matcher) ? null : matcher;
  const cats = new Set(filter.categories.map((c) => c.toUpperCase()));
  const min = severityRank(filter.minSeverity);
  const out = entries.filter((e) => {
    if (e.marker) return true;
    if (cats.size > 0 && !cats.has(e.category)) return false;
    if (min >= 0 && severityRank(e.severity) < min) return false;
    return !text || e.lines.some((l) => text.test(l));
  });
  return { entries: out, error };
}

/** A line cut into plain and highlighted parts. */
export function highlightSegments(line: string, matcher: TextMatcher | null): { text: string; hit: boolean }[] {
  if (!matcher) return [{ text: line, hit: false }];
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (const [start, end] of matcher.ranges(line)) {
    if (start > at) out.push({ text: line.slice(at, start), hit: false });
    out.push({ text: line.slice(start, end), hit: true });
    at = end;
  }
  if (at < line.length || out.length === 0) out.push({ text: line.slice(at), hit: false });
  return out;
}

/** The categories found in some entries, sorted. */
export function categoriesOf(entries: readonly LogEntry[]): string[] {
  return [...new Set(entries.map((e) => e.category).filter(Boolean))].sort();
}

/** `.log` export: the raw lines of the entries, markers as their own line. */
export function toLogText(entries: readonly LogEntry[]): string {
  return entries.map((e) => e.lines.join('\n')).join('\n') + (entries.length > 0 ? '\n' : '');
}

function csvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** CSV export: `time;manager;category;severity;text`, a multi-line entry in one quoted field. */
export function toCsv(entries: readonly LogEntry[]): string {
  const rows = ['time;manager;category;severity;text'];
  for (const e of entries) {
    if (e.marker) continue;
    const manager = e.manager ? (e.manNum === null ? e.manager : `${e.manager} (${e.manNum})`) : '';
    const text = [e.time ? e.text : e.lines[0], ...e.lines.slice(1)].join('\n');
    rows.push([e.time, manager, e.category, e.severity, text].map(csvField).join(';'));
  }
  return rows.join('\r\n') + '\r\n';
}

/** Export file name: `logs_<host>_<yyyymmdd-hhmmss>.<ext>` (host made file-name safe). */
export function exportFileName(host: string, ext: string, date: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  const safeHost = (host || 'host').replace(/[^A-Za-z0-9_.-]/g, '_');
  return `logs_${safeHost}_${stamp}.${ext}`;
}
