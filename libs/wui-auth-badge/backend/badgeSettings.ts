// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// badgeSettings — the badge login's settings, set on the "Badges" page:
//
//   badgeLoginEnabled   the badge opens a session (false: /login answers
//                       `disabled`, the login page sends to the password form)
//   selfEnrolment       every user associates their own badge on "Mon badge"
//                       (false: only a user with the `enrol` role does it)
//
// Kept as JSON in the DP `WuiAuthBadge_Config.settings` (its type of the same
// name created at first need, by this backend). An absent or unreadable DP:
// the defaults — the behaviour of before the settings.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { WinccoaDpTypeNode, WinccoaElementType } from 'winccoa-manager';

export interface BadgeSettings {
  badgeLoginEnabled: boolean;
  selfEnrolment: boolean;
}

export const DEFAULT_SETTINGS: BadgeSettings = { badgeLoginEnabled: true, selfEnrolment: true };

const CONFIG_DPT = 'WuiAuthBadge_Config';
const CONFIG_DP = 'WuiAuthBadge_Config';
const CONFIG_DPE = `${CONFIG_DP}.settings`;
const CACHE_MS = 2000;

let cache: { at: number; value: BadgeSettings } | null = null;
let ready: Promise<void> | null = null;

/** The settings: stored values over the defaults. Never throws. */
export async function readSettings(): Promise<BadgeSettings> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value = DEFAULT_SETTINGS;
  try {
    const winccoa = WsjServerGlobal.winccoa;
    if (winccoa.dpExists(CONFIG_DP)) value = parse(await winccoa.dpGet(CONFIG_DPE));
  } catch (error) {
    console.warn('[auth-badge] settings unreadable, defaults used', error);
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Stores the settings (`patch` over the current ones); the stored result. */
export async function writeSettings(patch: Partial<BadgeSettings>): Promise<BadgeSettings> {
  await ensureConfigDp();
  const value: BadgeSettings = { ...(await readSettings()), ...patch };
  await WsjServerGlobal.winccoa.dpSetWait(CONFIG_DPE, JSON.stringify(value));
  cache = { at: Date.now(), value };
  return value;
}

/** The type and the DP, created at first need. */
function ensureConfigDp(): Promise<void> {
  ready ??= (async () => {
    const winccoa = WsjServerGlobal.winccoa;
    if (winccoa.dpExists(CONFIG_DP)) return;
    if (!(winccoa.dpTypes(CONFIG_DPT) as string[]).includes(CONFIG_DPT)) {
      const type = new WinccoaDpTypeNode(CONFIG_DPT, WinccoaElementType.Struct, '', [
        new WinccoaDpTypeNode('settings', WinccoaElementType.String)
      ]);
      if (!(await winccoa.dpTypeCreate(type))) throw new Error(`creating the type ${CONFIG_DPT} was refused`);
    }
    if (!(await winccoa.dpCreate(CONFIG_DP, CONFIG_DPT))) throw new Error(`creating ${CONFIG_DP} was refused`);
    console.info(`[auth-badge] settings DP ${CONFIG_DP} created`);
  })().catch((error: unknown) => {
    ready = null;
    throw error;
  });
  return ready;
}

function parse(raw: unknown): BadgeSettings {
  const text = raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
  if (typeof text !== 'string' || text.trim() === '') return DEFAULT_SETTINGS;
  const stored = JSON.parse(text) as Partial<Record<keyof BadgeSettings, unknown>>;
  return {
    badgeLoginEnabled: typeof stored.badgeLoginEnabled === 'boolean' ? stored.badgeLoginEnabled : DEFAULT_SETTINGS.badgeLoginEnabled,
    selfEnrolment: typeof stored.selfEnrolment === 'boolean' ? stored.selfEnrolment : DEFAULT_SETTINGS.selfEnrolment
  };
}
