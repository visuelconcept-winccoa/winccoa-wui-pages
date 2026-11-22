// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Rogue Line — the textures of the plant, drawn at start-up (no image files): grimy steel
 * panels, rusted plates, computer banks, pipes, hazard stripes, doors, floors, the sky over the
 * yard. 64 × 64 texels, read by the raycaster as packed RGBA (`Uint32Array`, little endian).
 *
 * A texel can glow (`glow` = 1): the screens, the lamps of the computer banks, the coolant and
 * the exit sign keep their colour in the dark — the renderer does not shade them.
 *
 * The colours are material colours (painted steel, rust, coolant), not UI colours: the page's
 * own colours come from the iX theme.
 */
import type { FloorTex, KeyColor, WallTex } from './maps.js';

export const TEX = 64;

export interface Texture {
  w: number;
  h: number;
  /** RGBA texels, packed little endian (0xAABBGGRR). */
  px: Uint32Array;
  /** 1 where the texel glows (not shaded). */
  glow: Uint8Array;
}

/** The WinCC OA logo: its 4 × 4 squares. */
export const LOGO_GRID: readonly (readonly string[])[] = [
  ['#20b9d8', '#10567d', '#04646f', '#20b9d8'],
  ['#10567d', '#fdd731', '#20b9d8', '#fdd731'],
  ['#fdd731', '#04646f', '#10567d', '#04646f'],
  ['#10567d', '#fdd731', '#04646f', '#20b9d8']
];

export const KEY_COLORS: Record<KeyColor, string> = { blue: '#2f7cff', yellow: '#ffc928', red: '#ff3030' };

type Draw = (g: CanvasRenderingContext2D, glow: CanvasRenderingContext2D, rnd: () => number) => void;

/** A seeded random generator (mulberry32), so the plant looks the same every time. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
}

/** Draws a texture: `g` is what is seen, `glow` marks (in any colour) what glows. */
export function makeTexture(w: number, h: number, seed: number, draw: Draw): Texture {
  const g = canvas(w, h);
  const gl = canvas(w, h);
  g.imageSmoothingEnabled = false;
  draw(g, gl, rng(seed));
  const data = g.getImageData(0, 0, w, h).data;
  const mask = gl.getImageData(0, 0, w, h).data;
  const px = new Uint32Array(w * h);
  const glow = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    px[i] = (data[i * 4 + 3] << 24) | (data[i * 4 + 2] << 16) | (data[i * 4 + 1] << 8) | data[i * 4];
    glow[i] = mask[i * 4 + 3] > 80 ? 1 : 0;
  }
  return { w, h, px, glow };
}

/** Speckles of grime over the whole surface. */
function grime(g: CanvasRenderingContext2D, rnd: () => number, w: number, h: number, amount: number, dark = '0,0,0'): void {
  for (let k = 0; k < amount; k++) {
    g.fillStyle = `rgba(${dark},${0.08 + rnd() * 0.25})`;
    g.fillRect(Math.floor(rnd() * w), Math.floor(rnd() * h), 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
  }
}

/** Dark streaks running down from the top (oil, rain from a leaking roof). */
function streaks(g: CanvasRenderingContext2D, rnd: () => number, n: number): void {
  for (let k = 0; k < n; k++) {
    const x = Math.floor(rnd() * TEX);
    const len = 8 + rnd() * 40;
    const grad = g.createLinearGradient(0, 0, 0, len);
    grad.addColorStop(0, 'rgba(20,12,6,0.55)');
    grad.addColorStop(1, 'rgba(20,12,6,0)');
    g.fillStyle = grad;
    g.fillRect(x, 0, 1 + Math.floor(rnd() * 2), len);
  }
}

function rivet(g: CanvasRenderingContext2D, x: number, y: number): void {
  g.fillStyle = '#1a1714';
  g.fillRect(x, y, 2, 2);
  g.fillStyle = '#9a958a';
  g.fillRect(x, y, 1, 1);
}

/** A bevelled metal plate. */
function plate(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string, hi: string, lo: string): void {
  g.fillStyle = base;
  g.fillRect(x, y, w, h);
  g.fillStyle = hi;
  g.fillRect(x, y, w, 1);
  g.fillRect(x, y, 1, h);
  g.fillStyle = lo;
  g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x + w - 1, y, 1, h);
}

