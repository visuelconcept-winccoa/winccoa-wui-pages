// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A viewer's own choice of what the machine bubbles show, per atelier, kept in their WinCC OA
 * user settings (settings-cache.ts; it never changes the atelier configuration, nor what other
 * users see):
 *   - `lines`: display item ref (e.g. 'state', 'param:ARTICLE', 'kpi:trs') → shown or not,
 *     for every machine of the atelier offering that item; an item absent keeps the
 *     machine's configured visibility;
 *   - `hidden`: machines whose bubble is hidden.
 * The same setting keeps the viewer's display toggles of each atelier (roof, labels, alerts
 * only: {@link AtelierDisplayPrefs}), which override the atelier's own outside edit mode.
 * Only items a machine offers can be shown: the choice never adds an item to a machine.
 */
import { settingObject, settingsCache, stringList } from './settings-cache.js';
import { resolveDisplaySlots, type MachineDef } from './types.js';

export interface BubblePrefs {
  lines: Record<string, boolean>;
  hidden: string[];
}

/** One item a viewer can show or hide, with its label and its default (configured) visibility. */
export interface BubbleItem {
  ref: string;
  label: string;
  /** Shown by default (configured "in bubble" on at least one machine offering it). */
  byDefault: boolean;
}

/** User setting holding, per atelier id, the bubble choices and display toggles. */
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

export const EMPTY_BUBBLE_PREFS: BubblePrefs = { lines: {}, hidden: [] };

/** Items offered by the atelier's machines, in display order of first appearance. */
export function bubbleItems(machines: MachineDef[]): BubbleItem[] {
  const out = new Map<string, BubbleItem>();
  for (const m of machines) {
    for (const s of resolveDisplaySlots(m)) {
      const prev = out.get(s.ref);
      if (prev) prev.byDefault ||= s.inBubble;
      else out.set(s.ref, { ref: s.ref, label: s.label, byDefault: s.inBubble });
    }
  }
  return [...out.values()];
}

/** Whether a machine's bubble shows an item: the viewer's choice, else the machine's own. */
export function showsInBubble(prefs: BubblePrefs, ref: string, configured: boolean): boolean {
  return prefs.lines[ref] ?? configured;
}

/** The viewer's choices for an atelier (empty when none, or before their settings are loaded). */
export function loadBubblePrefs(atelierId: string): BubblePrefs {
  const e = atelierEntry(atelierId);
  const lines: Record<string, boolean> = {};
  const raw = e['lines'];
  if (raw && typeof raw === 'object') for (const [k, v] of Object.entries(raw)) if (typeof v === 'boolean') lines[k] = v;
  return { lines, hidden: stringList(e['hidden']) };
}

/** Remember the viewer's choices for an atelier (other ateliers and the display toggles kept). */
export function saveBubblePrefs(atelierId: string, prefs: BubblePrefs): void {
  saveAtelierEntry(atelierId, { ...atelierEntry(atelierId), lines: prefs.lines, hidden: prefs.hidden });
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
  saveAtelierEntry(atelierId, { ...atelierEntry(atelierId), display });
}
