// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Machine Fleet's state recorder (managers/kpiCalc, formerly fleetState, winccoa-fra-msp-stma#339), on a fake WinCC OA:
 *  - its state computation gives exactly what the live views give (wui-fleet-core state-eval.ts): the shared
 *    cases, and thousands of random mappings and values;
 *  - the symbols recorded (mapping chosen, duplicates, symbols binding nothing);
 *  - the recording: subscriptions, one write per change, archived once, passive server, causes by priority and
 *    by catalogue, mapping or binding changed, symbol removed, datapoint missing.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { evaluateState as evaluateTs, currentCause as currentCauseTs, causeClassOf as causeClassTs, stateRecordDp, inputDpsOf as inputDpsTs, resolveBinding as resolveBindingTs } from '../../wui-fleet-core/src/state-eval.ts';
import { DEFAULT_STATE_MAPPINGS } from '../../wui-fleet-core/src/types.ts';

const require = createRequire(import.meta.url);
const E = require('../managers/kpiCalc/state-eval.js');
const R = require('../managers/kpiCalc/recorder.js');
const P = require('../managers/kpiCalc/cause-push.js');
const cases = require('../../wui-fleet-core/src/state-eval.cases.json');

// ------------------------------------------------------------------ parity with the live views

describe('same state as the live views', () => {
  for (const c of cases.cases) {
    it(c.name, () => {
      const mapping = c.mapping ? cases.mappings[c.mapping] : undefined;
      expect(E.evaluateState(mapping, c.values, c.cause ?? '')).toBe(c.expected);
    });
  }

  it('on thousands of random mappings and values', () => {
    let seed = 42;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const VALUES = [undefined, null, 0, 1, 2, 3, -1, 2.5, true, false, '0', '1', '2', 'true', 'false', 'AUTO', '', ' ', [1], [], ['x'], 'abc'];
    const INPUTS = ['state', 'a', 'b'];
    const cond = () => {
      const c = { input: pick(INPUTS) };
      const k = rnd();
      if (k < 0.4) c.equals = pick([0, 1, 2, true, false, 'AUTO', '1']);
      if (k >= 0.3) { if (rnd() < 0.7) c.min = pick([0, 1, 2]); if (rnd() < 0.7) c.max = pick([1, 2, 3]); }
      if (rnd() < 0.3) c.not = true;
      return c;
    };
    for (let i = 0; i < 4000; i++) {
      const rules = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () => {
        const r = { state: pick(['ok', 'stop', 'warn', '@cause']) };
        if (rnd() < 0.5) r.min = pick([0, 1, 2]);
        if (rnd() < 0.5) r.max = pick([1, 2, 3]);
        if (rnd() < 0.6) r.when = Array.from({ length: 1 + Math.floor(rnd() * 2) }, cond);
        return r;
      });
      const mapping = { id: 'm', name: 'm', rules, fallback: pick(['stop', 'maint']), ...(rnd() < 0.6 ? { causeStates: { planned: 'p', unplanned: 'u' } } : {}) };
      const values = {};
      for (const k of INPUTS) { const v = pick(VALUES); if (v !== undefined || rnd() < 0.5) values[k] = v; }
      const cause = pick(['', 'planned', 'unplanned']);
      expect(E.evaluateState(mapping, values, cause), JSON.stringify({ mapping, values, cause })).toBe(evaluateTs(mapping, values, cause));
    }
  });

  it('same default mapping and same recorded datapoint as the views', () => {
    expect(R.DEFAULT_MAPPING).toEqual(DEFAULT_STATE_MAPPINGS[0]);
    for (const id of ['CN_01', 'machine-17', 'x/é y', 'M.1']) expect(R.stateDpName(id)).toBe(stateRecordDp(id));
    for (const m of [{ id: 'M1', stateDp: 'A', declaredState: true, inputDps: { b: 'B', declared: 'ignoré', state: 'ignoré' } }, { id: 'M2', declaredState: false, inputDps: { c: ' ' } }, { declaredState: true }]) {
      expect(E.inputDpsOf(m)).toEqual(inputDpsTs(m));
    }
    expect(E.inputDpsOf({ id: 'M1', declaredState: true })).toEqual({ declared: 'MachineFleet3D_State_M1.declared' });
  });

  it('same cause in progress and same class of cause', () => {
    const causes = [{ code: 'AP01', classification: 'planned' }, { code: 'ANP01', classification: 'unplanned' }, { code: 'P', classification: 'production' }];
    for (const vals of [['', 'AP01'], [null, ' ANP01 '], [[], ['P']], [undefined], ['XX']]) {
      expect(E.currentCause(vals)).toBe(currentCauseTs(vals));
      const code = E.currentCause(vals);
      expect(E.causeClassOf(code, causes)).toBe(causeClassTs(code, causes));
    }
  });
});

