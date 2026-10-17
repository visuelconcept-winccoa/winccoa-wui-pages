// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The logged-in user's WebUI token, for what they do to their own account in a
 * provider's backend (enrol a badge, a Windows Hello key): the backend checks
 * it (oaAuth.ts#sessionUser) — never a user name sent by the page.
 */
import { TokenService } from '@wincc-oa/wui-iam-data/token-service.js';
import { container } from 'tsyringe';

export function authHeaders(): Record<string, string> {
  try {
    const token = container.resolve(TokenService).getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    // `wui dev`: no shell, no token — the mock answers without one.
    return {};
  }
}

/** `fetch` with the user's token; JSON out; throws on an HTTP error. */
export async function fetchAsUser<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...(init.headers as Record<string, string> | undefined) }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
