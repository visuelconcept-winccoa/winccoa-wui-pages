// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// fleetSettings — each user's own choices of the fleet pages (filters, bubbles,
// display toggles, analysis selections), kept in WinCC OA's user settings
// -----------------------------------------------------------------------------
// The same mechanism as the work centres' (winccoa-fra-msp-stma, wui-workcenters
// backend/userSettings.ts) and the badge of wui-auth-badge: one DP
// `_usr_<UserId>_<setting>` of type `_UserDefinedSettings` per user and setting,
// its value in `.Content` (dyn_string, the JSON in the first element; further
// elements, if any, are concatenated on read), the base definition
// `_uss_<setting>` created on first need. Unlike the work centres, the user's DP
// also gets `.Format`, `.FullName` and `.SettingName` when it is created, as
// WinCC OA's usr_addNewSetting (scripts/libs/uss_userSettings.ctl) writes them:
// uss_getUserSettings files a user's settings under their `.SettingName`.
//
// The user is the one of the request's WebUI token (fleetGuard.requestIdentity):
// each user reads and writes only their own, and finds them on another
// workstation. No user id is accepted from the page. Only the keys declared in
// FLEET_SETTINGS exist (404 otherwise): the page cannot create a DP of its
// choosing. No role is required: these are the caller's own display choices.
// Mounted under `/api/ai/fleet/settings` (aiRoute.ts).
// -----------------------------------------------------------------------------

import { WsjServerGlobal } from '@winccoa/backend';
import { Request, Response } from 'ultimate-express';

import { requestIdentity } from './fleetGuard';

/** What the store needs of WinCC OA (a subset of WinccoaManager). */
export interface OaSettingsApi {
  dpExists(dp: string): boolean;
  dpCreate(dp: string, dpt: string): Promise<boolean>;
  dpGet(dpe: string): Promise<unknown>;
  dpSetWait(dpe: string | string[], value: unknown): Promise<unknown>;
}

export interface SettingDef {
  /** WinCC OA setting name (`_uss_<setting>`, `_usr_<UserId>_<setting>`). */
  setting: string;
  /** Label of the setting (`.FullName`). */
  fullName: string;
}

/** Setting keys the pages may use. A new screen adds its own here. */
export const FLEET_SETTINGS: Readonly<Record<string, SettingDef>> = Object.freeze({
  'fleet-filter': { setting: 'WUI_MF_FILTER', fullName: 'Filtres du parc machine (étiquettes et états)' },
  'fleet-ateliers': { setting: 'WUI_MF_ATELIERS', fullName: 'Affichage des ateliers' },
  'fleet-dashboard': { setting: 'WUI_MF_DASHBOARD', fullName: 'Filtres du dashboard machine' },
  'fleet-stop-analysis': { setting: 'WUI_MF_STOP_ANALYSIS', fullName: "Sélection de l'analyse des arrêts" },
  'fleet-kpi-analysis': { setting: 'WUI_MF_KPI_ANALYSIS', fullName: "Sélection de l'analyse des KPI" },
  'fleet-closures': { setting: 'WUI_MF_CLOSURES', fullName: 'Sélection des fermetures' },
  'fleet-views': { setting: 'WUI_MF_VIEWS', fullName: 'Points de vue personnels et page par défaut' }
});

export const SETTINGS_DPT = '_UserDefinedSettings';
/** `.Format` of a text setting. */
const TEXT_FORMAT = 'S';

/** Largest value accepted (JSON), in characters. */
export const MAX_SETTING_CHARS = 16_000;

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_LARGE = 413;
const HTTP_UNAVAILABLE = 503;

/** The user of the request (subset of AppSecurityIdentity). */
export interface SettingsUser {
  username: string;
  userId: number;
}

function unwrap(raw: unknown): unknown {
  return raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw ? (raw as { value: unknown }).value : raw;
}

/** The four elements usr_addNewSetting writes, for `dp` (base or user DP). */
function definition(dp: string, def: SettingDef, content: string): [string[], unknown[]] {
  return [
    ['Content', 'Format', 'FullName', 'SettingName'].map((e) => `${dp}.${e}`),
    [[content], TEXT_FORMAT, def.fullName, def.setting]
  ];
}

export class UserSettingsStore {
  private readonly ready = new Map<string, Promise<void>>();

  constructor(private readonly oa: () => OaSettingsApi) {}

