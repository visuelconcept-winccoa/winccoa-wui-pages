// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Calls to this module's own backend (`/api/vnc`, backend/vncRoute.ts).
 *
 * Every request carries the logged-in user's WebUI token (`Authorization:
 * Bearer`): the backend verifies it to know who calls (backend/vncGuard.ts) —
 * the dashboard's HTTP requests usually have no server session — then applies
 * the remote-vnc roles. Without a shell (`wui dev`, tests) no token is sent and
 * the mock answers anyway.
 */
import { TokenService } from '@wincc-oa/wui-iam-data/token-service.js';
import { container } from 'tsyringe';

export const VNC_API = '/api/vnc';

/** How a call ended, in the terms the UI shows. */
export type ApiOutcome<T> =
  | { kind: 'ok'; body: T }
  /** 403: the caller lacks the route's role. */
  | { kind: 'forbidden' }
  /** 404 answered by the route: unknown connection. */
  | { kind: 'not-found' }
  /** 400: the backend refused the input. */
  | { kind: 'invalid'; message: string }
  /** No usable answer: backend not deployed / not restarted, network down, 5xx, relay not mounted. */
  | { kind: 'unavailable'; message: string };

export function authHeaders(): Record<string, string> {
  try {
    const token = container.resolve(TokenService).getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/** JSON body of a response from THIS backend, or null (an HTML 404 page, an empty body…). */
async function jsonOf(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One call to `/api/vnc<path>`; never throws. */
export async function vncCall<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<ApiOutcome<T>> {
  let res: Response;
  try {
    res = await fetch(`${VNC_API}${path}`, {
      method: init.method ?? 'GET',
      cache: 'no-store',
      signal: init.signal,
      headers: { ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...authHeaders() },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
  } catch (error) {
    return { kind: 'unavailable', message: error instanceof Error ? error.message : String(error) };
  }
  const body = await jsonOf(res);
  const message = typeof body?.['message'] === 'string' ? body['message'] : `HTTP ${res.status}`;
  if (res.ok && body) return { kind: 'ok', body: body as T };
  // A 403/404 counts only when it comes from the route (JSON `{ ok: false }`):
  // an HTML 404 means the backend module is not mounted.
  if (body?.['ok'] === false && res.status === 403) return { kind: 'forbidden' };
  if (body?.['ok'] === false && res.status === 404) return { kind: 'not-found' };
  if (body?.['ok'] === false && res.status === 400) return { kind: 'invalid', message };
  return { kind: 'unavailable', message };
}
