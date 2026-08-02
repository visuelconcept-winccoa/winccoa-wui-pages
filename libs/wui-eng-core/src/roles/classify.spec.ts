// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Role rule engine: the three layers, their priority order, manual override,
 * explainability, and the real books of the demo (PAC3200, PackML, M580) — the
 * regression net for "qualifier quasi automatiquement".
 */
import { describe, expect, it } from 'vitest';
import type { BookEntry, OaLeafType, TagAccess } from '../model.js';
import { DEFAULT_ROLE_RULES, classifyEntries, classifyEntry, roleCounts, withRoles, type RoleRule } from './classify.js';

function entry(path: string, leafType: OaLeafType, access: TagAccess, extra: Partial<BookEntry> = {}): BookEntry {
  return { path, sourceType: leafType, leafType, access, addresses: {}, ...extra };
}

const roleOf = (e: BookEntry, rules?: RoleRule[]) => classifyEntry(e, rules).role;

describe('layer 1 — structural', () => {
  it('a writable bool is a command, a read-only bool a state', () => {
    expect(roleOf(entry('X', 'Bool', 'rw'))).toBe('command');
    expect(roleOf(entry('X', 'Bool', 'w'))).toBe('command');
    expect(roleOf(entry('X', 'Bool', 'r'))).toBe('state');
  });

  it('a read-only numeric WITH a unit is a measure', () => {
    expect(roleOf(entry('X', 'Float', 'r', { unit: 'bar' }))).toBe('measure');
  });

  it('a writable numeric is a setpoint', () => {
    expect(roleOf(entry('X', 'Int', 'rw'))).toBe('setpoint');
  });

  it('non-numeric data is a parameter', () => {
    expect(roleOf(entry('X', 'String', 'rw'))).toBe('parameter');
    expect(roleOf(entry('X', 'Time', 'r'))).toBe('parameter');
  });

  it('explains itself (reason + rule id)', () => {
    const assignment = classifyEntry(entry('X', 'Float', 'r', { unit: '°C' }));
    expect(assignment).toMatchObject({ source: 'rule', ruleId: 'struct-numeric-unit' });
    expect(assignment.reason).toMatch(/unité physique/);
  });
});

describe('layer 2 — source path beats structure', () => {
  it('PackML Command.* is a command even when the type says otherwise', () => {
    // Int32 + rw would be a setpoint structurally; the path wins.
    expect(roleOf(entry('Command.CntrlCmd', 'Int', 'rw'))).toBe('command');
  });

  it('PackML Status.* is a state', () => {
    expect(roleOf(entry('Status.StateCurrent', 'Int', 'r'))).toBe('state');
  });

  it('Mesures.* / Consignes.* / Etat.* are recognised (FR books)', () => {
    expect(roleOf(entry('Mesures.Debit', 'Float', 'r'))).toBe('measure');
    expect(roleOf(entry('Consignes.Rampe', 'Float', 'rw'))).toBe('setpoint');
    expect(roleOf(entry('Etat.PorteOuverte', 'Bool', 'rw'))).toBe('state');
  });

  it('a physical-QUANTITY name does not outrank the path branch', () => {
    // The subtle one: "Temperature" says WHAT is measured, `Consignes.` says what
    // it is FOR. A setpoint of a temperature is a setpoint.
    expect(roleOf(entry('Consignes.Temperature', 'Float', 'rw'))).toBe('setpoint');
    expect(roleOf(entry('Mesures.Temperature', 'Float', 'r'))).toBe('measure');
    // …but a quantity name still outranks the structural rules: a %MW-located
    // (hence writable) pressure reading is a measure, not a setpoint.
    expect(roleOf(entry('Pression_Reseau', 'Float', 'rw', { unit: 'bar' }))).toBe('measure');
  });
});

describe('layer 3 — name & VC convention beat everything', () => {
  it('a fault name wins over the read-only-bool state rule', () => {
    expect(roleOf(entry('Defaut_Pompe1', 'Bool', 'r'))).toBe('alarm');
    expect(roleOf(entry('Etat.Defaut', 'Bool', 'r'))).toBe('alarm');
    expect(roleOf(entry('Etiqueteuse.BourrageDetecte', 'Bool', 'r'))).toBe('alarm');
  });

  it('an energy unit alone qualifies a counter (vendor naming without keyword)', () => {
    // PAC3200: `Eact_import_T1` carries no "counter" keyword — kWh does the job.
    expect(roleOf(entry('Eact_import_T1', 'Float', 'r', { unit: 'kWh' }))).toBe('counter');
    expect(roleOf(entry('Ereact_import_T1', 'Float', 'r', { unit: 'kvarh' }))).toBe('counter');
    expect(roleOf(entry('Eapp_T1', 'Float', 'r', { unit: 'kVAh' }))).toBe('counter');
    // A rate is NOT a counter: `pcs/min` must not match the energy pattern.
    expect(roleOf(entry('Status.CurMachSpeed', 'Float', 'r', { unit: 'pcs/min' }))).toBe('state');
    // Ambiguous units stay measures (a m³ level, an h duration).
    expect(roleOf(entry('Niveau_m3', 'Float', 'r', { unit: 'm3' }))).toBe('measure');
  });

  it('a counter name wins over the measure/setpoint rules', () => {
    expect(roleOf(entry('Nb_Pesees', 'UInt', 'rw'))).toBe('counter');
    expect(roleOf(entry('Op_hours', 'UInt', 'r', { unit: 'h' }))).toBe('counter');
    expect(roleOf(entry('Compteur_Volume', 'UInt', 'rw'))).toBe('counter');
  });

  it('applies the Visuel Concept prefixes of the referential', () => {
    expect(roleOf(entry('AI_Temperature', 'Float', 'rw'))).toBe('measure');
    expect(roleOf(entry('AO_Vanne', 'Float', 'r'))).toBe('setpoint');
    expect(roleOf(entry('DO_Pompe', 'Bool', 'r'))).toBe('command');
    expect(roleOf(entry('DI_Presence', 'Bool', 'rw'))).toBe('state');
    expect(roleOf(entry('CALC_Rendement', 'Float', 'rw'))).toBe('measure');
  });

  it('recognises command and setpoint names', () => {
    expect(roleOf(entry('Marche_Pompe1', 'Bool', 'rw'))).toBe('command');
    expect(roleOf(entry('Acquit', 'Bool', 'rw'))).toBe('command');
    expect(roleOf(entry('Consigne_Debit', 'Int', 'r'))).toBe('setpoint');
  });
});

