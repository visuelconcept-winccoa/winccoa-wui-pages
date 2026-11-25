// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Which machines show their dot and bubble (winccoa-fra-msp-stma#378): the "Machine labels" toggle and the "Bubbles
 * on hover only" mode are independent. Labels on: every dot, and every bubble (hover mode: only the hovered machine's
 * bubble, all of them in edit mode). Labels off: nothing — except, in hover mode, the machine under the pointer, dot
 * and bubble, so that the eye button keeps working with the labels hidden.
 *
 * Pure, no DOM: the label layout calls it, the unit tests drive it.
 */

export interface LabelVisibilityInput {
  /** "Machine labels" toggle of the view. */
  labels: boolean;
  /** "Bubbles on hover only" mode of the atelier. */
  hoverMode: boolean;
  editMode: boolean;
  /** The machine is under the pointer (its model, its dot or its bubble). */
  hovered: boolean;
}

export interface LabelVisibility {
  dot: boolean;
  bubble: boolean;
}

export function labelVisibility(v: LabelVisibilityInput): LabelVisibility {
  if (!v.labels) return v.hoverMode && v.hovered ? { dot: true, bubble: true } : { dot: false, bubble: false };
  if (v.hoverMode && !v.editMode) return { dot: true, bubble: v.hovered };
  return { dot: true, bubble: true };
}

/** Whether the layout has anything to draw at all. */
export function labelsActive(labels: boolean, hoverMode: boolean): boolean {
  return labels || hoverMode;
}
