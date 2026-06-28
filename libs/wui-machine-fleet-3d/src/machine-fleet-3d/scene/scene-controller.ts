// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Scene engine: owns the Three.js renderer/scene/camera/lights, builds the
 * building and machines, drives the orbit camera, the HTML labels, and the
 * proximity-assigned accent-light pool. The Lit page is a thin driver over this.
 *
 * Ported from the prototype's scene setup, `updateAccentLights`, `addMachine`
 * and `tick`, scoped to a single instance (no module-level globals).
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PCFSoftShadowMap,
  Plane,
  OrthographicCamera,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Raycaster,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import {
  DEFAULT_BUILDING,
  type AccentConfig,
  type BuildingConfig,
  type Kpi,
  type Machine,
  type MachineDef,
  type MachineState,
  type StateColorKey
} from '../types.js';
import { BuildingBuilder } from './building-builder.js';
import { disposeObject } from './dispose.js';
import { LabelManager } from './label-manager.js';
import { MachineMaterials } from './machine-materials.js';
import { BILLBOARD_CHILD, applyBillboardTexture, buildMachine } from './machine-factory.js';
import { OrbitController } from './orbit-controller.js';

const ACCENT_POOL_SIZE = 6;
const DRAG_THRESHOLD_PX = 5;
/** If the longest GLB dimension exceeds this (metres), assume mm → scale by 0.001. */
const MM_TO_M_THRESHOLD = 100;
const MM_TO_M_SCALE = 0.001;

export class SceneController {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  /** Orthographic camera for the "2D" (plan) mode; mirrors the orbit pose. */
  private readonly orthoCamera: OrthographicCamera;
  private cameraMode: '3d' | '2d' = '3d';
  private readonly renderer: WebGLRenderer;
  private readonly orbit: OrbitController;
  private readonly labels: LabelManager;
  private readonly materials = new MachineMaterials();
  private readonly builder = new BuildingBuilder();
  private readonly gltfLoader = new GLTFLoader();
  private readonly accentPool: PointLight[] = [];
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly billboardQuat = new Quaternion();

  private buildingGroup: Group | null = null;
  private roofGroup: Group | null = null;
  private machinesGroup = new Group();
  private machines: Machine[] = [];
  private cfg: BuildingConfig = { ...DEFAULT_BUILDING };
  private resourceResolver: ((ref: string) => Promise<string | undefined>) | null = null;
  private onMachineMove: ((id: string, x: number, z: number) => void) | null = null;

  private raf = 0;
  private running = false;
  private downX = 0;
  private downY = 0;

