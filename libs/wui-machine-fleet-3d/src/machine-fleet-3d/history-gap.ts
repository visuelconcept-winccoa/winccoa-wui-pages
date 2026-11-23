// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Why a machine's dashboard has no history (winccoa-fra-msp-stma#382): the Gantt, the stop list and the Pareto read
 * only the history the state manager records (`MachineFleet3D_State_<symbol>`, fleetState), so an empty period can
 * mean four different things, which the dashboard says instead of a bare « no data »:
 *  - `noInput`: the symbol binds no input of its state mapping — nothing to record, ever (its causes alone make no
 *    stop: a stop is a period in a stop state);
 *  - `notRecorded`: the record does not exist — fleetState does not follow the symbol (stopped, not declared in the
 *    project, or the symbol was added less than a minute ago);
 *  - `notArchived`: the record exists but is not archived — fleetState found no archive group (its log says so);
 *  - `empty`: recorded and archived, nothing in the period.
 *
 * Pure: the dashboard reads the facts, this names the case.
 */

export type HistoryGap = 'noInput' | 'notRecorded' | 'notArchived' | 'empty';

export interface HistoryFacts {
  /** The symbol binds at least one input of its mapping (state-eval.ts `recordsState`). */
  recordsState: boolean;
  /** The record's state element could be read (null: not asked). */
  recordExists: boolean | null;
  /** Its archive config is active (null: unknown — not asked or unreadable). */
  archived: boolean | null;
}

export function historyGap(f: HistoryFacts): HistoryGap {
  if (!f.recordsState) return 'noInput';
  if (f.recordExists === false) return 'notRecorded';
  if (f.archived === false) return 'notArchived';
  return 'empty';
}
