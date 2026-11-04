// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A page's selection (ateliers, machines, period, sort, tab…) kept in the user's settings
 * (settings-cache.ts): restored when the page starts, again after a login, saved when it
 * changes. The page gives its `snapshot()` (what to keep) and `apply(stored)` (validates and
 * applies a stored value, ignoring what it does not know).
 *
 *   private readonly prefs = new PagePrefs('fleet-closures', () => ({ year: this.year }), (v) => …, () => this.recompute());
 *   connectedCallback: this.prefsSub = this.prefs.watch();
 *   start:             await this.prefs.restore();   // then a hand-off, if any, wins
 *   updated:           this.prefs.save();
 */
import type { Subscription } from 'rxjs';

import { settingObject, settingsCache, type FleetSettingKey } from './settings-cache.js';

export class PagePrefs {
  private ready = false;
  private loads = 0;
  private last = '';

  constructor(
    private readonly key: FleetSettingKey,
    private readonly snapshot: () => Record<string, unknown>,
    private readonly apply: (stored: Record<string, unknown>) => void,
    /** After a login, once the new user's selection is applied (e.g. recompute). */
    private readonly onUserChange: () => void
  ) {}

  /** Follow the logins: the next user's selection replaces the current one. */
  watch(): Subscription {
    return settingsCache.watch([this.key], () => {
      // The first load is the page's start (`restore`); the next ones are logins.
      this.loads += 1;
      if (this.loads === 1 || !this.ready) return;
      this.applyStored();
      this.onUserChange();
    });
  }

  /** Apply the user's selection at the page's start; saving starts afterwards. */
  async restore(): Promise<void> {
    await settingsCache.load(this.key);
    this.applyStored();
    this.ready = true;
  }

  /** Save the selection when it changed (call from `updated`). */
  save(): void {
    if (!this.ready) return;
    const value = JSON.stringify(this.snapshot());
    if (value === this.last) return;
    this.last = value;
    settingsCache.set(this.key, JSON.parse(value) as unknown);
  }

  private applyStored(): void {
    this.apply(settingObject(this.key));
    this.last = JSON.stringify(this.snapshot());
  }
}

/** A period as stored: a span ending today (it moves with the days), or fixed dates. */
export type StoredPeriod = { days: number } | { start: string; end: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** `yyyy-mm-dd` of a local date. */
export function dateStr(d: Date): string {
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

function localDay(s: string): number {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The period to keep: a span when it ends today, the dates otherwise; null when incomplete. */
export function storePeriod(start: string, end: string, today = new Date()): StoredPeriod | null {
  if (!DATE_RE.test(start) || !DATE_RE.test(end)) return null;
  if (end === dateStr(today)) return { days: Math.round((localDay(end) - localDay(start)) / DAY_MS) };
  return { start, end };
}

/** The period of a stored value (start, end as `yyyy-mm-dd`), null when there is none. */
export function restorePeriod(raw: unknown, today = new Date()): { start: string; end: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p['days'] === 'number' && Number.isInteger(p['days']) && p['days'] >= 0) {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - p['days']);
    return { start: dateStr(start), end: dateStr(today) };
  }
  if (typeof p['start'] === 'string' && typeof p['end'] === 'string' && DATE_RE.test(p['start']) && DATE_RE.test(p['end'])) {
    return { start: p['start'], end: p['end'] };
  }
  return null;
}

/** `raw` when it is one of `allowed`, undefined otherwise. */
export function oneOf<T extends string>(raw: unknown, allowed: readonly T[]): T | undefined {
  return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as T) : undefined;
}
