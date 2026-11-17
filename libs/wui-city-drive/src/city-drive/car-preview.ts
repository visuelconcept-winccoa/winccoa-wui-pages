// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The turntable of the start screen: the chosen vehicle, in the player's neon colour, turning
 * on a lit plate — the same model as in the game (car-model.ts).
 *
 * One small WebGL renderer per canvas (one per player card). It draws only while its canvas is
 * on screen, and is disposed when the card goes away (the game starts).
 */
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  RingGeometry,
  Scene,
  WebGLRenderer
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar } from './car-model.js';
import { mix, type NeonPalette } from './palette.js';
import type { Body } from './vehicles.js';

/** Turns per second. */
const SPIN = 0.12;
const PAINT = 0x14232a;

export class CarPreview {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(30, 16 / 9, 0.5, 200);
  private readonly turntable = new Group();
  private readonly ring: MeshBasicMaterial;
  private readonly rim: DirectionalLight;
  private car: Group | null = null;
  private key = '';
  private frame = 0;
  private last = 0;
  private angle = -0.6;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly p: NeonPalette
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    pmrem.dispose();
    this.scene.add(new HemisphereLight(mix(p.info, 0xffffff, 0.5), p.night, 0.9));
    const keyLight = new DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(6, 9, 7);
    this.rim = new DirectionalLight(p.primary, 2.5);
    this.rim.position.set(-7, 4, -8);
    this.scene.add(keyLight, this.rim);

    // the plate: dark disc, a neon ring in the player's colour
    const plate = new Mesh(new CircleGeometry(4.3, 64), new MeshStandardMaterial({ color: mix(p.night, 0x000000, 0.3), metalness: 0.4, roughness: 0.35 }));
    plate.rotation.x = -Math.PI / 2;
    this.ring = new MeshBasicMaterial({ color: p.primary, transparent: true, opacity: 0.85, blending: AdditiveBlending, side: DoubleSide, toneMapped: false });
    const ring = new Mesh(new RingGeometry(4.1, 4.3, 96), this.ring);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.turntable.add(plate, ring);
    this.scene.add(this.turntable);

    this.camera.position.set(0, 3.1, 11.5);
    this.camera.lookAt(0, 0.7, 0);
    this.loop = this.loop.bind(this);
    this.frame = requestAnimationFrame(this.loop);
  }

  /** The vehicle shown, in the player's neon colour (rebuilt only when one of them changes). */
  show(body: Body, glow: number, plate: string, paint = PAINT, wheelScale = 1): void {
    const key = `${JSON.stringify(body)}|${glow}|${plate}|${paint}|${wheelScale}`;
    if (key === this.key) return;
    this.key = key;
    if (this.car) this.turntable.remove(this.car);
    this.car = buildCar(body, { paint, glow, tail: this.p.alarm, plate, wheelScale });
    this.turntable.add(this.car);
    this.ring.color.setHex(glow);
    this.rim.color = new Color(glow);
    // frame the long cars (limousine) as well as the short ones
    const d = 5.2 + body.l * 0.62;
    this.camera.position.set(0, 2.2 + body.l * 0.08, d);
    this.camera.lookAt(0, 0.25, 0);
  }

  private loop(now: number): void {
    this.frame = requestAnimationFrame(this.loop);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    // nothing to draw while the card is hidden (or the tab is in the background)
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.round(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.angle += dt * SPIN * Math.PI * 2;
    this.turntable.rotation.y = this.angle;
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
