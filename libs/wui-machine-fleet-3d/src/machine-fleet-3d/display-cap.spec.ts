// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A machine's bubble and popup show at most MAX_SHOWN lines each ("Affichage" tab): it may carry
 * more parameters, the ones past the limit (in display order) stay listed but hidden.
 */
import { describe, expect, it } from 'vitest';
import type { DisplaySlot } from '@visuelconcept-winccoa/wui-fleet-core/types.js';
import { MAX_SHOWN, capShown, shownCounts } from './display-cap.js';

const FIXED = ['state', 'stopCause', 'workOrder', 'operation', 'alarmCode'];
const fixed = (inPopup = true): DisplaySlot[] =>
  FIXED.map((ref) => ({ ref, kind: ref, label: ref, inBubble: true, inPopup }) as unknown as DisplaySlot);
const params = (n: number, bubble: boolean, popup = bubble): DisplaySlot[] =>
  Array.from({ length: n }, (_, i) => ({ ref: `param:p${i + 1}`, kind: 'param', label: `P${i + 1}`, inBubble: bubble, inPopup: popup }) as DisplaySlot);

describe('capShown — at most MAX_SHOWN lines shown', () => {
  it('keeps every item listed, whatever their number', () => {
    const slots = capShown([...fixed(), ...params(14, false)]);
    expect(slots).toHaveLength(19);
    expect(shownCounts(slots)).toEqual({ bubble: 5, popup: 5 });
  });

  it('hides, in display order, what is ticked past the limit', () => {
    // 5 fixed lines + 8 parameters ticked = 13 asked, 10 shown.
    const slots = capShown([...fixed(), ...params(8, true)]);
    expect(shownCounts(slots)).toEqual({ bubble: MAX_SHOWN, popup: MAX_SHOWN });
    const p = slots.filter((s) => s.kind === 'param');
    expect(p.slice(0, 5).every((s) => s.inBubble && s.inPopup)).toBe(true);
    expect(p.slice(5).some((s) => s.inBubble || s.inPopup)).toBe(false);
  });

  it('applies the limit to each column on its own', () => {
    const slots = capShown([...fixed(false), ...params(12, false, true)]);
    expect(shownCounts(slots)).toEqual({ bubble: 5, popup: MAX_SHOWN });
  });
});