// ------------------------------------------------------------------ symbols recorded

const MES = cases.mappings.mes;
const SIMPLE = cases.mappings.simple;

describe('symbols recorded', () => {
  it('one per symbol, its mapping or the atelier’s first one, nothing for a symbol binding no input', () => {
    const { machines, duplicates } = R.planMachines([
      { dp: 'MachineFleet3D_a', atelier: { id: 'a', mappings: [SIMPLE, MES], machines: [
        { id: 'CN_01', name: 'CN 01', stateDp: 'CN_01.State', stateMappingId: 'mes', inputDps: { comm: 'CN_01.Comm', of: 'WC.Ctx' }, stopCauseDp: 'WC.Cause', stopCauseDps: ['CN_01.Cause'], stopCatalogId: 'ilot' },
        { id: 'M2', name: 'Four', stateDp: 'M2.State', stateMappingId: 'inconnue' },
        { id: 'DECOR', name: 'Armoire' }
      ] } },
      { dp: 'MachineFleet3D_b', atelier: { id: 'b', mappings: [], machines: [{ id: 'CN_01', name: 'CN 01 bis', stateDp: 'X.State' }, { id: 'M3', inputDps: { a: 'M3.A' } }] } }
    ]);
    expect([...machines.keys()]).toEqual(['CN_01', 'M2', 'M3']);
    expect(machines.get('CN_01')).toMatchObject({ atelier: 'a', inputs: { state: 'CN_01.State', comm: 'CN_01.Comm', of: 'WC.Ctx' }, causes: ['WC.Cause', 'CN_01.Cause'], catalogId: 'ilot' });
    expect(machines.get('CN_01').mapping.id).toBe('mes');
    expect(machines.get('M2').mapping.id).toBe('default');
    expect(machines.get('M3')).toMatchObject({ mapping: R.DEFAULT_MAPPING, catalogId: 'default', inputs: { a: 'M3.A' } });
    expect(duplicates).toEqual([{ id: 'CN_01', atelier: 'b' }]);
    expect(R.stateDpName('machine-17 x/é')).toBe('MachineFleet3D_State_machine_17_x__');
  });
});

// ------------------------------------------------------------------ recording, on a fake WinCC OA

/** An archive attribute of a datapoint element: `<dpe>:_archive.._type`, `.._archive`, `.1._type`, `.1._class`. */
const ARCHIVE_ATTRIBUTE = /^(.*):_archive\.(?:\.|1\.)_(?:archive|type|class)$/;

function fakeWcc() {
  const db = {};
  const dps = new Set();
  const ateliers = [];
  const catalogs = [];
  const conns = new Map();
  const writes = [];
  let n = 0;
  const created = new Set();
  // A datapoint created here has all its elements, as in WinCC OA.
  const has = (dpe) => dps.has(dpe.split('.')[0]) && (dpe.includes('.') ? dpe in db || dps.has(dpe) || created.has(dpe.split('.')[0]) : true);
  const wcc = {
    db, dps, ateliers, catalogs, conns, writes,
    dpNames: (pattern, type) => (type === 'MachineFleet3D_Config' ? ateliers.map((a) => `System1:${a}.`) : type === 'MachineFleet3D_StopCauses' ? catalogs.map((c) => `System1:${c}.`) : []),
    // As WinCC OA (winccoa-fra-msp-stma#396): an element never archived reads 0 as its archive type, and refuses to
    // read its other archive attributes (error 97 for each, grouped as 9399) — the case of every new record.
    dpGet: async (names) => {
      const list = Array.isArray(names) ? names : [names];
      const refused = list.filter((x) => {
        const m = ARCHIVE_ATTRIBUTE.exec(x);
        return m && !x.endsWith(':_archive.._type') && !Number(db[`${m[1]}:_archive.._type`]);
      });
      if (refused.length) {
        const e = new Error(`9399, multiple errors (${refused.length} errors total)`);
        e.code = 9399;
        throw e;
      }
      const values = list.map((x) => (x.endsWith(':_archive.._type') && db[x] === undefined ? 0 : db[x]));
      return Array.isArray(names) ? values : values[0];
    },
    dpSetWait: async (names, values) => {
      // As WinCC OA: as many values as datapoint elements, none empty.
      if (Array.isArray(names) !== Array.isArray(values) || (Array.isArray(names) && (names.length === 0 || names.length !== values.length))) {
        throw new Error('76, Invalid argument in function, DP & value list must have same length and not be empty');
      }
      const list = Array.isArray(names) ? names : [names];
      const vals = Array.isArray(names) ? values : [values];
      list.forEach((x, i) => { db[x] = vals[i]; });
      writes.push(Object.fromEntries(list.map((x, i) => [x, vals[i]])));
    },
    dpConnect: (cb, dpes, answer) => {
      const id = ++n;
      conns.set(id, { cb, dpes });
      if (answer) cb(dpes.map((d) => `System1:${d}`), dpes.map((d) => db[d]));
      return id;
    },
    dpDisconnect: (id) => { conns.delete(id); },
    dpExists: (dpe) => has(dpe),
    dpCreate: async (dp) => { dps.add(dp); created.add(dp); },
    /** A value changes: every subscription that has it is told. */
    set(dpe, v) {
      db[dpe] = v;
      for (const c of conns.values()) if (c.dpes.includes(dpe)) c.cb([`System1:${dpe}`], [v]);
    },
    /** An existing datapoint element with its value. */
    put(dpe, v) { dps.add(dpe.split('.')[0]); db[dpe] = v; }
  };
  return wcc;
}

