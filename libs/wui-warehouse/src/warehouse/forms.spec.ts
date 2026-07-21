// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Field-schema builders feeding the generic entity dialog. */
import { describe, expect, it } from 'vitest';
import { campaignFields, locationFields, productFields, stockFields, zoneFields } from './forms.js';
import { demoLocations, demoProducts, demoZones } from './model.js';

describe('form field builders', () => {
  it('zoneFields: name/code required, layout rectangle is numeric', () => {
    const fields = zoneFields();
    expect(fields.find((f) => f.key === 'name')?.required).toBe(true);
    expect(fields.find((f) => f.key === 'code')?.required).toBe(true);
    for (const key of ['x', 'y', 'w', 'h']) expect(fields.find((f) => f.key === key)?.kind).toBe('number');
  });

  it('locationFields: offers every zone as an option', () => {
    const zones = demoZones();
    const zoneField = locationFields(zones).find((f) => f.key === 'zoneId');
    expect(zoneField?.required).toBe(true);
    expect(zoneField?.options).toHaveLength(zones.length);
    expect(zoneField?.options?.[0]).toEqual({ value: 'z-a', label: 'A · Réception' });
  });

  it('locationFields: proposes the five location types', () => {
    const typeField = locationFields([]).find((f) => f.key === 'type');
    expect(typeField?.options?.map((o) => o.value)).toEqual(['rack', 'shelf', 'bin', 'floor', 'cold']);
    for (const option of typeField?.options ?? []) expect(option.label.length).toBeGreaterThan(0);
  });

  it('productFields: ref and name required, thresholds numeric and non-negative', () => {
    const fields = productFields();
    expect(fields.find((f) => f.key === 'ref')?.required).toBe(true);
    expect(fields.find((f) => f.key === 'name')?.required).toBe(true);
    for (const key of ['minQty', 'maxQty']) {
      const f = fields.find((x) => x.key === key);
      expect(f?.kind).toBe('number');
      expect(f?.min).toBe(0);
    }
  });

  it('stockFields: locks product+location when editing an existing cell', () => {
    const products = demoProducts();
    const locations = demoLocations();
    for (const lock of [false, true]) {
      const fields = stockFields(products, locations, lock);
      expect(fields.find((f) => f.key === 'product')?.readonly).toBe(lock);
      expect(fields.find((f) => f.key === 'location')?.readonly).toBe(lock);
    }
    const fields = stockFields(products, locations, false);
    expect(fields.find((f) => f.key === 'product')?.options).toHaveLength(products.length);
    expect(fields.find((f) => f.key === 'location')?.options).toHaveLength(locations.length);
  });

  it('campaignFields: scope offers "whole warehouse" plus every zone', () => {
    const zones = demoZones();
    const scope = campaignFields(zones).find((f) => f.key === 'zoneId');
    expect(scope?.options).toHaveLength(zones.length + 1);
    expect(scope?.options?.[0].value).toBe('');
  });
});
