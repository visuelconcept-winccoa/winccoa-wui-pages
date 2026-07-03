// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * IEC 60617-inspired symbol catalog for single-line (mono-filaire) diagrams.
 *
 * Every symbol is drawn **inline as SVG** in its own local box (`w × h` canvas
 * units) using `currentColor` for all strokes/fills, so the canvas can theme it
 * (via CSS `color`) and tint it green when the segment is energised — no external
 * asset, no network fetch, fully self-contained (see the module docs).
 *
 * Each definition exposes named connection {@link SymbolPort}s in local box
 * coordinates; the canvas rotates/translates them into world space to route the
 * wires (see {@link ../types.ts} `portWorld`). `role` drives energisation
 * ({@link ../topology.ts}): a `switch` only conducts when closed, everything else
 * conducts through all its ports; `source` seeds the energisation.
 *
 * This file is intentionally free of any dependency on the domain model so the
 * geometry helpers in `types.ts` can import it without a cycle.
 */
import { svg, type SVGTemplateResult } from 'lit';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { ml } from '../i18n.js';

/** Stable identifier of a catalog symbol. */
export type SymbolId =
  | 'breaker'
  | 'disconnector'
  | 'switch-disconnector'
  | 'contactor'
  | 'fuse'
  | 'busbar'
  | 'junction'
  | 'feeder-in'
  | 'feeder-out'
  | 'switchboard'
  | 'transformer'
  | 'grid-source'
  | 'generator'
  | 'ammeter'
  | 'voltmeter'
  | 'meter'
  | 'load'
  | 'motor'
  | 'ground'
  | 'surge-arrester';

/** Toolbox group (the four families offered in edit mode). */
export type Category = 'switchgear' | 'busbar' | 'sources' | 'measure';

/** Electrical behaviour of a symbol for the energisation graph. */
export type Role = 'switch' | 'passive' | 'busbar' | 'source' | 'meter' | 'load';

/** A named connection point in the symbol's local box coordinates. */
export interface SymbolPort {
  x: number;
  y: number;
}

/** Which side of the symbol box the wire leaves from (single-port symbols). */
export type ExitSide = 'top' | 'bottom';

/** Drawing context passed to a symbol's `render`. */
export interface GlyphCtx {
  /** Whether the device is currently closed (only used by `switch` symbols). */
  closed: boolean;
  /**
   * Resolved wire-exit side for single-port symbols (the node's choice, or the
   * symbol's native side). Multi-port symbols ignore it.
   */
  exit?: ExitSide;
  /** Resolved box size — only symbols without ports (switchboard frame) are resizable. */
  w?: number;
  h?: number;
}

/** One symbol definition. */
export interface SymbolDef {
  id: SymbolId;
  category: Category;
  label: MultiLangString;
  /** Local box size, in canvas units. */
  w: number;
  h: number;
  /** Named ports in local box coordinates. */
  ports: Record<string, SymbolPort>;
  /** Energisation role. */
  role: Role;
  /** Draw the symbol body inside `[0..w] × [0..h]`. */
  render: (ctx: GlyphCtx) => SVGTemplateResult;
}

const SW = 4; // nominal stroke width in canvas units

/** Standard two-terminal vertical ports (top `a`, bottom `b`). */
function vertical2(w: number, h: number): Record<string, SymbolPort> {
  return { a: { x: w / 2, y: 0 }, b: { x: w / 2, y: h } };
}

/**
 * A vertical switching device: two leads + a blade that pivots at the lower
 * contact (vertical when closed, tilted ~30° when open), plus a symbol-specific
 * `marker` drawn near the contacts to distinguish breaker/disconnector/…
 */
function switchGlyph(closed: boolean, marker: SVGTemplateResult | null): SVGTemplateResult {
  // Contacts at y=15 (top) and y=65 (bottom); blade length 50.
  const openEnd = { x: 20 + 25, y: 65 - 43.3 }; // 30° from vertical
  const tip = closed ? { x: 20, y: 15 } : openEnd;
  return svg`
    <line x1="20" y1="0" x2="20" y2="15" stroke="currentColor" stroke-width=${SW} />
    <line x1="20" y1="65" x2="20" y2="80" stroke="currentColor" stroke-width=${SW} />
    <circle cx="20" cy="15" r="3.5" fill="currentColor" />
    <circle cx="20" cy="65" r="3.5" fill="currentColor" />
    <line x1="20" y1="65" x2=${tip.x} y2=${tip.y} stroke="currentColor" stroke-width=${SW} stroke-linecap="round" />
    ${marker}
  `;
}

/**
 * A circle-bodied device (G/M/A/V…): the circle, its letter, and the lead
 * line(s) between the box edge and the circle on the requested side(s) — so a
 * single-port device can exit top OR bottom while its letter stays upright.
 */
