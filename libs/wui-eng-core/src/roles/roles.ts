// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Signal ROLES — the semantic qualification of an address-book entry.
 *
 * A book says *what to read* (path, type, unit, address); the role says *what it
 * is for*. It is the hinge of the studio: the role drives both the model (which
 * DPEs to create) and the configs applied at check-in (archive, alarm, range,
 * direction) — see `./profiles.ts`.
 *
 * Roles live ON the book entry on purpose: a mutualised catalog (a PAC3200
 * register map, a PackML interface) is qualified ONCE and reused on every
 * equipment referencing it.
 */

/** The qualification of a signal. */
export type SignalRole =
  /** Physical measurement, read from the process (usually carries a unit). */
  | 'measure'
  /** Operator/recipe target value written to the process. */
  | 'setpoint'
  /** Order written to the process (start/stop, open/close). */
  | 'command'
  /** Non-fault status read from the process (running, mode, position). */
  | 'state'
  /** Fault/alarm condition read from the process. */
  | 'alarm'
  /** Monotonic totaliser (energy, volume, piece or hour counter). */
  | 'counter'
  /** Configuration/recipe data, neither archived nor alarmed by default. */
  | 'parameter'
  /** No rule matched — must be qualified before it is used. */
  | 'unknown';

/** Display order of the roles (used by pickers and summaries). */
export const SIGNAL_ROLES: SignalRole[] = [
  'measure',
  'setpoint',
  'command',
  'state',
  'alarm',
  'counter',
  'parameter',
  'unknown'
];

/**
 * Default (English) labels. The core is the untranslated engine layer — every
 * message it produces is English; the page localises its own strings and its own
 * role labels (`eng-studio/i18n.ts` → `ROLE_LABEL`). These remain the fallback for
 * any consumer without an i18n layer.
 */
export const SIGNAL_ROLE_LABEL: Record<SignalRole, string> = {
  measure: 'measure',
  setpoint: 'setpoint',
  command: 'command',
  state: 'state',
  alarm: 'alarm',
  counter: 'counter',
  parameter: 'parameter',
  unknown: 'to qualify'
};

/** Where a role came from — manual always wins over a rule. */
export type RoleSource = 'rule' | 'manual' | 'none';

/** The outcome of qualifying one entry, with its justification. */
export interface RoleAssignment {
  role: SignalRole;
  source: RoleSource;
  /** Id of the rule that matched (`null` for manual/none). */
  ruleId: string | null;
  /** Human explanation, shown as the tooltip in the UI (trust needs a reason). */
  reason?: string;
}
