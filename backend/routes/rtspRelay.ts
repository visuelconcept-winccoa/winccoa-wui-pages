// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// RtspRelay  (same-origin WebSocket proxy)
// -----------------------------------------------------------------------------
// Raw WebSocket <-> WebSocket relay for the RTSP camera page, registered directly
// on the underlying uWebSockets.js app (UltimateExpress exposes it as
// `app.uwsApp`). UltimateExpress itself only models HTTP routes, so the binary
// WebSocket relay lives here.
//
// Flow per session:
//   1. JSMpeg (browser) opens  wss://<dashboard>/api/rtsp/ws?id=<cameraId>
//      — SAME ORIGIN, so it inherits the dashboard's TLS + auth (no mixed content,
//      no extra port/cert).
//   2. we open a plain WebSocket to the rtspProxy manager on 127.0.0.1
//      (ws://127.0.0.1:9999/api/rtsp/stream/<id>) and pipe the frames both ways.
//   3. the manager resolves <id> -> rtsp URL, pulls the stream ONCE with ffmpeg
//      and fans the MPEG1-TS out to every client (one RTSP connection shared).
//
// This relay is a dumb byte pipe; all RTSP/ffmpeg work happens in the manager.
// The downstream direction (manager -> browser, the video) is the heavy one;
// when the browser's WebSocket buffers up we pause the upstream socket and resume
// it on `drain`. The upstream direction carries no data (JSMpeg never sends).
//
// NB: this must be registered BEFORE the server starts listening — it is wired
// from CustomerDashboardServer.defineRoutes(), which runs during server setup.
// -----------------------------------------------------------------------------

import { WebSocket } from 'ws';

import { decrClient, incrClient, managerStreamUrl } from './rtspController';

// The raw uWebSockets app (`app.uwsApp`) and its sockets are untyped — the whole
// relay works against `any` values, like the sibling vncRelay.ts.
/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */

const WS_PATH = '/api/rtsp/ws';
const MAX_PAYLOAD = 16 * 1024 * 1024;
/** Pause the upstream read side when the browser WebSocket has more than this buffered. */
const BACKPRESSURE_HIGH = 8 * 1024 * 1024;

/** Per-connection relay state, stored as the uWS WebSocket user data. */
interface RelayState {
  id: string;
  upstream: WebSocket | null;
  queue: Buffer[];
  connected: boolean;
  upstreamPaused: boolean;
  closing: boolean;
  /** Whether this connection was counted as a live viewer (for the client tally). */
  counted: boolean;
}

/** Normalise a `ws` message payload to a single Buffer. */
function toBuffer(data: Buffer | ArrayBuffer | Buffer[]): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(new Uint8Array(data));
}

/** Best-effort flow control on the upstream `ws` socket (pause/resume reads). */
function setUpstreamPaused(upstream: WebSocket | null, paused: boolean): void {
  const sock = (upstream as any)?._socket;
  if (paused) sock?.pause?.();
  else sock?.resume?.();
}

/**
 * Register the `/api/rtsp/ws` WebSocket relay on the raw uWebSockets app.
 * No-op (with a warning) if the uWS app is not reachable.
 */
export function registerRtspRelay(app: any): void {
  const uws = app?.uwsApp;
  if (!uws || typeof uws.ws !== 'function') {
    console.warn('[rtsp-relay] uWebSockets app unavailable — %s not registered', WS_PATH);
    return;
  }
  uws.ws(WS_PATH, {
    maxPayloadLength: MAX_PAYLOAD,
    // 0 = no idle timeout: a camera feed is a continuous binary stream.
    idleTimeout: 0,
    // 0 = do not auto-close on backpressure; we manage it manually below.
    maxBackpressure: 0,
    upgrade: (res: any, req: any, context: any) => {
      const id = new URLSearchParams(req.getQuery() || '').get('id') ?? '';
      const state: RelayState = {
        id,
        upstream: null,
        queue: [],
        connected: false,
        upstreamPaused: false,
        closing: false,
        counted: false
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
      startRelay(ws);
    },
    message: (ws: any, message: ArrayBuffer) => {
      const st = ws.getUserData() as RelayState;
      // The ArrayBuffer is only valid during this callback — copy it.
      const buf = Buffer.from(new Uint8Array(message));
      if (st.connected && st.upstream) st.upstream.send(buf, { binary: true });
      else st.queue.push(buf);
    },
    drain: (ws: any) => {
      const st = ws.getUserData() as RelayState;
      if (st.upstreamPaused && st.upstream && ws.getBufferedAmount() < BACKPRESSURE_HIGH) {
        setUpstreamPaused(st.upstream, false);
        st.upstreamPaused = false;
      }
    },
    close: (ws: any) => {
      const st = ws.getUserData() as RelayState;
      st.closing = true;
      if (st.counted) {
        decrClient(st.id);
        st.counted = false;
      }
      st.upstream?.terminate();
    }
  });
  console.log('[rtsp-relay] registered %s', WS_PATH);
}

function startRelay(ws: any): void {
  const st = ws.getUserData() as RelayState;
  const url = managerStreamUrl(st.id);
  if (!url) {
    safeEnd(ws, 1008, 'invalid id');
    return;
  }

  // Count this browser as a live viewer of the camera (shown in the list).
  incrClient(st.id);
  st.counted = true;

  const upstream = new WebSocket(url, { perMessageDeflate: false, maxPayload: MAX_PAYLOAD });
  st.upstream = upstream;

  upstream.on('open', () => {
    st.connected = true;
    for (const buf of st.queue) upstream.send(buf, { binary: true });
    st.queue = [];
  });
  upstream.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
    if (st.closing) return;
    try {
      ws.send(toBuffer(data), true);
      if (ws.getBufferedAmount() > BACKPRESSURE_HIGH) {
        setUpstreamPaused(upstream, true);
        st.upstreamPaused = true;
      }
    } catch {
      upstream.terminate();
    }
  });
  upstream.on('close', () => safeEnd(ws, 1000, 'upstream closed'));
  upstream.on('error', (error: Error) => {
    console.warn('[rtsp-relay] upstream error %s: %s', st.id, error.message);
    safeEnd(ws, 1011, 'upstream error');
  });
}

function safeEnd(ws: any, code: number, msg: string): void {
  const st = ws.getUserData() as RelayState;
  if (st.closing) return;
  st.closing = true;
  st.upstream?.terminate();
  try {
    ws.end(code, msg);
  } catch {
    // WebSocket already closed.
  }
}
