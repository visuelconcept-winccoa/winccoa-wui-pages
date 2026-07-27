// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
// Harness stub of the shell's lit-translate singleton: static resolution,
// French first (the demo networks are authored in French), English fallback.
type ML = Record<string, string> | string | undefined | null;
const LANG_PREF = ['fr', 'fr.utf8', 'en_US.utf8', 'en'];
export function localize(ml: ML): string {
  if (ml == null) return '';
  if (typeof ml === 'string') return ml;
  for (const k of LANG_PREF) if (ml[k]) return ml[k];
  return Object.values(ml)[0] ?? '';
}
export const localizeDir = localize;
