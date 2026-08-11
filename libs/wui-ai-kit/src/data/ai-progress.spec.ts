// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The progress channel is one datapoint shared by the whole project, so the parser is
 * what keeps one conversation's steps out of another's panel. Everything below is a
 * way that filter could fail — a stale payload, a concurrent prompt, a half-written
 * value — and each has to yield `null` rather than someone else's narration.
 */
import { describe, expect, it } from 'vitest';
import { newProgressId, parseProgress } from './ai-progress.js';

const ID = 'p-abc';

function payload(id: string, events: unknown[]): string {
  return JSON.stringify({ id, events });
}

describe('parseProgress', () => {
  it('reads this prompt’s events', () => {
    const events = parseProgress(payload(ID, [{ type: 'start' }, { type: 'model', round: 1 }]), ID);
    expect(events).toEqual([{ type: 'start' }, { type: 'model', round: 1 }]);
  });

  it('ignores another prompt’s payload — the datapoint is shared', () => {
    expect(parseProgress(payload('p-other', [{ type: 'model', round: 3 }]), ID)).toBeNull();
  });

  it('ignores a value that is not JSON, or not an object', () => {
    // A half-written or legacy value must not throw and must not render.
    expect(parseProgress('{"id":"p-abc","eve', ID)).toBeNull();
    expect(parseProgress('"a string"', ID)).toBeNull();
    expect(parseProgress('null', ID)).toBeNull();
    expect(parseProgress('', ID)).toBeNull();
  });

  it('ignores a non-string datapoint value', () => {
    expect(parseProgress(42, ID)).toBeNull();
    expect(parseProgress(undefined, ID)).toBeNull();
  });

  it('ignores a payload with no event list', () => {
    expect(parseProgress(JSON.stringify({ id: ID }), ID)).toBeNull();
    expect(parseProgress(JSON.stringify({ id: ID, events: 'nope' }), ID)).toBeNull();
  });

  it('drops the entries that are not events, keeping the rest', () => {
    const events = parseProgress(payload(ID, [{ type: 'start' }, null, 7, { nope: true }, { type: 'done' }]), ID);
    expect(events).toEqual([{ type: 'start' }, { type: 'done' }]);
  });

  it('refuses to match on an empty id, which would make every payload "ours"', () => {
    expect(parseProgress(payload('', [{ type: 'start' }]), '')).toBeNull();
  });

  it('accepts a cumulative payload growing between two writes', () => {
    // The manager republishes the whole list, so a coalesced write loses nothing:
    // whatever arrives last is complete.
    const first = parseProgress(payload(ID, [{ type: 'start' }]), ID);
    const later = parseProgress(
      payload(ID, [{ type: 'start' }, { type: 'tool', name: 'get-datapoints', ok: true }, { type: 'done' }]),
      ID
    );
    expect(first).toHaveLength(1);
    expect(later).toHaveLength(3);
  });
});

describe('newProgressId', () => {
  it('does not collide across prompts', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newProgressId()));
    expect(ids.size).toBe(200);
  });
});
