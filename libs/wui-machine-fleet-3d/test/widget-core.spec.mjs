// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Machine Fleet dashboard widgets (Gantt, downtime analysis) read a state history bound by the dashboard:
 * the states Machine Fleet's state manager records (state keys, winccoa-fra-msp-stma#339) as they are, or a raw
 * state datapoint bound by hand through the mapping, as before.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@wincc-oa/wui-i18n-shared/localize-multilang.js', () => ({ localize: (v) => (typeof v === 'string' ? v : v?.['fr.utf8'] ?? '') }));
vi.mock('@wincc-oa/wui-shared/parseTimeRange.js', () => ({ parseTimeRange: () => null }));

const core = await import('../oa-data/WebUI/widgets-v2/MachineFleet/machine-fleet-core.js');

const MIN = 60_000;

describe('state of a history sample in the widgets', () => {
  it('a recorded state key as it is, a raw value through the mapping (rounded)', () => {
    expect(core.sampleState(undefined, 'stop')).toBe('stop');
    expect(core.sampleState(undefined, ['maint'])).toBe('maint');
    expect(core.sampleState(undefined, 1)).toBe('ok');
    expect(core.sampleState(undefined, '2')).toBe('warn');
    expect(core.sampleState(undefined, 1.6)).toBe('warn');
    expect(core.sampleState(undefined, null)).toBe(core.resolveState(undefined, 0));
  });

  it('the Gantt segments of a recorded history', () => {
    const states = [{ t: 0, v: 'ok' }, { t: 10 * MIN, v: 'stop' }, { t: 20 * MIN, v: 'ok' }];
    const segs = core.buildSegments(states, [], undefined, [], 0, 30 * MIN);
    expect(segs.map((s) => [s.state, s.startMs / MIN, s.endMs / MIN])).toEqual([['ok', 0, 10], ['stop', 10, 20], ['ok', 20, 30]]);
  });
});
