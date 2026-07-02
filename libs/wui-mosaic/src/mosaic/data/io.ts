// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import / export helpers for the mosaic catalogue.
 *
 * - `exportJson` exports the whole catalogue; `exportMosaic` exports a single
 *   board. Both use the same envelope (`{ kind, version, mosaics }`) so a
 *   single-mosaic file re-imports exactly like a full one.
 * - `parseMosaics` accepts a bare array, the export envelope, or a single mosaic
 *   object, and coerces each record (and its tiles) against the blank defaults —
 *   so importing one or several mosaics works from any of these shapes.
 */
import { blankMosaic, blankTile, type Mosaic, type Tile, type TileKind } from '../types.js';
import { JSON_INDENT, download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';

const KIND = 'mosaic-boards';
const SLUG_MAX = 40;
const TILE_KINDS = new Set<string>(['fleet-3d', 'remote-vnc', 'camera', 'url']);

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replaceAll(/[^a-z0-9]+/g, '-')
      .replaceAll(/(^-|-$)/g, '')
      .slice(0, SLUG_MAX) || 'mosaique'
  );
}

function envelope(mosaics: Mosaic[]): string {
  return JSON.stringify({ kind: KIND, version: 1, mosaics }, null, JSON_INDENT);
}

/** Download the whole catalogue as a JSON file. */
export function exportJson(mosaics: Mosaic[]): void {
  download(`mosaics-${timestampSlug()}.json`, envelope(mosaics), 'application/json');
}

/** Download a single mosaic as a JSON file (same envelope as the catalogue). */
export function exportMosaic(mosaic: Mosaic): void {
  download(`mosaic-${slug(mosaic.name)}.json`, envelope([mosaic]), 'application/json');
}

/**
 * Parse imported JSON into a normalized mosaic list. Accepts a bare array, the
 * export envelope (`{ mosaics: [...] }`), or a single mosaic object. Throws when
 * the payload holds no recognizable mosaic.
 */
export function parseMosaics(text: string): Mosaic[] {
  const raw: unknown = JSON.parse(text);
  let list: unknown;
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj['mosaics'])) list = obj['mosaics'];
    else if ('tiles' in obj || 'name' in obj) list = [obj];
  }
  if (!Array.isArray(list)) {
    throw new TypeError('Format invalide : aucune mosaïque trouvée.');
  }
  return list.map((item) => normalizeMosaic(item as Record<string, unknown>));
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeMosaic(item: Record<string, unknown>): Mosaic {
  const base = blankMosaic();
  const rawTiles = Array.isArray(item['tiles']) ? item['tiles'] : [];
  const tiles = rawTiles.map((t, i) => {
    const tile = normalizeTile(t as Record<string, unknown>);
    return tile.id ? tile : { ...tile, id: `t-${i}` };
  });
  return {
    ...base,
    id: asString(item['id']),
    name: asString(item['name']),
    description: asString(item['description']),
    updatedAt: asString(item['updatedAt']),
    tiles
  };
}

function normalizeTile(item: Record<string, unknown>): Tile {
  const base = blankTile();
  const kind = TILE_KINDS.has(asString(item['kind'])) ? (item['kind'] as TileKind) : base.kind;
  return {
    ...base,
    id: asString(item['id']),
    kind,
    title: asString(item['title']),
    ref: asString(item['ref']),
    url: asString(item['url']),
    x: asNumber(item['x'], base.x),
    y: asNumber(item['y'], base.y),
    w: asNumber(item['w'], base.w),
    h: asNumber(item['h'], base.h),
    interactive: Boolean(item['interactive']),
    refresh: asNumber(item['refresh'], 0)
  };
}