const WALL_DRAW: Record<WallTex, Draw> = {
  steel: (g, _gl, rnd) => {
    for (const [x, y, w, h] of [
      [0, 0, 32, 40],
      [32, 0, 32, 40],
      [0, 40, 64, 24]
    ]) {
      plate(g, x, y, w, h, '#5b5c58', '#7d7d75', '#2c2b28');
      rivet(g, x + 3, y + 3);
      rivet(g, x + w - 5, y + 3);
      rivet(g, x + 3, y + h - 5);
      rivet(g, x + w - 5, y + h - 5);
    }
    g.fillStyle = '#3d3b36';
    g.fillRect(6, 46, 52, 3);
    g.fillRect(6, 53, 52, 3);
    grime(g, rnd, TEX, TEX, 380, '40,28,14');
    streaks(g, rnd, 9);
  },
  rust: (g, _gl, rnd) => {
    g.fillStyle = '#6d3d1f';
    g.fillRect(0, 0, TEX, TEX);
    for (let k = 0; k < 90; k++) {
      const r = 2 + rnd() * 7;
      g.fillStyle = ['#8a4a22', '#5a2f16', '#9b5a2a', '#4a2412', '#6f5a44'][Math.floor(rnd() * 5)];
      g.globalAlpha = 0.35 + rnd() * 0.5;
      g.beginPath();
      g.arc(rnd() * TEX, rnd() * TEX, r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    for (const y of [1, 31, 62]) {
      g.fillStyle = '#2e170a';
      g.fillRect(0, y, TEX, 1);
      for (let x = 3; x < TEX; x += 8) rivet(g, x, y === 62 ? 59 : y + 2);
    }
    grime(g, rnd, TEX, TEX, 300, '30,12,4');
    streaks(g, rnd, 6);
  },
  computer: (g, gl, rnd) => {
    plate(g, 0, 0, TEX, TEX, '#34383a', '#4f5557', '#16191a');
    // the screen
    g.fillStyle = '#0b1a12';
    g.fillRect(6, 6, 30, 22);
    gl.fillStyle = '#fff';
    gl.fillRect(7, 7, 28, 20);
    g.fillStyle = '#1e6b3c';
    for (let y = 9; y < 26; y += 3) g.fillRect(8, y, 6 + Math.floor(rnd() * 22), 1);
    g.fillStyle = '#58f08c';
    g.fillRect(8, 23, 14, 2);
    // trend line
    g.strokeStyle = '#7dfcb0';
    g.beginPath();
    g.moveTo(8, 18);
    for (let x = 8; x < 34; x += 3) g.lineTo(x, 12 + rnd() * 9);
    g.stroke();
    // banks of lamps
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 5; col++) {
        const c = ['#34ff6a', '#ff3b30', '#ffb400', '#34ff6a', '#2fb6ff'][Math.floor(rnd() * 5)];
        const on = rnd() > 0.25;
        g.fillStyle = on ? c : '#202020';
        g.fillRect(41 + col * 4, 8 + row * 6, 2, 2);
        if (on) gl.fillRect(41 + col * 4, 8 + row * 6, 2, 2);
      }
    }
    // vents and a keyboard ledge
    g.fillStyle = '#1b1e1f';
    for (let y = 34; y < 46; y += 3) g.fillRect(6, y, 52, 1);
    plate(g, 4, 50, 56, 8, '#2a2d2e', '#45494a', '#101213');
    for (let x = 7; x < 57; x += 4) {
      g.fillStyle = '#56595a';
      g.fillRect(x, 52, 3, 2);
      g.fillRect(x + 1, 55, 3, 1);
    }
    grime(g, rnd, TEX, TEX, 160);
  },
  logo: (g, gl, rnd) => {
    WALL_DRAW.steel(g, gl, rnd);
    plate(g, 12, 8, 40, 40, '#15181a', '#2c3134', '#050607');
    const cell = 8;
    LOGO_GRID.forEach((row, r) =>
      row.forEach((c, k) => {
        g.fillStyle = c;
        g.fillRect(15 + k * (cell + 1), 11 + r * (cell + 1), cell, cell);
        gl.fillRect(15 + k * (cell + 1), 11 + r * (cell + 1), cell, cell);
      })
    );
    g.fillStyle = '#c9c4b5';
    g.font = 'bold 7px monospace';
    g.fillText('WINCC OA', 15, 57);
  },
  pipes: (g, _gl, rnd) => {
    g.fillStyle = '#26231f';
    g.fillRect(0, 0, TEX, TEX);
    for (const [x, w, base] of [
      [4, 12, '#6b6f6c'],
      [20, 8, '#8a6a3a'],
      [32, 14, '#5e6a5a'],
      [50, 10, '#6b6f6c']
    ] as [number, number, string][]) {
      const grad = g.createLinearGradient(x, 0, x + w, 0);
      grad.addColorStop(0, '#1b1a18');
      grad.addColorStop(0.35, base);
      grad.addColorStop(0.5, '#d8d4c8');
      grad.addColorStop(0.65, base);
      grad.addColorStop(1, '#141311');
      g.fillStyle = grad;
      g.fillRect(x, 0, w, TEX);
      for (const y of [10, 44]) {
        g.fillStyle = '#1c1b19';
        g.fillRect(x - 1, y, w + 2, 4);
        g.fillStyle = '#4a4740';
        g.fillRect(x - 1, y, w + 2, 1);
      }
    }
    // a red valve wheel
    g.strokeStyle = '#b3261e';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(39, 28, 7, 0, Math.PI * 2);
    g.moveTo(32, 28);
    g.lineTo(46, 28);
    g.moveTo(39, 21);
    g.lineTo(39, 35);
    g.stroke();
    grime(g, rnd, TEX, TEX, 260, '30,20,10');
    streaks(g, rnd, 5);
  },
  hazard: (g, gl, rnd) => {
    WALL_DRAW.steel(g, gl, rnd);
    g.save();
    g.beginPath();
    g.rect(0, 40, TEX, 24);
    g.clip();
    g.fillStyle = '#e1b000';
    g.fillRect(0, 40, TEX, 24);
    g.fillStyle = '#16130e';
    for (let x = -24; x < TEX + 24; x += 16) {
      g.beginPath();
      g.moveTo(x, 64);
      g.lineTo(x + 8, 64);
      g.lineTo(x + 32, 40);
      g.lineTo(x + 24, 40);
      g.fill();
    }
    g.restore();
    grime(g, rnd, TEX, TEX, 300, '40,26,8');
  },
  concrete: (g, _gl, rnd) => {
    g.fillStyle = '#6b665c';
    g.fillRect(0, 0, TEX, TEX);
    for (let k = 0; k < 600; k++) {
      const v = 80 + Math.floor(rnd() * 50);
      g.fillStyle = `rgba(${v},${v - 4},${v - 12},0.5)`;
      g.fillRect(Math.floor(rnd() * TEX), Math.floor(rnd() * TEX), 1, 1);
    }
    g.fillStyle = '#3c382f';
    for (const y of [0, 21, 42]) g.fillRect(0, y, TEX, 1);
    for (const [y, xs] of [
      [0, [0, 32]],
      [21, [16, 48]],
      [42, [0, 32]]
    ] as [number, number[]][])
      for (const x of xs) g.fillRect(x, y, 1, 21);
    g.strokeStyle = 'rgba(30,26,20,0.7)';
    g.beginPath();
    g.moveTo(40, 22);
    g.lineTo(44, 30);
    g.lineTo(41, 37);
    g.lineTo(47, 41);
    g.stroke();
    streaks(g, rnd, 7);
  },
  vc: (g, gl, rnd) => drawVc(g, gl, rnd, null),
  exit: (g, gl, rnd) => drawExit(g, gl, rnd, false)
};

