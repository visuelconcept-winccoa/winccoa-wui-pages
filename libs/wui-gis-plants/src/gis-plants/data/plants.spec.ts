// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import {
  STATE_OFF,
  STATE_RUN,
  cellNumber,
  dpeName,
  plantBindings,
  rankPlants,
  summarize,
  type Plant
} from './plants.js';

function plant(stem: string, puissance: number, etat = STATE_RUN): Plant {
  return {
    stem,
    name: stem,
    siteId: '',
    siteName: '',
    values: { puissance, capacite: 1000, etat }
  };
}

function reading(id: string, dp: string): { id: string; dp: string } {
  return { id, dp };
}

/** The shape of `GIS_france-centrales-nucl-aires--msq5khtu.json`, trimmed to two assets. */
const SITE = JSON.stringify({
  id: 'france-centrales',
  name: 'France — Centrales',
  assets: [
    {
      id: 'belleville',
      name: 'Centrale de Belleville',
      dp: 'System1:GisSim_belleville_defaut',
      readings: [
        reading('puissance', 'System1:GisSim_belleville_puissance'),
        reading('capacite', 'System1:GisSim_belleville_capacite'),
        reading('charge', 'System1:GisSim_belleville_charge'),
        reading('tension', 'System1:GisSim_belleville_tension'),
        reading('frequence', 'System1:GisSim_belleville_frequence')
      ]
    },
    {
      id: 'paris',
      name: 'Pôle de consommation – Paris',
      dp: 'System1:GisSim_paris_defaut',
      readings: [
        reading('charge', 'System1:GisSim_paris_charge'),
        reading('demande', 'System1:GisSim_paris_demande')
      ]
    }
  ]
});

describe('dpeName', () => {
  it('ends a bare datapoint with a dot, leaves an element alone', () => {
    expect(dpeName('System1:GisSim_a_puissance')).toBe(
      'System1:GisSim_a_puissance.'
    );
    expect(dpeName('System1:Pump.flow')).toBe('System1:Pump.flow');
  });
});

describe('plantBindings', () => {
  it('keeps the assets with a power and a capacity reading, bound as the site says', () => {
    const [belleville, ...others] = plantBindings(SITE);
    expect(others).toEqual([]);
    expect(belleville).toEqual({
      key: 'france-centrales/belleville',
      name: 'Centrale de Belleville',
      siteId: 'france-centrales',
      siteName: 'France — Centrales',
      dps: {
        puissance: 'System1:GisSim_belleville_puissance.',
        capacite: 'System1:GisSim_belleville_capacite.',
        charge: 'System1:GisSim_belleville_charge.',
        tension: 'System1:GisSim_belleville_tension.',
        frequence: 'System1:GisSim_belleville_frequence.',
        // Not a reading: derived beside the fault the asset is bound to.
        etat: 'System1:GisSim_belleville_etat.'
      }
    });
  });

  it('falls back to the datapoint-derived site id, and survives bad JSON', () => {
    const noId = JSON.stringify({ ...JSON.parse(SITE), id: undefined });
    expect(plantBindings(noId, 'from-dp')[0]?.siteId).toBe('from-dp');
    expect(plantBindings('not json')).toEqual([]);
  });
});

describe('cellNumber', () => {
  it('reads numbers, booleans and their string forms', () => {
    expect(cellNumber(12.5)).toBe(12.5);
    expect(cellNumber(true)).toBe(1);
    expect(cellNumber('FALSE')).toBe(0);
    expect(cellNumber('3')).toBe(3);
    expect(cellNumber('')).toBeUndefined();
    expect(cellNumber(null)).toBeUndefined();
  });
});

describe('rankPlants', () => {
  it('puts the highest output first', () => {
    const ranked = rankPlants([
      plant('low', 100),
      plant('high', 900),
      plant('off', 0)
    ]);
    expect(ranked.map((entry) => entry.stem)).toEqual(['high', 'low', 'off']);
  });

  it('keeps the previous order for outputs equal at the displayed megawatt', () => {
    const ranked = rankPlants(
      [plant('a', 500.2), plant('b', 500.4)],
      ['a', 'b']
    );
    expect(ranked.map((entry) => entry.stem)).toEqual(['a', 'b']);
  });

  it('moves a plant as soon as its output really overtakes', () => {
    const ranked = rankPlants([plant('a', 500), plant('b', 502)], ['a', 'b']);
    expect(ranked.map((entry) => entry.stem)).toEqual(['b', 'a']);
  });
});

describe('summarize', () => {
  it('totals the fleet', () => {
    expect(summarize([plant('a', 100), plant('b', 200, STATE_OFF)])).toEqual({
      plants: 2,
      running: 1,
      output: 300,
      capacity: 2000
    });
  });
});
