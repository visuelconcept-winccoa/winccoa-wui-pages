// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dialog overlay: a click closes only when the press also started on the overlay, so a
 * text selection dragged out of the panel keeps the dialog open.
 */
import { describe, expect, it } from 'vitest';
import { overlayClicked, overlayDown } from './ui/overlay-dismiss.js';

const overlay = {} as EventTarget;
const field = {} as EventTarget;
const ev = (target: EventTarget): Event => ({ target, currentTarget: overlay }) as unknown as Event;

describe('overlay dismiss', () => {
  it('closes on a press and a release on the overlay', () => {
    overlayDown(ev(overlay));
    expect(overlayClicked(ev(overlay))).toBe(true);
  });

  it('keeps the dialog when the press started in the panel (selection dragged out)', () => {
    overlayDown(ev(field));
    expect(overlayClicked(ev(overlay))).toBe(false);
  });

  it('keeps the dialog on a click inside the panel', () => {
    overlayDown(ev(overlay));
    expect(overlayClicked(ev(field))).toBe(false);
  });

  it('forgets the press once the click is handled', () => {
    overlayDown(ev(overlay));
    overlayClicked(ev(overlay));
    expect(overlayClicked(ev(overlay))).toBe(false);
  });
});