/** A Visuel Concept panel: a lit white plaque on steel, the logo on it once loaded. */
function drawVc(g: CanvasRenderingContext2D, gl: CanvasRenderingContext2D, rnd: () => number, symbol: CanvasImageSource | null): void {
  WALL_DRAW.steel(g, gl, rnd);
  plate(g, 8, 8, 48, 42, '#e9e7e0', '#ffffff', '#8e8b82');
  gl.fillRect(9, 9, 46, 40);
  if (symbol) g.drawImage(symbol, 17, 11, 30, 30);
  g.fillStyle = '#122d60';
  g.font = 'bold 5px sans-serif';
  g.textAlign = 'center';
  g.fillText('VISUEL CONCEPT', 32, 47, 44);
  g.textAlign = 'start';
}

/** Draws the Visuel Concept symbol into the `V` panels once its image is loaded (in place). */
export function paintVc(set: TextureSet, symbol: CanvasImageSource): void {
  const t = makeTexture(TEX, TEX, 17, (g, gl, rnd) => drawVc(g, gl, rnd, symbol));
  set.walls.vc.px.set(t.px);
  set.walls.vc.glow.set(t.glow);
}

function drawExit(g: CanvasRenderingContext2D, gl: CanvasRenderingContext2D, rnd: () => number, on: boolean): void {
  WALL_DRAW.hazard(g, gl, rnd);
  plate(g, 14, 6, 36, 30, '#2a2c2c', '#474b4b', '#0e0f0f');
  // the sign
  g.fillStyle = on ? '#123d1f' : '#3d1212';
  g.fillRect(18, 9, 28, 9);
  g.fillStyle = on ? '#5cff8d' : '#ff4d4d';
  g.font = 'bold 8px monospace';
  g.fillText('EXIT', 23, 17);
  gl.fillRect(18, 9, 28, 9);
  // the lever
  g.fillStyle = '#111';
  g.fillRect(29, 21, 6, 13);
  g.fillStyle = '#b8b2a0';
  g.fillRect(31, on ? 27 : 20, 2, 8);
  g.fillStyle = on ? '#3dff7a' : '#ff3030';
  g.fillRect(29, on ? 33 : 18, 6, 3);
  gl.fillRect(29, on ? 33 : 18, 6, 3);
}

