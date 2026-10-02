// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The plants of the GIS network simulator, as plain data: which datapoints make a plant, and
 * the order the page shows them in.
 *
 * Kept free of any WinCC OA or Lit dependency so the rule the operator sees — the highest
 * output first — is testable as it is written.
 *
 * **The source is the site, not a naming guess.** Each `GIS_Site` datapoint holds its assets
 * with their `readings`, each reading bound by name to a datapoint (`System1:GisSim_belleville_
 * puissance` for the simulator's plants). A plant is an asset with both a `puissance` and a
 * `capacite` reading — only the simulator's `production-electrique` family has that pair (a
 * substation has a transited power but no capacity, a borehole a capacity but a flow) — and
 * the page follows exactly the datapoints the site binds, whatever they are named.
 *
 * Alarms are deliberately out of this first version: the page shows the operating values
 * only (the `defaut` element, which carries the alert, is not read).
 */

/** The elements of a plant the page reads, in the order the card lists them. */
export const PLANT_ELEMENTS = [
  'puissance',
  'capacite',
  'charge',
  'tension',
  'frequence',
  'etat'
] as const;

export type PlantElement = (typeof PLANT_ELEMENTS)[number];

/** Object states (`families.js`): 0 arrêt, 1 marche, 2 défaut, 3 maintenance. */
export const STATE_OFF = 0;
export const STATE_RUN = 1;
export const STATE_FAULT = 2;
export const STATE_MAINTENANCE = 3;

/** One plant as a site declares it: where it is and which datapoint carries each value. */
export interface PlantBinding {
  /** `<siteId>/<assetId>` — two sites may hold an asset with the same id. */
  key: string;
  /** Display name of the asset (`Centrale de Belleville`). */
  name: string;
  /** Site id — the `/gis/:siteid` route param. */
  siteId: string;
  /** Site display name. */
  siteName: string;
  /** Datapoint ELEMENT of each value, trailing `.` included, ready for `dpConnect`. */
  dps: Partial<Record<PlantElement, string>>;
}

export interface Plant {
  /** Stable key of a card: the site id and the asset id. */
  stem: string;
  /** Display name of the asset. */
  name: string;
  /** Site the asset belongs to — the card opens it. */
  siteId: string;
  siteName: string;
  /** Latest value of each element that has reported (missing ⇒ nothing arrived yet). */
  values: Partial<Record<PlantElement, number>>;
}

/**
 * Coerce a live value into a number: booleans (and the `'true'`/`'false'` strings a Bool is
 * sometimes serialised as) become 1/0; anything unreadable is `undefined`.
 */
export function cellNumber(raw: unknown): number | undefined {
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== 'string') return undefined;
  const text = raw.trim().toLowerCase();
  if (text === 'true') return 1;
  if (text === 'false') return 0;
  if (text === '') return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * The output a plant is ranked on: rounded to the megawatt the card displays. Two plants
 * the operator reads as equal therefore keep their previous order instead of swapping on a
 * fraction of a megawatt every second.
 */
function rankedOutput(plant: Plant): number {
  return Math.round(plant.values.puissance ?? 0);
}

/**
 * The highest output first. Ties keep the order of the PREVIOUS ranking (`previous` = stems
 * in their last displayed order), then fall back to the name — so a stable fleet stays still
 * and only a real change moves a card.
 */
export function rankPlants(
  plants: readonly Plant[],
  previous: readonly string[] = []
): Plant[] {
  const lastRank = new Map(previous.map((stem, index) => [stem, index]));
  const unranked = previous.length;
  return [...plants].sort(
    (left, right) =>
      rankedOutput(right) - rankedOutput(left) ||
      (lastRank.get(left.stem) ?? unranked) -
        (lastRank.get(right.stem) ?? unranked) ||
      left.name.localeCompare(right.name)
  );
}

/** Fleet totals shown above the cards. */
export interface FleetSummary {
  plants: number;
  /** Plants whose state is "running". */
  running: number;
  /** Sum of the current output, MW. */
  output: number;
  /** Sum of the available capacity, MW. */
  capacity: number;
}

export function summarize(plants: readonly Plant[]): FleetSummary {
  let output = 0;
  let capacity = 0;
  let running = 0;
  for (const plant of plants) {
    output += plant.values.puissance ?? 0;
    capacity += plant.values.capacite ?? 0;
    if (plant.values.etat === STATE_RUN) running++;
  }
  return { plants: plants.length, running, output, capacity };
}

interface SiteReading {
  id?: unknown;
  dp?: unknown;
}

interface SiteAsset {
  id?: unknown;
  name?: unknown;
  dp?: unknown;
  readings?: unknown;
}

interface SiteRecord {
  id?: unknown;
  name?: unknown;
  assets?: unknown;
}

/**
 * Subscribable element name: a datapoint addressed without an element must end with a `.`
 * (the site stores `System1:GisSim_belleville_puissance`, WinCC OA wants
 * `System1:GisSim_belleville_puissance.`).
 */
export function dpeName(dp: string): string {
  const name = dp.trim();
  return name.includes('.') ? name : `${name}.`;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The state is not a reading on the map, so a site does not bind it. The simulator's naming
 * rule puts it beside the fault the asset IS bound to (`…_defaut` → `…_etat`); an asset bound
 * to anything else simply has no state pill.
 */
function stateDp(assetDp: string): string {
  const FAULT_SUFFIX = '_defaut';
  const bare = assetDp.replace(/\.$/, '');
  return bare.endsWith(FAULT_SUFFIX)
    ? `${bare.slice(0, -FAULT_SUFFIX.length)}_etat.`
    : '';
}

/** One asset → a plant binding, or `undefined` when it is not a plant. */
function bindingOf(
  asset: SiteAsset,
  site: { id: string; name: string }
): PlantBinding | undefined {
  const assetId = text(asset.id);
  if (!assetId || !Array.isArray(asset.readings)) return undefined;
  const dps: Partial<Record<PlantElement, string>> = {};
  for (const reading of asset.readings as SiteReading[]) {
    const id = text(reading?.id) as PlantElement;
    const dp = text(reading?.dp);
    if (dp && (PLANT_ELEMENTS as readonly string[]).includes(id))
      dps[id] = dpeName(dp);
  }
  if (!dps.puissance || !dps.capacite) return undefined;
  const state = stateDp(text(asset.dp));
  if (!dps.etat && state) dps.etat = state;
  return {
    key: `${site.id}/${assetId}`,
    name: text(asset.name) || assetId,
    siteId: site.id,
    siteName: site.name,
    dps
  };
}

/**
 * The plants one `GIS_Site` record declares. `fallbackId` is the site id derived from its
 * datapoint name, for a record whose JSON does not carry its own id.
 */
export function plantBindings(raw: string, fallbackId = ''): PlantBinding[] {
  let site: SiteRecord;
  try {
    site = JSON.parse(raw) as SiteRecord;
  } catch {
    return [];
  }
  if (!site || !Array.isArray(site.assets)) return [];
  const id = text(site.id) || fallbackId;
  const where = { id, name: text(site.name) || id };
  const out: PlantBinding[] = [];
  for (const asset of site.assets as SiteAsset[]) {
    const binding = asset ? bindingOf(asset, where) : undefined;
    if (binding) out.push(binding);
  }
  return out;
}
