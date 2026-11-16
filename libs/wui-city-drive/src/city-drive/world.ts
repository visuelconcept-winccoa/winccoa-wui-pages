// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The 3D world of City Drive (#79): a city at night in neon, coloured with the Siemens iX
 * theme ({@link NeonPalette}), rendered with a bloom pass. Only draws: the game state comes
 * from game.ts.
 *
 * Neon: dark bodies, glowing outlines (edges) and lit windows on the buildings, glowing lane
 * marks, under-glow and lights on the cars. Machine halls glow in the colour of their state
 * (success / neutral / alarm, pulsing in fault).
 */
import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  FogExp2,
  HalfFloatType,
  ACESFilmicToneMapping,
  ConeGeometry,
  DirectionalLight,
  PCFSoftShadowMap,
  PMREMGenerator,
  SpotLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Material
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MachineState } from './bindings.js';
import { CELL, ROAD_WIDTH, roadAxis, type Building, type City } from './city.js';
import type { MissionKind, MissionStage, Point } from './missions.js';
import { logoCanvas } from './logo.js';
import { buildCar, headlightY } from './car-model.js';
import { vehicleById, type Body } from './vehicles.js';
import { mix, type NeonPalette } from './palette.js';
import { lightAt, type LightOverrides } from './traffic.js';
import { StreetLife } from './street.js';
import { asphaltMaps, beamTexture, facadeMaps, pavementMaps, type FacadeMaps } from './textures.js';

/**
 * Camera views, cycled with C: chase (behind), street (low, close, at the height of the
 * pedestrians), hood (from the bonnet), drone (circling above the car), corner (a fixed camera
 * at the next street corner, as on TV, changing corner when the car is gone), top (map view).
 */
export type CameraMode = 'chase' | 'street' | 'hood' | 'drone' | 'corner' | 'top';
export const CAMERA_MODES: readonly CameraMode[] = ['chase', 'street', 'hood', 'drone', 'corner', 'top'];

export interface CarPose {
  x: number;
  z: number;
  heading: number;
}

/** Another player, seen through its datapoint. */
export interface RemoteCar extends CarPose {
  id: string;
  nickname: string;
  vehicle: string;
  /** Neon colour (0xrrggbb). */
  color: number;
}

/** A name tag above a car: a sprite of the nickname in its neon colour. */
function nameTag(text: string, color: number): Sprite {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const g = c.getContext('2d') as CanvasRenderingContext2D;
  const hexc = `#${color.toString(16).padStart(6, '0')}`;
  g.font = '600 52px "Siemens Sans", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = hexc;
  g.shadowBlur = 18;
  g.fillStyle = hexc;
  g.fillText(text, 256, 48);
  g.shadowBlur = 0;
  g.fillStyle = '#ffffff';
  g.fillText(text, 256, 48);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(10, 1.9, 1);
  return s;
}

const LIGHT_POST = 2.4;
/** Size of the moonlight's shadow box around the player (m). */
const SHADOW_SPAN = 110;
const BEAM = beamTexture();
/** The player's registration: Eisenstadt, the cradle of WinCC OA. */
const PLAYER_PLATE = 'WINCCOA 1';

function neon(color: number, opacity = 1): LineBasicMaterial {
  return new LineBasicMaterial({ color, transparent: opacity < 1, opacity });
}

/** A registration of the Eisenstadt district: three digits and two letters. */
function randomPlate(k: number): string {
  const letters = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const n = (k * 7919 + 131) % 1000;
  return `${String(n).padStart(3, '0')} ${letters[(k * 31) % letters.length]}${letters[(k * 17 + 5) % letters.length]}`;
}

/** The traffic's sedans: long, low, every other one with tail fins. */
const SEDAN: Body = { w: 2, h: 0.6, l: 5.1, cabinL: 2.1, cabinH: 0.5, cabinZ: -0.2 };
const SEDAN_FINS: Body = { ...SEDAN, fins: true };

/** A car of the game: the model, plus the visible beams of its headlights. */
function makeCar(p: NeonPalette, glow: number, paint: number, b: Body = SEDAN, plate?: string): Group {
  const g = buildCar(b, { paint, glow, tail: p.alarm, plate });
  for (const sx of [-b.w * 0.36, b.w * 0.36]) {
    const beam = new Mesh(
      new ConeGeometry(2.6, 16, 20, 1, true),
      new MeshBasicMaterial({ map: BEAM, color: 0xdff4ff, transparent: true, opacity: 0.2, blending: AdditiveBlending, depthWrite: false, side: DoubleSide })
    );
    beam.rotation.x = -Math.PI / 2; // tip at the lamp, opening forward
    beam.position.set(sx, headlightY(b), b.l / 2 + 8);
    beam.userData.beam = true;
    g.add(beam);
  }
  return g;
}

