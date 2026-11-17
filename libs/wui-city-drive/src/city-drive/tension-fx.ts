// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the tension of City Drive looks like (#85):
 *
 * - speed cameras: a grey post on the kerb with its box turned to the traffic, a round limit
 *   sign, and a white flash (light + glare) when it catches a player;
 * - security cars: a dark saloon with a red / blue light bar flashing in turn (bright colours,
 *   so the bloom makes them glow) and a white `SECURITY` stripe;
 * - damage: smoke rising from the bonnet of a damaged car, thicker and darker with the damage,
 *   with flames under it once the car is nearly wrecked.
 */
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  NormalBlending,
  PointLight,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  type Scene
} from 'three';
import { buildCar } from './car-model.js';
import { CELL, ROAD_WIDTH } from './city.js';
import type { NeonPalette } from './palette.js';
import type { CarState } from './physics.js';
import type { SpeedCamera } from './tension.js';
import type { Body } from './vehicles.js';

const CHASER_BODY: Body = { w: 2, h: 0.62, l: 5, cabinL: 2.2, cabinH: 0.52, cabinZ: -0.15 };
const BAR_Y = 0.32 + CHASER_BODY.h + CHASER_BODY.cabinH + 0.12;
const SMOKE = 120;
const FLASH_S = 0.35;

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/** The limit sign: white disc, red ring, the limit in black. */
function limitTexture(limit: number, red: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 62, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 14;
  g.strokeStyle = css(red);
  g.beginPath();
  g.arc(64, 64, 54, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#111111';
  g.font = 'bold 54px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(limit), 64, 68);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A soft round puff, for the smoke and the camera glare. */
function puffTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new CanvasTexture(c);
}

/** The white stripe on a security car's doors. */
function stripeTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 32;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  g.fillStyle = '#f2f6f8';
  g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#0b1a24';
  g.font = 'bold 22px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('SECURITY', 128, 17);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

interface Puff {
  sprite: Sprite;
  age: number;
  life: number;
  vx: number;
  vy: number;
  vz: number;
  fire: boolean;
}

/** A damaged car seen by the smoke: where it is, and how badly hurt it is (0..1). */
export interface Smoker {
  x: number;
  z: number;
  heading: number;
  length: number;
  damage: number;
}

export class TensionFx {
  readonly group = new Group();
  private readonly cameraGlare = new Map<number, { light: PointLight; glare: Sprite; t: number }>();
  private readonly chasers: { car: Group; red: MeshBasicMaterial; blue: MeshBasicMaterial }[] = [];
  private readonly puffTex = puffTexture();
  private readonly stripeTex = stripeTexture();
  private readonly puffs: Puff[] = [];
  private readonly emitDebt: number[] = [];
  private elapsed = 0;

  constructor(
    scene: Scene,
    private readonly p: NeonPalette
  ) {
    for (let k = 0; k < SMOKE; k++) {
      const sprite = new Sprite(new SpriteMaterial({ map: this.puffTex, transparent: true, depthWrite: false, opacity: 0 }));
      sprite.visible = false;
      this.group.add(sprite);
      this.puffs.push({ sprite, age: 0, life: 1, vx: 0, vy: 0, vz: 0, fire: false });
    }
    scene.add(this.group);
  }

  // --- speed cameras ------------------------------------------------------------------------

  /** One post per camera, on the kerb of its road, its box turned to the traffic. */
  setCameras(cameras: readonly SpeedCamera[]): void {
    const postMat = new MeshStandardMaterial({ color: 0x8a9499, metalness: 0.6, roughness: 0.45 });
    const boxMat = new MeshStandardMaterial({ color: 0x5a6266, metalness: 0.3, roughness: 0.5 });
    const lensMat = new MeshBasicMaterial({ color: 0x0d1418 });
    for (const cam of cameras) {
      // a camera on an X road (z on the grid) stands beside it in z, otherwise in x
      const onX = Math.abs(cam.z / CELL - Math.round(cam.z / CELL)) < 1e-6;
      const side = ROAD_WIDTH / 2 + 1.4;
      const g = new Group();
      g.position.set(onX ? cam.x : cam.x + side, 0, onX ? cam.z + side : cam.z);
      g.rotation.y = onX ? Math.PI : -Math.PI / 2; // facing the road
      const post = new Mesh(new CylinderGeometry(0.12, 0.14, 4.2, 10), postMat);
      post.position.y = 2.1;
      const box = new Mesh(new BoxGeometry(0.8, 0.7, 1.1), boxMat);
      box.position.set(0, 4.3, 0);
      const lens = new Mesh(new CircleGeometry(0.18, 16), lensMat);
      lens.position.set(0, 4.3, 0.56);
      const sign = new Mesh(new CircleGeometry(0.55, 28), new MeshBasicMaterial({ map: limitTexture(cam.limit, this.p.alarm) }));
      sign.position.set(0, 3.1, 0.16);
      const light = new PointLight(0xffffff, 0, 30, 2);
      light.position.set(0, 4.3, 1.2);
      const glare = new Sprite(new SpriteMaterial({ map: this.puffTex, color: 0xffffff, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false }));
      glare.position.set(0, 4.3, 0.7);
      glare.scale.setScalar(4);
      g.add(post, box, lens, sign, light, glare);
      this.group.add(g);
      this.cameraGlare.set(cam.id, { light, glare, t: Infinity });
    }
  }

  /** The camera `id` flashes. */
  flash(id: number): void {
    const c = this.cameraGlare.get(id);
    if (c) c.t = 0;
  }

  // --- security cars ------------------------------------------------------------------------

  /** One security car per chaser state (the pool grows; the spares are hidden). */
  setChasers(cars: readonly CarState[]): void {
    while (this.chasers.length < cars.length) this.chasers.push(this.makeChaser());
    this.chasers.forEach((c, k) => {
      const s = cars[k];
      c.car.visible = !!s;
      if (!s) return;
      c.car.position.set(s.x, 0, s.z);
      c.car.rotation.y = s.heading;
    });
  }

  private makeChaser(): { car: Group; red: MeshBasicMaterial; blue: MeshBasicMaterial } {
    const car = buildCar(CHASER_BODY, { paint: 0x10161d, glow: this.p.info, tail: this.p.alarm, plate: 'SEC 112' });
    const red = new MeshBasicMaterial({ color: this.p.alarm, toneMapped: false });
    const blue = new MeshBasicMaterial({ color: this.p.info, toneMapped: false });
    const base = new Mesh(new BoxGeometry(1.3, 0.08, 0.36), new MeshStandardMaterial({ color: 0x1a1f24 }));
    base.position.set(0, BAR_Y - 0.06, -0.1);
    for (const [mat, x] of [
      [red, -0.36],
      [blue, 0.36]
    ] as const) {
      const lamp = new Mesh(new BoxGeometry(0.56, 0.14, 0.3), mat);
      lamp.position.set(x, BAR_Y + 0.05, -0.1);
      car.add(lamp);
    }
    const stripeMat = new MeshBasicMaterial({ map: this.stripeTex });
    for (const sx of [-1, 1]) {
      const stripe = new Mesh(new BoxGeometry(0.02, 0.22, 1.9), stripeMat);
      stripe.position.set(sx * (CHASER_BODY.w / 2 + 0.01), 0.32 + CHASER_BODY.h * 0.55, 0);
      if (sx < 0) stripe.rotation.y = Math.PI;
      car.add(stripe);
    }
    car.add(base);
    this.group.add(car);
    return { car, red, blue };
  }

  // --- damage smoke ---------------------------------------------------------------------------

  /** Animates the flashes, the light bars and the smoke of the damaged cars. */
  update(frameDt: number, smokers: readonly Smoker[]): void {
    // a long frame (tab in the background, slow machine) must not age every puff out at once
    const dt = Math.min(frameDt, 0.05);
    this.elapsed += dt;
    for (const c of this.cameraGlare.values()) {
      if (c.t > FLASH_S) continue;
      c.t += dt;
      const k = Math.max(0, 1 - c.t / FLASH_S);
      c.light.intensity = 900 * k;
      (c.glare.material as SpriteMaterial).opacity = k;
      c.glare.scale.setScalar(4 + 6 * (1 - k));
    }
    // red and blue in turn, double blink
    const phase = (this.elapsed * 2.4) % 1;
    const blink = phase % 0.5 < 0.12 || (phase % 0.5 > 0.2 && phase % 0.5 < 0.32);
    const redOn = phase < 0.5 && blink;
    const blueOn = phase >= 0.5 && blink;
    for (const c of this.chasers) {
      c.red.color.setHex(this.p.alarm).multiplyScalar(redOn ? 4 : 0.25);
      c.blue.color.setHex(this.p.info).multiplyScalar(blueOn ? 4 : 0.25);
    }
    smokers.forEach((s, k) => this.emit(s, k, dt));
    for (const pf of this.puffs) {
      if (!pf.sprite.visible) continue;
      pf.age += dt;
      if (pf.age >= pf.life) {
        pf.sprite.visible = false;
        continue;
      }
      const a = pf.age / pf.life;
      pf.sprite.position.x += pf.vx * dt;
      pf.sprite.position.y += pf.vy * dt;
      pf.sprite.position.z += pf.vz * dt;
      pf.sprite.scale.setScalar(pf.fire ? 0.9 * (1 - a) + 0.2 : 0.8 + a * 3.2);
      (pf.sprite.material as SpriteMaterial).opacity = pf.fire ? 0.9 * (1 - a) : 0.55 * (1 - a) * Math.min(1, a * 6);
    }
  }

  /** A hit (#89): a short burst of sparks at (x, y, z). */
  burst(x: number, y: number, z: number): void {
    for (let k = 0; k < 14; k++) {
      const pf = this.puffs.find((q) => !q.sprite.visible);
      if (!pf) return;
      pf.sprite.position.set(x, y, z);
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      pf.vx = Math.cos(a) * sp;
      pf.vz = Math.sin(a) * sp;
      pf.vy = 1 + Math.random() * 3;
      pf.age = 0;
      pf.life = 0.35 + Math.random() * 0.25;
      pf.fire = true;
      const m = pf.sprite.material as SpriteMaterial;
      m.blending = AdditiveBlending;
      m.color.setHex(k % 3 === 0 ? 0xffffff : 0xffb040).multiplyScalar(2);
      m.needsUpdate = true;
      pf.sprite.visible = true;
    }
  }

  /** Puffs from the bonnet of a damaged car: from 30 % damage, more and darker with it. */
  private emit(s: Smoker, k: number, dt: number): void {
    if (s.damage < 0.3) return;
    const rate = 6 + 34 * s.damage; // puffs per second
    this.emitDebt[k] = (this.emitDebt[k] ?? 0) + rate * dt;
    while (this.emitDebt[k] >= 1) {
      this.emitDebt[k] -= 1;
      const fire = s.damage > 0.85 && Math.random() < 0.35;
      const pf = this.puffs.find((q) => !q.sprite.visible);
      if (!pf) return;
      const front = s.length * 0.36;
      pf.sprite.position.set(s.x + Math.sin(s.heading) * front + (Math.random() - 0.5) * 0.6, 1.1, s.z + Math.cos(s.heading) * front + (Math.random() - 0.5) * 0.6);
      pf.vx = (Math.random() - 0.5) * 0.6;
      pf.vz = (Math.random() - 0.5) * 0.6;
      pf.vy = fire ? 1.6 : 1.2 + Math.random() * 0.8;
      pf.age = 0;
      pf.life = fire ? 0.5 : 1.6 + Math.random() * 0.8;
      pf.fire = fire;
      const m = pf.sprite.material as SpriteMaterial;
      m.blending = fire ? AdditiveBlending : NormalBlending;
      m.color.setHex(fire ? 0xff7a1a : 0xffffff).multiplyScalar(fire ? 2 : 0.75 - 0.5 * s.damage);
      m.needsUpdate = true;
      pf.sprite.visible = true;
    }
  }
}
