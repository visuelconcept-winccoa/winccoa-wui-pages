// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Role profiles → configs. Pins the NEUTRAL defaults (archive group injected,
 * `alert` class, binary alert on TRUE for alarms, NO range invented) and the
 * direction derivation.
 */
import { describe, expect, it } from 'vitest';
import type { BookEntry } from '../model.js';
import { DpAddressDirection } from '../drivers/opcua.js';
import { NEUTRAL_ROLE_PROFILES, configsForRole, roleIsInert, type RoleProfile } from './profiles.js';
import type { SignalRole } from './roles.js';

const entry = (access: BookEntry['access'] = 'r', extra: Partial<BookEntry> = {}): BookEntry => ({
  path: 'X',
  sourceType: 'REAL',
  leafType: 'Float',
  access,
  addresses: {},
  ...extra
});

describe('neutral profiles', () => {
  it('a measure is polled IN and archived into the injected group', () => {
    const configs = configsForRole(entry(), 'measure', NEUTRAL_ROLE_PROFILES, { archiveGroup: 'MEASURE' });
    expect(configs.direction).toBe(DpAddressDirection.INPUT_POLL);
    expect(configs.archive).toEqual({ group: 'MEASURE', active: true });
    expect(configs.alarm).toBeUndefined();
  });

  it('defaults the archive group to EVENT when the project injects none', () => {
    expect(configsForRole(entry(), 'state').archive).toEqual({ group: 'EVENT', active: true });
  });

  it('a command is written OUT, a setpoint on a writable signal is I/O', () => {
    expect(configsForRole(entry('rw'), 'command').direction).toBe(DpAddressDirection.OUTPUT);
    expect(configsForRole(entry('rw'), 'setpoint').direction).toBe(DpAddressDirection.IO_POLL);
  });

  it('an alarm yields a binary alert on TRUE with the alert class', () => {
    const configs = configsForRole(entry(), 'alarm', NEUTRAL_ROLE_PROFILES, { alarmClass: 'warning' });
    expect(configs.alarm).toEqual({ kind: 'binary', alarmClass: 'warning', direction: 'ASC', active: true });
    expect(configsForRole(entry(), 'alarm').alarm?.alarmClass).toBe('alert');
  });

  it('NEVER invents a value range (engineering knowledge, not a default)', () => {
    for (const role of Object.keys(NEUTRAL_ROLE_PROFILES) as SignalRole[]) {
      expect(configsForRole(entry(), role).range).toBeUndefined();
    }
  });

  it('a parameter and an unqualified signal produce no config', () => {
    expect(configsForRole(entry(), 'parameter').archive).toBeUndefined();
    expect(configsForRole(entry(), 'unknown').archive).toBeUndefined();
    expect(roleIsInert('unknown')).toBe(true);
    expect(roleIsInert('measure')).toBe(false);
  });

  it('falls back to the source access mode when a profile forces no direction', () => {
    expect(configsForRole(entry('r'), 'parameter').direction).toBe(DpAddressDirection.INPUT_POLL);
    expect(configsForRole(entry('rw'), 'parameter').direction).toBe(DpAddressDirection.IO_POLL);
    expect(configsForRole(entry('w'), 'parameter').direction).toBe(DpAddressDirection.OUTPUT);
  });
});

describe('direction vs declared access (AccessLevel reconciliation)', () => {
  it('a write intent on a DECLARED read-only signal is downgraded, with a note', () => {
    const command = configsForRole(entry('r'), 'command');
    expect(command.direction).toBe(DpAddressDirection.INPUT_POLL);
    expect(command.directionNote).toContain('READ-ONLY');

    const setpoint = configsForRole(entry('r'), 'setpoint');
    expect(setpoint.direction).toBe(DpAddressDirection.INPUT_POLL);
    expect(setpoint.directionNote).toContain('READ-ONLY');
  });

  it('the ROLE wins when the access is only ASSUMED (browse without AccessLevel)', () => {
    const command = configsForRole(entry('r', { accessSource: 'assumed' }), 'command');
    expect(command.direction).toBe(DpAddressDirection.OUTPUT);
    expect(command.directionNote).toBeUndefined();

    const setpoint = configsForRole(entry('r', { accessSource: 'assumed' }), 'setpoint');
    expect(setpoint.direction).toBe(DpAddressDirection.IO_POLL);
  });

  it('a MANUAL access is evidence like a declared one', () => {
    const command = configsForRole(entry('r', { accessSource: 'manual' }), 'command');
    expect(command.direction).toBe(DpAddressDirection.INPUT_POLL);
    expect(command.directionNote).toContain('READ-ONLY');
    expect(configsForRole(entry('rw', { accessSource: 'manual' }), 'command').direction).toBe(DpAddressDirection.OUTPUT);
  });

  it('a setpoint on a WRITE-ONLY signal becomes OUT, and says the read-back is lost', () => {
    const setpoint = configsForRole(entry('w'), 'setpoint');
    expect(setpoint.direction).toBe(DpAddressDirection.OUTPUT);
    expect(setpoint.directionNote).toContain('WRITE-ONLY');
  });

  it('a read intent stays IN even on a writable signal (no unused write path)', () => {
    for (const role of ['measure', 'state', 'alarm', 'counter'] as SignalRole[]) {
      const configs = configsForRole(entry('rw'), role);
      expect(configs.direction).toBe(DpAddressDirection.INPUT_POLL);
      expect(configs.directionNote).toBeUndefined();
    }
  });

  it('a declared access needs no accessSource (absent = declared)', () => {
    expect(entry('r').accessSource).toBeUndefined();
    expect(configsForRole(entry('r'), 'command').directionNote).toBeDefined();
  });
});

describe('project overrides', () => {
  it('a project profile can add real range bounds', () => {
    const profiles: Record<SignalRole, RoleProfile> = {
      ...NEUTRAL_ROLE_PROFILES,
      measure: { direction: 'in', archive: true, range: { min: 0, max: 450, inclMax: false } }
    };
    const configs = configsForRole(entry(), 'measure', profiles);
    expect(configs.range).toEqual({ min: 0, max: 450, inclMin: true, inclMax: false });
  });

  it('a project profile can stop archiving a role', () => {
    const profiles = { ...NEUTRAL_ROLE_PROFILES, command: { direction: 'out' as const, archive: false } };
    expect(configsForRole(entry('rw'), 'command', profiles).archive).toBeUndefined();
  });
});
