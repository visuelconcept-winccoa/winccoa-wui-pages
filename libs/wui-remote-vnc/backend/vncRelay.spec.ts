// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// The /api/vnc/ws relay with a fake uWS socket and a fake TCP socket playing an
// RFB 3.8 VNC server with VNC authentication: the upgrade is refused without a
// ticket or without the `connect` role, and a granted session is authenticated
// by the relay — the browser never receives the password.

import { EventEmitter } from 'node:events';
import type * as net from 'node:net';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@winccoa/backend', () => ({ WsjServerGlobal: { winccoa: {} } }));
vi.mock('winccoa-manager', () => ({ WinccoaDpTypeNode: class {}, WinccoaElementType: {}, WinccoaCtrlType: {}, WinccoaCtrlScript: class {} }));
vi.mock('ultimate-express', () => ({ Router: () => ({}), json: () => undefined }));
vi.mock('./appSecurityGuard', () => ({
  identityOf: async () => ({ username: '', userId: -1, admin: false, groups: [] }),
  identityOfUsername: async (username: string) => ({ username, userId: 1, admin: false, groups: [] }),
  roleAssignments: async () => ({}),
  roleGranted: () => true
}));

const { CLOSE, relayBehavior } = await import('./vncRelay');
const { clearTickets, issueTicket } = await import('./vncTickets');
const { vncAuthResponse } = await import('./vncAuth');

const CHALLENGE = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
const tick = (ms = 0): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const u32 = (n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};

/** A fake uWS WebSocket: records what is sent and how it ends. */
class FakeWs {
  sent: Buffer[] = [];
  ended: [number, string] | null = null;
  constructor(private readonly data: unknown) {}
  getUserData(): unknown {
    return this.data;
  }
  send(data: Buffer): void {
    this.sent.push(Buffer.from(data));
  }
  end(code: number, msg: string): void {
    this.ended = [code, msg];
  }
  getBufferedAmount(): number {
    return 0;
  }
  received(): Buffer {
    return Buffer.concat(this.sent);
  }
}

/** A fake TCP socket to an RFB 3.8 server asking VNC authentication. */
class FakeVncServer extends EventEmitter {
  written: Buffer[] = [];
  destroyed = false;
  private step = 0;
  constructor(private readonly expectedPassword: string) {
    super();
    setTimeout(() => this.emit('data', Buffer.from('RFB 003.008\n')), 0);
  }
  write(data: Buffer): boolean {
    this.written.push(Buffer.from(data));
    const all = Buffer.concat(this.written);
    if (this.step === 0 && all.length >= 12) {
      this.step = 1;
      setTimeout(() => this.emit('data', Buffer.from([1, 2])), 0);
    } else if (this.step === 1 && all.length >= 13) {
      this.step = 2;
      setTimeout(() => this.emit('data', CHALLENGE), 0);
    } else if (this.step === 2 && all.length >= 29) {
      this.step = 3;
      const ok = all.subarray(13, 29).equals(vncAuthResponse(this.expectedPassword, CHALLENGE));
      setTimeout(() => this.emit('data', ok ? u32(0) : Buffer.concat([u32(1), u32(4), Buffer.from('nope')])), 0);
    }
    return true;
  }
  pause(): void {}
  resume(): void {}
  destroy(): void {
    this.destroyed = true;
  }
}

function deps(over: Partial<Parameters<typeof relayBehavior>[0]> = {}) {
  const server = new FakeVncServer('s3cret');
  const d = {
    allowed: vi.fn(async () => true),
    resolve: vi.fn(async () => ({ host: '10.0.0.1', port: 5900, name: 'HMI' })),
    readSecret: vi.fn(async () => 's3cret'),
    connect: vi.fn(() => server as unknown as net.Socket),
    stamp: vi.fn(async () => undefined),
    ...over
  };
  return { d, server };
}

/** Run upgrade + open for `query`, as uWS would. */
function open(behavior: Record<string, unknown>, query: string): FakeWs {
  let state: unknown;
  const res = { upgrade: (data: unknown) => (state = data) };
  const req = { getQuery: () => query, getHeader: () => '' };
  (behavior['upgrade'] as (res: unknown, req: unknown, ctx: unknown) => void)(res, req, {});
  const ws = new FakeWs(state);
  (behavior['open'] as (ws: unknown) => void)(ws);
  return ws;
}

const message = (behavior: Record<string, unknown>, ws: FakeWs, bytes: number[] | Buffer): void =>
  (behavior['message'] as (ws: unknown, m: ArrayBuffer) => void)(ws, new Uint8Array(Buffer.from(bytes)).buffer);

