// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// vncTickets — one-shot session tickets for the WebSocket relay
// -----------------------------------------------------------------------------
// The relay's WebSocket upgrade happens on the raw uWebSockets app: no Express
// middleware, no passport session, and a browser WebSocket cannot carry an
// `Authorization` header. So the role is checked where it can be — on the HTTP
// route `POST /api/vnc/session` (the `connect` role, vncGuard.ts) — which hands
// out a ticket: random, bound to ONE connection id and to the identity that
// asked, valid TICKET_TTL_MS, usable once. The upgrade (`/api/vnc/ws?id=&ticket=`)
// consumes it, and the relay re-checks the role for that identity before it
// opens the TCP socket (a role revoked in between is honoured).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

/** How long a ticket stays valid: the time for noVNC to open its WebSocket. */
export const TICKET_TTL_MS = 30_000;
/** Bound on outstanding tickets, so a client looping on the route cannot grow memory. */
const MAX_TICKETS = 1000;
const TICKET_BYTES = 24;

/** What a ticket proves: who asked, for which connection. */
export interface TicketGrant {
  id: string;
  username: string;
  userId: number;
}

interface Stored extends TicketGrant {
  expires: number;
}

const tickets = new Map<string, Stored>();

function purge(now: number): void {
  for (const [token, stored] of tickets) if (stored.expires <= now) tickets.delete(token);
}

/** A new ticket for `grant`. */
export function issueTicket(grant: TicketGrant, now = Date.now()): string {
  purge(now);
  if (tickets.size >= MAX_TICKETS) {
    // Drop the oldest (Map keeps insertion order).
    const oldest = tickets.keys().next().value;
    if (oldest !== undefined) tickets.delete(oldest);
  }
  const token = randomBytes(TICKET_BYTES).toString('base64url');
  tickets.set(token, { ...grant, expires: now + TICKET_TTL_MS });
  return token;
}

/**
 * The grant of `token` when it is valid for connection `id`, else null. A
 * ticket is consumed by its first use, whatever the outcome.
 */
export function consumeTicket(token: string, id: string, now = Date.now()): TicketGrant | null {
  if (!token) return null;
  const stored = tickets.get(token);
  if (!stored) return null;
  tickets.delete(token);
  if (stored.expires <= now || stored.id !== id) return null;
  return { id: stored.id, username: stored.username, userId: stored.userId };
}

/** Test hook: forget every ticket. */
export function clearTickets(): void {
  tickets.clear();
}
