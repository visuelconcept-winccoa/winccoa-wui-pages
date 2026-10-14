// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// oaAuth — what a login provider's backend needs from WinCC OA (the same file
// in wui-auth-badge and wui-auth-hello: keep them equal).
//
//   signWebUiToken(user, dbrw)   the WebUI token of a user the provider
//                                recognised — signed by the CTRL function
//                                /WebUI_Token itself calls after a password
//                                (same key, same login permission check)
//   sessionUser(req)             the user of the WebUI token the request
//                                carries (Authorization: Bearer <jwt>) — for
//                                what a logged-in user does to their own account
//   userById / userByName        the WinCC OA user directory (_Users)
//   readUserSetting / writeUserSetting
//                                a user's setting (WinCC OA 3.21 user settings:
//                                one `_UserDefinedSettings` DP per setting and
//                                user, `_usr_<UserId>_<setting>`, its `.Content`)
//   audit(…)                     a line in an `_AuditTrail` DP — best effort;
//                                the DP: `auditDp` of the project's config
//                                section [wui-auth], else WUI_AUTH_AUDIT_DP,
//                                else AuditTrail_Auth
//   clientAddress(req)
// -----------------------------------------------------------------------------

import * as fs from 'node:fs';
import { WsjServerGlobal } from '@winccoa/backend';
import { Request } from 'ultimate-express';
import { WinccoaCtrlScript, WinccoaCtrlType } from 'winccoa-manager';

export interface OaUser {
  username: string;
  fullName: string;
  userId: number;
  enabled: boolean;
}

const SETTINGS_DPT = '_UserDefinedSettings';

// --- CTRL: the WebUI token -----------------------------------------------------

let signScript: WinccoaCtrlScript | null = null;
let verifyScript: WinccoaCtrlScript | null = null;

/**
 * NEVER call WebUiHttpEndpoints::initEndpointData here: it creates a key store
 * for the port, which generates a key pair and PUBLISHES its public key in
 * _WebUI_PublicKey_<host>_<port> — replacing the WebUI server's own, so that no
 * token (password logins included) is accepted until that server restarts.
 */
/**
 * The WebUI token of `username`, '' when refused: no WebUI login permission
 * (or no write permission when `dbrw`), or the server's key store unavailable.
 */
export async function signWebUiToken(username: string, dbrw: boolean): Promise<string> {
  signScript ??= new WinccoaCtrlScript(
    WsjServerGlobal.winccoa,
    `#uses "classes/wssServer/WebUiHttpEndpoints"
     string main(string userName, int checkCanWrite)
     {
       WssWebUiToken token;
       if (!WebUiHttpEndpoints::createWebUiToken(token, userName, 0, checkCanWrite == 1)) return "";
       return token.isValid() ? token.jwtString() : "";
     }`,
    'wuiAuthSignToken'
  );
  const token = await signScript.start('main', [username, dbrw ? 1 : 0], [WinccoaCtrlType.string, WinccoaCtrlType.int]);
  return String(token ?? '');
}

/** The user name a WebUI token was issued for, '' when it is not valid (signature, expiry). */
export async function verifyWebUiToken(jwt: string): Promise<string> {
  verifyScript ??= new WinccoaCtrlScript(
    WsjServerGlobal.winccoa,
    `#uses "classes/wssServer/WebUiHttpEndpoints"
     string main(string jwt)
     {
       WssWebUiToken token = WssJwksKeyStore::decodeToken(jwt);
       return token.isValid() ? token.userName() : "";
     }`,
    'wuiAuthVerifyToken'
  );
  return String((await verifyScript.start('main', [jwt], [WinccoaCtrlType.string])) ?? '');
}

/** The enabled user of the request's WebUI token (`Authorization: Bearer <jwt>`), or null. */
export async function sessionUser(req: Request): Promise<OaUser | null> {
  const header = req.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  const jwt = /^Bearer\s+(\S+)$/i.exec(value ?? '')?.[1];
  if (!jwt) return null;
  const username = await verifyWebUiToken(jwt);
  if (!username) return null;
  const user = await userByName(username);
  return user?.enabled ? user : null;
}

// --- the user directory --------------------------------------------------------

/** Bare value of a dpGet result (some come wrapped in { value }). */
function unwrap(raw: unknown): unknown {
  return raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw
    ? (raw as { value: unknown }).value
    : raw;
}

export function asArray(raw: unknown): unknown[] {
  const value = unwrap(raw);
  return Array.isArray(value) ? value : [];
}

/** The text of a label that may be multilingual. */
function asText(raw: unknown): string {
  if (raw && typeof raw === 'object') {
    const first = Object.values(raw as Record<string, unknown>)[0];
    return first === undefined ? '' : String(first);
  }
  return raw === undefined || raw === null ? '' : String(raw);
}

async function users(): Promise<OaUser[]> {
  const winccoa = WsjServerGlobal.winccoa;
  const [names, fullNames, ids, enabled] = (
    await Promise.all(
      ['_Users.UserName', '_Users.FullName', '_Users.UserId', '_Users.Enabled'].map((dpe) => winccoa.dpGet(dpe))
    )
  ).map(asArray);
  return names.map((name, index) => ({
    username: asText(name),
    fullName: asText(fullNames[index]),
    userId: Number(ids[index]),
    enabled: enabled[index] !== false
  }));
}

