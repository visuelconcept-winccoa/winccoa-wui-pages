// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A viewer's own display toggles of each atelier (roof, labels, alerts only:
 * {@link AtelierDisplayPrefs}), kept in their WinCC OA user settings (settings-cache.ts). They
 * override the atelier's own toggles outside edit mode, and never change what other users see.
 * Next to them, the viewer's last view of the atelier ({@link AtelierViewPrefs}): camera, 2D / 3D mode
 * and machine panel, found again when they come back to it.
 *
 * What a bubble shows is the atelier's configuration only (the machine's "Affichage" tab), the
 * same for every user: the per-user bubble choices (`lines`, `hidden`) an earlier version kept in
 * the same entry are ignored on read and dropped on the next write.
 */
import { settingObject, settingsCache } from './settings-cache.js';

/** User setting holding, per atelier id, the display toggles and the last view. */
export const ATELIER_PREFS_SETTING = 'fleet-ateliers';

/** A viewer's display toggles of an atelier; an absent toggle keeps the atelier's own. */
export interface AtelierDisplayPrefs {
  roof?: boolean;
  labels?: boolean;
  alertOnly?: boolean;
}

const DISPLAY_TOGGLES = ['roof', 'labels', 'alertOnly'] as const;

/** A camera pose remembered for an atelier: position, target and 2D / 3D mode. */
export interface AtelierCamera {
  pos: [number, number, number];
  target: [number, number, number];
  mode: '2d' | '3d';
}

/** A viewer's last view of an atelier (winccoa-fra-msp-stma#367): its camera, and whether its machine panel is open; absent = the atelier's. */
export interface AtelierViewPrefs {
  camera?: AtelierCamera;
  panel?: boolean;
}

/** Three finite numbers, rounded to the centimetre (a short setting), or null. */
function point(v: unknown): [number, number, number] | null {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  return v.map((n: number) => Math.round(n * 100) / 100) as [number, number, number];
}

function readCamera(v: unknown): AtelierCamera | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const c = v as Record<string, unknown>;
  const pos = point(c['pos']);
  const target = point(c['target']);
  if (!pos || !target || (c['mode'] !== '2d' && c['mode'] !== '3d')) return undefined;
  return { pos, target, mode: c['mode'] };
}

function readView(v: unknown): AtelierViewPrefs {
  const out: AtelierViewPrefs = {};
  if (!v || typeof v !== 'object') return out;
  const camera = readCamera((v as Record<string, unknown>)['camera']);
  if (camera) out.camera = camera;
  const panel = (v as Record<string, unknown>)['panel'];
  if (typeof panel === 'boolean') out.panel = panel;
  return out;
}

/** What an atelier entry keeps: the display toggles and the last view, nothing else. */
function keptEntry(atelierId: string, change: { display?: AtelierDisplayPrefs; view?: AtelierViewPrefs }): Record<string, unknown> {
  const entry = atelierEntry(atelierId);
  const display = change.display ?? entry['display'];
  const view = change.view ?? readView(entry['view']);
  const out: Record<string, unknown> = {};
  if (display !== undefined) out['display'] = display;
  if (Object.keys(view).length > 0) out['view'] = view;
  return out;
}

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
  saveAtelierEntry(atelierId, keptEntry(atelierId, { display }));
}

/** The viewer's last view of an atelier ({} when none). */
export function loadViewPrefs(atelierId: string): AtelierViewPrefs {
  return readView(atelierEntry(atelierId)['view']);
}

/** Remember a change of the viewer's last view of an atelier (its other parts kept). */
export function saveViewPrefs(atelierId: string, change: AtelierViewPrefs): void {
  const view = readView({ ...loadViewPrefs(atelierId), ...change });
  saveAtelierEntry(atelierId, keptEntry(atelierId, { view }));
}