function drawDoor(g: CanvasRenderingContext2D, gl: CanvasRenderingContext2D, rnd: () => number, key: KeyColor | null): void {
  plate(g, 0, 0, TEX, TEX, '#4c4d4a', '#6e6f69', '#222220');
  for (let y = 10; y < 56; y += 9) {
    g.fillStyle = '#2f2f2c';
    g.fillRect(6, y, 52, 3);
    g.fillStyle = '#737369';
    g.fillRect(6, y, 52, 1);
  }
  // hazard edges
  for (const x of [0, 58]) {
    g.fillStyle = '#d8a800';
    g.fillRect(x, 0, 6, TEX);
    g.fillStyle = '#17140e';
    for (let y = 0; y < TEX; y += 8) g.fillRect(x, y, 6, 4);
  }
  if (key) {
    g.fillStyle = KEY_COLORS[key];
    g.fillRect(6, 28, 52, 7);
    g.fillRect(27, 4, 10, 4);
    gl.fillRect(27, 4, 10, 4);
  }
  grime(g, rnd, TEX, TEX, 220, '30,20,10');
}

/** The side of a doorway: the track the door slides into. */
function drawJamb(g: CanvasRenderingContext2D, _gl: CanvasRenderingContext2D, rnd: () => number): void {
  g.fillStyle = '#2b2a27';
  g.fillRect(0, 0, TEX, TEX);
  g.fillStyle = '#45433d';
  g.fillRect(24, 0, 16, TEX);
  for (let y = 4; y < TEX; y += 12) rivet(g, 31, y);
  grime(g, rnd, TEX, TEX, 120);
}

/**
 * A safety fence panel: yellow posts and rails, black wire mesh; the holes are transparent (the
 * raycaster sees through). The gate has a handle, its lock and a sign.
 */
