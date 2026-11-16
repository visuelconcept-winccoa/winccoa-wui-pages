// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Neon palette of City Drive: the Siemens iX theme colours, read from the theme tokens of the
 * page (`--theme-color-*`), so the city follows the active iX theme. The fallbacks are the iX
 * classic dark values.
 */

export interface NeonPalette {
  /** Night background / fog (theme colour 1). */
  night: number;
  /** Surfaces: ground, building bodies. */
  surface: number;
  road: number;
  primary: number;
  dynamic: number;
  info: number;
  success: number;
  warning: number;
  alarm: number;
  critical: number;
  neutral: number;
}

export const CLASSIC_DARK: NeonPalette = {
  night: 0x0f1619,
  surface: 0x283236,
  road: 0x1a2327,
  primary: 0x00bde3,
  dynamic: 0x00eaff,
  info: 0x357fff,
  success: 0x44cc00,
  warning: 0xffbb00,
  alarm: 0xff2453,
  critical: 0xeb7a0a,
  neutral: 0xb6b8b9
};

/** `#rrggbb`, `#rgb` or `rgb(a)(r, g, b, …)` → 0xrrggbb; null when unreadable. */
export function parseCssColor(value: string): number | null {
  const v = value.trim();
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return parseInt(m[1], 16);
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (m) return parseInt(m[1] + m[1] + m[2] + m[2] + m[3] + m[3], 16);
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(v);
  if (m) return (Number(m[1]) << 16) | (Number(m[2]) << 8) | Number(m[3]);
  return null;
}

const TOKENS: Record<Exclude<keyof NeonPalette, 'road'>, string> = {
  night: '--theme-color-1',
  surface: '--theme-color-2',
  primary: '--theme-color-primary',
  dynamic: '--theme-color-dynamic',
  info: '--theme-color-info',
  success: '--theme-color-success',
  warning: '--theme-color-warning',
  alarm: '--theme-color-alarm',
  critical: '--theme-color-critical',
  neutral: '--theme-color-neutral'
};

/** The palette from the tokens visible at `el` (falls back token by token). */
export function readPalette(el: Element): NeonPalette {
  const style = getComputedStyle(el);
  const p: NeonPalette = { ...CLASSIC_DARK };
  for (const [key, token] of Object.entries(TOKENS) as [keyof typeof TOKENS, string][]) {
    const c = parseCssColor(style.getPropertyValue(token));
    if (c !== null) p[key] = c;
  }
  // the road: the night colour, slightly lifted
  p.road = mix(p.night, p.surface, 0.35);
  return p;
}

/** Linear mix of two 0xrrggbb colours. */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number): number => (c >> s) & 0xff;
  const m = (s: number): number => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
