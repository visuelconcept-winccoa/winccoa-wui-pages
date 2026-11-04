// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A user's own viewpoints and default page (#60), kept in their WinCC OA user settings
 * (settings-cache.ts, setting `fleet-views`): every user can save, rename, update and delete
 * their own viewpoints of each atelier and choose their own default viewpoint and default page;
 * they win over the public ones (the atelier's `viewpoints` / `defaultViewpointId`, the atelier
 * marked `landing`) for that user only.
 *
 *   { ateliers: { [atelierId]: { viewpoints: Viewpoint[], defaultViewpointId?: string } },
 *     defaultPage?: string }   // an atelier id, or OVERVIEW_PAGE
 */
import { settingObject, settingsCache } from './settings-cache.js';
import type { Atelier, Viewpoint } from './types.js';

export const USER_VIEWS_SETTING = 'fleet-views';
/** Default page value: the overview of the ateliers (overrides a public landing atelier). */
export const OVERVIEW_PAGE = '*overview';

export interface UserAtelierViews {
  viewpoints: Viewpoint[];
  defaultViewpointId?: string;
}

const isTriple = (x: unknown): x is [number, number, number] =>
  Array.isArray(x) && x.length === 3 && x.every((v) => typeof v === 'number' && Number.isFinite(v));

function parseViewpoint(x: unknown): Viewpoint | null {
  if (!x || typeof x !== 'object') return null;
  const v = x as Record<string, unknown>;
  if (typeof v['id'] !== 'string' || typeof v['name'] !== 'string' || !isTriple(v['pos']) || !isTriple(v['target'])) return null;
  const out: Viewpoint = { id: v['id'], name: v['name'], pos: v['pos'], target: v['target'] };
  if (v['mode'] === '2d' || v['mode'] === '3d') out.mode = v['mode'];
  return out;
}

function ateliersEntry(): Record<string, unknown> {
  const a = settingObject(USER_VIEWS_SETTING)['ateliers'];
  return a && typeof a === 'object' && !Array.isArray(a) ? (a as Record<string, unknown>) : {};
}

/** The user's own viewpoints of an atelier (none before their settings are loaded). */
export function loadUserViews(atelierId: string): UserAtelierViews {
  const raw = ateliersEntry()[atelierId];
  if (!raw || typeof raw !== 'object') return { viewpoints: [] };
  const e = raw as Record<string, unknown>;
  const viewpoints = Array.isArray(e['viewpoints'])
    ? e['viewpoints'].map(parseViewpoint).filter((v): v is Viewpoint => v !== null)
    : [];
  const def = e['defaultViewpointId'];
  return typeof def === 'string' && viewpoints.some((v) => v.id === def) ? { viewpoints, defaultViewpointId: def } : { viewpoints };
}

/** Remember the user's own viewpoints of an atelier (the other ateliers and the page kept). */
export function saveUserViews(atelierId: string, views: UserAtelierViews): void {
  const all = settingObject(USER_VIEWS_SETTING);
  settingsCache.set(USER_VIEWS_SETTING, { ...all, ateliers: { ...ateliersEntry(), [atelierId]: views } });
}

/** The user's own default page (an atelier id or OVERVIEW_PAGE), undefined when none chosen. */
export function loadDefaultPage(): string | undefined {
  const p = settingObject(USER_VIEWS_SETTING)['defaultPage'];
  return typeof p === 'string' && p !== '' ? p : undefined;
}

/** Choose the user's own default page (undefined: back to the public one). */
export function saveDefaultPage(page: string | undefined): void {
  const all = { ...settingObject(USER_VIEWS_SETTING) };
  if (page) all['defaultPage'] = page;
  else delete all['defaultPage'];
  settingsCache.set(USER_VIEWS_SETTING, all);
}

/**
 * The atelier to open on arriving at the fleet: the user's own choice, else the public landing
 * atelier, else none (the overview). A chosen atelier that no longer exists is ignored.
 */
export function landingAtelier(ateliers: readonly Pick<Atelier, 'id' | 'landing'>[]): string | undefined {
  const own = loadDefaultPage();
  if (own === OVERVIEW_PAGE) return undefined;
  if (own && ateliers.some((a) => a.id === own)) return own;
  return ateliers.find((a) => a.landing)?.id;
}
