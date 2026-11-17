// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Procedural textures of City Drive (#79), drawn on canvases: no image file to ship.
 *
 * - facade: curtain wall with mullions and floor slabs; colour, emissive (lit windows) and
 *   roughness maps share one grid, so the light sits exactly in the glass;
 * - asphalt: grain, patches, cracks and wet spots (roughness), with a bump map;
 * - pavement: square slabs with joints, for the sidewalks;
 * - beam: a soft vertical gradient for the headlight cones.
 */
import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { rng } from './city.js';
import { mix, type NeonPalette } from './palette.js';

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

function texture(c: HTMLCanvasElement, color: boolean): CanvasTexture {
  const t = new CanvasTexture(c);
  t.wrapS = RepeatWrapping;
  t.wrapT = RepeatWrapping;
  t.minFilter = LinearMipmapLinearFilter;
  t.anisotropy = 8;
  if (color) t.colorSpace = SRGBColorSpace;
  return t;
}

/** Grain: `n` random dots of grey `lo..hi` on the whole canvas. */
function grain(g: CanvasRenderingContext2D, w: number, h: number, n: number, lo: number, hi: number, rand: () => number): void {
  for (let k = 0; k < n; k++) {
    const v = Math.round(lo + rand() * (hi - lo));
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

export interface FacadeMaps {
  map: Texture;
  emissiveMap: Texture;
  roughnessMap: Texture;
}

/** One facade style: 8 bays × 16 floors per texture repeat (a repeat ≈ 24 m × 56 m). */
export function facadeMaps(p: NeonPalette, seed: number, style: 0 | 1 | 2): FacadeMaps {
  const W = 512;
  const H = 1024;
  const bays = 8;
  const floors = 16;
  const bw = W / bays;
  const fh = H / floors;
  const rand = rng(seed);
  const [cc, cg] = canvas(W, H);
  const [ec, eg] = canvas(W, H);
  const [rc, rg] = canvas(W, H);
  const frame = style === 0 ? mix(p.surface, 0x000000, 0.25) : style === 1 ? mix(p.surface, 0x9aa8ad, 0.25) : mix(p.surface, 0x000000, 0.5);
  const glass = style === 2 ? mix(p.night, p.info, 0.18) : mix(p.night, p.primary, 0.12);
  cg.fillStyle = css(frame);
  cg.fillRect(0, 0, W, H);
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, W, H);
  rg.fillStyle = 'rgb(200,200,200)'; // frames: matt
  rg.fillRect(0, 0, W, H);
  const mullion = style === 1 ? 10 : 5;
  const slab = style === 1 ? 14 : 8;
  const hues = [p.primary, p.dynamic, p.info, p.warning];
  for (let f = 0; f < floors; f++) {
    // a floor is often lit as a whole (offices), sometimes not at all
    const floorLit = rand();
    for (let b = 0; b < bays; b++) {
      const x = b * bw + mullion / 2;
      const y = f * fh + slab / 2;
      const w = bw - mullion;
      const h = fh - slab;
      // glass: a slight vertical gradient, darker at the bottom
      const grad = cg.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, css(mix(glass, 0xffffff, 0.08)));
      grad.addColorStop(1, css(glass));
      cg.fillStyle = grad;
      cg.fillRect(x, y, w, h);
      rg.fillStyle = 'rgb(40,40,40)'; // glass: glossy
      rg.fillRect(x, y, w, h);
      const lit = floorLit > 0.72 ? rand() < 0.7 : floorLit > 0.4 ? rand() < 0.18 : false;
      if (!lit) continue;
      const warm = rand() < 0.45;
      const col = warm ? 0xffe2b0 : hues[Math.floor(rand() * hues.length)];
      const a = 0.25 + rand() * 0.45;
      const lg = eg.createLinearGradient(0, y, 0, y + h);
      lg.addColorStop(0, `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},${a})`);
      lg.addColorStop(1, `rgba(${(col >> 16) & 255},${(col >> 8) & 255},${col & 255},${a * 0.55})`);
      eg.fillStyle = lg;
      eg.fillRect(x + 1, y + 1, w - 2, h - 2);
      // blinds / furniture: a darker band in some lit windows
      if (rand() < 0.35) {
        eg.fillStyle = 'rgba(0,0,0,0.55)';
        eg.fillRect(x + 1, y + h * (0.2 + rand() * 0.4), w - 2, h * 0.15);
      }
    }
  }
  grain(cg, W, H, 3000, 0, 60, rand);
  return { map: texture(cc, true), emissiveMap: texture(ec, true), roughnessMap: texture(rc, false) };
}

