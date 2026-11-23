// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where the leader line of a bubble moved away from its machine meets the bubble (winccoa-fra-msp-stma#372): the point of the bubble's edge
 * nearest to the machine's dot — the bottom edge for a bubble above its machine, the left edge for a bubble on its
 * right, a corner for a bubble set diagonally — so that the line never crosses the bubble. Null when the dot is
 * under the bubble: there is no line to draw.
 *
 * Pure geometry in screen pixels, no DOM: the label layout calls it, the unit tests drive it.
 */

/** A screen rectangle (px): top-left corner, width, height. */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function leaderEnd(r: ScreenRect, ax: number, ay: number): [number, number] | null {
  const inside = ax > r.x && ax < r.x + r.w && ay > r.y && ay < r.y + r.h;
  if (inside) return null;
  return [Math.min(r.x + r.w, Math.max(r.x, ax)), Math.min(r.y + r.h, Math.max(r.y, ay))];
}
