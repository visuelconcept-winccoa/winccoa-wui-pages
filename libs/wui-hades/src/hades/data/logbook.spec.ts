// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Logbook — entry bookkeeping, the single-active-incident lifecycle and the
 * size cap. Runs against the store's in-memory (offline) fallback: no DI
 * container is registered in the test environment, so every write stays local.
 */
import { describe, expect, it } from 'vitest';
import { LogbookStore, MAX_ENTRIES } from './logbook.js';

describe('LogbookStore', () => {
  it('appends entries newest-first', async () => {
    const store = new LogbookStore('spec-a');
    await store.load();
    await store.addEntry('note', 'first');
    await store.addEntry('alarm', 'second');
    const entries = store.current.entries;
    expect(entries[0].text).toBe('second');
    expect(entries[1].text).toBe('first');
    expect(entries[0].kind).toBe('alarm');
  });

  it('caps the journal at MAX_ENTRIES', async () => {
    const store = new LogbookStore('spec-b');
    await store.load();
    for (let i = 0; i < MAX_ENTRIES + 25; i++) {
      // eslint-disable-next-line no-await-in-loop
      await store.addEntry('note', `n${i}`);
    }
    expect(store.current.entries.length).toBe(MAX_ENTRIES);
    expect(store.current.entries[0].text).toBe(`n${MAX_ENTRIES + 24}`);
  });

  it('allows only one active incident and attaches entries to it', async () => {
    const store = new LogbookStore('spec-c');
    await store.load();
    const incident = await store.openIncident('Stopped HGV', 'major', { pkM: 1200 });
    expect(incident).toBeDefined();
    expect(await store.openIncident('Another', 'minor')).toBeUndefined();
    const during = await store.addEntry('command', 'close barrier');
    expect(during.incidentId).toBe(incident!.id);
    await store.closeIncident('resolved');
    expect(store.activeIncident).toBeUndefined();
    const after = await store.addEntry('note', 'post-incident');
    expect(after.incidentId).toBeUndefined();
  });

  it('marks drill entries so they stay distinguishable', async () => {
    const store = new LogbookStore('spec-d');
    await store.load();
    const entry = await store.addEntry('exercise', 'simulated', { exercise: true });
    expect(entry.exercise).toBe(true);
    expect(entry.kind).toBe('exercise');
  });
});
