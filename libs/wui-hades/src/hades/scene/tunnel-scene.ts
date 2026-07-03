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
 *
 * Two render STYLES (selectable, persisted by the view):
 *  - `simple` — the sober engineering look, tuned bright enough to read;
 *  - `modern` — the marketing look: light concrete, cool white lighting and
 *    continuous cyan LED light-lines swept along both walls and the crown.
 * Optional HTML overlay LABELS (name + state dot) are projected per frame
 * from the equipment anchors; faulty equipment pulses in both styles.
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
import { STATE_FAULT, STATE_RUN, stateColor, tubeEquipment, type EquipmentDef, type Tunnel } from '../types.js';
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

/** Render style of the twin (see class docs). */
export type ViewStyle = 'simple' | 'modern';

interface StylePreset {
  background: number;
  fogNear: number;
  fogFar: number;
  bore: number;
  road: number;
  walkway: number;
  ambient: number;
  hemisphere: number;
  accentColor: number;
  accentIntensity: number;
  /** Cyan LED light-lines along the walls/crown (the Siemens-style look). */
  ribbons: boolean;
}

const STYLES: Record<ViewStyle, StylePreset> = {
  simple: {
    background: 0x1a_20_2b,
    fogNear: 90,
    fogFar: 1500,
    bore: 0x67_6e_7b,
    road: 0x2e_32_3a,
    walkway: 0x4a_50_5c,
    ambient: 0.62,
    hemisphere: 0.75,
    accentColor: 0xff_df_a8,
    accentIntensity: 16,
    ribbons: false
  },
  modern: {
    background: 0x0d_15_20,
    fogNear: 120,
    fogFar: 2000,
    bore: 0x8d_95_a2,
    road: 0x33_38_41,
    walkway: 0x5a_62_70,
    ambient: 0.7,
    hemisphere: 0.85,
    accentColor: 0xcf_ea_ff,
    accentIntensity: 18,
    ribbons: true
  }
};

