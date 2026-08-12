// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The occurrence window — what "how often did this happen" is counted on.
 *
 * The live alert subscription is a snapshot of what is active NOW, so counting
 * recurrences in it is wrong by construction: an alarm that clears leaves the
 * set and its occurrence disappears from the tally, then reappears when the
 * condition comes back. The flood histogram and the bad-actor top would swing up
 * and down with the plant instead of accumulating.
 *
 * So the window is built from two sources — the ARCHIVE for the past (the only
 * place it exists) and the live stream for what happens next — and this module
 * is the merge rule: same occurrence, keep the fresher row; anything older than
 * the window, drop.
 */
import type { Alarm } from './types.js';

/**
 * Fold `incoming` over `previous`, keeping only what was raised at or after
 * `since`. Later arguments win, so a live row supersedes its archived copy.
 */
export function mergeOccurrences(
  previous: readonly Alarm[],
  incoming: readonly Alarm[],
  since: number
): Alarm[] {
  const byId = new Map<string, Alarm>();
  for (const alarm of previous) {
    if (alarm.raised >= since) byId.set(alarm.id, alarm);
  }
  for (const alarm of incoming) {
    if (alarm.raised >= since) byId.set(alarm.id, alarm);
  }
  return [...byId.values()];
}
