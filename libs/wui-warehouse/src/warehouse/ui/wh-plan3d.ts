// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * 3D warehouse view (three.js, machine-fleet-3d style): zone floors as coloured
 * slabs, storage locations as boxes whose height comes from their type and
 * whose colour is the same occupancy scale as the 2D plan. Click a rack to
 * select it (raycast); in edit mode drag a rack along the floor plane to move
 * it inside its zone (grid-snapped) — emits the same `wui:layout` event as the
 * 2D editor. Left-drag orbits, wheel zooms, right-drag pans (hand-rolled orbit,
 * no OrbitControls dependency).
 *
 * Lifecycle mirrors mf-atelier-view: absolute canvas in a sized viewport,
 * ResizeObserver → resize, full GPU disposal on disconnect.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { locationFillColor, locationUnits, ZONE_LABEL_BAND } from '../model.js';
import type { LocationType, StockCell, StorageLocation, Zone } from '../types.js';

const HEIGHT_BY_TYPE: Record<LocationType, number> = { rack: 3.2, shelf: 2.4, bin: 1.2, floor: 0.3, cold: 2.6 };
const SNAP = 0.5;
const DRAG_THRESHOLD_PX = 5;
const BG = 0x0D_11_17;
const FLOOR_COLOR = 0x1A_22_30;

interface OrbitPose {
  theta: number;
  phi: number;
  radius: number;
}

@customElement('wh-plan3d')
export class WhPlan3d extends LitElement {
  static override readonly styles = [IXCoreStyles, plan3dStyles()];

  @property({ attribute: false }) zones: Zone[] = [];
  @property({ attribute: false }) locations: StorageLocation[] = [];
  @property({ attribute: false }) stock: StockCell[] = [];
  @property({ type: String }) selectedId = '';
  @property({ type: Boolean }) editing = false;

  @query('canvas') private canvasEl?: HTMLCanvasElement;
  @query('.viewport') private viewportEl?: HTMLDivElement;

  private renderer?: WebGLRenderer;
  private scene?: Scene;
  private camera?: PerspectiveCamera;
  private content = new Group();
  private boxes = new Map<string, Mesh>();
  private resizeObserver?: ResizeObserver;
  private raf = 0;
  private needsRender = true;

  private readonly target = new Vector3();
  private pose: OrbitPose = { theta: -Math.PI / 4, phi: Math.PI / 3.2, radius: 40 };
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly floorPlane = new Plane(new Vector3(0, 1, 0), 0);

  private orbiting: { mode: 'rotate' | 'pan'; x: number; y: number } | null = null;
  private downAt = { x: 0, y: 0 };
  private dragging: { id: string; offset: Vector3; moved: boolean } | null = null;

  override render(): TemplateResult {
    return html`<div class="viewport"><canvas></canvas></div>`;
  }

