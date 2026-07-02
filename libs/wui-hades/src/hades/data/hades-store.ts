// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistence layer for tunnels.
 *
 * Each tunnel is one WinCC OA datapoint of type `Hades_Tunnel` (Struct with
 * `name` + `json`, the latter holding the serialized {@link Tunnel}) managed by
 * the shared {@link DpJsonStore} (auto-created type via the PARA REST API,
 * in-memory offline fallback seeded with the demo tunnel). Every tunnel
 * create/update/delete is GxP-traced into the `AuditTrail_Hades` DP; live
 * equipment fields (`state`, `measures`) are stripped before diffing so
 * telemetry churn never logs a spurious UPDATE row.
 */
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { demoTunnel } from './demo-tunnel.js';
import type { EquipmentDef, Tunnel } from '../types.js';

const TUNNEL_TYPE = 'Hades_Tunnel';
const TUNNEL_PREFIX = 'Hades_';
/** Shared GxP audit DP for the whole Hades feature (tunnel CRUD + commands). */
export const HADES_AUDIT_DP = 'AuditTrail_Hades';

/** Drop the live runtime fields of an equipment (kept out of persistence diffs). */
function stripLive(equipment: EquipmentDef): EquipmentDef {
  const { state: _state, measures: _measures, ...config } = equipment;
  return config;
}

/** Project a tunnel to its persisted/audited config (live telemetry removed). */
export function projectTunnel(tunnel: Tunnel): Tunnel {
  return { ...tunnel, equipment: tunnel.equipment.map((e) => stripLive(e)) };
}

export class HadesStore {
  private readonly store = new DpJsonStore<Tunnel>(
    TUNNEL_TYPE,
    TUNNEL_PREFIX,
    (t) => t.name,
    () => [demoTunnel()],
    {
      slugFallback: 'tunnel',
      audit: {
        dpName: HADES_AUDIT_DP,
        itemType: 'Tunnel'
      }
    }
  );

  /** True when running without a writable backend (in-memory fallback). */
  get offline(): boolean {
    return this.store.offline;
  }

  listTunnels(): Promise<Tunnel[]> {
    return this.store.list();
  }

  createTunnel(tunnel: Tunnel, id?: string): Promise<Tunnel> {
    return this.store.create(projectTunnel(tunnel), { id });
  }

  saveTunnel(tunnel: Tunnel): Promise<void> {
    return this.store.save(projectTunnel(tunnel));
  }

  deleteTunnel(id: string): Promise<void> {
    return this.store.remove(id);
  }
}
