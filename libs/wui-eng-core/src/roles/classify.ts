// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Role rule engine — qualifies book entries as measure / setpoint / command /
 * state / alarm / counter / parameter, semi-automatically.
 *
 * Rules are DATA (serialisable, versionable, project-overridable), not code, so a
 * project can encode its own conventions without touching the studio. Three
 * layers, by increasing priority — the most specific wins, and the matching rule
 * is always reported so the operator can trust (or correct) the result:
 *
 *  1. **structural** (10-19) — datatype + access + presence of a unit. Works on
 *     any source with zero configuration: a read-only Float with `bar` IS a
 *     measure; a writable Bool IS a command.
 *  2. **path/prefix** (20-29) — the source structure, by far the best value:
 *     `Command.*` / `Status.*` / `Admin.*` (PackML), `Mesures.*` / `Consignes.*` /
 *     `Etat.*` / `Commande.*` (S7 & catalog books).
 *  3. **name & convention** (30-49) — the Visuel Concept referential already
 *     encodes the classification in its prefixes (`AI_`, `AO_`, `DI_`, `DO_`,
 *     `CALC_`, cf. `patterns-wincc-oa`), plus the usual business patterns
 *     (`*_Defaut`, `Marche*`, `Consigne*`, `Compteur*`…).
 *
 * Determinism: rules are sorted by descending priority, and the FIRST match wins;
 * on equal priority the earlier rule in the array wins. A MANUAL role always
 * overrides the rules and is never recomputed away.
 */

import type { BookEntry, OaLeafType, TagAccess } from '../model.js';
import type { RoleAssignment, SignalRole } from './roles.js';

/** Conditions of a rule. All the ones present must match (AND). */
export interface RoleRuleWhen {
  /** Regex tested against the full entry path. */
  pathPattern?: string;
  /** Regex tested against the LAST path segment (the signal name). */
  namePattern?: string;
  /** Regex tested against the comment. */
  commentPattern?: string;
  /** Regex tested against the unit. */
  unitPattern?: string;
  /** Require (true) or forbid (false) a non-empty unit. */
  hasUnit?: boolean;
  /** Allowed WinCC OA element types. */
  leafTypes?: OaLeafType[];
  /** Allowed access modes. */
  access?: TagAccess[];
  /** Regex tested against the source datatype (`REAL`, `Int32`, `UDINT`…). */
  sourceTypePattern?: string;
}

/** One qualification rule. */
export interface RoleRule {
  id: string;
  /** Higher wins. See the three layers in the module header. */
  priority: number;
  role: SignalRole;
  when: RoleRuleWhen;
  /** Human explanation shown in the UI. */
  note?: string;
}

/** Numeric element types (measures, setpoints, counters). */
const NUMERIC: OaLeafType[] = ['Float', 'Int', 'UInt', 'Long', 'ULong', 'Char'];

/**
 * The shipped rule set — neutral defaults, meant to be extended/overridden per
 * project. Ids are stable so a project override can replace one precisely.
 */
/**
 * Pattern matching a named BRANCH anywhere in an entry path, not only at its root.
 *
 * A path is rooted differently by every generator: a SimaticML book starts at the
 * block (`DB_Four.Mesures.Temperature`), an online browse starts at the instance
 * (`Remplisseuse.Status.StateCurrent`), a companion-spec catalog starts at the
 * branch itself (`Status.StateCurrent`). Anchoring these rules at `^` silently
 * disabled them for the first two shapes — the branch is what carries the meaning,
 * wherever it sits.
 */
const BRANCH = (alternatives: string): string => `(^|\\.)(${alternatives})\\.`;