const CN = 'MachineFleet3D_State_CN_01';
const records = (wcc, dp = CN) => wcc.writes.filter((w) => `${dp}.state` in w).map((w) => [w[`${dp}.state`], w[`${dp}.cause`]]);

async function setup({ machine, mappings = [MES], active = () => true, archiveGroup = 'G_ETATS', prepare } = {}) {
  const wcc = fakeWcc();
  wcc.put('CN_01.State', 0);
  wcc.put('CN_01.Comm', true);
  wcc.put('WC.Ctx', 2);
  wcc.put('CN_01.Hs', false);
  wcc.put('WC.Cause', '');
  wcc.put('CN_01.Cause', '');
  wcc.put('MachineFleet3D_StopCauses.json', JSON.stringify([{ code: 'ANP01', classification: 'unplanned', isDefault: true }]));
  wcc.put('MachineFleet3D_StopCauses_ilot.json', JSON.stringify([{ code: 'AP01', classification: 'planned' }, { code: 'ANP04', classification: 'unplanned' }]));
  wcc.catalogs.push('MachineFleet3D_StopCauses', 'MachineFleet3D_StopCauses_ilot');
  const m = machine ?? { id: 'CN_01', name: 'Centre CN 01', stateDp: 'CN_01.State', stateMappingId: 'mes',
    inputDps: { comm: 'CN_01.Comm', of: 'WC.Ctx', hs: 'CN_01.Hs' }, stopCauseDp: 'WC.Cause', stopCauseDps: ['CN_01.Cause'], stopCatalogId: 'ilot' };
  prepare?.(wcc);
  wcc.put('MachineFleet3D_atelier.json', JSON.stringify({ id: 'atelier', mappings, machines: [m] }));
  wcc.ateliers.push('MachineFleet3D_atelier');
  const logs = [];
  let typeCreated = 0;
  const rec = new R.FleetStateRecorder({ wcc, active, archiveGroup, now: () => 1_000, log: (t) => logs.push(t), ensureType: async () => { typeCreated++; } });
  await rec.reload();
  await rec.queue;
  return { wcc, rec, logs, typeCreated: () => typeCreated };
}

describe('archive group', () => {
  // The NGA groups of the project the states were first tried on (13/11/2026): the first one found was the
  // alarm group, whose values cannot be read back (empty Gantt, TRS at 100 %).
  const PROJECT = [
    { name: 'System1:_NGA_G_ALERT', active: true, isAlert: true, priority: 2 },
    { name: 'System1:_NGA_G_ALERT_2', active: true, isAlert: true, priority: 2 },
    { name: 'System1:_NGA_G_ETATS', active: true, isAlert: false, priority: 6 },
    { name: 'System1:_NGA_G_EVENT', active: true, isAlert: false, priority: 1 },
    { name: 'System1:_NGA_G_EVENT_2', active: true, isAlert: false, priority: 1 },
    { name: 'System1:_NGA_G_EVENT_IX', active: false, isAlert: false, priority: 3 },
    { name: 'System1:_NGA_G_KPI', active: true, isAlert: false, priority: 7 }
  ];

  it('the standard value group when it is active, never the alarm group', () => {
    expect(R.pickArchiveGroup(PROJECT)).toBe('_NGA_G_EVENT');
  });

  it('otherwise the active value group of highest priority; none: not archived', () => {
    const noEvent = PROJECT.filter((g) => !/_NGA_G_EVENT$/.test(g.name));
    expect(R.pickArchiveGroup(noEvent)).toBe('_NGA_G_ETATS');
    expect(R.pickArchiveGroup(PROJECT.map((g) => (g.name.endsWith('_NGA_G_EVENT') ? { ...g, active: false } : g)))).toBe('_NGA_G_ETATS');
    expect(R.pickArchiveGroup(PROJECT.filter((g) => g.isAlert || !g.active || g.name.endsWith('_2')))).toBe('');
    expect(R.pickArchiveGroup([])).toBe('');
  });
});

