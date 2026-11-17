// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domain model for RTSP camera streams.
 *
 * Each entry describes one IP camera (an `rtsp://` URL plus the usual options:
 * transport, credentials, audio, target resolution / frame-rate / bitrate) that
 * the page can view *in the browser*. The browser never talks RTSP directly —
 * it cannot. Instead the bundled JSMpeg player opens a WebSocket to the
 * dedicated `rtspProxy` JavaScript manager, which resolves the camera *id* to
 * its rtsp URL server-side (it owns the allow-list), pulls the stream once with
 * ffmpeg, transcodes it to MPEG1-TS and fans it out to every connected client.
 * See {@link ./data/stream-store.ts} and `javascript/rtspProxy/index.js`.
 *
 * A second source kind, `local`, is a camera plugged into the PC running the
 * browser (webcam / USB camera): it is captured in the browser with
 * `getUserMedia` and never goes through the proxy. The datapoint only holds
 * the shared definition (name, group, resolution preset); which physical
 * device to open is a per-browser choice kept in localStorage (device ids
 * differ from one PC to the next) — see {@link ./data/local-camera.ts}.
 *
 * The credentials (when stored) stay server-side: they are injected into the
 * rtsp URL by the manager and never sent to the browser. They ARE persisted in
 * clear text in the datapoint though — see the security notice in the dialog.
 */

/** Where the video comes from: an RTSP IP camera (via the proxy) or a camera of this PC. */
export type CameraSourceKind = 'rtsp' | 'local';

/** Requested capture resolution of a local camera (an `ideal` hint, never a hard requirement). */
export type LocalResolution = 'default' | '480p' | '720p' | '1080p';

/** Resolution presets offered for a local camera, in display order. */
export const LOCAL_RESOLUTIONS: readonly LocalResolution[] = ['default', '480p', '720p', '1080p'];

/** RTSP transport (over TCP is the most reliable; UDP can have lower latency). */
export type RtspTransport = 'tcp' | 'udp';

/** A single RTSP camera stream definition. */
export interface CameraStream {
  /** Stable identifier (slug); unique within the list and used by the proxy. */
  id: string;
  /** Full backing DP name (e.g. "System1:RtspCamera_x"); absent until persisted. */
  dp?: string;

  /** Source kind; absent on records created before 0.2.0 → `rtsp`. */
  kind: CameraSourceKind;

  /** Display name. */
  name: string;
  /** Optional group / category label (purely for display ordering). */
  group: string;
  /** Free-text description / notes. */
  description: string;

  /** RTSP URL without credentials, e.g. `rtsp://10.0.5.21:554/Streaming/Channels/101`. */
  url: string;
  /** Optional username (injected into the URL server-side; not sent to the browser). */
  username: string;
  /** Optional password (stored in clear text in the DP when set; may be empty). */
  password: string;

  /** RTSP transport used by ffmpeg to pull the stream. */
  transport: RtspTransport;
  /** Include an audio track (MP2; off by default to save bandwidth/CPU). */
  audio: boolean;
  /** Downscale to this max width keeping aspect (0 = keep source resolution). */
  maxWidth: number;
  /** Output frame rate (0 = proxy default of 30 fps). */
  frameRate: number;
  /** Target video bitrate in kbps (0 = ffmpeg automatic). */
  videoBitrate: number;

  /** Local camera only: requested capture resolution (the device itself is chosen per browser). */
  localResolution: LocalResolution;

  /** Automatically reconnect the WebSocket after a drop. */
  autoReconnect: boolean;
  /** Delay between WebSocket reconnection attempts, in seconds. */
  reconnectDelaySec: number;

  /** Marked as a favourite (sorted first). */
  favorite: boolean;
  /** ISO-ish local timestamp of the last time the stream was opened (empty = never). */
  lastViewedAt: string;
}

/** Live RTSP reachability of a camera, probed cyclically server-side. */
export interface CameraStatus {
  /** Whether the last probe reached the RTSP stream. */
  reachable: boolean;
  /** ISO timestamp of the last probe. */
  checkedAt: string;
  /** Failure reason when unreachable (empty when reachable). */
  detail: string;
}

/** Default TCP port of an RTSP camera (used only when building example URLs). */
export const DEFAULT_RTSP_PORT = 554;
export const DEFAULT_RECONNECT_DELAY_SEC = 5;
/** Proxy default output frame rate (rtsp-relay hard-codes 30 fps). */
export const DEFAULT_FRAME_RATE = 30;

/** A blank camera stream with sensible defaults. */
export function blankStream(): CameraStream {
  return {
    id: '',
    kind: 'rtsp',
    name: '',
    group: '',
    description: '',
    url: '',
    username: '',
    password: '',
    transport: 'tcp',
    audio: false,
    maxWidth: 0,
    frameRate: 0,
    videoBitrate: 0,
    localResolution: 'default',
    autoReconnect: true,
    reconnectDelaySec: DEFAULT_RECONNECT_DELAY_SEC,
    favorite: false,
    lastViewedAt: ''
  };
}

/** Whether this entry is a camera of the PC running the browser (captured with getUserMedia). */
export function isLocalCamera(c: Pick<CameraStream, 'kind'>): boolean {
  return c.kind === 'local';
}

/** Extract the `host[:port]` from the rtsp URL for display (without credentials). */
export function streamHost(c: CameraStream): string {
  const match = /^rtsps?:\/\/(?:[^@/]*@)?([^/?#]+)/i.exec(c.url.trim());
  return match ? match[1] : c.url.trim() || '—';
}

/**
 * Build the WebSocket URL the JSMpeg player connects to. Same-origin
 * (`/api/rtsp/ws?id=…` on the dashboard), so it inherits the dashboard's TLS and
 * authentication — no mixed content, no extra port. The dashboard webserver
 * proxies it to the internal `rtspProxy` manager. `wss:` is used automatically
 * when the page is served over HTTPS.
 */
export function streamWsUrl(c: CameraStream): string {
  const loc = globalThis.location;
  const proto = loc?.protocol === 'https:' ? 'wss' : 'ws';
  const host = loc?.host || 'localhost';
  return `${proto}://${host}/api/rtsp/ws?id=${encodeURIComponent(c.id)}`;
}
