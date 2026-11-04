// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// VncRelay  (websockify + VNC authentication)
// -----------------------------------------------------------------------------
// Raw WebSocket <-> TCP relay for noVNC, registered directly on the underlying
// uWebSockets.js app (UltimateExpress exposes it as `app.uwsApp`). UltimateExpress
// itself only models HTTP routes, so the binary WebSocket relay lives here.
//
// Flow per session:
//   1. the page asks `POST /api/vnc/session {id}` (role `connect`, vncRoute.ts)
//      for a one-shot ticket (vncTickets.ts) — the upgrade below has no Express
//      middleware and no session, so the role is proven by the ticket;
//   2. noVNC opens  wss://<dashboard>/api/vnc/ws?id=<connectionId>&ticket=<ticket>;
//      `upgrade` consumes the ticket (bound to that id, 30 s, single use);
//   3. on `open`: the `connect` role is re-checked for the ticket's user (a
//      revocation in between is honoured), the id is resolved -> { host, port }
//      by the VncProxy MSA service (server-side allow-list; the browser never
//      names a raw host:port) and a TCP socket is opened;
//   4. the relay runs the RFB handshake on both sides (rfbBroker.ts): it answers
//      the VNC server's authentication with the password read server-side
//      (vncStore.readSecret) and offers the browser security type None — the
//      password never reaches the browser;
//   5. then bytes are piped both ways, and `lastConnectedAt` is stamped.
//
// A refused session is upgraded, then closed at once with a code the client
// can log (a browser cannot read the HTTP status of a refused upgrade):
//   1008 missing id · 4401 no valid ticket · 4403 role `connect` missing ·
//   1011 resolve / TCP failure · 4001 VNC authentication refused (the reason
//   also reaches noVNC as a `securityfailure`) · 4408 handshake timeout.
//
// Backpressure: when the WebSocket's buffered amount grows we pause the TCP
// socket and resume it on `drain`. Client->server traffic (input events) is
// small and relies on TCP's own buffering.
//
// NB: this must be registered BEFORE the server starts listening — it is wired
// from CustomerDashboardServer.defineRoutes(), which runs during server setup.
// -----------------------------------------------------------------------------

import * as net from 'node:net';

import { identityOfUsername } from './appSecurityGuard';
import { ByteQueue, RfbPeer, brokerHandshake } from './rfbBroker';
import { VncTarget, markRelayRegistered, resolveVncTarget } from './vncController';
import { holdsRole } from './vncGuard';
import { readSecret, stampLastConnected } from './vncStore';
import { TicketGrant, consumeTicket } from './vncTickets';

/* eslint-disable @typescript-eslint/no-explicit-any */

const WS_PATH = '/api/vnc/ws';
const MAX_PAYLOAD = 16 * 1024 * 1024;
/** Pause the TCP read side when the WebSocket has more than this buffered. */
const BACKPRESSURE_HIGH = 8 * 1024 * 1024;
/** Longest the two RFB handshakes may take before the session is dropped. */
const HANDSHAKE_TIMEOUT_MS = 20_000;

/** Close codes of a refused or failed session (see the header). */
export const CLOSE = {
  missingId: [1008, 'missing id'],
  ticket: [4401, 'no valid session ticket: POST /api/vnc/session first'],
  forbidden: [4403, "forbidden: role 'connect' of 'remote-vnc' required"],
  resolve: [1011, 'resolve failed'],
  tcp: [1011, 'tcp error'],
  handshake: [1011, 'rfb handshake failed'],
  auth: [4001, 'vnc authentication refused'],
  timeout: [4408, 'rfb handshake timeout'],
  tcpClosed: [1000, 'tcp closed']
} as const satisfies Record<string, readonly [number, string]>;

type Close = (typeof CLOSE)[keyof typeof CLOSE];

