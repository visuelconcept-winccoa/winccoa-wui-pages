// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// VncRelay  (websockify)
// -----------------------------------------------------------------------------
// Raw WebSocket <-> TCP relay for noVNC, registered directly on the underlying
// uWebSockets.js app (UltimateExpress exposes it as `app.uwsApp`). UltimateExpress
// itself only models HTTP routes, so the binary WebSocket relay lives here.
//
// Flow per session:
//   1. noVNC opens  wss://<dashboard>/api/vnc/ws?id=<connectionId>
//   2. on `open`, we resolve the id -> { host, port } via the VncProxy MSA
//      service (server-side allow-list; the browser never names a raw host:port)
//   3. we open a TCP socket to host:port and pipe bytes both ways (the RFB
//      protocol + VNC auth are end-to-end between noVNC and the VNC server; this
//      relay is a dumb byte pipe).
//
// Backpressure: when the WebSocket's buffered amount grows we pause the TCP
// socket and resume it on `drain`. Client->server traffic (input events) is
// small and relies on TCP's own buffering.
//
// NB: this must be registered BEFORE the server starts listening — it is wired
// from CustomerDashboardServer.defineRoutes(), which runs during server setup.
// -----------------------------------------------------------------------------

import * as net from 'node:net';

import { resolveVncTarget } from './vncController';

/* eslint-disable @typescript-eslint/no-explicit-any */

const WS_PATH = '/api/vnc/ws';
const MAX_PAYLOAD = 16 * 1024 * 1024;
/** Pause the TCP read side when the WebSocket has more than this buffered. */
const BACKPRESSURE_HIGH = 8 * 1024 * 1024;

/** Per-connection relay state, stored as the uWS WebSocket user data. */
interface RelayState {
  id: string;
  tcp: net.Socket | null;
  queue: Buffer[];
  connected: boolean;
  tcpPaused: boolean;
  closing: boolean;
}

/**
 * Register the `/api/vnc/ws` WebSocket relay on the raw uWebSockets app.
 * No-op (with a warning) if the uWS app is not reachable.
 */
export function registerVncRelay(app: any): void {
  const uws = app?.uwsApp;
  if (!uws || typeof uws.ws !== 'function') {
    console.warn('[vnc-relay] uWebSockets app unavailable — %s not registered', WS_PATH);
    return;
  }
  uws.ws(WS_PATH, {
    maxPayloadLength: MAX_PAYLOAD,
    // 0 = no idle timeout: a VNC session may be visually idle for long periods.
    idleTimeout: 0,
    // 0 = do not auto-close on backpressure; we manage it manually below.
    maxBackpressure: 0,
    upgrade: (res: any, req: any, context: any) => {
      const id = new URLSearchParams(req.getQuery() || '').get('id') ?? '';
      const state: RelayState = {
        id,
        tcp: null,
        queue: [],
        connected: false,
        tcpPaused: false,
        closing: false
      };
      res.upgrade(
        state,
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context
      );
    },
    open: (ws: any) => {
      void startRelay(ws);
    },
    message: (ws: any, message: ArrayBuffer) => {
      const st = ws.getUserData() as RelayState;
      // The ArrayBuffer is only valid during this callback — copy it.
      const buf = Buffer.from(new Uint8Array(message));
      if (st.connected && st.tcp) st.tcp.write(buf);
      else st.queue.push(buf);
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
      st.tcp?.destroy();
    }
  });
  console.log('[vnc-relay] registered %s', WS_PATH);
}

async function startRelay(ws: any): Promise<void> {
  const st = ws.getUserData() as RelayState;
  if (!st.id) {
    safeEnd(ws, 1008, 'missing id');
    return;
  }
  let target;
  try {
    target = await resolveVncTarget(st.id);
  } catch (error) {
    console.warn('[vnc-relay] resolve %s failed: %s', st.id, (error as Error)?.message ?? error);
    safeEnd(ws, 1011, 'resolve failed');
    return;
  }
  if (st.closing) return;

  const sock = net.connect({ host: target.host, port: target.port });
  st.tcp = sock;

  sock.on('connect', () => {
    st.connected = true;
    for (const buf of st.queue) sock.write(buf);
    st.queue = [];
  });
  sock.on('data', (data: Buffer) => {
    if (st.closing) return;
    try {
      ws.send(data, true);
      if (ws.getBufferedAmount() > BACKPRESSURE_HIGH) {
        sock.pause();
        st.tcpPaused = true;
      }
    } catch {
      sock.destroy();
    }
  });
  sock.on('close', () => safeEnd(ws, 1000, 'tcp closed'));
  sock.on('error', (error: Error) => {
    console.warn('[vnc-relay] tcp error %s:%d %s', target.host, target.port, error.message);
    safeEnd(ws, 1011, 'tcp error');
  });
}

function safeEnd(ws: any, code: number, msg: string): void {
  const st = ws.getUserData() as RelayState;
  if (st.closing) return;
  st.closing = true;
  try {
    ws.end(code, msg);
  } catch {
    // WebSocket already closed.
  }
}