function drawFence(g: CanvasRenderingContext2D, gate: boolean): void {
  g.clearRect(0, 0, TEX, TEX);
  g.fillStyle = '#1c1c1a';
  for (let x = 2; x < TEX; x += 4) g.fillRect(x, 6, 1, 54);
  for (let y = 8; y < 60; y += 4) g.fillRect(0, y, TEX, 1);
  g.fillStyle = '#e0b000';
  g.fillRect(0, 4, TEX, 3);
  g.fillRect(0, 58, TEX, 3);
  g.fillRect(0, 4, 3, 60);
  g.fillRect(TEX - 3, 4, 3, 60);
  g.fillStyle = '#9a7a00';
  g.fillRect(0, 61, 4, 3);
  g.fillRect(TEX - 4, 61, 4, 3);
  if (!gate) return;
  g.fillRect(30, 4, 3, 56);
  // the handle and the safety switch
  g.fillStyle = '#2a2a28';
  g.fillRect(48, 28, 8, 10);
  g.fillStyle = '#c42018';
  g.fillRect(50, 30, 4, 3);
  g.fillStyle = '#d9d6cc';
  g.fillRect(44, 32, 4, 2);
  // the sign
  g.fillStyle = '#f2f0e8';
  g.fillRect(9, 22, 16, 12);
  g.fillStyle = '#1e5fbf';
  g.fillRect(10, 23, 14, 4);
  g.fillStyle = '#16130e';
  g.font = 'bold 4px sans-serif';
  g.fillText('GATE', 12, 32);
}

const FLOOR_DRAW: Record<FloorTex | 'ceiling', Draw> = {
  tiles: (g, _gl, rnd) => {
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const v = 66 + Math.floor(rnd() * 14);
        plate(g, x * 16, y * 16, 16, 16, `rgb(${v},${v - 3},${v - 8})`, `rgb(${v + 14},${v + 10},${v + 4})`, '#1f1d1a');
      }
    grime(g, rnd, TEX, TEX, 500, '30,22,12');
  },
  grate: (g, _gl, rnd) => {
    g.fillStyle = '#121110';
    g.fillRect(0, 0, TEX, TEX);
    g.strokeStyle = '#6a685f';
    g.lineWidth = 2;
    for (let k = -TEX; k < TEX * 2; k += 8) {
      g.beginPath();
      g.moveTo(k, 0);
      g.lineTo(k + TEX, TEX);
      g.moveTo(k, TEX);
      g.lineTo(k + TEX, 0);
      g.stroke();
    }
    g.fillStyle = '#3e3c36';
    g.fillRect(0, 0, TEX, 2);
    g.fillRect(0, 0, 2, TEX);
    grime(g, rnd, TEX, TEX, 200);
  },
  coolant: (g, gl, rnd) => {
    g.fillStyle = '#1f7a1a';
    g.fillRect(0, 0, TEX, TEX);
    for (let k = 0; k < 70; k++) {
      g.fillStyle = ['#3fbf2a', '#2a9a1e', '#7bf04a', '#185f14'][Math.floor(rnd() * 4)];
      g.globalAlpha = 0.6;
      g.beginPath();
      g.ellipse(rnd() * TEX, rnd() * TEX, 2 + rnd() * 6, 1 + rnd() * 3, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    gl.fillRect(0, 0, TEX, TEX);
  },
  yard: (g, _gl, rnd) => {
    g.fillStyle = '#4a443a';
    g.fillRect(0, 0, TEX, TEX);
    for (let k = 0; k < 900; k++) {
      const v = 50 + Math.floor(rnd() * 40);
      g.fillStyle = `rgb(${v},${v - 5},${v - 14})`;
      g.fillRect(Math.floor(rnd() * TEX), Math.floor(rnd() * TEX), 1, 1);
    }
    g.strokeStyle = '#2a251e';
    g.beginPath();
    g.moveTo(5, 50);
    g.lineTo(20, 44);
    g.lineTo(26, 52);
    g.lineTo(41, 47);
    g.stroke();
  },
  ceiling: (g, gl, rnd) => {
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) plate(g, x * 32, y * 32, 32, 32, '#2c2c2a', '#3b3a37', '#121211');
    g.fillStyle = '#1a1917';
    g.fillRect(14, 0, 4, TEX);
    g.fillRect(46, 0, 4, TEX);
    grime(g, rnd, TEX, TEX, 200);
    void gl;
  }
};

