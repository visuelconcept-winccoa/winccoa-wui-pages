// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * The mission book and the command channel — the manager's contract with the
 * page's "Missions" tab.
 *
 * The per-vehicle `AGV_Vehicle.mission` element only carries a one-line summary.
 * The board needs the whole order: its kind, its legs, which leg is running and
 * what is left. Rather than widen the vehicle datapoint, the manager publishes
 * the full book as JSON on a single `AGV_Missions.json` datapoint, and consumes
 * operator actions from `AGV_Command.json`.
 *
 * Command envelope (the page appends, the manager drains and clears):
 *   { "commands": [ { "action": "cancel", "vehicle": "AGV_03" }, ... ] }
 *
 * Actions: cancel | charge | park | dispatch (kind?) | recover | fault
 */
const missions = require('./missions.js');
const motion = require('./motion.js');

const ACTIONS = ['cancel', 'charge', 'park', 'dispatch', 'recover', 'fault'];
/** Fault text applied by the `fault` action (operator-injected, for the demo). */
const INJECTED_FAULT = 'E-501 Stopped by operator';

/** One board row per vehicle — including the ones with no active mission. */
function serialize(sims) {
  return {
    missions: sims.map((sim) => {
      const mission = sim.mission;
      const legs = mission
        ? mission.legs.map((leg, index) => ({
            label: leg.label,
            action: leg.action,
            done: index < mission.legIndex,
            active: index === mission.legIndex
          }))
        : [];
      return {
        vehicle: sim.id,
        vehicleName: sim.name,
        state: sim.state,
        parked: Boolean(sim.parked),
        battery: Math.round(sim.battery * 10) / 10,
        zone: sim.zone,
        id: mission ? mission.id : '',
        kind: mission ? mission.kind : '',
        load: mission ? mission.load : '',
        legIndex: mission ? mission.legIndex : 0,
        legCount: legs.length,
        legs,
        remainingM: Math.round(motion.remainingDistance(sim.motion) * 10) / 10
      };
    })
  };
}

/**
 * Apply one operator command. `deps.log` reports what happened; unknown actions
 * and unknown vehicles are ignored (the channel is untrusted input).
 */
function applyCommand(sims, command, deps) {
  if (!command || typeof command !== 'object') return false;
  const action = String(command.action || '');
  if (!ACTIONS.includes(action)) {
    deps.log(`commande ignorée : action inconnue "${action}"`);
    return false;
  }
  const sim = sims.find((s) => s.id === command.vehicle);
  if (!sim) {
    deps.log(`commande ignorée : véhicule inconnu "${command.vehicle}"`);
    return false;
  }

  if (action === 'cancel') {
    missions.releaseAll(sim.id);
    sim.mission = null;
    sim.state = 'idle';
    sim.speed = 0;
    sim.payload = '';
    deps.log(`${sim.id} : mission annulée par l'opérateur`);
    return true;
  }

  if (action === 'recover') {
    sim.parked = false;
    sim.errorText = '';
    sim.state = 'idle';
    deps.log(`${sim.id} : remis en service`);
    return true;
  }

  if (action === 'fault') {
    missions.releaseAll(sim.id);
    sim.mission = null;
    sim.parked = true;
    sim.state = 'error';
    sim.speed = 0;
    sim.errorText = INJECTED_FAULT;
    deps.log(`${sim.id} : mis en défaut par l'opérateur`);
    return true;
  }

  // The remaining actions all assign a new mission, so clear the old one first.
  if (sim.parked) {
    deps.log(`${sim.id} : hors service, commande "${action}" refusée`);
    return false;
  }
  missions.releaseAll(sim.id);
  sim.mission = null;

  if (action === 'charge') sim.mission = missions.createChargeMission(sim.id);
  else if (action === 'park') sim.mission = missions.createParkMission(sim.id);
  else sim.mission = missions.createMission(sim.id);

  if (!sim.mission) {
    deps.log(`${sim.id} : aucune destination libre pour "${action}"`);
    return false;
  }
  deps.log(`${sim.id} : ${action} → ${sim.mission.id}`);
  return true;
}

/** Parse the command datapoint payload into a list of commands. */
function parseCommands(json) {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.commands)) return parsed.commands;
    if (parsed && typeof parsed === 'object' && parsed.action) return [parsed];
  } catch {
    // Malformed payload — drop it rather than crash the simulation loop.
  }
  return [];
}

module.exports = { ACTIONS, serialize, applyCommand, parseCommands };
