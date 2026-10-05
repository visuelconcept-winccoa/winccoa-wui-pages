// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The progress channel is one datapoint shared by the whole project, so the parser is
 * what keeps one conversation's steps out of another's panel. Everything below is a
 * way that filter could fail — a stale payload, a concurrent prompt, a half-written
 * value — and each has to yield `null` rather than someone else's narration.
 */
// @vitest-environment jsdom — the kit's data modules import the OaRxJsApi browser bundle, which touches `self` at load.
// reflect-metadata first, as in the app shell: tsyringe (the kit's DI) refuses to load without it.
import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import {
  addUsage,
  emptyUsage,
  formatTokens,
  newProgressId,
  parseProgress,
  progressUsage
} from './ai-progress.js';

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

describe('progressUsage', () => {
  it('reads the running total off the list', () => {
    const events = parseProgress(
      payload(ID, [
        { type: 'start' },
        { type: 'usage', tokensIn: 12_000, tokensOut: 800, tokensCached: 9000, rounds: 3 }
      ]),
      ID
    );
    expect(progressUsage(events ?? [])).toEqual({
      tokensIn: 12_000,
      tokensOut: 800,
      tokensCached: 9000,
      rounds: 3
    });
  });

  it('says nothing before the first round lands, or on a manager without the counter', () => {
    expect(progressUsage([{ type: 'start' }, { type: 'model', round: 1 }])).toBeNull();
    expect(progressUsage([])).toBeNull();
  });

  it('fills in the fields an older payload omits, rather than rendering undefined', () => {
    expect(progressUsage([{ type: 'usage', tokensIn: 500 }])).toEqual({
      tokensIn: 500,
      tokensOut: 0,
      tokensCached: 0,
      rounds: 0
    });
  });
});

describe('addUsage', () => {
  it('sums a conversation from its answers', () => {
    const first = { tokensIn: 1000, tokensOut: 200, tokensCached: 0, rounds: 1 };
    const second = { tokensIn: 4000, tokensOut: 350, tokensCached: 900, rounds: 4 };
    expect(addUsage(addUsage(emptyUsage(), first), second)).toEqual({
      tokensIn: 5000,
      tokensOut: 550,
      tokensCached: 900,
      rounds: 5
    });
  });
});

describe('formatTokens', () => {
  it('keeps small counts exact and shortens the big ones', () => {
    // Grouping separators are the browser's, so the assertions are on the shape:
    // below ten thousand every digit is there, above it the count is in thousands.
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(9999)).not.toMatch(/k$/);
    expect(formatTokens(12_340)).toMatch(/^12[.,]3 k$/);
    expect(formatTokens(1_200_000)).toMatch(/k$/);
  });
});

describe('newProgressId', () => {
  it('does not collide across prompts', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newProgressId()));
    expect(ids.size).toBe(200);
  });
});
