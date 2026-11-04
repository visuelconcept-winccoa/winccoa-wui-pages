// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A viewer's bubble choices: items offered by the machines, the viewer's choice over the
 * machine's configuration, remembered per atelier in the user's settings.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  ATELIER_PREFS_SETTING,
  bubbleItems,
  loadBubblePrefs,
  loadDisplayPrefs,
  saveBubblePrefs,
  saveDisplayPrefs,
  showsInBubble
} from './bubble-prefs.js';
import { settingsCache } from './settings-cache.js';
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
  afterEach(() => settingsCache.connect(null));

  it('are kept per atelier, with the display toggles apart', () => {
    saveBubblePrefs('a1', { lines: { state: false }, hidden: ['M1'] });
    saveBubblePrefs('a2', { lines: {}, hidden: ['M9'] });
    saveDisplayPrefs('a1', { labels: false });
    expect(loadBubblePrefs('a1')).toEqual({ lines: { state: false }, hidden: ['M1'] });
    expect(loadBubblePrefs('a2').hidden).toEqual(['M9']);
    expect(loadBubblePrefs('a3')).toEqual({ lines: {}, hidden: [] });
    expect(loadDisplayPrefs('a1')).toEqual({ labels: false });
    expect(loadDisplayPrefs('a2')).toEqual({});
    // Saving the bubbles keeps the toggles, and back.
    saveBubblePrefs('a1', { lines: {}, hidden: [] });
    expect(loadDisplayPrefs('a1')).toEqual({ labels: false });
  });

  it('are empty before loading or with garbage', () => {
    expect(loadBubblePrefs('a1')).toEqual({ lines: {}, hidden: [] });
    settingsCache.set(ATELIER_PREFS_SETTING, { a1: { lines: { x: 'yes' }, hidden: [1, 'M2'], display: { roof: 'no', alertOnly: true } } });
    expect(loadBubblePrefs('a1')).toEqual({ lines: {}, hidden: ['M2'] });
    expect(loadDisplayPrefs('a1')).toEqual({ alertOnly: true });
  });
});