/** A WinCC OA user — never root (UserId 0): it opens no WebUI session this way. */
export async function userById(userId: number): Promise<OaUser | undefined> {
  if (!(userId > 0)) return undefined;
  return (await users()).find((user) => user.userId === userId && user.username);
}

export async function userByName(username: string): Promise<OaUser | undefined> {
  return (await users()).find((user) => user.username === username && user.userId > 0);
}

// --- user settings ---------------------------------------------------------------

const settingReady = new Map<string, Promise<void>>();

/**
 * The base definition `_uss_<setting>` of a user setting, created at first need
 * with the values uss_addNewSetting would write (format `S`: text).
 */
function ensureSetting(setting: string, fullName: string): Promise<void> {
  let ready = settingReady.get(setting);
  if (!ready) {
    ready = (async () => {
      const winccoa = WsjServerGlobal.winccoa;
      const base = `_uss_${setting}`;
      if (winccoa.dpExists(base)) return;
      if (!(await winccoa.dpCreate(base, SETTINGS_DPT))) throw new Error(`creating ${base} was refused`);
      await winccoa.dpSetWait(
        ['Content', 'Format', 'FullName', 'SettingName'].map((element) => `${base}.${element}`),
        [[''], 'S', fullName, setting]
      );
      console.info(`[wui-auth] user setting ${base} created`);
    })().catch((error: unknown) => {
      settingReady.delete(setting);
      throw error;
    });
    settingReady.set(setting, ready);
  }
  return ready;
}

/** Every user's value of `setting`: UserId → `.Content`. */
export async function readUserSettings(setting: string, fullName: string): Promise<Map<number, string[]>> {
  await ensureSetting(setting, fullName);
  const winccoa = WsjServerGlobal.winccoa;
  const dps: string[] = winccoa.dpNames(`_usr_*_${setting}`, SETTINGS_DPT);
  const values = new Map<number, string[]>();
  if (dps.length === 0) return values;
  const contents = asArray(await winccoa.dpGet(dps.map((dp) => `${dp}.Content`)));
  const userIdOf = new RegExp(`_usr_(\\d+)_${setting}$`);
  dps.forEach((dp, index) => {
    const userId = Number(userIdOf.exec(dp)?.[1] ?? -1);
    if (userId > 0) values.set(userId, asArray(contents[index]).map(String).filter((value) => value.trim() !== ''));
  });
  return values;
}

/** Writes a user's value of `setting`, creating their DP when it has none. */
export async function writeUserSetting(userId: number, setting: string, fullName: string, content: string[]): Promise<void> {
  await ensureSetting(setting, fullName);
  const winccoa = WsjServerGlobal.winccoa;
  const dp = `_usr_${userId}_${setting}`;
  if (!winccoa.dpExists(dp) && !(await winccoa.dpCreate(dp, SETTINGS_DPT))) {
    throw new Error(`creating ${dp} was refused`);
  }
  await winccoa.dpSetWait(`${dp}.Content`, content.length > 0 ? content : ['']);
}

// --- audit ------------------------------------------------------------------------

/**
 * The `_AuditTrail` DP the login events go to — when it exists: set in the
 * project's config file, versioned with the project,
 *
 *   [wui-auth]
 *   auditDp = "AuditTrail_MSP"
 *
 * else WUI_AUTH_AUDIT_DP in the webserver's environment, else AuditTrail_Auth.
 * Read once, at the webserver's start.
 */
const AUDIT_DP = projectConfig('wui-auth', 'auditDp') ?? process.env['WUI_AUTH_AUDIT_DP'] ?? 'AuditTrail_Auth';
const AUDIT_LEAVES = ['time', 'username', 'uinum', 'batchid', 'item', 'itemtype', 'action', 'oldval', 'newval', 'reason', 'host'];
let lastAuditTime = 0;

export interface AuditLine {
  action: string;
  username?: string;
  userId?: number;
  item?: string;
  host: string;
  reason: string;
}

/** A line in the security category of the audit trail — never a secret (badge number, key). Never throws. */
export async function audit(line: AuditLine): Promise<void> {
  try {
    const winccoa = WsjServerGlobal.winccoa;
    if (!winccoa.dpExists(AUDIT_DP)) return;
    lastAuditTime = Math.max(Date.now(), lastAuditTime + 1);
    const values: unknown[] = [
      new Date(lastAuditTime), line.username ?? '', line.userId ?? 0, 0,
      line.item ?? '', 'Sécurité', line.action, '', '', line.reason, line.host
    ];
    await winccoa.dpSetWait(AUDIT_LEAVES.map((leaf) => `${AUDIT_DP}.${leaf}`), values);
  } catch (error) {
    console.warn('[wui-auth] audit line not written', error);
  }
}

/**
 * A value of the project's config file (PVSS_II, `config/config`): `key = "value"`
 * in `[section]` — the last one wins, as WinCC OA reads it; undefined when absent.
 */
export function projectConfig(section: string, key: string): string | undefined {
  const file = process.env['PVSS_II'];
  if (!file) return undefined;
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  let current = '';
  let found: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('//')) continue;
    const header = /^\[([^\]]+)\]/.exec(line);
    if (header) {
      current = header[1].trim();
      continue;
    }
    if (current !== section) continue;
    const entry = /^([A-Za-z_][\w.]*)\s*=\s*(?:"([^"]*)"|(\S+))/.exec(line);
    if (entry && entry[1] === key) found = entry[2] ?? entry[3];
  }
  return found;
}

export function clientAddress(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (first ?? req.ip ?? '').trim();
}
