// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// badgeSettings — the badge login's settings, set on the "Badges" page:
//
//   badgeLoginEnabled   the badge opens a session (false: /login answers
//                       `disabled`, the login page sends to the password form)
//   selfEnrolment       every user associates their own badge on "Mon badge"
//                       (false: a user with the `enrol` role does it on "Badges")
//   hashBadges          the badge numbers stored as a one-way fingerprint
//                       (badgeHash.ts); turned on, every number in clear is
//                       rewritten — turned off, the fingerprints stay
//   lockAfterFailures   the refused badges in a row from one station (its IP
//                       address) — unknown, or a recognised user refused —,
//                       after which that station's badge login is locked
//                       (0: never; badgeBlacklist.ts)
//   lockDurationMin     how long, in minutes (0: until unlocked on "Badges")
//
// and the reader's frame (badge-frame-detector.ts, the browser's side; GET
// /config hands it out):
//
//   prefix              what the reader types before the number (default:
//                       WUI_BADGE_PREFIX, MSP_BADGE_PREFIX, else none)
//   maxFrameMs          the longest time from the first character to the end
//                       key: a person typing is slower
//   minUidLength        the shortest number, prefix excluded — also the
//                       server's check when a badge is associated
//   endKey              the key the reader ends the number with
//
// Kept as JSON in the DP `WuiAuthBadge_Config.settings` (its type of the same
// name created at first need, by this backend). An absent or unreadable DP:
// the defaults — the behaviour of before the settings.
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { WinccoaDpTypeNode, WinccoaElementType } from 'winccoa-manager';

export type EndKey = 'Enter' | 'Tab';

export interface BadgeSettings {
  badgeLoginEnabled: boolean;
  selfEnrolment: boolean;
  hashBadges: boolean;
  prefix: string;
  maxFrameMs: number;
  minUidLength: number;
  endKey: EndKey;
  lockAfterFailures: number;
  lockDurationMin: number;
}

export const DEFAULT_SETTINGS: BadgeSettings = {
  badgeLoginEnabled: true,
  selfEnrolment: true,
  hashBadges: false,
  prefix: process.env['WUI_BADGE_PREFIX'] ?? process.env['MSP_BADGE_PREFIX'] ?? '',
  maxFrameMs: 150,
  minUidLength: 4,
  endKey: 'Enter',
  lockAfterFailures: 3,
  lockDurationMin: 15
};

/** The bounds of the reader's and the lock's settings, the page's too (0: never / until unlocked, for the lock's). */
export const LIMITS = {
  prefixLength: 16,
  maxFrameMs: [20, 2000],
  minUidLength: [1, 64],
  lockAfterFailures: [0, 20],
  lockDurationMin: [0, 1440]
} as const;
const END_KEYS: readonly EndKey[] = ['Enter', 'Tab'];

/** A setting's value if `raw` is a valid one, else undefined. */
export function validSetting<K extends keyof BadgeSettings>(key: K, raw: unknown): BadgeSettings[K] | undefined {
  const value = ((): unknown => {
    switch (key) {
      case 'badgeLoginEnabled':
      case 'selfEnrolment':
      case 'hashBadges':
        return typeof raw === 'boolean' ? raw : undefined;
      case 'prefix':
        // Printable characters only: the reader types them.
        return typeof raw === 'string' && raw.length <= LIMITS.prefixLength && !/[\x00-\x1f\x7f]/.test(raw) ? raw : undefined;
      case 'maxFrameMs':
        return inRange(raw, LIMITS.maxFrameMs);
      case 'minUidLength':
        return inRange(raw, LIMITS.minUidLength);
      case 'lockAfterFailures':
        return inRange(raw, LIMITS.lockAfterFailures);
      case 'lockDurationMin':
        return inRange(raw, LIMITS.lockDurationMin);
      case 'endKey':
        return END_KEYS.includes(raw as EndKey) ? raw : undefined;
      default:
        return undefined;
    }
  })();
  return value as BadgeSettings[K] | undefined;
}

function inRange(raw: unknown, [min, max]: readonly [number, number]): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= min && raw <= max ? raw : undefined;
}

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

/** The stored settings over the defaults, an invalid value replaced by its default. */
function parse(raw: unknown): BadgeSettings {
  const text = raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
  if (typeof text !== 'string' || text.trim() === '') return DEFAULT_SETTINGS;
  const stored = JSON.parse(text) as Partial<Record<keyof BadgeSettings, unknown>>;
  const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof BadgeSettings)[]) {
    const value = validSetting(key, stored[key]);
    if (value !== undefined) settings[key] = value;
  }
  return settings as unknown as BadgeSettings;
}
