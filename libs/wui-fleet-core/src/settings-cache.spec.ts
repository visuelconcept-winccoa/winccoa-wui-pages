// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The fleet pages' settings cache: loaded from the user's settings, again after a login,
 * the browser's former choices taken over once, a change kept at once and sent back.
 */
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsCache, legacyValue, type SettingsBackend } from './settings-cache.js';

function fakeBackend(stored: Record<string, Record<string, unknown>>) {
  const user$ = new BehaviorSubject('alice');
  const writes: [string, string, unknown][] = [];
  const backend: SettingsBackend = {
    user$,
    get: async (key) => stored[user$.value]?.[key] ?? null,
    set: (key, value) => void writes.push([user$.value, key, value])
  };
  return { backend, user$, writes };
}

function fakeStorage(items: Record<string, string>) {
  const store = new Map(Object.entries(items));
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => store.get(k) ?? null, removeItem: (k: string) => void store.delete(k) },
    configurable: true
  });
  return store;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => Reflect.deleteProperty(globalThis, 'localStorage'));

describe('fleet settings cache', () => {
  it("loads the user's values, then again for the next user", async () => {
    const { backend, user$ } = fakeBackend({ alice: { 'fleet-filter': { tags: { Line: ['L3'] } } }, bob: {} });
    const cache = new SettingsCache();
    cache.connect(backend);
    let ready = 0;
    const sub = cache.watch(['fleet-filter'], () => ready++);
    await settle();
    expect(ready).toBe(1);
    expect(cache.get('fleet-filter')).toEqual({ tags: { Line: ['L3'] } });
    user$.next('bob');
    await settle();
    expect(ready).toBe(2);
    expect(cache.get('fleet-filter')).toBeUndefined();
    sub.unsubscribe();
  });

  it('keeps a change at once and sends it to the backend; a late load does not overwrite it', async () => {
    const { backend, writes } = fakeBackend({ alice: { 'fleet-closures': { year: 2025 } } });
    const cache = new SettingsCache();
    cache.connect(backend);
    const loading = cache.load('fleet-closures');
    cache.set('fleet-closures', { year: 2026 });
    await loading;
    expect(cache.get('fleet-closures')).toEqual({ year: 2026 });
    expect(writes).toEqual([['alice', 'fleet-closures', { year: 2026 }]]);
  });

  it("takes the browser's former choices over for a user with none, then forgets them", async () => {
    const store = fakeStorage({ 'wui.machine-fleet.filter': '{"Line":["L2"]}', 'wui.machine-fleet.state-filter': '["arret"]' });
    const { backend, writes } = fakeBackend({ alice: {} });
    const cache = new SettingsCache();
    cache.connect(backend);
    await cache.load('fleet-filter');
    expect(cache.get('fleet-filter')).toEqual({ tags: { Line: ['L2'] }, states: ['arret'] });
    expect(writes).toEqual([['alice', 'fleet-filter', { tags: { Line: ['L2'] }, states: ['arret'] }]]);
    expect(store.size).toBe(0);
  });

  it("leaves the browser's choices alone when the user already has a value", async () => {
    const store = fakeStorage({ 'wui.machine-fleet.bubbles': '{"a1":{"lines":{},"hidden":["M1"]}}' });
    const { backend, writes } = fakeBackend({ alice: { 'fleet-ateliers': { a1: { lines: {}, hidden: [] } } } });
    const cache = new SettingsCache();
    cache.connect(backend);
    await cache.load('fleet-ateliers');
    expect(cache.get('fleet-ateliers')).toEqual({ a1: { lines: {}, hidden: [] } });
    expect(writes).toEqual([]);
    expect(store.size).toBe(1);
  });

  it('works in memory without a backend, reading the former choices without removing them', async () => {
    const store = fakeStorage({ 'wui.machine-fleet.dashboard-filter': '{"states":["arret"]}' });
    const cache = new SettingsCache();
    let ready = 0;
    cache.watch(['fleet-dashboard', 'fleet-kpi-analysis'], () => ready++);
    await settle();
    expect(ready).toBe(1);
    expect(cache.get('fleet-dashboard')).toEqual({ states: ['arret'] });
    expect(cache.get('fleet-kpi-analysis')).toBeUndefined();
    expect(store.size).toBe(1);
  });

  it('reads no former choice from garbage', () => {
    fakeStorage({ 'wui.machine-fleet.bubbles': '{nope' });
    expect(legacyValue('fleet-ateliers')).toBeNull();
    expect(legacyValue('fleet-stop-analysis')).toBeNull();
  });
});
