// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

export * from '@visuelconcept-winccoa/wui-fleet-core/types.js';
export { MAX_SHOWN, shownCounts } from './display-cap.js';
import { resolveDisplaySlots, type DisplaySlot, type MachineDef } from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import { capShown } from './display-cap.js';

/**
 * The machine's display items in order ({@link resolveDisplaySlots}), at most MAX_SHOWN shown
 * in the bubble and in the popup each (display-cap.ts).
 */
export function shownSlots(m: MachineDef): DisplaySlot[] {
  return capShown(resolveDisplaySlots(m));
}
