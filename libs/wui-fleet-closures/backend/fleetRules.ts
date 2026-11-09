// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// Fleet write rules
// -----------------------------------------------------------------------------
// Which role a write of the Machine Fleet pages needs, decided on the server from
// what is written (never from what the client says). Only the Fleet's own
// datapoints (MachineFleet3D*) and the archive config of a bound datapoint are
// writable here; anything else is refused. Pure functions, unit-tested.
// -----------------------------------------------------------------------------

/** A role of an Application Security module. */
export interface FleetRole {
  module: string;
  role: string;
}

/** Prefix of every datapoint and datapoint type of the Fleet. */
export const FLEET_PREFIX = 'MachineFleet3D';
/** The non-worked periods datapoint (and its type). */
export const CLOSURES_DP = 'MachineFleet3D_Closures';
/** The causes given by hand to stops (and its type, #272). */
export const STOPQUAL_DP = 'MachineFleet3D_StopQualifications';
/** The module settings datapoint (and its type): settings of every atelier (#70). */
export const SETTINGS_DP = 'MachineFleet3D_Settings';

const EDIT_FLEET: FleetRole = { module: 'machine-fleet-3d', role: 'edit' };
const EDIT_CLOSURES: FleetRole = { module: 'fleet-closures', role: 'edit' };
const EDIT_MACHINE_CLOSURES: FleetRole = { module: 'fleet-closures', role: 'edit-machine' };
const QUALIFY_STOPS: FleetRole = { module: 'machine-fleet-3d', role: 'qualify' };
const CONFIGURE_FLEET: FleetRole = { module: 'machine-fleet-3d', role: 'configure' };

/** A DPE without its system name ("System1:Dp.el" → "Dp.el"); a config (":_…") is not a system. */
function withoutSystem(dpe: string): string {
  const m = /^[A-Za-z][A-Za-z0-9_]*:(?!_)/.exec(dpe.trim());
  return m ? dpe.trim().slice(m[0].length) : dpe.trim();
}

/** Datapoint name of a DPE ("System1:Dp.el:_archive.._type" → "Dp"). */
export function dpOf(dpe: string): string {
  return withoutSystem(dpe).split(/[.:]/)[0];
}

/** Config part of a DPE ("Dp.el:_archive.._type" → "_archive"), '' for a value. */
export function configOf(dpe: string): string {
  const s = withoutSystem(dpe);
  const at = s.indexOf(':');
  return at < 0 ? '' : s.slice(at + 1).split('.')[0];
}

const isFleet = (name: string): boolean => name.startsWith(FLEET_PREFIX);

/**
 * Roles of which ANY grants writing `dpe` (empty: refused). The archive config of a
 * bound datapoint is the Fleet's "archiving" setting; the Fleet's own datapoints
 * are its configuration, the non-worked periods aside (closuresRoles).
 */
export function rolesForSet(dpe: string): FleetRole[] {
  const dp = dpOf(dpe);
  const config = configOf(dpe);
  if (config) return config === '_archive' ? [EDIT_FLEET] : [];
  if (!isFleet(dp)) return [];
  if (dp === CLOSURES_DP) return [EDIT_CLOSURES, EDIT_MACHINE_CLOSURES];
  if (dp === STOPQUAL_DP) return [QUALIFY_STOPS];
  if (dp === SETTINGS_DP) return [CONFIGURE_FLEET];
  return [EDIT_FLEET];
}

/** Roles of which ANY grants creating (or deleting) the datapoint `dp` of type `type`. */
export function rolesForDp(dp: string, type?: string): FleetRole[] {
  if (!isFleet(dp) || (type !== undefined && !isFleet(type))) return [];
  if (dp === STOPQUAL_DP) return [QUALIFY_STOPS];
  if (dp === SETTINGS_DP) return [CONFIGURE_FLEET];
  return dp === CLOSURES_DP ? [EDIT_CLOSURES, EDIT_MACHINE_CLOSURES] : [EDIT_FLEET];
}

/** Roles of which ANY grants creating the datapoint type `type`. */
export function rolesForType(type: string): FleetRole[] {
  if (!isFleet(type)) return [];
  if (type === STOPQUAL_DP) return [QUALIFY_STOPS];
  if (type === SETTINGS_DP) return [CONFIGURE_FLEET];
  return type === CLOSURES_DP ? [EDIT_CLOSURES, EDIT_MACHINE_CLOSURES] : [EDIT_FLEET];
}

/** The non-worked periods as stored ({ global?, ateliers, machines }). */
interface Closures {
  global?: unknown;
  ateliers?: unknown;
  machines?: unknown;
}

function parseClosures(raw: unknown): Closures {
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === 'object' ? (v as Closures) : {};
  } catch {
    return {};
  }
}

/**
 * Roles for a new value of the non-worked periods: changing only the periods of
 * single machines needs 'edit-machine' (or 'edit'); touching the global schedule or
 * an atelier's periods needs 'edit'.
 */
export function closuresRoles(before: unknown, after: unknown): FleetRole[] {
  const a = parseClosures(before);
  const b = parseClosures(after);
  const same = (x: unknown, y: unknown): boolean => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  return same(a.global, b.global) && same(a.ateliers ?? {}, b.ateliers ?? {})
    ? [EDIT_CLOSURES, EDIT_MACHINE_CLOSURES]
    : [EDIT_CLOSURES];
}
