// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Procedural floor textures, ported from the prototype's `FLOOR_PATTERNS`
 * registry. Each pattern paints a 1024×1024 canvas (final colours, no tint
 * multiplier) and returns a tiling `CanvasTexture`.
 *
 * Strategy note (from the prototype): the *slab joints* and *macro tint
 * variations* are what stay legible at 30-50 m; aggregate grain is decorative
 * close-up only.
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import type { FloorType } from '../types.js';

interface FloorMatParams {
  color: number;
  roughness: number;
  metalness: number;
}

interface FloorPattern {
  label: string;
  /** Metres represented by one texture tile. */
  tileSize: number;
  matParams: FloorMatParams;
  generate: () => CanvasTexture;
}

const TEX_SIZE = 1024;
/** Fully transparent gradient stop colour. */
const TRANSPARENT = 'rgba(0,0,0,0)';

function newCanvasCtx(): {
  cv: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX_SIZE;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return { cv, ctx };
}

function finalizeTexture(cv: HTMLCanvasElement): CanvasTexture {
  const tex = new CanvasTexture(cv);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.anisotropy = 16;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

// eslint-disable-next-line max-lines-per-function -- faithful 1:1 port of the prototype's canvas painter
function generateConcrete(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#5b6478';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 80 + Math.random() * 220;
    const dark = Math.random() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, dark ? 'rgba(35, 40, 52, 0.45)' : 'rgba(110, 118, 132, 0.4)');
    g.addColorStop(1, TRANSPARENT);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 22_000; i++) {
    const dark = Math.random() > 0.4;
    const v = dark ? 15 + Math.random() * 35 : 140 + Math.random() * 60;
    ctx.fillStyle = `rgba(${v}, ${v + 4}, ${v + 12}, ${0.45 + Math.random() * 0.5})`;
    const r = 1.4 + Math.random() * 3.2;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 1200; i++) {
    const v = 80 + Math.random() * 90;
    ctx.fillStyle = `rgba(${v}, ${v + 5}, ${v + 14}, ${0.55 + Math.random() * 0.35})`;
    const r = 4 + Math.random() * 8;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 80; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 30 + Math.random() * 100;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(5, 8, 12, 0.7)');
    g.addColorStop(1, 'rgba(5, 8, 12, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#0d1018';
  ctx.lineWidth = 6;
  for (let i = 0; i <= 4; i++) {
    const p = (i * s) / 4;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(s, p);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(13, 16, 24, 0.5)';
  ctx.lineWidth = 3;
  for (let i = 1; i < 8; i += 2) {
    const p = (i * s) / 8;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(s, p);
    ctx.stroke();
  }
  return finalizeTexture(cv);
}

// eslint-disable-next-line max-lines-per-function -- faithful 1:1 port of the prototype's canvas painter
function generateSmoothConcrete(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#9aa1ad';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 90 + Math.random() * 200;
    const lighter = Math.random() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, lighter ? 'rgba(190, 196, 208, 0.32)' : 'rgba(110, 118, 130, 0.30)');
    g.addColorStop(1, TRANSPARENT);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 6000; i++) {
    const v = Math.random() > 0.5 ? 60 + Math.random() * 40 : 160 + Math.random() * 50;
    ctx.fillStyle = `rgba(${v}, ${v}, ${v + 4}, ${0.2 + Math.random() * 0.25})`;
    const r = 0.8 + Math.random() * 2;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = '#2a313e';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(s / 2, 0);
  ctx.lineTo(s / 2, s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, s / 2);
  ctx.lineTo(s, s / 2);
  ctx.stroke();
  return finalizeTexture(cv);
}

function generateWhiteConcrete(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#dfe2e6';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 90 + Math.random() * 200;
    const lighter = Math.random() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, lighter ? 'rgba(246, 248, 250, 0.45)' : 'rgba(200, 205, 213, 0.30)');
    g.addColorStop(1, TRANSPARENT);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 4000; i++) {
    const v = 200 + Math.random() * 50;
    ctx.fillStyle = `rgba(${v}, ${v}, ${v + 2}, ${0.15 + Math.random() * 0.2})`;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, 0.8 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(160, 168, 178, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(s / 2, 0);
  ctx.lineTo(s / 2, s);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, s / 2);
  ctx.lineTo(s, s / 2);
  ctx.stroke();
  return finalizeTexture(cv);
}

