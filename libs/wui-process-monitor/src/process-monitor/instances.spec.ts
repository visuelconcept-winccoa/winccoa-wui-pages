// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** The host instance helpers (issue 39): state, last seen, filter, delete offered or not. */
import { describe, expect, it } from 'vitest';
import { canOfferDelete, countInvalid, filterInstances, instanceState, isInvalid, isLive, isLongUnseen, lastSeenAgeMs, stateTone } from './instances.js';
import type { Instance, InstanceState } from './types.js';

const NOW = Date.parse('2026-10-29T12:00:00.000Z');

function inst(host: string, state: InstanceState | null, over: Partial<Instance> = {}): Instance {
  return {
    system: 'System1:',
    hostname: host,
    updated: '2026-10-29T11:59:57.000Z',
    managers: [],
    dp: `System1:ProcessMonitor_Node_${host}`,
    local: false,
    ...(state ? { status: { state, checkedAt: '2026-10-29T12:00:00.000Z', version: state === 'connected' ? '0.3.0' : '', startedAt: '' } } : {}),
    ...over
  };
}

describe('instance state', () => {
  it('a reply of an aggregator older than 0.3.0 (no status) reads as unknown and live', () => {
    const old = inst('PC1', null);
    expect(instanceState(old)).toBe('unknown');
    expect(isLive(old)).toBe(true);
    expect(isInvalid(old)).toBe(false);
  });

  it('only connected is live; every checked state else is invalid', () => {
    expect(isLive(inst('PC1', 'connected'))).toBe(true);
    for (const state of ['pmon-unreachable', 'agent-too-old', 'agent-unreachable', 'not-checkable'] as const) {
      expect(isInvalid(inst('PC2', state))).toBe(true);
    }
  });

  it('maps each state to a badge tone', () => {
    expect(stateTone('connected')).toBe('ok');
    expect(stateTone('agent-unreachable')).toBe('alarm');
    expect(stateTone('pmon-unreachable')).toBe('warning');
    expect(stateTone('agent-too-old')).toBe('warning');
    expect(stateTone('not-checkable')).toBe('neutral');
    expect(stateTone('unknown')).toBe('neutral');
  });
});

describe('last seen', () => {
  it('ages the last snapshot, and hints past seven days', () => {
    expect(lastSeenAgeMs(inst('PC1', 'connected'), NOW)).toBe(3000);
    expect(lastSeenAgeMs(inst('PC1', 'connected', { updated: '' }), NOW)).toBeNull();
    expect(lastSeenAgeMs(inst('PC1', 'connected', { updated: 'garbage' }), NOW)).toBeNull();
    expect(isLongUnseen(inst('PC3', 'agent-unreachable', { updated: '2026-10-20T12:00:00.000Z' }), NOW)).toBe(true);
    expect(isLongUnseen(inst('PC3', 'agent-unreachable', { updated: '2026-10-25T12:00:00.000Z' }), NOW)).toBe(false);
  });
});

describe('canOfferDelete', () => {
  it('offered only with the role, for an unreachable agent', () => {
    expect(canOfferDelete(inst('PC3', 'agent-unreachable'), true)).toBe(true);
    expect(canOfferDelete(inst('PC3', 'agent-unreachable'), false)).toBe(false);
    for (const state of ['connected', 'pmon-unreachable', 'agent-too-old', 'not-checkable'] as const) {
      expect(canOfferDelete(inst('PC2', state), true)).toBe(false);
    }
  });

  it('never for the local node, nor when the aggregator does not say which one is local', () => {
    expect(canOfferDelete(inst('PC1', 'agent-unreachable', { local: true }), true)).toBe(false);
    expect(canOfferDelete(inst('PC1', 'agent-unreachable', { local: undefined }), true)).toBe(false);
  });
});

describe('filterInstances', () => {
  const list = [inst('PC1', 'connected'), inst('PC2', 'agent-too-old'), inst('PC3', 'agent-unreachable'), inst('PC4', null)];

  it('shows everything, or only the invalid instances', () => {
    expect(filterInstances(list, false).map((i) => i.hostname)).toEqual(['PC1', 'PC2', 'PC3', 'PC4']);
    expect(filterInstances(list, true).map((i) => i.hostname)).toEqual(['PC2', 'PC3']);
    expect(countInvalid(list)).toBe(2);
  });
});
