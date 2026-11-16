// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Visuel Concept logo — a 4 × 4 grid of squares — drawn from its colours rather than from an
 * image: sharp at any distance in the city (billboards, plaza, station) and in the HUD.
 */

/** Rows top to bottom, colours of the logo. */
export const LOGO_GRID: readonly (readonly number[])[] = [
  [0x20b9d8, 0x10567d, 0x04646f, 0x20b9d8],
  [0x10567d, 0xfdd731, 0x20b9d8, 0xfdd731],
  [0xfdd731, 0x04646f, 0x10567d, 0x04646f],
  [0x10567d, 0xfdd731, 0x04646f, 0x20b9d8]
];

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** The logo on a canvas (`gap` = background between the squares, as in the original). */
export function drawLogo(g: CanvasRenderingContext2D, x: number, y: number, size: number, gap: string | null): void {
  const cell = size / 4;
  const pad = cell * 0.09;
  if (gap) {
    g.fillStyle = gap;
    g.fillRect(x, y, size, size);
  }
  LOGO_GRID.forEach((row, r) =>
    row.forEach((c, k) => {
      g.fillStyle = css(c);
      g.fillRect(x + k * cell + pad, y + r * cell + pad, cell - 2 * pad, cell - 2 * pad);
    })
  );
}

/** A square canvas of the logo, `px` wide. */
export function logoCanvas(px = 512, gap: string | null = '#05090b'): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = px;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  drawLogo(g, 0, 0, px, gap);
  return c;
}

/** The logo as SVG markup (HUD watermark). */
export function logoSvg(size: number): string {
  const cell = 64;
  const rects = LOGO_GRID.flatMap((row, r) =>
    row.map((c, k) => `<rect x="${k * cell + 6}" y="${r * cell + 6}" width="${cell - 12}" height="${cell - 12}" fill="${css(c)}"/>`)
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="${size}" height="${size}" aria-label="Visuel Concept">${rects}</svg>`;
}
