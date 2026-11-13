// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

/**
 * Machine Fleet's state recorder (winccoa-fra-msp-stma#339). For every symbol of every atelier that binds at
 * least one input of its mapping, it follows the inputs and the stop-cause datapoints (dpConnect), computes the
 * state through the mapping (state-eval.js, the same as the live views) and records the state and the cause
 * in a datapoint of its own, `MachineFleet3D_State_<symbol>` (`state`, `cause`, archived): the history the
 * Gantt, the stop list, the Pareto and the TRS read. Only a change is written, so the archive holds one value
 * per change. A symbol in several ateliers (a machine of the site) is recorded once, from the first atelier.
 *
 * The live views never wait for it: they compute the state themselves from the same inputs. Nothing here knows
 * what an input means. The WinCC OA API is injected (index.js), so the recorder runs on a fake one in the tests.
 */

const E = require('./state-eval.js');

const CONFIG_TYPE = 'MachineFleet3D_Config';
const STOPCAUSE_TYPE = 'MachineFleet3D_StopCauses';
const STOPCAUSE_DP = 'MachineFleet3D_StopCauses';
const STATE_TYPE = 'MachineFleet3D_State';
const STATE_PREFIX = 'MachineFleet3D_State_';
/**
 * Elements of a state datapoint: `state` and `cause` recorded here, `declared` the state an operator declares
 * (input `declared` of the mapping, written from the machine dashboard); the three archived.
 */
const STATE_ELEMENTS = ['state', 'cause', 'machineName', 'atelier', 'updatedAt', 'declared'];
/** Elements a record writes, in this order (the declared state is the operator's, never written here). */
const RECORD_ELEMENTS = ['state', 'cause', 'machineName', 'atelier', 'updatedAt'];
const ARCHIVED_ELEMENTS = ['state', 'cause', 'declared'];
/** WinCC OA NGA archive config (as kpiCalc). */
const ARCHIVE_INFO = 45;
const ARCH_PROC_VALARCH = 15;
/** WinCC OA's standard NGA group for values, taken first when it is active. */
const STANDARD_VALUE_GROUP = '_NGA_G_EVENT';

/**
 * NGA group the states are archived in, among the project's groups `{ name, active, isAlert, priority }`: the
 * standard value group when it is active, otherwise the active value group of highest priority (lowest
 * `groupPriority`). Never an alarm group (`isAlert`: values archived there cannot be read back), an inactive
 * group, nor a redundant server's copy (`…_2`). '' when there is none: the states are then not archived.
 */
function pickArchiveGroup(groups) {
  const usable = (groups || [])
    .map((g) => ({ ...g, name: bare(g.name) }))
    .filter((g) => g.name && !g.name.endsWith('_2') && g.active === true && g.isAlert !== true);
  if (usable.some((g) => g.name === STANDARD_VALUE_GROUP)) return STANDARD_VALUE_GROUP;
  usable.sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || a.name.localeCompare(b.name));
  return usable.length ? usable[0].name : '';
}

/**
 * Mapping of a symbol whose atelier has none — wui-fleet-core `DEFAULT_STATE_MAPPINGS[0]`, as the views take it
 * (test/fleet-state.spec.mjs checks they are the same).
 */
const DEFAULT_MAPPING = {
  id: 'default',
  name: 'Standard (0=arrêt, 1=ok, 2=défaut, 3=maint)',
  fallback: 'stop',
  rules: [
    { state: 'stop', min: 0, max: 0 },
    { state: 'ok', min: 1, max: 1 },
    { state: 'warn', min: 2, max: 2 },
    { state: 'maint', min: 3, max: 3 }
  ]
};

/** Datapoint name of a symbol's recorded state (wui-fleet-core state-eval.ts `stateRecordDp`). */
function stateDpName(id) {
  return E.stateRecordDp(id);
}

/** A datapoint (element) name without system name nor trailing dot, to match dpConnect answers. */
function bare(name) {
  const s = String(name).replace(/^[^:]*:/, '');
  const cfg = s.indexOf(':');
  return (cfg === -1 ? s : s.slice(0, cfg)).replace(/\.$/, '');
}