/** Cyan of the modern light-lines. */
const RIBBON_HEX = 0x2f_d8_ff;
/** Wall light-line heights (m) and the gap kept below the crown for the top line. */
const RIBBON_HEIGHTS_M = [2.45, 2.75];
const CROWN_RIBBON_GAP_M = 0.25;
const RIBBON_WIDTH_M = 0.07;
/** Lateral inset of the wall light-lines from the bore surface (m). */
const RIBBON_INSET_M = 0.15;

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
/** Labels: anchor rise above the equipment and max display distance. */
const LABEL_RISE_M = 1.2;
const LABEL_MAX_DIST_M = 220;

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
  private style: ViewStyle = 'modern';
  private lastTunnel: Tunnel | null = null;
  private readonly ambient = new AmbientLight(0xff_ff_ff, 0.35);
  private readonly hemisphere = new HemisphereLight(0x9a_a8c0, 0x22_26_2e, 0.5);

  // HTML overlay labels (name + state dot), projected per frame.
  private labelHost: HTMLElement | null = null;
  private labelsVisible = false;
  private readonly labels = new Map<string, { el: HTMLElement; dot: HTMLElement; anchor: Vector3 }>();
  private readonly projected = new Vector3();

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
    this.camera = new PerspectiveCamera(50, this.aspect(), 0.3, 4000);

    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.add(this.ambient);
    this.scene.add(this.hemisphere);
    const portal = new DirectionalLight(0xff_f2d0, 0.7);
    portal.position.set(40, 80, -60);
    this.scene.add(portal);
    this.scene.add(this.root);
    this.applyStyleEnvironment();

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', this.onContextMenu);
    this.resize();
    this.applyOrbit();
  }

  // --- public API ------------------------------------------------------------

  /** Switch the render style and rebuild (keeps camera pose). */
  setStyle(style: ViewStyle): void {
    if (style === this.style) return;
    this.style = style;
    this.applyStyleEnvironment();
    if (this.lastTunnel) this.rebuild(this.lastTunnel);
  }

  get currentStyle(): ViewStyle {
    return this.style;
  }

  /** Host element for the HTML overlay labels (positioned over the canvas). */
  setLabelHost(host: HTMLElement): void {
    this.labelHost = host;
  }

  /** Show/hide the equipment name labels. */
  setLabelsVisible(visible: boolean): void {
    this.labelsVisible = visible;
    if (!visible) for (const label of this.labels.values()) label.el.style.display = 'none';
  }

  get areLabelsVisible(): boolean {
    return this.labelsVisible;
  }

  /** Rebuild the whole scene from the tunnel configuration. */
  setTunnel(tunnel: Tunnel): void {
    this.lastTunnel = tunnel;
    this.rebuild(tunnel);
    this.frameTunnel();
  }

  private rebuild(tunnel: Tunnel): void {
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
    this.rebuildLabels(tunnel);
    this.updateStates(tunnel);
  }

  /** (Re)apply background, fog and light intensities from the style preset. */
  private applyStyleEnvironment(): void {
    const preset = STYLES[this.style];
    this.scene.background = new Color(preset.background);
    this.scene.fog = new Fog(preset.background, preset.fogNear, preset.fogFar);
    this.ambient.intensity = preset.ambient;
    this.hemisphere.intensity = preset.hemisphere;
  }

  /** Recolour the equipment primitives + label dots from the live state codes. */
  updateStates(tunnel: Tunnel): void {
    for (const equipment of tunnel.equipment) {
      const group = this.equipmentGroups.get(equipment.id);
      if (!group) continue;
      applyState(group, equipment.state);
      const data = group.userData as Partial<EquipmentSceneData> & { state?: number };
      data.state = equipment.state;
      const label = this.labels.get(equipment.id);
      if (label) label.dot.style.background = stateColor(equipment.state);
    }
  }

  /** One overlay label (name + state dot) per equipment, anchored above it. */
  private rebuildLabels(tunnel: Tunnel): void {
    const host = this.labelHost;
    for (const label of this.labels.values()) label.el.remove();
    this.labels.clear();
    if (!host) return;
    for (const equipment of tunnel.equipment) {
      const group = this.equipmentGroups.get(equipment.id);
      if (!group) continue;
      const el = document.createElement('button');
      el.className = 'hd-3d-label';
      el.style.display = 'none';
      const dot = document.createElement('span');
      dot.className = 'hd-3d-label-dot';
      dot.style.background = stateColor(equipment.state);
      el.append(dot, document.createTextNode(equipment.name));
      el.addEventListener('click', () => this.onSelect(equipment.id));
      host.append(el);
      const anchor = new Vector3();
      group.getWorldPosition(anchor);
      anchor.y += LABEL_RISE_M;
      this.labels.set(equipment.id, { el, dot, anchor });
    }
  }

  /** Project every label to screen space (called each rendered frame). */
  private updateLabels(): void {
    if (!this.labelsVisible || !this.labelHost) return;
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    const cameraPos = this.camera.position;
    for (const label of this.labels.values()) {
      const distance = label.anchor.distanceTo(cameraPos);
      this.projected.copy(label.anchor).project(this.camera);
      const visible =
        distance < LABEL_MAX_DIST_M &&
        this.projected.z < 1 &&
        Math.abs(this.projected.x) < 1 &&
        Math.abs(this.projected.y) < 1;
      if (!visible) {
        label.el.style.display = 'none';
        continue;
      }
      label.el.style.display = '';
      label.el.style.left = `${((this.projected.x + 1) / 2) * width}px`;
      label.el.style.top = `${((1 - this.projected.y) / 2) * height}px`;
      // Fade with distance so far labels don't clutter the view.
      label.el.style.opacity = String(Math.max(0.35, 1 - distance / LABEL_MAX_DIST_M));
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
    for (const label of this.labels.values()) label.el.remove();
    this.labels.clear();
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
    const preset = STYLES[this.style];
    const bore = new Mesh(
      buildBoreGeometry(frames, section),
      new MeshStandardMaterial({ color: preset.bore, roughness: 0.92, metalness: 0.02, side: BackSide })
    );
    const roadHalf = section.halfWidthM - 1;
    const road = new Mesh(
      buildRibbonGeometry(frames, roadHalf, 0.02),
      new MeshStandardMaterial({ color: preset.road, roughness: 0.95, side: DoubleSide })
    );
    group.add(bore, road);
    for (const side of [-1, 1]) {
      const walkway = new Mesh(
        buildRibbonGeometry(frames, 0.5, 0.14, side * (section.halfWidthM - 0.5)),
        new MeshStandardMaterial({ color: preset.walkway, roughness: 0.9, side: DoubleSide })
      );
      group.add(walkway);
    }
    if (preset.ribbons) this.buildLightLines(group, frames, section);
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
   * The « modern » signature: continuous cyan LED light-lines swept along both
   * walls (two heights) and under the crown — emissive, fog-free, unlit
   * materials so they read as light sources without post-processing.
   */
  private buildLightLines(group: Group, frames: Frame[], section: CrossSection): void {
    const material = new MeshStandardMaterial({
      color: RIBBON_HEX,
      emissive: RIBBON_HEX,
      emissiveIntensity: 2.2,
      roughness: 0.3,
      metalness: 0,
      fog: false,
      side: DoubleSide
    });
    const lateral = section.halfWidthM - RIBBON_INSET_M;
    for (const side of [-1, 1]) {
      for (const height of RIBBON_HEIGHTS_M) {
        group.add(new Mesh(buildRibbonGeometry(frames, RIBBON_WIDTH_M, height, side * lateral), material));
      }
    }
    // Crown line, centred under the vault.
    group.add(
      new Mesh(
        buildRibbonGeometry(frames, RIBBON_WIDTH_M * 1.6, section.crownHeightM - CROWN_RIBBON_GAP_M, 0),
        material
      )
    );
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
      const preset = STYLES[this.style];
      const light = new PointLight(preset.accentColor, preset.accentIntensity, 90, 1.6);
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
    this.pulseFaults();
    this.updateLabels();
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

  /** Faulty equipment pulses (emissive breathing) so it catches the eye. */
  private pulseFaults(): void {
    const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 260);
    for (const group of this.equipmentGroups.values()) {
      const data = group.userData as Partial<EquipmentSceneData> & { state?: number };
      if (!data.statusMaterial) continue;
      data.statusMaterial.emissiveIntensity = data.state === STATE_FAULT ? 0.4 + pulse : 0.55;
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
