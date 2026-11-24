// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** « Add a symbol › From the site » reads the machines the site serves (winccoa-fra-msp-stma#381). */
import { describe, expect, it } from 'vitest';
import { loadSiteSymbols, mappingsOf, readSiteSymbols, siteGroupOf, sitePlan } from './site-symbols.js';
import type { MachineDef } from '../types.js';

const MAPPING = { id: 'mes-4', name: 'MES', inputs: [], rules: [], fallback: 'non_charge' };
const doc = (symbols: unknown[]) => ({
  format: 'machine-fleet-symbols', version: 1, source: { kind: 'site', label: 'Site' }, mappings: [MAPPING], symbols
});
const M1 = { id: 'M1', name: 'Presse 1', stateMappingId: 'mes-4', workcenter: 'WC_A', x: 3, z: 4 };
const M2 = { id: 'M2', name: 'Four 2', workcenter: 'WC_B' };

describe('site symbols', () => {
  it('reads the machines and the workcenter labels of the site', () => {
    const r = readSiteSymbols(200, { ok: true, text: '2 machines', data: doc([M1, M2]), groups: { WC_A: 'Presses', WC_B: ' ', X: 3 } });
    expect(r.state).toBe('ok');
    if (r.state !== 'ok') return;
    expect(r.symbols.map((s) => [s.id, s.name, s.state, s.toPlace])).toEqual([['M1', 'Presse 1', 'disconnected', undefined], ['M2', 'Four 2', 'disconnected', true]]);
    expect(r.mappings).toEqual([MAPPING]);
    expect(r.groups).toEqual({ WC_A: 'Presses' });
    expect(siteGroupOf(r.symbols[0], r.groups)).toBe('Presses');
    expect(siteGroupOf(r.symbols[1], r.groups)).toBe('B');
    expect(siteGroupOf({ id: 'x', name: 'x', type: 'cabinet', x: 0, z: 0, state: 'ok' }, r.groups)).toBe('');
  });

  it('a site without machine offers nothing, without error', () => {
    expect(readSiteSymbols(200, { ok: true, data: doc([]) })).toEqual({ state: 'ok', symbols: [], mappings: [], groups: {} });
  });

  it('says why there are no machines', () => {
    expect(readSiteSymbols(404, null)).toMatchObject({ state: 'error', text: expect.stringContaining('404') });
    expect(readSiteSymbols(403, null)).toMatchObject({ state: 'error', text: expect.stringContaining('403') });
    expect(readSiteSymbols(500, null)).toMatchObject({ state: 'error', text: expect.stringContaining('500') });
    expect(readSiteSymbols(200, { ok: false, text: 'Modèle des workcenters absent.' })).toEqual({ state: 'error', text: 'Modèle des workcenters absent.' });
    expect(readSiteSymbols(200, { ok: true, data: { format: 'autre', version: 1, symbols: [] } })).toMatchObject({ state: 'error' });
  });

  it('loads from the declared path only, with a time limit, and never throws', async () => {
    expect(await loadSiteSymbols(undefined)).toEqual({ state: 'none' });
    expect(await loadSiteSymbols('')).toEqual({ state: 'none' });
    let asked = '';
    let auth = '';
    const ok = (async (url: string, init: RequestInit) => {
      asked = url;
      auth = (init.headers as Record<string, string>)['Authorization'] ?? '';
      return new Response(JSON.stringify({ ok: true, data: doc([M1]) }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await loadSiteSymbols('/api/organisation/symbols', { Authorization: 'Bearer t' }, ok);
    expect([asked, auth, r.state]).toEqual(['/api/organisation/symbols', 'Bearer t', 'ok']);
    const down = (async () => { throw new Error('réseau coupé'); }) as unknown as typeof fetch;
    expect(await loadSiteSymbols('/x', {}, down)).toEqual({ state: 'error', text: 'réseau coupé' });
    const never = ((_: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    expect(await loadSiteSymbols('/x', {}, never, 20)).toEqual({ state: 'error', text: 'no answer in 0.02 s' });
  });

  it('updates in place a site machine already in the atelier, adds the others (#381)', () => {
    const m1 = M1 as unknown as MachineDef;
    const m2 = M2 as unknown as MachineDef;
    const placed = { ...m1, name: 'Presse 1 (quai)', x: 12, z: -3 } as MachineDef;
    expect(sitePlan([m1, m2], [placed])).toEqual({ add: [m2], replace: [m1] });
    expect(sitePlan([m1], [])).toEqual({ add: [m1], replace: [] });
  });

  it('adds with a machine the state mappings it uses', () => {
    const defs = [M1 as unknown as MachineDef, M2 as unknown as MachineDef];
    expect(mappingsOf(defs, [MAPPING, { ...MAPPING, id: 'other' }])).toEqual([MAPPING]);
  });
});
