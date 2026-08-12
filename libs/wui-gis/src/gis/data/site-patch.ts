// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Patch semantics for the GIS AI assistant: how a proposal *completes* a site
 * instead of replacing it.
 *
 * The assistant used to emit a whole `Site`, which meant every proposal — even
 * "add two boreholes" — overwrote the open site. That was not a prompting
 * accident but a consequence of the contract: a whole-document answer is the only
 * sentence the model could write, and the context it receives deliberately omits
 * datapoint bindings and rings, so it *cannot* rewrite a site faithfully. The
 * answer is to give it an operation vocabulary and do the merge here:
 *
 *   - `upsert` by **id**: a known id merges field by field (only the fields the
 *     patch actually carries), an unknown id creates. Anything the patch does not
 *     mention is preserved — that is what protects `dp`, `readings` and `notes`
 *     the model never saw.
 *   - `remove` by id: explicit, never implied by omission.
 *   - `generate`: one parametric op stands in for hundreds of assets (a line of
 *     valves, a grid of lamps), so bulk creation does not have to fit — object by
 *     object — inside the model's output budget.
 *   - `mode: 'replace'`: the old behaviour, kept for "start over", and now shown
 *     for what it is because {@link diffSites} counts what it destroys.
 *
 * The merge is performed on the RAW objects and the result is handed to
 * {@link normalizeSite}, so every field goes through the one sanitiser that
 * already knows how to coerce this domain — no second, drifting copy of it. Ids
 * are stable through that pass because existing objects keep their position and
 * claim their own slug first.
 *
 * Nothing here throws: the input is model output.
 */
import { normalizeSite, type NormalizedSite } from './normalize.js';
import {
  blankSite,
  clamp,
  isValidLatLon,
  type Area,
  type Asset,
  type Site
} from '../types.js';

/** Metres per degree of latitude (WGS 84 mean) — enough for asset spacing. */
const METERS_PER_DEGREE = 111_320;
/** Hard ceiling on ONE generate op, so a runaway `count` cannot lock the page. */
const GENERATE_MAX = 2000;

/** What {@link expandGenerate} produced, and whether it had to cut an op short. */
export interface Generated {
  assets: Record<string, unknown>[];
  /** True when an op asked for more than {@link GENERATE_MAX}. */
  clamped: boolean;
}
const MIN_RING = 3;
const FULL_TURN = 360;
const DEG_TO_RAD = Math.PI / 180;

// --- the patch shape ---------------------------------------------------------

/** Which of the two contracts the model used. */
export type PatchMode = 'patch' | 'replace';