beforeEach(() => clearTickets());

describe('the /api/vnc/ws upgrade', () => {
  it('is refused without a ticket (4401), and never reaches the VNC server', async () => {
    const { d } = deps();
    const ws = open(relayBehavior(d), 'id=hmi');
    await tick();
    expect(ws.ended).toEqual(CLOSE.ticket);
    expect(ws.ended?.[0]).toBe(4401);
    expect(d.connect).not.toHaveBeenCalled();
  });

  it('is refused with a ticket of another connection or an already used one', async () => {
    const { d } = deps();
    const behavior = relayBehavior(d);
    const ticket = issueTicket({ id: 'other', username: 'op', userId: 1 });
    expect(open(behavior, `id=hmi&ticket=${ticket}`).ended).toEqual(CLOSE.ticket);
    const good = issueTicket({ id: 'hmi', username: 'op', userId: 1 });
    open(behavior, `id=hmi&ticket=${good}`);
    await tick();
    expect(open(behavior, `id=hmi&ticket=${good}`).ended).toEqual(CLOSE.ticket);
  });

  it('is refused without the connect role (4403), checked again at upgrade', async () => {
    const { d } = deps({ allowed: vi.fn(async () => false) });
    const ticket = issueTicket({ id: 'hmi', username: 'revoked', userId: 3 });
    const ws = open(relayBehavior(d), `id=hmi&ticket=${ticket}`);
    await tick();
    expect(d.allowed).toHaveBeenCalledWith({ id: 'hmi', username: 'revoked', userId: 3 });
    expect(ws.ended).toEqual(CLOSE.forbidden);
    expect(ws.ended?.[0]).toBe(4403);
    expect(d.resolve).not.toHaveBeenCalled();
    expect(d.connect).not.toHaveBeenCalled();
  });

  it('is refused without an id (1008)', async () => {
    const ws = open(relayBehavior(deps().d), '');
    await tick();
    expect(ws.ended).toEqual(CLOSE.missingId);
  });
});

describe('a granted session', () => {
  it('is authenticated by the relay: the browser gets None, never the password, then the pipe', async () => {
    const { d, server } = deps();
    const behavior = relayBehavior(d);
    const ticket = issueTicket({ id: 'hmi', username: 'op', userId: 1 });
    const ws = open(behavior, `id=hmi&ticket=${ticket}`);
    await tick(5);
    expect(ws.received().toString()).toBe('RFB 003.008\n');
    message(behavior, ws, Buffer.from('RFB 003.008\n'));
    await tick(5);
    message(behavior, ws, [1]); // None
    await tick(20);
    const toBrowser = ws.received();
    expect([...toBrowser.subarray(12, 14)]).toEqual([1, 1]);
    expect(toBrowser.subarray(14)).toEqual(u32(0));
    expect(toBrowser.toString('latin1')).not.toContain('s3cret');
    expect(ws.ended).toBeNull();
    expect(d.stamp).toHaveBeenCalledWith('hmi');

    // Piped from now on, both ways.
    message(behavior, ws, [1]); // ClientInit
    expect(server.written.at(-1)).toEqual(Buffer.from([1]));
    server.emit('data', Buffer.from('ServerInit'));
    expect(ws.sent.at(-1)?.toString()).toBe('ServerInit');
  });

  it('a password the VNC server refuses ends the session (4001) with the reason for noVNC', async () => {
    const { d, server } = deps({ readSecret: vi.fn(async () => 'wrong') });
    const behavior = relayBehavior(d);
    const ws = open(behavior, `id=hmi&ticket=${issueTicket({ id: 'hmi', username: 'op', userId: 1 })}`);
    await tick(5);
    message(behavior, ws, Buffer.from('RFB 003.008\n'));
    await tick(5);
    message(behavior, ws, [1]);
    await tick(20);
    expect(ws.received().subarray(14)).toEqual(Buffer.concat([u32(1), u32(4), Buffer.from('nope')]));
    expect(ws.ended).toEqual(CLOSE.auth);
    expect(server.destroyed).toBe(true);
    expect(d.stamp).not.toHaveBeenCalled();
  });

  it('closing the WebSocket destroys the TCP socket', async () => {
    const { d, server } = deps();
    const behavior = relayBehavior(d);
    const ws = open(behavior, `id=hmi&ticket=${issueTicket({ id: 'hmi', username: 'op', userId: 1 })}`);
    await tick(5);
    (behavior['close'] as (ws: unknown) => void)(ws);
    await tick(5);
    expect(server.destroyed).toBe(true);
  });
});