  override firstUpdated(): void {
    const canvas = this.canvasEl;
    const viewport = this.viewportEl;
    if (!canvas || !viewport) return;
    this.scene = new Scene();
    this.scene.background = new Color(BG);
    this.camera = new PerspectiveCamera(45, 1, 0.1, 500);
    this.renderer = new WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    this.addLights();
    this.scene.add(this.content);
    this.rebuild();
    this.centerCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    this.resize();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.raf = requestAnimationFrame(this.tick);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
    this.detachGlobal();
    this.disposeContent();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = undefined;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('zones') || changed.has('locations') || changed.has('stock') || changed.has('selectedId')) {
      this.rebuild();
    }
    if (changed.has('editing')) this.updateCursor();
  }

  // --- scene building --------------------------------------------------------

  private addLights(): void {
    if (!this.scene) return;
    this.scene.add(new AmbientLight(0xFF_FF_FF, 0.55));
    const sun = new DirectionalLight(0xFF_FF_FF, 1.1);
    sun.position.set(20, 30, 10);
    this.scene.add(sun);
    const fill = new DirectionalLight(0x88_AA_FF, 0.25);
    fill.position.set(-15, 12, -20);
    this.scene.add(fill);
  }

  private rebuild(): void {
    if (!this.scene) return;
    this.disposeContent();
    this.content = new Group();
    this.boxes = new Map();
    const extent = this.extent();

    const ground = new Mesh(
      new PlaneGeometry(extent.w + 8, extent.h + 8),
      new MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(extent.w / 2, -0.02, extent.h / 2);
    this.content.add(ground);
    const grid = new GridHelper(Math.max(extent.w, extent.h) + 8, Math.max(extent.w, extent.h) + 8, 0x2A_35_50, 0x22_2C_42);
    grid.position.set(extent.w / 2, 0, extent.h / 2);
    this.content.add(grid);

    for (const zone of this.zones) this.content.add(this.buildZoneSlab(zone));
    for (const loc of this.locations) {
      const mesh = this.buildLocationBox(loc);
      if (mesh) {
        this.boxes.set(loc.id, mesh);
        this.content.add(mesh);
      }
    }
    this.scene.add(this.content);
    this.needsRender = true;
  }

  private buildZoneSlab(zone: Zone): Mesh {
    const slab = new Mesh(
      new BoxGeometry(zone.w, 0.08, zone.h),
      new MeshStandardMaterial({ color: new Color(zone.color), transparent: true, opacity: 0.32, roughness: 0.8 })
    );
    slab.position.set(zone.x + zone.w / 2, 0.04, zone.y + zone.h / 2);
    return slab;
  }

  private buildLocationBox(loc: StorageLocation): Mesh | undefined {
    const zone = this.zones.find((z) => z.id === loc.zoneId);
    if (!zone) return undefined;
    const units = locationUnits(this.stock, loc.id);
    const height = HEIGHT_BY_TYPE[loc.type];
    const color = new Color(locationFillColor(units, loc.capacity));
    const selected = loc.id === this.selectedId;
    const material = new MeshStandardMaterial({
      color,
      roughness: 0.55,
      emissive: selected ? new Color(0xFF_FF_FF) : new Color(0x00_00_00),
      emissiveIntensity: selected ? 0.25 : 0
    });
    const mesh = new Mesh(new BoxGeometry(loc.w * 0.94, height, loc.h * 0.94), material);
    mesh.position.set(zone.x + loc.x + loc.w / 2, height / 2, zone.y + loc.y + loc.h / 2);
    mesh.userData['locationId'] = loc.id;
    return mesh;
  }

  private disposeContent(): void {
    this.content.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) m?.dispose?.();
    });
    this.scene?.remove(this.content);
    this.content.clear();
  }

  // --- camera / loop ----------------------------------------------------------

  private extent(): { w: number; h: number } {
    let w = 10;
    let h = 8;
    for (const z of this.zones) {
      w = Math.max(w, z.x + z.w);
      h = Math.max(h, z.y + z.h);
    }
    return { w: w + 1, h: h + 1 };
  }

  private centerCamera(): void {
    const extent = this.extent();
    this.target.set(extent.w / 2, 0, extent.h / 2);
    this.pose.radius = Math.max(extent.w, extent.h) * 1.35;
    this.applyPose();
  }

  private applyPose(): void {
    if (!this.camera) return;
    const { theta, phi, radius } = this.pose;
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.cos(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(this.target);
    this.needsRender = true;
  }

  private resize(): void {
    const viewport = this.viewportEl;
    if (!viewport || !this.renderer || !this.camera) return;
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.needsRender = true;
  }

  private readonly tick = (): void => {
    this.raf = requestAnimationFrame(this.tick);
    if (this.needsRender && this.renderer && this.scene && this.camera) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };

  // --- interactions -----------------------------------------------------------

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.downAt = { x: e.clientX, y: e.clientY };
    if (this.editing && e.button === 0) {
      const hit = this.locationAt(e);
      if (hit) {
        const loc = this.locations.find((l) => l.id === hit);
        const point = this.floorPoint(e);
        if (loc && point) {
          const zone = this.zones.find((z) => z.id === loc.zoneId);
          const world = new Vector3((zone?.x ?? 0) + loc.x + loc.w / 2, 0, (zone?.y ?? 0) + loc.y + loc.h / 2);
          this.dragging = { id: hit, offset: world.sub(point), moved: false };
          this.attachGlobal();
          return;
        }
      }
    }
    this.orbiting = { mode: e.button === 2 ? 'pan' : 'rotate', x: e.clientX, y: e.clientY };
    this.attachGlobal();
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.dragging) {
      this.moveDragged(e);
      return;
    }
    const o = this.orbiting;
    if (!o) return;
    const dx = e.clientX - o.x;
    const dy = e.clientY - o.y;
    this.orbiting = { ...o, x: e.clientX, y: e.clientY };
    if (o.mode === 'rotate') {
      this.pose.theta += dx * 0.005;
      this.pose.phi = clamp(this.pose.phi - dy * 0.005, 0.15, Math.PI / 2 - 0.05);
    } else {
      const panScale = this.pose.radius * 0.0012;
      const forward = new Vector3(Math.cos(this.pose.theta), 0, Math.sin(this.pose.theta));
      const right = new Vector3(-forward.z, 0, forward.x);
      this.target.addScaledVector(right, dx * panScale);
      this.target.addScaledVector(forward, dy * panScale);
    }
    this.applyPose();
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    const wasDragging = this.dragging;
    const movedPx = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.detachGlobal();
    this.orbiting = null;
    this.dragging = null;
    if (wasDragging) {
      if (wasDragging.moved) this.commitDrag(wasDragging.id);
      return;
    }
    if (movedPx <= DRAG_THRESHOLD_PX && e.button === 0) {
      const hit = this.locationAt(e);
      if (hit) this.dispatchEvent(new CustomEvent('wui:select', { detail: { locationId: hit }, bubbles: true, composed: true }));
    }
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.pose.radius = clamp(this.pose.radius * (e.deltaY > 0 ? 1.1 : 0.9), 5, 200);
    this.applyPose();
  };

  private moveDragged(e: PointerEvent): void {
    const d = this.dragging;
    const mesh = d ? this.boxes.get(d.id) : undefined;
    const loc = d ? this.locations.find((l) => l.id === d.id) : undefined;
    const zone = loc ? this.zones.find((z) => z.id === loc.zoneId) : undefined;
    const point = this.floorPoint(e);
    if (!d || !mesh || !loc || !zone || !point) return;
    const center = point.add(d.offset);
    // Zone-relative top-left, snapped and clamped inside the zone (label band kept free).
    const x = clamp(snap(center.x - zone.x - loc.w / 2), 0, Math.max(0, zone.w - loc.w));
    const y = clamp(snap(center.z - zone.y - loc.h / 2), ZONE_LABEL_BAND, Math.max(ZONE_LABEL_BAND, zone.h - loc.h));
    mesh.position.x = zone.x + x + loc.w / 2;
    mesh.position.z = zone.y + y + loc.h / 2;
    mesh.userData['pendingX'] = x;
    mesh.userData['pendingY'] = y;
    d.moved = true;
    this.needsRender = true;
  }

  private commitDrag(id: string): void {
    const mesh = this.boxes.get(id);
    const loc = this.locations.find((l) => l.id === id);
    if (!mesh || !loc) return;
    const x = mesh.userData['pendingX'] as number | undefined;
    const y = mesh.userData['pendingY'] as number | undefined;
    if (x == null || y == null || (x === loc.x && y === loc.y)) return;
    this.dispatchEvent(
      new CustomEvent('wui:layout', {
        detail: { kind: 'location', id, x, y, w: loc.w, h: loc.h },
        bubbles: true,
        composed: true
      })
    );
  }

  private locationAt(e: PointerEvent): string | undefined {
    const canvas = this.canvasEl;
    if (!canvas || !this.camera) return undefined;
    const rect = canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects([...this.boxes.values()], false);
    return hits[0]?.object.userData['locationId'] as string | undefined;
  }

  private floorPoint(e: PointerEvent): Vector3 | undefined {
    const canvas = this.canvasEl;
    if (!canvas || !this.camera) return undefined;
    const rect = canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const out = new Vector3();
    return this.raycaster.ray.intersectPlane(this.floorPlane, out) ?? undefined;
  }

  private attachGlobal(): void {
    globalThis.addEventListener('pointermove', this.onPointerMove);
    globalThis.addEventListener('pointerup', this.onPointerUp);
  }

  private detachGlobal(): void {
    globalThis.removeEventListener('pointermove', this.onPointerMove);
    globalThis.removeEventListener('pointerup', this.onPointerUp);
  }

  private updateCursor(): void {
    if (this.canvasEl) this.canvasEl.style.cursor = this.editing ? 'move' : 'grab';
  }
}

function snap(v: number): number {
  return Math.round(v / SNAP) * SNAP;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

function plan3dStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .viewport {
      position: relative;
      flex: 1;
      min-height: 320px;
      overflow: hidden;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: #0d1117;
    }
    canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
      touch-action: none;
    }
  `;
}
