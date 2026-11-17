// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the weather and the slides look like (#95):
 *
 * - **rain**: streaks falling around the players (a 70 m cylinder that follows them), as many
 *   as the rain level asks, slanted by a light wind;
 * - **skid marks**: dark rubber strips laid by the rear wheels while a car slides, kept in a
 *   ring of 900 (the oldest go first).
 *
 * The fog and the wet roads are the world's own (world.ts: fog density, road roughness).
 */
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  MeshBasicMaterial,
  Object3D,
  PlaneGeometry,
  type Scene
} from 'three';

const DROPS = 2600;
const RADIUS = 70;
const TOP = 34;
const FALL = 19; // m/s
const STREAK = 0.9; // m
const WIND = 2.2; // m/s along x
const SKIDS = 900;

export class AtmosphereFx {
  readonly group = new Group();
  private readonly rain: LineSegments;
  private readonly drops = new Float32Array(DROPS * 3);
  private readonly skids: InstancedMesh;
  private skidNext = 0;
  private readonly o = new Object3D();
  private level = 0;

  constructor(scene: Scene) {
    for (let k = 0; k < DROPS; k++) this.respawn(k, 0, 0, Math.random() * TOP);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(DROPS * 6), 3));
    this.rain = new LineSegments(geo, new LineBasicMaterial({ color: 0xa8c8e8, transparent: true, opacity: 0.38, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    const mark = new MeshBasicMaterial({ color: 0x050505, transparent: true, opacity: 0.55, depthWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
    this.skids = new InstancedMesh(new PlaneGeometry(0.26, 0.75), mark, SKIDS);
    this.skids.count = 0;
    this.skids.frustumCulled = false;
    this.group.add(this.rain, this.skids);
    scene.add(this.group);
  }

  private respawn(k: number, cx: number, cz: number, y = TOP): void {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * RADIUS;
    this.drops[k * 3] = cx + Math.cos(a) * r;
    this.drops[k * 3 + 1] = y;
    this.drops[k * 3 + 2] = cz + Math.sin(a) * r;
  }

  /** Rain level 0..1. */
  setRain(level: number): void {
    this.level = level;
    this.rain.visible = level > 0.02;
  }

  /** Animates the drops around (cx, cz), the middle of the players. */
  update(dt: number, cx: number, cz: number): void {
    if (!this.rain.visible) return;
    const step = Math.min(dt, 0.05);
    const n = Math.floor(DROPS * this.level);
    const pos = this.rain.geometry.getAttribute('position') as BufferAttribute;
    const arr = pos.array as Float32Array;
    for (let k = 0; k < n; k++) {
      let x = this.drops[k * 3];
      let y = this.drops[k * 3 + 1];
      let z = this.drops[k * 3 + 2];
      y -= FALL * step;
      x += WIND * step;
      if (y < 0 || Math.hypot(x - cx, z - cz) > RADIUS) {
        this.respawn(k, cx, cz, y < 0 ? TOP : Math.random() * TOP);
        x = this.drops[k * 3];
        y = this.drops[k * 3 + 1];
        z = this.drops[k * 3 + 2];
      }
      this.drops[k * 3] = x;
      this.drops[k * 3 + 1] = y;
      this.drops[k * 3 + 2] = z;
      arr.set([x, y, z, x - (WIND / FALL) * STREAK, y + STREAK, z], k * 6);
    }
    this.rain.geometry.setDrawRange(0, n * 2);
    pos.needsUpdate = true;
  }

  /** A skid mark under a rear wheel at (x, z), along `heading`. */
  addSkid(x: number, z: number, heading: number): void {
    this.o.position.set(x, 0.035, z);
    this.o.rotation.set(-Math.PI / 2, 0, -heading);
    this.o.updateMatrix();
    this.skids.setMatrixAt(this.skidNext, this.o.matrix);
    this.skidNext = (this.skidNext + 1) % SKIDS;
    this.skids.count = Math.min(SKIDS, this.skids.count + 1);
    this.skids.instanceMatrix.needsUpdate = true;
  }

  clearSkids(): void {
    this.skids.count = 0;
    this.skidNext = 0;
  }
}
