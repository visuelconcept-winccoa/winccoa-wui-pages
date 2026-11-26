// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// fleetLocks — who edits an atelier (winccoa-fra-msp-stma#402)
// -----------------------------------------------------------------------------
// Several people may open the same atelier. Its edit mode and its placement markers change the atelier itself, saved
// in one block: two editors at once would erase each other's work. So one person at a time edits an atelier: the
// view asks this route for the atelier's edit lock when its edit mode or markers come on, renews it every
// LOCK_RENEW_MS while they stay on, and gives it back when both go off. The others see who holds it.
//
// The lock is held in the webserver's memory, decided in one go per request (no await between reading and writing
// it): a request cannot slip in between. A lock no longer renewed — a closed page, a lost network — is free again
// after LOCK_STALE_MS. After a webserver restart there is none: the holder's next renewal takes it back if still free.
// The holder is the user of the request's WebUI token (fleetGuard.requestIdentity), never a name sent by the page;
// `client` tells apart two open views of the same user: the newest takes the lock over, the older loses it.
//
// Endpoints (relative to "/api/ai", aiRoute.ts):
//   GET  /fleet/workshops/:id/lock                         -> { ok, holder: { user, since } | null }        view
//   POST /fleet/workshops/:id/lock  body { action, client } -> { ok, granted, holder }                      edit
//        action: 'acquire' | 'renew' | 'release'
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

import { ID_RE } from './fleetAteliers';
import { requestIdentity } from './fleetGuard';

/** A lock not renewed for this long is free again (3 renewals missed). */
export const LOCK_STALE_MS = 90_000;
/** How often the holding view renews its lock. */
export const LOCK_RENEW_MS = 30_000;

/** An atelier's edit lock: who holds it, from which open view, since when, last renewed when (ms). */
export interface EditLock {
  user: string;
  client: string;
  since: number;
  beat: number;
}

export type LockAction = 'acquire' | 'renew' | 'release';

/** What the holder looks like to the others: their name and since when. */
export interface LockHolder {
  user: string;
  since: string;
}

/**
 * The lock after an action of `who` at `now`, and whether it is theirs (pure, tested).
 *   acquire — granted when the lock is free, stale, or held by the same user (a newer view of theirs takes it over);
 *   renew   — granted when the caller's view holds it, or when it is free again (after a webserver restart);
 *   release — the caller's view lets it go; granted means it no longer holds it.
 */
export function decideLock(
  current: EditLock | null,
  action: LockAction,
  who: { user: string; client: string },
  now: number
): { lock: EditLock | null; granted: boolean } {
  const live = current && now - current.beat < LOCK_STALE_MS ? current : null;
  const mine = live !== null && live.client === who.client;
  if (action === 'release') return { lock: mine ? null : live, granted: true };
  if (action === 'renew' && live && !mine) return { lock: live, granted: false };
  if (live && !mine && live.user !== who.user) return { lock: live, granted: false };
  const since = live && live.user === who.user ? live.since : now;
  return { lock: { user: who.user, client: who.client, since, beat: now }, granted: true };
}

/** The holder as the others see it, or null when the lock is free (or stale). */
export function holderOf(lock: EditLock | null, now: number): LockHolder | null {
  return lock && now - lock.beat < LOCK_STALE_MS ? { user: lock.user, since: new Date(lock.since).toISOString() } : null;
}

const HTTP_BAD_REQUEST = 400;
const ACTIONS: readonly LockAction[] = ['acquire', 'renew', 'release'];
/** A view's client id: a short token it draws at random. */
const CLIENT_RE = /^[A-Za-z0-9_-]{8,64}$/;

export class FleetLocksController {
  private readonly locks = new Map<string, EditLock>();

  constructor(private readonly clock: () => number = Date.now) {}

  get = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params?.['id'] ?? '');
    if (!ID_RE.test(id)) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: 'atelier invalide' });
      return;
    }
    res.json({ ok: true, holder: holderOf(this.locks.get(id) ?? null, this.clock()) });
  };

  post = async (req: Request, res: Response): Promise<void> => {
    const id = String(req.params?.['id'] ?? '');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = String(body['action'] ?? '') as LockAction;
    const client = String(body['client'] ?? '');
    if (!ID_RE.test(id) || !ACTIONS.includes(action) || !CLIENT_RE.test(client)) {
      res.status(HTTP_BAD_REQUEST).json({ ok: false, error: 'demande invalide' });
      return;
    }
    const who = await requestIdentity(req);
    // From here on, no await: reading and writing the lock happen in one go.
    const now = this.clock();
    const { lock, granted } = decideLock(this.locks.get(id) ?? null, action, { user: who.username || '?', client }, now);
    if (lock) this.locks.set(id, lock);
    else this.locks.delete(id);
    res.json({ ok: true, granted, holder: holderOf(lock, now) });
  };
}
