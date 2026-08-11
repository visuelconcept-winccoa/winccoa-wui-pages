// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The iX icon each asset kind draws on the map.
 *
 * All names are verified members of `@siemens/ix-icons` — a missing name renders as
 * an empty box, which on a map reads as a broken asset rather than a missing icon,
 * so this list is deliberately explicit rather than derived. Two choices are worth
 * a word: a valve is `flow-physically` (it is what regulates the flow; the icon set
 * has no valve glyph) and a borehole is `drop` (nor a well glyph).
 */
import type { AssetKind } from '../types.js';

export const ASSET_ICONS: Record<AssetKind, string> = {
  generic: 'location',
  pump: 'device-fan',
  tank: 'storage',
  valve: 'flow-physically',
  meter: 'gauge',
  sensor: 'sensor',
  treatment: 'water-plant',
  well: 'drop',
  station: 'plant',
  cabinet: 'hardware-cabinet',
  light: 'bulb',
  traffic: 'generic-device-traffic',
  air: 'cloud',
  charger: 'battery-charge',
  tunnel: 'road',
  building: 'building2'
};

/** The icon of an asset kind, falling back to the generic pin. */
export function assetIcon(kind: AssetKind): string {
  return ASSET_ICONS[kind] ?? ASSET_ICONS.generic;
}
