/**
 * Demo mosaics (self-contained). Used both as the offline in-memory seed and the
 * empty-state "generate demo" action. References point at the demo ateliers /
 * VNC connections seeded by the other pages; where a referenced source does not
 * exist, the tile simply shows the dashboard's not-found view inside its frame.
 */
import { blankMosaic, blankTile, embeddedViewUrl, snapToGrid, type Mosaic, type Tile } from '../types.js';

/* eslint-disable @typescript-eslint/no-magic-numbers -- layout fractions in % (grid-snapped) */
/** Common layout splits in %, snapped to the grid (works for any GRID_DIVISIONS). */
const HALF = snapToGrid(50);
const TWO_THIRDS = snapToGrid(200 / 3);
const ONE_THIRD = snapToGrid(100 / 3);
const FULL_H = 100;
/* eslint-enable @typescript-eslint/no-magic-numbers */

function tile(part: Partial<Tile>): Tile {
  return { ...blankTile(), id: '', ...part };
}

function mosaic(id: string, name: string, description: string, tiles: Tile[]): Mosaic {
  return {
    ...blankMosaic(),
    id,
    name,
    description,
    tiles: tiles.map((t, i) => ({ ...t, id: `${id}-t${i + 1}` }))
  };
}

export const DEMO_MOSAICS: Mosaic[] = [
  mosaic('mosaic-demo-control-room', 'Salle de contrôle', 'Parc 3D + pupitre distant + caméra + OF (2×2).', [
    tile({ kind: 'fleet-3d', title: 'Parc machines — vue 3D', ref: '', x: 0, y: 0, w: HALF, h: HALF }),
    tile({
      kind: 'remote-vnc',
      title: 'IHM Ligne 1 (lecture seule)',
      ref: 'vnc-demo-hmi-ligne1',
      x: HALF,
      y: 0,
      w: HALF,
      h: HALF
    }),
    tile({
      kind: 'camera',
      title: 'Caméra entrée usinage',
      ref: 'cam-demo-usinage-entree',
      x: 0,
      y: HALF,
      w: HALF,
      h: HALF
    }),
    tile({
      kind: 'url',
      title: 'Ordres de production',
      url: embeddedViewUrl('/production-orders'),
      x: HALF,
      y: HALF,
      w: HALF,
      h: HALF
    })
  ]),
  mosaic('mosaic-demo-usinage', 'Atelier usinage', 'Atelier 3D (2/3) + pupitre four (1/3).', [
    tile({ kind: 'fleet-3d', title: 'Atelier usinage — 3D', ref: '', x: 0, y: 0, w: TWO_THIRDS, h: FULL_H }),
    tile({
      kind: 'remote-vnc',
      title: 'Four nitruration (lecture seule)',
      ref: 'vnc-demo-four-nitruration',
      x: TWO_THIRDS,
      y: 0,
      w: ONE_THIRD,
      h: FULL_H
    })
  ])
];
