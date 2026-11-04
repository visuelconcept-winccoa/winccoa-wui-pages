// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A viewer's own display toggles of each atelier (roof, labels, alerts only:
 * {@link AtelierDisplayPrefs}), kept in their WinCC OA user settings (settings-cache.ts). They
 * override the atelier's own toggles outside edit mode, and never change what other users see.
 *
 * What a bubble shows is the atelier's configuration only (the machine's "Affichage" tab), the
 * same for every user: the per-user bubble choices (`lines`, `hidden`) an earlier version kept in
 * the same entry are ignored on read and dropped on the next write.
 */
import { settingObject, settingsCache } from './settings-cache.js';

/** User setting holding, per atelier id, the display toggles. */
export const ATELIER_PREFS_SETTING = 'fleet-ateliers';

/** A viewer's display toggles of an atelier; an absent toggle keeps the atelier's own. */
export interface AtelierDisplayPrefs {
  roof?: boolean;
  labels?: boolean;
  alertOnly?: boolean;
}

const DISPLAY_TOGGLES = ['roof', 'labels', 'alertOnly'] as const;

/** The stored entry of an atelier ({} when none). */
function atelierEntry(atelierId: string): Record<string, unknown> {
  const e = settingObject(ATELIER_PREFS_SETTING)[atelierId];
  return e && typeof e === 'object' && !Array.isArray(e) ? (e as Record<string, unknown>) : {};
}

function saveAtelierEntry(atelierId: string, entry: Record<string, unknown>): void {
  settingsCache.set(ATELIER_PREFS_SETTING, { ...settingObject(ATELIER_PREFS_SETTING), [atelierId]: entry });
}

/** The viewer's display toggles of an atelier (only those they changed). */
export function loadDisplayPrefs(atelierId: string): AtelierDisplayPrefs {
  const raw = atelierEntry(atelierId)['display'];
  const out: AtelierDisplayPrefs = {};
  if (raw && typeof raw === 'object') {
    for (const k of DISPLAY_TOGGLES) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === 'boolean') out[k] = v;
    }
  }
  return out;
}

/** Remember the viewer's display toggles of an atelier ({} : back to the atelier's own). */
export function saveDisplayPrefs(atelierId: string, display: AtelierDisplayPrefs): void {
  saveAtelierEntry(atelierId, { display });
}
