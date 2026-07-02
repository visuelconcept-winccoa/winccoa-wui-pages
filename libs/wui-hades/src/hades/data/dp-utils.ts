// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Datapoint helpers shared by the live-binding and command layers: DPE-name
 * normalisation for map lookups (`dpConnect` echoes names with the system
 * prefix) and tolerant scalar coercion of emitted values (which may arrive
 * wrapped in arrays / `{ value }` objects depending on the transport).
 */

/** Normalise a DPE name for lookups: strip the system prefix, trim. */
export function normDp(dpe: string): string {
  const v = dpe.trim();
  return v.includes(':') ? v.slice(v.indexOf(':') + 1) : v;
}

/** Coerce a (possibly array/object-wrapped) datapoint emission to a number. */
export function toNumber(raw: unknown): number {
  const v = unwrap(raw);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const parsed = Number.parseFloat(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}

function unwrap(raw: unknown): unknown {
  if (Array.isArray(raw)) return unwrap(raw[0]);
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return unwrap((raw as { value: unknown }).value);
  }
  return raw;
}