export interface GroundMaps {
  map: Texture;
  roughnessMap: Texture;
  bumpMap: Texture;
}

/** Asphalt: one repeat ≈ 16 m. */
export function asphaltMaps(p: NeonPalette, seed = 5): GroundMaps {
  const S = 512;
  const rand = rng(seed);
  const [cc, cg] = canvas(S, S);
  const [rc, rg] = canvas(S, S);
  const [bc, bg] = canvas(S, S);
  cg.fillStyle = css(p.road);
  cg.fillRect(0, 0, S, S);
  rg.fillStyle = 'rgb(215,215,215)';
  rg.fillRect(0, 0, S, S);
  bg.fillStyle = 'rgb(128,128,128)';
  bg.fillRect(0, 0, S, S);
  // patches of newer / older asphalt
  for (let k = 0; k < 7; k++) {
    cg.fillStyle = css(mix(p.road, rand() < 0.5 ? 0x000000 : 0x5a666b, 0.12 + rand() * 0.12));
    cg.fillRect(rand() * S, rand() * S, 40 + rand() * 140, 30 + rand() * 90);
  }
  grain(cg, S, S, 26000, 20, 75, rand);
  grain(bg, S, S, 30000, 60, 200, rand);
  // wet spots: glossy, slightly darker
  for (let k = 0; k < 6; k++) {
    const x = rand() * S;
    const y = rand() * S;
    const r = 30 + rand() * 70;
    const wg = rg.createRadialGradient(x, y, 0, x, y, r);
    wg.addColorStop(0, 'rgba(25,25,25,0.95)');
    wg.addColorStop(1, 'rgba(25,25,25,0)');
    rg.fillStyle = wg;
    rg.fillRect(x - r, y - r, 2 * r, 2 * r);
    const dg = cg.createRadialGradient(x, y, 0, x, y, r);
    dg.addColorStop(0, 'rgba(0,0,0,0.25)');
    dg.addColorStop(1, 'rgba(0,0,0,0)');
    cg.fillStyle = dg;
    cg.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  // cracks
  cg.strokeStyle = 'rgba(0,0,0,0.6)';
  bg.strokeStyle = 'rgb(30,30,30)';
  for (let k = 0; k < 5; k++) {
    let x = rand() * S;
    let y = rand() * S;
    cg.beginPath();
    bg.beginPath();
    cg.moveTo(x, y);
    bg.moveTo(x, y);
    for (let s = 0; s < 8; s++) {
      x += (rand() - 0.5) * 30;
      y += (rand() - 0.5) * 30;
      cg.lineTo(x, y);
      bg.lineTo(x, y);
    }
    cg.stroke();
    bg.stroke();
  }
  return { map: texture(cc, true), roughnessMap: texture(rc, false), bumpMap: texture(bc, false) };
}

/** Sidewalk slabs: one repeat ≈ 4 m (4 slabs). */
export function pavementMaps(p: NeonPalette, seed = 9): GroundMaps {
  const S = 256;
  const rand = rng(seed);
  const [cc, cg] = canvas(S, S);
  const [rc, rg] = canvas(S, S);
  const [bc, bg] = canvas(S, S);
  const base = mix(p.surface, 0x000000, 0.35);
  const cell = S / 2;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      cg.fillStyle = css(mix(base, rand() < 0.5 ? 0x000000 : 0x8c99a0, rand() * 0.12));
      cg.fillRect(i * cell, j * cell, cell, cell);
    }
  }
  grain(cg, S, S, 6000, 30, 90, rand);
  rg.fillStyle = 'rgb(190,190,190)';
  rg.fillRect(0, 0, S, S);
  bg.fillStyle = 'rgb(150,150,150)';
  bg.fillRect(0, 0, S, S);
  grain(bg, S, S, 6000, 110, 190, rand);
  // joints
  for (const g of [cg, bg]) {
    g.fillStyle = g === cg ? 'rgba(0,0,0,0.7)' : 'rgb(40,40,40)';
    for (let k = 0; k <= 2; k++) {
      g.fillRect(k * cell - 2, 0, 4, S);
      g.fillRect(0, k * cell - 2, S, 4);
    }
  }
  return { map: texture(cc, true), roughnessMap: texture(rc, false), bumpMap: texture(bc, false) };
}

/** A beam: opaque at the lamp (top of the texture), fading out along the cone. */
export function beamTexture(): Texture {
  const [c, g] = canvas(4, 128);
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.25)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}