export const DEFAULT_ROLE_RULES: RoleRule[] = [
  // --- layer 3: name & Visuel Concept convention -----------------------------
  {
    id: 'vc-prefix-ai',
    priority: 44,
    role: 'measure',
    when: { namePattern: '^AI_' },
    note: 'VC convention: AI_ prefix (analog input)'
  },
  {
    id: 'vc-prefix-calc',
    priority: 44,
    role: 'measure',
    when: { namePattern: '^CALC_' },
    note: 'VC convention: CALC_ prefix (computed value)'
  },
  {
    id: 'vc-prefix-ao',
    priority: 44,
    role: 'setpoint',
    when: { namePattern: '^AO_' },
    note: 'VC convention: AO_ prefix (analog output)'
  },
  {
    id: 'vc-prefix-do',
    priority: 44,
    role: 'command',
    when: { namePattern: '^DO_' },
    note: 'VC convention: DO_ prefix (digital output)'
  },
  {
    id: 'vc-prefix-di',
    priority: 44,
    role: 'state',
    when: { namePattern: '^DI_' },
    note: 'VC convention: DI_ prefix (digital input)'
  },
  {
    id: 'name-alarm',
    priority: 38,
    role: 'alarm',
    when: { namePattern: '(defaut|fault|alarm|alarme|trip|bourrage|securite)' },
    note: 'name suggesting a fault / an alarm'
  },
  {
    // An ENERGY unit is unambiguously cumulative (kWh, kvarh, kVAh…), which
    // catches vendor namings that carry no keyword (PAC3200 `Eact_import_T1`).
    // Volume/time units are deliberately NOT here: m³ or h may be a level or a
    // duration measure — those are left to the name rules.
    id: 'unit-counter-energy',
    priority: 37,
    role: 'counter',
    when: { unitPattern: '^(k|m)?(w|var|va)h$', leafTypes: NUMERIC },
    note: 'energy unit (cumulative) → counter'
  },
  {
    id: 'name-counter',
    priority: 36,
    role: 'counter',
    when: {
      namePattern: '(compteur|counter|count|totalis|energie|energy|^nb_|_hours?$|horaire|volume)',
      leafTypes: NUMERIC
    },
    note: 'name suggesting a totaliser / counter'
  },
  {
    id: 'name-setpoint',
    priority: 34,
    role: 'setpoint',
    when: { namePattern: '(consigne|setpoint|_sp$|tolerance)' },
    note: 'name suggesting a setpoint'
  },
  {
    id: 'name-command',
    priority: 33,
    role: 'command',
    when: { namePattern: '^(marche|arret|start|stop|cmd|commande|ordre|reset|acquit|open|close)' },
    note: 'name suggesting a command'
  },
  // --- layer 2: source path / prefix ----------------------------------------
  {
    id: 'path-command',
    priority: 26,
    role: 'command',
    when: { pathPattern: BRANCH('commande?s?') },
    note: '"Command(s)" branch of the source (e.g. PackML, TIA)'
  },
  {
    id: 'path-measure',
    priority: 25,
    role: 'measure',
    when: { pathPattern: BRANCH('mesures?|measures?') },
    note: '"Measures" branch of the source'
  },
  {
    id: 'path-setpoint',
    priority: 25,
    role: 'setpoint',
    when: { pathPattern: BRANCH('consignes?|setpoints?') },
    note: '"Setpoints" branch of the source'
  },
  {
    id: 'path-state',
    priority: 24,
    role: 'state',
    when: { pathPattern: BRANCH('status|etat|état') },
    note: '"Status/State" branch of the source'
  },
  {
    id: 'path-admin',
    priority: 22,
    role: 'parameter',
    when: { pathPattern: BRANCH('admin') },
    note: '"Admin" branch of the source (e.g. PackML)'
  },
  {
    // PHYSICAL-QUANTITY words sit BELOW the path rules on purpose: they say what
    // is measured, not what it is FOR. `Consignes.Temperature` is a setpoint of a
    // temperature — the `Consignes.` branch must win. They still sit above the
    // structural rules, so a `%MW`-located (hence writable) `Pression_Reseau`
    // is a measure rather than a setpoint.
    id: 'name-quantity',
    priority: 21,
    role: 'measure',
    when: { namePattern: '(mesure|_pv$|temperature|pression|debit|niveau|poids|tension|courant|vitesse|cadence|hygrometrie)' },
    note: 'physical-quantity name → measure'
  },
  // --- layer 1: structural (datatype + access + unit) -----------------------
  {
    id: 'struct-bool-write',
    priority: 15,
    role: 'command',
    when: { leafTypes: ['Bool'], access: ['w', 'rw'] },
    note: 'writable boolean → command'
  },
  {
    id: 'struct-bool-read',
    priority: 14,
    role: 'state',
    when: { leafTypes: ['Bool'], access: ['r'] },
    note: 'read-only boolean → state'
  },
  {
    id: 'struct-numeric-write',
    priority: 13,
    role: 'setpoint',
    when: { leafTypes: NUMERIC, access: ['w', 'rw'] },
    note: 'writable numeric → setpoint'
  },
  {
    id: 'struct-numeric-unit',
    priority: 12,
    role: 'measure',
    when: { leafTypes: NUMERIC, access: ['r'], hasUnit: true },
    note: 'read-only numeric with a physical unit → measure'
  },
  {
    id: 'struct-numeric-read',
    priority: 11,
    role: 'measure',
    when: { leafTypes: NUMERIC, access: ['r'] },
    note: 'read-only numeric → measure (to confirm, no unit)'
  },
  {
    id: 'struct-text',
    priority: 10,
    role: 'parameter',
    when: { leafTypes: ['String', 'LangString', 'Blob', 'Time', 'Bit32'] },
    note: 'non-numeric data → parameter'
  }
];