function circleDevice(w: number, h: number, glyph: SVGTemplateResult, leads: ExitSide | 'both'): SVGTemplateResult {
  const cx = w / 2;
  const r = Math.min(w, h) / 2 - SW;
  return svg`
    ${leads === 'bottom' ? nothingSvg() : svg`<line x1=${cx} y1="0" x2=${cx} y2=${h / 2 - r} stroke="currentColor" stroke-width=${SW} />`}
    ${leads === 'top' ? nothingSvg() : svg`<line x1=${cx} y1=${h / 2 + r} x2=${cx} y2=${h} stroke="currentColor" stroke-width=${SW} />`}
    <circle cx=${cx} cy=${h / 2} r=${r} fill="none" stroke="currentColor" stroke-width=${SW} />
    ${glyph}
  `;
}

function nothingSvg(): SVGTemplateResult {
  return svg``;
}

/**
 * Mirror a (text-free) glyph vertically inside its box — used by single-port
 * symbols whose drawing is directional (feeder arrows, load triangle, earth)
 * when the wire exits on the opposite side of the native one.
 */
function mirrorY(h: number, inner: SVGTemplateResult, flip: boolean): SVGTemplateResult {
  return flip ? svg`<g transform="translate(0 ${h}) scale(1 -1)">${inner}</g>` : inner;
}

/** A device letter (G/M/A/V…) optically centered on (cx, cy) — pairs with {@link circleDevice}. */
function centeredLetter(cx: number, cy: number, size: number, letter: string): SVGTemplateResult {
  return svg`<text x=${cx} y=${cy} text-anchor="middle" dominant-baseline="central"
    font-size=${size} fill="currentColor" font-family="sans-serif">${letter}</text>`;
}

