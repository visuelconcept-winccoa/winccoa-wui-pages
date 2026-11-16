// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The car models of City Drive (#79): a side profile extruded across the width and bevelled
 * (long hood, trunk, Cadillac-style tail fins), clear-coated paint, tinted greenhouse, chrome
 * grille and bumpers, whitewall tyres on chrome rims, vertical tail lights in the fins, and the
 * neon of the game: a light strip along each sill and its glow on the ground, on both sides only.
 *
 * Car frame: +Z forward, Y up, the ground at y = 0.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CapsuleGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  SRGBColorSpace,
  TorusGeometry,
  type Material
} from 'three';
import type { Body } from './vehicles.js';

export interface CarLook {
  /** Paint colour. */
  paint: number;
  /** Neon colour: sill strips and under-glow. */
  glow: number;
  /** Tail light colour. */
  tail: number;
  /** Registration, Eisenstadt style (`E` district): `WINCCOA 1`, `482 KT`… */
  plate?: string;
}

const PLATES = new Map<string, CanvasTexture>();

/**
 * An Austrian number plate from Eisenstadt, the cradle of WinCC OA: white, red-white-red bands
 * at the top and bottom, the EU strip with `A`, the district `E`, the coat of arms of
 * Burgenland, then the registration.
 */
export function plateTexture(text: string): CanvasTexture {
  const cached = PLATES.get(text);
  if (cached) return cached;
  const W = 520;
  const H = 120;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  // red-white-red bands
  g.fillStyle = '#c8102e';
  g.fillRect(0, 0, W, 9);
  g.fillRect(0, H - 9, W, 9);
  // EU strip: blue, ring of stars, A
  g.fillStyle = '#003399';
  g.fillRect(0, 9, 46, H - 18);
  g.fillStyle = '#ffcc00';
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.beginPath();
    g.arc(23 + Math.cos(a) * 12, 42 + Math.sin(a) * 12, 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ffffff';
  g.font = '700 26px Arial, Helvetica, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('A', 23, 88);
  // district E
  g.fillStyle = '#111111';
  g.font = '700 78px "DIN 1451", "Arial Narrow", Arial, sans-serif';
  g.textAlign = 'left';
  g.fillText('E', 60, 63);
  // coat of arms of Burgenland: a gold shield with a red field
  const sx = 118;
  g.fillStyle = '#d4a017';
  g.beginPath();
  g.moveTo(sx, 30);
  g.lineTo(sx + 30, 30);
  g.lineTo(sx + 30, 66);
  g.quadraticCurveTo(sx + 15, 92, sx, 66);
  g.closePath();
  g.fill();
  g.fillStyle = '#c8102e';
  g.fillRect(sx + 7, 38, 16, 20);
  g.strokeStyle = '#111111';
  g.lineWidth = 2;
  g.stroke();
  // registration, condensed to fit
  g.fillStyle = '#111111';
  g.font = '700 78px "DIN 1451", "Arial Narrow", Arial, sans-serif';
  const room = W - 166 - 14;
  const width = g.measureText(text).width;
  g.save();
  g.translate(166, 63);
  if (width > room) g.scale(room / width, 1);
  g.fillText(text, 0, 0);
  g.restore();
  // black rim
  g.strokeStyle = '#111111';
  g.lineWidth = 4;
  g.strokeRect(2, 2, W - 4, H - 4);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  PLATES.set(text, t);
  return t;
}

const CLEARANCE = 0.32;
/** Bevel of the lower body: it pushes the outline out by this much all around. */
const BODY_BEVEL = 0.16;

/** Shared materials (one set per look would be wasteful: only the paint and glow change). */
const CHROME = new MeshStandardMaterial({ color: 0xd8dde0, metalness: 1, roughness: 0.12 });
const RUBBER = new MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.9 });
const WHITEWALL = new MeshStandardMaterial({ color: 0xe9ecec, roughness: 0.6 });
const GLASS = new MeshPhysicalMaterial({ color: 0x0b1418, metalness: 0.2, roughness: 0.05, transmission: 0, clearcoat: 1, opacity: 0.92, transparent: true });
const HEAD = new MeshBasicMaterial({ color: 0xf4fbff, toneMapped: false });
const PLATE_LAMP = new MeshBasicMaterial({ color: 0x8a8a8a, toneMapped: false }); // dim: no bloom over the plate