/** What the relay needs from the rest of the module (injected by the tests). */
export interface RelayDeps {
  /** Whether the ticket's user still holds `connect`. */
  allowed(grant: TicketGrant): Promise<boolean>;
  resolve(id: string): Promise<VncTarget>;
  readSecret(id: string): Promise<string>;
  connect(host: string, port: number): net.Socket;
  stamp(id: string): Promise<void>;
}

const DEFAULT_DEPS: RelayDeps = {
  allowed: async (grant) => {
    const who = grant.username
      ? await identityOfUsername(grant.username)
      : { username: '', userId: -1, admin: false, groups: [] };
    return holdsRole(who, ['connect']);
  },
  resolve: resolveVncTarget,
  readSecret,
  connect: (host, port) => net.connect({ host, port }),
  stamp: stampLastConnected
};

/** Per-connection relay state, stored as the uWS WebSocket user data. */
interface RelayState {
  id: string;
  grant: TicketGrant | null;
  refusal: Close | null;
  tcp: net.Socket | null;
  /** Browser bytes, read by the handshake. */
  fromClient: ByteQueue;
  /** VNC-server bytes, read by the handshake. */
  fromServer: ByteQueue;
  piping: boolean;
  tcpPaused: boolean;
  closing: boolean;
}

/** The query of the upgrade request → the initial state (ticket consumed here). */
export function upgradeState(query: string): RelayState {
  const params = new URLSearchParams(query || '');
  const id = params.get('id') ?? '';
  const grant = id ? consumeTicket(params.get('ticket') ?? '', id) : null;
  let refusal: Close | null = null;
  if (!id) refusal = CLOSE.missingId;
  else if (!grant) refusal = CLOSE.ticket;
  return {
    id,
    grant,
    refusal,
    tcp: null,
    fromClient: new ByteQueue(),
    fromServer: new ByteQueue(),
    piping: false,
    tcpPaused: false,
    closing: false
  };
}

/** The uWS behaviour of `/api/vnc/ws` (exported for the tests, with fake deps). */
export function relayBehavior(deps: RelayDeps = DEFAULT_DEPS): Record<string, unknown> {
  return {
    maxPayloadLength: MAX_PAYLOAD,
    // 0 = no idle timeout: a VNC session may be visually idle for long periods.
    idleTimeout: 0,
    // 0 = do not auto-close on backpressure; we manage it manually below.
    maxBackpressure: 0,
    upgrade: (res: any, req: any, context: any) => {
      // uWS: everything read from `req` must be read before any return / await.
      const state = upgradeState(req.getQuery() || '');
      res.upgrade(
        state,
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context
      );
    },
    open: (ws: any) => {
      void startRelay(ws, deps);
    },
    message: (ws: any, message: ArrayBuffer) => {
      const st = ws.getUserData() as RelayState;
      // The ArrayBuffer is only valid during this callback — copy it.
      const buf = Buffer.from(new Uint8Array(message));
      if (st.piping && st.tcp) st.tcp.write(buf);
      else st.fromClient.push(buf);
    },
    drain: (ws: any) => {
      const st = ws.getUserData() as RelayState;
      if (st.tcpPaused && st.tcp && ws.getBufferedAmount() < BACKPRESSURE_HIGH) {
        st.tcp.resume();
        st.tcpPaused = false;
      }
    },
    close: (ws: any) => {
      const st = ws.getUserData() as RelayState;
      st.closing = true;
      const gone = new Error('websocket closed');
      st.fromClient.close(gone);
      st.fromServer.close(gone);
      st.tcp?.destroy();
    }
  };
}

/**
 * Register the `/api/vnc/ws` WebSocket relay on the raw uWebSockets app.
 * No-op (with a warning) if the uWS app is not reachable — the session route
 * then answers 503 (`relay-unavailable`).
 */
export function registerVncRelay(app: any): void {
  const uws = app?.uwsApp;
  if (!uws || typeof uws.ws !== 'function') {
    console.warn('[vnc-relay] uWebSockets app unavailable — %s not registered', WS_PATH);
    return;
  }
  uws.ws(WS_PATH, relayBehavior());
  markRelayRegistered();
  console.log('[vnc-relay] registered %s', WS_PATH);
}

