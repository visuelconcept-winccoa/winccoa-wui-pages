// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** A line value translated through a table: the contract of the article in production (winccoa-fra-msp-stma#373). */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { lineDps, lookupValue } from './lookup.js';

const require = createRequire(import.meta.url);
// The MSP article catalogue of a real project (23/11/2026) and the contract the former supervision manager
// organisation_sync derived for every article (its function contractOf, 2.2.0), the reference.
const ref = require('./lookup.cases.json') as { articles: string; specifications: string; field: string; expected: Record<string, string> };
const CONTRACT = { dp: 'stma/articles.', key: 'id', field: ref.field };

describe('line value translated through a table', () => {
  it('gives the contract the 2.2.0 supervision gave, for every article of a real catalogue', () => {
    const articles = Object.keys(ref.expected);
    expect(articles.length).toBeGreaterThan(50);
    for (const a of articles) expect(lookupValue(a, ref.articles, CONTRACT), a).toBe(ref.expected[a]);
  });

  it('is empty for an unknown or empty article, a missing field, or no table', () => {
    expect(lookupValue('SM-XX-INCONNU', ref.articles, CONTRACT)).toBe('');
    expect(lookupValue('', ref.articles, CONTRACT)).toBe('');
    expect(lookupValue(null, ref.articles, CONTRACT)).toBe('');
    expect(lookupValue(Object.keys(ref.expected)[0], ref.articles, { ...CONTRACT, field: 'absent' })).toBe('');
    expect(lookupValue(Object.keys(ref.expected)[0], '', CONTRACT)).toBe('');
    expect(lookupValue(Object.keys(ref.expected)[0], 'pas du json', CONTRACT)).toBe('');
    expect(lookupValue('A', ref.articles, undefined)).toBe('');
  });

  it('reads the table as received (text, array, or a one-value list) and the value trimmed', () => {
    const table = [{ id: 'A', c: 'X' }, { code: 'B', c: 'Y' }];
    expect(lookupValue(' A ', JSON.stringify(table), { dp: 't', field: 'c' })).toBe('X');
    expect(lookupValue('A', table, { dp: 't', field: 'c' })).toBe('X');
    expect(lookupValue(['A'], [JSON.stringify(table)], { dp: 't', field: 'c' })).toBe('X');
    expect(lookupValue('B', table, { dp: 't', key: 'code', field: 'c' })).toBe('Y');
  });

  it('needs the line datapoint and the table datapoint', () => {
    expect(lineDps({ dp: 'WC.Context.Article', lookup: CONTRACT })).toEqual(['WC.Context.Article', 'stma/articles.']);
    expect(lineDps({ dp: 'P.Value' })).toEqual(['P.Value']);
    expect(lineDps({})).toEqual([]);
  });
});