describe('archive group named by the module settings (#374)', () => {
  const GROUPS = [
    { name: 'System1:_NGA_G_ALERT', active: true, isAlert: true },
    { name: 'System1:_NGA_G_ETATS', active: true, isAlert: false, priority: 6 },
    { name: 'System1:_NGA_G_EVENT', active: true, isAlert: false, priority: 1 },
    { name: 'System1:_NGA_G_OFF', active: false, isAlert: false }
  ];

  it('the group named when it is usable, otherwise the default one and the refusal said', () => {
    expect(R.chooseArchiveGroup(GROUPS, '_NGA_G_ETATS')).toEqual({ group: '_NGA_G_ETATS', refused: '' });
    expect(R.chooseArchiveGroup(GROUPS, 'System1:_NGA_G_ETATS')).toEqual({ group: '_NGA_G_ETATS', refused: '' });
    expect(R.chooseArchiveGroup(GROUPS, '')).toEqual({ group: '_NGA_G_EVENT', refused: '' });
    for (const bad of ['_NGA_G_ALERT', '_NGA_G_OFF', '_NGA_G_NONE']) expect(R.chooseArchiveGroup(GROUPS, bad)).toEqual({ group: '_NGA_G_EVENT', refused: bad });
  });

  it('a new group never moves a record already archived in a usable group: its history stays readable (#373)', async () => {
    // As on the project of 23/11/2026: states archived in _NGA_G_EVENT, the site's G4 group is _NGA_G_ETATS. NGA reads
    // an element in its current group only — moved, its history before the move was no longer read back.
    const { wcc, rec, logs } = await setup({ archiveGroup: '_NGA_G_EVENT' });
    rec.usableGroups = new Set(['_NGA_G_EVENT', '_NGA_G_ETATS']);
    const n = records(wcc).length;
    const archiveWrites = () => wcc.writes.filter((w) => Object.keys(w).some((k) => k.includes(':_archive'))).length;
    const before = archiveWrites();
    expect(rec.setArchiveGroup('_NGA_G_ETATS')).toBe(true);
    expect(rec.setArchiveGroup('_NGA_G_ETATS')).toBe(false);
    await rec.reload();
    await rec.queue;
    for (const el of R.ARCHIVED_ELEMENTS) expect(wcc.db[`${CN}.${el}:_archive.1._class`]).toBe('_NGA_G_EVENT');
    expect(archiveWrites()).toBe(before);
    expect(records(wcc).length).toBe(n);
    expect(logs.filter((l) => l.includes('gardés dans ce groupe')).length).toBe(1);
  });

  it('a record not archived yet goes to the new group', async () => {
    const { wcc, rec } = await setup({ archiveGroup: '_NGA_G_EVENT' });
    rec.usableGroups = new Set(['_NGA_G_EVENT', '_NGA_G_ETATS']);
    for (const el of R.ARCHIVED_ELEMENTS) wcc.db[`${CN}.${el}:_archive.._archive`] = false;
    rec.setArchiveGroup('_NGA_G_ETATS');
    await rec.reload();
    await rec.queue;
    for (const el of R.ARCHIVED_ELEMENTS) expect(wcc.db[`${CN}.${el}:_archive.1._class`]).toBe('_NGA_G_ETATS');
  });

  it('a brand-new record, whose archive attributes WinCC OA refuses to read, is archived in the group (#396)', async () => {
    // As on the project of 24/11/2026: every record created since read its whole archive config at once, the read was
    // refused (9399) and the record was never archived — no Gantt, no Pareto, no TRS on a site whose records are new.
    const fresh = fakeWcc();
    fresh.put('X.state', '');
    await expect(fresh.dpGet(['X.state:_archive.._type', 'X.state:_archive.1._class'])).rejects.toThrow('9399');
    expect(await fresh.dpGet(['X.state:_archive.._type'])).toEqual([0]);
    const { wcc, logs } = await setup({ archiveGroup: '_NGA_G_ETATS' });
    for (const el of R.ARCHIVED_ELEMENTS) {
      expect([wcc.db[`${CN}.${el}:_archive.._type`], wcc.db[`${CN}.${el}:_archive.1._type`]]).toEqual([45, 15]);
      expect([wcc.db[`${CN}.${el}:_archive.1._class`], wcc.db[`${CN}.${el}:_archive.._archive`]]).toEqual(['_NGA_G_ETATS', true]);
    }
    expect(logs.filter((l) => l.includes('archivage impossible'))).toEqual([]);
    expect(records(wcc).length).toBeGreaterThan(0);
  });

  it('keeps an active archive in the configured or a usable group, never in an alarm or unknown group', () => {
    const usable = new Set(['_NGA_G_EVENT', '_NGA_G_ETATS']);
    const on = (group) => ({ type: 45, on: true, group });
    expect(R.keepsArchive(on('System1:_NGA_G_EVENT'), usable, '_NGA_G_ETATS')).toBe(true);
    expect(R.keepsArchive(on('_NGA_G_ETATS'), usable, '_NGA_G_ETATS')).toBe(true);
    expect(R.keepsArchive(on('System1:_NGA_G_ALERT'), usable, '_NGA_G_ETATS')).toBe(false);
    expect(R.keepsArchive(on('_NGA_G_GONE'), usable, '_NGA_G_ETATS')).toBe(false);
    expect(R.keepsArchive({ type: 45, on: false, group: '_NGA_G_EVENT' }, usable, '_NGA_G_ETATS')).toBe(false);
    expect(R.keepsArchive({ type: 0, on: true, group: '_NGA_G_EVENT' }, usable, '_NGA_G_ETATS')).toBe(false);
    // Usable groups not known: only the configured group is kept.
    expect(R.keepsArchive(on('_NGA_G_EVENT'), new Set(), '_NGA_G_ETATS')).toBe(false);
    expect(R.keepsArchive(on('_NGA_G_ETATS'), new Set(), '_NGA_G_ETATS')).toBe(true);
    expect(R.usableGroupsOf([
      { name: 'System1:_NGA_G_EVENT', active: true, isAlert: false }, { name: '_NGA_G_EVENT_2', active: true, isAlert: false },
      { name: '_NGA_G_ALERT', active: true, isAlert: true }, { name: '_NGA_G_OFF', active: false, isAlert: false }
    ]).map((g) => g.name)).toEqual(['_NGA_G_EVENT']);
  });
});