/** Send to the browser, pausing the TCP side above the backpressure threshold. */
function toClient(ws: any, st: RelayState, data: Buffer): void {
  if (st.closing) return;
  try {
    ws.send(data, true);
    if (st.tcp && ws.getBufferedAmount() > BACKPRESSURE_HIGH) {
      st.tcp.pause();
      st.tcpPaused = true;
    }
  } catch {
    st.tcp?.destroy();
  }
}

async function startRelay(ws: any, deps: RelayDeps): Promise<void> {
  const st = ws.getUserData() as RelayState;
  if (st.refusal) {
    safeEnd(ws, st.refusal);
    return;
  }
  const grant = st.grant as TicketGrant;
  try {
    if (!(await deps.allowed(grant))) {
      safeEnd(ws, CLOSE.forbidden);
      return;
    }
  } catch (error) {
    // Same rule as the HTTP guard: its own failure is logged and lets through.
    console.warn('[vnc-relay] role check failed, let through: %s', (error as Error)?.message ?? error);
  }

  let target: VncTarget;
  try {
    target = await deps.resolve(st.id);
  } catch (error) {
    console.warn('[vnc-relay] resolve %s failed: %s', st.id, (error as Error)?.message ?? error);
    safeEnd(ws, CLOSE.resolve);
    return;
  }
  let password = '';
  try {
    password = await deps.readSecret(st.id);
  } catch (error) {
    console.warn('[vnc-relay] password of %s unreadable: %s', st.id, (error as Error)?.message ?? error);
  }
  if (st.closing) return;

  const sock = deps.connect(target.host, target.port);
  st.tcp = sock;
  sock.on('data', (data: Buffer) => {
    if (st.piping) toClient(ws, st, data);
    else st.fromServer.push(data);
  });
  sock.on('close', () => {
    st.fromServer.close(new Error('tcp closed'));
    safeEnd(ws, CLOSE.tcpClosed);
  });
  sock.on('error', (error: Error) => {
    console.warn('[vnc-relay] tcp error %s:%d %s', target.host, target.port, error.message);
    st.fromServer.close(error);
    safeEnd(ws, CLOSE.tcp);
  });

  const client: RfbPeer = { queue: st.fromClient, write: (bytes) => toClient(ws, st, bytes) };
  const server: RfbPeer = { queue: st.fromServer, write: (bytes) => sock.write(bytes) };
  const timer = setTimeout(() => {
    safeEnd(ws, CLOSE.timeout);
    sock.destroy();
  }, HANDSHAKE_TIMEOUT_MS);
  let outcome;
  try {
    outcome = await brokerHandshake(client, server, password);
  } catch (error) {
    clearTimeout(timer);
    if (!st.closing) console.warn('[vnc-relay] handshake %s failed: %s', st.id, (error as Error)?.message ?? error);
    safeEnd(ws, CLOSE.handshake);
    sock.destroy();
    return;
  }
  clearTimeout(timer);
  if (!outcome.ok) {
    console.warn('[vnc-relay] %s: %s', st.id, outcome.reason);
    safeEnd(ws, CLOSE.auth);
    sock.destroy();
    return;
  }
  if (st.closing) return;
  // From here on, a dumb pipe: hand over what each side sent meanwhile.
  st.piping = true;
  const pendingClient = st.fromClient.drain();
  if (pendingClient.length > 0) sock.write(pendingClient);
  const pendingServer = st.fromServer.drain();
  if (pendingServer.length > 0) toClient(ws, st, pendingServer);
  void deps.stamp(st.id);
}

function safeEnd(ws: any, [code, msg]: Close): void {
  const st = ws.getUserData() as RelayState;
  if (st.closing) return;
  st.closing = true;
  try {
    ws.end(code, msg);
  } catch {
    // WebSocket already closed.
  }
}
