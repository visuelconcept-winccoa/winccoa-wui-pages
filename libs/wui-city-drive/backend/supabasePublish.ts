// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// SupabasePublish — the souvenir photos published to Supabase Storage (#92).
// -----------------------------------------------------------------------------
// The photo booth's photo is saved locally (photoStore.ts) and published to a
// public Supabase Storage bucket, so that the player gets it by scanning a QR
// code at the end of the match. This file is the webserver backend's side:
//
//   1. queue(): the JPEG goes to <photos>/pending/<uuid>.jpg with a <uuid>.json
//      beside it ({ path, attempts, nextAt, lastError }). The object path —
//      <YYYY-MM-DD>/<uuid>.jpg, a random v4 UUID, not guessable — and hence the
//      public URL are known at once: the page shows the QR code even before the
//      upload is done (it works as soon as the file is there).
//   2. a worker (every 3 s) uploads what is due with Supabase Storage's HTTP API
//      (POST /storage/v1/object/<bucket>/<path>, the API supabase-js calls);
//      on success both pending files are removed and a line is appended to
//      <photos>/published.jsonl; on failure (no network…) it retries with a
//      back-off of 5 s, 10 s, 20 s … up to 60 s, forever — the photos survive a
//      webserver restart (the queue is on disk).
//   3. status(): uploading / published / pending (with the last error) for the page.
//
// Credentials: never in the code nor in the repository — the project's config
// file (PVSS_II, config/config), section [cityDriveSupabase]:
//
//   [cityDriveSupabase]
//   url = "https://<project-ref>.supabase.co"
//   key = "sb_publishable_…"       publishable (or legacy anon) key, allowed to INSERT
//   bucket = "photos"              into this public bucket only (see the README)
//   signedDays = 0                 0: public bucket, the link is the public URL (known at
//                                  once). N > 0: PRIVATE bucket — after the upload the
//                                  backend asks Supabase for a signed link valid N days
//                                  (the key must then be allowed to read: a secret key);
//                                  the QR code appears once the photo is uploaded.
//
// The new keys (sb_publishable_ / sb_secret_) are sent in the `apikey` header
// only; a legacy JWT key (anon) is also sent as `Authorization: Bearer`.
// -----------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { photoRoot } from './photoStore';

export const CONFIG_SECTION = 'cityDriveSupabase';
const WORKER_MS = 3000;
const BACKOFF_MIN_MS = 5000;
const BACKOFF_MAX_MS = 60_000;
const UPLOAD_TIMEOUT_MS = 30_000;

export interface SupabaseConfig {
  url: string;
  key: string;
  bucket: string;
  /** 0 = public bucket; N = private bucket, signed links valid N days. */
  signedDays: number;
}

/** A photo waiting for its upload (the .json beside the .jpg in pending/). */
export interface PendingPhoto {
  id: string;
  path: string;
  attempts: number;
  /** Epoch ms of the next attempt. */
  nextAt: number;
  lastError: string;
}

export type PublishState = 'uploading' | 'published' | 'pending' | 'unknown';

/**
 * A value of the project's config file (PVSS_II = <project>/config/config): `key = "value"`
 * in `[section]`, the last one winning as WinCC OA reads it; undefined when absent.
 */
export function projectConfig(section: string, key: string, text?: string): string | undefined {
  let content = text;
  if (content === undefined) {
    const file = process.env['PVSS_II'];
    if (!file) return undefined;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      return undefined;
    }
  }
  let current = '';
  let found: string | undefined;
  for (const raw of content.split(/\r?\n/)) {
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

/** The [cityDriveSupabase] section, or null when it is missing or incomplete. */
export function readSupabaseConfig(text?: string): SupabaseConfig | null {
  const url = (projectConfig(CONFIG_SECTION, 'url', text) ?? '').trim().replace(/\/+$/, '');
  const key = (projectConfig(CONFIG_SECTION, 'key', text) ?? '').trim();
  const bucket = (projectConfig(CONFIG_SECTION, 'bucket', text) ?? 'photos').trim() || 'photos';
  const days = Number(projectConfig(CONFIG_SECTION, 'signedDays', text) ?? 0);
  if (!/^https:\/\/[\w.-]+$/.test(url) || key === '' || !/^[\w.-]+$/.test(bucket)) return null;
  return { url, key, bucket, signedDays: Number.isFinite(days) && days > 0 ? Math.min(365, Math.floor(days)) : 0 };
}

/** The object path of a photo: `<YYYY-MM-DD>/<uuid>.jpg` (UTC date). */
export function objectPath(id: string, at: Date): string {
  return `${at.toISOString().slice(0, 10)}/${id}.jpg`;
}

/** Its public URL (the bucket is public: readable by whoever has the link). */
export function publicUrl(cfg: SupabaseConfig, path: string): string {
  return `${cfg.url}/storage/v1/object/public/${encodeURIComponent(cfg.bucket)}/${path}`;
}

/** The headers of an upload: the new keys in `apikey` only, a legacy JWT key also as Bearer. */
export function uploadHeaders(key: string): Record<string, string> {
  const headers: Record<string, string> = { apikey: key, 'Content-Type': 'image/jpeg', 'x-upsert': 'false', 'cache-control': '3600' };
  if (key.startsWith('eyJ')) headers['Authorization'] = `Bearer ${key}`;
  return headers;
}

/** The next delay after `attempts` failures: 5 s, 10 s, 20 s, 40 s, then 60 s. */
export const backoff = (attempts: number): number => Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** Math.max(0, attempts - 1));

const pendingDir = (): string => resolve(photoRoot(), 'pending');
const ID_RE = /^[0-9a-f-]{36}$/;

