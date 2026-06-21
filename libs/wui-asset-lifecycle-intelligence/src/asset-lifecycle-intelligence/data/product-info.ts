/**
 * Product Information client — cross-references an asset's MLFB with the Siemens
 * Product Information Hub (obsolescence + delivery).
 *
 * The browser calls `POST /api/product-info/lookup` on the dashboard webserver,
 * which bridges over MSA vRPC to the `productInfo` manager (holding the API key)
 * → Siemens. The key never reaches the browser.
 */
import type { LifecyclePhase, SupplyStatus } from '../types.js';

const LOOKUP_URL = '/api/product-info/lookup';

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