/** A parsed, still-untrusted patch: values are coerced later, by the sanitiser. */
export interface SitePatch {
  mode: PatchMode;
  /** Site-level fields (name, description, category, center, zoom) — absent = unchanged. */
  site: Record<string, unknown> | null;
  areas: { upsert: unknown[]; remove: string[] };
  assets: { upsert: unknown[]; remove: string[]; generate: unknown[] };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function ids(value: unknown): string[] {
  return list(value)
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function num(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** True when the patch asks for nothing at all — no button should be offered. */
export function isEmptyPatch(patch: SitePatch): boolean {
  if (patch.mode === 'replace') return false;
  return (
    patch.site === null &&
    patch.areas.upsert.length === 0 &&
    patch.areas.remove.length === 0 &&
    patch.assets.upsert.length === 0 &&
    patch.assets.remove.length === 0 &&
    patch.assets.generate.length === 0
  );
}

/**
 * Read a fenced block into a {@link SitePatch}, or `null` when it is neither
 * contract. A `replace` proposal, and the legacy bare `Site` object (which is the
 * same thing), both come back as `mode: 'replace'` carrying their content in the
 * upsert lists — so the rest of the pipeline only ever sees one shape.
 */
export function parseSitePatch(raw: unknown): SitePatch | null {
  const source = record(raw);
  if (!source) return null;
  const body = record(source['site']) ?? source;
  const mode = String(source['mode'] ?? '').toLowerCase();

  if (mode === 'patch') {
    const areas = record(source['areas']) ?? {};
    const assets = record(source['assets']) ?? {};
    const meta = metaOf(source['site'] === undefined ? source : source['site']);
    return {
      mode: 'patch',
      site: meta,
      areas: { upsert: list(areas['upsert']), remove: ids(areas['remove']) },
      assets: {
        upsert: list(assets['upsert']),
        remove: ids(assets['remove']),
        generate: list(assets['generate'])
      }
    };
  }
  // `mode: "replace"`, or a bare Site — both mean "this IS the site now".
  const hasContent =
    Array.isArray(body['areas']) || Array.isArray(body['assets']);
  if (!hasContent) return null;
  return {
    mode: 'replace',
    site: metaOf(body),
    areas: { upsert: list(body['areas']), remove: [] },
    assets: {
      upsert: list(body['assets']),
      remove: [],
      generate: list(body['generate'])
    }
  };
}

/**
 * A patch that makes `site`'s content the site's content — the shape a *file import*
 * has, as opposed to an assistant's amendment. Explicit rather than implied, so the
 * one code path that applies changes only ever handles patches.
 */
export function replacePatchOf(site: Site): SitePatch {
  return {
    mode: 'replace',
    site: {
      name: site.name,
      description: site.description,
      category: site.category ?? '',
      center: site.center,
      zoom: site.zoom
    },
    areas: { upsert: [...site.areas], remove: [] },
    assets: { upsert: [...site.assets], remove: [], generate: [] }
  };
}

/** The site-level fields a patch may carry, or `null` when it carries none. */
function metaOf(raw: unknown): Record<string, unknown> | null {
  const source = record(raw);
  if (!source) return null;
  const keys = ['name', 'description', 'category', 'center', 'zoom'];
  const meta: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) meta[key] = source[key];
  }
  return Object.keys(meta).length > 0 ? meta : null;
}

// --- applying ----------------------------------------------------------------

/**
 * Merge `patch` into `site` and sanitise the result.
 *
 * `site` may be a blank site (nothing open yet), in which case a patch behaves
 * like a creation. The returned site carries no identity (`id`, `dp`, `updatedAt`
 * are the sanitiser's empty values): the page owns those.
 */
export function applySitePatch(
  site: Site | null,
  patch: SitePatch,
  palette: readonly string[]
): NormalizedSite {
  const base = site ?? blankSite();
  const areas =
    patch.mode === 'replace'
      ? patch.areas.upsert
      : mergeById(base.areas, patch.areas);
  const generated = expandGenerate(patch.assets.generate, base);
  const assetOps = {
    upsert: [...patch.assets.upsert, ...generated.assets],
    remove: patch.assets.remove
  };
  const assets =
    patch.mode === 'replace'
      ? assetOps.upsert
      : mergeById(base.assets, assetOps);

  const result = normalizeSite(
    {
      ...base,
      ...patch.site,
      // The basemap is never the model's business: carry the site's own through
      // so a proposal cannot reset a project's private tile server to public OSM.
      basemap: base.basemap,
      areas,
      assets
    },
    palette
  );
  // A generate op cut down to its own ceiling is a truncation the user must be told about,
  // exactly as an over-long asset list is.
  return generated.clamped
    ? { ...result, report: { ...result.report, truncated: true } }
    : result;
}

/**
 * Apply `remove` then `upsert` to a list of existing objects, on raw values.
 *
 * Existing objects keep their position, which is what keeps their ids stable
 * through the sanitiser: `uniqueId` hands each slug to the first claimant, and an
 * unchanged id slugifies to itself. New objects are appended, so a new id that
 * collides with an existing one is the one that gets suffixed.
 */
function mergeById(
  existing: readonly (Area | Asset)[],
  ops: { upsert: unknown[]; remove: string[] }
): unknown[] {
  const removed = new Set(ops.remove);
  const merged: Record<string, unknown>[] = existing
    .filter((item) => !removed.has(item.id))
    .map((item) => ({ ...item }));
  const indexById = new Map(
    merged.map((item, index) => [String(item['id'] ?? ''), index])
  );

  for (const raw of ops.upsert) {
    const patchItem = record(raw);
    if (!patchItem) continue;
    const id =
      typeof patchItem['id'] === 'string' ? patchItem['id'].trim() : '';
    const at = id ? indexById.get(id) : undefined;
    if (at === undefined) {
      merged.push(patchItem);
      if (id) indexById.set(id, merged.length - 1);
      continue;
    }
    // Field-by-field: only the keys the patch carries are overwritten, so the
    // fields the model never received (dp, readings, notes, ring) survive.
    merged[at] = { ...merged[at], ...patchItem };
  }
  return merged;
}

// --- generate ----------------------------------------------------------------

/**
 * Expand the parametric ops into raw assets.
 *
 * This is the answer to bulk creation: `{ pattern: "line", count: 120, … }` is a
 * handful of tokens that becomes 120 assets here, deterministically, instead of
 * 120 objects the model has to write out (and truncate).
 *
 * It reports its own clamping, because nothing else can any more: an op asking for more
 * than {@link GENERATE_MAX} used to overflow the site ceiling, and the sanitiser reported
 * the truncation on its behalf. That ceiling is now 10 000, which one op cannot reach — so
 * without this flag a request for 5000 would quietly yield 2000 and say nothing.
 */
export function expandGenerate(ops: unknown[], site: Site): Generated {
  const assets: Record<string, unknown>[] = [];
  let clamped = false;
  for (const raw of ops) {
    const op = record(raw);
    if (!op) continue;
    if (num(op['count'], 0) > GENERATE_MAX) clamped = true;
    assets.push(...expandOne(op, site));
  }
  return { assets, clamped };
}

function expandOne(
  op: Record<string, unknown>,
  site: Site
): Record<string, unknown>[] {
  const count = Math.round(clamp(num(op['count'], 0), 0, GENERATE_MAX));
  if (count === 0) return [];
  const points = pointsOf(op, count, site);
  const template =
    typeof op['nameTemplate'] === 'string' ? op['nameTemplate'] : '';
  const shared = {
    kind: op['kind'],
    areaId: op['areaId'],
    readings: op['readings'],
    notes: op['notes'],
    link: op['link']
  };
  return points.map((point, index) => ({
    ...shared,
    name: nameAt(template, index + 1, String(op['kind'] ?? 'asset')),
    lat: point.lat,
    lon: point.lon
  }));
}

/** `V-%03d` / `Lampe %d` / `PL-#` → `V-007`, `Lampe 7`, `PL-7`. */
function nameAt(template: string, index: number, kind: string): string {
  if (!template) return `${kind} ${index}`;
  if (template.includes('#')) return template.replaceAll('#', String(index));
  return template.replaceAll(
    /%(0(\d+))?d/g,
    (_all, _pad: string, width: string) =>
      width ? String(index).padStart(Number(width), '0') : String(index)
  );
}

interface GenPoint {
  lat: number;
  lon: number;
}

/** The geometry of one op — an unusable one yields no points rather than NaNs. */
function pointsOf(
  op: Record<string, unknown>,
  count: number,
  site: Site
): GenPoint[] {
  const pattern = String(op['pattern'] ?? 'line').toLowerCase();
  const from = pointOf(op['from']);
  switch (pattern) {
    case 'grid': {
      return gridPoints(from, pointOf(op['to']), count, num(op['cols'], 0));
    }
    case 'ring': {
      return ringPoints(
        from ?? centerOf(op, site),
        num(op['radiusM'], 0),
        count
      );
    }
    default: {
      return linePoints(from, pointOf(op['to']), count);
    }
  }
}

function pointOf(raw: unknown): GenPoint | null {
  const source = record(raw);
  if (!source) return null;
  const lat = num(source['lat'], Number.NaN);
  const lon = num(source['lon'], Number.NaN);
  return isValidLatLon(lat, lon) ? { lat, lon } : null;
}

/** `ring` without an explicit centre falls back to the area's, then the site's. */
function centerOf(op: Record<string, unknown>, site: Site): GenPoint {
  const areaId = typeof op['areaId'] === 'string' ? op['areaId'] : '';
  const area = site.areas.find((candidate) => candidate.id === areaId);
  if (area && area.ring.length >= MIN_RING) {
    const lat = area.ring.reduce((sum, [, y]) => sum + y, 0) / area.ring.length;
    const lon = area.ring.reduce((sum, [x]) => sum + x, 0) / area.ring.length;
    return { lat, lon };
  }
  return site.center;
}

function linePoints(
  from: GenPoint | null,
  to: GenPoint | null,
  count: number
): GenPoint[] {
  if (!from || !to) return [];
  if (count === 1) return [from];
  const steps = count - 1;
  return Array.from({ length: count }, (_unused, index) => ({
    lat: from.lat + ((to.lat - from.lat) * index) / steps,
    lon: from.lon + ((to.lon - from.lon) * index) / steps
  }));
}

function gridPoints(
  from: GenPoint | null,
  to: GenPoint | null,
  count: number,
  cols: number
): GenPoint[] {
  if (!from || !to) return [];
  const columns = Math.max(1, Math.round(cols) || Math.ceil(Math.sqrt(count)));
  const rows = Math.ceil(count / columns);
  const points: GenPoint[] = [];
  for (let index = 0; index < count; index++) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    points.push({
      lat: from.lat + ((to.lat - from.lat) * row) / Math.max(1, rows - 1),
      lon: from.lon + ((to.lon - from.lon) * col) / Math.max(1, columns - 1)
    });
  }
  return points;
}

