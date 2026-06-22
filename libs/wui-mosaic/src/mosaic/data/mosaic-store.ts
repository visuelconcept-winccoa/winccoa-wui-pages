/**
 * Persistence layer for mosaic boards — one WinCC OA datapoint per mosaic
 * (type `Mosaic_Board`, a Struct with String elements `name` + `json`).
 *
 * Thin adapter over the shared {@link DpJsonStore}; it only wires the type/prefix
 * and keeps the page-specific method names. The `afterRead` hook backfills the
 * `tiles` array on legacy records that pre-date it.
 */
import { DpJsonStore } from '@visuelconcept/wui-kit/data/dp-json-store.js';
import { DEMO_MOSAICS } from './demo-mosaics.js';
import type { Mosaic } from '../types.js';

export class MosaicStore extends DpJsonStore<Mosaic> {
  constructor() {
    super(
      'Mosaic_Board',
      'Mosaic_',
      (mosaic) => mosaic.name,
      () => DEMO_MOSAICS.map((m) => structuredClone(m)),
      {
        slugFallback: 'mosaique',
        afterRead: (m) => {
          m.tiles = m.tiles ?? [];
          return m;
        },
        audit: { dpName: 'AuditTrail_Mosaic', itemType: 'Mosaic', exclude: ['updatedAt'] }
      }
    );
  }

  listMosaics(): Promise<Mosaic[]> {
    return this.list();
  }

  createMosaic(mosaic: Mosaic): Promise<Mosaic> {
    return this.create(mosaic);
  }

  saveMosaic(mosaic: Mosaic): Promise<void> {
    return this.save(mosaic);
  }

  deleteMosaic(id: string): Promise<void> {
    return this.remove(id);
  }

  /** Seed the backend with the supplied demo mosaics. */
  importDemo(mosaics: Mosaic[]): Promise<Mosaic[]> {
    return this.importMany(mosaics);
  }
}
