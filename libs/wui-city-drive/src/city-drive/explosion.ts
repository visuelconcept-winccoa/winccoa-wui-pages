// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The logo tokens of the logo hunt and their explosion (#79).
 *
 * - token: a spinning neon disc with the WinCC OA wordmark, floating over the road, a glow ring
 *   on the asphalt and a faint beam of light rising from it, to be spotted from afar;
 * - explosion: 1000 sparks and 140 tumbling shards in the logo colours, a shockwave ring on the
 *   ground and a flash of light; everything falls under gravity and fades within ~2 s;
 * - a thrown cube's blast ({@link LogoFx.shatter}): the cube breaks into the 4 × 4 × 4 small
 *   cubes it is made of, in the colours of its logo's squares, flung out from its centre, a few
 *   sparks, the ring and the flash.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PointLight,
  Points,
  PointsMaterial,
  RingGeometry,
  SRGBColorSpace,
  type Scene
} from 'three';
import type { Token } from './collectibles.js';
import { LOGO_GRID } from './logo.js';
import type { NeonPalette } from './palette.js';

const SPARKS = 1000;
const SHARDS = 140;
const LIFE_S = 2;
const GRAVITY = 14;
const TOKEN_Y = 1.7;
/** A thrown cube breaks into N × N × N small cubes, each 1/N of its edge. */
export const SHATTER_N = 4;
const SHATTER_SPARKS = 160;
const SHATTER_LIFE_S = 2.6;

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** The face of a token: dark disc, neon ring, "WinCC OA" wordmark. */
function tokenTexture(p: NeonPalette): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#05090b';
  g.beginPath();
  g.arc(128, 128, 124, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = css(p.dynamic);
  g.shadowColor = css(p.dynamic);
  g.shadowBlur = 18;
  g.beginPath();
  g.arc(128, 128, 112, 0, Math.PI * 2);
  g.stroke();
  g.shadowBlur = 10;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.font = '700 54px "Siemens Sans", Arial, sans-serif';
  g.fillText('WinCC', 128, 104);
  g.fillStyle = css(p.warning);
  g.shadowColor = css(p.warning);
  g.font = '800 70px "Siemens Sans", Arial, sans-serif';
  g.fillText('OA', 128, 164);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

interface Burst {
  points: Points;
  shards: InstancedMesh;
  ring: Mesh;
  vel: Float32Array;
  shardVel: Float32Array;
  shardSpin: Float32Array;
  shardPos: Float32Array;
  age: number;
  /** Seconds it lasts. */
  life: number;
  /** The pieces shrink as they fade (shards), or keep their size (a cube's pieces). */
  shrink: boolean;
  /** Height of a piece's centre resting on the ground. */
  floor: number;
}

export class LogoFx {
  readonly group = new Group();
  private readonly tokens = new Map<number, Group>();
  private readonly face: MeshBasicMaterial;
  private readonly glow: MeshBasicMaterial;
  private readonly beam: MeshBasicMaterial;
  private readonly bursts: Burst[] = [];
  private readonly flash = new PointLight(0xffffff, 0, 40, 2);
  private readonly palette: Color[];
  private readonly o = new Object3D();
  private t = 0;
  /** Camera shake to apply (decays in the world's render). */
  shake = 0;

  constructor(
    scene: Scene,
    private readonly p: NeonPalette
  ) {
    this.face = new MeshBasicMaterial({ map: tokenTexture(p), toneMapped: false });
    this.face.color.setScalar(1.25);
    this.glow = new MeshBasicMaterial({ color: p.dynamic, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.beam = new MeshBasicMaterial({ color: p.dynamic, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    this.palette = [...new Set(LOGO_GRID.flat())].map((c) => new Color(c));
    this.group.add(this.flash);
    scene.add(this.group);
  }

  /** Shows the tokens not taken yet, removes the others. */
  setTokens(tokens: readonly Token[]): void {
    const keep = new Set<number>();
    for (const t of tokens) {
      if (t.taken) continue;
      keep.add(t.id);
      if (this.tokens.has(t.id)) continue;
      const g = new Group();
      const disc = new Mesh(new CylinderGeometry(1.35, 1.35, 0.18, 40), [
        new MeshBasicMaterial({ color: this.p.dynamic, toneMapped: false }), // rim
        this.face,
        this.face
      ]);
      disc.rotation.x = Math.PI / 2; // faces towards ±Z, turning about Y
      disc.position.y = TOKEN_Y;
      disc.name = 'disc';
      const ring = new Mesh(new RingGeometry(1.6, 2.3, 40), this.glow);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      const beam = new Mesh(new CylinderGeometry(0.5, 0.9, 40, 16, 1, true), this.beam);
      beam.position.y = 20;
      g.add(disc, ring, beam);
      g.position.set(t.x, 0, t.z);
      g.rotation.y = t.id * 0.7;
      this.tokens.set(t.id, g);
      this.group.add(g);
    }
    for (const [id, g] of this.tokens) {
      if (keep.has(id)) continue;
      this.group.remove(g);
      this.tokens.delete(id);
    }
  }

  /** `n` sparks flying out of (x, y, z) in the logo colours, and their velocities. */
  private sparks(x: number, y: number, z: number, n: number, speedMax = 16): { points: Points; vel: Float32Array } {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const speed = 6 + Math.random() * speedMax;
      vel[k * 3] = r * Math.cos(a) * speed;
      vel[k * 3 + 1] = Math.abs(u) * speed * 0.9 + 3;
      vel[k * 3 + 2] = r * Math.sin(a) * speed;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      const c = this.palette[k % this.palette.length];
      // bright enough to catch the bloom, not so bright that 1000 of them white the screen out
      col[k * 3] = c.r * 0.75;
      col[k * 3 + 1] = c.g * 0.75;
      col[k * 3 + 2] = c.b * 0.75;
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('color', new BufferAttribute(col, 3));
    const points = new Points(
      geo,
      new PointsMaterial({ size: 0.17, vertexColors: true, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false })
    );
    return { points, vel };
  }

  /** The shockwave ring on the ground at (x, z). */
  private ring(x: number, z: number): Mesh {
    const ring = new Mesh(
      new RingGeometry(1.32, 1.4, 64), // thin: it stays a line as it grows
      new MeshBasicMaterial({ color: this.p.dynamic, transparent: true, opacity: 0.9, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.1, z);
    return ring;
  }

  private flashAt(x: number, y: number, z: number, intensity: number, shake: number): void {
    this.flash.position.set(x, y + 1, z);
    this.flash.color.setHex(this.p.dynamic);
    this.flash.intensity = intensity;
    this.shake = Math.min(0.8, this.shake + shake);
  }

  /** Blows a token up at (x, z): sparks, shards, shockwave, flash, camera shake. */
  explode(x: number, z: number, y = TOKEN_Y): void {
    const { points, vel } = this.sparks(x, y, z, SPARKS);
    // shards: small tumbling squares of the logo
    const shards = new InstancedMesh(new BoxGeometry(0.22, 0.22, 0.05), new MeshBasicMaterial({ transparent: true }), SHARDS);
    const shardVel = new Float32Array(SHARDS * 3);
    const shardSpin = new Float32Array(SHARDS * 3);
    const shardPos = new Float32Array(SHARDS * 3);
    for (let k = 0; k < SHARDS; k++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 4 + Math.random() * 9;
      shardVel[k * 3] = Math.cos(a) * speed;
      shardVel[k * 3 + 1] = 5 + Math.random() * 9;
      shardVel[k * 3 + 2] = Math.sin(a) * speed;
      for (let d = 0; d < 3; d++) shardSpin[k * 3 + d] = (Math.random() - 0.5) * 18;
      shardPos[k * 3] = x;
      shardPos[k * 3 + 1] = y;
      shardPos[k * 3 + 2] = z;
      shards.setColorAt(k, this.palette[k % this.palette.length]);
    }
    const ring = this.ring(x, z);
    this.group.add(points, shards, ring);
    this.bursts.push({ points, shards, ring, vel, shardVel, shardSpin, shardPos, age: 0, life: LIFE_S, shrink: true, floor: 0.05 });
    this.flashAt(x, y, z, 35, 0.5);
  }

  /**
   * A thrown cube of edge `size` (m) blows up at (x, y, z): it breaks into the {@link SHATTER_N}³
   * small cubes it is made of, each `size / N` — each in the colour of the logo square in front of it — flung out from the centre
   * and up, tumbling, bouncing on the asphalt; a few sparks, the ring, the flash.
   */
  shatter(x: number, y: number, z: number, size: number): void {
    const n = SHATTER_N;
    const piece = size / n;
    const count = n * n * n;
    const { points, vel } = this.sparks(x, y, z, SHATTER_SPARKS, 8);
    const shards = new InstancedMesh(new BoxGeometry(piece, piece, piece), new MeshBasicMaterial({ transparent: true, toneMapped: false }), count);
    const shardVel = new Float32Array(count * 3);
    const shardSpin = new Float32Array(count * 3);
    const shardPos = new Float32Array(count * 3);
    const step = piece * 1.05;
    let k = 0;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let d = 0; d < n; d++, k++) {
          // the piece's place in the cube, from its centre
          const ox = (i - (n - 1) / 2) * step;
          const oy = (j - (n - 1) / 2) * step;
          const oz = (d - (n - 1) / 2) * step;
          shardPos[k * 3] = x + ox;
          shardPos[k * 3 + 1] = Math.max(size / 2, y) + oy;
          shardPos[k * 3 + 2] = z + oz;
          const len = Math.hypot(ox, oy, oz) || 1;
          const speed = 5 + Math.random() * 6;
          shardVel[k * 3] = (ox / len) * speed + (Math.random() - 0.5) * 2;
          shardVel[k * 3 + 1] = (oy / len) * speed * 0.5 + 5 + Math.random() * 5;
          shardVel[k * 3 + 2] = (oz / len) * speed + (Math.random() - 0.5) * 2;
          for (let a = 0; a < 3; a++) shardSpin[k * 3 + a] = (Math.random() - 0.5) * 12;
          // row from the top, column from the left, as on the logo's face
          shards.setColorAt(k, new Color(LOGO_GRID[n - 1 - j][i]).multiplyScalar(1.15));
        }
    const ring = this.ring(x, z);
    this.group.add(points, shards, ring);
    this.bursts.push({ points, shards, ring, vel, shardVel, shardSpin, shardPos, age: 0, life: SHATTER_LIFE_S, shrink: false, floor: piece / 2 });
    this.flashAt(x, y, z, 22, 0.3);
  }

  update(dt: number): void {
    this.t += dt;
    // tokens: spin and bob
    for (const g of this.tokens.values()) {
      g.rotation.y += dt * 2.2;
      const disc = g.getObjectByName('disc');
      if (disc) disc.position.y = TOKEN_Y + Math.sin(this.t * 3 + g.position.x) * 0.18;
    }
    this.flash.intensity *= Math.exp(-dt * 7);
    for (let b = this.bursts.length - 1; b >= 0; b--) {
      const burst = this.bursts[b];
      burst.age += dt;
      const life = burst.age / burst.life;
      if (life >= 1) {
        this.group.remove(burst.points, burst.shards, burst.ring);
        burst.points.geometry.dispose();
        burst.shards.geometry.dispose();
        burst.ring.geometry.dispose();
        this.bursts.splice(b, 1);
        continue;
      }
      const pos = burst.points.geometry.getAttribute('position') as BufferAttribute;
      const arr = pos.array as Float32Array;
      const drag = Math.exp(-dt * 1.6);
      for (let k = 0; k < burst.vel.length / 3; k++) {
        const i = k * 3;
        burst.vel[i] *= drag;
        burst.vel[i + 2] *= drag;
        burst.vel[i + 1] = burst.vel[i + 1] * drag - GRAVITY * dt;
        arr[i] += burst.vel[i] * dt;
        arr[i + 1] = Math.max(0.05, arr[i + 1] + burst.vel[i + 1] * dt);
        arr[i + 2] += burst.vel[i + 2] * dt;
      }
      pos.needsUpdate = true;
      (burst.points.material as PointsMaterial).opacity = 1 - life * life;
      const floor = burst.floor;
      for (let k = 0; k < burst.shardPos.length / 3; k++) {
        const i = k * 3;
        burst.shardVel[i + 1] -= GRAVITY * dt;
        burst.shardPos[i] += burst.shardVel[i] * dt;
        burst.shardPos[i + 1] = Math.max(floor, burst.shardPos[i + 1] + burst.shardVel[i + 1] * dt);
        burst.shardPos[i + 2] += burst.shardVel[i + 2] * dt;
        if (burst.shardPos[i + 1] <= floor) {
          // bounce and slide on the asphalt
          burst.shardVel[i + 1] = Math.abs(burst.shardVel[i + 1]) * 0.3;
          burst.shardVel[i] *= 0.7;
          burst.shardVel[i + 2] *= 0.7;
        }
        this.o.position.set(burst.shardPos[i], burst.shardPos[i + 1], burst.shardPos[i + 2]);
        this.o.rotation.set(burst.shardSpin[i] * burst.age, burst.shardSpin[i + 1] * burst.age, burst.shardSpin[i + 2] * burst.age);
        this.o.scale.setScalar(burst.shrink ? 1 - life * 0.6 : 1);
        this.o.updateMatrix();
        burst.shards.setMatrixAt(k, this.o.matrix);
      }
      burst.shards.instanceMatrix.needsUpdate = true;
      // a cube's pieces stay whole, then fade in their last third
      (burst.shards.material as MeshBasicMaterial).opacity = burst.shrink ? 1 - life : Math.min(1, 3 * (1 - life));
      const r = 1 + burst.age * 22;
      burst.ring.scale.setScalar(r);
      (burst.ring.material as MeshBasicMaterial).opacity = 0.75 * Math.max(0, 1 - life * 2) ** 2;
    }
  }
}
