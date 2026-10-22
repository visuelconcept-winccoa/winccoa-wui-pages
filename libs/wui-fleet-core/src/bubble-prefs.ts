// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A viewer's own choice of what the machine bubbles show, per atelier, kept in their browser
 * (it never changes the atelier configuration, nor what other users see):
 *   - `lines`: display item ref (e.g. 'state', 'param:ARTICLE', 'kpi:trs') → shown or not,
 *     for every machine of the atelier offering that item; an item absent keeps the
 *     machine's configured visibility;
 *   - `hidden`: machines whose bubble is hidden.
 * Only items a machine offers can be shown: the choice never adds an item to a machine.
 */
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

/** localStorage key of the bubble choices (all ateliers). */
export const BUBBLE_PREFS_STORAGE_KEY = 'wui.machine-fleet.bubbles';

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

/** The viewer's choices for an atelier (empty when none, or when the storage is unavailable). */
export function loadBubblePrefs(atelierId: string): BubblePrefs {
  try {
    const raw = globalThis.localStorage?.getItem(BUBBLE_PREFS_STORAGE_KEY);
    const all = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const p = all && typeof all === 'object' ? (all[atelierId] as Partial<BubblePrefs> | undefined) : undefined;
    const lines: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(p?.lines ?? {})) if (typeof v === 'boolean') lines[k] = v;
    const hidden = Array.isArray(p?.hidden) ? p.hidden.filter((x): x is string => typeof x === 'string') : [];
    return { lines, hidden };
  } catch {
    return { lines: {}, hidden: [] };
  }
}

/** Remember the viewer's choices for an atelier (best effort; other ateliers kept). */
export function saveBubblePrefs(atelierId: string, prefs: BubblePrefs): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    const raw = storage.getItem(BUBBLE_PREFS_STORAGE_KEY);
    let all: Record<string, unknown> = {};
    try {
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) all = parsed as Record<string, unknown>;
    } catch {
      // Unreadable: start afresh.
    }
    all[atelierId] = prefs;
    storage.setItem(BUBBLE_PREFS_STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the choice just isn't remembered.
  }
}
