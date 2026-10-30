// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import / export helpers for the VNC connection catalogue.
 *
 * - `exportJson` exports the whole catalogue; `exportConnection` exports a single
 *   entry. Both use the same envelope (`{ kind, version, connections }`) so a
 *   single-connection file re-imports exactly like a full one.
 * - `parseConnections` accepts a bare array, the export envelope, or a single
 *   connection object, and coerces each record against {@link blankConnection}.
 *
 * Passwords: since 0.2 the backend never sends them to the browser, so an
 * export carries none. An imported record keeps its `password` only when the
 * file has one (a string): absent, the stored password of an existing
 * connection is kept (files exported by 0.1 still hold them in clear text —
 * they are imported, then never shown again).
 */
import {
  DEFAULT_CONNECT_TIMEOUT_SEC,
  DEFAULT_MAX_RECONNECT_ATTEMPTS,
  DEFAULT_RECONNECT_DELAY_SEC,
  DEFAULT_VNC_PORT,
  blankConnection,
  type VncConnection
} from '../types.js';
import { JSON_INDENT, download, timestampSlug } from '@visuelconcept-winccoa/wui-kit/data/io.js';

const KIND = 'remote-vnc-connections';
const SLUG_MAX = 40;

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, SLUG_MAX) || 'connexion'
  );
}

function envelope(connections: VncConnection[]): string {
  const clean = connections.map(({ password: _password, hasPassword: _has, ...rest }) => rest);
  return JSON.stringify({ kind: KIND, version: 1, connections: clean }, null, JSON_INDENT);
}

/** Download the whole catalogue as a JSON file. */
export function exportJson(connections: VncConnection[]): void {
  download(`remote-vnc-connections-${timestampSlug()}.json`, envelope(connections), 'application/json');
}

/** Download a single connection as a JSON file (same envelope as the catalogue). */
export function exportConnection(conn: VncConnection): void {
  download(`vnc-${slug(conn.name || conn.host)}.json`, envelope([conn]), 'application/json');
}

/**
 * Parse imported JSON into a normalized connection list. Accepts a bare array,
 * the export envelope (`{ connections: [...] }`), or a single connection object.
 * Throws when the payload holds no recognizable connection.
 */
export function parseConnections(text: string): VncConnection[] {
  const raw: unknown = JSON.parse(text);
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['connections'])) list = obj['connections'];
    else if ('host' in obj || 'name' in obj) list = [obj];
  }
  if (!Array.isArray(list)) {
    throw new TypeError('Format invalide : aucune connexion VNC trouvée.');
  }
  return list.map((item) => normalize(item as Partial<VncConnection>));
}

function normalize(item: Partial<VncConnection>): VncConnection {
  const base = blankConnection();
  const out: VncConnection = { ...base };
  for (const key of Object.keys(base) as (keyof VncConnection)[]) {
    if (item[key] !== undefined && item[key] !== null) {
      (out as unknown as Record<string, unknown>)[key] = item[key];
    }
  }
  // Write-only password: only what the file holds (absent = keep the stored one).
  if (typeof item.password === 'string') out.password = item.password;
  else delete out.password;
  delete out.hasPassword;
  out.port = Number(out.port) || DEFAULT_VNC_PORT;
  out.viewOnly = Boolean(out.viewOnly);
  out.shared = Boolean(out.shared);
  out.favorite = Boolean(out.favorite);
  out.connectTimeoutSec = Number(out.connectTimeoutSec) || DEFAULT_CONNECT_TIMEOUT_SEC;
  out.autoReconnect = Boolean(out.autoReconnect);
  out.reconnectDelaySec = Number(out.reconnectDelaySec) || DEFAULT_RECONNECT_DELAY_SEC;
  const maxAttempts = Number(out.maxReconnectAttempts);
  out.maxReconnectAttempts =
    Number.isFinite(maxAttempts) && maxAttempts >= 0 ? maxAttempts : DEFAULT_MAX_RECONNECT_ATTEMPTS;
  return out;
}
