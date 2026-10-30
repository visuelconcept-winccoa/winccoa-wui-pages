// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The VNC connections, through this module's own routes (backend/vncRoute.ts):
 *
 *   GET    /api/vnc/connections             list (role view | connect), never a password
 *   POST   /api/vnc/connection              create (role edit, audited)
 *   PUT    /api/vnc/connection/:id          update (role edit, audited; no password field = keep it)
 *   DELETE /api/vnc/connection/:id          delete (role edit, audited)
 *   POST   /api/vnc/connection/:id/favorite star (role view)
 *
 * Until 0.1 the page wrote the `RemoteVnc_<id>` datapoints itself through
 * wui-kit's DpJsonStore (`/api/para`), so the `edit` role was only checked in
 * the browser; the backend now checks it and writes the audit trail
 * (`AuditTrail_RemoteVnc`). The datapoint format is unchanged.
 *
 * When the backend does not answer (module not deployed, webserver not
 * restarted), the store falls back to an in-memory list seeded with the demo
 * connections and flips `offline` — as DpJsonStore did.
 */
import { vncCall, type ApiOutcome } from './api.js';
import { DEMO_CONNECTIONS } from './demo-connections.js';
import type { VncConnection } from '../types.js';

/** A write the backend refused (403 / 400): the page shows `reason`. */
export class StoreRefusal extends Error {
  constructor(readonly kind: 'forbidden' | 'invalid' | 'not-found', message: string) {
    super(message);
  }
}

const ID_RADIX = 36;

interface ListBody {
  connections: VncConnection[];
}

interface OneBody {
  connection: VncConnection;
}

export class ConnectionStore {
  /** True when running without the backend (in-memory demo list, nothing persisted). */
  offline = false;
  /** The last list answered 403 (no `view` / `connect` role). */
  forbidden = false;

  private memory: VncConnection[] | null = null;

  async listConnections(): Promise<VncConnection[]> {
    this.forbidden = false;
    if (this.offline) return this.mem();
    const out = await vncCall<ListBody>('/connections');
    if (out.kind === 'ok') return Array.isArray(out.body.connections) ? out.body.connections : [];
    if (out.kind === 'forbidden') {
      this.forbidden = true;
      return [];
    }
    this.offline = true;
    return this.mem();
  }

  async createConnection(conn: VncConnection): Promise<VncConnection> {
    if (this.offline) {
      const created = { ...withoutSecret(conn), id: `vnc-${Date.now().toString(ID_RADIX)}`, hasPassword: Boolean(conn.password) };
      this.mem().push(created);
      return created;
    }
    const { id: _id, dp: _dp, hasPassword: _has, lastConnectedAt: _last, ...body } = conn;
    return this.one(await vncCall<OneBody>('/connection', { method: 'POST', body }));
  }

  /** Save `conn`; its `password` is sent only when set (a string), else the stored one is kept. */
  async saveConnection(conn: VncConnection): Promise<VncConnection> {
    if (this.offline) {
      const saved = { ...withoutSecret(conn), hasPassword: conn.password === undefined ? Boolean(conn.hasPassword) : conn.password !== '' };
      this.memory = this.mem().map((c) => (c.id === conn.id ? saved : c));
      return saved;
    }
    const { id, dp: _dp, hasPassword: _has, lastConnectedAt: _last, ...body } = conn;
    return this.one(await vncCall<OneBody>(`/connection/${encodeURIComponent(id)}`, { method: 'PUT', body }));
  }

  async setFavorite(id: string, favorite: boolean): Promise<VncConnection | null> {
    if (this.offline) {
      this.memory = this.mem().map((c) => (c.id === id ? { ...c, favorite } : c));
      return this.mem().find((c) => c.id === id) ?? null;
    }
    return this.one(await vncCall<OneBody>(`/connection/${encodeURIComponent(id)}/favorite`, { method: 'POST', body: { favorite } }));
  }

  async deleteConnection(id: string): Promise<void> {
    if (this.offline) {
      this.memory = this.mem().filter((c) => c.id !== id);
      return;
    }
    const out = await vncCall<object>(`/connection/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (out.kind !== 'ok' && out.kind !== 'not-found') throw refusal(out);
  }

  /** Create the supplied demo connections. */
  async importDemo(connections: VncConnection[]): Promise<VncConnection[]> {
    const out: VncConnection[] = [];
    for (const seed of connections) out.push(await this.createConnection(seed));
    return out;
  }

  private one(out: ApiOutcome<OneBody>): VncConnection {
    if (out.kind === 'ok') return out.body.connection;
    throw refusal(out);
  }

  private mem(): VncConnection[] {
    this.offline = true;
    this.memory ??= DEMO_CONNECTIONS.map((c) => structuredClone(c));
    return this.memory;
  }
}

function withoutSecret(conn: VncConnection): VncConnection {
  const { password: _password, ...rest } = conn;
  return rest;
}

function refusal(out: Exclude<ApiOutcome<unknown>, { kind: 'ok' }>): Error {
  if (out.kind === 'forbidden') return new StoreRefusal('forbidden', 'forbidden');
  if (out.kind === 'not-found') return new StoreRefusal('not-found', 'not found');
  return out.kind === 'invalid' ? new StoreRefusal('invalid', out.message) : new Error(out.message);
}
