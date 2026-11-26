// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Several people on the same atelier (winccoa-fra-msp-stma#402).
 *
 * - **One editor at a time.** Edit mode and the placement markers change the atelier itself, saved in one block: the
 *   view takes the atelier's edit lock from the route (backend/fleetLocks.ts) when one of them comes on, renews it
 *   while they stay on, and gives it back when both go off. Refused, it says who holds it. A view that loses its lock
 *   (a newer view of the same user took it over, or it was not renewed in time) leaves edit mode and says why.
 * - **The others are told.** Each save carries the atelier's next revision, who saved it and from which open view
 *   (`Atelier.revision`, `updatedBy`, `updatedAt`, `updatedClient`): a view that sees a newer revision saved by another
 *   view tells its viewer — the atelier was changed by X, reload — and saves nothing over it until reloaded.
 *
 * Without the route (a webserver not updated, the demo store), editing stays possible as before: nothing is locked.
 */
import type { Atelier } from '../types.js';
import { FLEET_API, authHeaders } from './fleet-api.js';

/** Who edits an atelier, as the route says: their name and since when (ISO). */
export interface LockHolder {
  user: string;
  since: string;
}

/** How often the view renews its lock (the route frees it after 90 s without). */
export const LOCK_RENEW_MS = 30_000;
/** How often a view that does not hold the lock asks who does. */
export const LOCK_POLL_MS = 20_000;

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** A short random id telling this open view apart from the user's other ones (the route's `client`). */
export function newClientId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function lockUrl(atelierId: string): string {
  return `${FLEET_API}/workshops/${encodeURIComponent(atelierId)}/lock`;
}

function holderOf(v: unknown): LockHolder | null {
  if (!v || typeof v !== 'object') return null;
  const h = v as Record<string, unknown>;
  return typeof h['user'] === 'string' && typeof h['since'] === 'string' ? { user: h['user'], since: h['since'] } : null;
}

/** Who holds the atelier's lock (null: nobody); undefined when the route does not answer. */
export async function fetchLockHolder(atelierId: string, doFetch: Fetch = fetch): Promise<LockHolder | null | undefined> {
  try {
    const res = await doFetch(lockUrl(atelierId), { headers: authHeaders() });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, unknown>;
    return body?.['ok'] ? holderOf(body['holder']) : undefined;
  } catch {
    return undefined;
  }
}

/** Take, renew or give back the atelier's lock; null when the route does not answer (nothing locked then). */
export async function requestLock(
  atelierId: string,
  action: 'acquire' | 'renew' | 'release',
  client: string,
  doFetch: Fetch = fetch,
  keepalive = false
): Promise<{ granted: boolean; holder: LockHolder | null } | null> {
  try {
    const res = await doFetch(lockUrl(atelierId), {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, client }),
      keepalive
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    return body?.['ok'] ? { granted: body['granted'] === true, holder: holderOf(body['holder']) } : null;
  } catch {
    return null;
  }
}

/** The fields a save adds to the atelier (#402): its next revision, who saved it, when, from which open view. */
export function stamped(atelier: Atelier, baseRevision: number, user: string, client: string, now = new Date()): Atelier {
  return { ...atelier, revision: baseRevision + 1, updatedBy: user, updatedAt: now.toISOString(), updatedClient: client };
}

/** A save of the atelier seen live: by someone else than this view, newer than what it has (null otherwise). */
export function remoteChange(raw: unknown, baseRevision: number, client: string): { revision: number; by: string; at: string } | null {
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (typeof text !== 'string' || !text.trim()) return null;
  let a: Partial<Atelier>;
  try {
    a = JSON.parse(text) as Partial<Atelier>;
  } catch {
    return null;
  }
  const revision = typeof a.revision === 'number' && Number.isFinite(a.revision) ? a.revision : 0;
  if (a.updatedClient === client || revision <= baseRevision) return null;
  return { revision, by: typeof a.updatedBy === 'string' ? a.updatedBy : '', at: typeof a.updatedAt === 'string' ? a.updatedAt : '' };
}

/**
 * The edit lock of one open view of an atelier: taken when edit mode or the markers come on, renewed while one of
 * them stays on, given back when both are off or the view closes; who holds it asked from time to time otherwise.
 */
export class AtelierEditLock {
  /** The lock is this view's. */
  held = false;
  /** Someone else holds it (null: free, or the route does not answer). */
  holder: LockHolder | null = null;
  /** Told when `holder` or `held` change. */
  onChange: (() => void) | null = null;
  /** Told when this view lost its lock: the holder now, if known. */
  onLost: ((holder: LockHolder | null) => void) | null = null;

  private renewTimer = 0;
  private pollTimer = 0;

  constructor(
    private readonly atelierId: string,
    readonly client: string = newClientId(),
    private readonly doFetch: Fetch = fetch
  ) {}

  /** Asked before edit mode or the markers come on: true when this view may edit (held, or nothing to lock). */
  async acquire(): Promise<boolean> {
    if (this.held) return true;
    const r = await requestLock(this.atelierId, 'acquire', this.client, this.doFetch);
    if (!r) return true;
    this.held = r.granted;
    this.holder = r.granted ? null : r.holder;
    if (r.granted) this.startRenewing();
    this.onChange?.();
    return r.granted;
  }

  /** Edit mode and markers both off: the lock given back. */
  async release(keepalive = false): Promise<void> {
    if (!this.held) return;
    this.held = false;
    this.stopRenewing();
    this.onChange?.();
    await requestLock(this.atelierId, 'release', this.client, this.doFetch, keepalive);
  }

  /** Who edits, asked now and every LOCK_POLL_MS while this view does not hold the lock. */
  watch(): void {
    if (this.pollTimer) return;
    const poll = async (): Promise<void> => {
      if (this.held) return;
      const h = await fetchLockHolder(this.atelierId, this.doFetch);
      if (h === undefined) return;
      const next = h && !this.held ? h : null;
      if (JSON.stringify(next) !== JSON.stringify(this.holder)) {
        this.holder = next;
        this.onChange?.();
      }
    };
    void poll();
    this.pollTimer = setInterval(() => void poll(), LOCK_POLL_MS) as unknown as number;
  }

  /** The view closes: timers stopped, the lock given back (keepalive: the page may be leaving). */
  dispose(): void {
    clearInterval(this.pollTimer);
    this.pollTimer = 0;
    void this.release(true);
  }

  private startRenewing(): void {
    this.stopRenewing();
    this.renewTimer = setInterval(() => void this.renew(), LOCK_RENEW_MS) as unknown as number;
  }

  private stopRenewing(): void {
    clearInterval(this.renewTimer);
    this.renewTimer = 0;
  }

  private async renew(): Promise<void> {
    if (!this.held) return;
    const r = await requestLock(this.atelierId, 'renew', this.client, this.doFetch);
    if (!r || r.granted) return;
    this.held = false;
    this.holder = r.holder;
    this.stopRenewing();
    this.onChange?.();
    this.onLost?.(r.holder);
  }
}
