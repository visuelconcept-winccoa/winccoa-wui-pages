// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Street life of City Drive (#79), in the style of a Japanese city street at night:
 * shopfronts at the foot of the buildings (lit interior, awning), vertical signboards
 * (Japanese names written top to bottom), red paper lanterns, lit vending machines, concrete
 * utility poles with sagging overhead wires, street lights with a curved arm and an LED head
 * casting a warm pool of light, and pedestrians walking along the sidewalks.
 *
 * Instanced wherever an object repeats; only the pedestrians move ({@link StreetLife.update}).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CapsuleGeometry,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TubeGeometry,
  Vector3,
  type Material
} from 'three';
import { CELL, ROAD_WIDTH, SIDEWALK, rng, roadAxis, type Building, type City } from './city.js';
import type { NeonPalette } from './palette.js';

/** Shop names in Japanese, written top to bottom (ramen, sushi, café, bar, hotel, karaoke, bookshop, izakaya, games, tea, udon, yakitori). */
const SHOP_NAMES = ['ラーメン', '寿司', 'カフェ', 'バー', 'ホテル', 'カラオケ', '本屋', '居酒屋', 'ゲーム', 'お茶', 'うどん', '焼鳥'];
/** Japanese fonts available on Windows, macOS and Linux, in that order. */
const JP_FONTS = '"Yu Gothic", "Meiryo", "Hiragino Sans", "Noto Sans JP", "IPAGothic", "WenQuanYi Zen Hei", sans-serif';
const ROAD_EDGE = ROAD_WIDTH / 2;
const LIGHT_STEP = 26;
const POLE_STEP = 32;
const WALKERS = 170;
const WALK_SPEED = 1.3;

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** A vertical signboard: the name written top to bottom in neon on a dark board. */
function signTexture(name: string, color: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 512;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#07090b';
  g.fillRect(0, 0, 128, 512);
  g.strokeStyle = css(color);
  g.lineWidth = 6;
  g.strokeRect(6, 6, 116, 500);
  const letters = [...name];
  const step = Math.min(84, 470 / letters.length);
  g.font = `700 ${Math.round(step * 0.78)}px ${JP_FONTS}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  letters.forEach((ch, k) => {
    const y = 256 - (letters.length * step) / 2 + step * (k + 0.5);
    g.shadowColor = css(color);
    g.shadowBlur = 16;
    // in vertical writing the long-vowel mark ー stands upright
    const upright = ch === 'ー';
    g.save();
    g.translate(64, y);
    if (upright) g.rotate(Math.PI / 2);
    g.fillStyle = css(color);
    g.fillText(ch, 0, 0);
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(ch, 0, 0);
    g.restore();
  });
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** A shop interior seen through the glass: warm light, shelves, a counter. */
function shopTexture(seed: number): CanvasTexture {
  const rand = rng(seed);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const warm = rand() < 0.6;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, warm ? '#fff1d6' : '#e6f6ff');
  grad.addColorStop(1, warm ? '#b07a3e' : '#5d8aa3');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 128);
  // shelves and goods
  for (let y = 30; y < 100; y += 22) {
    g.fillStyle = 'rgba(40,30,20,0.55)';
    g.fillRect(8, y, 240, 3);
    for (let x = 12; x < 244; x += 6 + rand() * 8) {
      g.fillStyle = `hsl(${Math.floor(rand() * 360)},55%,${40 + rand() * 25}%)`;
      g.fillRect(x, y - 4 - rand() * 10, 4, 14);
    }
  }
  // window frames
  g.fillStyle = 'rgba(10,10,10,0.85)';
  for (let x = 0; x <= 256; x += 64) g.fillRect(x - 2, 0, 4, 128);
  g.fillRect(0, 0, 256, 6);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft round pool of light for the ground under a street light. */
function poolTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,0.9)');
  r.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Walker {
  /** Block whose sidewalk it walks around. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Position along the perimeter (m) and direction. */
  s: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
}

/** A point on a block's sidewalk loop at distance `s` (perimeter of the box). */
function perimeterPoint(w: Walker, s: number): { x: number; z: number; heading: number } {
  const W = w.x1 - w.x0;
  const D = w.z1 - w.z0;
  const P = 2 * (W + D);
  let t = ((s % P) + P) % P;
  if (t < W) return { x: w.x0 + t, z: w.z0, heading: Math.PI / 2 };
  t -= W;
  if (t < D) return { x: w.x1, z: w.z0 + t, heading: 0 };
  t -= D;
  if (t < W) return { x: w.x1 - t, z: w.z1, heading: -Math.PI / 2 };
  t -= W;
  return { x: w.x0, z: w.z1 - t, heading: Math.PI };
}

export class StreetLife {
  readonly group = new Group();
  private readonly walkers: Walker[] = [];
  private readonly bodies: InstancedMesh;
  private readonly heads: InstancedMesh;
  private readonly o = new Object3D();
  /** What only shows at night: the pools of light under the street lights. */
  private readonly nightOnly: Object3D[] = [];

  constructor(
    private readonly city: City,
    private readonly p: NeonPalette
  ) {
    this.buildStreetLights();
    this.buildUtilityPoles();
    this.buildShops();
    const body = new CapsuleGeometry(0.24, 0.9, 4, 10);
    const bodyMat = new MeshStandardMaterial({ roughness: 0.8 });
    this.bodies = new InstancedMesh(body, bodyMat, WALKERS);
    this.heads = new InstancedMesh(new SphereGeometry(0.17, 12, 10), new MeshStandardMaterial({ color: 0xd9b49a, roughness: 0.7 }), WALKERS);
    this.bodies.castShadow = true;
    this.spawnWalkers();
    this.group.add(this.bodies, this.heads);
    this.update(0);
  }

  // --- street lights ------------------------------------------------------------------

  /** Street lights along both sides of every road: pole, curved arm, LED head, pool of light. */
  private buildStreetLights(): void {
    const spots: { x: number; z: number; ry: number }[] = [];
    const n = this.city.blocks;
    const off = ROAD_EDGE + 0.7;
    for (let k = 0; k <= n; k++) {
      const a = roadAxis(k);
      for (let s = CELL * 0.18; s < this.city.size; s += LIGHT_STEP) {
        if (Math.abs(((s + CELL / 2) % CELL) - CELL / 2) < ROAD_EDGE + 4) continue; // not in a crossroads
        const side = Math.round(s / LIGHT_STEP) % 2 ? 1 : -1;
        spots.push({ x: a + side * off, z: s, ry: side > 0 ? -Math.PI / 2 : Math.PI / 2 });
        spots.push({ x: s, z: a + side * off, ry: side > 0 ? Math.PI : 0 });
      }
    }
    // one light's geometry: pole + arm curving over the road + flat head
    const H = 8.5;
    const arm = new CatmullRomCurve3([new Vector3(0, H - 1.2, 0), new Vector3(0, H, 0.5), new Vector3(0, H + 0.2, 1.8), new Vector3(0, H + 0.1, 2.8)]);
    const poleMat = new MeshStandardMaterial({ color: 0x5d666b, metalness: 0.7, roughness: 0.45 });
    const pole = new InstancedMesh(new CylinderGeometry(0.09, 0.13, H - 1.2, 10), poleMat, spots.length);
    const arms = new InstancedMesh(new TubeGeometry(arm, 16, 0.07, 8, false), poleMat, spots.length);
    const headGeo = new BoxGeometry(0.42, 0.12, 0.9);
    const heads = new InstancedMesh(headGeo, poleMat, spots.length);
    const ledMat = new MeshBasicMaterial({ color: 0xfff1d8, toneMapped: false });
    ledMat.color.multiplyScalar(2.2);
    const leds = new InstancedMesh(new PlaneGeometry(0.34, 0.8), ledMat, spots.length);
    const pools = new InstancedMesh(
      new PlaneGeometry(10, 10),
      new MeshBasicMaterial({ map: poolTexture(), color: 0xffd7a8, transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false }),
      spots.length
    );
    spots.forEach((sp, k) => {
      const place = (mesh: InstancedMesh, x: number, y: number, z: number, rx = 0): void => {
        this.o.position.set(sp.x, 0, sp.z);
        this.o.rotation.set(0, sp.ry, 0);
        this.o.updateMatrix();
        const base = this.o.matrix.clone();
        this.o.position.set(x, y, z);
        this.o.rotation.set(rx, 0, 0);
        this.o.updateMatrix();
        mesh.setMatrixAt(k, base.multiply(this.o.matrix));
      };
      place(pole, 0, (H - 1.2) / 2, 0);
      place(arms, 0, 0, 0);
      place(heads, 0, H + 0.08, 2.9);
      place(leds, 0, H + 0.01, 2.9, Math.PI / 2);
      place(pools, 0, 0.06, 3.2, -Math.PI / 2);
    });
    for (const m of [pole, arms, heads]) m.castShadow = true;
    this.nightOnly.push(pools);
    this.group.add(pole, arms, heads, leds, pools);
  }

  // --- utility poles --------------------------------------------------------------------

  /** Concrete poles with a crossarm on one side of each road, and their sagging wires. */
  private buildUtilityPoles(): void {
    const n = this.city.blocks;
    const H = 11;
    const off = ROAD_EDGE + SIDEWALK - 0.6;
    const poles: { x: number; z: number; alongZ: boolean }[] = [];
    const wires: number[] = [];
    const sag = (a: Vector3, b: Vector3): void => {
      const seg = 8;
      for (let k = 0; k < seg; k++) {
        const t0 = k / seg;
        const t1 = (k + 1) / seg;
        const y = (t: number): number => -1.1 * 4 * t * (1 - t);
        wires.push(a.x + (b.x - a.x) * t0, a.y + y(t0), a.z + (b.z - a.z) * t0, a.x + (b.x - a.x) * t1, a.y + y(t1), a.z + (b.z - a.z) * t1);
      }
    };
    for (let k = 0; k <= n; k++) {
      const a = roadAxis(k) - off;
      let prev: { x: number; z: number } | null = null;
      for (let s = 6; s <= this.city.size - 6; s += POLE_STEP) {
        if (Math.abs(((s + CELL / 2) % CELL) - CELL / 2) < ROAD_EDGE + 3) {
          prev = null;
          continue;
        }
        poles.push({ x: a, z: s, alongZ: true });
        if (prev) for (const dx of [-0.8, 0, 0.8]) sag(new Vector3(prev.x + dx, H - 0.6, prev.z), new Vector3(a + dx, H - 0.6, s));
        prev = { x: a, z: s };
      }
    }
    const mat = new MeshStandardMaterial({ color: 0x8b8e8c, roughness: 0.85 });
    const pole = new InstancedMesh(new CylinderGeometry(0.14, 0.2, H, 10), mat, poles.length);
    const cross = new InstancedMesh(new BoxGeometry(2, 0.12, 0.12), mat, poles.length);
    const box = new InstancedMesh(new CylinderGeometry(0.28, 0.28, 0.7, 10), new MeshStandardMaterial({ color: 0x3b4044, roughness: 0.6 }), poles.length);
    poles.forEach((pl, k) => {
      this.o.rotation.set(0, 0, 0);
      this.o.position.set(pl.x, H / 2, pl.z);
      this.o.updateMatrix();
      pole.setMatrixAt(k, this.o.matrix);
      this.o.position.set(pl.x, H - 0.6, pl.z);
      this.o.updateMatrix();
      cross.setMatrixAt(k, this.o.matrix);
      this.o.position.set(pl.x + 0.35, H - 2.2, pl.z);
      this.o.updateMatrix();
      box.setMatrixAt(k, this.o.matrix); // pole transformer
    });
    pole.castShadow = true;
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(wires, 3));
    this.group.add(pole, cross, box, new LineSegments(g, new LineBasicMaterial({ color: 0x1a1d1f })));
  }

  // --- shops ----------------------------------------------------------------------------

  /** The street-facing faces of a building: centre, outward normal, width. */
  private streetFaces(b: Building): { x: number; z: number; nx: number; nz: number; width: number }[] {
    const faces = [
      { x: b.x0, z: (b.z0 + b.z1) / 2, nx: -1, nz: 0, width: b.z1 - b.z0 },
      { x: b.x1, z: (b.z0 + b.z1) / 2, nx: 1, nz: 0, width: b.z1 - b.z0 },
      { x: (b.x0 + b.x1) / 2, z: b.z0, nx: 0, nz: -1, width: b.x1 - b.x0 },
      { x: (b.x0 + b.x1) / 2, z: b.z1, nx: 0, nz: 1, width: b.x1 - b.x0 }
    ];
    const near = (v: number): number => Math.abs(v - Math.round(v / CELL) * CELL);
    return faces.filter((f) => (f.nx !== 0 ? near(f.x) : near(f.z)) < ROAD_EDGE + SIDEWALK + 8);
  }

  private buildShops(): void {
    const rand = rng(this.city.seed * 31 + 5);
    const interiors = [1, 2, 3, 4, 5].map((k) => new MeshBasicMaterial({ map: shopTexture(k * 97), toneMapped: false }));
    const neonColors = [this.p.primary, this.p.dynamic, this.p.warning, this.p.alarm, this.p.success, this.p.info, 0xff5fd2];
    const signMats = SHOP_NAMES.map((name, k) => new MeshBasicMaterial({ map: signTexture(name, neonColors[k % neonColors.length]), toneMapped: false, side: DoubleSide }));
    const awningMats = [0x9b1b30, 0x1f4e79, 0x2f6b3a, 0x3a3a3a, 0x7a5a12].map((c) => new MeshStandardMaterial({ color: c, roughness: 0.8, side: DoubleSide }));
    // every repeated part is collected as a matrix per material, then drawn instanced
    const glass = interiors.map(() => [] as Matrix4[]);
    const awnings = awningMats.map(() => [] as Matrix4[]);
    const signs = signMats.map(() => [] as Matrix4[]);
    const backs: Matrix4[] = [];
    const lanternSpots: { x: number; y: number; z: number }[] = [];
    const vending: { x: number; z: number; ry: number }[] = [];
    const m = (x: number, y: number, z: number, ry: number, rx: number, sx: number, sy: number, sz = 1): Matrix4 => {
      this.o.position.set(x, y, z);
      this.o.rotation.set(rx, ry, 0, 'YXZ');
      this.o.scale.set(sx, sy, sz);
      this.o.updateMatrix();
      return this.o.matrix.clone();
    };
    const up = new Vector3(0, 1, 0);
    for (const b of this.city.buildings) {
      if (b.machine) continue;
      for (const f of this.streetFaces(b)) {
        if (rand() < 0.15) continue;
        const ry = Math.atan2(f.nx, f.nz);
        const ox = f.x + f.nx * 0.06;
        const oz = f.z + f.nz * 0.06;
        const at = (lx: number, ly: number, lz: number): Vector3 => new Vector3(lx, ly, lz).applyAxisAngle(up, ry).add(new Vector3(ox, 0, oz));
        const w = Math.min(f.width - 2, 10 + rand() * 6);
        const g = at(0, 1.65, 0);
        glass[Math.floor(rand() * glass.length)].push(m(g.x, g.y, g.z, ry, 0, w, 2.8));
        const a = at(0, 3.45, 0.62);
        awnings[Math.floor(rand() * awnings.length)].push(m(a.x, a.y, a.z, ry, -Math.PI / 2 + 0.45, w + 0.4, 1.5));
        // a vertical signboard, perpendicular to the facade, above the awning
        if (rand() < 0.75) {
          // large vertical signboards, standing out from the facade
          const h = 9 + rand() * 5;
          const s = at((w / 2 - 0.6) * (rand() < 0.5 ? -1 : 1), 4.2 + h / 2, 1.45);
          const across = ry + Math.PI / 2;
          backs.push(m(s.x, s.y, s.z, across, 0, 2.5, h + 0.2, 0.3));
          const k = Math.floor(rand() * signs.length);
          const n = new Vector3(0, 0, 0.17).applyAxisAngle(up, across);
          signs[k].push(m(s.x + n.x, s.y, s.z + n.z, across, 0, 2.3, h));
          signs[k].push(m(s.x - n.x, s.y, s.z - n.z, across + Math.PI, 0, 2.3, h));
        }
        // red paper lanterns at izakaya-like shops
        if (rand() < 0.45) {
          for (const lx of [-w / 2 + 0.6, w / 2 - 0.6]) {
            const v = at(lx, 2.9, 0.45);
            lanternSpots.push({ x: v.x, y: v.y, z: v.z });
          }
        }
        if (rand() < 0.22) {
          const v = at(w / 2 + 0.7, 0, 0.6);
          vending.push({ x: v.x, z: v.z, ry });
        }
      }
    }
    const plane = new PlaneGeometry(1, 1);
    const instanced = (geo: BufferGeometry, mat: Material, mats: Matrix4[], shadow = false): void => {
      if (mats.length === 0) return;
      const im = new InstancedMesh(geo, mat, mats.length);
      mats.forEach((mx, k) => im.setMatrixAt(k, mx));
      im.castShadow = shadow;
      this.group.add(im);
    };
    glass.forEach((mats, k) => instanced(plane, interiors[k], mats));
    awnings.forEach((mats, k) => instanced(plane, awningMats[k], mats, true));
    signs.forEach((mats, k) => instanced(plane, signMats[k], mats));
    instanced(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0x0b0d0e }), backs);
    this.buildLanterns(lanternSpots);
    this.buildVending(vending);
  }

  private buildLanterns(spots: { x: number; y: number; z: number }[]): void {
    if (spots.length === 0) return;
    const red = new MeshBasicMaterial({ color: 0xff3b2f, toneMapped: false });
    red.color.multiplyScalar(1.4);
    const lantern = new InstancedMesh(new SphereGeometry(0.32, 14, 10), red, spots.length);
    const caps = new InstancedMesh(new CylinderGeometry(0.2, 0.2, 0.08, 12), new MeshStandardMaterial({ color: 0x111111 }), spots.length * 2);
    spots.forEach((s, k) => {
      this.o.rotation.set(0, 0, 0);
      this.o.scale.set(1, 1.35, 1);
      this.o.position.set(s.x, s.y, s.z);
      this.o.updateMatrix();
      lantern.setMatrixAt(k, this.o.matrix);
      this.o.scale.set(1, 1, 1);
      for (const [c, dy] of [[0, 0.45], [1, -0.45]] as const) {
        this.o.position.set(s.x, s.y + dy, s.z);
        this.o.updateMatrix();
        caps.setMatrixAt(k * 2 + c, this.o.matrix);
      }
    });
    this.group.add(lantern, caps);
  }

  private buildVending(spots: { x: number; z: number; ry: number }[]): void {
    if (spots.length === 0) return;
    const box = new InstancedMesh(new BoxGeometry(1, 1.85, 0.75), new MeshStandardMaterial({ color: 0xe9eef0, roughness: 0.4, metalness: 0.2 }), spots.length);
    const front = new MeshBasicMaterial({ color: 0xcfeaff, toneMapped: false });
    front.color.multiplyScalar(1.3);
    const panel = new InstancedMesh(new PlaneGeometry(0.8, 1.1), front, spots.length);
    spots.forEach((s, k) => {
      this.o.scale.set(1, 1, 1);
      this.o.rotation.set(0, s.ry, 0);
      this.o.position.set(s.x, 0.93 + 0.25, s.z);
      this.o.updateMatrix();
      box.setMatrixAt(k, this.o.matrix);
      const v = new Vector3(0, 0, 0.38).applyAxisAngle(new Vector3(0, 1, 0), s.ry);
      this.o.position.set(s.x + v.x, 1.45, s.z + v.z);
      this.o.updateMatrix();
      panel.setMatrixAt(k, this.o.matrix);
    });
    box.castShadow = true;
    this.group.add(box, panel);
  }

  // --- pedestrians ------------------------------------------------------------------------

  private spawnWalkers(): void {
    const rand = rng(this.city.seed * 7 + 3);
    const walk = ROAD_EDGE + 1.6;
    const colors = [0x22262a, 0x3b3f44, 0x5a3e2b, 0x1f3550, 0x7a1f2b, 0xd0d4d6, 0x2f4f3a, 0x6b5b95];
    const blocks = this.city.blockList;
    for (let k = 0; k < WALKERS; k++) {
      const b = blocks[Math.floor(rand() * blocks.length)];
      const i = b.i;
      const j = b.j;
      this.walkers.push({
        x0: roadAxis(i) + walk,
        z0: roadAxis(j) + walk,
        x1: roadAxis(i + 1) - walk,
        z1: roadAxis(j + 1) - walk,
        s: rand() * 4 * CELL,
        dir: rand() < 0.5 ? 1 : -1,
        speed: WALK_SPEED * (0.7 + rand() * 0.6),
        phase: rand() * 10
      });
      this.bodies.setColorAt(k, new Color(colors[Math.floor(rand() * colors.length)]));
    }
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
  }

  /** Day or night: the street lights' pools only at night. */
  setDay(day: boolean): void {
    for (const o of this.nightOnly) o.visible = !day;
  }

  /** Moves the pedestrians by `dt` seconds. */
  update(dt: number): void {
    this.walkers.forEach((w, k) => {
      w.s += w.dir * w.speed * dt;
      w.phase += dt * w.speed * 5;
      const pt = perimeterPoint(w, w.s);
      const bob = Math.abs(Math.sin(w.phase)) * 0.05;
      this.o.scale.set(1, 1, 1);
      this.o.rotation.set(0, pt.heading + (w.dir < 0 ? Math.PI : 0), Math.sin(w.phase) * 0.04);
      this.o.position.set(pt.x, 0.72 + bob, pt.z);
      this.o.updateMatrix();
      this.bodies.setMatrixAt(k, this.o.matrix);
      this.o.position.set(pt.x, 1.55 + bob, pt.z);
      this.o.updateMatrix();
      this.heads.setMatrixAt(k, this.o.matrix);
    });
    this.bodies.instanceMatrix.needsUpdate = true;
    this.heads.instanceMatrix.needsUpdate = true;
  }
}