  // --- edit-mode dragging ----------------------------------------------------
  private editMode = false;
  private dragging: Machine | null = null;
  private dragMoved = false;
  private readonly dragPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly dragPoint = new Vector3();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    overlay: HTMLElement,
    private readonly host: HTMLElement,
    private readonly onSelect: (id: string) => void
  ) {
    this.scene.background = new Color(0xC6_D0_DB);
    this.scene.fog = new Fog(0xC6_D0_DB, 700, 2000);

    this.camera = new PerspectiveCamera(45, this.aspect(), 0.5, 2000);
    this.camera.position.set(180, 140, 180);
    this.orthoCamera = new OrthographicCamera(-100, 100, 100, -100, 0.5, 4000);

    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.addLights();
    this.scene.add(this.machinesGroup);
    // Support gltfpack/meshopt-compressed GLBs (as the prototype did).
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    this.orbit = new OrbitController(this.camera, canvas);
    this.labels = new LabelManager(overlay, onSelect);

    canvas.addEventListener('pointerdown', this.onCanvasDown);
    canvas.addEventListener('click', this.onCanvasClick);
    // Capture phase so a machine drag in edit mode pre-empts the orbit camera.
    canvas.addEventListener('pointerdown', this.onEditDown, { capture: true });

    this.resize();
  }

  // --- public API ----------------------------------------------------------

  setBuilding(cfg: BuildingConfig): void {
    this.cfg = { ...cfg };
    if (this.buildingGroup) {
      this.scene.remove(this.buildingGroup);
      disposeObject(this.buildingGroup);
    }
    const result = this.builder.build(this.cfg);
    this.buildingGroup = result.group;
    this.roofGroup = result.roofGroup;
    this.scene.add(this.buildingGroup);
    // Feed the building footprint to the label layout so bubbles are kept
    // outside the building's projected silhouette (centred at the origin).
    this.labels.setBuildingBounds({
      x1: -this.cfg.length / 2,
      x2: this.cfg.length / 2,
      z1: -this.cfg.width / 2,
      z2: this.cfg.width / 2,
      height: this.cfg.height
    });
  }

  setMachines(defs: MachineDef[]): void {
    this.scene.remove(this.machinesGroup);
    disposeObject(this.machinesGroup);
    this.machinesGroup = new Group();
    this.scene.add(this.machinesGroup);
    this.machines = defs.map((def) => this.createMachine(def));
    this.labels.setMachines(this.machines);
  }

  setRoofVisible(visible: boolean): void {
    if (this.roofGroup) this.roofGroup.visible = visible;
  }

  setLabelsEnabled(on: boolean): void {
    this.labels.setEnabled(on);
  }

  setAlertOnly(on: boolean): void {
    this.labels.setAlertOnly(on);
  }

  setStateColors(colors: Record<StateColorKey, string>): void {
    this.labels.setStateColors(colors);
  }

  /** Switch the scene camera type: '3d' = perspective, '2d' = orthographic. */
  setCameraMode(mode: '3d' | '2d'): void {
    this.cameraMode = mode;
  }

  /** Notified when the user rotates the camera (left-drag or nav arrows). */
  setOnRotate(cb: () => void): void {
    this.orbit.onRotate = cb;
  }

  focusMachine(id: string): void {
    const m = this.machines.find((x) => x.id === id);
    // Hidden machines are not drawn in the scene, so there is nothing to frame —
    // keep the current viewpoint (the popup still opens via the selection).
    if (!m || m.hidden) return;
    // Frame the whole machine: fit its current bounding sphere into the view
    // frustum, rather than flying to a fixed (too-close) offset.
    const box = new Box3().setFromObject(m.mesh);
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const radius = 0.5 * Math.hypot(size.x, size.y, size.z) || 5;
    const halfV = ((this.camera.fov * Math.PI) / 180) / 2;
    const halfH = Math.atan(Math.tan(halfV) * this.camera.aspect);
    const FIT_MARGIN = 1.3;
    const dist = (radius / Math.min(Math.sin(halfV), Math.sin(halfH))) * FIT_MARGIN;
    const dir = new Vector3(1, 0.75, 1).normalize();
    const pos = center.clone().add(dir.multiplyScalar(dist));
    this.orbit.setFocus([pos.x, pos.y, pos.z], [center.x, center.y, center.z]);
  }

  resetView(): void {
    this.orbit.reset();
  }

  orbitBy(dTheta: number, dPhi: number): void {
    this.orbit.orbitBy(dTheta, dPhi);
  }

  zoomBy(factor: number): void {
    this.orbit.zoomBy(factor);
  }

  panBy(dx: number, dy: number): void {
    this.orbit.panBy(dx, dy);
  }

  setView(preset: 'top' | 'front' | 'side' | 'iso'): void {
    this.orbit.setView(preset);
  }

  /** Capture the current camera pose (to save as a viewpoint). */
  captureView(): { pos: [number, number, number]; target: [number, number, number] } {
    return this.orbit.getPose();
  }

  /** Restore a saved camera pose. */
  applyView(pos: [number, number, number], target: [number, number, number]): void {
    this.orbit.setFocus(pos, target);
  }

  getMachine(id: string): Machine | undefined {
    return this.machines.find((m) => m.id === id);
  }

  /** Provide a resolver that turns a `dp:<name>` GLB reference into a loadable URL. */
  /** Resolver for DP-backed resource refs (GLB models and billboard icons). */
  setResourceResolver(fn: (ref: string) => Promise<string | undefined>): void {
    this.resourceResolver = fn;
  }

  /** Toggle edit mode: drag machines on the floor plane instead of orbiting. */
  setEditMode(on: boolean): void {
    this.editMode = on;
    this.canvas.style.cursor = on ? 'move' : '';
  }

  /** Callback invoked when a machine is dropped at a new (x, z) in edit mode. */
  setOnMachineMove(fn: (id: string, x: number, z: number) => void): void {
    this.onMachineMove = fn;
  }

  /** Push live datapoint-driven updates (state / KPI / production info) onto a machine. */
  updateMachineLive(
    id: string,
    patch: {
      state?: MachineState;
      kpis?: Kpi[];
      stopCause?: string | number;
      stopCauseLabel?: string;
      workOrder?: string | number;
      operation?: string | number;
      connected?: boolean;
      tiltAngle?: number;
      kpiCalcValues?: Record<string, number>;
      kpiCalcColors?: Record<string, string>;
      aliRiskScore?: number;
      aliRiskLabel?: string;
      aliRiskColor?: string;
    }
  ): void {
    const m = this.machines.find((x) => x.id === id);
    if (!m) return;
    if (patch.tiltAngle !== undefined) {
      m.tiltAngle = patch.tiltAngle;
      // Negative rotation about X lifts the front of the floor-hinged cradle.
      const tiltGroup = m.mesh.getObjectByName('mf-tilt');
      if (tiltGroup) tiltGroup.rotation.x = -((patch.tiltAngle * Math.PI) / 180);
    }
    if (patch.state) m.state = patch.state;
    if (patch.kpis) m.kpis = patch.kpis;
    if (patch.stopCause !== undefined) m.stopCause = patch.stopCause;
    if (patch.stopCauseLabel !== undefined) m.stopCauseLabel = patch.stopCauseLabel;
    if (patch.workOrder !== undefined) m.workOrder = patch.workOrder;
    if (patch.operation !== undefined) m.operation = patch.operation;
    if (patch.connected !== undefined) m.connected = patch.connected;
    if (patch.kpiCalcValues !== undefined) m.kpiCalcValues = patch.kpiCalcValues;
    if (patch.kpiCalcColors !== undefined) m.kpiCalcColors = patch.kpiCalcColors;
    // Assign on key presence (not value) so a removed link / missing asset clears it.
    if ('aliRiskScore' in patch) m.aliRiskScore = patch.aliRiskScore;
    if ('aliRiskLabel' in patch) m.aliRiskLabel = patch.aliRiskLabel;
    if ('aliRiskColor' in patch) m.aliRiskColor = patch.aliRiskColor;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.tick();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this.onCanvasDown);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('pointerdown', this.onEditDown, { capture: true });
    window.removeEventListener('pointermove', this.onEditMove);
    window.removeEventListener('pointerup', this.onEditUp);
    this.orbit.dispose();
    this.labels.dispose();
    if (this.buildingGroup) disposeObject(this.buildingGroup);
    disposeObject(this.machinesGroup);
    this.materials.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // --- internals -------------------------------------------------------------

  private aspect(): number {
    const w = this.host?.clientWidth || window.innerWidth;
    const h = this.host?.clientHeight || window.innerHeight;
    return w / h;
  }

  private addLights(): void {
    this.scene.add(new AmbientLight(0xFF_FF_FF, 0.68));
    this.scene.add(new HemisphereLight(0x9A_B0_CC, 0x47_50_5E, 0.6));

    const sun = new DirectionalLight(0xFF_F4_DC, 1.3);
    sun.position.set(120, 220, 80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -180,
      right: 180,
      top: 180,
      bottom: -180,
      near: 10,
      far: 500
    });
    sun.shadow.bias = -0.0005;
    this.scene.add(sun);

    const rim = new DirectionalLight(0xAD_C8_E8, 0.3);
    rim.position.set(-100, 130, -90);
    this.scene.add(rim);

    const fill = new DirectionalLight(0x4A_60_80, 0.15);
    fill.position.set(-40, 40, 120);
    this.scene.add(fill);

    for (let i = 0; i < ACCENT_POOL_SIZE; i++) {
      const pl = new PointLight(0xFF_FF_FF, 0, 20, 2);
      pl.visible = false;
      this.scene.add(pl);
      this.accentPool.push(pl);
    }
  }

  private createMachine(def: MachineDef): Machine {
    const mesh = buildMachine(def, this.materials);
    mesh.position.set(def.x, def.y ?? 0, def.z);
    mesh.rotation.y = ((def.rotationY ?? 0) * Math.PI) / 180;
    mesh.visible = !def.hidden;
    mesh.userData['machineId'] = def.id;
    this.machinesGroup.add(mesh);

    const box = new Box3().setFromObject(mesh);
    const w = Math.max(3, box.max.x - box.min.x);
    const d = Math.max(3, box.max.z - box.min.z);
    const topY = box.max.y + 0.5;

    const machine: Machine = {
      ...def,
      mesh,
      w,
      d,
      topY,
      bbox: { x1: def.x - w / 2, x2: def.x + w / 2, z1: def.z - d / 2, z2: def.z + d / 2 },
      focus: { pos: [def.x + 15, 15, def.z + 15], target: [def.x, 2, def.z] },
      suppressLabel: def.hidden ?? false,
      accentConfig: this.accentConfigFor(def)
    };
    if (def.type === 'glb' && def.glbUrl) this.loadGlb(machine, def.glbUrl);
    if (def.type === 'billboard' && def.billboardUrl) this.loadBillboard(machine, def.billboardUrl);
    return machine;
  }

  /** True for a passthrough (already-loadable) URL — not a `dp:` resource ref. */
  private isDirectUrl(ref: string): boolean {
    return ref.startsWith('data:') || ref.startsWith('http') || ref.startsWith('/');
  }

  /** Resolve the reference if needed, then load the GLB/glTF model. */
  private loadGlb(machine: Machine, ref: string): void {
    if (this.isDirectUrl(ref)) {
      this.loadGlbFromUrl(machine, ref);
    } else if (this.resourceResolver) {
      void this.resourceResolver(ref).then((url) => {
        if (url) this.loadGlbFromUrl(machine, url);
        else this.swapToFallback(machine); // resource deleted
      });
    }
  }

  /** Resolve the reference if needed, then apply the billboard icon texture. */
  private loadBillboard(machine: Machine, ref: string): void {
    if (this.isDirectUrl(ref)) {
      applyBillboardTexture(machine.mesh, ref);
    } else if (this.resourceResolver) {
      void this.resourceResolver(ref).then((url) => {
        if (url) applyBillboardTexture(machine.mesh, url);
        else this.swapToFallback(machine); // resource deleted
      });
    }
  }

  /** Replace a machine whose resource was deleted with a 3D cabinet placeholder. */
  private swapToFallback(machine: Machine): void {
    const old = machine.mesh;
    const fresh = buildMachine({ ...machine, type: 'cabinet' }, this.materials);
    fresh.position.copy(old.position);
    fresh.rotation.copy(old.rotation);
    fresh.visible = old.visible;
    fresh.userData['machineId'] = machine.id;
    this.machinesGroup.add(fresh);
    this.machinesGroup.remove(old);
    disposeObject(old);
    machine.mesh = fresh;
  }

  /** Load a GLB/glTF model into the machine's host group. */
  private loadGlbFromUrl(machine: Machine, url: string): void {
    const onLoad = (gltf: { scene: Group }): void => this.placeGlb(machine, gltf.scene);
    if (url.startsWith('data:')) {
      // Decode the base64 payload and parse it directly — fetching a (possibly
      // huge / odd-mime) data: URL through the loader is unreliable.
      try {
        const buffer = base64ToArrayBuffer(url.slice(url.indexOf(',') + 1));
        this.gltfLoader.parse(buffer, '', onLoad, keepPlaceholderOnError);
      } catch {
        // Keep the placeholder shell on decode failure.
      }
    } else {
      this.gltfLoader.load(url, onLoad, undefined, keepPlaceholderOnError);
    }
  }

  // eslint-disable-next-line max-lines-per-function -- 1:1 port of the prototype's GLB normalisation
  private placeGlb(machine: Machine, root: Group): void {
    // Auto-scale mm → m when the model is modelled in millimetres.
    const size1 = new Box3().setFromObject(root).getSize(new Vector3());
    if (Math.max(size1.x, size1.y, size1.z) > MM_TO_M_THRESHOLD) {
      root.scale.setScalar(MM_TO_M_SCALE);
    }

    // Recentre on X/Z and sit the model on Y = 0.
    const box = new Box3().setFromObject(root);
    const center = box.getCenter(new Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;

    // Shadows + ensure a standard material, preserving vertex colours.
    root.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const geom = mesh.geometry as { attributes?: { color?: unknown } } | undefined;
      const hasColors = Boolean(geom?.attributes?.color);
      const mat = mesh.material as
        | { isMeshStandardMaterial?: boolean; color?: Color; vertexColors?: boolean; needsUpdate?: boolean }
        | undefined;
      if (mat && !mat.isMeshStandardMaterial) {
        mesh.material = new MeshStandardMaterial({
          color: mat.color ? mat.color.clone() : new Color(0xA0_A4_AD),
          vertexColors: hasColors,
          metalness: 0.35,
          roughness: 0.7
        });
      } else if (mat && hasColors) {
        mat.vertexColors = true;
        mat.needsUpdate = true;
      }
    });

    machine.mesh.clear();
    machine.mesh.add(root);
    const finalBox = new Box3().setFromObject(machine.mesh);
    machine.w = Math.max(1, finalBox.max.x - finalBox.min.x);
    machine.d = Math.max(1, finalBox.max.z - finalBox.min.z);
    machine.topY = finalBox.max.y + 0.5;
  }

  private accentConfigFor(def: MachineDef): AccentConfig | undefined {
    const tag = `${def.name} ${def.type}`.toLowerCase();
    if (tag.includes('four')) return { color: 0xFF_7A_2D, intensity: 2.2, distance: 22, yOffset: 4 };
    if (tag.includes('robot')) return { color: 0x60_A5_FA, intensity: 1.2, distance: 14, yOffset: 5.5 };
    if (def.state === 'maint') return { color: 0x3B_82_F6, intensity: 0.8, distance: 10, yOffset: 3 };
    return undefined;
  }

  private updateAccentLights(): void {
    const candidates = this.machines
      .filter((m) => m.accentConfig)
      .map((m) => ({ m, dist: this.camera.position.distanceToSquared(m.mesh.position) }))
      .sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < ACCENT_POOL_SIZE; i++) {
      const pl = this.accentPool[i];
      const c = candidates[i];
      if (c?.m.accentConfig) {
        const cfg = c.m.accentConfig;
        pl.visible = true;
        pl.color.setHex(cfg.color);
        pl.intensity = cfg.intensity;
        pl.distance = cfg.distance;
        pl.position.set(c.m.mesh.position.x, cfg.yOffset, c.m.mesh.position.z);
      } else {
        pl.visible = false;
        pl.intensity = 0;
      }
    }
  }

  private handleCanvasClick(e: MouseEvent): void {
    if (this.editMode) return;
    if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > DRAG_THRESHOLD_PX) return;
    const m = this.machineAt(e);
    if (m) this.onSelect(m.id);
  }

  private setPointer(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  private machineAt(e: MouseEvent): Machine | undefined {
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.activeCamera());
    const hits = this.raycaster.intersectObjects(this.machinesGroup.children, true);
    if (hits.length === 0) return undefined;
    let obj: Object3D | null = hits[0].object;
    while (obj && obj.userData['machineId'] == null) {
      obj = obj.parent;
    }
    const id = obj?.userData['machineId'];
    return typeof id === 'string' ? this.machines.find((m) => m.id === id) : undefined;
  }

  /** The camera used for rendering / projection (orthographic in 2D mode). */
  private activeCamera(): PerspectiveCamera | OrthographicCamera {
    return this.cameraMode === '2d' ? this.orthoCamera : this.camera;
  }

  /** Mirror the perspective orbit pose onto the orthographic camera, sizing its
   * frustum so the framing matches at the focus distance. */
  private syncOrtho(): void {
    const cam = this.camera;
    this.orthoCamera.position.copy(cam.position);
    this.orthoCamera.quaternion.copy(cam.quaternion);
    const { target } = this.orbit.getPose();
    const dist = cam.position.distanceTo(new Vector3(target[0], target[1], target[2])) || 1;
    const halfH = Math.tan(((cam.fov * Math.PI) / 180) / 2) * dist;
    const halfW = halfH * cam.aspect;
    this.orthoCamera.left = -halfW;
    this.orthoCamera.right = halfW;
    this.orthoCamera.top = halfH;
    this.orthoCamera.bottom = -halfH;
    this.orthoCamera.updateProjectionMatrix();
  }

  private tick(): void {
    if (!this.running) return;
    this.raf = requestAnimationFrame(() => this.tick());
    this.updateAccentLights();
    if (this.cameraMode === '2d') this.syncOrtho();
    const cam = this.activeCamera();
    this.faceBillboards();
    this.labels.update(cam, this.host.clientWidth, this.host.clientHeight);
    this.renderer.render(this.scene, cam);
  }

  /** Keep billboard icons screen-aligned: always shown flat (full-face) and
   * upright relative to the camera, whatever the orbit angle. */
  private faceBillboards(): void {
    for (const m of this.machines) {
      if (m.type !== 'billboard') continue;
      const card = m.mesh.getObjectByName(BILLBOARD_CHILD);
      if (!card) continue;
      // card world orientation := camera orientation (cancel the parent's).
      m.mesh.getWorldQuaternion(this.billboardQuat).invert();
      card.quaternion.copy(this.billboardQuat).multiply(this.camera.quaternion);
    }
  }

  private readonly onCanvasDown = (e: PointerEvent): void => {
    this.downX = e.clientX;
    this.downY = e.clientY;
  };

  private readonly onCanvasClick = (e: MouseEvent): void => this.handleCanvasClick(e);

  private readonly onEditDown = (e: PointerEvent): void => {
    if (!this.editMode || e.button !== 0) return;
    const m = this.machineAt(e);
    if (!m) return;
    this.dragging = m;
    this.dragMoved = false;
    this.dragPlane.constant = -m.mesh.position.y; // floor plane at the machine's height
    e.stopImmediatePropagation();
    e.preventDefault();
    window.addEventListener('pointermove', this.onEditMove);
    window.addEventListener('pointerup', this.onEditUp);
  };

  private readonly onEditMove = (e: PointerEvent): void => {
    const m = this.dragging;
    if (!m) return;
    this.setPointer(e);
    this.raycaster.setFromCamera(this.pointer, this.activeCamera());
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)) {
      m.mesh.position.x = this.dragPoint.x;
      m.mesh.position.z = this.dragPoint.z;
      m.x = this.dragPoint.x;
      m.z = this.dragPoint.z;
      this.dragMoved = true;
    }
  };

  private readonly onEditUp = (): void => {
    const m = this.dragging;
    this.dragging = null;
    window.removeEventListener('pointermove', this.onEditMove);
    window.removeEventListener('pointerup', this.onEditUp);
    if (m && this.dragMoved) this.onMachineMove?.(m.id, m.mesh.position.x, m.mesh.position.z);
  };
}

function keepPlaceholderOnError(): void {
  // GLB failed to load/parse — keep the placeholder shell.
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes.buffer;
}
