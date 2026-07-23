// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Procedural (canvas-drawn) material textures for the 3D warehouse view. No
 * external image assets — everything is generated at runtime so the page stays
 * self-contained, license-free and offline-capable (same rationale as the
 * procedural structures in `wh-plan3d`).
 *
 * All textures are GREYSCALE on a near-white base: the structure material keeps
 * its per-location `color`, which multiplies the texture, so a rack drawn in any
 * colour still shows brushed-metal / slotted-upright detail. Built once per
 * component and disposed on disconnect (see {@link WarehouseTextures.dispose}).
 */
import { CanvasTexture, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';

export interface WarehouseTextures {
  /** Brushed, slotted steel — pallet-rack uprights, feet, decks. */
  steel: Texture;
  /** Horizontally brushed steel — rack beams. */
  beam: Texture;
  /** Galvanised speckled sheet — shelving. */
  shelf: Texture;
  /** Matte ribbed plastic — bins. */
  bin: Texture;
  /** Corrugated cardboard — crates on floor spots. */
  cardboard: Texture;
  /** Planked wood — pallets. */
  wood: Texture;
  /** Mottled concrete with joints — the ground plane. */
  concrete: Texture;
  dispose(): void;
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | undefined {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : undefined;
}

function toTexture(canvas: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  // Shared/cached: owned by the component for its lifetime, NOT disposed on each
  // scene rebuild (see wh-plan3d disposeContent) — only on component teardown.
  texture.userData['shared'] = true;
  return texture;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Brushed steel with a central column of rack-upright slots (drawn vertically). */
function steelTexture(): CanvasTexture {
  const made = makeCanvas(64, 256);
  if (!made) return new CanvasTexture(document.createElement('canvas'));
  const { canvas, ctx } = made;
  ctx.fillStyle = '#c2c6cc';
  ctx.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 130; i++) {
    const x = Math.floor(Math.random() * 64) + 0.5;
    const shade = 150 + Math.floor(Math.random() * 95);
    ctx.strokeStyle = `rgba(${shade},${shade},${shade + 6},0.22)`;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 256);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(45,50,60,0.8)';
  for (let y = 10; y < 256; y += 24) {
    roundRect(ctx, 27, y, 10, 13, 3);
    ctx.fill();
  }
  return toTexture(canvas);
}

/** Horizontally brushed steel with a light top highlight — rack beams. */
function beamTexture(): CanvasTexture {
  const made = makeCanvas(256, 32);
  if (!made) return new CanvasTexture(document.createElement('canvas'));
  const { canvas, ctx } = made;
  ctx.fillStyle = '#d8d8dc';
  ctx.fillRect(0, 0, 256, 32);
  for (let i = 0; i < 90; i++) {
    const y = Math.floor(Math.random() * 32) + 0.5;
    const shade = 170 + Math.floor(Math.random() * 80);
    ctx.strokeStyle = `rgba(${shade},${shade},${shade},0.25)`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(256, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(0, 2, 256, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.fillRect(0, 27, 256, 3);
  return toTexture(canvas);
}

/** Galvanised sheet — light base with a fine dark/light speckle. */
function shelfTexture(): CanvasTexture {
  const made = makeCanvas(128, 128);
  if (!made) return new CanvasTexture(document.createElement('canvas'));
  const { canvas, ctx } = made;
  ctx.fillStyle = '#ccd0d6';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * 128;
    const y = Math.random() * 128;
    const dark = Math.random() > 0.5;
    ctx.fillStyle = dark ? 'rgba(90,95,105,0.20)' : 'rgba(255,255,255,0.22)';
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  return toTexture(canvas);
}

/** Matte plastic with faint horizontal ribs — bins. */
function binTexture(): CanvasTexture {
  const made = makeCanvas(128, 128);
  if (!made) return new CanvasTexture(document.createElement('canvas'));
  const { canvas, ctx } = made;
  ctx.fillStyle = '#d2d2d6';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 6; y < 128; y += 12) {
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0, y, 128, 2);
    ctx.fillStyle = 'rgba(80,80,90,0.12)';
    ctx.fillRect(0, y + 2, 128, 1);
  }
  return toTexture(canvas);
}

/** Corrugated cardboard — horizontal flutes, a seam and a tape strip. */
function cardboardTexture(): CanvasTexture {
  const made = makeCanvas(128, 128);
  if (!made) return new CanvasTexture(document.createElement('canvas'));
  const { canvas, ctx } = made;
  ctx.fillStyle = '#cbc3b6';
  ctx.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 5) {
    ctx.fillStyle = 'rgba(120,100,70,0.16)';
    ctx.fillRect(0, y, 128, 2);
  }
  ctx.strokeStyle = 'rgba(90,70,45,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(3, 3, 122, 122);
  ctx.fillStyle = 'rgba(210,205,190,0.5)';
  ctx.fillRect(0, 58, 128, 12);
  return toTexture(canvas);
}

/** Planked wood — vertical boards with grain streaks (pallets). */
function woodTexture(): CanvasTexture {
  const made = makeCanvas(128, 128);
  if (!made) return new CanvasTexture(document.createElement('canvas'));
  const { canvas, ctx } = made;
  ctx.fillStyle = '#c9bfae';
  ctx.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 200; i++) {
    const y = Math.floor(Math.random() * 128) + 0.5;
    ctx.strokeStyle = `rgba(120,95,65,${Math.random() * 0.12})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(128, y);
    ctx.stroke();
  }
  for (let x = 0; x <= 128; x += 32) {
    ctx.fillStyle = 'rgba(80,60,40,0.4)';
    ctx.fillRect(x - 1, 0, 2, 128);
  }
  return toTexture(canvas);
}

/** Mottled concrete with faint expansion joints — the floor. */
function concreteTexture(): CanvasTexture {
  const made = makeCanvas(256, 256);
  if (!made) return new CanvasTexture(document.createElement('canvas'));
  const { canvas, ctx } = made;
  ctx.fillStyle = '#b9bcc0';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    const radius = 10 + Math.random() * 40;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const dark = Math.random() > 0.5;
    gradient.addColorStop(0, dark ? 'rgba(80,84,90,0.10)' : 'rgba(255,255,255,0.10)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  ctx.strokeStyle = 'rgba(70,74,80,0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(0, 0, 256, 256);
  return toTexture(canvas);
}

/** Build the full texture set. Call {@link WarehouseTextures.dispose} on teardown. */
export function createWarehouseTextures(): WarehouseTextures {
  const steel = steelTexture();
  const beam = beamTexture();
  const shelf = shelfTexture();
  const bin = binTexture();
  const cardboard = cardboardTexture();
  const wood = woodTexture();
  const concrete = concreteTexture();
  return {
    steel,
    beam,
    shelf,
    bin,
    cardboard,
    wood,
    concrete,
    dispose(): void {
      for (const texture of [steel, beam, shelf, bin, cardboard, wood, concrete]) texture.dispose();
    }
  };
}