describe('bindings through a reference (#376)', () => {
  const MOBILE = { id: 'CN_01', name: 'Centre CN 01', stateDp: 'CN_01.State', stateMappingId: 'mes', refDps: { wc: 'CN_01.Wc' },
    inputDps: { comm: 'CN_01.Comm', of: '{wc}.Ctx', hs: 'CN_01.Hs' }, stopCauseDp: '{wc}.Cause', stopCauseDps: ['CN_01.Cause'], stopCatalogId: 'ilot' };
  const prepare = (wcc) => {
    wcc.put('CN_01.Wc', 'System1:WC.');
    wcc.put('WC2.Ctx', 0);
    wcc.put('WC2.Cause', '');
  };

  it('same resolution as the live views', () => {
    const refs = { wc: 'CN_01.Wc' };
    for (const v of ['WC', 'System1:WC.', '', null, ['WC2']]) {
      for (const b of ['{wc}.Ctx', 'A.B', '{x}.C', '{wc}.{wc}']) {
        expect(E.resolveBinding(b, refs, () => v)).toBe(resolveBindingTs(b, refs, () => v));
      }
    }
  });

  it('records the state from the workcenter the machine is in now, and follows a reassignment', async () => {
    const { wcc, rec } = await setup({ machine: MOBILE, prepare });
    expect(records(wcc)).toEqual([['arret_non_planifie', '']]);
    // Moved to WC2, no work order there: non charge; WC2 opens one: its state again; WC no longer followed.
    wcc.set('CN_01.Wc', 'WC2');
    await rec.queue;
    expect(records(wcc).at(-1)).toEqual(['non_charge', '']);
    wcc.set('WC2.Ctx', 2);
    await rec.queue;
    expect(records(wcc).at(-1)).toEqual(['arret_non_planifie', '']);
    const n = records(wcc).length;
    wcc.set('WC.Ctx', 0);
    await rec.queue;
    expect(records(wcc).length).toBe(n);
    // The cause given in the workcenter it is in now.
    wcc.set('WC2.Cause', 'AP01');
    await rec.queue;
    expect(records(wcc).at(-1)).toEqual(['arret_planifie', 'AP01']);
  });
});

