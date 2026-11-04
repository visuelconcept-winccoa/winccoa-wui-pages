// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Machine dashboard filters: context periods, clipping, Pareto from filtered stops. */
import { describe, expect, it } from 'vitest';
import { allowedSpans, clipToSpans, paretoFromStops, spanValues, valueSpans } from './dashboard-filter.js';
import type { RawStop } from './engine.js';

const OF = valueSpans([{ t: 0, v: 'OF1' }, { t: 100, v: '' }, { t: 150, v: 'OF2' }], 0, 300);
const ART = valueSpans([{ t: 0, v: 'A' }, { t: 200, v: 'B' }], 0, 300);

describe('context periods', () => {
  it('turns a history into value spans, empty values dropped', () => {
    expect(OF).toEqual([{ s: 0, e: 100, v: 'OF1' }, { s: 150, e: 300, v: 'OF2' }]);
    expect(spanValues(OF)).toEqual(['OF1', 'OF2']);
  });

  it('no selection keeps everything; OR within a dimension, AND across', () => {
    expect(allowedSpans({ of: OF, art: ART }, {})).toBeNull();
    expect(allowedSpans({ of: OF }, { of: ['OF1', 'OF2'] })).toEqual([{ s: 0, e: 100 }, { s: 150, e: 300 }]);
    expect(allowedSpans({ of: OF, art: ART }, { of: ['OF2'], art: ['A'] })).toEqual([{ s: 150, e: 200 }]);
    expect(allowedSpans({ of: OF }, { contract: ['C1'] })).toEqual([]);
  });

  it('clips timed records to the kept periods', () => {
    const stops = [{ startMs: 50, endMs: 170, durationMs: 120 }];
    expect(clipToSpans(stops, [{ s: 0, e: 100 }, { s: 150, e: 300 }])).toEqual([
      { startMs: 50, endMs: 100, durationMs: 50 },
      { startMs: 150, endMs: 170, durationMs: 20 }
    ]);
    expect(clipToSpans(stops, null)).toEqual(stops);
  });
});

describe('Pareto from stops', () => {
  it('sums time and counts stops per cause', () => {
    const stop = (key: string, ms: number): RawStop =>
      ({ machineId: 'M', machineName: 'M', atelierName: 'A', causeKey: key, causeLabel: key, code: key,
        classification: 'unplanned', startMs: 0, endMs: ms, durationMs: ms, countedMs: ms }) as RawStop;
    const rows = paretoFromStops([stop('10', 5), stop('10', 7), stop('20', 1)]);
    expect(rows.map((r) => [r.key, r.downtimeMs, r.occurrences])).toEqual([['10', 12, 2], ['20', 1, 1]]);
  });
});