/** Photos published since the webserver started (their link), and the one being uploaded. */
const published = new Map<string, string>();
let uploading: string | null = null;

/**
 * Queues a photo for publication; returns its id and link — the public URL at once for a public
 * bucket, null for a private one (its signed link comes with the status once uploaded). Null
 * altogether when Supabase is not configured: the photo is then only kept locally.
 */
export function queuePhoto(jpeg: Buffer, at = new Date()): { id: string; url: string | null } | null {
  const cfg = readSupabaseConfig();
  if (!cfg) return null;
  const id = randomUUID();
  const dir = pendingDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const item: PendingPhoto = { id, path: objectPath(id, at), attempts: 0, nextAt: 0, lastError: '' };
  // the photo first, then its descriptor: the worker only takes a photo whose descriptor exists
  writeFileSync(resolve(dir, `${id}.jpg.part`), jpeg);
  renameSync(resolve(dir, `${id}.jpg.part`), resolve(dir, `${id}.jpg`));
  writeFileSync(resolve(dir, `${id}.json`), JSON.stringify(item));
  ensureWorker();
  return { id, url: cfg.signedDays > 0 ? null : publicUrl(cfg, item.path) };
}

/** Where a photo stands: uploading, published, or pending (with the last error). */
export function photoStatus(id: string): { state: PublishState; error: string; attempts: number; url: string | null } {
  if (!ID_RE.test(id)) return { state: 'unknown', error: '', attempts: 0, url: null };
  if (uploading === id) return { state: 'uploading', error: '', attempts: 0, url: null };
  const link = published.get(id);
  if (link) return { state: 'published', error: '', attempts: 0, url: link };
  const item = readPending(id);
  if (item) return { state: 'pending', error: item.lastError, attempts: item.attempts, url: null };
  return { state: 'unknown', error: '', attempts: 0, url: null };
}

/** A signed link to a photo of a private bucket, valid `days` (Storage's sign API). */
async function signedUrl(cfg: SupabaseConfig, path: string): Promise<string> {
  const res = await fetch(`${cfg.url}/storage/v1/object/sign/${encodeURIComponent(cfg.bucket)}/${path}`, {
    method: 'POST',
    headers: { ...uploadHeaders(cfg.key), 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: cfg.signedDays * 86_400 }),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
  });
  if (!res.ok) throw new Error(`Supabase sign ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
  const rel = body.signedURL ?? body.signedUrl ?? '';
  if (!rel) throw new Error('Supabase sign: no link in the answer');
  return rel.startsWith('http') ? rel : `${cfg.url}/storage/v1${rel.startsWith('/') ? '' : '/'}${rel}`;
}

function readPending(id: string): PendingPhoto | null {
  try {
    return JSON.parse(readFileSync(resolve(pendingDir(), `${id}.json`), 'utf8')) as PendingPhoto;
  } catch {
    return null;
  }
}

/** One upload with Supabase Storage's HTTP API; a 409 (already there) counts as done. */
async function upload(cfg: SupabaseConfig, item: PendingPhoto, jpeg: Buffer): Promise<void> {
  const res = await fetch(`${cfg.url}/storage/v1/object/${encodeURIComponent(cfg.bucket)}/${item.path}`, {
    method: 'POST',
    headers: uploadHeaders(cfg.key),
    body: jpeg,
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
  });
  if (res.ok || res.status === 409) return;
  const text = (await res.text().catch(() => '')).slice(0, 200);
  throw new Error(`Supabase ${res.status}${text ? `: ${text}` : ''}`);
}

let worker: ReturnType<typeof setInterval> | null = null;
/** The pass under way: a drain() called meanwhile waits for it rather than starting another. */
let running: Promise<void> | null = null;

/** Starts the background worker (once); it also picks up what a previous run left in pending/. */
export function ensureWorker(): void {
  if (worker) return;
  worker = setInterval(() => void drain(), WORKER_MS);
  // never keep the webserver alive for it
  (worker as { unref?: () => void }).unref?.();
  void drain();
}

/** Uploads every pending photo that is due, one at a time (one pass at a time). */
export function drain(now = Date.now()): Promise<void> {
  running ??= pass(now).finally(() => (running = null));
  return running;
}

async function pass(now: number): Promise<void> {
  const cfg = readSupabaseConfig();
  const dir = pendingDir();
  if (!cfg || !existsSync(dir)) return;
  {
    const ids = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .filter((id) => ID_RE.test(id));
    for (const id of ids) {
      const item = readPending(id);
      if (!item || item.nextAt > now) continue;
      const file = resolve(dir, `${id}.jpg`);
      if (!existsSync(file)) {
        unlinkSync(resolve(dir, `${id}.json`));
        continue;
      }
      uploading = id;
      try {
        await upload(cfg, item, readFileSync(file));
        // a private bucket: the link is a signed one (a failure here retries the whole item;
        // the upload then answers 409 "already there", which counts as done)
        const link = cfg.signedDays > 0 ? await signedUrl(cfg, item.path) : publicUrl(cfg, item.path);
        unlinkSync(file);
        unlinkSync(resolve(dir, `${id}.json`));
        published.set(id, link);
        appendFileSync(resolve(photoRoot(), 'published.jsonl'), `${JSON.stringify({ id, path: item.path, url: link, at: new Date().toISOString() })}\n`);
      } catch (error) {
        const attempts = item.attempts + 1;
        const next: PendingPhoto = { ...item, attempts, nextAt: Date.now() + backoff(attempts), lastError: error instanceof Error ? error.message : String(error) };
        writeFileSync(resolve(dir, `${id}.json`), JSON.stringify(next));
      } finally {
        uploading = null;
      }
    }
  }
}