describe('stop causes sent to the controller (#375)', () => {
  const TARGETS = {
    slots: [{ code: 'CN_01.C1', label: 'CN_01.D1', class: 'CN_01.K1' }, { code: 'CN_01.C2', label: 'CN_01.D2', class: 'CN_01.K2' }],
    codeMax: 4, labelMax: 64, classValues: { planned: 2, unplanned: 3 }
  };
  const machine = { id: 'CN_01', name: 'Centre CN 01', stateDp: 'CN_01.State', stateMappingId: 'mes', commDp: 'CN_01.Comm',
    inputDps: { comm: 'CN_01.Comm', of: 'WC.Ctx', hs: 'CN_01.Hs' }, stopCatalogId: 'ilot', stopCauseTargets: TARGETS };
  const prepare = (wcc) => {
    for (const n of [1, 2]) { wcc.put(`CN_01.C${n}`, ''); wcc.put(`CN_01.D${n}`, ''); wcc.put(`CN_01.K${n}`, 0); }
  };
  const slots = (wcc) => [1, 2].map((n) => [wcc.db[`CN_01.C${n}`], wcc.db[`CN_01.K${n}`]]);

  it('the causes of the catalogue, in order, cut, by class value', () => {
    const w = P.causeWrites(P.targetsOf({ stopCauseTargets: TARGETS }), [
      { code: 'AP01', description: 'Repas', classification: 'planned' }, { code: 'X', classification: 'production' },
      { code: 'ANP04', description: 'Panne', classification: 'unplanned' }, { code: 'ANP05', classification: 'unplanned' }
    ]);
    expect([...w.values]).toEqual([['CN_01.C1', 'AP01'], ['CN_01.D1', 'Repas'], ['CN_01.K1', 2], ['CN_01.C2', 'ANP0'], ['CN_01.D2', 'Panne'], ['CN_01.K2', 3]]);
    expect([w.skipped, w.truncated, w.overflow]).toEqual([['X'], ['ANP04', 'ANP05'], 1]);
    expect(P.targetsOf({ stopCauseTargets: { slots: [{}] } })).toBeNull();
    expect([P.isUp(true), P.isUp(0), P.isUp(2), P.isUp(undefined), P.isUp('true')]).toEqual([true, false, true, undefined, true]);
  });

  it('written when they differ and the machine is connected, again when the controller lost them, never to an input-only address', async () => {
    const { wcc, rec } = await setup({ machine, prepare });
    expect(slots(wcc)).toEqual([['AP01', 2], ['ANP0', 3]]);
    // Communication lost: a new catalogue waits; back: sent at once.
    wcc.set('CN_01.Comm', false);
    await rec.queue;
    wcc.put('MachineFleet3D_StopCauses_ilot.json', JSON.stringify([{ code: 'AP09', classification: 'planned' }]));
    await rec.reload();
    await rec.queue;
    expect(slots(wcc)).toEqual([['AP01', 2], ['ANP0', 3]]);
    wcc.set('CN_01.Comm', true);
    await rec.queue;
    expect(slots(wcc)).toEqual([['AP09', 2], ['', 0]]);
    // The controller lost them (restart): written again at the next reading; nothing when they are right.
    wcc.db['CN_01.C1'] = '';
    await rec.reload();
    await rec.queue;
    expect(slots(wcc)[0]).toEqual(['AP09', 2]);
    const before = wcc.writes.filter((w) => 'CN_01.C1' in w).length;
    await rec.reload();
    await rec.queue;
    expect(wcc.writes.filter((w) => 'CN_01.C1' in w).length).toBe(before);
    // An input-only address is never written.
    wcc.db['CN_01.C1'] = 'XX';
    wcc.db['CN_01.C1:_address.._direction'] = 4;
    await rec.reload();
    await rec.queue;
    expect(wcc.db['CN_01.C1']).toBe('XX');
  });
});

