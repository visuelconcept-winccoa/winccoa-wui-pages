// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A page's selection in the user's settings: restored at start, saved when it changes (only
 * then), replaced after a login; the period kept as a span ending today or as fixed dates.
 */
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { PagePrefs, oneOf, restorePeriod, storePeriod } from './page-prefs.js';
import { settingsCache } from './settings-cache.js';

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => settingsCache.connect(null));

describe('page selection', () => {
  it('is restored at start, saved only when it changed, replaced after a login', async () => {
    const user$ = new BehaviorSubject('alice');
    const stored: Record<string, unknown> = { alice: { year: 2025 }, bob: { year: 2024 } };
    const writes: unknown[] = [];
    settingsCache.connect({ user$, get: async () => stored[user$.value] ?? null, set: (_k, v) => void writes.push(v) });
    const page = { year: 0, switched: 0 };
    const prefs = new PagePrefs(
      'fleet-closures',
      () => ({ year: page.year }),
      (v) => (page.year = typeof v['year'] === 'number' ? v['year'] : 0),
      () => page.switched++
    );
    const sub = prefs.watch();
    prefs.save();
    expect(writes).toEqual([]);
    await prefs.restore();
    expect(page.year).toBe(2025);
    prefs.save();
    expect(writes).toEqual([]);
    page.year = 2026;
    prefs.save();
    prefs.save();
    expect(writes).toEqual([{ year: 2026 }]);
    user$.next('bob');
    await settle();
    expect(page).toEqual({ year: 2024, switched: 1 });
    sub.unsubscribe();
  });
});

describe('stored period', () => {
  const today = new Date(2026, 10, 4);

  it('is a span when it ends today, the dates otherwise', () => {
    expect(storePeriod('2026-10-04', '2026-11-04', today)).toEqual({ days: 31 });
    expect(storePeriod('2026-01-01', '2026-03-31', today)).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(storePeriod('', '2026-11-04', today)).toBeNull();
  });

  it('comes back ending today for a span, as is for dates, null for garbage', () => {
    expect(restorePeriod({ days: 31 }, new Date(2026, 11, 15))).toEqual({ start: '2026-11-14', end: '2026-12-15' });
    expect(restorePeriod({ start: '2026-01-01', end: '2026-03-31' }, today)).toEqual({ start: '2026-01-01', end: '2026-03-31' });
    expect(restorePeriod({ days: -1 }, today)).toBeNull();
    expect(restorePeriod({ start: 'x', end: '2026-01-01' }, today)).toBeNull();
    expect(restorePeriod(null, today)).toBeNull();
  });

  it('keeps only known values', () => {
    expect(oneOf('desc', ['asc', 'desc'] as const)).toBe('desc');
    expect(oneOf('up', ['asc', 'desc'] as const)).toBeUndefined();
  });
});