function generateEpoxy(base: string, brightRgb: string, darkRgb: string): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 100 + Math.random() * 280;
    const bright = Math.random() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${bright ? brightRgb : darkRgb}, ${0.18 + Math.random() * 0.22})`);
    g.addColorStop(1, TRANSPARENT);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 12_000; i++) {
    const bright = Math.random() > 0.5;
    ctx.fillStyle = `rgba(${bright ? brightRgb : darkRgb}, ${0.2 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, 0.7 + Math.random() * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalizeTexture(cv);
}

function generateCheckered(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  const tiles = 8;
  const step = s / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? '#3a4150' : '#2a303c';
      ctx.fillRect(i * step, j * step, step, step);
    }
  }
  ctx.strokeStyle = 'rgba(10, 13, 20, 0.6)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= tiles; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(s, p);
    ctx.stroke();
  }
  return finalizeTexture(cv);
}

// eslint-disable-next-line max-lines-per-function -- self-contained canvas painter
function generatePolished(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#3a4150';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 120 + Math.random() * 260;
    const bright = Math.random() > 0.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, bright ? 'rgba(150, 160, 178, 0.22)' : 'rgba(20, 24, 34, 0.28)');
    g.addColorStop(1, TRANSPARENT);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(12, 15, 22, 0.7)';
  ctx.lineWidth = 4;
  for (let i = 0; i <= 4; i++) {
    const p = (i * s) / 4;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(s, p);
    ctx.stroke();
  }
  return finalizeTexture(cv);
}

function generateAsphalt(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#2b2c30';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 38_000; i++) {
    const v = Math.random() > 0.5 ? 12 + Math.random() * 28 : 60 + Math.random() * 70;
    ctx.fillStyle = `rgba(${v}, ${v}, ${v + 6}, ${0.35 + Math.random() * 0.4})`;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, 0.8 + Math.random() * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalizeTexture(cv);
}

// eslint-disable-next-line max-lines-per-function -- self-contained canvas painter
function generateTiles(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  const tiles = 10;
  const step = s / tiles;
  for (let i = 0; i < tiles; i++) {
    for (let j = 0; j < tiles; j++) {
      const v = 206 + Math.floor(Math.random() * 30);
      ctx.fillStyle = `rgb(${v}, ${v + 2}, ${v + 6})`;
      ctx.fillRect(i * step, j * step, step, step);
    }
  }
  ctx.strokeStyle = 'rgba(120, 128, 140, 0.8)';
  ctx.lineWidth = 4;
  for (let i = 0; i <= tiles; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(s, p);
    ctx.stroke();
  }
  return finalizeTexture(cv);
}

// eslint-disable-next-line max-lines-per-function -- self-contained canvas painter
function generateDiamondPlate(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#7d828c';
  ctx.fillRect(0, 0, s, s);
  const step = 64;
  for (let y = 0; y < s; y += step) {
    for (let x = 0; x < s; x += step) {
      const ox = (y / step) % 2 === 0 ? 0 : step / 2;
      ctx.save();
      ctx.translate(x + ox, y + step / 2);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = 'rgba(225, 230, 238, 0.55)';
      ctx.fillRect(-13, -4, 26, 8);
      ctx.fillStyle = 'rgba(30, 34, 42, 0.55)';
      ctx.fillRect(-13, 4, 26, 3);
      ctx.restore();
    }
  }
  return finalizeTexture(cv);
}

function generateGrating(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#15171c';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = 'rgba(150, 158, 170, 0.9)';
  const bar = 7;
  const gap = 40;
  for (let x = 0; x < s; x += gap) ctx.fillRect(x, 0, bar, s);
  ctx.fillStyle = 'rgba(110, 118, 130, 0.85)';
  for (let y = 0; y < s; y += gap * 2) ctx.fillRect(0, y, s, bar);
  return finalizeTexture(cv);
}

