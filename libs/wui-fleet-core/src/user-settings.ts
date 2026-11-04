// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings of the logged-in WinCC OA user, page side: a JSON value under a key the
 * machine-fleet-3d backend declares (`/api/ai/fleet/settings/:key`,
 * backend/fleetSettings.ts), kept in WinCC OA's user settings (a DP
 * `_usr_<UserId>_<setting>` of type `_UserDefinedSettings`). The user is the one of
 * the request's WebUI token, checked by the server: each user reads and writes only
 * their own, and finds them on another workstation. The same client as the work
 * centres' (winccoa-fra-msp-stma, wui-workcenters src/shared/user-settings.ts).
 *
 * - `get(key)`: the logged-in user's value, null when they have none (or on failure,
 *   reported by `errors$`); a write still pending for that key is returned as is;
 * - `set(key, value, delayMs)`: deferred write (the last value wins), sent with the
 *   user's token at the time of the `set` — a user switch never sends it under the
 *   next user's name: `user$` changing flushes the pending writes first;
 * - `flush()`: sends the pending writes now (page unmount, `pagehide`);
 * - `user$`: key of the logged-in user, emitted on subscription then on every login
 *   ("Switch user", badge) — the page reads its settings again;
 * - `errors$`: a read or write failure, once until the next success.
 *
 * No dependency on the shell: the wiring (token, user) is in fleet-settings-service.ts.
 */
import { Observable, Subject, distinctUntilChanged, shareReplay } from 'rxjs';

/** The part of `Response` used. */
export interface SettingsResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface UserSettingsDeps {
  fetch(url: string, init: RequestInit): Promise<SettingsResponse>;
  /** Authentication headers of the logged-in user (`Authorization: Bearer <WebUI token>`). */
  headers(): Record<string, string>;
  /** Key of the logged-in user, emitted on every login. */
  user$: Observable<string>;
}

/** Default delay of a deferred write (ms). */
export const SETTINGS_WRITE_DELAY_MS = 400;

/** Prefix of the settings routes. */
export const FLEET_SETTINGS_URL = '/api/ai/fleet/settings';

interface Pending {
  value: unknown;
  headers: Record<string, string>;
  timer: ReturnType<typeof setTimeout> | null;
}

export class UserSettings {
  readonly user$: Observable<string>;
  readonly errors$ = new Subject<string>();
  private readonly pending = new Map<string, Pending>();
  private failing = false;
  private userKey: string | null = null;

  constructor(
    private readonly deps: UserSettingsDeps,
    private readonly baseUrl = FLEET_SETTINGS_URL
  ) {
    this.user$ = new Observable<string>((sub) =>
      deps.user$.subscribe({
        next: (u) => {
          // User switch: the pending writes leave with the previous user's token.
          if (this.userKey !== null && u !== this.userKey) void this.flush();
          this.userKey = u;
          sub.next(u);
        },
        error: (e: unknown) => sub.error(e),
        complete: () => sub.complete()
      })
    ).pipe(distinctUntilChanged(), shareReplay({ bufferSize: 1, refCount: true }));
  }

  private url(key: string): string {
    return `${this.baseUrl}/${encodeURIComponent(key)}`;
  }

  private report(ok: boolean, message: string): void {
    if (ok) {
      this.failing = false;
      return;
    }
    if (this.failing) return;
    this.failing = true;
    this.errors$.next(message);
  }

  /** The logged-in user's value for `key`, null when they have none or it is unreadable. */
  async get<T = unknown>(key: string): Promise<T | null> {
    const p = this.pending.get(key);
    if (p) return p.value as T;
    try {
      const res = await this.deps.fetch(this.url(key), { cache: 'no-store', headers: { ...this.deps.headers() } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { value?: unknown } | null;
      this.report(true, '');
      return (body?.value ?? null) as T | null;
    } catch (error) {
      this.report(false, `reading the "${key}" settings: ${String((error as Error)?.message ?? error)}`);
      return null;
    }
  }

  /** Store `value` for the logged-in user after `delayMs` (the last value wins). */
  set(key: string, value: unknown, delayMs = SETTINGS_WRITE_DELAY_MS): void {
    const headers = { ...this.deps.headers() };
    const prev = this.pending.get(key);
    if (prev) {
      if (prev.timer) clearTimeout(prev.timer);
      // Another token: the user changed meanwhile, the previous value leaves under their name.
      if (JSON.stringify(prev.headers) !== JSON.stringify(headers)) void this.write(key, prev.value, prev.headers);
    }
    const p: Pending = { value, headers, timer: null };
    p.timer = setTimeout(
      () => {
        if (this.pending.get(key) === p) this.pending.delete(key);
        void this.write(key, value, headers);
      },
      Math.max(0, delayMs)
    );
    this.pending.set(key, p);
  }

  /** Send the pending writes now. */
  async flush(): Promise<void> {
    const all = [...this.pending.entries()];
    this.pending.clear();
    await Promise.all(
      all.map(([key, p]) => {
        if (p.timer) clearTimeout(p.timer);
        return this.write(key, p.value, p.headers);
      })
    );
  }

  /** Writes still pending (tests, diagnosis). */
  get pendingKeys(): string[] {
    return [...this.pending.keys()];
  }

  private async write(key: string, value: unknown, headers: Record<string, string>): Promise<void> {
    try {
      const res = await this.deps.fetch(this.url(key), {
        method: 'PUT',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ value })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.report(true, '');
    } catch (error) {
      this.report(false, `saving the "${key}" settings: ${String((error as Error)?.message ?? error)}`);
    }
  }
}