/** The sky over the yard: a smoky dusk over the plant's chimneys (one panorama around). */
function drawSky(g: CanvasRenderingContext2D, gl: CanvasRenderingContext2D, rnd: () => number): void {
  const w = 512;
  const h = 96;
  const grad = g.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#150707');
  grad.addColorStop(0.45, '#5b1a0c');
  grad.addColorStop(0.8, '#b3461a');
  grad.addColorStop(1, '#e07a2e');
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  // smoke banks
  for (let k = 0; k < 40; k++) {
    g.fillStyle = `rgba(30,12,8,${0.15 + rnd() * 0.25})`;
    g.beginPath();
    g.ellipse(rnd() * w, 10 + rnd() * 40, 20 + rnd() * 50, 4 + rnd() * 8, 0, 0, Math.PI * 2);
    g.fill();
  }
  // the plant's silhouette: halls, chimneys, a cooling tower, gantries
  g.fillStyle = '#0d0807';
  let x = 0;
  while (x < w) {
    const bw = 18 + rnd() * 40;
    const bh = 14 + rnd() * 26;
    g.fillRect(x, h - bh, bw, bh);
    if (rnd() > 0.5) {
      const cx = x + rnd() * bw;
      const ch = 20 + rnd() * 34;
      g.fillRect(cx, h - bh - ch, 4, ch);
      g.fillStyle = '#ff5a20';
      g.fillRect(cx, h - bh - ch, 4, 1);
      gl.fillRect(cx, h - bh - ch, 4, 1);
      g.fillStyle = '#0d0807';
    }
    for (let k = 0; k < 4; k++) {
      if (rnd() > 0.55) {
        const wx = x + 3 + rnd() * (bw - 6);
        const wy = h - bh + 4 + rnd() * (bh - 8);
        g.fillStyle = '#ffb347';
        g.fillRect(wx, wy, 2, 1);
        gl.fillRect(wx, wy, 2, 1);
        g.fillStyle = '#0d0807';
      }
    }
    x += bw + rnd() * 10;
  }
  g.beginPath();
  g.moveTo(300, h);
  g.lineTo(306, h - 44);
  g.quadraticCurveTo(318, h - 38, 330, h - 44);
  g.lineTo(336, h);
  g.fill();
}

export interface TextureSet {
  walls: Record<WallTex, Texture>;
  exitOn: Texture;
  doors: Record<KeyColor | 'plain', Texture>;
  jamb: Texture;
  fence: Texture;
  gate: Texture;
  floors: Record<FloorTex, Texture>;
  ceiling: Texture;
  sky: Texture;
}

/** Every texture of the plant (drawn once, ~40 ms). */
export function makeTextures(): TextureSet {
  let seed = 11;
  const walls = Object.fromEntries(Object.entries(WALL_DRAW).map(([k, d]) => [k, makeTexture(TEX, TEX, seed++, d)])) as Record<WallTex, Texture>;
  const floors = Object.fromEntries(
    (['tiles', 'grate', 'coolant', 'yard'] as FloorTex[]).map((k) => [k, makeTexture(TEX, TEX, seed++, FLOOR_DRAW[k])])
  ) as Record<FloorTex, Texture>;
  return {
    walls,
    exitOn: makeTexture(TEX, TEX, 3, (g, gl, rnd) => drawExit(g, gl, rnd, true)),
    doors: {
      plain: makeTexture(TEX, TEX, 41, (g, gl, rnd) => drawDoor(g, gl, rnd, null)),
      blue: makeTexture(TEX, TEX, 42, (g, gl, rnd) => drawDoor(g, gl, rnd, 'blue')),
      yellow: makeTexture(TEX, TEX, 43, (g, gl, rnd) => drawDoor(g, gl, rnd, 'yellow')),
      red: makeTexture(TEX, TEX, 44, (g, gl, rnd) => drawDoor(g, gl, rnd, 'red'))
    },
    jamb: makeTexture(TEX, TEX, 45, drawJamb),
    fence: makeTexture(TEX, TEX, 48, (g) => drawFence(g, false)),
    gate: makeTexture(TEX, TEX, 49, (g) => drawFence(g, true)),
    floors,
    ceiling: makeTexture(TEX, TEX, 46, FLOOR_DRAW.ceiling),
    sky: makeTexture(512, 96, 47, drawSky)
  };
}
