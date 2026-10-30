// @vitest-environment jsdom
// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// <wui-vnc-viewer> with noVNC's RFB stubbed, the role stream and the backend
// (fetch) scripted: its states without a session, a session opened with a
// ticket and no password, and closed when the element leaves the DOM.

import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const role = vi.hoisted(() => ({ connect: null as unknown as BehaviorSubject<boolean> }));
const rfbs = vi.hoisted(() => [] as { url: string; options: Record<string, unknown>; disconnected: boolean; target: EventTarget }[]);

vi.mock('@novnc/novnc/core/rfb.js', () => ({
  default: class FakeRfb extends EventTarget {
    viewOnly = false;
    scaleViewport = false;
    background = '';
    record: (typeof rfbs)[number];
    constructor(_screen: Element, url: string, options: Record<string, unknown>) {
      super();
      this.record = { url, options, disconnected: false, target: this };
      rfbs.push(this.record);
    }
    disconnect(): void {
      this.record.disconnected = true;
    }
    sendCtrlAltDel(): void {}
  }
}));
vi.mock('@visuelconcept-winccoa/wui-kit/data/app-security.js', () => ({
  hasRole$: (_module: string, roleId: string) => (roleId === 'connect' ? role.connect : new BehaviorSubject(true))
}));
vi.mock('@wincc-oa/wui-iam-data/token-service.js', () => ({ TokenService: class {} }));
vi.mock('tsyringe', () => ({ container: { resolve: () => ({ getStoredToken: () => 'the-token' }) } }));

await import('./vnc-viewer');

type Reply = { status: number; body?: unknown } | Error;
let replies: Record<string, Reply> = {};
const calls: { url: string; init: RequestInit }[] = [];

const CONNECTION = {
  id: 'hmi',
  name: 'HMI line 1',
  host: '10.0.3.21',
  port: 5900,
  hasPassword: true,
  viewOnly: false,
  shared: true,
  connectTimeoutSec: 15,
  autoReconnect: false,
  reconnectDelaySec: 5,
  maxReconnectAttempts: 0
};

const tick = (ms = 10): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function mount(id = 'hmi'): HTMLElement & { viewerState: string } {
  const el = document.createElement('wui-vnc-viewer') as HTMLElement & { viewerState: string };
  el.setAttribute('connection-id', id);
  el.setAttribute('fill', '');
  document.body.append(el);
  return el;
}

const blockedState = (el: HTMLElement): string | null =>
  el.shadowRoot?.querySelector('.blocked')?.getAttribute('data-state') ?? null;