/** The full symbol catalog, keyed by id. */
export const SYMBOLS: Record<SymbolId, SymbolDef> = {
  breaker: {
    id: 'breaker',
    category: 'switchgear',
    label: ml('Circuit breaker', 'Disjoncteur', 'Leistungsschalter'),
    w: 40,
    h: 80,
    ports: vertical2(40, 80),
    role: 'switch',
    render: ({ closed }) =>
      switchGlyph(closed, svg`<rect x="14" y="9" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" />`)
  },
  disconnector: {
    id: 'disconnector',
    category: 'switchgear',
    label: ml('Disconnector', 'Sectionneur', 'Trennschalter'),
    w: 40,
    h: 80,
    ports: vertical2(40, 80),
    role: 'switch',
    render: ({ closed }) => switchGlyph(closed, null)
  },
  'switch-disconnector': {
    id: 'switch-disconnector',
    category: 'switchgear',
    label: ml('Switch-disconnector', 'Interrupteur-sectionneur', 'Lasttrennschalter'),
    w: 40,
    h: 80,
    ports: vertical2(40, 80),
    role: 'switch',
    render: ({ closed }) =>
      switchGlyph(closed, svg`<circle cx="20" cy="15" r="7" fill="none" stroke="currentColor" stroke-width="3" />`)
  },
  contactor: {
    id: 'contactor',
    category: 'switchgear',
    label: ml('Contactor', 'Contacteur', 'Schütz'),
    w: 40,
    h: 80,
    ports: vertical2(40, 80),
    role: 'switch',
    render: ({ closed }) =>
      switchGlyph(closed, svg`<path d="M 12 15 A 8 8 0 0 0 28 15" fill="none" stroke="currentColor" stroke-width="3" />`)
  },
  fuse: {
    id: 'fuse',
    category: 'switchgear',
    label: ml('Fuse', 'Fusible', 'Sicherung'),
    w: 40,
    h: 80,
    ports: vertical2(40, 80),
    role: 'passive',
    render: () => svg`
      <line x1="20" y1="0" x2="20" y2="80" stroke="currentColor" stroke-width=${SW} />
      <rect x="12" y="20" width="16" height="40" fill="none" stroke="currentColor" stroke-width=${SW} />
    `
  },
  busbar: {
    id: 'busbar',
    category: 'busbar',
    label: ml('Busbar', 'Jeu de barres', 'Sammelschiene'),
    w: 240,
    h: 16,
    ports: {
      p1: { x: 20, y: 8 },
      p2: { x: 60, y: 8 },
      p3: { x: 100, y: 8 },
      p4: { x: 140, y: 8 },
      p5: { x: 180, y: 8 },
      p6: { x: 220, y: 8 }
    },
    role: 'busbar',
    render: () => svg`<line x1="0" y1="8" x2="240" y2="8" stroke="currentColor" stroke-width="8" stroke-linecap="round" />`
  },
  junction: {
    id: 'junction',
    category: 'busbar',
    label: ml('Junction', 'Nœud / jonction', 'Knoten'),
    w: 20,
    h: 20,
    ports: { a: { x: 10, y: 0 }, b: { x: 10, y: 20 }, c: { x: 0, y: 10 }, d: { x: 20, y: 10 } },
    role: 'passive',
    render: () => svg`<circle cx="10" cy="10" r="5" fill="currentColor" />`
  },
  'feeder-in': {
    id: 'feeder-in',
    category: 'busbar',
    label: ml('Incoming feeder', 'Arrivée', 'Einspeisung'),
    w: 40,
    h: 60,
    ports: { b: { x: 20, y: 60 } },
    role: 'source',
    render: ({ exit = 'bottom' }) =>
      mirrorY(
        60,
        svg`
          <line x1="20" y1="14" x2="20" y2="60" stroke="currentColor" stroke-width=${SW} />
          <path d="M 20 0 L 12 16 L 28 16 Z" fill="currentColor" />
        `,
        exit === 'top'
      )
  },
  'feeder-out': {
    id: 'feeder-out',
    category: 'busbar',
    label: ml('Outgoing feeder', 'Départ', 'Abgang'),
    w: 40,
    h: 60,
    ports: { a: { x: 20, y: 0 } },
    role: 'load',
    render: ({ exit = 'top' }) =>
      mirrorY(
        60,
        svg`
          <line x1="20" y1="0" x2="20" y2="46" stroke="currentColor" stroke-width=${SW} />
          <path d="M 20 60 L 12 44 L 28 44 Z" fill="currentColor" />
        `,
        exit === 'bottom'
      )
  },
  switchboard: {
    id: 'switchboard',
    category: 'sources',
    label: ml('Switchboard (TGBT)', 'Tableau (TGBT)', 'Schaltschrank (TGBT)'),
    w: 220,
    h: 150,
    ports: {},
    role: 'passive',
    render: ({ w = 220, h = 150 }) => svg`
      <rect x="2" y="2" width=${w - 4} height=${h - 4} rx="6" fill="none"
        stroke="currentColor" stroke-width="3" stroke-dasharray="10 6" opacity="0.7" />
    `
  },
  transformer: {
    id: 'transformer',
    category: 'sources',
    label: ml('Transformer', 'Transformateur', 'Transformator'),
    w: 60,
    h: 130,
    ports: { a: { x: 30, y: 0 }, b: { x: 30, y: 130 } },
    role: 'passive',
    render: () => svg`
      <line x1="30" y1="0" x2="30" y2="22" stroke="currentColor" stroke-width=${SW} />
      <line x1="30" y1="108" x2="30" y2="130" stroke="currentColor" stroke-width=${SW} />
      <circle cx="30" cy="48" r="26" fill="none" stroke="currentColor" stroke-width=${SW} />
      <circle cx="30" cy="82" r="26" fill="none" stroke="currentColor" stroke-width=${SW} />
    `
  },
  'grid-source': {
    id: 'grid-source',
    category: 'sources',
    label: ml('Grid supply', 'Arrivée réseau', 'Netzeinspeisung'),
    w: 60,
    h: 90,
    ports: { b: { x: 30, y: 90 } },
    role: 'source',
    render: ({ exit = 'bottom' }) =>
      svg`
        ${exit === 'bottom'
          ? svg`<line x1="30" y1="56" x2="30" y2="90" stroke="currentColor" stroke-width=${SW} />`
          : svg`<line x1="30" y1="0" x2="30" y2="4" stroke="currentColor" stroke-width=${SW} />`}
        <circle cx="30" cy="30" r="26" fill="none" stroke="currentColor" stroke-width=${SW} />
        <path d="M 16 30 Q 23 18 30 30 T 44 30" fill="none" stroke="currentColor" stroke-width="3" />
      `
  },
  generator: {
    id: 'generator',
    category: 'sources',
    label: ml('Generator', 'Groupe électrogène', 'Generator'),
    w: 60,
    h: 90,
    ports: { b: { x: 30, y: 90 } },
    role: 'source',
    render: ({ exit = 'bottom' }) => circleDevice(60, 90, centeredLetter(30, 45, 26, 'G'), exit)
  },
  ammeter: {
    id: 'ammeter',
    category: 'measure',
    label: ml('Ammeter', 'Ampèremètre', 'Amperemeter'),
    w: 40,
    h: 80,
    ports: vertical2(40, 80),
    role: 'meter',
    render: () => circleDevice(40, 80, centeredLetter(20, 40, 20, 'A'), 'both')
  },
  voltmeter: {
    id: 'voltmeter',
    category: 'measure',
    label: ml('Voltmeter', 'Voltmètre', 'Voltmeter'),
    w: 40,
    h: 80,
    ports: { a: { x: 20, y: 0 } },
    role: 'meter',
    render: ({ exit = 'top' }) => circleDevice(40, 80, centeredLetter(20, 40, 20, 'V'), exit)
  },
  meter: {
    id: 'meter',
    category: 'measure',
    label: ml('Energy meter', 'Compteur', 'Zähler'),
    w: 44,
    h: 80,
    ports: vertical2(44, 80),
    role: 'meter',
    render: () => svg`
      <line x1="22" y1="0" x2="22" y2="24" stroke="currentColor" stroke-width=${SW} />
      <line x1="22" y1="56" x2="22" y2="80" stroke="currentColor" stroke-width=${SW} />
      <rect x="6" y="24" width="32" height="32" fill="none" stroke="currentColor" stroke-width=${SW} />
      <text x="22" y="46" text-anchor="middle" font-size="12" fill="currentColor" font-family="sans-serif">kWh</text>
    `
  },
  load: {
    id: 'load',
    category: 'measure',
    label: ml('Load', 'Charge', 'Last'),
    w: 40,
    h: 60,
    ports: { a: { x: 20, y: 0 } },
    role: 'load',
    render: ({ exit = 'top' }) =>
      mirrorY(
        60,
        svg`
          <line x1="20" y1="0" x2="20" y2="20" stroke="currentColor" stroke-width=${SW} />
          <path d="M 20 60 L 6 20 L 34 20 Z" fill="none" stroke="currentColor" stroke-width=${SW} stroke-linejoin="round" />
        `,
        exit === 'bottom'
      )
  },
  motor: {
    id: 'motor',
    category: 'measure',
    label: ml('Motor', 'Moteur', 'Motor'),
    w: 60,
    h: 90,
    ports: { a: { x: 30, y: 0 } },
    role: 'load',
    render: ({ exit = 'top' }) => circleDevice(60, 90, centeredLetter(30, 45, 26, 'M'), exit)
  },
  ground: {
    id: 'ground',
    category: 'measure',
    label: ml('Earth', 'Terre', 'Erde'),
    w: 40,
    h: 50,
    ports: { a: { x: 20, y: 0 } },
    role: 'passive',
    render: ({ exit = 'top' }) =>
      mirrorY(
        50,
        svg`
          <line x1="20" y1="0" x2="20" y2="26" stroke="currentColor" stroke-width=${SW} />
          <line x1="6" y1="26" x2="34" y2="26" stroke="currentColor" stroke-width=${SW} />
          <line x1="12" y1="34" x2="28" y2="34" stroke="currentColor" stroke-width=${SW} />
          <line x1="16" y1="42" x2="24" y2="42" stroke="currentColor" stroke-width=${SW} />
        `,
        exit === 'bottom'
      )
  },
  'surge-arrester': {
    id: 'surge-arrester',
    category: 'measure',
    label: ml('Surge arrester', 'Parafoudre', 'Überspannungsableiter'),
    w: 40,
    h: 80,
    ports: vertical2(40, 80),
    role: 'passive',
    render: () => svg`
      <line x1="20" y1="0" x2="20" y2="20" stroke="currentColor" stroke-width=${SW} />
      <line x1="20" y1="60" x2="20" y2="80" stroke="currentColor" stroke-width=${SW} />
      <rect x="10" y="20" width="20" height="40" fill="none" stroke="currentColor" stroke-width=${SW} />
      <path d="M 14 30 L 26 40 L 14 40 L 26 50" fill="none" stroke="currentColor" stroke-width="3" />
    `
  }
};

/** Toolbox display order per category. */
export const CATEGORY_ORDER: Category[] = ['sources', 'busbar', 'switchgear', 'measure'];

/** Symbols of one category, in declaration order. */
export function symbolsOf(category: Category): SymbolDef[] {
  return Object.values(SYMBOLS).filter((s) => s.category === category);
}

/** Whether a symbol is switchgear (has an open/closed position bindable to a DP). */
export function isSwitchgear(id: SymbolId): boolean {
  return SYMBOLS[id].role === 'switch';
}

/** Native wire-exit side of a single-port symbol (null for multi-/port-less symbols). */
export function nativeExitSide(id: SymbolId): ExitSide | null {
  const ports = Object.values(SYMBOLS[id].ports);
  if (ports.length !== 1) return null;
  return ports[0].y === 0 ? 'top' : 'bottom';
}

/** Whether a symbol box is user-resizable (port-less frames only — the switchboard). */
export function isResizable(id: SymbolId): boolean {
  return Object.keys(SYMBOLS[id].ports).length === 0;
}
