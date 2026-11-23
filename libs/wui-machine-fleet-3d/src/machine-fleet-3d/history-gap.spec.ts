// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** A machine's dashboard says why it has no history (winccoa-fra-msp-stma#382). */
import { describe, expect, it } from 'vitest';
import { historyGap } from './history-gap.js';

describe('history gap', () => {
  it('a symbol without state input records nothing, whatever else', () => {
    expect(historyGap({ recordsState: false, recordExists: true, archived: true })).toBe('noInput');
    expect(historyGap({ recordsState: false, recordExists: null, archived: null })).toBe('noInput');
  });

  it('a record that does not exist: the state manager does not follow the symbol', () => {
    expect(historyGap({ recordsState: true, recordExists: false, archived: null })).toBe('notRecorded');
  });

  it('a record without archive: nothing kept', () => {
    expect(historyGap({ recordsState: true, recordExists: true, archived: false })).toBe('notArchived');
  });

  it('otherwise the period is just empty (an unknown archive config is not called missing)', () => {
    expect(historyGap({ recordsState: true, recordExists: true, archived: true })).toBe('empty');
    expect(historyGap({ recordsState: true, recordExists: true, archived: null })).toBe('empty');
    expect(historyGap({ recordsState: true, recordExists: null, archived: null })).toBe('empty');
  });
});
