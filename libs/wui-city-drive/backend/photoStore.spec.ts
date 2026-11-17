// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeJpeg, photoFileName, safePart, savePhoto } from './photoStore';

const AT = new Date(2026, 10, 18, 9, 5, 7);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9]);

describe('photo booth store', () => {
  it('names the photo after the email, else after the nickname', () => {
    expect(photoFileName('Aurel.M@Example.com', 'Aurel', AT)).toBe('aurel.m@example.com_20261118-090507.jpg');
    expect(photoFileName('', 'Léa Z.', AT)).toBe('no-email_l_a_z._20261118-090507.jpg');
    expect(photoFileName('not an email', '', AT)).toBe('no-email_player_20261118-090507.jpg');
  });

  it('never lets a name leave the folder', () => {
    expect(safePart('../../etc/passwd')).toBe('etc_passwd');
    expect(safePart('a/b\\c..d')).toBe('a_b_c.d');
    expect(photoFileName('../x@y.z', '', AT).includes('/')).toBe(false);
  });

  it('accepts a JPEG only', () => {
    expect(decodeJpeg(`data:image/jpeg;base64,${JPEG.toString('base64')}`)?.length).toBe(JPEG.length);
    expect(decodeJpeg(Buffer.from('GIF89a').toString('base64'))).toBeNull();
    expect(decodeJpeg('<script>')).toBeNull();
  });

  it('keeps both photos of the same email taken in the same second', () => {
    const root = mkdtempSync(join(tmpdir(), 'cd-photos-'));
    const a = savePhoto('a@b.co', '', JPEG, AT, root);
    const b = savePhoto('a@b.co', '', JPEG, AT, root);
    expect(a).not.toBe(b);
    expect(readdirSync(root).sort()).toEqual([a, b].sort());
  });
});