/** A soft strip: bright in the middle of its width, fading out at both edges and ends. */
function sideGlowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const across = g.createLinearGradient(0, 0, 64, 0);
  across.addColorStop(0, 'rgba(255,255,255,0)');
  across.addColorStop(0.5, 'rgba(255,255,255,1)');
  across.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = across;
  g.fillRect(0, 0, 64, 256);
  g.globalCompositeOperation = 'destination-in';
  const along = g.createLinearGradient(0, 0, 0, 256);
  along.addColorStop(0, 'rgba(0,0,0,0)');
  along.addColorStop(0.2, 'rgba(0,0,0,1)');
  along.addColorStop(0.8, 'rgba(0,0,0,1)');
  along.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = along;
  g.fillRect(0, 0, 64, 256);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

const SIDE_GLOW = sideGlowTexture();

/** The side profile (z along the car, y up) of the lower body, up to the belt line. */
function lowerProfile(b: Body): Shape {
  const L = b.l / 2;
  const belt = CLEARANCE + b.h;
  const low = CLEARANCE + 0.08;
  const s = new Shape();
  s.moveTo(-L + 0.25, low);
  // rounded rear bumper
  s.quadraticCurveTo(-L, low, -L, low + 0.25);
  if (b.fins) {
    // tail fin: sweeps up above the deck at the very back, then down into a long trunk
    s.bezierCurveTo(-L, belt - 0.1, -L + 0.05, belt + 0.2, -L + 0.25, belt + 0.2);
    s.bezierCurveTo(-L + 0.8, belt + 0.12, -L + 1.2, belt + 0.02, -L + 1.7, belt);
  } else {
    s.bezierCurveTo(-L, belt - 0.05, -L + 0.15, belt, -L + 0.5, belt);
  }
  // long flat waist, a slight crown over the front wheels
  s.bezierCurveTo(-L * 0.2, belt + 0.03, L * 0.35, belt + 0.03, L - 0.9, belt - 0.04);
  // hood curving down to the nose
  s.bezierCurveTo(L - 0.4, belt - 0.07, L, belt - 0.15, L, belt - 0.4);
  s.quadraticCurveTo(L, low, L - 0.25, low);
  s.closePath();
  return s;
}

/** The greenhouse (cabin glass) profile, between belt line and roof: curved roof and screens. */
function cabinProfile(b: Body): Shape {
  const belt = CLEARANCE + b.h;
  const roof = belt + b.cabinH;
  const half = b.cabinL / 2;
  const c = b.cabinZ;
  const s = new Shape();
  s.moveTo(c - half - 0.6, belt);
  // rear window, curving into the roof
  s.bezierCurveTo(c - half - 0.25, belt + b.cabinH * 0.5, c - half - 0.1, roof, c - half + 0.3, roof);
  s.lineTo(c + half - 0.4, roof);
  // raked, curved windscreen
  s.bezierCurveTo(c + half + 0.1, roof, c + half + 0.45, belt + b.cabinH * 0.35, c + half + 0.85, belt);
  s.closePath();
  return s;
}

/**
 * Extrudes a profile across the width, bevelled, then pulls the upper part of the sides in
 * (tumblehome): `taper` is the fraction of the half-width lost at the top of the shape.
 */
function extrude(shape: Shape, width: number, mat: Material | Material[], bevel: number, taper: number, y0: number, y1: number): Mesh {
  const geo = new ExtrudeGeometry(shape, { depth: width - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 5, curveSegments: 28 });
  // -90° about Y: the shape's x (along the car) stays +Z, the extrusion goes to -X
  geo.rotateY(-Math.PI / 2);
  geo.translate((width - 2 * bevel) / 2, 0, 0);
  const pos = geo.getAttribute('position');
  for (let k = 0; k < pos.count; k++) {
    const t = Math.min(1, Math.max(0, (pos.getY(k) - y0) / (y1 - y0)));
    // smooth: the sides stay vertical low down and curve in near the top
    pos.setX(k, pos.getX(k) * (1 - taper * t * t));
  }
  geo.computeVertexNormals();
  const m = new Mesh(geo, mat);
  m.castShadow = true;
  return m;
}

