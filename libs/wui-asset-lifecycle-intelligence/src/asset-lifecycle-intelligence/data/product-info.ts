// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product Information client — cross-references an asset's MLFB with the Siemens
 * Product Information Hub (obsolescence + delivery).
 *
 * The browser calls `POST /api/product-info/lookup` on the dashboard webserver,
 * which bridges over MSA vRPC to the `productInfo` manager (holding the API key)
 * → Siemens. The key never reaches the browser.
 */
import { getLanguage } from '@wincc-oa/wui-i18n-shared/localize-base.js';
import type { Asset, LifecyclePhase, SupplyStatus } from '../types.js';

const LOOKUP_URL = '/api/product-info/lookup';

/** Languages the Siemens Industry Online Support site serves; others fall back to English. */
const SUPPORT_LANGS = new Set(['en', 'de', 'fr', 'es', 'it', 'zh', 'pt']);

/**
 * Canonical Siemens Industry Online Support product page for an MLFB
 * (same URL shape the PIH obsolescence `supportUrl` returns), localised to the
 * active UI language. Returns '' when no MLFB is available.
 */
export function deriveSupportUrl(mlfb: string): string {
  const ref = mlfb.trim();
  if (!ref) return '';
  const lang = getLanguage();
  const seg = SUPPORT_LANGS.has(lang) ? lang : 'en';
  return `https://support.industry.siemens.com/cs/ww/${seg}/pv/${encodeURIComponent(ref)}/pi`;
}

/** A referenced product (successor / substitute / related). */
export interface ProductRef {
  productNumber: string;
  name: string;
  link: string;
}

export interface ProductObsolescence {
  productNumber: string;
  name: string;
  info: string;
  purchasabilityNote: string;
  manufacturer: string;
  salesRelease: string | null;
  deliveryRelease: string | null;
  phaseOutAnnouncement: string | null;
  productCancellation: string | null;
  productDiscontinuation: string | null;
  supportUrl: string;
  purchasabilityStatus:
    | 'PURCHASABLE'
    | 'SUBSTITUTE_PURCHASABLE'
    | 'SUCCESSOR_PURCHASABLE'
    | 'NOT_PURCHASABLE';
  obsolescenceLevel: number;
  successor: ProductRef | null;
  substitute: ProductRef | null;
  relatedProducts: ProductRef[];
}

export interface ProductDelivery {
  productNumber: string;
  minimumOrderQuantity: number;
  countryOfOrigin: string;
  commodityCode: number;
  eccn: string;
  groupCode: string;
  productGroup: number;
  deliveryTimes: { newPart: number | null; sparePart: number | null; repairPart: number | null };
  prices: { newPart: string | null; sparePart: string | null; repairPart: string | null };
}

export interface ProductInfoResult {
  obsolescence: ProductObsolescence | null;
  delivery: ProductDelivery | null;
  errors: { obsolescence?: string; delivery?: string };
}

/** Cross-reference one MLFB. Throws on transport / service errors. */
export async function lookupProductInfo(mlfb: string, withDelivery = true): Promise<ProductInfoResult> {
  const res = await fetch(LOOKUP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productNumber: mlfb, withDelivery })
  });
  let data: { ok?: boolean; error?: string } & Partial<ProductInfoResult>;
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new Error(`Réponse invalide (HTTP ${res.status})`);
  }
  if (!res.ok || data.ok === false) {
    throw new Error(data?.error || `Erreur du service (HTTP ${res.status})`);
  }
  return {
    obsolescence: data.obsolescence ?? null,
    delivery: data.delivery ?? null,
    errors: data.errors ?? {}
  };
}

/** Delivery lead-time thresholds (days) for the supply-chain status buckets. */
const LEAD_IN_STOCK_MAX_DAYS = 14;
const LEAD_MEDIUM_MAX_DAYS = 84;

/** True when an ISO date string exists and is in the past. */
function isPast(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}

/**
 * Map the Siemens obsolescence record to the lifecycle phase, by the most
 * advanced milestone whose announced date has passed (Siemens product
 * life-cycle: PM300 active → PM400 phase-out → PM410 cancellation → PM490
 * discontinuation). End of life (PM500) is set manually.
 */
export function phaseFromObsolescence(obs: ProductObsolescence): LifecyclePhase {
  if (isPast(obs.productDiscontinuation)) return 'PM490';
  if (isPast(obs.productCancellation)) return 'PM410';
  if (isPast(obs.phaseOutAnnouncement)) return 'PM400';
  // No milestone reached yet → fall back to the purchasability status.
  if (obs.purchasabilityStatus === 'NOT_PURCHASABLE') return 'PM490';
  if (obs.purchasabilityStatus !== 'PURCHASABLE') return 'PM410';
  return 'PM300';
}

/** Map the delivery lead time (new part, days) to the supply-chain status. */
export function supplyFromDelivery(del: ProductDelivery): SupplyStatus {
  const days = del.deliveryTimes?.newPart;
  if (days == null) return 'over12OrOos';
  if (days <= LEAD_IN_STOCK_MAX_DAYS) return 'inStock';
  if (days <= LEAD_MEDIUM_MAX_DAYS) return 'lead4to12';
  return 'over12OrOos';
}

/**
 * Derive the asset fields to update from a Product Information lookup result —
 * the single source of truth shared by the per-asset dialog ("Appliquer aux
 * champs") and the bulk refresh. Updates `phase`/`successor`/`supportUrl` from
 * obsolescence and `supply` from delivery; leaves manual fields untouched.
 */
export function assetPatchFromProductInfo(r: ProductInfoResult): Partial<Asset> {
  const part: Partial<Asset> = {};
  if (r.obsolescence) {
    part.phase = phaseFromObsolescence(r.obsolescence);
    const succ = r.obsolescence.successor?.productNumber || r.obsolescence.substitute?.productNumber;
    if (succ) part.successor = succ;
    if (r.obsolescence.supportUrl) part.supportUrl = r.obsolescence.supportUrl;
  }
  if (r.delivery) part.supply = supplyFromDelivery(r.delivery);
  return part;
}

/** Unique, trimmed, non-empty MLFBs across the given assets (one lookup each). */
export function uniqueMlfbs(assets: readonly Pick<Asset, 'mlfb'>[]): string[] {
  return [...new Set(assets.map((a) => a.mlfb.trim()).filter((m) => m !== ''))];
}

/** Progress of a bulk lookup run. */
export interface BulkLookupProgress {
  done: number;
  total: number;
}

/** Default number of concurrent Siemens lookups (kept low for the gateway rate limit). */
const BULK_CONCURRENCY = 3;

/**
 * Look up many MLFBs with bounded concurrency. A per-MLFB transport failure is
 * captured as an errored result (it never aborts the whole batch). Returns a map
 * keyed by the trimmed MLFB.
 */
export async function bulkLookupProductInfo(
  mlfbs: string[],
  opts: { concurrency?: number; onProgress?: (p: BulkLookupProgress) => void } = {}
): Promise<Map<string, ProductInfoResult>> {
  const total = mlfbs.length;
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? BULK_CONCURRENCY, total));
  const out = new Map<string, ProductInfoResult>();
  let cursor = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (cursor < total) {
      const mlfb = mlfbs[cursor++];
      try {
        out.set(mlfb, await lookupProductInfo(mlfb, true));
      } catch (error) {
        out.set(mlfb, {
          obsolescence: null,
          delivery: null,
          errors: { obsolescence: error instanceof Error ? error.message : String(error) }
        });
      } finally {
        done += 1;
        opts.onProgress?.({ done, total });
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return out;
}
