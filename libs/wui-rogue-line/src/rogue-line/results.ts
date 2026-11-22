// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the runs' results (`RogueLine_Results.json`, an array) and the ranking. Pure.
 * Nicknames only: no email, no user name.
 */
import type { Difficulty } from './sim.js';

export const RESULTS_DP = 'RogueLine_Results';
/** The log keeps the latest runs only. */
export const RESULTS_MAX = 500;
export const NICKNAME_MAX = 16;

export interface GameResult {
  id: string;
  nickname: string;
  score: number;
  /** The last level reached (1…). */
  level: number;
  /** All the levels cleared. */
  completed: boolean;
  difficulty: Difficulty;
  /** Epoch ms. */
  at: number;
}

export interface BoardRow {
  place: number;
  nickname: string;
  score: number;
  level: number;
  completed: boolean;
  /** The result just played. */
  mine: boolean;
}

export function newResultId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** A nickname as kept: trimmed, printable, at most NICKNAME_MAX characters. */
export function cleanNickname(s: string): string {
  return s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NICKNAME_MAX);
}

/** Only well-formed rows of a log read back. */
export function parseResults(raw: unknown): GameResult[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (r): r is GameResult =>
      typeof r === 'object' && r !== null && typeof (r as GameResult).id === 'string' && typeof (r as GameResult).nickname === 'string' && Number.isFinite((r as GameResult).score)
  );
}

/** The log with a new result, the oldest dropped beyond RESULTS_MAX. */
export function addResult(log: readonly GameResult[], r: GameResult): GameResult[] {
  return [...log, r].slice(-RESULTS_MAX);
}

/**
 * The ranking: each nickname's best run, highest score first (then the furthest level, then the
 * earliest); the top `n`, plus the run just played when it is further down.
 */
export function leaderboard(log: readonly GameResult[], mineId: string | null, n = 10): BoardRow[] {
  const best = new Map<string, GameResult>();
  for (const r of log) {
    const key = r.nickname.toLowerCase() || r.id;
    const b = best.get(key);
    if (!b || r.score > b.score || (r.score === b.score && r.level > b.level) || (r.id === mineId && r.score === b.score)) best.set(key, r);
  }
  const rows = [...best.values()].sort((a, b) => b.score - a.score || b.level - a.level || a.at - b.at);
  const out: BoardRow[] = rows.map((r, k) => ({ place: k + 1, nickname: r.nickname || 'Technician', score: r.score, level: r.level, completed: r.completed, mine: r.id === mineId }));
  const top = out.slice(0, n);
  const mine = out.find((r) => r.mine);
  if (mine && mine.place > n) top.push(mine);
  return top;
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
