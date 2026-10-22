// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The session's close, audited by the backend (`POST /api/auth-badge/logout`):
 * one line per logout, switch user or idle expiry, for the user of the WebUI
 * token sent — whatever the login provider that opened the session.
 *
 * Called by the shell's logout hook (shell/boot.ts, `shell.onLogout`), just
 * before the session closes; `idle` is for a module that closes an idle
 * session itself:
 *
 *   auditSessionClose('idle', { item, provider, idleMinutes: 30 });
 *
 * Never blocks nor delays the logout: the request is sent `keepalive` (it
 * outlives the page's unload) and not waited for; it never throws — a failure
 * is the server's to log, the session closes anyway. Call it while the token
 * is still stored (before the shell clears it), or pass it in `token`.
 */
import { authHeaders } from './session.js';

export type SessionCloseReason = 'logout' | 'switch-user' | 'idle';

export interface SessionCloseContext {
  /** What the session was about (the station / workcenter): the audit line's item. */
  item?: string;
  /** The login provider that opened the session (`sessionProvider()`: 'auth-badge', 'standard' for the shell's own form or OIDC…). */
  provider?: string;
  /** The idle delay applied, for `idle`. */
  idleMinutes?: number;
  /** The session's WebUI token, when it is no longer the stored one. */
  token?: string;
}

const LOGOUT_URL = '/api/auth-badge/logout';

/** Sends the close's audit line; resolves once sent (or failed), never rejects. Not to be awaited by a logout. */
export function auditSessionClose(reason: SessionCloseReason, context: SessionCloseContext = {}): Promise<void> {
  const { token, ...line } = context;
  try {
    return fetch(LOGOUT_URL, {
      method: 'POST',
      cache: 'no-store',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : authHeaders())
      },
      body: JSON.stringify({ reason, ...line })
    }).then(
      () => undefined,
      () => undefined
    );
  } catch {
    return Promise.resolve();
  }
}
