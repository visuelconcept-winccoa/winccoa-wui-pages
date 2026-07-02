// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Value formatting shared by the Poseidon views. */
import type { SensorField } from './model.js';
import type { SensorValues } from './types.js';

/** Format a number to `decimals` places, or "—" when not finite. */
export function fmt(value: number | undefined, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

/** Format a sensor value with its unit (e.g. "296 m³/h"). */
export function fmtField(field: SensorField, values: SensorValues): string {
  const v = fmt(values[field.path], field.decimals);
  return field.unit ? `${v} ${field.unit}` : v;
}

/** Removal efficiency (%) between an inlet and outlet concentration. */
export function removal(inVal: number | undefined, outVal: number | undefined): number {
  if (inVal == null || outVal == null || inVal <= 0) return 0;
  return Math.min(100, Math.max(0, ((inVal - outVal) / inVal) * 100));
}
