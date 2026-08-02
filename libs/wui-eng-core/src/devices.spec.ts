// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Device declaration: the id slug, the per-protocol parameter validation, and
 * the normalisation a form's draft goes through before it is stored.
 */
import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_PARAMS,
  blockingProblems,
  deviceIdFrom,
  draftFromDevice,
  emptyDraft,
  normalizeDevice,
  uniqueDeviceId,
  validateDevice,
  type DeviceDraft
} from './devices.js';
import type { Device } from './model.js';

const draft = (over: Partial<DeviceDraft> = {}): DeviceDraft => ({
  name: 'S7_Four1',
  protocol: 's7plus',
  accessModes: ['s7plus'],
  connection: { ip: '192.168.10.21' },
  driverNumber: 3,
  bookIds: [],
  ...over
});

const existing: Device[] = [
  { id: 's7-four1', name: 'S7_Four1', protocol: 's7plus', accessModes: ['s7plus'], bookIds: [], state: 'connected' }
];

describe('deviceIdFrom / uniqueDeviceId', () => {
  it('slugs a name to a stable, ASCII, lower-case id', () => {
    expect(deviceIdFrom('S7_Four1')).toBe('s7-four1');
    expect(deviceIdFrom('Z03 M580 Station')).toBe('z03-m580-station');
    expect(deviceIdFrom('Étiqueteuse №2')).toBe('etiqueteuse-2');
  });

  it('never yields an empty id', () => {
    expect(deviceIdFrom('///')).toBe('device');
  });

  it('suffixes while the id is taken', () => {
    expect(uniqueDeviceId('S7_Four1', ['s7-four1'])).toBe('s7-four1-2');
    expect(uniqueDeviceId('S7_Four1', ['s7-four1', 's7-four1-2'])).toBe('s7-four1-3');
  });
});

describe('validateDevice', () => {
  it('accepts a complete draft', () => {
    expect(blockingProblems(validateDevice(draft()))).toEqual([]);
  });

  it('requires a name', () => {
    expect(validateDevice(draft({ name: '  ' })).map((p) => p.code)).toContain('device.name-required');
  });

  it('refuses a name that is not a WinCC OA identifier (DP names are built from it)', () => {
    const problems = validateDevice(draft({ name: 'Four n°1 (zone A)' }));
    const invalid = problems.find((p) => p.code === 'device.name-invalid');
    expect(invalid?.params).toMatchObject({ name: 'Four n°1 (zone A)' });
    // The suggestion must itself be valid.
    expect(String(invalid?.params?.clean)).toMatch(/^[A-Za-z_][\w]*$/);
  });

  it('rejects a duplicate name or id (books reference a device by id)', () => {
    expect(validateDevice(draft(), existing).map((p) => p.code)).toContain('device.name-taken');
    expect(validateDevice(draft({ id: 's7-four1', name: 'Autre' }), existing).map((p) => p.code)).toContain('device.id-taken');
  });

  it('requires at least one access mode', () => {
    expect(validateDevice(draft({ accessModes: [] })).map((p) => p.code)).toContain('device.no-access-mode');
  });

  it('requires the protocol\'s REQUIRED parameters, and names the missing one', () => {
    const problems = validateDevice(draft({ connection: {} }));
    const missing = problems.find((p) => p.code === 'device.param-required');
    expect(missing?.params).toMatchObject({ param: 'ip', protocol: 's7plus' });
  });

  it('ignores the optional parameters', () => {
    // s7plus: only `ip` is required — rack/slot may be absent.
    expect(blockingProblems(validateDevice(draft({ connection: { ip: '10.0.0.1' } })))).toEqual([]);
  });

  it('refuses a driver number that is not a positive integer', () => {
    for (const value of ['0', '-1', '2.5', 'abc']) {
      expect(validateDevice(draft({ driverNumber: value })).map((p) => p.code)).toContain('device.driver-invalid');
    }
  });

  it('ADVISES (does not block) a missing driver number on a non-OPC-UA device', () => {
    const problems = validateDevice(draft({ driverNumber: undefined }));
    expect(problems.map((p) => p.code)).toContain('device.driver-recommended');
    // Advisory: the form must still be saveable.
    expect(blockingProblems(problems)).toEqual([]);
  });

  it('does not advise it for OPC UA, where auto-detection is verified', () => {
    const opcua = draft({ protocol: 'opcua', accessModes: ['opcua'], connection: { server: 'Srv' }, driverNumber: undefined });
    expect(validateDevice(opcua).map((p) => p.code)).not.toContain('device.driver-recommended');
  });
});

describe('normalizeDevice', () => {
  it('assigns an id on creation and keeps it on an edit', () => {
    expect(normalizeDevice(draft()).id).toBe('s7-four1');
    expect(normalizeDevice(draft(), existing).id).toBe('s7-four1-2');
    expect(normalizeDevice(draft({ id: 'fixed', name: 'Renamed' })).id).toBe('fixed');
  });

  it('coerces the numeric parameters and drops the empty ones', () => {
    const device = normalizeDevice(draft({ protocol: 'modbus', accessModes: ['modbus'], connection: { ip: '10.0.0.5', port: '502', unitId: '', cpu: ' BMEP ' } }));
    expect(device.connection).toEqual({ ip: '10.0.0.5', port: 502, cpu: 'BMEP' });
  });

  it('keeps only the CURRENT protocol\'s parameters (a protocol switch cleans up)', () => {
    const device = normalizeDevice(draft({ protocol: 'opcua', accessModes: ['opcua'], connection: { server: 'Srv', ip: '10.0.0.1', rack: 0 } }));
    expect(device.connection).toEqual({ server: 'Srv' });
  });

  it('never claims a connection state a form cannot know', () => {
    expect(normalizeDevice(draft()).state).toBe('unknown');
  });

  it('round-trips through draftFromDevice', () => {
    const device = normalizeDevice(draft({ pollGroup: '_MyPoll', bookIds: ['b1'] }));
    expect(normalizeDevice(draftFromDevice(device))).toEqual(device);
  });
});

describe('PROTOCOL_PARAMS', () => {
  it('declares parameters for every protocol the form offers', () => {
    for (const [protocol, specs] of Object.entries(PROTOCOL_PARAMS)) {
      expect(specs.length, protocol).toBeGreaterThan(0);
      expect(specs.some((spec) => spec.required), protocol).toBe(true);
      for (const spec of specs) expect(spec.key).toMatch(/^[a-zA-Z][\w]*$/);
    }
  });

  it('starts a blank draft on the chosen protocol, with it as the access mode', () => {
    expect(emptyDraft('modbus')).toMatchObject({ protocol: 'modbus', accessModes: ['modbus'], name: '', bookIds: [] });
  });
});
