// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Device declaration: the id slug, the per-protocol parameter validation, and
 * the normalisation a form's draft goes through before it is stored.
 */
import { describe, expect, it } from 'vitest';
import {
  CONN_STATE,
  PROTOCOL_PARAMS,
  connectionVerdict,
  deviceStateOf,
  statesUnreadable,
  withDeviceStates,
  declaredAddressOf,
  blockingProblems,
  deviceStateFromConnState,
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

  /**
   * `wordOrder` / `zeroBased` are DECLARATIVE (set in the WinCC OA config file or
   * when the connection is created, never per address) — but they must survive an
   * edit: dropping them would lose the only written record of how the driver reads
   * every register of the book.
   */
  it('keeps the declarative Modbus parameters through a round-trip', () => {
    const device = normalizeDevice(
      draft({ protocol: 'modbus', accessModes: ['modbus'], connection: { ip: '10.0.0.5', wordOrder: 'big', zeroBased: false } })
    );
    expect(device.connection).toMatchObject({ wordOrder: 'big', zeroBased: false });
    expect(normalizeDevice(draftFromDevice(device))).toEqual(device);
  });

  it('distinguishes a flag set to false from a flag nobody stated', () => {
    const stated = normalizeDevice(draft({ protocol: 'modbus', accessModes: ['modbus'], connection: { ip: '10.0.0.5', zeroBased: false } }));
    const silent = normalizeDevice(draft({ protocol: 'modbus', accessModes: ['modbus'], connection: { ip: '10.0.0.5' } }));
    expect(stated.connection).toMatchObject({ zeroBased: false });
    expect(silent.connection).not.toHaveProperty('zeroBased');
    // A <select> hands over strings — they must coerce to real booleans.
    const fromForm = normalizeDevice(draft({ protocol: 'modbus', accessModes: ['modbus'], connection: { ip: '10.0.0.5', zeroBased: 'true' } }));
    expect(fromForm.connection?.zeroBased).toBe(true);
  });

  it('refuses a choice value outside the declared options', () => {
    const problems = validateDevice(draft({ protocol: 'modbus', accessModes: ['modbus'], connection: { ip: '10.0.0.5', wordOrder: 'bug' } }));
    const invalid = problems.find((p) => p.code === 'device.param-invalid');
    expect(invalid?.params).toMatchObject({ param: 'wordOrder', value: 'bug', options: 'big, little' });
    expect(blockingProblems(problems)).toHaveLength(1);
    // The declared ones pass.
    for (const value of ['big', 'little', '']) {
      expect(
        blockingProblems(validateDevice(draft({ protocol: 'modbus', accessModes: ['modbus'], connection: { ip: '10.0.0.5', wordOrder: value } }))),
        value
      ).toEqual([]);
    }
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

describe('deviceStateFromConnState', () => {
  it('is connected from 256 up — including the redundancy variants', () => {
    expect(deviceStateFromConnState(CONN_STATE.CONNECTED)).toBe('connected');
    for (const code of [257, 258, 259, 260, 1024]) expect(deviceStateFromConnState(code)).toBe('connected');
  });

  it('is disconnected on "not connected" (1) and "failure" (5) — the vendor lamp red', () => {
    expect(deviceStateFromConnState(CONN_STATE.NOT_CONNECTED)).toBe('disconnected');
    expect(deviceStateFromConnState(CONN_STATE.FAILURE)).toBe('disconnected');
  });

  it('leaves undefined and INACTIVE unknown rather than calling them a disconnection', () => {
    // The para lamp paints these yellow: nobody unplugged anything, so the studio may
    // not report a downtime — the raw code says which case it is.
    expect(deviceStateFromConnState(CONN_STATE.UNDEFINED)).toBe('unknown');
    expect(deviceStateFromConnState(CONN_STATE.UNDEFINED_BY_DRIVER)).toBe('unknown');
    expect(deviceStateFromConnState(CONN_STATE.INACTIVE)).toBe('unknown');
  });

  it('is unknown for a non-numeric read', () => {
    expect(deviceStateFromConnState(Number.NaN)).toBe('unknown');
  });
});

describe('declaredAddressOf', () => {
  const device = (connection: Record<string, string | number | boolean>): Device => ({
    id: 'x',
    name: 'X',
    protocol: 'opcua',
    accessModes: ['opcua'],
    connection,
    bookIds: [],
    state: 'unknown'
  });

  it('prefers the declared ip', () => {
    expect(declaredAddressOf(device({ ip: ' 192.168.10.21 ', endpoint: 'opc.tcp://10.0.0.1:4840' }))).toBe('192.168.10.21');
  });

  it('falls back to the HOST of an OPC UA endpoint (a connection DP stores its own shape)', () => {
    expect(declaredAddressOf(device({ endpoint: 'opc.tcp://192.168.10.44:4840' }))).toBe('192.168.10.44');
    expect(declaredAddressOf(device({ endpoint: 'opc.tcp://plc-four1:4840/UA/Server' }))).toBe('plc-four1');
    expect(declaredAddressOf(device({ endpoint: 'opc.tcp://[fe80::1]:4840' }))).toBe('fe80::1');
  });

  it('is empty when the declaration carries neither — never a guess', () => {
    expect(declaredAddressOf(device({ rack: 0, slot: 1 }))).toBe('');
    expect(declaredAddressOf(device({ endpoint: 'not-a-url' }))).toBe('');
  });
});

/**
 * The two cases MEASURED on a live WinCC OA project (3.21), which is what these
 * expectations encode:
 *  - `_test`      — connected: Common.State.ConnState = 257, stamped now;
 *  - `_Simulator1`— never connected: BOTH elements read 0, stamped 1970-01-01.
 * The second one is the trap: a plain `> 0` test on a never-written element reports a
 * disconnection about a machine nobody ever tried to reach.
 */
describe('connectionVerdict', () => {
  it('trusts the common element when the driver wrote it', () => {
    expect(connectionVerdict({ code: 257, written: true }, { code: 1, written: true })).toEqual({
      state: 'connected',
      source: 'connstate',
      code: 257
    });
    expect(connectionVerdict({ code: 1, written: true }, null)).toEqual({ state: 'disconnected', source: 'connstate', code: 1 });
    expect(connectionVerdict({ code: 3, written: true }, null)).toEqual({ state: 'unknown', source: 'connstate', code: 3 });
  });

  it('falls back to the OPC UA element when the common one is undefined by the driver', () => {
    expect(connectionVerdict({ code: 0, written: true }, { code: 1, written: true })).toEqual({
      state: 'connected',
      source: 'opcua-connstate',
      code: 1
    });
    expect(connectionVerdict({ code: -1, written: true }, { code: 0, written: true })).toEqual({
      state: 'disconnected',
      source: 'opcua-connstate',
      code: 0
    });
  });

  it('reports a NEVER-WRITTEN state as unknown, not as a disconnection', () => {
    // _Simulator1 on the live project: 0 / 0, both stamped at the epoch.
    expect(connectionVerdict({ code: 0, written: false }, { code: 0, written: false })).toEqual({
      state: 'unknown',
      source: 'connstate',
      code: 0
    });
    // A connected value that was written stays connected, obviously.
    expect(connectionVerdict({ code: 257, written: true }, { code: 0, written: false }).state).toBe('connected');
  });

  it('says the PROBE failed when neither element could be read', () => {
    expect(connectionVerdict(null, null)).toEqual({ state: 'unknown', source: 'probe-failed' });
  });
});

describe('withDeviceStates / statesUnreadable', () => {
  const registry = (): Device[] => [
    { id: 'a', name: 'A', protocol: 'opcua', accessModes: ['opcua'], bookIds: ['book-a'], state: 'unknown' },
    { id: 'b', name: 'B', protocol: 'modbus', accessModes: ['modbus'], bookIds: [], state: 'connected', stateCode: 257 }
  ];

  it('moves ONLY the state fields — a refresh must not overwrite an edit in progress', () => {
    const merged = withDeviceStates(registry(), [
      { id: 'a', state: 'connected', stateSource: 'connstate', stateConnection: '_test', stateCode: 257 }
    ]);
    expect(merged[0]).toMatchObject({ id: 'a', name: 'A', bookIds: ['book-a'], state: 'connected', stateCode: 257 });
    // Untouched: the refresh said nothing about it.
    expect(merged[1]).toEqual(registry()[1]);
  });

  it('clears a field the refresh no longer carries (a state must not keep a stale reason)', () => {
    const merged = withDeviceStates(registry(), [{ id: 'b', state: 'unknown', stateSource: 'unprobed' }]);
    expect(merged[1]?.stateCode).toBeUndefined();
    expect(merged[1]?.stateSource).toBe('unprobed');
  });

  it('ignores updates for devices it does not know, and an empty refresh', () => {
    expect(withDeviceStates(registry(), [{ id: 'ghost', state: 'connected' }])).toEqual(registry());
    expect(withDeviceStates(registry(), [])).toEqual(registry());
  });

  it('turns every lamp grey when the refresh itself cannot be trusted any more', () => {
    const stale = statesUnreadable(withDeviceStates(registry(), [
      { id: 'a', state: 'connected', stateSource: 'connstate', stateConnection: '_test', stateCode: 257 }
    ]));
    for (const device of stale) {
      expect(device.state).toBe('unknown');
      expect(device.stateSource).toBe('probe-failed');
      // The code goes with it: `257` beside "unknown" would suggest it is current.
      expect(device.stateCode).toBeUndefined();
    }
    // The connection it was reading stays named — that is still true.
    expect(stale[0]?.stateConnection).toBe('_test');
  });

  it('deviceStateOf carries the live fields and nothing else', () => {
    const device = { ...registry()[1], stateSource: 'connstate' as const, stateConnection: '_x' } as Device;
    expect(deviceStateOf(device)).toEqual({ id: 'b', state: 'connected', stateSource: 'connstate', stateConnection: '_x', stateCode: 257 });
  });
});
