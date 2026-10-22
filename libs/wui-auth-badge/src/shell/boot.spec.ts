// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';
import boot, { type LogoutInfo } from './boot';

// The stored WebUI token: the shell's TokenService, out of reach here.
vi.mock('../session.js', () => ({ authHeaders: () => ({ Authorization: 'Bearer stored-token' }) }));

function bootWith(): (info: LogoutInfo) => void | Promise<void> {
  let hook: ((info: LogoutInfo) => void | Promise<void>) | undefined;
  boot({
    module: 'auth-badge',
    onLogout: (callback) => {
      hook = callback;
      return () => undefined;
    }
  });
  if (!hook) throw new Error('no logout hook registered');
  return hook;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the logout hook', () => {
  it('posts the close with the reason, the provider and the item, with the stored token', async () => {
    const fetch = vi.fn(async () => new Response('{"status":"ok"}'));
    vi.stubGlobal('fetch', fetch);
    await bootWith()({ reason: 'switch-user', provider: 'auth-badge', context: { item: 'WC1' } });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/auth-badge/logout');
    expect(init).toMatchObject({ method: 'POST', keepalive: true });
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer stored-token');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'switch-user', item: 'WC1', provider: 'auth-badge' });
  });

  it('names the standard form when no provider opened the session', async () => {
    const fetch = vi.fn(async () => new Response('{}'));
    vi.stubGlobal('fetch', fetch);
    await bootWith()({ reason: 'logout', provider: undefined, context: {} });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'logout', provider: 'standard' });
  });

  it('never rejects: a failed request does not hold the logout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('network'))));
    await expect(bootWith()({ reason: 'logout', provider: 'auth-badge', context: {} })).resolves.toBeUndefined();
    vi.stubGlobal('fetch', () => {
      throw new TypeError('sync');
    });
    await expect(bootWith()({ reason: 'logout', provider: 'auth-badge', context: {} })).resolves.toBeUndefined();
  });
});