  /** Base definition `_uss_<setting>`, created on first need. */
  ensureSetting(def: SettingDef): Promise<void> {
    let ready = this.ready.get(def.setting);
    if (!ready) {
      ready = (async () => {
        const oa = this.oa();
        const base = `_uss_${def.setting}`;
        if (oa.dpExists(base)) return;
        if (!(await oa.dpCreate(base, SETTINGS_DPT))) throw new Error(`creation of ${base} refused`);
        await oa.dpSetWait(...definition(base, def, ''));
        console.info(`[machine-fleet-3d] user setting ${base} created`);
      })().catch((error: unknown) => {
        this.ready.delete(def.setting);
        throw error;
      });
      this.ready.set(def.setting, ready);
    }
    return ready;
  }

  /** A user's value, null when they have none or it is not readable JSON. */
  async read(userId: number, def: SettingDef): Promise<unknown> {
    const oa = this.oa();
    const dp = `_usr_${userId}_${def.setting}`;
    if (!oa.dpExists(dp)) return null;
    const raw = unwrap(await oa.dpGet(`${dp}.Content`));
    const text = (Array.isArray(raw) ? raw.map(String).join('') : String(raw ?? '')).trim();
    if (!text) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      console.warn(`[machine-fleet-3d] user setting ${dp} unreadable, ignored`);
      return null;
    }
  }

  /** Write a user's value, creating their DP (with its name, format and label) when they have none. */
  async write(userId: number, def: SettingDef, value: unknown): Promise<void> {
    await this.ensureSetting(def);
    const oa = this.oa();
    const dp = `_usr_${userId}_${def.setting}`;
    const content = value === null || value === undefined ? '' : JSON.stringify(value);
    if (oa.dpExists(dp)) {
      await oa.dpSetWait(`${dp}.Content`, [content]);
      return;
    }
    if (!(await oa.dpCreate(dp, SETTINGS_DPT))) throw new Error(`creation of ${dp} refused`);
    await oa.dpSetWait(...definition(dp, def, content));
  }
}

/** A route's answer: HTTP status and JSON body. */
export interface SettingsAnswer {
  status: number;
  body: Record<string, unknown>;
}

const NO_USER: SettingsAnswer = { status: HTTP_UNAUTHORIZED, body: { ok: false, error: 'unidentified user (no valid WebUI token)' } };
const unknownKey = (key: string): SettingsAnswer => ({ status: HTTP_NOT_FOUND, body: { ok: false, error: `unknown setting: ${key}` } });

/** GET /settings/:key — the value of the token's user (null when they have none). */
export async function getSetting(store: UserSettingsStore, user: SettingsUser | null, key: string): Promise<SettingsAnswer> {
  const def = FLEET_SETTINGS[key];
  if (!def) return unknownKey(key);
  if (!user) return NO_USER;
  return { status: 200, body: { ok: true, key, user: user.username, value: await store.read(user.userId, def) } };
}

/** PUT /settings/:key { value } — store the value of the token's user. */
export async function putSetting(store: UserSettingsStore, user: SettingsUser | null, key: string, body: unknown): Promise<SettingsAnswer> {
  const def = FLEET_SETTINGS[key];
  if (!def) return unknownKey(key);
  if (!user) return NO_USER;
  if (!body || typeof body !== 'object' || !('value' in body)) return { status: HTTP_BAD_REQUEST, body: { ok: false, error: 'value expected' } };
  const value = (body as { value: unknown }).value;
  const size = JSON.stringify(value ?? null).length;
  if (size > MAX_SETTING_CHARS) return { status: HTTP_TOO_LARGE, body: { ok: false, error: `setting too large (${size} > ${MAX_SETTING_CHARS} characters)` } };
  await store.write(user.userId, def, value);
  return { status: 200, body: { ok: true, key, user: user.username } };
}

/** Express handlers of `/fleet/settings/:key`, on the webserver's WinCC OA connection. */
export class FleetSettingsController {
  private readonly store = new UserSettingsStore(() => WsjServerGlobal.winccoa as OaSettingsApi);

  private async user(req: Request): Promise<SettingsUser | null> {
    const who = await requestIdentity(req);
    return who.username && who.userId >= 0 ? { username: who.username, userId: who.userId } : null;
  }

  private async answer(res: Response, run: () => Promise<SettingsAnswer>): Promise<void> {
    try {
      const { status, body } = await run();
      res.status(status).json(body);
    } catch (error) {
      console.warn('[machine-fleet-3d] user settings:', (error as Error)?.message ?? error);
      res.status(HTTP_UNAVAILABLE).json({ ok: false, error: 'unavailable', message: String((error as Error)?.message ?? error) });
    }
  }

  get = (req: Request, res: Response): Promise<void> =>
    this.answer(res, async () => getSetting(this.store, await this.user(req), String(req.params['key'] ?? '')));

  put = (req: Request, res: Response): Promise<void> =>
    this.answer(res, async () => putSetting(this.store, await this.user(req), String(req.params['key'] ?? ''), req.body));
}
