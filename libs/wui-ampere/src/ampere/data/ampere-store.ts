// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Persistence for Ampère networks — one WinCC OA datapoint per network
 * (type `Ampere_Network`, a Struct with String elements `name` + `json`).
 *
 * Thin adapter over the shared {@link DpJsonStore}; it only wires the type/prefix
 * and keeps the page-specific method names. The `afterRead` hook backfills the
 * graph arrays on legacy records that pre-date a field.
 */
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { demoNetworks } from './demo.js';
import type { Network } from '../types.js';

export class AmpereStore extends DpJsonStore<Network> {
  constructor() {
    super(
      'Ampere_Network',
      'Ampere_',
      (network) => network.name,
      () => demoNetworks(),
      {
        slugFallback: 'reseau',
        afterRead: (n) => {
          n.nodes = n.nodes ?? [];
          n.edges = n.edges ?? [];
          n.measurements = n.measurements ?? [];
          return n;
        },
        audit: { dpName: 'AuditTrail_Ampere', itemType: 'Ampere', exclude: ['updatedAt'] }
      }
    );
  }

  listNetworks(): Promise<Network[]> {
    return this.list();
  }

  createNetwork(network: Network): Promise<Network> {
    return this.create(network);
  }

  /** Persist a network; see DpJsonStore.save for the per-call audit options. */
  saveNetwork(network: Network, opts: { audit?: boolean; auditBaseline?: Network } = {}): Promise<void> {
    return this.save(network, opts);
  }

  deleteNetwork(id: string): Promise<void> {
    return this.remove(id);
  }

  /** Seed the backend with the supplied demo networks. */
  importDemo(networks: Network[]): Promise<Network[]> {
    return this.importMany(networks);
  }
}