describe('override and unknown', () => {
  it('a manual role always wins and is reported as manual', () => {
    const assignment = classifyEntry(entry('Defaut_Pompe1', 'Bool', 'r'), DEFAULT_ROLE_RULES, 'state');
    expect(assignment).toMatchObject({ role: 'state', source: 'manual', ruleId: null });
  });

  it('leaves an entry unknown when no rule matches (never a silent default)', () => {
    const assignment = classifyEntry(entry('Truc', 'Dpid' as OaLeafType, 'r'), []);
    expect(assignment).toMatchObject({ role: 'unknown', source: 'none' });
    expect(assignment.reason).toMatch(/à qualifier/);
  });

  it('an invalid regex in a project rule never throws (rule just does not match)', () => {
    const broken: RoleRule[] = [{ id: 'broken', priority: 99, role: 'alarm', when: { namePattern: '([' } }];
    expect(roleOf(entry('X', 'Bool', 'r'), [...broken, ...DEFAULT_ROLE_RULES])).toBe('state');
  });
});

describe('book-level classification', () => {
  it('classifies a whole book, counts roles and stamps the entries', () => {
    const entries = [
      entry('Mesures.Temperature', 'Float', 'r', { unit: '°C' }),
      entry('Consignes.Temperature', 'Float', 'rw'),
      entry('Etat.Defaut', 'Bool', 'r'),
      entry('Marche_Pompe', 'Bool', 'rw'),
      entry('Eact_import_T1', 'Float', 'r', { unit: 'kWh' }),
      entry('Recette', 'String', 'rw')
    ];
    const assignments = classifyEntries(entries);
    const counts = roleCounts(assignments);
    expect(counts).toMatchObject({ measure: 1, setpoint: 1, alarm: 1, command: 1, counter: 1, parameter: 1, unknown: 0 });

    const stamped = withRoles(entries, assignments);
    expect(stamped.map((e) => e.role)).toEqual(['measure', 'setpoint', 'alarm', 'command', 'counter', 'parameter']);
    // The original entries are untouched (pure transform).
    expect(entries[0].role).toBeUndefined();
  });

  it('honours per-path manual overrides in a book', () => {
    const entries = [entry('Mesures.Temperature', 'Float', 'r', { unit: '°C' })];
    const assignments = classifyEntries(entries, DEFAULT_ROLE_RULES, { 'Mesures.Temperature': 'parameter' });
    expect(assignments.get('Mesures.Temperature')).toMatchObject({ role: 'parameter', source: 'manual' });
  });
});

describe('path rules match a BRANCH wherever it sits', () => {
  // Regression: the path rules were anchored at `^`, so they only ever fired on
  // catalogs rooted at the branch itself (a companion spec). Every book rooted at
  // a block (SimaticML) or at an instance (an online browse) silently fell through
  // to the name/structural rules.
  it('fires on a path rooted at a TIA block', () => {
    expect(classifyEntry(entry('DB_Four.Mesures.Hygrometrie', 'Float', 'r')).ruleId).toBe('path-measure');
    expect(classifyEntry(entry('DB_Four.Consignes.Rampe', 'Float', 'rw')).ruleId).toBe('path-setpoint');
  });

  it('fires on a path rooted at a browsed instance', () => {
    expect(classifyEntry(entry('Remplisseuse.Status.StateCurrent', 'Int', 'r')).ruleId).toBe('path-state');
    expect(classifyEntry(entry('Remplisseuse.Commandes.Demarrer', 'Bool', 'r')).ruleId).toBe('path-command');
    expect(classifyEntry(entry('Remplisseuse.Admin.RecetteCourante', 'String', 'r')).ruleId).toBe('path-admin');
  });

  it('keeps the name rules ABOVE the path rules where they are more specific', () => {
    // `Admin.` would say "parameter"; a counter name is stronger and wins (prio 36
    // vs 22) — the layering is deliberate, not accidental.
    expect(classifyEntry(entry('Remplisseuse.Admin.ProdProcessedCount', 'UInt', 'r'))).toMatchObject({
      role: 'counter',
      ruleId: 'name-counter'
    });
  });

  it('still fires at the root (a companion-spec catalog)', () => {
    expect(classifyEntry(entry('Status.UnitModeCurrent', 'Int', 'r')).ruleId).toBe('path-state');
  });

  it('does not fire on a mere SUBSTRING of a segment', () => {
    // `Statusless` is not the `Status` branch.
    expect(classifyEntry(entry('Machine.Statusless.Valeur', 'Float', 'r')).ruleId).not.toBe('path-state');
  });

  it('a browsed command stays a command despite the read-only browse default', () => {
    // A browse cannot read AccessLevel, so `access` is 'r' — the PATH is what
    // rescues the qualification here (and the direction then comes from the role).
    const assignment = classifyEntry(entry('Remplisseuse.Commandes.CmdStart', 'Bool', 'r'));
    expect(assignment.role).toBe('command');
  });
});

