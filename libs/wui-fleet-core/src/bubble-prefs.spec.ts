// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A viewer's bubble choices: items offered by the machines, the viewer's choice over the
 * machine's configuration, remembered per atelier in the browser.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  BUBBLE_PREFS_STORAGE_KEY,
  bubbleItems,
  loadBubblePrefs,
  saveBubblePrefs,
  showsInBubble
} from './bubble-prefs.js';
import type { MachineDef } from './types.js';

const machine = (id: string, kpis: MachineDef['kpis']): MachineDef =>
  ({ id, name: id, type: 'cabinet', state: 'ok', x: 0, z: 0, kpis }) as MachineDef;

describe('bubble items', () => {
  it('are the items the machines offer, shown by default when one machine shows them', () => {
    const items = bubbleItems([
      machine('A', [{ key: 'ARTICLE', label: 'Article', showInBubble: false }]),
      machine('B', [{ key: 'ARTICLE', label: 'Article', showInBubble: true }, { key: 'T', label: 'Température' }])
    ]);
    const params = items.filter((i) => i.ref.startsWith('param:'));
    expect(params).toEqual([
      { ref: 'param:ARTICLE', label: 'Article', byDefault: true },
      { ref: 'param:T', label: 'Température', byDefault: false }
    ]);
    expect(items[0].ref).toBe('state');
  });

  it("the viewer's choice wins over the machine's, absent it the machine's applies", () => {
    const prefs = { lines: { 'param:T': true, state: false }, hidden: [] };
    expect(showsInBubble(prefs, 'param:T', false)).toBe(true);
    expect(showsInBubble(prefs, 'state', true)).toBe(false);
    expect(showsInBubble(prefs, 'param:ARTICLE', true)).toBe(true);
  });
});

describe('remembered choices', () => {
  const store = new Map<string, string>();
  const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  afterEach(() => {
    store.clear();
    Reflect.deleteProperty(globalThis, 'localStorage');
  });

  it('are kept per atelier', () => {
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    saveBubblePrefs('a1', { lines: { state: false }, hidden: ['M1'] });
    saveBubblePrefs('a2', { lines: {}, hidden: ['M9'] });
    expect(loadBubblePrefs('a1')).toEqual({ lines: { state: false }, hidden: ['M1'] });
    expect(loadBubblePrefs('a2').hidden).toEqual(['M9']);
    expect(loadBubblePrefs('a3')).toEqual({ lines: {}, hidden: [] });
  });

  it('are empty without storage or with garbage', () => {
    expect(loadBubblePrefs('a1')).toEqual({ lines: {}, hidden: [] });
    Object.defineProperty(globalThis, 'localStorage', { value: fake, configurable: true });
    store.set(BUBBLE_PREFS_STORAGE_KEY, '{"a1":{"lines":{"x":"yes"},"hidden":[1,"M2"]}}');
    expect(loadBubblePrefs('a1')).toEqual({ lines: {}, hidden: ['M2'] });
  });
});
