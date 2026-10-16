// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// badgeHash — the badge numbers stored as a one-way fingerprint ("Chiffrer les
// codes badge" on the Badges page, the `hashBadges` setting):
//
//   $hmac-sha256$<hex>   HMAC-SHA256 of the number with the server's secret key
//
// One-way: the number cannot be read back — turning the option off keeps the
// fingerprints. Deterministic: a presented badge is looked up and a duplicate
// refused as before. Keyed: a badge has few possible numbers (10^8 for eight
// digits), a plain hash would be reversed by trying them all; without the key,
// it cannot.
//
// The key: WUI_BADGE_HASH_KEY in the webserver's environment, else the file
// `wui-auth-badge.key` beside the project's config file (PVSS_II), 32 random
// bytes generated when the option is first turned on. Losing it makes every
// fingerprint useless: those badges must be enrolled again — back the file up
// with the project.
//
// Matching (`matches`): option on, only fingerprints match (the clear numbers
// were all rewritten when it was turned on); option off, a stored value
// matches in clear or as a fingerprint.
// -----------------------------------------------------------------------------

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export const HASH_PREFIX = '$hmac-sha256$';
const KEY_FILE = 'wui-auth-badge.key';
const KEY_BYTES = 32;

/** A stored value that is a fingerprint, not a number in clear. */
export function isHashed(stored: string): boolean {
  return stored.startsWith(HASH_PREFIX);
}

/** The fingerprint of a badge number. */
export function hashUid(uid: string, key: Buffer): string {
  return HASH_PREFIX + createHmac('sha256', key).update(uid.trim(), 'utf8').digest('hex');
}

/**
 * Does a stored value stand for the presented number? `hashOnly`: the option
 * is on — a value in clear no longer opens anything. `key` null: no key yet,
 * so no fingerprint can match.
 */
export function matches(stored: string, uid: string, key: Buffer | null, hashOnly: boolean): boolean {
  const value = stored.trim();
  if (isHashed(value)) return key !== null && sameText(value, hashUid(uid, key));
  return !hashOnly && value !== '' && sameText(value, uid.trim());
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

// --- the key -----------------------------------------------------------------------

let cachedKey: Buffer | null = null;

/** Where the key file lives: beside the project's config file; null outside a WinCC OA project. */
export function keyFilePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const config = env['PVSS_II'];
  return config ? path.join(path.dirname(config), KEY_FILE) : null;
}

/**
 * The secret key; `create`: generated (file mode 0600) when there is none yet —
 * only when hashing is turned on or a badge is hashed, never just to compare
 * (a new key would silently orphan the fingerprints of a lost one).
 * null when there is none and `create` is false.
 */
export function hashKey(create: boolean, env: NodeJS.ProcessEnv = process.env): Buffer | null {
  if (cachedKey) return cachedKey;
  const fromEnv = env['WUI_BADGE_HASH_KEY']?.trim();
  if (fromEnv) return (cachedKey = Buffer.from(fromEnv, 'utf8'));
  const file = keyFilePath(env);
  if (!file) {
    if (create) throw new Error('no badge hash key: set WUI_BADGE_HASH_KEY (no PVSS_II to keep a key file beside)');
    return null;
  }
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/i.test(text)) throw new Error(`${file}: not a badge hash key (64 hex digits)`);
    return (cachedKey = Buffer.from(text, 'hex'));
  }
  if (!create) return null;
  const key = randomBytes(KEY_BYTES);
  // `wx`: never overwrite a key another webserver wrote meanwhile.
  fs.writeFileSync(file, `${key.toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
  console.info(`[auth-badge] badge hash key created: ${file} — back it up with the project`);
  return (cachedKey = key);
}

/** Tests only: forget the loaded key. */
export function resetHashKeyCache(): void {
  cachedKey = null;
}