function lastSegment(path: string): string {
  const index = path.lastIndexOf('.');
  return index === -1 ? path : path.slice(index + 1);
}

/**
 * Compile-and-test a rule pattern. Patterns are **case-insensitive** (names and
 * paths vary in case across projects); a leading `(?i)` is tolerated and
 * stripped, since JavaScript has no inline flags. An invalid pattern never
 * matches and never throws — a bad project rule must not break qualification.
 */
function matches(pattern: string | undefined, value: string): boolean {
  if (pattern === undefined) return true;
  try {
    return new RegExp(pattern.replace(/^\(\?i\)/, ''), 'i').test(value);
  } catch {
    return false;
  }
}

/** Whether one rule matches an entry (all stated conditions must hold). */
export function ruleMatches(rule: RoleRule, entry: BookEntry): boolean {
  const when = rule.when;
  if (!matches(when.pathPattern, entry.path)) return false;
  if (!matches(when.namePattern, lastSegment(entry.path))) return false;
  if (!matches(when.commentPattern, entry.comment ?? '')) return false;
  if (!matches(when.unitPattern, entry.unit ?? '')) return false;
  if (!matches(when.sourceTypePattern, entry.sourceType)) return false;
  if (when.hasUnit !== undefined) {
    const has = (entry.unit ?? '').trim() !== '';
    if (has !== when.hasUnit) return false;
  }
  if (when.leafTypes !== undefined && !when.leafTypes.includes(entry.leafType)) return false;
  if (when.access !== undefined && !when.access.includes(entry.access)) return false;
  return true;
}

/** Rules sorted the way the engine evaluates them (priority desc, order stable). */
export function orderedRules(rules: RoleRule[]): RoleRule[] {
  return rules.map((rule, index) => ({ rule, index })).sort((a, b) => b.rule.priority - a.rule.priority || a.index - b.index).map((r) => r.rule);
}

/**
 * Qualify one entry. `manual` (an operator override) always wins; otherwise the
 * highest-priority matching rule does; otherwise the entry stays `unknown`.
 */
export function classifyEntry(entry: BookEntry, rules: RoleRule[] = DEFAULT_ROLE_RULES, manual?: SignalRole): RoleAssignment {
  if (manual !== undefined) {
    return { role: manual, source: 'manual', ruleId: null, reason: 'role set manually' };
  }
  for (const rule of orderedRules(rules)) {
    if (ruleMatches(rule, entry)) {
      return { role: rule.role, source: 'rule', ruleId: rule.id, reason: rule.note ?? rule.id };
    }
  }
  return { role: 'unknown', source: 'none', ruleId: null, reason: 'no rule matched — must be qualified' };
}

/**
 * Qualify a whole book. `manual` maps entry path → operator-set role and always
 * wins. Returns one assignment per entry path.
 */
export function classifyEntries(
  entries: BookEntry[],
  rules: RoleRule[] = DEFAULT_ROLE_RULES,
  manual: Record<string, SignalRole> = {}
): Map<string, RoleAssignment> {
  const out = new Map<string, RoleAssignment>();
  for (const entry of entries) {
    out.set(entry.path, classifyEntry(entry, rules, manual[entry.path]));
  }
  return out;
}

/** Apply assignments onto entries, returning NEW entries carrying their role. */
export function withRoles(entries: BookEntry[], assignments: Map<string, RoleAssignment>): BookEntry[] {
  return entries.map((entry) => {
    const assignment = assignments.get(entry.path);
    return assignment === undefined ? entry : { ...entry, role: assignment.role };
  });
}

/** Count entries per role (drives the "N à qualifier" summary). */
export function roleCounts(assignments: Map<string, RoleAssignment>): Record<SignalRole, number> {
  const counts = {
    measure: 0,
    setpoint: 0,
    command: 0,
    state: 0,
    alarm: 0,
    counter: 0,
    parameter: 0,
    unknown: 0
  } satisfies Record<SignalRole, number>;
  for (const assignment of assignments.values()) counts[assignment.role] += 1;
  return counts;
}