describe('recording the states', () => {
  it('records the state its mapping gives and the cause, creates the datapoint and archives it once', async () => {
    const { wcc, rec, typeCreated } = await setup();
    expect(records(wcc)).toEqual([['arret_non_planifie', '']]);
    expect(typeCreated()).toBe(1);
    expect(wcc.db[`${CN}.machineName`]).toBe('Centre CN 01');
    expect(wcc.db[`${CN}.atelier`]).toBe('atelier');
    expect(wcc.db[`${CN}.updatedAt`]).toBe(new Date(1_000).toISOString());
    expect([wcc.db[`${CN}.state:_archive.1._class`], wcc.db[`${CN}.cause:_archive.._archive`]]).toEqual(['G_ETATS', true]);
    // Production, then a stop whose planned cause comes from the second source (the machine's).
    wcc.set('CN_01.State', 1);
    await rec.queue;
    wcc.set('CN_01.State', 0);
    await rec.queue;
    wcc.set('CN_01.Cause', 'AP01');
    await rec.queue;
    expect(records(wcc).slice(1)).toEqual([['production', ''], ['arret_non_planifie', ''], ['arret_planifie', 'AP01']]);
    // Two changes at once: the state they give together, recorded once.
    wcc.set('CN_01.State', 1);
    wcc.set('CN_01.Cause', '');
    await rec.queue;
    wcc.set('CN_01.State', 0);
    wcc.set('CN_01.Cause', 'AP01');
    await rec.queue;
    expect(records(wcc).slice(-2)).toEqual([['production', ''], ['arret_planifie', 'AP01']]);
    // The workcenter's cause comes first; an unplanned one of the machine's catalogue.
    wcc.set('WC.Cause', 'ANP04');
    await rec.queue;
    expect(records(wcc).at(-1)).toEqual(['arret_non_planifie', 'ANP04']);
    // The same values again: nothing written; the archive config not set again.
    const n = wcc.writes.length;
    wcc.set('WC.Cause', 'ANP04');
    wcc.set('CN_01.State', 0);
    await rec.queue;
    expect(wcc.writes.length).toBe(n);
    expect(wcc.writes.filter((w) => `${CN}.state:_archive.1._class` in w).length).toBe(1);
    // No work order in progress, communication lost: the mapping's order.
    wcc.set('WC.Ctx', 0);
    await rec.queue;
    wcc.set('CN_01.Comm', false);
    await rec.queue;
    expect(records(wcc).slice(-2)).toEqual([['non_charge', 'ANP04'], ['arret_non_planifie', 'ANP04']]);
  });

  it('starts from what is already recorded: a restart does not record the same state again', async () => {
    const first = await setup();
    const again = new R.FleetStateRecorder({ wcc: first.wcc, archiveGroup: 'G_ETATS', log: () => {} });
    const n = first.wcc.writes.filter((w) => `${CN}.state` in w).length;
    const archiveWrites = first.wcc.writes.filter((w) => Object.keys(w).some((k) => k.includes(':_archive'))).length;
    await again.reload();
    await again.queue;
    expect(first.wcc.writes.filter((w) => `${CN}.state` in w).length).toBe(n);
    // Already archived in the group: the archive config is left as it is.
    expect(first.wcc.writes.filter((w) => Object.keys(w).some((k) => k.includes(':_archive'))).length).toBe(archiveWrites);
  });

  it('a datapoint archived in another group (the alarm group) is moved to the group, its archiving off meanwhile', async () => {
    const first = await setup({ archiveGroup: 'G_ALERT' });
    for (const el of R.ARCHIVED_ELEMENTS) expect(first.wcc.db[`${CN}.${el}:_archive.1._class`]).toBe('G_ALERT');
    // As WinCC OA answers: the group with the system name.
    for (const el of R.ARCHIVED_ELEMENTS) first.wcc.db[`${CN}.${el}:_archive.1._class`] = 'System1:G_ALERT';
    const from = first.wcc.writes.length;
    const again = new R.FleetStateRecorder({ wcc: first.wcc, archiveGroup: 'G_ETATS', usableGroups: ['G_ETATS'], log: () => {} });
    await again.reload();
    await again.queue;
    for (const el of R.ARCHIVED_ELEMENTS) {
      const dpe = `${CN}.${el}`;
      const mine = first.wcc.writes.slice(from).filter((w) => Object.keys(w).some((k) => k.startsWith(`${dpe}:_archive`)));
      expect(mine.map((w) => Object.entries(w)[0])).toEqual([
        [`${dpe}:_archive.._archive`, false], [`${dpe}:_archive.._type`, 45], [`${dpe}:_archive.1._type`, 15],
        [`${dpe}:_archive.1._class`, 'G_ETATS'], [`${dpe}:_archive.._archive`, true]
      ]);
    }
    // The state in progress written again (unchanged), so that the group's history starts with it; once.
    const rewritten = first.wcc.writes.slice(from).filter((w) => `${CN}.state` in w);
    expect(rewritten.map((w) => [w[`${CN}.state`], w[`${CN}.cause`]])).toEqual([['arret_non_planifie', '']]);
    first.wcc.set('CN_01.State', 0);
    await again.queue;
    expect(first.wcc.writes.slice(from).filter((w) => `${CN}.state` in w)).toHaveLength(1);
  });

  it('a passive server records nothing', async () => {
    let active = false;
    const { wcc, rec } = await setup({ active: () => active });
    expect(records(wcc)).toEqual([]);
    wcc.set('CN_01.State', 1);
    await rec.queue;
    expect(records(wcc)).toEqual([]);
    active = true;
    wcc.set('CN_01.State', 1);
    await rec.queue;
    expect(records(wcc)).toEqual([['production', '']]);
  });

  it('a single-input symbol is recorded through its mapping; without archive group, not archived', async () => {
    const { wcc } = await setup({ machine: { id: 'CN_01', name: 'CN', stateDp: 'CN_01.State', stateMappingId: 'default' }, mappings: [SIMPLE], archiveGroup: '' });
    expect(records(wcc)).toEqual([['stop', '']]);
    expect(`${CN}.state:_archive.1._class` in wcc.db).toBe(false);
  });

  it('a datapoint that does not exist is left out (and noted once), the others followed', async () => {
    const { wcc, rec, logs } = await setup({ machine: { id: 'CN_01', name: 'CN', stateDp: 'CN_01.State', stateMappingId: 'mes', inputDps: { comm: 'ABSENT.Comm', of: 'WC.Ctx' } } });
    expect(logs.filter((l) => /ABSENT\.Comm introuvable/.test(l))).toHaveLength(1);
    expect(records(wcc)).toEqual([['arret_non_planifie', '']]);
    wcc.set('CN_01.State', 1);
    await rec.queue;
    expect(records(wcc).at(-1)).toEqual(['production', '']);
    await rec.reload();
    expect(logs.filter((l) => /ABSENT\.Comm introuvable/.test(l))).toHaveLength(1);
  });

  it('mapping changed in the atelier: computed again; binding changed: followed anew; symbol removed: let go', async () => {
    const { wcc, rec } = await setup();
    // The atelier now maps value 0 to production (another mapping chosen): recorded at the next reload.
    const flipped = { ...MES, id: 'mes', rules: [{ state: 'production', min: 0, max: 0 }], fallback: 'arret_non_planifie' };
    wcc.db['MachineFleet3D_atelier.json'] = JSON.stringify({ id: 'atelier', mappings: [flipped], machines: [JSON.parse(wcc.db['MachineFleet3D_atelier.json']).machines[0]] });
    await rec.reload();
    await rec.queue;
    expect(records(wcc).at(-1)).toEqual(['production', '']);
    expect(wcc.conns.size).toBe(1);
    // The state now read elsewhere: the old subscription closed, the new datapoint followed.
    wcc.put('CN_02.State', 7);
    const m = { id: 'CN_01', name: 'CN', stateDp: 'CN_02.State', stateMappingId: 'mes' };
    wcc.db['MachineFleet3D_atelier.json'] = JSON.stringify({ id: 'atelier', mappings: [flipped], machines: [m] });
    await rec.reload();
    await rec.queue;
    expect([...wcc.conns.values()].map((c) => c.dpes)).toEqual([['CN_02.State']]);
    expect(records(wcc).at(-1)).toEqual(['arret_non_planifie', '']);
    // Symbol removed: no subscription left; its datapoint (its history) stays.
    wcc.db['MachineFleet3D_atelier.json'] = JSON.stringify({ id: 'atelier', mappings: [], machines: [] });
    await rec.reload();
    expect(wcc.conns.size).toBe(0);
    expect(wcc.dps.has(CN)).toBe(true);
  });

  it('a saved atelier or catalogue reloads (watch, debounced)', async () => {
    const { wcc, rec } = await setup();
    rec.watch(5);
    const watcher = [...wcc.conns.values()].find((c) => c.dpes.includes('MachineFleet3D_atelier.json'));
    expect(watcher.dpes).toEqual(['MachineFleet3D_atelier.json', 'MachineFleet3D_StopCauses.json', 'MachineFleet3D_StopCauses_ilot.json']);
    const m = { id: 'CN_09', name: 'Nouveau', stateDp: 'CN_01.State', stateMappingId: 'default' };
    wcc.db['MachineFleet3D_atelier.json'] = JSON.stringify({ id: 'atelier', mappings: [SIMPLE], machines: [m] });
    wcc.set('MachineFleet3D_atelier.json', wcc.db['MachineFleet3D_atelier.json']);
    await new Promise((r) => setTimeout(r, 30));
    await rec.queue;
    expect(records(wcc, 'MachineFleet3D_State_CN_09')).toEqual([['stop', '']]);
  });

  it('a declared state: its datapoint created first, followed, tested by the rules, archived', async () => {
    const DECL = {
      id: 'decl', name: 'Déclaré', fallback: 'stop', inputs: [],
      rules: [{ state: 'maint', when: [{ input: 'declared', equals: 'maint' }] }, { state: 'ok', min: 1, max: 1 }]
    };
    const { wcc, rec } = await setup({ machine: { id: 'CN_01', name: 'CN', stateDp: 'CN_01.State', stateMappingId: 'decl', declaredState: true }, mappings: [DECL] });
    expect(wcc.dps.has(CN)).toBe(true);
    expect([...wcc.conns.values()][0].dpes).toEqual(['CN_01.State', `${CN}.declared`]);
    expect(records(wcc)).toEqual([['stop', '']]);
    wcc.set(`${CN}.declared`, 'maint');
    await rec.queue;
    expect(records(wcc).at(-1)).toEqual(['maint', '']);
    wcc.set(`${CN}.declared`, '');
    wcc.set('CN_01.State', 1);
    await rec.queue;
    expect(records(wcc).at(-1)).toEqual(['ok', '']);
    expect(wcc.db[`${CN}.declared:_archive.1._class`]).toBe('G_ETATS');
  });
});

describe('stop causes sent as the 2.2.0 supervision did (winccoa-fra-msp-stma#373, #375)', () => {
  // A real machine of a project in 2.2.0 (23/11/2026): the slots the site's 2.2.1 export declares, the causes of its
  // catalogue, and the 48 values the former manager organisation_sync wrote to it (and the machine had).
  const fixture = require('./fixtures/causes-2-2-0.json');

  it('writes exactly the values the former manager wrote, in the same slots', () => {
    expect(fixture.machines.length).toBeGreaterThan(0);
    for (const m of fixture.machines) {
      const w = P.causeWrites(m.targets, m.causes);
      expect(Object.fromEntries(w.values), m.id).toEqual(m.expected);
      expect(w.values.size, m.id).toBe(Object.keys(m.expected).length);
    }
  });
});
