// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Closing a dialog on a click of its overlay, only when the press also started on the
 * overlay. A text selection started in a field and released outside the panel makes the
 * browser fire a click on the overlay (their common ancestor): it must not close the
 * dialog and lose what was typed.
 *
 *   <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.close()}>
 */

/** Overlays whose last press started on the overlay itself (not in the panel). */
const pressedOnOverlay = new WeakSet<EventTarget>();

/** `pointerdown` listener of the overlay: remembers whether the press started on it. */
export function overlayDown(e: Event): void {
  const overlay = e.currentTarget;
  if (!overlay) return;
  if (e.target === overlay) pressedOnOverlay.add(overlay);
  else pressedOnOverlay.delete(overlay);
}

/** In the overlay's `click` listener: true when both the press and the release were on the overlay. */
export function overlayClicked(e: Event): boolean {
  const overlay = e.currentTarget;
  if (!overlay) return false;
  const pressed = pressedOnOverlay.has(overlay);
  pressedOnOverlay.delete(overlay);
  return pressed && e.target === overlay;
}