function ringPoints(
  center: GenPoint,
  radiusM: number,
  count: number
): GenPoint[] {
  if (radiusM <= 0) return [];
  const dLat = radiusM / METERS_PER_DEGREE;
  const dLon = dLat / Math.max(0.01, Math.cos(center.lat * DEG_TO_RAD));
  return Array.from({ length: count }, (_unused, index) => {
    const angle = ((FULL_TURN * index) / count) * DEG_TO_RAD;
    return {
      lat: center.lat + dLat * Math.cos(angle),
      lon: center.lon + dLon * Math.sin(angle)
    };
  });
}

// --- diffing -----------------------------------------------------------------

/** One changed object, named so the UI can show it without a second lookup. */
export interface DiffEntry {
  id: string;
  name: string;
}

export interface DiffPart {
  added: DiffEntry[];
  updated: DiffEntry[];
  removed: DiffEntry[];
}

export interface SiteDiff {
  areas: DiffPart;
  assets: DiffPart;
  /** The map framing (centre / zoom) changed. */
  view: boolean;
  /** Name, description or category changed. */
  meta: boolean;
}

/** How many objects one part of the diff touches. */
function partSize(part: DiffPart): number {
  return part.added.length + part.updated.length + part.removed.length;
}

export function isEmptyDiff(diff: SiteDiff): boolean {
  return diffCount(diff) === 0 && !diff.view && !diff.meta;
}

