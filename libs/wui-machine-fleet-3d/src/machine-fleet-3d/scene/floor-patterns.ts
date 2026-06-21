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
  }
};
