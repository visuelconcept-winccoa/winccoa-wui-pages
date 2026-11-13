// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where a tooltip that follows the pointer (`position: fixed` at the pointer) goes, so that it stays on screen:
 * right of and below the pointer, left of it in the right half of the viewport, above it in the bottom third
 * (feedback of the 13/11/2026 demo: the Gantt tooltip went off screen on the right). A half is wider than any
 * tooltip of the dashboard, so no measuring is needed.
 */

/** Gap between the pointer and the tooltip, in px. */
export const TIP_GAP = 12;

/** CSS `transform` placing the tooltip around the pointer (x, y) in a viewport of width × height. */
export function tipTransform(x: number, y: number, width: number, height: number): string {
  const left = width > 0 && x > width / 2;
  const up = height > 0 && y > (height * 2) / 3;
  const dx = left ? `calc(-100% - ${TIP_GAP}px)` : `${TIP_GAP}px`;
  const dy = up ? `calc(-100% - ${TIP_GAP}px)` : `${TIP_GAP}px`;
  return `translate(${dx}, ${dy})`;
}
