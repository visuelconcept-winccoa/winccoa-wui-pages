// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import / export helpers for the RTSP camera catalogue.
 *
 * - `exportJson` exports the whole catalogue; `exportStream` exports a single
 *   entry. Both use the same envelope (`{ kind, version, streams }`) so a
 *   single-camera file re-imports exactly like a full one.
 * - `parseStreams` accepts a bare array, the export envelope, or a single camera
 *   object, and coerces each record against {@link blankStream}.
 *
 * NB: exports include the stored RTSP password in clear text (same trade-off as
 * the datapoint storage — see the dialog warning).
 */
import { DEFAULT_RECONNECT_DELAY_SEC, blankStream, type CameraStream } from '../types.js';
import { JSON_INDENT, download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';

const KIND = 'rtsp-camera-streams';
const SLUG_MAX = 40;

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, SLUG_MAX) || 'camera'
  );
}

function envelope(streams: CameraStream[]): string {
  return JSON.stringify({ kind: KIND, version: 1, streams }, null, JSON_INDENT);
}

/** Download the whole catalogue as a JSON file. */
export function exportJson(streams: CameraStream[]): void {
  download(`rtsp-cameras-${timestampSlug()}.json`, envelope(streams), 'application/json');
}

/** Download a single camera as a JSON file (same envelope as the catalogue). */
export function exportStream(cam: CameraStream): void {
  download(`camera-${slug(cam.name)}.json`, envelope([cam]), 'application/json');
}

/**
 * Parse imported JSON into a normalized camera list. Accepts a bare array, the
 * export envelope (`{ streams: [...] }`), or a single camera object. Throws when
 * the payload holds no recognizable camera.
 */
export function parseStreams(text: string): CameraStream[] {
  const raw: unknown = JSON.parse(text);
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['streams'])) list = obj['streams'];
    else if ('url' in obj || 'name' in obj) list = [obj];
  }
  if (!Array.isArray(list)) {
    throw new TypeError('Format invalide : aucune caméra RTSP trouvée.');
  }
  return list.map((item) => normalize(item as Partial<CameraStream>));
}

function normalize(item: Partial<CameraStream>): CameraStream {
  const base = blankStream();
  const keys = Object.keys(base) as (keyof CameraStream)[];
  const defined = Object.fromEntries(
    keys.filter((key) => item[key] !== undefined && item[key] !== null).map((key) => [key, item[key]])
  ) as Partial<CameraStream>;
  const out: CameraStream = { ...base, ...defined };
  out.transport = out.transport === 'udp' ? 'udp' : 'tcp';
  out.audio = Boolean(out.audio);
  out.maxWidth = Math.max(0, Number(out.maxWidth) || 0);
  out.frameRate = Math.max(0, Number(out.frameRate) || 0);
  out.videoBitrate = Math.max(0, Number(out.videoBitrate) || 0);
  out.autoReconnect = Boolean(out.autoReconnect);
  out.reconnectDelaySec = Number(out.reconnectDelaySec) || DEFAULT_RECONNECT_DELAY_SEC;
  out.favorite = Boolean(out.favorite);
  return out;
}