export class CityWorld {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(62, 1, 0.5, 2400);
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private player: Group;
  private readonly moon: DirectionalLight;
  private readonly headlights: SpotLight[] = [];
  private readonly shadowFollow = new Vector3();
  private readonly street: StreetLife;
  private readonly traffic: Group[] = [];
  private readonly machineEdges = new Map<string, { lines: LineSegments; roof: Mesh; beacon: Mesh }>();
  private readonly lightHeads: { mesh: InstancedMesh; axis: 0 | 1 }[] = [];
  private readonly lightNodes: { i: number; j: number }[] = [];
  private readonly marker: Mesh;
  private readonly remotes = new Map<string, { car: Group; key: string }>();
  private readonly camPos = new Vector3();
  private readonly camLook = new Vector3();
  private cameraMode: CameraMode = 'chase';
  private corner: Vector3 | null = null;
  private playerBody: Body = SEDAN;
  private elapsed = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly city: City,
    private readonly p: NeonPalette
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);
    this.scene.background = new Color(mix(p.night, 0x000000, 0.35));
    this.scene.fog = new FogExp2(mix(p.night, 0x000000, 0.2), 0.0019);
    this.scene.add(new HemisphereLight(mix(p.info, 0xffffff, 0.3), p.night, 0.45));
    // faint reflections on glass, paint and wet asphalt
    const pmrem = new PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.12;
    pmrem.dispose();
    // moonlight: the shadows of the towers and the cars, in a box that follows the player
    this.moon = new DirectionalLight(mix(p.info, 0xffffff, 0.55), 1.1);
    this.moon.castShadow = true;
    this.moon.shadow.mapSize.set(2048, 2048);
    const sc = this.moon.shadow.camera;
    sc.left = -SHADOW_SPAN;
    sc.right = SHADOW_SPAN;
    sc.top = SHADOW_SPAN;
    sc.bottom = -SHADOW_SPAN;
    sc.near = 1;
    sc.far = 500;
    this.moon.shadow.bias = -0.0004;
    this.moon.shadow.normalBias = 0.6;
    this.moon.shadow.radius = 3;
    this.scene.add(this.moon, this.moon.target);

    this.buildGround();
    this.buildRoads();
    this.buildBuildings();
    this.buildTrees();
    this.buildStation();
    this.buildTrafficLights();
    this.buildLogos();
    this.street = new StreetLife(city, p);
    this.scene.add(this.street.group);

    this.player = makeCar(p, p.primary, 0x14232a, SEDAN, PLAYER_PLATE);
    this.scene.add(this.player);
    this.attachHeadlights(SEDAN);

    this.marker = new Mesh(
      new CylinderGeometry(4, 4, 60, 32, 1, true),
      new MeshBasicMaterial({ color: p.warning, transparent: true, opacity: 0.28, side: DoubleSide, blending: AdditiveBlending, depthWrite: false })
    );
    this.marker.visible = false;
    this.scene.add(this.marker);

    // multisampled target: the composer would otherwise lose the antialiasing
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // strength, radius, threshold: a tight glow on the bright neon only, walls stay sharp
    this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.75, 0.3, 0.42);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  // --- static city --------------------------------------------------------------

  private buildGround(): void {
    const size = this.city.size + CELL * 4;
    const ground = new Mesh(new PlaneGeometry(size, size), new MeshStandardMaterial({ color: mix(this.p.night, 0x000000, 0.15), roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(this.city.size / 2, -0.02, this.city.size / 2);
    ground.receiveShadow = true;
    this.scene.add(ground);
    // blocks: paved sidewalks, raised by a curb
    const pave = pavementMaps(this.p);
    const w0 = this.city.blockList[0].x1 - this.city.blockList[0].x0 + 6;
    for (const t of [pave.map, pave.roughnessMap, pave.bumpMap]) t.repeat.set(w0 / 4, w0 / 4);
    const walkMat = new MeshStandardMaterial({ map: pave.map, roughnessMap: pave.roughnessMap, bumpMap: pave.bumpMap, bumpScale: 0.6, roughness: 1 });
    const curbMat = new MeshStandardMaterial({ color: mix(this.p.surface, 0xffffff, 0.08), roughness: 0.8 });
    for (const b of this.city.blockList) {
      const w = b.x1 - b.x0 + 6;
      const d = b.z1 - b.z0 + 6;
      // top paved, sides as curb stones
      const m = new Mesh(new BoxGeometry(w, 0.25, d), [curbMat, curbMat, walkMat, curbMat, curbMat, curbMat]);
      m.position.set((b.x0 + b.x1) / 2, 0.12, (b.z0 + b.z1) / 2);
      m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  private buildRoads(): void {
    const n = this.city.blocks;
    const len = this.city.size + ROAD_WIDTH;
    // asphalt, two orientations of the same maps (one repeat ≈ 16 m)
    const roadMat = (alongZ: boolean): MeshStandardMaterial => {
      const a = asphaltMaps(this.p);
      for (const t of [a.map, a.roughnessMap, a.bumpMap]) t.repeat.set(alongZ ? ROAD_WIDTH / 16 : len / 16, alongZ ? len / 16 : ROAD_WIDTH / 16);
      return new MeshStandardMaterial({ map: a.map, roughnessMap: a.roughnessMap, bumpMap: a.bumpMap, bumpScale: 0.35, roughness: 1, metalness: 0.15 });
    };
    const roadZ = roadMat(true);
    const roadX = roadMat(false);
    const edges: number[] = [];
    const dashes: number[] = [];
    for (let k = 0; k <= n; k++) {
      const a = roadAxis(k);
      const alongZ = new Mesh(new PlaneGeometry(ROAD_WIDTH, len), roadZ);
      alongZ.receiveShadow = true;
      alongZ.rotation.x = -Math.PI / 2;
      alongZ.position.set(a, 0.01, this.city.size / 2);
      const alongX = new Mesh(new PlaneGeometry(len, ROAD_WIDTH), roadX);
      alongX.receiveShadow = true;
      alongX.rotation.x = -Math.PI / 2;
      alongX.position.set(this.city.size / 2, 0.011, a);
      this.scene.add(alongZ, alongX);
      for (const side of [-1, 1]) {
        const e = a + (side * ROAD_WIDTH) / 2;
        edges.push(e, 0.05, -ROAD_WIDTH / 2, e, 0.05, this.city.size + ROAD_WIDTH / 2);
        edges.push(-ROAD_WIDTH / 2, 0.05, e, this.city.size + ROAD_WIDTH / 2, 0.05, e);
      }
      for (let s = 0; s < this.city.size; s += 8) {
        if (Math.abs(((s + 4) % CELL) - CELL / 2) > CELL / 2 - ROAD_WIDTH / 2 - 2) continue; // no dash in a crossroads
        dashes.push(a, 0.04, s, a, 0.04, s + 4);
        dashes.push(s, 0.04, a, s + 4, 0.04, a);
      }
    }
    const line = (pts: number[], color: number, opacity: number): LineSegments => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pts, 3));
      return new LineSegments(g, neon(color, opacity));
    };
    this.scene.add(line(edges, this.p.primary, 0.7), line(dashes, this.p.dynamic, 0.85));
    this.buildCrosswalks();
  }

  /** Zebra crossings on the four approaches of every crossroads. */
  private buildCrosswalks(): void {
    const n = this.city.blocks;
    const stripes: { x: number; z: number; alongX: boolean }[] = [];
    const off = ROAD_WIDTH / 2 + 2.2;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const x = roadAxis(i);
        const z = roadAxis(j);
        for (let k = -3; k <= 3; k++) {
          const s = k * 2;
          if (j < n) stripes.push({ x: x + s, z: z + off, alongX: false });
          if (j > 0) stripes.push({ x: x + s, z: z - off, alongX: false });
          if (i < n) stripes.push({ x: x + off, z: z + s, alongX: true });
          if (i > 0) stripes.push({ x: x - off, z: z + s, alongX: true });
        }
      }
    }
    const mesh = new InstancedMesh(
      new PlaneGeometry(1, 3),
      new MeshStandardMaterial({ color: 0xc9d3d6, roughness: 0.7, emissive: 0x6d7a80, emissiveIntensity: 0.15 }),
      stripes.length
    );
    const o = new Object3D();
    stripes.forEach((st, k) => {
      o.position.set(st.x, 0.03, st.z);
      o.rotation.set(-Math.PI / 2, 0, st.alongX ? Math.PI / 2 : 0);
      o.updateMatrix();
      mesh.setMatrixAt(k, o.matrix);
    });
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  private buildBuildings(): void {
    const bodyMat = new MeshStandardMaterial({ color: mix(this.p.surface, 0x000000, 0.55), roughness: 0.6, metalness: 0.4 });
    const edgeColors = [this.p.primary, this.p.dynamic, this.p.info, this.p.primary, this.p.critical];
    const edgeSets: number[][] = edgeColors.map(() => []);
    const styles: FacadeMaps[] = ([0, 1, 2] as const).map((st) => facadeMaps(this.p, 977 * (st + 1), st));
    /** A facade material for a face `width` wide on a building `height` tall. */
    const facade = (style: FacadeMaps, width: number, height: number): MeshStandardMaterial => {
      const rep2 = (t: CanvasTexture): CanvasTexture => {
        const c = t.clone();
        c.repeat.set(Math.max(1, Math.round(width / 24)), Math.max(1, height / 56));
        c.needsUpdate = true;
        return c;
      };
      return new MeshStandardMaterial({
        map: rep2(style.map as CanvasTexture),
        emissive: 0xffffff,
        emissiveMap: rep2(style.emissiveMap as CanvasTexture),
        emissiveIntensity: 0.42,
        roughnessMap: rep2(style.roughnessMap as CanvasTexture),
        roughness: 1,
        metalness: 0.35
      });
    };
    const roofMat = new MeshStandardMaterial({ color: mix(this.p.surface, 0x000000, 0.7), roughness: 0.8 });
    for (const b of this.city.buildings) {
      if (b.machine) {
        this.buildMachine(b);
        continue;
      }
      const w = b.x1 - b.x0;
      const d = b.z1 - b.z0;
      const geo = new BoxGeometry(w, b.height, d);
      const style = styles[b.tint % styles.length];
      const sideX = facade(style, d, b.height); // faces ±X are `d` wide
      const sideZ = facade(style, w, b.height);
      // box faces: +X, -X, +Y (roof), -Y, +Z, -Z
      const mats: Material[] = [sideX, sideX, roofMat, bodyMat, sideZ, sideZ];
      const m = new Mesh(geo, mats);
      m.position.set((b.x0 + b.x1) / 2, b.height / 2, (b.z0 + b.z1) / 2);
      m.castShadow = true;
      m.receiveShadow = true;
      this.scene.add(m);
      const e = new EdgesGeometry(geo).getAttribute('position');
      const set = edgeSets[b.tint % edgeSets.length];
      for (let k = 0; k < e.count; k++) set.push(e.getX(k) + m.position.x, e.getY(k) + m.position.y, e.getZ(k) + m.position.z);
    }
    edgeSets.forEach((pts, k) => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute(pts, 3));
      this.scene.add(new LineSegments(g, neon(edgeColors[k], 0.75)));
    });
  }

  private buildMachine(b: Building): void {
    const w = b.x1 - b.x0;
    const d = b.z1 - b.z0;
    const geo = new BoxGeometry(w, b.height, d);
    const hall = new Mesh(geo, new MeshStandardMaterial({ color: mix(this.p.surface, 0x000000, 0.4), roughness: 0.5, metalness: 0.5 }));
    hall.position.set((b.x0 + b.x1) / 2, b.height / 2, (b.z0 + b.z1) / 2);
    hall.castShadow = true;
    hall.receiveShadow = true;
    const lines = new LineSegments(new EdgesGeometry(geo), neon(this.p.info));
    lines.position.copy(hall.position);
    const roof = new Mesh(
      new PlaneGeometry(w - 2, d - 2),
      new MeshBasicMaterial({ color: this.p.info, transparent: true, opacity: 0.35, blending: AdditiveBlending, depthWrite: false })
    );
    roof.rotation.x = -Math.PI / 2;
    roof.position.set(hall.position.x, b.height + 0.05, hall.position.z);
    const beacon = new Mesh(new CylinderGeometry(0.6, 0.6, 6, 12), new MeshBasicMaterial({ color: this.p.info }));
    beacon.position.set(hall.position.x, b.height + 3, hall.position.z);
    this.scene.add(hall, lines, roof, beacon);
    this.machineEdges.set(b.id, { lines, roof, beacon });
  }

  private buildTrees(): void {
    if (this.city.trees.length === 0) return;
    const crown = new InstancedMesh(
      new SphereGeometry(2.4, 10, 8),
      new MeshStandardMaterial({ color: mix(this.p.success, 0x000000, 0.75), emissive: this.p.success, emissiveIntensity: 0.25 }),
      this.city.trees.length
    );
    const o = new Object3D();
    this.city.trees.forEach((t, k) => {
      o.position.set(t.x, 3.6 * t.size, t.z);
      o.scale.setScalar(t.size);
      o.updateMatrix();
      crown.setMatrixAt(k, o.matrix);
    });
    this.scene.add(crown);
  }

  private buildStation(): void {
    const s = this.city.station;
    const w = s.x1 - s.x0;
    const d = s.z1 - s.z0;
    const pad = new Mesh(new PlaneGeometry(w, d), new MeshStandardMaterial({ color: mix(this.p.warning, 0x000000, 0.85), emissive: this.p.warning, emissiveIntensity: 0.08 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set((s.x0 + s.x1) / 2, 0.3, (s.z0 + s.z1) / 2);
    const canopyGeo = new BoxGeometry(w * 0.6, 1, d * 0.4);
    const canopy = new Mesh(canopyGeo, new MeshStandardMaterial({ color: 0x111111 }));
    canopy.position.set(pad.position.x, 7, pad.position.z);
    const glow = new LineSegments(new EdgesGeometry(canopyGeo), neon(this.p.warning));
    glow.position.copy(canopy.position);
    this.scene.add(pad, canopy, glow);
  }

  private buildTrafficLights(): void {
    const n = this.city.blocks;
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) this.lightNodes.push({ i, j });
    const geo = new SphereGeometry(0.55, 10, 8);
    for (const axis of [0, 1] as const) {
      const mesh = new InstancedMesh(geo, new MeshBasicMaterial({ color: 0xffffff }), this.lightNodes.length * 2);
      const o = new Object3D();
      const r = ROAD_WIDTH / 2 + 1.2;
      this.lightNodes.forEach(({ i, j }, k) => {
        const x = roadAxis(i);
        const z = roadAxis(j);
        // axis Z: lights on the two corners facing the Z traffic; axis X: the two others
        const corners = axis === 0 ? [[r, r], [-r, -r]] : [[r, -r], [-r, r]];
        corners.forEach(([cx, cz], c) => {
          o.position.set(x + cx, LIGHT_POST + 2.2, z + cz);
          o.updateMatrix();
          mesh.setMatrixAt(k * 2 + c, o.matrix);
        });
      });
      this.lightHeads.push({ mesh, axis });
      this.scene.add(mesh);
    }
  }

  /**
   * The logo, high on the towers: a large lit sign on the roofs of the tallest towers, turned
   * towards the streets, and the logo set at the top of their facades. Brighter than white
   * (HDR colour), so the bloom makes it glow.
   */
  private buildLogos(): void {
    const tex = new CanvasTexture(logoCanvas(1024));
    tex.colorSpace = SRGBColorSpace;
    tex.anisotropy = 8;
    const face = new MeshBasicMaterial({ map: tex, side: DoubleSide, toneMapped: false });
    face.color.setScalar(1.15);
    const backing = new MeshStandardMaterial({ color: 0x05090b, roughness: 0.6, metalness: 0.3 });
    const halo = new MeshBasicMaterial({ color: this.p.primary, transparent: true, opacity: 0.25, blending: AdditiveBlending, depthWrite: false, side: DoubleSide });
    const towers = [...this.city.buildings].filter((b) => !b.machine).sort((a, b) => b.height - a.height).slice(0, 12);
    towers.forEach((b, k) => {
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const w = b.x1 - b.x0;
      const d = b.z1 - b.z0;
      // rooftop sign, facing a street (the axis alternates)
      const size = Math.min(22, Math.max(w, d) - 2);
      const sign = new Group();
      const panel = new Mesh(new PlaneGeometry(size, size), face);
      panel.position.y = size / 2 + 3;
      const glow = new Mesh(new PlaneGeometry(size * 1.25, size * 1.25), halo);
      glow.position.set(0, panel.position.y, -0.3);
      const frame = new LineSegments(new EdgesGeometry(new BoxGeometry(size + 0.8, size + 0.8, 0.5)), neon(k % 2 ? this.p.primary : this.p.dynamic));
      frame.position.copy(panel.position);
      const mastMat = new MeshStandardMaterial({ color: 0x0c1114, metalness: 0.6, roughness: 0.4 });
      for (const sx of [-size / 3, size / 3]) {
        const mast = new Mesh(new BoxGeometry(0.6, 3, 0.6), mastMat);
        mast.position.set(sx, 1.5, 0);
        sign.add(mast);
      }
      sign.add(glow, panel, frame);
      sign.position.set(cx, b.height, cz);
      sign.rotation.y = (k % 2) * (Math.PI / 2);
      this.scene.add(sign);
    });
    // the logo at the top of the facades of every building taller than 20 m
    const crowns: { x: number; y: number; z: number; ry: number; size: number }[] = [];
    for (const b of this.city.buildings) {
      if (b.machine || b.height < 20) continue;
      const cx = (b.x0 + b.x1) / 2;
      const cz = (b.z0 + b.z1) / 2;
      const w = b.x1 - b.x0;
      const d = b.z1 - b.z0;
      const crown = (width: number): number => Math.min(width * 0.55, 11);
      const y = b.height - crown(Math.min(w, d)) / 2 - 1.5;
      const sides: [number, number, number, number][] = [
        [cx, cz + d / 2 + 0.15, 0, crown(w)],
        [cx, cz - d / 2 - 0.15, Math.PI, crown(w)],
        [cx + w / 2 + 0.15, cz, Math.PI / 2, crown(d)],
        [cx - w / 2 - 0.15, cz, -Math.PI / 2, crown(d)]
      ];
      for (const [x, z, ry, size] of sides) crowns.push({ x, y, z, ry, size });
    }
    // drawn instanced: dark backing, the logo, and one merged geometry for all the neon frames
    const o = new Object3D();
    const backs = new InstancedMesh(new BoxGeometry(1, 1, 1), backing, crowns.length);
    const logos = new InstancedMesh(new PlaneGeometry(1, 1), face, crowns.length);
    const frames: number[] = [];
    crowns.forEach((c, k) => {
      const nx = Math.sin(c.ry);
      const nz = Math.cos(c.ry);
      o.rotation.set(0, c.ry, 0);
      o.position.set(c.x - nx * 0.1, c.y, c.z - nz * 0.1);
      o.scale.set(c.size + 1.6, c.size + 1.6, 0.3);
      o.updateMatrix();
      backs.setMatrixAt(k, o.matrix);
      o.position.set(c.x + nx * 0.08, c.y, c.z + nz * 0.08);
      o.scale.set(c.size, c.size, 1);
      o.updateMatrix();
      logos.setMatrixAt(k, o.matrix);
      // frame: a square in the facade plane, 0.1 m proud
      const h = (c.size + 1.6) / 2;
      const ux = Math.cos(c.ry);
      const uz = -Math.sin(c.ry);
      const fx = c.x + nx * 0.1;
      const fz = c.z + nz * 0.1;
      const corner = (a: number, b: number): number[] => [fx + ux * a, c.y + b, fz + uz * a];
      const sq = [corner(-h, -h), corner(h, -h), corner(h, h), corner(-h, h)];
      for (let e = 0; e < 4; e++) frames.push(...sq[e], ...sq[(e + 1) % 4]);
    });
    const fg = new BufferGeometry();
    fg.setAttribute('position', new Float32BufferAttribute(frames, 3));
    this.scene.add(backs, logos, new LineSegments(fg, neon(this.p.primary)));
    // plaza: the logo laid in the first park, lit from below
    const park = this.city.blockList.find((b) => b.kind === 'park') ?? this.city.blockList.find((b) => b.kind === 'plant');
    if (park) {
      const size = Math.min(park.x1 - park.x0, park.z1 - park.z0) * 0.55;
      const plaza = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, toneMapped: false }));
      plaza.rotation.x = -Math.PI / 2;
      plaza.position.set((park.x0 + park.x1) / 2, 0.3, (park.z0 + park.z1) / 2);
      this.scene.add(plaza);
    }
    // station sign
    const s = this.city.station;
    const sign = new Mesh(new PlaneGeometry(9, 9), face);
    sign.position.set(s.x1 - 6, 12, (s.z0 + s.z1) / 2);
    sign.rotation.y = Math.PI / 2;
    this.scene.add(sign);
  }

  // --- dynamic -----------------------------------------------------------------------

  /** The other players (their datapoints): a car in their vehicle and colour, with a name tag. */
  setRemotePlayers(players: readonly RemoteCar[]): void {
    const seen = new Set<string>();
    for (const r of players) {
      seen.add(r.id);
      const key = `${r.nickname}|${r.vehicle}|${r.color}`;
      let entry = this.remotes.get(r.id);
      if (!entry || entry.key !== key) {
        if (entry) this.scene.remove(entry.car);
        const car = makeCar(this.p, r.color, 0x2a2f33, vehicleById(r.vehicle).body, randomPlate(r.id.length * 13 + r.nickname.length));
        const tag = nameTag(r.nickname || r.id, r.color);
        tag.position.y = 5;
        car.add(tag);
        car.position.set(r.x, 0, r.z);
        this.scene.add(car);
        entry = { car, key };
        this.remotes.set(r.id, entry);
      }
      const car = entry.car;
      // updates arrive a few times per second: glide towards them
      car.position.x += (r.x - car.position.x) * 0.2;
      car.position.z += (r.z - car.position.z) * 0.2;
      let dh = r.heading - car.rotation.y;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      car.rotation.y += dh * 0.2;
    }
    for (const [id, entry] of this.remotes) {
      if (seen.has(id)) continue;
      this.scene.remove(entry.car);
      this.remotes.delete(id);
    }
  }


  /** The player's vehicle: its silhouette and its neon colour. */
  setPlayerVehicle(body: Body, glow: number): void {
    const pose = { x: this.player.position.x, z: this.player.position.z, heading: this.player.rotation.y };
    this.scene.remove(this.player);
    this.player = makeCar(this.p, glow, 0x14232a, body, PLAYER_PLATE);
    this.playerBody = body;
    this.scene.add(this.player);
    this.attachHeadlights(body);
    this.player.traverse((o) => {
      if (o.userData.beam) o.visible = this.cameraMode !== 'hood';
    });
    this.setPlayer(pose);
  }

  /** Two real spot lights on the player's car: they light the road and cast shadows. */
  private attachHeadlights(b: Body): void {
    this.headlights.length = 0;
    for (const sx of [-b.w * 0.36, b.w * 0.36]) {
      const spot = new SpotLight(0xeaf6ff, 260, 95, 0.42, 0.55, 1.4);
      spot.position.set(sx, headlightY(b), b.l / 2);
      spot.target.position.set(sx * 1.6, 0, b.l / 2 + 30);
      this.player.add(spot, spot.target);
      this.headlights.push(spot);
    }
  }

  setPlayer(pose: CarPose): void {
    this.player.position.set(pose.x, 0, pose.z);
    this.player.rotation.y = pose.heading;
  }

  setTraffic(poses: readonly (CarPose & { color: number })[]): void {
    const glows = [this.p.dynamic, this.p.info, this.p.critical, this.p.success, this.p.warning];
    while (this.traffic.length < poses.length) {
      const k = this.traffic.length;
      const car = makeCar(this.p, glows[k % glows.length], mix(poses[k].color, 0x000000, 0.35), k % 2 ? SEDAN_FINS : SEDAN, randomPlate(k));
      this.traffic.push(car);
      this.scene.add(car);
    }
    poses.forEach((pose, k) => {
      const car = this.traffic[k];
      // smooth the lane change at the crossroads
      car.position.x += (pose.x - car.position.x) * 0.35;
      car.position.z += (pose.z - car.position.z) * 0.35;
      if (Math.hypot(pose.x - car.position.x, pose.z - car.position.z) > 20) car.position.set(pose.x, 0, pose.z);
      let dh = pose.heading - car.rotation.y;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      car.rotation.y += dh * 0.25;
    });
  }

  setMachineStates(states: ReadonlyMap<string, MachineState>): void {
    for (const [id, parts] of this.machineEdges) {
      const st = states.get(id) ?? 'unknown';
      const color = st === 'run' ? this.p.success : st === 'fault' ? this.p.alarm : st === 'stop' ? this.p.neutral : this.p.info;
      (parts.lines.material as LineBasicMaterial).color.setHex(color);
      (parts.roof.material as MeshBasicMaterial).color.setHex(color);
      (parts.beacon.material as MeshBasicMaterial).color.setHex(color);
      parts.beacon.userData.fault = st === 'fault';
    }
  }

  setLights(t: number, overrides: LightOverrides): void {
    const colors = { green: new Color(this.p.success), yellow: new Color(this.p.warning), red: new Color(this.p.alarm) };
    for (const { mesh, axis } of this.lightHeads) {
      this.lightNodes.forEach(({ i, j }, k) => {
        const c = colors[lightAt(i, j, axis, t, overrides)];
        mesh.setColorAt(k * 2, c);
        mesh.setColorAt(k * 2 + 1, c);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }

  setMarker(target: Point | null, kind: MissionKind | null, stage: MissionStage | null): void {
    this.marker.visible = target !== null;
    if (!target) return;
    this.marker.position.set(target.x, 30, target.z);
    const color = kind === 'intervention' ? this.p.alarm : stage === 'drop' ? this.p.success : this.p.warning;
    (this.marker.material as MeshBasicMaterial).color.setHex(color);
  }

  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.corner = null;
    // from the bonnet, the player's own beams would veil the view
    this.player.traverse((o) => {
      if (o.userData.beam) o.visible = mode !== 'hood';
    });
  }

  /** A street-corner camera ahead of the car: the next crossroads, on a sidewalk corner. */
  private pickCorner(pos: Vector3, fx: number, fz: number): Vector3 {
    const ahead = new Vector3(pos.x + fx * CELL * 0.6, 0, pos.z + fz * CELL * 0.6);
    const cx = Math.round(ahead.x / CELL) * CELL;
    const cz = Math.round(ahead.z / CELL) * CELL;
    const side = ROAD_WIDTH / 2 + 2.5;
    // the corner on the car's right, so the car passes in front of the lens
    return new Vector3(cx + (fz >= 0 ? -side : side), 2.2, cz + (fx >= 0 ? side : -side));
  }

  /** Follows the player and renders one frame. */
  render(dt: number, speed: number): void {
    this.elapsed += dt;
    this.street.update(dt);
    const pulse = 0.5 + 0.5 * Math.sin(this.elapsed * 6);
    for (const { beacon, roof } of this.machineEdges.values()) {
      const fault = beacon.userData.fault === true;
      beacon.scale.y = fault ? 0.6 + pulse : 1;
      (roof.material as MeshBasicMaterial).opacity = fault ? 0.2 + 0.5 * pulse : 0.35;
    }
    (this.marker.material as MeshBasicMaterial).opacity = 0.18 + 0.15 * pulse;
    this.marker.rotation.y += dt;

    // the shadow box follows the player, snapped to whole metres (no shimmering)
    this.shadowFollow.set(Math.round(this.player.position.x), 0, Math.round(this.player.position.z));
    this.moon.position.set(this.shadowFollow.x - 120, 220, this.shadowFollow.z - 80);
    this.moon.target.position.copy(this.shadowFollow);
    const h = this.player.rotation.y;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const pos = this.player.position;
    const want = new Vector3();
    const look = new Vector3();
    let stiffness = 6;
    let fov = 62 + Math.min(14, Math.abs(speed) * 0.3);
    switch (this.cameraMode) {
      case 'chase': {
        const back = 11 + Math.min(6, Math.abs(speed) * 0.12);
        want.set(pos.x - fx * back, 4.6 + Math.min(2, Math.abs(speed) * 0.04), pos.z - fz * back);
        look.set(pos.x + fx * 6, 1.6, pos.z + fz * 6);
        break;
      }
      case 'street': {
        // low and close: the shops, signs and pedestrians fill the frame
        const back = 6.5 + Math.min(3, Math.abs(speed) * 0.06);
        want.set(pos.x - fx * back, 1.25, pos.z - fz * back);
        look.set(pos.x + fx * 10, 2.4, pos.z + fz * 10);
        fov += 8;
        break;
      }
      case 'hood': {
        // on the bonnet, in front of the windscreen
        const ahead = this.playerBody.l / 2 - 1.1;
        want.set(pos.x + fx * ahead, headlightY(this.playerBody) + 0.95, pos.z + fz * ahead);
        look.set(pos.x + fx * 30, 1.6, pos.z + fz * 30);
        stiffness = 30;
        fov += 6;
        break;
      }
      case 'drone': {
        const a = this.elapsed * 0.25;
        want.set(pos.x + Math.sin(a) * 22, 16, pos.z + Math.cos(a) * 22);
        look.set(pos.x, 1.2, pos.z);
        stiffness = 3;
        fov = 55;
        break;
      }
      case 'corner': {
        if (!this.corner || this.corner.distanceTo(pos) > CELL * 0.9) this.corner = this.pickCorner(pos, fx, fz);
        want.copy(this.corner);
        look.set(pos.x, 1.2, pos.z);
        stiffness = 40; // a fixed camera: no glide
        fov = 50;
        break;
      }
      default: {
        want.set(pos.x - fx * 0.1, 140, pos.z - fz * 0.1);
        look.copy(pos);
      }
    }
    const k = 1 - Math.exp(-dt * stiffness);
    if (this.camPos.lengthSq() === 0) {
      this.camPos.copy(want);
      this.camLook.copy(look);
    }
    this.camPos.lerp(want, k);
    this.camLook.lerp(look, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.composer.render(dt);
  }

  resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
      const mat = m.material as Material | Material[] | undefined;
      (Array.isArray(mat) ? mat : mat ? [mat] : []).forEach((x) => x.dispose());
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
