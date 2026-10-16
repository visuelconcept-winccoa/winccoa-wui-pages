// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HASH_PREFIX, hashKey, hashUid, isHashed, matches, resetHashKeyCache } from './badgeHash';

const KEY = Buffer.alloc(32, 7);

describe('hashUid', () => {
  it('is a keyed, deterministic fingerprint', () => {
    const hashed = hashUid('12345678', KEY);
    expect(hashed.startsWith(HASH_PREFIX)).toBe(true);
    expect(hashed).toMatch(/^\$hmac-sha256\$[0-9a-f]{64}$/);
    expect(hashUid(' 12345678 ', KEY)).toBe(hashed);
    expect(hashUid('12345678', Buffer.alloc(32, 8))).not.toBe(hashed);
    expect(hashed).not.toContain('12345678');
    expect(isHashed(hashed)).toBe(true);
    expect(isHashed('12345678')).toBe(false);
  });
});

describe('matches', () => {
  const hashed = hashUid('12345678', KEY);

  it('option off: in clear or as a fingerprint', () => {
    expect(matches('12345678', '12345678', KEY, false)).toBe(true);
    expect(matches(hashed, '12345678', KEY, false)).toBe(true);
    expect(matches('12345678', '87654321', KEY, false)).toBe(false);
    expect(matches(hashed, '87654321', KEY, false)).toBe(false);
  });

  it('option on: fingerprints only', () => {
    expect(matches(hashed, '12345678', KEY, true)).toBe(true);
    expect(matches('12345678', '12345678', KEY, true)).toBe(false);
  });

  it('no key: no fingerprint matches, clear numbers still do (option off)', () => {
    expect(matches(hashed, '12345678', null, false)).toBe(false);
    expect(matches('12345678', '12345678', null, false)).toBe(true);
  });

  it('an empty stored value never matches', () => {
    expect(matches('', '', KEY, false)).toBe(false);
  });
});

describe('hashKey', () => {
  const dirs: string[] = [];
  const project = (): NodeJS.ProcessEnv => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'badge-key-'));
    dirs.push(dir);
    return { PVSS_II: path.join(dir, 'config') };
  };
  afterEach(() => {
    resetHashKeyCache();
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  it('is not created just to compare', () => {
    const env = project();
    expect(hashKey(false, env)).toBeNull();
    expect(fs.readdirSync(path.dirname(env['PVSS_II'] as string))).toEqual([]);
  });

  it('is created once beside the config file, then read back', () => {
    const env = project();
    const key = hashKey(true, env);
    expect(key?.length).toBe(32);
    const file = path.join(path.dirname(env['PVSS_II'] as string), 'wui-auth-badge.key');
    expect(fs.readFileSync(file, 'utf8').trim()).toBe(key?.toString('hex'));
    resetHashKeyCache();
    expect(hashKey(false, env)?.equals(key as Buffer)).toBe(true);
  });

  it('prefers WUI_BADGE_HASH_KEY', () => {
    const env = { ...project(), WUI_BADGE_HASH_KEY: 'secret' };
    expect(hashKey(true, env)?.toString('utf8')).toBe('secret');
  });

  it('refuses a malformed key file', () => {
    const env = project();
    fs.writeFileSync(path.join(path.dirname(env['PVSS_II'] as string), 'wui-auth-badge.key'), 'nope');
    expect(() => hashKey(false, env)).toThrow(/not a badge hash key/);
  });

  it('cannot create a key outside a WinCC OA project', () => {
    expect(() => hashKey(true, {})).toThrow(/WUI_BADGE_HASH_KEY/);
    expect(hashKey(false, {})).toBeNull();
  });
});
