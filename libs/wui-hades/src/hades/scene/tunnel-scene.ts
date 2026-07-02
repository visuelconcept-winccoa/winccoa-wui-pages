// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Scene engine of the tunnel digital twin: owns the Three.js renderer / scene /
 * camera, sweeps the bore + roadway from the segment list (tunnel-geometry),
 * places the equipment primitives at their PK/side (equipment-meshes), and
 * drives two camera modes — a free ORBIT (left-drag rotate, right-drag pan,
 * wheel zoom) and a DRIVE mode that glides the camera along the centerline
 * like a vehicle. Left-click raycasts an equipment and reports its id to the
 * page. The Lit view is a thin driver over this class.
 */
import {
  AmbientLight,
  Color,
  ConeGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  BackSide,
  DoubleSide,
  PerspectiveCamera,
  PointLight,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { STATE_RUN, tubeEquipment, type EquipmentDef, type Tunnel } from '../types.js';
import { disposeObject } from './dispose.js';
import { applyState, buildEquipmentMesh, type EquipmentSceneData } from './equipment-meshes.js';
import {
  buildBoreGeometry,
  buildRibbonGeometry,
  crossSection,
  frameAt,
  rightOf,
  sampleCenterline,
  worldAt,
  type CrossSection,
  type Frame
} from './tunnel-geometry.js';

const BACKGROUND_HEX = 0x10_14_1b;
const FOG_NEAR_M = 60;
const FOG_FAR_M = 900;
const BORE_HEX = 0x4a_50_5c;
const ROAD_HEX = 0x23_26_2c;
const WALKWAY_HEX = 0x3a_3f_49;
const MARKING_HEX = 0xd0_d4_da;
/** Lateral gap between the bores of a multi-tube tunnel (m). */
const TUBE_GAP_M = 10;
/** Interval between the ambience point lights along the tube (m). */
const ACCENT_EVERY_M = 180;
const ACCENT_MAX = 20;
const DRIVE_SPEED_M_S = 14;
/** Interval between painted lane-direction arrows (m). */
const ARROW_EVERY_M = 120;
/** Spheres composing the drill smoke cloud. */
const SMOKE_PUFFS = 9;
const SMOKE_LERP = 0.8;
const DRIVE_EYE_HEIGHT_M = 2.2;
const DRIVE_LOOK_AHEAD_M = 30;

const MIN_PHI = 0.05;
const MAX_PHI = Math.PI / 2 - 0.02;
const MIN_RADIUS = 6;
const MAX_RADIUS = 2500;
const ORBIT_SPEED = 0.005;
const PAN_FACTOR = 0.0016;
const ZOOM_STEP = 0.0011;
const DRAG_THRESHOLD_PX = 5;
/** Height of wall-mounted equipment above the roadway (m). */
const WALL_MOUNT_M = 1.4;
/** Clearance kept between ceiling equipment and the vault crown (m). */
const CROWN_CLEARANCE_M = 0.7;
/** Lateral inset of wall-mounted equipment from the bore wall (m). */
const WALL_INSET_M = 0.7;

interface TubeScene {
  tubeId: string;
  frames: Frame[];
  section: CrossSection;
  /** World-space lateral offset applied to this bore (multi-tube layout). */
  offset: Vector3;
  group: Group;
}

export class TunnelScene {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();

  private readonly root = new Group();
  private tubes: TubeScene[] = [];
  private readonly equipmentGroups = new Map<string, Group>();

  // Exercise smoke (drill visualisation).
  private smokeGroup: Group | null = null;
  private smokeIntensity = 0;
  private smokeTarget = 0;

  // Orbit state.
  private readonly target = new Vector3(0, 3, 60);
  private theta = Math.PI / 3;
  private phi = 1.1;
  private radius = 220;
  private dragButton = -1;
  private lastX = 0;
  private lastY = 0;
  private downX = 0;
  private downY = 0;

  // Drive mode.
  private driving = false;
  private drivePkM = 0;
  private driveTubeIndex = 0;

  private raf = 0;
  private running = false;
  private lastTick = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly host: HTMLElement,
    private readonly onSelect: (equipmentId: string) => void
  ) {
    this.scene.background = new Color(BACKGROUND_HEX);
    this.scene.fog = new Fog(BACKGROUND_HEX, FOG_NEAR_M, FOG_FAR_M);
    this.camera = new PerspectiveCamera(50, this.aspect(), 0.3, 4000);

    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.add(new AmbientLight(0xff_ff_ff, 0.35));
    this.scene.add(new HemisphereLight(0x9a_a8c0, 0x22_26_2e, 0.5));
    const portal = new DirectionalLight(0xff_f2d0, 0.7);
    portal.position.set(40, 80, -60);
    this.scene.add(portal);
    this.scene.add(this.root);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    this.resize();
    this.applyOrbit();
  }

  // --- public API ------------------------------------------------------------

  /** Rebuild the whole scene from the tunnel configuration. */
  setTunnel(tunnel: Tunnel): void {
    this.root.clear();
    for (const tube of this.tubes) disposeObject(tube.group);
    this.tubes = [];
    this.equipmentGroups.clear();

    for (const [index, tube] of tunnel.tubes.entries()) {
      const frames = sampleCenterline(tube);
      const section = crossSection(tube);
      const offset = new Vector3(index * (section.halfWidthM * 2 + TUBE_GAP_M), 0, 0);
      const group = new Group();
      group.position.copy(offset);
      this.buildBore(group, frames, section, tube.lanes);
      this.buildDirectionArrows(group, frames, section, tube.lanes, tube.direction === 'bidirectional');
      this.buildAccents(group, frames, section);
      for (const equipment of tubeEquipment(tunnel, tube.id)) {
        this.placeEquipment(group, frames, section, equipment);
      }
      this.root.add(group);
      this.tubes.push({ tubeId: tube.id, frames, section, offset, group });
    }
    this.frameTunnel();
    this.updateStates(tunnel);
  }

  /** Recolour the equipment primitives from the live state codes. */
  updateStates(tunnel: Tunnel): void {
    for (const equipment of tunnel.equipment) {
      const group = this.equipmentGroups.get(equipment.id);
      if (!group) continue;
      applyState(group, equipment.state);
      const data = group.userData as Partial<EquipmentSceneData> & { state?: number };
      data.state = equipment.state;
    }
  }

  /** Frame the orbit camera on one equipment. */
  flyTo(equipmentId: string): void {
    const group = this.equipmentGroups.get(equipmentId);
    if (!group) return;
    this.driving = false;
    group.getWorldPosition(this.target);
    this.radius = 26;
    this.applyOrbit();
  }

  /** Toggle the drive-through camera (starts at the tube portal). */
  setDriving(driving: boolean, tubeIndex = 0): void {
    this.driving = driving;
    this.driveTubeIndex = Math.min(tubeIndex, this.tubes.length - 1);
    if (driving) this.drivePkM = 0;
    else this.applyOrbit();
  }

  get isDriving(): boolean {
    return this.driving;
  }

  /** Reset the orbit camera to frame the whole tunnel. */
  frameTunnel(): void {
    const first = this.tubes[0];
    if (!first) return;
    const mid = frameAt(first.frames, (first.frames.at(-1)?.pkM ?? 0) / 2);
    this.target.copy(mid.position).add(first.offset);
    this.radius = Math.min(MAX_RADIUS, Math.max(120, (first.frames.at(-1)?.pkM ?? 300) * 0.28));
    this.theta = Math.PI / 3;
    this.phi = 1.1;
    this.applyOrbit();
  }

  /**
   * Drill smoke at a PK of the first tube: a cluster of dark, semi-transparent
   * spheres whose size/opacity follow `intensity` (0 clears the cloud).
   */
  setSmoke(pkM: number, intensity: number): void {
    this.smokeTarget = Math.min(1, Math.max(0, intensity));
    if (this.smokeTarget === 0) return;
    if (!this.smokeGroup) {
      this.smokeGroup = new Group();
      for (let i = 0; i < SMOKE_PUFFS; i++) {
        const puff = new Mesh(
          new SphereGeometry(1, 10, 10),
          new MeshStandardMaterial({ color: 0x14_16_1a, transparent: true, opacity: 0, roughness: 1 })
        );
        // Deterministic pseudo-random spread (no Math.random: stable scenes).
        puff.position.set(((i * 37) % 11) - 5, 1.5 + ((i * 13) % 5) * 0.8, ((i * 53) % 17) - 8);
        this.smokeGroup.add(puff);
      }
      this.root.add(this.smokeGroup);
    }
    const tube = this.tubes[0];
    if (tube) {
      const anchor = worldAt(tube.frames, pkM, 0, 1);
      this.smokeGroup.position.copy(anchor).add(tube.offset);
    }
  }

  clearSmoke(): void {
    this.smokeTarget = 0;
    this.smokeIntensity = 0;
    if (this.smokeGroup) {
      this.root.remove(this.smokeGroup);
      disposeObject(this.smokeGroup);
      this.smokeGroup = null;
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTick = performance.now();
    const loop = (now: number): void => {
      if (!this.running) return;
      const dt = Math.min(0.1, (now - this.lastTick) / 1000);
      this.lastTick = now;
      this.tick(dt);
      this.renderer.render(this.scene, this.camera);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    const width = this.host.clientWidth || 1;
    const height = this.host.clientHeight || 1;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('click', this.onClick);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    for (const tube of this.tubes) disposeObject(tube.group);
    disposeObject(this.scene);
    this.renderer.dispose();
  }

  // --- construction ----------------------------------------------------------

  private buildBore(group: Group, frames: Frame[], section: CrossSection, lanes: number): void {
    const bore = new Mesh(
      buildBoreGeometry(frames, section),
      new MeshStandardMaterial({ color: BORE_HEX, roughness: 0.92, metalness: 0.02, side: BackSide })
    );
    const roadHalf = section.halfWidthM - 1;
    const road = new Mesh(
      buildRibbonGeometry(frames, roadHalf, 0.02),
      new MeshStandardMaterial({ color: ROAD_HEX, roughness: 0.95, side: DoubleSide })
    );
    group.add(bore, road);
    for (const side of [-1, 1]) {
      const walkway = new Mesh(
        buildRibbonGeometry(frames, 0.5, 0.14, side * (section.halfWidthM - 0.5)),
        new MeshStandardMaterial({ color: WALKWAY_HEX, roughness: 0.9, side: DoubleSide })
      );
      group.add(walkway);
    }
    for (let lane = 1; lane < lanes; lane++) {
      const offset = -roadHalf + (2 * roadHalf * lane) / lanes;
      const marking = new Mesh(
        buildRibbonGeometry(frames, 0.08, 0.03, offset),
        new MeshStandardMaterial({ color: MARKING_HEX, roughness: 0.6, side: DoubleSide })
      );
      group.add(marking);
    }
  }

  /**
   * Painted direction arrows per lane: cones lying on the roadway, pointing
   * along the tube in a unidirectional bore and half/half in a bidirectional
   * one (left lanes flow against the PK axis, like a real counter-flow tube).
   */
  private buildDirectionArrows(
    group: Group,
    frames: Frame[],
    section: CrossSection,
    lanes: number,
    bidirectional: boolean
  ): void {
    const lengthM = frames.at(-1)?.pkM ?? 0;
    const roadHalf = section.halfWidthM - 1;
    const material = new MeshStandardMaterial({ color: MARKING_HEX, roughness: 0.6 });
    for (let lane = 0; lane < lanes; lane++) {
      const lateral = -roadHalf + (roadHalf * (2 * lane + 1)) / lanes;
      // In a bidirectional tube the left half flows backwards (counter-flow).
      const backwards = bidirectional && lane < lanes / 2;
      for (let pk = ARROW_EVERY_M / 2; pk < lengthM; pk += ARROW_EVERY_M) {
        const arrow = new Mesh(new ConeGeometry(0.35, 1.6, 8), material);
        const frame = frameAt(frames, pk);
        arrow.position.copy(worldAt(frames, pk, lateral, 0.06));
        // A cone points +Y by default; lay it flat along (±) the local tangent.
        const along = frame.tangent.clone().multiplyScalar(backwards ? -1 : 1);
        arrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), along);
        group.add(arrow);
      }
    }
  }

  /** Sparse warm point lights along the vault for depth perception. */
  private buildAccents(group: Group, frames: Frame[], section: CrossSection): void {
    const lengthM = frames.at(-1)?.pkM ?? 0;
    const count = Math.min(ACCENT_MAX, Math.floor(lengthM / ACCENT_EVERY_M) + 1);
    for (let i = 0; i <= count; i++) {
      const pk = (lengthM * i) / Math.max(1, count);
      const light = new PointLight(0xff_dfa8, 14, 90, 1.6);
      light.position.copy(worldAt(frames, pk, 0, section.crownHeightM - 1));
      group.add(light);
    }
  }

  private placeEquipment(group: Group, frames: Frame[], section: CrossSection, equipment: EquipmentDef): void {
    const mesh = buildEquipmentMesh(equipment.kind, equipment.id);
    let lateral = 0;
    let height = WALL_MOUNT_M;
    switch (equipment.side) {
      case 'left':
        lateral = -(section.halfWidthM - WALL_INSET_M);
        break;
      case 'right':
        lateral = section.halfWidthM - WALL_INSET_M;
        break;
      case 'ceiling':
        height = section.crownHeightM - CROWN_CLEARANCE_M;
        break;
      case 'roadway':
        lateral = section.halfWidthM - 1.6;
        height = 0.6;
        break;
    }
    if (equipment.kind === 'emergency-exit') height = 1.1;
    mesh.position.copy(worldAt(frames, equipment.pkM, lateral, height));
    // Face the tube axis: align the group with the local tangent.
    const frame = frameAt(frames, equipment.pkM);
    mesh.lookAt(mesh.position.clone().add(frame.tangent));
    group.add(mesh);
    this.equipmentGroups.set(equipment.id, mesh);
  }

  // --- camera ----------------------------------------------------------------

  private aspect(): number {
    return (this.host.clientWidth || 1) / (this.host.clientHeight || 1);
  }

  private applyOrbit(): void {
    this.phi = Math.min(MAX_PHI, Math.max(MIN_PHI, this.phi));
    this.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, this.radius));
    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.cos(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.sin(this.theta)
    );
    this.camera.lookAt(this.target);
  }

  private tick(dt: number): void {
    this.spinFans(dt);
    this.animateSmoke(dt);
    if (!this.driving) return;
    const tube = this.tubes[this.driveTubeIndex] ?? this.tubes[0];
    if (!tube) return;
    const lengthM = tube.frames.at(-1)?.pkM ?? 0;
    this.drivePkM += DRIVE_SPEED_M_S * dt;
    if (this.drivePkM > lengthM) this.drivePkM = 0;
    const eye = frameAt(tube.frames, this.drivePkM);
    const look = frameAt(tube.frames, Math.min(lengthM, this.drivePkM + DRIVE_LOOK_AHEAD_M));
    const lane = rightOf(eye).multiplyScalar(-1.5);
    this.camera.position
      .copy(eye.position)
      .add(tube.offset)
      .add(lane)
      .add(new Vector3(0, DRIVE_EYE_HEIGHT_M, 0));
    this.camera.lookAt(look.position.clone().add(tube.offset).add(new Vector3(0, DRIVE_EYE_HEIGHT_M, 0)));
  }

  private animateSmoke(dt: number): void {
    if (!this.smokeGroup) return;
    this.smokeIntensity += (this.smokeTarget - this.smokeIntensity) * Math.min(1, dt * SMOKE_LERP);
    for (const [i, puff] of this.smokeGroup.children.entries()) {
      const mesh = puff as Mesh;
      const pulse = 1 + 0.15 * Math.sin(performance.now() / 900 + i);
      const scale = (1.5 + i * 0.5) * this.smokeIntensity * pulse;
      mesh.scale.setScalar(Math.max(0.001, scale));
      (mesh.material as MeshStandardMaterial).opacity = 0.55 * this.smokeIntensity;
    }
  }

  private spinFans(dt: number): void {
    for (const group of this.equipmentGroups.values()) {
      const data = group.userData as Partial<EquipmentSceneData> & { state?: number };
      if (data.spin && data.state === STATE_RUN) data.spin.rotation.z += dt * 12;
    }
  }

  // --- pointer handlers --------------------------------------------------------

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragButton = event.button;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    this.downX = event.clientX;
    this.downY = event.clientY;
    const move = (e: PointerEvent): void => this.onPointerMove(e);
    const up = (): void => {
      this.dragButton = -1;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  private onPointerMove(event: PointerEvent): void {
    if (this.dragButton === -1 || this.driving) return;
    const dx = event.clientX - this.lastX;
    const dy = event.clientY - this.lastY;
    this.lastX = event.clientX;
    this.lastY = event.clientY;
    if (this.dragButton === 0) {
      this.theta += dx * ORBIT_SPEED;
      this.phi -= dy * ORBIT_SPEED;
    } else {
      const pan = this.radius * PAN_FACTOR;
      const forward = new Vector3().subVectors(this.target, this.camera.position).setY(0).normalize();
      const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0));
      this.target.addScaledVector(right, dx * pan);
      this.target.addScaledVector(forward, dy * pan);
    }
    this.applyOrbit();
  }

  private readonly onWheel = (event: WheelEvent): void => {
    if (this.driving) return;
    event.preventDefault();
    this.radius *= 1 + event.deltaY * ZOOM_STEP;
    this.applyOrbit();
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onClick = (event: MouseEvent): void => {
    // Ignore clicks that ended a drag.
    if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > DRAG_THRESHOLD_PX) return;
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.equipmentGroups.values()], true);
    for (const hit of hits) {
      const id = this.ownerId(hit.object);
      if (id) {
        this.onSelect(id);
        return;
      }
    }
  };

  private ownerId(object: { parent: unknown; userData?: unknown }): string | null {
    let node: { parent: unknown; userData?: unknown } | null = object;
    while (node) {
      const data = node.userData as Partial<EquipmentSceneData> | undefined;
      if (data?.equipmentId) return data.equipmentId;
      node = node.parent as { parent: unknown; userData?: unknown } | null;
    }
    return null;
  }
}
