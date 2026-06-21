// -----------------------------------------------------------------------------
// RtspController
// -----------------------------------------------------------------------------
// HTTP/health side of the RTSP camera bridge, plus the helper that turns a
// camera id into the internal URL of the rtspProxy JavaScript manager.
//
// The browser's JSMpeg player opens a SAME-ORIGIN WebSocket to
// /api/rtsp/ws?id=<id> on the dashboard (so it inherits the dashboard's TLS and
// authentication — no mixed content, no extra port/cert). The relay (rtspRelay.ts)
// then proxies it, ws↔ws, to the rtspProxy manager which owns the id → rtsp URL
// allow-list, pulls the stream once with ffmpeg and fans it out (one-to-many).
//
// The manager listens on 127.0.0.1 only, so it is reachable from this webserver
// (same host) but never directly from the network.
// -----------------------------------------------------------------------------

import * as http from 'node:http';

import { Request, Response } from 'ultimate-express';

/** Host/port of the rtspProxy manager (must match its RTSP_PROXY_* config). */
const MANAGER_HOST = process.env.RTSP_PROXY_HOST || '127.0.0.1';
const MANAGER_PORT = Number(process.env.RTSP_PROXY_PORT) || 9999;
const STATUS_TIMEOUT_MS = 4000;
/** Camera ids are slugs created by the page — guard before building the URL. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Build the internal manager WebSocket URL for a camera id, or null if invalid. */
export function managerStreamUrl(id: string): string | null {
  if (!ID_RE.test(id)) return null;
  return `ws://${MANAGER_HOST}:${MANAGER_PORT}/api/rtsp/stream/${encodeURIComponent(id)}`;
}

// --- Live connected-client counter (per camera id) ---------------------------
// The relay (rtspRelay.ts) is the same-origin entry point for every browser
// viewer, so it is the authoritative place to count how many clients are
// currently watching each camera. The count is exposed via GET /api/rtsp/clients
// and shown in the camera list.
const clientCounts = new Map<string, number>();

export function incrClient(id: string): void {
  clientCounts.set(id, (clientCounts.get(id) ?? 0) + 1);
}

export function decrClient(id: string): void {
  const n = (clientCounts.get(id) ?? 1) - 1;
  if (n <= 0) clientCounts.delete(id);
  else clientCounts.set(id, n);
}

/** Snapshot of the per-camera connected-client counts (ids with >0 viewers). */
export function getClientCounts(): Record<string, number> {
  return Object.fromEntries(clientCounts);
}

/**
 * Fetch the per-camera RTSP reachability status from the rtspProxy manager
 * (which runs the cyclic probe). Returns `{}` on any error so the page degrades
 * gracefully (all indicators "unknown").
 */
function fetchManagerStatus(): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const url = `http://${MANAGER_HOST}:${MANAGER_PORT}/api/rtsp/status`;
    const req = http.get(url, { timeout: STATUS_TIMEOUT_MS }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body) as Record<string, unknown>);
        } catch {
          resolve({});
        }
      });
    });
    req.on('error', () => resolve({}));
    req.on('timeout', () => {
      req.destroy();
      resolve({});
    });
  });
}

/**
 * Controller for the RTSP bridge HTTP endpoints. The live camera stream runs
 * over the WebSocket relay (see rtspRelay.ts).
 */
export class RtspController {
  /** GET /api/rtsp/health -> liveness + the configured manager endpoint. */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'rtsp', manager: `${MANAGER_HOST}:${MANAGER_PORT}` });
  };

  /** GET /api/rtsp/clients -> { "<cameraId>": <connectedClients>, ... }. */
  public clients = (_req: Request, res: Response): void => {
    res.status(200).json(getClientCounts());
  };

  /** GET /api/rtsp/status -> { "<cameraId>": { reachable, checkedAt, detail }, ... }. */
  public status = async (_req: Request, res: Response): Promise<void> => {
    res.status(200).json(await fetchManagerStatus());
  };
}
