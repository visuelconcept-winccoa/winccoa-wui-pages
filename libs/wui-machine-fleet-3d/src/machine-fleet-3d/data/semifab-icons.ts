// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SemiFab icon library — the isometric SVG icons extracted from SemiFab.pptx,
 * served statically from `data/dashboard-wc/semifab-icons/`. Used as textures
 * for `billboard` machines (see machine-factory `makeBillboard`).
 */

/** Base URL of the deployed SemiFab icons (served by the WinCC OA webserver). */
export const SEMIFAB_ICON_BASE = '/data/dashboard-wc/semifab-icons';

/** Number of icons deployed (image1.svg … image33.svg). */
export const SEMIFAB_ICON_COUNT = 33;

/** All selectable icon URLs, in order. */
export const SEMIFAB_ICONS: string[] = Array.from(
  { length: SEMIFAB_ICON_COUNT },
  (_, i) => `${SEMIFAB_ICON_BASE}/image${i + 1}.svg`
);
