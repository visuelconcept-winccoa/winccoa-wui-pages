// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

/**
 * Machine Fleet — state recorder (WinCC OA JavaScript Manager), winccoa-fra-msp-stma#339.
 *
 * Records, for every symbol of every atelier, the state its mapping gives and the stop cause in progress, in
 * `MachineFleet3D_State_<symbol>` (`state`, `cause`, archived in the standard NGA value group): the history the
 * Gantt, the stop list, the Pareto and the TRS read, so that Machine Fleet needs no archived state datapoint of
 * its own elsewhere. The live views do not depend on it. Details: recorder.js.
 *
 * Reads the ateliers and the stop-cause catalogues again when one is saved, and every minute (a new atelier).
 * In a redundant project, only the active server writes; becoming active, it reads the records again.
 *
 * Register in config/progs (wui build does):  node | always | 30 | 2 | 2 |fleetState/index.js
 */
const { WinccoaManager, WinccoaDpTypeNode } = require('winccoa-manager');
const { FleetStateRecorder, STATE_TYPE, STATE_ELEMENTS, bare, pickArchiveGroup } = require('./recorder.js');

const winccoa = new WinccoaManager();
const ELEM = { Struct: 1, String: 25 };
const RELOAD_MS = 60_000;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[fleetState] ${msg}`);
}

/** Active server, or not redundant (an unavailable API counts as active, not to block). */
function isActive() {
  try {
    if (!winccoa.isRedundant()) return true;
    return winccoa.isReduActive();
  } catch {
    return true;
  }
}

let typeReady = false;
async function ensureType() {
  if (typeReady) return;
  const root = new WinccoaDpTypeNode(STATE_TYPE, ELEM.Struct, '', STATE_ELEMENTS.map((el) => new WinccoaDpTypeNode(el, ELEM.String)));
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${STATE_TYPE}`);
  } catch {
    // already exists
  }
  typeReady = true;
}

/**
 * NGA group the states are archived in (recorder.js `pickArchiveGroup`: the standard value group, otherwise
 * an active value group, never the alarm group), '' when there is none: the states are then not archived.
 */
async function findArchiveGroup() {
  const groups = [];
  try {
    for (const n of winccoa.dpNames('*', '_NGA_Group') || []) {
      const name = bare(n);
      try {
        // eslint-disable-next-line no-await-in-loop
        const [active, isAlert, priority] = await winccoa.dpGet([`${name}.active`, `${name}.isAlert`, `${name}.groupPriority`]);
        groups.push({ name, active, isAlert, priority });
      } catch {
        // unreadable group: left out
      }
    }
  } catch (e) {
    log(`Groupes d'archive introuvables : ${e}`);
  }
  return pickArchiveGroup(groups);
}

async function main() {
  log('Démarrage de l’enregistrement des états…');
  await ensureType();
  const archiveGroup = await findArchiveGroup();
  log(`Groupe d'archive : ${archiveGroup || '(aucun — états non archivés)'}`);
  const recorder = new FleetStateRecorder({ wcc: winccoa, ensureType, active: isActive, log, archiveGroup });
  let wasActive = isActive();
  const reload = async () => {
    const r = await recorder.reload();
    recorder.watch();
    return r;
  };
  const r = await reload();
  log(`${r.machines} symbole(s) suivi(s)${wasActive ? '' : ' (serveur passif : rien n’est écrit)'}.`);
  setInterval(() => {
    const active = isActive();
    // Becoming active: the other server may have written; read the records again.
    if (active && !wasActive) recorder.written.clear();
    wasActive = active;
    void reload().catch((e) => log(`Relecture : ${e.message || e}`));
  }, RELOAD_MS);
}

main().catch((e) => log(`Erreur fatale : ${e.stack || e}`));
