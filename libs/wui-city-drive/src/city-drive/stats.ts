// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The statistics of the admin page (#94), from the results log (`CityDrive_Results`,
 * results.ts). Pure. A match is the set of results that share one end time (`at`): one result
 * per player of that match.
 */
import { playerCount, type GameResult } from './results.js';

export interface GameStats {
  /** Matches played, and how many of them with two players. */
  matches: number;
  duo: number;
  /** People in the ranking (one per email, else per nickname). */
  players: number;
  /** Results that came with an email, and distinct emails. */
  withEmail: number;
  emails: number;
  /** Logos: in all, per result on average, the best result. */
  logos: number;
  avgLogos: number;
  bestLogos: number;
  avgScore: number;
  /** First and last match (ISO), or ''. */
  first: string;
  last: string;
  /** Matches per hour of the day (local time), 24 slots. */
  byHour: number[];
  /** Matches per day (YYYY-MM-DD, local time), oldest first. */
  byDay: { day: string; matches: number }[];
  /** Logos per result: how many results got 0-4, 5-9, 10-14, 15-19, 20+. */
  logoBands: { label: string; count: number }[];
}

const BANDS = [
  { label: '0-4', max: 4 },
  { label: '5-9', max: 9 },
  { label: '10-14', max: 14 },
  { label: '15-19', max: 19 },
  { label: '20+', max: Infinity }
];

const pad = (n: number): string => String(n).padStart(2, '0');
const localDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function gameStats(log: readonly GameResult[]): GameStats {
  const byMatch = new Map<string, GameResult[]>();
  for (const r of log) byMatch.set(r.at, [...(byMatch.get(r.at) ?? []), r]);
  const byHour = Array.from({ length: 24 }, () => 0);
  const days = new Map<string, number>();
  for (const at of byMatch.keys()) {
    const d = new Date(at);
    if (Number.isNaN(d.getTime())) continue;
    byHour[d.getHours()]++;
    days.set(localDay(d), (days.get(localDay(d)) ?? 0) + 1);
  }
  const logos = log.reduce((a, r) => a + r.logos, 0);
  const emails = new Set(log.map((r) => r.email.trim().toLowerCase()).filter(Boolean));
  const times = [...byMatch.keys()].filter((t) => !Number.isNaN(new Date(t).getTime())).sort();
  return {
    matches: byMatch.size,
    duo: [...byMatch.values()].filter((m) => m.length > 1).length,
    players: playerCount(log),
    withEmail: log.filter((r) => r.email.trim() !== '').length,
    emails: emails.size,
    logos,
    avgLogos: log.length ? Math.round((logos / log.length) * 10) / 10 : 0,
    bestLogos: log.reduce((a, r) => Math.max(a, r.logos), 0),
    avgScore: log.length ? Math.round(log.reduce((a, r) => a + r.score, 0) / log.length) : 0,
    first: times[0] ?? '',
    last: times.at(-1) ?? '',
    byHour,
    byDay: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, matches]) => ({ day, matches })),
    logoBands: BANDS.map((b, k) => ({ label: b.label, count: log.filter((r) => r.logos <= b.max && (k === 0 || r.logos > BANDS[k - 1].max)).length }))
  };
}

const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  // quotes doubled; a leading = + - @ neutralised (no formula when opened in a spreadsheet)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",;\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** The results as CSV (`;`-separated, for Excel in French), emails included: admin only. */
export function resultsCsv(log: readonly GameResult[]): string {
  const head = ['date', 'nickname', 'email', 'logos', 'score', 'match_s'];
  const rows = log.map((r) => [r.at, r.nickname, r.email, r.logos, r.score, r.duration].map(csvCell).join(';'));
  return `﻿${[head.join(';'), ...rows].join('\r\n')}\r\n`;
}