/** Total number of touched objects — the headline figure for the apply button. */
export function diffCount(diff: SiteDiff): number {
  return partSize(diff.areas) + partSize(diff.assets);
}

/**
 * What applying would actually do. Computed on the sanitised result rather than
 * on the patch, so what the user is shown is what will be written — including the
 * removals a `replace` proposal implies.
 */
export function diffSites(before: Site | null, after: Site): SiteDiff {
  const base = before ?? blankSite();
  return {
    areas: diffPart(base.areas, after.areas, sameArea),
    assets: diffPart(base.assets, after.assets, sameAsset),
    view:
      base.center.lat !== after.center.lat ||
      base.center.lon !== after.center.lon ||
      base.zoom !== after.zoom,
    meta:
      base.name !== after.name ||
      base.description !== after.description ||
      (base.category ?? '') !== (after.category ?? '')
  };
}

function diffPart<T extends { id: string; name: string }>(
  before: readonly T[],
  after: readonly T[],
  same: (a: T, b: T) => boolean
): DiffPart {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const part: DiffPart = { added: [], updated: [], removed: [] };
  for (const item of after) {
    const previous = beforeById.get(item.id);
    if (!previous) part.added.push(entry(item));
    else if (!same(previous, item)) part.updated.push(entry(item));
  }
  for (const item of before) {
    if (!afterById.has(item.id)) part.removed.push(entry(item));
  }
  return part;
}

function entry(item: { id: string; name: string }): DiffEntry {
  return { id: item.id, name: item.name };
}

function sameArea(a: Area, b: Area): boolean {
  return (
    a.name === b.name &&
    a.color === b.color &&
    a.link === b.link &&
    a.groupZoom === b.groupZoom &&
    sameRing(a.ring, b.ring)
  );
}

function sameRing(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[]
): boolean {
  return (
    a.length === b.length &&
    a.every((point, index) => {
      const other = b[index] as readonly [number, number];
      return point[0] === other[0] && point[1] === other[1];
    })
  );
}

/**
 * Area membership, compared in ORDER: the first entry is the primary area, so two assets
 * listing the same areas in a different order are not the same asset — one of them would
 * group under a different badge.
 */
function sameAreaIds(a: Asset, b: Asset): boolean {
  return (
    a.areaIds.length === b.areaIds.length &&
    a.areaIds.every((id, index) => id === b.areaIds[index])
  );
}

function sameAsset(a: Asset, b: Asset): boolean {
  return (
    a.name === b.name &&
    a.kind === b.kind &&
    a.lat === b.lat &&
    a.lon === b.lon &&
    sameAreaIds(a, b) &&
    a.dp === b.dp &&
    a.link === b.link &&
    a.notes === b.notes &&
    sameReadings(a, b)
  );
}

function sameReadings(a: Asset, b: Asset): boolean {
  if (a.readings.length !== b.readings.length) return false;
  return a.readings.every((reading, index) => {
    const other = b.readings[index];
    return (
      other !== undefined &&
      reading.label === other.label &&
      reading.unit === other.unit &&
      reading.dp === other.dp &&
      reading.decimals === other.decimals &&
      reading.onMap === other.onMap
    );
  });
}