beforeEach(() => {
  role.connect = new BehaviorSubject(true);
  rfbs.length = 0;
  calls.length = 0;
  replies = {
    'GET /api/vnc/connection/hmi': { status: 200, body: { ok: true, connection: CONNECTION } },
    'POST /api/vnc/session': { status: 200, body: { ok: true, ticket: 'tk-1', expiresInMs: 30000 } }
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      const reply = replies[`${init.method ?? 'GET'} ${url}`] ?? { status: 404, body: '<html>' };
      if (reply instanceof Error) throw reply;
      return new Response(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body), { status: reply.status });
    })
  );
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('<wui-vnc-viewer>', () => {
  it('is defined once, with a guard (a second import does not throw)', async () => {
    await expect(import('./vnc-viewer')).resolves.toBeTruthy();
    expect(customElements.get('wui-vnc-viewer')).toBeTruthy();
  });

  it('opens a session by id: metadata, a ticket, then noVNC on the relay — no password', async () => {
    const el = mount();
    await tick();
    expect(calls.map((c) => `${c.init.method ?? 'GET'} ${c.url}`)).toEqual(['GET /api/vnc/connection/hmi', 'POST /api/vnc/session']);
    expect((calls[0].init.headers as Record<string, string>)['Authorization']).toBe('Bearer the-token');
    expect(rfbs).toHaveLength(1);
    expect(rfbs[0].url).toMatch(/\/api\/vnc\/ws\?id=hmi&ticket=tk-1$/);
    expect(rfbs[0].options).toEqual({ shared: true });
    expect(el.viewerState).toBe('connecting');
    rfbs[0].target.dispatchEvent(new CustomEvent('connect'));
    await tick();
    expect(el.viewerState).toBe('connected');
    expect(el.shadowRoot?.textContent).toContain('HMI line 1');
    expect(el.shadowRoot?.textContent).toContain('10.0.3.21:5900');
  });

  it('closes the session when it leaves the DOM (no ended event)', async () => {
    const el = mount();
    await tick();
    const ended = vi.fn();
    el.addEventListener('ended', ended);
    el.remove();
    expect(rfbs[0].disconnected).toBe(true);
    expect(ended).not.toHaveBeenCalled();
  });

  it('shows "no connect role" without asking anything when the role is denied', async () => {
    role.connect.next(false);
    const el = mount();
    const ended = vi.fn();
    el.addEventListener('ended', ended);
    await tick();
    expect(blockedState(el)).toBe('forbidden');
    expect(calls).toHaveLength(0);
    expect(rfbs).toHaveLength(0);
    expect(ended.mock.calls[0][0].detail).toMatchObject({ connectionId: 'hmi', reason: 'forbidden' });
  });

  it('closes an open session when the role is revoked, and reopens when granted again', async () => {
    const el = mount();
    await tick();
    role.connect.next(false);
    await tick();
    expect(rfbs[0].disconnected).toBe(true);
    expect(blockedState(el)).toBe('forbidden');
    role.connect.next(true);
    await tick();
    expect(rfbs).toHaveLength(2);
  });

  it('shows "no connect role" when the server refuses (403)', async () => {
    replies['GET /api/vnc/connection/hmi'] = { status: 403, body: { ok: false, error: 'forbidden' } };
    const el = mount();
    await tick();
    expect(blockedState(el)).toBe('forbidden');
    expect(rfbs).toHaveLength(0);
  });

  it('shows "not found" for an unknown connection', async () => {
    const el = mount('gone');
    replies['GET /api/vnc/connection/gone'] = { status: 404, body: { ok: false, error: 'not-found' } };
    const ended = vi.fn();
    el.addEventListener('ended', ended);
    await tick();
    expect(blockedState(el)).toBe('not-found');
    expect(rfbs).toHaveLength(0);
    expect(ended.mock.calls[0][0].detail.reason).toBe('not-found');
  });

  it('shows "relay unavailable" when the backend does not answer, or the relay is not mounted', async () => {
    replies['GET /api/vnc/connection/hmi'] = new TypeError('Failed to fetch');
    const down = mount();
    await tick();
    expect(blockedState(down)).toBe('unavailable');
    down.remove();

    replies['GET /api/vnc/connection/hmi'] = { status: 404, body: '<html>Cannot GET</html>' };
    const notDeployed = mount();
    await tick();
    expect(blockedState(notDeployed)).toBe('unavailable');
    notDeployed.remove();

    replies['GET /api/vnc/connection/hmi'] = { status: 200, body: { ok: true, connection: CONNECTION } };
    replies['POST /api/vnc/session'] = { status: 503, body: { ok: false, error: 'relay-unavailable' } };
    const noRelay = mount();
    await tick();
    expect(blockedState(noRelay)).toBe('unavailable');
    expect(rfbs).toHaveLength(0);
  });

  it('fires ended (auth) on a security failure from the relay, without retrying', async () => {
    const el = mount();
    await tick();
    const ended = vi.fn();
    el.addEventListener('ended', ended);
    rfbs[0].target.dispatchEvent(new CustomEvent('securityfailure', { detail: { reason: 'Authentication failure' } }));
    await tick();
    expect(el.viewerState).toBe('error');
    expect(ended.mock.calls[0][0].detail.reason).toBe('auth');
    expect(rfbs).toHaveLength(1);
  });

  it('fires ended (clean) when the server closes the session', async () => {
    const el = mount();
    await tick();
    rfbs[0].target.dispatchEvent(new CustomEvent('connect'));
    const ended = vi.fn();
    el.addEventListener('ended', ended);
    rfbs[0].target.dispatchEvent(new CustomEvent('disconnect', { detail: { clean: true } }));
    await tick();
    expect(el.viewerState).toBe('disconnected');
    expect(ended.mock.calls[0][0].detail.reason).toBe('clean');
  });

  it('switches session when connection-id changes', async () => {
    replies['GET /api/vnc/connection/panel'] = { status: 200, body: { ok: true, connection: { ...CONNECTION, id: 'panel' } } };
    const el = mount();
    await tick();
    el.setAttribute('connection-id', 'panel');
    await tick();
    expect(rfbs[0].disconnected).toBe(true);
    expect(rfbs).toHaveLength(2);
    expect(rfbs[1].url).toContain('id=panel');
  });
});