// eslint-disable-next-line max-lines-per-function -- self-contained canvas painter
function generateSafetyZone(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#5b6478';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const v = 60 + Math.random() * 90;
    ctx.fillStyle = `rgba(${v}, ${v + 5}, ${v + 14}, ${0.3 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.arc(Math.random() * s, Math.random() * s, 1.5 + Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // Yellow safety lane around the slab.
  ctx.strokeStyle = '#f2c200';
  ctx.lineWidth = 22;
  const m = 70;
  ctx.strokeRect(m, m, s - 2 * m, s - 2 * m);
  // Hazard chevrons along the top edge.
  for (let x = -s; x < s; x += 56) {
    ctx.fillStyle = '#f2c200';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 28, 0);
    ctx.lineTo(x + 28 - 40, 40);
    ctx.lineTo(x - 40, 40);
    ctx.closePath();
    ctx.fill();
  }
  return finalizeTexture(cv);
}

// --- Clean / modern finishes (#61): restrained, credible for a plant, a lab or a control room.

/** Soft, wide tint variations (cloudy look) over the whole tile; legible from afar. */
function cloud(ctx: CanvasRenderingContext2D, count: number, light: string, dark: string): void {
  const s = TEX_SIZE;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * s;
    const y = Math.random() * s;
    const r = 120 + Math.random() * 260;
    const tone = Math.random() < 0.5 ? light : dark;
    // Drawn at the 9 wrap offsets so the tile stays seamless.
    for (const ox of [-s, 0, s]) {
      for (const oy of [-s, 0, s]) {
        const g = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        g.addColorStop(0, tone);
        g.addColorStop(1, TRANSPARENT);
        ctx.fillStyle = g;
        ctx.fillRect(x + ox - r, y + oy - r, 2 * r, 2 * r);
      }
    }
  }
}

/** Fine grain: `count` one-pixel specks of the given colours. */
function grain(ctx: CanvasRenderingContext2D, count: number, colours: string[]): void {
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = colours[i % colours.length];
    ctx.fillRect(Math.random() * TEX_SIZE, Math.random() * TEX_SIZE, 1.5, 1.5);
  }
}

function generateGraphiteResin(): CanvasTexture {
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#2d3138';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  cloud(ctx, 14, 'rgba(90, 98, 110, 0.18)', 'rgba(10, 12, 16, 0.22)');
  grain(ctx, 26000, ['rgba(140, 148, 160, 0.10)', 'rgba(0, 0, 0, 0.12)']);
  return finalizeTexture(cv);
}

function generateLightPuLanes(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#c8cdd4';
  ctx.fillRect(0, 0, s, s);
  cloud(ctx, 10, 'rgba(255, 255, 255, 0.16)', 'rgba(120, 128, 140, 0.12)');
  grain(ctx, 14000, ['rgba(255, 255, 255, 0.18)', 'rgba(90, 96, 108, 0.10)']);
  // Thin, low-contrast lane lines (a cool accent) every quarter of the tile.
  ctx.strokeStyle = 'rgba(0, 135, 175, 0.45)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const p = (i * s) / 4 + 1.5;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, s);
    ctx.moveTo(0, p);
    ctx.lineTo(s, p);
    ctx.stroke();
  }
  return finalizeTexture(cv);
}

/** A grid of `n` × `n` tiles, each slightly tinted, with joints of `joint` px. */
// eslint-disable-next-line max-params -- a tile grid needs its colours and joint
function tileGrid(n: number, base: [number, number, number], spread: number, joint: string, jointW: number): HTMLCanvasElement {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  const t = s / n;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = (Math.random() - 0.5) * spread;
      ctx.fillStyle = `rgb(${base[0] + d}, ${base[1] + d}, ${base[2] + d})`;
      ctx.fillRect(i * t, j * t, t, t);
    }
  }
  grain(ctx, 12000, ['rgba(255, 255, 255, 0.10)', 'rgba(0, 0, 0, 0.06)']);
  ctx.fillStyle = joint;
  for (let i = 0; i < n; i++) {
    ctx.fillRect(i * t, 0, jointW, s);
    ctx.fillRect(0, i * t, s, jointW);
  }
  return cv;
}

function generateLargePorcelain(): CanvasTexture {
  return finalizeTexture(tileGrid(4, [212, 214, 217], 10, 'rgba(120, 125, 132, 0.85)', 3));
}

function generateRaisedAccess(): CanvasTexture {
  const n = 8;
  const cv = tileGrid(n, [186, 191, 198], 6, 'rgba(70, 75, 84, 0.9)', 3);
  const ctx = cv.getContext('2d');
  if (!ctx) return finalizeTexture(cv);
  const t = TEX_SIZE / n;
  // Bevel of each panel: light top-left edge, dark bottom-right edge, a corner screw each.
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const x = i * t + 3;
      const y = j * t + 3;
      const w = t - 3;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.fillRect(x, y, w, 3);
      ctx.fillRect(x, y, 3, w);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
      ctx.fillRect(x, y + w - 3, w, 3);
      ctx.fillRect(x + w - 3, y, 3, w);
      ctx.fillStyle = 'rgba(60, 64, 72, 0.6)';
      for (const [cx, cy] of [[x + 9, y + 9], [x + w - 9, y + 9], [x + 9, y + w - 9], [x + w - 9, y + w - 9]]) {
        ctx.beginPath();
        ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return finalizeTexture(cv);
}

function generateHexTiles(): CanvasTexture {
  const s = TEX_SIZE;
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#5c626c';
  ctx.fillRect(0, 0, s, s);
  // 7 columns × 8 rows of pointy hexagons tile a square within 1 % (7 / 4 ≈ √3): seamless.
  const cols = 7;
  const rows = 8;
  const w = s / cols;
  const r = s / (rows * 1.5);
  const hw = w / 2;
  for (let j = -1; j <= rows; j++) {
    for (let i = -1; i <= cols; i++) {
      const cx = i * w + (j % 2 === 0 ? 0 : hw);
      const cy = j * 1.5 * r;
      const d = (Math.random() - 0.5) * 12;
      ctx.fillStyle = `rgb(${124 + d}, ${131 + d}, ${142 + d})`;
      const k = 0.93; // inset: the joint shows between tiles
      ctx.beginPath();
      ctx.moveTo(cx, cy - r * k);
      ctx.lineTo(cx + hw * k, cy - (r / 2) * k);
      ctx.lineTo(cx + hw * k, cy + (r / 2) * k);
      ctx.lineTo(cx, cy + r * k);
      ctx.lineTo(cx - hw * k, cy + (r / 2) * k);
      ctx.lineTo(cx - hw * k, cy - (r / 2) * k);
      ctx.closePath();
      ctx.fill();
    }
  }
  grain(ctx, 10000, ['rgba(255, 255, 255, 0.08)', 'rgba(0, 0, 0, 0.08)']);
  return finalizeTexture(cv);
}

function generateMicroTerrazzo(): CanvasTexture {
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#e2e0db';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  cloud(ctx, 6, 'rgba(255, 255, 255, 0.2)', 'rgba(150, 146, 140, 0.1)');
  const chips = ['#9da1a6', '#6f7378', '#c4c6c8', '#ffffff', '#4b4f55'];
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = chips[i % chips.length];
    const size = 1.5 + Math.random() * 4;
    ctx.beginPath();
    ctx.ellipse(Math.random() * TEX_SIZE, Math.random() * TEX_SIZE, size, size * (0.5 + Math.random() * 0.5), Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  return finalizeTexture(cv);
}

function generateMicrocementDark(): CanvasTexture {
  const { cv, ctx } = newCanvasCtx();
  ctx.fillStyle = '#3e4249';
  ctx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
  cloud(ctx, 24, 'rgba(110, 116, 126, 0.22)', 'rgba(20, 22, 26, 0.25)');
  grain(ctx, 18000, ['rgba(160, 166, 176, 0.08)', 'rgba(0, 0, 0, 0.10)']);
  return finalizeTexture(cv);
}

export const FLOOR_PATTERNS: Record<FloorType, FloorPattern> = {
  concrete: {
    label: 'Béton industriel',
    tileSize: 60,
    matParams: { color: 0xFF_FF_FF, roughness: 0.92, metalness: 0.05 },
    generate: generateConcrete
  },
  'smooth-concrete': {
    label: 'Béton lissé',
    tileSize: 70,
    matParams: { color: 0xFF_FF_FF, roughness: 0.6, metalness: 0.1 },
    generate: generateSmoothConcrete
  },
  'polished-concrete': {
    label: 'Béton poli',
    tileSize: 75,
    matParams: { color: 0xFF_FF_FF, roughness: 0.25, metalness: 0.2 },
    generate: generatePolished
  },
  'concrete-white': {
    label: 'Béton clair (salle blanche)',
    tileSize: 70,
    matParams: { color: 0xFF_FF_FF, roughness: 0.5, metalness: 0.08 },
    generate: generateWhiteConcrete
  },
  'epoxy-blue': {
    label: 'Résine époxy bleu',
    tileSize: 80,
    matParams: { color: 0xFF_FF_FF, roughness: 0.22, metalness: 0.18 },
    generate: () => generateEpoxy('#1e4a7a', '80, 160, 230', '15, 35, 65')
  },
  'epoxy-grey': {
    label: 'Résine époxy gris',
    tileSize: 80,
    matParams: { color: 0xFF_FF_FF, roughness: 0.2, metalness: 0.15 },
    generate: () => generateEpoxy('#bfc4cc', '245, 248, 252', '120, 128, 140')
  },
  'epoxy-green': {
    label: 'Résine époxy vert',
    tileSize: 80,
    matParams: { color: 0xFF_FF_FF, roughness: 0.22, metalness: 0.18 },
    generate: () => generateEpoxy('#1e6b3a', '90, 200, 120', '12, 50, 28')
  },
  'epoxy-red': {
    label: 'Résine époxy rouge',
    tileSize: 80,
    matParams: { color: 0xFF_FF_FF, roughness: 0.22, metalness: 0.18 },
    generate: () => generateEpoxy('#7a2530', '210, 90, 90', '60, 15, 20')
  },
  'epoxy-yellow': {
    label: 'Résine époxy jaune',
    tileSize: 80,
    matParams: { color: 0xFF_FF_FF, roughness: 0.22, metalness: 0.18 },
    generate: () => generateEpoxy('#b8901e', '245, 220, 120', '90, 70, 15')
  },
  'checkered-floor': {
    label: 'Dalles damier',
    tileSize: 30,
    matParams: { color: 0xFF_FF_FF, roughness: 0.7, metalness: 0.1 },
    generate: generateCheckered
  },
  'tiles-white': {
    label: 'Carrelage blanc',
    tileSize: 40,
    matParams: { color: 0xFF_FF_FF, roughness: 0.35, metalness: 0.1 },
    generate: generateTiles
  },
  asphalt: {
    label: 'Enrobé / asphalte',
    tileSize: 65,
    matParams: { color: 0xFF_FF_FF, roughness: 0.95, metalness: 0.04 },
    generate: generateAsphalt
  },
  'diamond-plate': {
    label: 'Tôle larmée',
    tileSize: 12,
    matParams: { color: 0xFF_FF_FF, roughness: 0.4, metalness: 0.8 },
    generate: generateDiamondPlate
  },
  'metal-grating': {
    label: 'Caillebotis métal',
    tileSize: 8,
    matParams: { color: 0xFF_FF_FF, roughness: 0.5, metalness: 0.75 },
    generate: generateGrating
  },
  'safety-zone': {
    label: 'Zone de sécurité',
    tileSize: 50,
    matParams: { color: 0xFF_FF_FF, roughness: 0.8, metalness: 0.08 },
    generate: generateSafetyZone
  },
  'graphite-resin': {
    label: 'Résine PU graphite',
    tileSize: 50,
    matParams: { color: 0xFF_FF_FF, roughness: 0.45, metalness: 0.1 },
    generate: generateGraphiteResin
  },
  'light-pu-lanes': {
    label: 'Résine PU claire, lignes d\'allées',
    tileSize: 40,
    matParams: { color: 0xFF_FF_FF, roughness: 0.4, metalness: 0.08 },
    generate: generateLightPuLanes
  },
  'large-porcelain': {
    label: 'Grès cérame grand format',
    tileSize: 4.8,
    matParams: { color: 0xFF_FF_FF, roughness: 0.55, metalness: 0.02 },
    generate: generateLargePorcelain
  },
  'raised-access': {
    label: 'Faux plancher technique',
    tileSize: 4.8,
    matParams: { color: 0xFF_FF_FF, roughness: 0.6, metalness: 0.15 },
    generate: generateRaisedAccess
  },
  'hex-tiles': {
    label: 'Dalles hexagonales',
    tileSize: 6,
    matParams: { color: 0xFF_FF_FF, roughness: 0.7, metalness: 0.05 },
    generate: generateHexTiles
  },
  'micro-terrazzo': {
    label: 'Terrazzo fin',
    tileSize: 12,
    matParams: { color: 0xFF_FF_FF, roughness: 0.35, metalness: 0.05 },
    generate: generateMicroTerrazzo
  },
  'microcement-dark': {
    label: 'Béton ciré sombre',
    tileSize: 45,
    matParams: { color: 0xFF_FF_FF, roughness: 0.5, metalness: 0.08 },
    generate: generateMicrocementDark
  }
};
