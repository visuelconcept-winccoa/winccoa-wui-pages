// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Plugs the fleet pages' settings cache (settings-cache.ts) into the logged-in user's
 * WinCC OA settings (user-settings.ts): the WebUI token the shell stores (`TokenService`,
 * sent as `Authorization: Bearer`, checked by the backend) and the logged-in user
 * (`WuiUserService.user$`, the name shown top right). Imported once by each page that
 * reads or writes a setting (Machine Fleet, the analyses, the closures).
 *
 * Without a shell (`wui dev`, tests) no token is sent and the mock answers anyway.
 */
import { TokenService } from '@wincc-oa/wui-iam-data/token-service.js';
import { WuiUserService } from '@wincc-oa/wui-iam-data/user-service.js';
import { map, of, startWith, type Observable } from 'rxjs';
import { container, type InjectionToken } from 'tsyringe';

import { settingsCache } from './settings-cache.js';
import { UserSettings } from './user-settings.js';

function resolve<T>(token: InjectionToken<T>): T | null {
  try {
    return container.resolve(token);
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  try {
    const token = resolve(TokenService)?.getStoredToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function userKey(svc: WuiUserService | null): string {
  return svc ? `${svc.id ?? ''}|${svc.name ?? ''}` : '';
}

function currentUser$(): Observable<string> {
  const svc = resolve(WuiUserService);
  if (!svc) return of('');
  return svc.user$.pipe(
    map(() => userKey(svc)),
    startWith(userKey(svc))
  );
}

/** The logged-in user's settings client (its `errors$` can be shown by a page). */
export const fleetUserSettings = new UserSettings({
  fetch: (url, init) => fetch(url, init),
  headers: authHeaders,
  user$: currentUser$()
});

settingsCache.connect({
  user$: fleetUserSettings.user$,
  get: (key) => fleetUserSettings.get(key),
  set: (key, value) => fleetUserSettings.set(key, value)
});

// A deferred write still pending leaves before the tab closes or reloads.
if (typeof window !== 'undefined') window.addEventListener('pagehide', () => void fleetUserSettings.flush());
