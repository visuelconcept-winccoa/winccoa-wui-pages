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

/**
 * The colour themes of the city (#99), a setting: **Classic** follows the iX theme; **Sunset
 * Neon** — a retro sunset coast — dresses the same city in hot pink, aqua, violet and orange
 * under a purple-to-orange sky. Colours only: the map, the buildings, the logos and the
 * meaning of the colours (a machine running is green, in fault red; a wanted player red) stay.
 */
export type ThemeId = 'classic' | 'sunset';

export const THEMES: readonly { id: ThemeId; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'sunset', label: 'Sunset Neon' }
];

/** The city's accents in the Sunset Neon theme (the states — success, alarm, neutral — are kept). */
const SUNSET: Partial<NeonPalette> = {
  night: 0x1a0b2b,
  surface: 0x2e1d45,
  primary: 0xff3d9a,
  dynamic: 0x2ee6e0,
  info: 0x9b5cff,
  warning: 0xffb347,
  critical: 0xff8a3c
};

/** The palette of the city for a theme (the players keep their own neon colours). */
export function themePalette(p: NeonPalette, theme: ThemeId): NeonPalette {
  if (theme !== 'sunset') return p;
  const t: NeonPalette = { ...p, ...SUNSET };
  t.road = mix(t.night, t.surface, 0.35);
  return t;
}

/** The sky of a theme: vertical gradient stops (top first), the fog, and the sky and sun lights. */
export interface ThemeSky {
  stops: readonly (readonly [number, string])[];
  fog: number;
  hemi: number;
  ground: number;
  sun: number;
}

/** The theme's own sky, or null for Classic (its sky is drawn by the world from the palette). */
export function themeSky(theme: ThemeId, day: boolean): ThemeSky | null {
  if (theme !== 'sunset') return null;
  return day
    ? // golden hour: violet overhead, pink, a peach horizon
      { stops: [[0, '#5b4bb7'], [0.55, '#e783b8'], [1, '#ffc28a']], fog: 0xe3a3b4, hemi: 0xffd9e6, ground: 0x6a4a6e, sun: 0xffc9a0 }
    : // dusk: deep purple overhead, magenta, an orange glow low on the horizon
      { stops: [[0, '#140726'], [0.5, '#3d1157'], [0.8, '#a3276c'], [1, '#ff7a45']], fog: 0x3b1546, hemi: 0xc59bff, ground: 0x1a0b2b, sun: 0xff9ec8 };
}

/** Linear mix of two 0xrrggbb colours. */
export function mix(a: number, b: number, t: number): number {
  const ch = (c: number, s: number): number => (c >> s) & 0xff;
  const m = (s: number): number => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * t);
  return (m(16) << 16) | (m(8) << 8) | m(0);
}
