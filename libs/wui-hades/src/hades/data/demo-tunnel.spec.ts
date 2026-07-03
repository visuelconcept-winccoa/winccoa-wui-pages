// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Demo presets — every importable demo must be structurally sound: unique
 * equipment ids (hadesSim keys its DPs off them), equipment on existing tubes
 * within the tube extent, mode actions referencing real equipment, and a
 * round-trip through the import validator.
 */
import { describe, expect, it } from 'vitest';
import { demoCatalog, demoTunnel } from './demo-tunnel.js';
import { parseTunnel } from './io.js';
import { checkCompliance } from './compliance.js';
import { tubeLengthM } from '../types.js';

describe('demoCatalog', () => {
  it('ships three presets, styx first (the offline seed)', () => {
    const catalog = demoCatalog();
    expect(catalog.map((d) => d.id)).toEqual(['styx', 'lethe', 'acheron']);
    expect(catalog[0].build().id).toBe(demoTunnel().id);
  });

  for (const preset of demoCatalog()) {
    describe(`preset ${preset.id}`, () => {
      const tunnel = preset.build();

      it('has unique equipment ids', () => {
        const ids = tunnel.equipment.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      it('places every equipment on an existing tube, within its extent', () => {
        const lengths = new Map(tunnel.tubes.map((t) => [t.id, tubeLengthM(t)]));
        for (const e of tunnel.equipment) {
          const length = lengths.get(e.tubeId);
          expect(length, `${e.id} on unknown tube ${e.tubeId}`).toBeDefined();
          expect(e.pkM).toBeGreaterThanOrEqual(0);
          expect(e.pkM).toBeLessThanOrEqual(length!);
        }
      });

      it('has modes whose actions reference existing equipment', () => {
        const ids = new Set(tunnel.equipment.map((e) => e.id));
        expect(tunnel.modes.length).toBeGreaterThan(0);
        for (const mode of tunnel.modes) {
          for (const action of mode.actions) {
            expect(ids.has(action.equipmentId), `${mode.id}: ${action.equipmentId}`).toBe(true);
          }
        }
      });

      it('round-trips through the import validator', () => {
        const parsed = parseTunnel(JSON.stringify(tunnel));
        expect(parsed.name).toBe(tunnel.name);
        expect(parsed.profile).toBe(tunnel.profile);
        expect(parsed.equipment.length).toBe(tunnel.equipment.length);
      });

      it('runs through the compliance advisor without throwing', () => {
        expect(() => checkCompliance(tunnel)).not.toThrow();
      });
    });
  }
});
