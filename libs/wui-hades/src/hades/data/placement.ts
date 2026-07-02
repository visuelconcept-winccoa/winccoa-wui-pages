// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Series placement + compliance auto-fix.
 *
 * `placeSeries` drops one equipment every N metres over a PK range (the "one
 * SOS niche every 200 m" gesture). `fixIssue` turns a compliance deviation
 * into the equipment set that satisfies it: spacing rules get an evenly
 * distributed series sized so every gap (portals included) stays under the
 * threshold; presence rules get sensible defaults (fans every ~400 m, one
 * anemometer/fire line/radio at mid-tube, power near the portal, cameras
 * every ~300 m). Generated equipment is UNBOUND — the operator still binds
 * the datapoints (or lets hadesSim auto-map) — and nothing is persisted here:
 * both helpers return a new Tunnel copy the editor saves explicitly.
 */
import { exitSpacingOf, profileRules, type ComplianceIssue } from './compliance.js';
import type { EquipmentDef, EquipmentKind, EquipmentSide, Tunnel, TubeDef } from '../types.js';
import { tubeLengthM } from '../types.js';

/** Default series interval for kinds fixed by presence rules (metres). */
const FAN_EVERY_M = 400;
const CAMERA_EVERY_M = 300;
/** PK of the "near the portal" singleton fixes (power supply). */
const PORTAL_PK_M = 50;

/** Name prefix per kind for generated equipment. */
const NAME_PREFIX: Partial<Record<EquipmentKind, string>> = {
  'emergency-exit': 'EXIT',
  'sos-niche': 'SOS',
  'jet-fan': 'JET',
  camera: 'CAM',
  anemometer: 'ANEMO',
  'fire-detection': 'FIRE',
  radio: 'RADIO',
  power: 'POWER'
};

/** Default cross-section side per kind for generated equipment. */
const DEFAULT_SIDE: Partial<Record<EquipmentKind, EquipmentSide>> = {
  'emergency-exit': 'left',
  'sos-niche': 'right',
  'jet-fan': 'ceiling',
  camera: 'ceiling',
  anemometer: 'ceiling',
  'fire-detection': 'ceiling',
  radio: 'right',
  power: 'right'
};

export interface SeriesOptions {
  tubeId: string;
  kind: EquipmentKind;
  side: EquipmentSide;
  /** First unit PK (metres). */
  startM: number;
  /** Last allowed PK (inclusive, metres). */
  endM: number;
  /** Interval between units (metres, > 0). */
  everyM: number;
  /** Name prefix; units are numbered from the existing count of that kind. */
  prefix?: string;
}

let uniqueCounter = 0;

function freshId(kind: EquipmentKind): string {
  uniqueCounter += 1;
  return `${kind}-${Date.now().toString(36)}-${uniqueCounter.toString(36)}`;
}

function makeEquipment(
  tubeId: string,
  kind: EquipmentKind,
  side: EquipmentSide,
  pkM: number,
  unit: number,
  prefix?: string
): EquipmentDef {
  const name = `${prefix ?? NAME_PREFIX[kind] ?? kind.toUpperCase()}-${String(unit).padStart(2, '0')}`;
  return { id: freshId(kind), name, kind, tubeId, pkM: Math.round(pkM), side, bindings: {} };
}

/** Number of already-placed equipments of a kind (numbering continues after them). */
function existingCount(tunnel: Tunnel, tubeId: string, kind: EquipmentKind): number {
  return tunnel.equipment.filter((e) => e.tubeId === tubeId && e.kind === kind).length;
}

/** Drop one equipment every `everyM` metres over [startM, endM]. */
export function placeSeries(tunnel: Tunnel, opts: SeriesOptions): { tunnel: Tunnel; added: number } {
  if (opts.everyM <= 0 || opts.endM < opts.startM) return { tunnel, added: 0 };
  const generated: EquipmentDef[] = [];
  let unit = existingCount(tunnel, opts.tubeId, opts.kind) + 1;
  for (let pk = opts.startM; pk <= opts.endM; pk += opts.everyM) {
    generated.push(makeEquipment(opts.tubeId, opts.kind, opts.side, pk, unit, opts.prefix));
    unit += 1;
  }
  return {
    tunnel: { ...tunnel, equipment: [...tunnel.equipment, ...generated] },
    added: generated.length
  };
}

/**
 * Evenly distributed series sized so every gap (portals included) stays under
 * `spacingM`: N units at i·L/(N+1), with N = ceil(L / spacing) − 1.
 */
function evenSeries(tunnel: Tunnel, tube: TubeDef, kind: EquipmentKind, spacingM: number): EquipmentDef[] {
  const length = tubeLengthM(tube);
  if (length <= 0 || spacingM <= 0) return [];
  const count = Math.max(1, Math.ceil(length / spacingM) - 1);
  const step = length / (count + 1);
  const side = DEFAULT_SIDE[kind] ?? 'right';
  let unit = existingCount(tunnel, tube.id, kind) + 1;
  const out: EquipmentDef[] = [];
  for (let i = 1; i <= count; i++) {
    out.push(makeEquipment(tube.id, kind, side, i * step, unit));
    unit += 1;
  }
  return out;
}

/** Kinds `fixIssue` can generate, per fixable rule id. */
export function isFixable(issue: ComplianceIssue): boolean {
  return issue.tubeId !== undefined && FIXERS[issue.ruleId] !== undefined;
}

type Fixer = (tunnel: Tunnel, tube: TubeDef) => EquipmentDef[];

const FIXERS: Record<string, Fixer> = {
  'exit-spacing': (tunnel, tube) =>
    evenSeries(tunnel, tube, 'emergency-exit', exitSpacingOf(profileRules(tunnel.profile), tube)),
  'sos-spacing': (tunnel, tube) =>
    evenSeries(tunnel, tube, 'sos-niche', profileRules(tunnel.profile).sosSpacingM),
  ventilation: (tunnel, tube) => evenSeries(tunnel, tube, 'jet-fan', FAN_EVERY_M),
  cctv: (tunnel, tube) => evenSeries(tunnel, tube, 'camera', CAMERA_EVERY_M),
  anemometer: (tunnel, tube) => [
    makeEquipment(tube.id, 'anemometer', 'ceiling', tubeLengthM(tube) / 2, existingCount(tunnel, tube.id, 'anemometer') + 1)
  ],
  'fire-detection': (tunnel, tube) => [
    makeEquipment(tube.id, 'fire-detection', 'ceiling', tubeLengthM(tube) / 2, existingCount(tunnel, tube.id, 'fire-detection') + 1)
  ],
  radio: (tunnel, tube) => [
    makeEquipment(tube.id, 'radio', 'right', tubeLengthM(tube) / 2, existingCount(tunnel, tube.id, 'radio') + 1)
  ],
  power: (tunnel, tube) => [
    makeEquipment(tube.id, 'power', 'right', PORTAL_PK_M, existingCount(tunnel, tube.id, 'power') + 1)
  ]
};

/**
 * Generate the equipment that satisfies one fixable deviation. Returns the
 * patched tunnel copy and how many units were added (0 = not fixable).
 */
export function fixIssue(tunnel: Tunnel, issue: ComplianceIssue): { tunnel: Tunnel; added: number } {
  const fixer = FIXERS[issue.ruleId];
  const tube = tunnel.tubes.find((t) => t.id === issue.tubeId);
  if (!fixer || !tube) return { tunnel, added: 0 };
  const generated = fixer(tunnel, tube);
  if (generated.length === 0) return { tunnel, added: 0 };
  return {
    tunnel: { ...tunnel, equipment: [...tunnel.equipment, ...generated] },
    added: generated.length
  };
}
