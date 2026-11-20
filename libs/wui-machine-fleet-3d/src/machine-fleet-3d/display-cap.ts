// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * At most MAX_SHOWN information lines in a machine's bubble, and in its popup ("Affichage" tab).
 * A machine carries any number of parameters (the site's catalogue may propose all of a slot's);
 * only the lines shown are limited. Pure functions, tested by display-cap.spec.ts.
 */
import type { DisplaySlot } from '@visuelconcept-winccoa/wui-fleet-core/types.js';

/** Maximum number of lines shown in the bubble, and in the popup. */
export const MAX_SHOWN = 10;

/**
 * Display items in order with at most {@link MAX_SHOWN} shown in the bubble and in the popup
 * each: past that, in display order, an item is hidden there (defaults or older configurations
 * ticking more).
 */
export function capShown(slots: DisplaySlot[]): DisplaySlot[] {
  let bubble = 0;
  let popup = 0;
  return slots.map((s) => {
    const inBubble = s.inBubble && bubble < MAX_SHOWN;
    const inPopup = s.inPopup && popup < MAX_SHOWN;
    if (inBubble) bubble++;
    if (inPopup) popup++;
    return inBubble === s.inBubble && inPopup === s.inPopup ? s : { ...s, inBubble, inPopup };
  });
}

/** Number of items shown in the bubble and in the popup. */
export function shownCounts(slots: DisplaySlot[]): { bubble: number; popup: number } {
  return {
    bubble: slots.filter((s) => s.inBubble).length,
    popup: slots.filter((s) => s.inPopup).length
  };
}