function wheel(radius: number, width: number): Group {
  const g = new Group();
  const tyre = new Mesh(new CylinderGeometry(radius, radius, width, 24), RUBBER);
  tyre.rotation.z = Math.PI / 2;
  const rimGeo = new CylinderGeometry(radius * 0.55, radius * 0.55, width + 0.02, 20);
  const rim = new Mesh(rimGeo, CHROME);
  rim.rotation.z = Math.PI / 2;
  const wall = new Mesh(new TorusGeometry(radius * 0.75, radius * 0.1, 8, 24), WHITEWALL);
  wall.rotation.y = Math.PI / 2;
  wall.position.x = width / 2 + 0.005;
  const wall2 = wall.clone();
  wall2.position.x = -wall.position.x;
  tyre.castShadow = true;
  g.add(tyre, rim, wall, wall2);
  return g;
}

/** A complete car for a body and a look. */
export function buildCar(b: Body, look: CarLook): Group {
  const g = new Group();
  const paint = new MeshPhysicalMaterial({ color: look.paint, metalness: 0.65, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 });
  const L = b.l / 2;
  const belt = CLEARANCE + b.h;

  g.add(extrude(lowerProfile(b), b.w, paint, BODY_BEVEL, 0.1, CLEARANCE + b.h * 0.45, belt + 0.2));
  if (b.cabinH > 0.05) {
    const glass = extrude(cabinProfile(b), b.w * 0.9, GLASS, 0.1, 0.22, belt, belt + b.cabinH);
    // painted roof skin: the top of the greenhouse, slightly proud of the glass
    const roof = extrude(cabinProfile({ ...b, cabinL: b.cabinL - 0.5 }), b.w * 0.74, paint, 0.08, 0.05, belt + b.cabinH * 0.7, belt + b.cabinH);
    roof.position.y = 0.035;
    g.add(glass, roof);
  }
  // wheel arches: dark half-rings over the wheels, flush with the sides
  const archMat = new MeshStandardMaterial({ color: 0x050607, roughness: 0.9 });
  for (const z of [L - Math.max(0.85, b.l * 0.16), -L + Math.max(0.9, b.l * 0.17)]) {
    for (const sx of [-b.w / 2 + 0.02, b.w / 2 - 0.02]) {
      const arch = new Mesh(new CylinderGeometry(0.5, 0.5, 0.06, 24, 1, false, 0, Math.PI), archMat);
      arch.rotation.z = Math.PI / 2; // axis across the car, the half-ring on top
      arch.position.set(sx, 0.4, z);
      g.add(arch);
    }
  }
  if (b.bed) {
    // pickup bed: the walls stand on the rear deck
    const wallMat = paint;
    for (const sx of [-b.w / 2 + 0.08, b.w / 2 - 0.08]) {
      const side = new Mesh(new BoxGeometry(0.12, 0.4, b.bed), wallMat);
      side.position.set(sx, belt + 0.18, -L + b.bed / 2 + 0.15);
      g.add(side);
    }
    const gate = new Mesh(new BoxGeometry(b.w - 0.1, 0.4, 0.12), wallMat);
    gate.position.set(0, belt + 0.18, -L + 0.2);
    g.add(gate);
  }

  // chrome: grille, bumpers, side trim
  const grille = new Mesh(new BoxGeometry(b.w * 0.62, 0.32, 0.06), CHROME);
  grille.position.set(0, belt - 0.42, L + BODY_BEVEL + 0.01);
  const bumperF = new Mesh(new CapsuleGeometry(0.08, b.w * 0.9, 6, 16), CHROME);
  bumperF.rotation.z = Math.PI / 2;
  bumperF.position.set(0, CLEARANCE + 0.2, L + BODY_BEVEL + 0.04);
  const bumperR = bumperF.clone();
  bumperR.position.z = -L - BODY_BEVEL - 0.04;
  const trimGeo = new BoxGeometry(0.03, 0.04, b.l * 0.78);
  for (const sx of [-b.w / 2 - 0.005, b.w / 2 + 0.005]) {
    const trim = new Mesh(trimGeo, CHROME);
    trim.position.set(sx, belt - 0.22, 0.1);
    g.add(trim);
  }
  g.add(grille, bumperF, bumperR);

  // lights
  const tail = new MeshBasicMaterial({ color: look.tail, toneMapped: false });
  for (const sx of [-b.w * 0.36, b.w * 0.36]) {
    const head = new Mesh(new CylinderGeometry(0.13, 0.13, 0.05, 16), HEAD);
    head.rotation.x = Math.PI / 2;
    head.position.set(sx, belt - 0.32, L + BODY_BEVEL + 0.02);
    // vertical tail light, in the fin when there is one
    const t = new Mesh(new BoxGeometry(0.1, b.fins ? 0.42 : 0.2, 0.05), tail);
    t.position.set(Math.sign(sx) * (b.w / 2 - 0.12), b.fins ? belt - 0.02 : belt - 0.3, -L - BODY_BEVEL - 0.02);
    g.add(head, t);
  }

  // number plates, front and rear, lit by their plate lamps: readable at night, kept below
  // the bloom threshold so the characters stay sharp
  if (look.plate) {
    const plateMat = new MeshBasicMaterial({ map: plateTexture(look.plate), toneMapped: false });
    plateMat.color.setScalar(0.5);
    const geo = new PlaneGeometry(0.72, 0.166);
    const front = new Mesh(geo, plateMat);
    // on the outer surface: the profile, plus the bevel, plus a few millimetres
    const skin = L + BODY_BEVEL + 0.03;
    front.position.set(0, CLEARANCE + 0.36, skin);
    const rear = new Mesh(geo, plateMat);
    rear.position.set(0, belt - 0.26, -skin);
    rear.rotation.y = Math.PI;
    // plate lamp: a small white strip above the rear plate, and its glow on the plate
    const lamp = new Mesh(new BoxGeometry(0.22, 0.02, 0.04), PLATE_LAMP);
    lamp.position.set(0, rear.position.y + 0.13, -skin + 0.01);
    g.add(front, rear, lamp);
  }

  // wheels
  const r = 0.4;
  const axleF = L - Math.max(0.85, b.l * 0.16);
  const axleR = -L + Math.max(0.9, b.l * 0.17);
  for (const z of [axleF, axleR]) {
    for (const sx of [-b.w / 2 + 0.12, b.w / 2 - 0.12]) {
      const w = wheel(r, 0.28);
      w.position.set(sx, r, z);
      g.add(w);
    }
  }

  // neon: sill strips and under-glow
  const glowMat = new MeshBasicMaterial({ color: look.glow, toneMapped: false });
  glowMat.color.multiplyScalar(1.6);
  for (const sx of [-b.w / 2 - 0.01, b.w / 2 + 0.01]) {
    const strip = new Mesh(new BoxGeometry(0.03, 0.05, b.l * 0.62), glowMat);
    strip.position.set(sx, CLEARANCE + 0.07, 0);
    g.add(strip);
  }
  // under-glow: one soft strip on the ground along each side, not under the whole car
  const glowGround = new MeshBasicMaterial({
    color: look.glow,
    map: SIDE_GLOW,
    transparent: true,
    opacity: 0.85,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide
  });
  for (const sx of [-1, 1]) {
    const strip = new Mesh(new PlaneGeometry(1.1, b.l * 0.78), glowGround);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(sx * (b.w / 2 - 0.05), 0.05, 0);
    g.add(strip);
  }
  return g;
}

/** Height of the headlights (for the beams and spot lights). */
export const headlightY = (b: Body): number => CLEARANCE + b.h - 0.32;
