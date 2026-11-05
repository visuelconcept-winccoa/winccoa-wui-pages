// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A symbol enlarged or reduced by a factor typed in its window (#281), uniform on the three axes,
 * on its 3D model whatever its kind (built-in, GLB, billboard). Kept in the machine of the atelier
 * (`symbolScale`), 1 when absent.
 */
import type { MachineDef } from '@visuelconcept-winccoa/wui-fleet-core/types.js';

export const SYMBOL_SCALE_MIN = 0.1;
export const SYMBOL_SCALE_MAX = 10;

/** A machine definition with its own scale factor. */
export type ScaledMachineDef = MachineDef & { symbolScale?: number };

/** The machine's scale factor, kept within the bounds; 1 when absent or invalid. */
export function symbolScale(m: Pick<ScaledMachineDef, 'symbolScale'>): number {
  const s = Number(m.symbolScale);
  if (!Number.isFinite(s) || s <= 0) return 1;
  return Math.min(SYMBOL_SCALE_MAX, Math.max(SYMBOL_SCALE_MIN, s));
}

/** The factor to store: undefined for 1 (the default), else rounded to the hundredth and bounded. */
export function storedScale(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const s = Math.round(Math.min(SYMBOL_SCALE_MAX, Math.max(SYMBOL_SCALE_MIN, value)) * 100) / 100;
  return s === 1 ? undefined : s;
}
