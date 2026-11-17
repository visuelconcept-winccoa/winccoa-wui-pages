// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The results of the matches and the logo leaderboard. Pure, no DOM.
 *
 * Each finished match appends one result per local player (nickname, optional email, logos,
 * score) to a log kept in the datapoint `CityDrive_Results`. The leaderboard ranks the people by
 * the WinCC OA logos taken: one row per person (the email when given, else the nickname), their
 * best match. It carries nicknames only: the email never leaves the log.
 */

export interface GameResult {
  id: string;
  nickname: string;
  /** Optional, '' when not given. Never shown. */
  email: string;
  logos: number;
  score: number;
  /** ISO date of the end of the match. */
  at: string;
  /** Match length in seconds. */
  duration: number;
}

export interface BoardRow {
  rank: number;
  nickname: string;
  logos: number;
  score: number;
  /** A result of the match just played. */
  mine: boolean;
}

/** Results kept in the log: the oldest ones go first. */
export const MAX_RESULTS = 1000;
export const BOARD_SIZE = 10;

/** A plausible email address (the field is optional: '' is valid too). */
export function validEmail(s: string): boolean {
  const t = s.trim();
  return t === '' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(t);
}

/** The log with the new results, trimmed to `max`. */
export function addResults(log: readonly GameResult[], results: readonly GameResult[], max = MAX_RESULTS): GameResult[] {
  return [...log, ...results].slice(-max);
}

/** The person behind a result: the email when given, else the nickname. */
const personOf = (r: GameResult): string => (r.email.trim() ? `@${r.email.trim().toLowerCase()}` : `#${r.nickname.trim().toLowerCase()}`);

/** Better result first: more logos, then a higher score, then the earlier one. */
const better = (a: GameResult, b: GameResult): number => b.logos - a.logos || b.score - a.score || a.at.localeCompare(b.at);

/**
 * The leaderboard: each person's best result, ranked by logos (score breaks a tie; equal rows
 * share a rank). The top `size` rows, plus the rows of `mine` (the match just played) that fall
 * below them, so each player sees where they stand.
 */
export function leaderboard(log: readonly GameResult[], mine: ReadonlySet<string> = new Set(), size = BOARD_SIZE): BoardRow[] {
  const best = new Map<string, GameResult>();
  const mineOf = new Map<string, boolean>();
  for (const r of log) {
    const who = personOf(r);
    const kept = best.get(who);
    if (!kept || better(r, kept) < 0) best.set(who, r);
    if (mine.has(r.id)) mineOf.set(who, true);
  }
  const sorted = [...best.entries()].sort(([, a], [, b]) => better(a, b));
  const rows: BoardRow[] = [];
  sorted.forEach(([who, r], k) => {
    const prev = rows[k - 1];
    const rank = prev && prev.logos === r.logos && prev.score === r.score ? prev.rank : k + 1;
    rows.push({ rank, nickname: r.nickname.trim() || 'Player', logos: r.logos, score: r.score, mine: mineOf.get(who) === true });
  });
  return rows.filter((row, k) => k < size || row.mine);
}

/** The number of people in the log (one per email, else per nickname): the size of the ranking. */
export function playerCount(log: readonly GameResult[]): number {
  return new Set(log.map(personOf)).size;
}

/** `1st`, `2nd`, `3rd`, `4th`… */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
}

/** A short random id for a result. */
export const resultId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
