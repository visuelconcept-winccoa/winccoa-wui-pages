// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain model for Remote VNC connections.
 *
 * Each entry describes one VNC endpoint (host + port, optional password and a
 * few RFB options) that the page can open *in the browser* with the bundled
 * noVNC client. The browser never connects to the VNC server directly: noVNC
 * speaks the RFB protocol over a WebSocket to the same-origin `/api/vnc/ws`
 * relay, which resolves the connection *id* to its host:port server-side (the
 * `VncProxy` MSA manager owns the allow-list) and proxies the raw TCP stream
 * (websockify-style). See {@link ./data/connection-store.ts}.
 *
 * The VNC password (when stored) stays an end-to-end secret between noVNC and
 * the VNC server (RFB auth is done by the client, the relay is a dumb byte
 * pipe), but it IS persisted in clear text in the datapoint — see the security
 * notice in the dialog.
 */

/** A single remote VNC connection definition. */
export interface VncConnection {
  /** Stable identifier (slug); unique within the list and used by the relay. */
  id: string;
  /** Full backing DP name (e.g. "System1:RemoteVnc_x"); absent until persisted. */
  dp?: string;

  /** Display name. */
  name: string;
  /** Target host / IP of the VNC server. */
  host: string;
  /** Target TCP port (VNC default 5900). */
  port: number;
  /** VNC password (stored in clear text in the DP when set; may be empty). */
  password: string;
  /** Free-text description / notes. */
  description: string;
  /** Optional group / category label (purely for display ordering). */
  group: string;

  /** Open the session read-only (no keyboard/mouse to the remote). */
  viewOnly: boolean;
  /** RFB shared flag: allow other clients to stay connected. */
  shared: boolean;

  /** Connection timeout in seconds (give up / retry if not connected in time). */
  connectTimeoutSec: number;
  /** Automatically reconnect after an unexpected disconnect or a timeout. */
  autoReconnect: boolean;
  /** Delay between reconnection attempts, in seconds. */
  reconnectDelaySec: number;
  /** Maximum number of automatic reconnection attempts (0 = unlimited). */
  maxReconnectAttempts: number;

  /** Marked as a favourite (sorted first). */
  favorite: boolean;
  /** ISO-ish local timestamp of the last session opened from the page (empty = never). */
  lastConnectedAt: string;
}

/** Live TCP reachability of a connection's configured socket, tested server-side. */
export interface VncStatus {
  /** Whether the last socket test reached the configured host:port. */
  reachable: boolean;
  /** ISO timestamp of the last test. */
  checkedAt: string;
  /** Failure reason when unreachable (empty when reachable). */
  detail: string;
}

export const DEFAULT_VNC_PORT = 5900;
/** Default connection-timeout / reconnection parameters. */
export const DEFAULT_CONNECT_TIMEOUT_SEC = 15;
export const DEFAULT_RECONNECT_DELAY_SEC = 5;
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3;

/** A blank connection with sensible defaults. */
export function blankConnection(): VncConnection {
  return {
    id: '',
    name: '',
    host: '',
    port: DEFAULT_VNC_PORT,
    password: '',
    description: '',
    group: '',
    viewOnly: false,
    shared: true,
    connectTimeoutSec: DEFAULT_CONNECT_TIMEOUT_SEC,
    autoReconnect: true,
    reconnectDelaySec: DEFAULT_RECONNECT_DELAY_SEC,
    maxReconnectAttempts: DEFAULT_MAX_RECONNECT_ATTEMPTS,
    favorite: false,
    lastConnectedAt: ''
  };
}

/** `host:port` endpoint label. */
export function endpoint(c: VncConnection): string {
  return `${c.host || '—'}:${c.port || DEFAULT_VNC_PORT}`;
}
