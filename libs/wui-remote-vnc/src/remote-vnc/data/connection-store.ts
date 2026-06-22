/**
 * Persistence layer for remote VNC connections — one WinCC OA datapoint per
 * connection (type `RemoteVnc_Connection`, a Struct with String elements `name`
 * + `json`, the latter holding the full serialized {@link VncConnection}).
 *
 * Thin adapter over the shared {@link DpJsonStore}; it only wires the
 * type/prefix and keeps the page-specific method names. The `VncProxy` MSA
 * manager reads these same DPs server-side to resolve a connection id →
 * host:port.
 */
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { DEMO_CONNECTIONS } from './demo-connections.js';
import type { VncConnection } from '../types.js';

export class ConnectionStore extends DpJsonStore<VncConnection> {
  constructor() {
    super(
      'RemoteVnc_Connection',
      'RemoteVnc_',
      (conn) => conn.name,
      () => DEMO_CONNECTIONS.map((c) => structuredClone(c)),
      {
        slugFallback: 'vnc',
        slugSource: (c) => c.name || c.host,
        audit: {
          dpName: 'AuditTrail_RemoteVnc',
          itemType: 'VncConnection',
          exclude: ['lastConnectedAt'],
          redact: ['password']
        }
      }
    );
  }

  listConnections(): Promise<VncConnection[]> {
    return this.list();
  }

  createConnection(conn: VncConnection): Promise<VncConnection> {
    return this.create(conn);
  }

  saveConnection(conn: VncConnection): Promise<void> {
    return this.save(conn);
  }

  deleteConnection(id: string): Promise<void> {
    return this.remove(id);
  }

  /** Seed the backend with the supplied demo connections. */
  importDemo(connections: VncConnection[]): Promise<VncConnection[]> {
    return this.importMany(connections);
  }
}