function text(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

/** Catalogue id of a stop-cause catalogue datapoint: 'default' for the default one, '' for another datapoint. */
function catalogIdOfDp(name) {
  const dp = bare(name);
  if (dp === STOPCAUSE_DP) return 'default';
  return dp.startsWith(`${STOPCAUSE_DP}_`) ? dp.slice(STOPCAUSE_DP.length + 1) : '';
}

/**
 * The symbols to record, from the ateliers read ({ dp, atelier }[], sorted by datapoint): one per symbol id,
 * the first atelier's; a symbol binding no input is left out. Its mapping: the one it names, else the
 * atelier's first one, else the default one (as the views). `duplicates`: ids met again in another atelier.
 */
function planMachines(ateliers) {
  const out = new Map();
  const duplicates = [];
  for (const { dp, atelier } of ateliers) {
    if (!atelier || typeof atelier !== 'object') continue;
    const mappings = Array.isArray(atelier.mappings) ? atelier.mappings : [];
    const atelierId = String(atelier.id || bare(dp).replace(/^MachineFleet3D_/, ''));
    for (const m of Array.isArray(atelier.machines) ? atelier.machines : []) {
      if (!m || !m.id) continue;
      const inputs = E.inputDpsOf(m);
      if (Object.keys(inputs).length === 0) continue;
      if (out.has(m.id)) {
        duplicates.push({ id: m.id, atelier: atelierId });
        continue;
      }
      out.set(m.id, {
        id: String(m.id),
        name: String(m.name || m.id),
        atelier: atelierId,
        mapping: mappings.find((mp) => mp && mp.id === m.stateMappingId) || mappings[0] || DEFAULT_MAPPING,
        inputs,
        causes: E.causeDpsOf(m),
        catalogId: m.stopCatalogId ? String(m.stopCatalogId) : 'default'
      });
    }
  }
  return { machines: out, duplicates };
}

/** What a planned symbol depends on: a change of it means new subscriptions. */
function signature(entry) {
  return JSON.stringify([entry.inputs, entry.causes]);
}

/** The state and the cause to record for a symbol, from the values read (by bare DPE name) and its causes' classes. */
function recordOf(entry, cache, catalogs) {
  const values = {};
  for (const [key, dpe] of Object.entries(entry.inputs)) if (cache.has(dpe)) values[key] = cache.get(dpe);
  const cause = E.currentCause(entry.causes.map((dpe) => cache.get(dpe)));
  const causes = catalogs[entry.catalogId] || catalogs.default || [];
  return { state: String(E.evaluateState(entry.mapping, values, E.causeClassOf(cause, causes))), cause };
}

class FleetStateRecorder {
  /**
   * @param o.wcc     WinCC OA API (dpNames, dpGet, dpSetWait, dpConnect, dpDisconnect, dpExists, dpCreate)
   * @param o.ensureType  () => Promise : creates the MachineFleet3D_State type if needed
   * @param o.active  () => boolean : active server (redundancy); a passive one writes nothing
   * @param o.now     clock (tests)
   * @param o.log     (text) => void
   * @param o.archiveGroup  NGA group the states are archived in ('' : not archived)
   */
  constructor(o) {
    this.wcc = o.wcc;
    this.ensureType = o.ensureType || (async () => {});
    this.active = o.active || (() => true);
    this.now = o.now || (() => Date.now());
    this.log = o.log || (() => {});
    this.archiveGroup = o.archiveGroup || '';
    /** id → planned symbol, with its subscription and its last record. */
    this.entries = new Map();
    /** bare DPE → last value read. */
    this.cache = new Map();
    /** catalogue id → causes. */
    this.catalogs = { default: [] };
    /** DP name → { state, cause } last written (or read at start). */
    this.written = new Map();
    this.archived = new Set();
    /** DP names whose archiving was just set: their record written again, so that the group starts with it. */
    this.fresh = new Set();
    /** DP name → its creation under way (one dpCreate, whoever asks first). */
    this.creating = new Map();
    this.watchIds = [];
    this.noted = new Set();
    this.queue = Promise.resolve();
  }

  /** Every write and read of the records, one after the other. */
  serial(fn) {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(() => null, () => null);
    return next;
  }

  noteOnce(key, msg) {
    if (this.noted.has(key)) return;
    this.noted.add(key);
    this.log(msg);
  }

  async readAteliers() {
    let names = [];
    try { names = (this.wcc.dpNames('*', CONFIG_TYPE) || []).map(bare).sort(); } catch (e) { this.log(`Ateliers illisibles : ${e.message || e}`); }
    const out = [];
    for (const dp of names) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const raw = await this.wcc.dpGet(`${dp}.json`);
        out.push({ dp, atelier: JSON.parse(text(raw)) });
      } catch {
        this.noteOnce(`atelier:${dp}`, `Atelier ${dp} illisible : ignoré.`);
      }
    }
    return out;
  }

  async readCatalogs() {
    let names = [];
    try { names = (this.wcc.dpNames(`${STOPCAUSE_DP}*`, STOPCAUSE_TYPE) || []).map(bare); } catch { names = []; }
    const out = { default: [] };
    for (const dp of names) {
      const id = catalogIdOfDp(dp);
      if (!id) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        const list = JSON.parse(text(await this.wcc.dpGet(`${dp}.json`)));
        out[id] = Array.isArray(list) ? list : [];
      } catch {
        out[id] = [];
      }
    }
    return out;
  }

  /**
   * Reads the ateliers and the catalogues again: new symbols followed, removed ones let go, changed bindings
   * followed anew, every state computed again (a mapping or a catalogue may have changed).
   */
  async reload() {
    const [ateliers, catalogs] = [await this.readAteliers(), await this.readCatalogs()];
    this.catalogs = catalogs;
    const { machines, duplicates } = planMachines(ateliers);
    for (const d of duplicates) this.noteOnce(`dup:${d.id}:${d.atelier}`, `Symbole ${d.id} aussi dans l'atelier ${d.atelier} : enregistré une seule fois, depuis le premier atelier.`);
    for (const [id, old] of this.entries) {
      if (machines.has(id) && signature(machines.get(id)) === signature(old)) continue;
      this.disconnect(old);
      this.entries.delete(id);
    }
    for (const [id, entry] of machines) {
      const old = this.entries.get(id);
      if (old) {
        // Same subscriptions: mapping, name, atelier and catalogue taken as they are now.
        Object.assign(old, { name: entry.name, atelier: entry.atelier, mapping: entry.mapping, catalogId: entry.catalogId });
      } else {
        this.entries.set(id, entry);
        // Its datapoint first (active server): a declared state is one of its elements, to be followed.
        if (this.active()) await this.ensureDp(stateDpName(id));
        this.connect(entry);
      }
    }
    await Promise.all([...this.entries.values()].map((e) => this.record(e)));
    return { machines: this.entries.size, duplicates: duplicates.length };
  }

  /** Follows a symbol's inputs and causes; a datapoint that does not exist is left out (dpConnect fails as a block). */
  connect(entry) {
    const all = [...new Set([...Object.values(entry.inputs), ...entry.causes])];
    const ok = all.filter((dpe) => {
      let exists = false;
      try { exists = !!this.wcc.dpExists(dpe); } catch { exists = false; }
      if (!exists) this.noteOnce(`missing:${entry.id}:${dpe}`, `Symbole ${entry.id} : datapoint ${dpe} introuvable, ignoré.`);
      return exists;
    });
    entry.connId = null;
    if (ok.length === 0) return;
    try {
      entry.connId = this.wcc.dpConnect((names, values) => this.onValues(entry.id, names, values), ok, true);
    } catch (e) {
      this.log(`Symbole ${entry.id} : abonnement impossible (${e.message || e}).`);
    }
  }

  disconnect(entry) {
    if (entry.connId == null) return;
    try { this.wcc.dpDisconnect(entry.connId); } catch { /* déjà fermé */ }
    entry.connId = null;
  }

  onValues(id, names, values) {
    const list = Array.isArray(names) ? names : [names];
    const vals = Array.isArray(names) ? values : [values];
    list.forEach((n, i) => this.cache.set(bare(n), vals[i]));
    const entry = this.entries.get(id);
    if (entry) void this.record(entry);
  }

  /** The symbol's state and cause recorded if they changed (active server only). */
  record(entry) {
    return this.serial(async () => {
      if (!this.active()) return false;
      if (!Object.values(entry.inputs).some((dpe) => this.cache.has(dpe))) return false;
      const rec = recordOf(entry, this.cache, this.catalogs);
      const dp = stateDpName(entry.id);
      if (!(await this.ensureDp(dp))) return false;
      let last = this.written.get(dp);
      if (!last) {
        try {
          const [s, c] = await this.wcc.dpGet([`${dp}.state`, `${dp}.cause`]);
          last = { state: text(s), cause: text(c) };
        } catch { last = { state: '', cause: '' }; }
        this.written.set(dp, last);
      }
      if (!this.fresh.has(dp) && last.state === rec.state && last.cause === rec.cause) return false;
      try {
        await this.wcc.dpSetWait(RECORD_ELEMENTS.map((el) => `${dp}.${el}`), [rec.state, rec.cause, entry.name, entry.atelier, new Date(this.now()).toISOString()]);
        this.written.set(dp, rec);
        this.fresh.delete(dp);
        return true;
      } catch (e) {
        this.log(`${dp} : écriture impossible (${e.message || e}).`);
        return false;
      }
    });
  }

  /**
   * The symbol's state datapoint, created (once, whoever asks first), and its archiving checked once per run:
   * left as it is when already archived in the group, otherwise (new datapoint, other group) set again, the
   * archiving switched off while the group changes when it was on, and the record written again even if it
   * has not changed, so that the history read from the group starts with the state in progress.
   */
  async ensureDp(dp) {
    if (!this.creating.has(dp)) {
      this.creating.set(dp, (async () => {
        if (this.wcc.dpExists(dp)) return true;
        await this.ensureType();
        await this.wcc.dpCreate(dp, STATE_TYPE);
        return true;
      })().catch((e) => {
        this.creating.delete(dp);
        this.noteOnce(`create:${dp}`, `${dp} : création impossible (${e.message || e}).`);
        return false;
      }));
    }
    if (!(await this.creating.get(dp))) return false;
    if (this.archiveGroup && !this.archived.has(dp)) {
      try {
        // One attribute after the other, the config type first (as kpiCalc).
        for (const el of ARCHIVED_ELEMENTS) {
          const dpe = `${dp}.${el}`;
          /* eslint-disable no-await-in-loop */
          const [type, on, group] = await this.wcc.dpGet([`${dpe}:_archive.._type`, `${dpe}:_archive.._archive`, `${dpe}:_archive.1._class`]);
          if (Number(type) === ARCHIVE_INFO && on === true && group != null && bare(group) === this.archiveGroup) continue;
          if (el === 'state') this.fresh.add(dp);
          if (on === true) await this.wcc.dpSetWait(`${dpe}:_archive.._archive`, false);
          await this.wcc.dpSetWait(`${dpe}:_archive.._type`, ARCHIVE_INFO);
          await this.wcc.dpSetWait(`${dpe}:_archive.1._type`, ARCH_PROC_VALARCH);
          await this.wcc.dpSetWait(`${dpe}:_archive.1._class`, this.archiveGroup);
          await this.wcc.dpSetWait(`${dpe}:_archive.._archive`, true);
          /* eslint-enable no-await-in-loop */
        }
        this.archived.add(dp);
      } catch (e) {
        this.noteOnce(`archive:${dp}`, `${dp} : archivage impossible (${e.message || e}).`);
      }
    }
    return true;
  }

  /** Reload when an atelier or a catalogue is saved (debounced), on top of the periodic reload. */
  watch(debounceMs = 500) {
    for (const id of this.watchIds) { try { this.wcc.dpDisconnect(id); } catch { /* fermé */ } }
    this.watchIds = [];
    let timer = null;
    const kick = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void this.reload().catch((e) => this.log(`Relecture : ${e.message || e}`)); }, debounceMs);
    };
    const dps = [];
    try { dps.push(...(this.wcc.dpNames('*', CONFIG_TYPE) || []).map((n) => `${bare(n)}.json`)); } catch { /* aucun atelier */ }
    try { dps.push(...(this.wcc.dpNames(`${STOPCAUSE_DP}*`, STOPCAUSE_TYPE) || []).map((n) => `${bare(n)}.json`)); } catch { /* aucun référentiel */ }
    if (dps.length === 0) return;
    try { this.watchIds.push(this.wcc.dpConnect(() => kick(), dps, false)); } catch (e) { this.log(`Suivi des ateliers impossible : ${e.message || e}`); }
  }
}

module.exports = { RECORD_ELEMENTS, DEFAULT_MAPPING, FleetStateRecorder, planMachines, recordOf, stateDpName, catalogIdOfDp, bare, pickArchiveGroup, STANDARD_VALUE_GROUP, CONFIG_TYPE, STATE_TYPE, STATE_PREFIX, STATE_ELEMENTS, ARCHIVED_ELEMENTS };
