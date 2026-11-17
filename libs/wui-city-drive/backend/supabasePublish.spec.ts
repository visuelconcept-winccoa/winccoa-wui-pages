// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backoff, drain, objectPath, photoStatus, publicUrl, queuePhoto, readSupabaseConfig, uploadHeaders } from './supabasePublish';

const CONFIG = `[general]\nfoo = 1\n[cityDriveSupabase]\nurl = "https://abc.supabase.co/"\nkey = "sb_publishable_x"\n# comment\nbucket = "photos"\n`;
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0xff, 0xd9]);

function project(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cd-supa-'));
  writeFileSync(join(dir, 'config'), config);
  process.env['PVSS_II'] = join(dir, 'config');
  process.env['CITY_DRIVE_PHOTOS'] = join(dir, 'photos');
  return dir;
}

afterEach(() => vi.unstubAllGlobals());

describe('supabase publication', () => {
  it('reads its section of the project config file', () => {
    expect(readSupabaseConfig(CONFIG)).toEqual({ url: 'https://abc.supabase.co', key: 'sb_publishable_x', bucket: 'photos', signedDays: 0 });
    expect(readSupabaseConfig(`${CONFIG}signedDays = 7\n`)?.signedDays).toBe(7);
    expect(readSupabaseConfig('[cityDriveSupabase]\nurl = "http://insecure"\nkey = "k"\n')).toBeNull();
    expect(readSupabaseConfig('')).toBeNull();
  });

  it('names an object by date and a random id, and builds its public link', () => {
    expect(objectPath('0b5f…', new Date('2026-11-17T23:10:00Z'))).toBe('2026-11-17/0b5f….jpg');
    const cfg = readSupabaseConfig(CONFIG)!;
    expect(publicUrl(cfg, '2026-11-17/a.jpg')).toBe('https://abc.supabase.co/storage/v1/object/public/photos/2026-11-17/a.jpg');
  });

  it('sends a new key in apikey only, a legacy JWT key also as Bearer', () => {
    expect(uploadHeaders('sb_publishable_x').Authorization).toBeUndefined();
    expect(uploadHeaders('eyJhbGciOi').Authorization).toBe('Bearer eyJhbGciOi');
    expect([1, 2, 3, 4, 5, 9].map(backoff)).toEqual([5000, 10000, 20000, 40000, 60000, 60000]);
  });

  it('keeps a photo pending while offline, then publishes it', async () => {
    const dir = project(CONFIG);
    const fetch = vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const q = queuePhoto(JPEG, new Date('2026-11-18T10:00:00Z'))!;
    await drain(); // the pass the worker started on queueing
    expect(q.url).toMatch(/^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/public\/photos\/2026-11-18\/[0-9a-f-]{36}\.jpg$/);
    expect(photoStatus(q.id)).toMatchObject({ state: 'pending', error: 'fetch failed', attempts: 1 });
    await drain(Date.now() + 60_000);
    expect(photoStatus(q.id)).toMatchObject({ state: 'published', url: q.url });
    expect(readdirSync(join(dir, 'photos', 'pending'))).toEqual([]);
    expect(fetch.mock.calls[1][0]).toBe(`https://abc.supabase.co/storage/v1/object/photos/${q.url!.split('/photos/')[1]}`);
  });
});
