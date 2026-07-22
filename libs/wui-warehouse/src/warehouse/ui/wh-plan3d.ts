// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * 3D warehouse view (three.js, machine-fleet-3d style). Every storage location
 * is a PROCEDURAL structure built from its type — no external assets:
 *  - rack : pallet-rack uprights + orange beam levels and deck plates;
 *  - shelf: light shelving unit with close plate levels;
 *  - bin  : cubby block (frame + divider plates);
 *  - cold : translucent cold-room enclosure;
 *  - floor: painted floor marking with pallet stacks when occupied.
 * Each location also carries a FILL GAUGE (inner volume whose height is the
 * occupancy ratio, coloured with the same scale as the 2D plan), a billboard
 * LABEL sprite (code + units, canvas texture), an ALERT badge when a cell is
 * under-min / over-max, and a hover/selection OUTLINE (back-side shell).
 *
 * Interactions: click selects (raycast on invisible full-size hitboxes,
 * pointermove hover); in edit mode drag a location along the floor plane to
 * move it inside its zone (grid-snapped) — emits the same `wui:layout` event
 * as the 2D editor. Left-drag orbits, wheel zooms, right-drag pans
 * (hand-rolled orbit, no OrbitControls dependency).
 *
 * Lifecycle mirrors mf-atelier-view: absolute canvas in a sized viewport,
 * ResizeObserver → resize, full GPU disposal on disconnect.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { locationFillColor, locationUnits, occupancy, stockStatus, ZONE_LABEL_BAND } from '../model.js';
import type { LocationType, Product, StockCell, StorageLocation, Zone } from '../types.js';

const HEIGHT_BY_TYPE: Record<LocationType, number> = { rack: 3.2, shelf: 2.4, bin: 1.6, floor: 0.3, cold: 2.6 };
const LEVELS_BY_TYPE: Record<LocationType, number> = { rack: 3, shelf: 4, bin: 2, floor: 0, cold: 0 };
const SNAP = 0.5;
const DRAG_THRESHOLD_PX = 5;

// Palette (steel-blue uprights, pallet-rack orange beams, dark deck plates).
const BG = 0x0D_11_17;
const FLOOR_COLOR = 0x1A_22_30;
const GRID_MAJOR = 0x2A_35_50;
const GRID_MINOR = 0x22_2C_42;
const POST_COLOR = 0x46_54_70;
const BEAM_COLOR = 0xD9_7B_29;
const DECK_COLOR = 0x2C_35_48;
const SHELF_COLOR = 0x8A_94_A8;
const BIN_COLOR = 0x5A_64_78;
const COLD_COLOR = 0x9F_D8_E8;
const PALLET_COLOR = 0x8A_5A_2B;
const CRATE_COLOR = 0xB9_9A_6B;
const OUTLINE_SELECTED = 0xFF_FF_FF;
const OUTLINE_HOVER = 0x7D_D3_FC;
const ALERT_UNDER = '#f59e0b';
const ALERT_OVER = '#ef4444';

const POST = 0.09;
const BEAM = 0.07;
const DECK = 0.03;

interface OrbitPose {
  theta: number;
  phi: number;
  radius: number;
}

interface LocationVisual {
  group: Group;
  hitbox: Mesh;
  outline: Mesh;
  height: number;
}

@customElement('wh-plan3d')
export class WhPlan3d extends LitElement {
  static override readonly styles = [IXCoreStyles, plan3dStyles()];

  @property({ attribute: false }) zones: Zone[] = [];
  @property({ attribute: false }) locations: StorageLocation[] = [];
  @property({ attribute: false }) stock: StockCell[] = [];
  @property({ attribute: false }) products: Product[] = [];
  @property({ type: String }) selectedId = '';
  @property({ type: Boolean }) editing = false;

  @query('canvas') private canvasEl?: HTMLCanvasElement;
  @query('.viewport') private viewportEl?: HTMLDivElement;

  private renderer?: WebGLRenderer;
  private scene?: Scene;
  private camera?: PerspectiveCamera;
  private content = new Group();
  private visuals = new Map<string, LocationVisual>();
  private hoveredId = '';
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
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.addLights();
    this.scene.add(this.content);
    this.rebuild();
    this.centerCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(viewport);
    this.resize();
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onHoverMove);
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
    if (changed.has('zones') || changed.has('locations') || changed.has('stock') || changed.has('products')) {
      this.rebuild();
    } else if (changed.has('selectedId')) {
      this.refreshOutlines();
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
    this.visuals = new Map();
    const extent = this.extent();

    const ground = new Mesh(
      new PlaneGeometry(extent.w + 8, extent.h + 8),
      new MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.95 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(extent.w / 2, -0.02, extent.h / 2);
    this.content.add(ground);
    const grid = new GridHelper(Math.max(extent.w, extent.h) + 8, Math.max(extent.w, extent.h) + 8, GRID_MAJOR, GRID_MINOR);
    grid.position.set(extent.w / 2, 0, extent.h / 2);
    this.content.add(grid);

    for (const zone of this.zones) this.content.add(this.buildZoneSlab(zone));
    for (const loc of this.locations) {
      const visual = this.buildLocation(loc);
      if (visual) {
        this.visuals.set(loc.id, visual);
        this.content.add(visual.group);
      }
    }
    this.scene.add(this.content);
    this.refreshOutlines();
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

  /** Assemble one location: structure + fill gauge + label + badge + hitbox + outline. */
  private buildLocation(loc: StorageLocation): LocationVisual | undefined {
    const zone = this.zones.find((z) => z.id === loc.zoneId);
    if (!zone) return undefined;
    const w = loc.w * 0.94;
    const d = loc.h * 0.94;
    const height = HEIGHT_BY_TYPE[loc.type];
    const units = locationUnits(this.stock, loc.id);

    const group = new Group();
    group.position.set(zone.x + loc.x + loc.w / 2, 0, zone.y + loc.y + loc.h / 2);

    this.addStructure(group, loc.type, w, d, height, units);
    this.addFillGauge(group, loc, w, d, height, units);
    group.add(makeLabelSprite(loc.code, `${units}`, height));
    this.addAlertBadge(group, loc, height);

    // Invisible full-size hitbox — the raycast/selection target.
    const hitbox = new Mesh(
      new BoxGeometry(w, Math.max(height, 0.4), d),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitbox.position.y = Math.max(height, 0.4) / 2;
    hitbox.userData['locationId'] = loc.id;
    group.add(hitbox);

    // Hover / selection outline: slightly inflated back-side shell.
    const outline = new Mesh(
      new BoxGeometry(w * 1.06, Math.max(height, 0.4) * 1.06, d * 1.06),
      new MeshBasicMaterial({ color: OUTLINE_SELECTED, side: BackSide, transparent: true, opacity: 0.85 })
    );
    outline.position.y = Math.max(height, 0.4) / 2;
    outline.visible = false;
    group.add(outline);

    return { group, hitbox, outline, height };
  }

  /** Type-specific procedural structure, centred on the group origin. */
  private addStructure(group: Group, type: LocationType, w: number, d: number, h: number, units: number): void {
    switch (type) {
      case 'rack': {
        this.addFrame(group, w, d, h, POST_COLOR, BEAM_COLOR, LEVELS_BY_TYPE.rack);
        break;
      }
      case 'shelf': {
        this.addFrame(group, w, d, h, SHELF_COLOR, SHELF_COLOR, LEVELS_BY_TYPE.shelf, 0.6);
        break;
      }
      case 'bin': {
        this.addBinBlock(group, w, d, h);
        break;
      }
      case 'cold': {
        this.addColdRoom(group, w, d, h);
        break;
      }
      default: {
        this.addFloorMarking(group, w, d, units);
      }
    }
  }

  /** Uprights at the corners (+ mid posts on wide bays) and beam/deck levels. */
  private addFrame(group: Group, w: number, d: number, h: number, postColor: number, beamColor: number, levels: number, postScale = 1): void {
    const posts = new MeshStandardMaterial({ color: postColor, roughness: 0.5, metalness: 0.35 });
    const beams = new MeshStandardMaterial({ color: beamColor, roughness: 0.45, metalness: 0.3 });
    const decks = new MeshStandardMaterial({ color: DECK_COLOR, roughness: 0.85 });
    const p = POST * postScale;
    const xs = [-w / 2 + p / 2, w / 2 - p / 2];
    if (w > 4) xs.push(0); // mid upright on wide bays
    const zs = [-d / 2 + p / 2, d / 2 - p / 2];
    for (const x of xs)
      for (const z of zs) {
        const post = new Mesh(new BoxGeometry(p, h, p), posts);
        post.position.set(x, h / 2, z);
        group.add(post);
      }
    for (let level = 1; level <= levels; level++) {
      const y = (h / (levels + 0.35)) * level;
      // Front + back beams along the width.
      for (const z of zs) {
        const beam = new Mesh(new BoxGeometry(w - p * 2, BEAM, BEAM), beams);
        beam.position.set(0, y, z);
        group.add(beam);
      }
      const deck = new Mesh(new BoxGeometry(w - p * 2, DECK, d - p), decks);
      deck.position.set(0, y - BEAM / 2 - DECK / 2, 0);
      group.add(deck);
    }
  }

  /** Cubby block: shell open on the front, one horizontal + two vertical dividers. */
  private addBinBlock(group: Group, w: number, d: number, h: number): void {
    const shell = new MeshStandardMaterial({ color: BIN_COLOR, roughness: 0.7 });
    const panel = 0.05;
    const back = new Mesh(new BoxGeometry(w, h, panel), shell);
    back.position.set(0, h / 2, -d / 2 + panel / 2);
    group.add(back);
    for (const x of [-w / 2 + panel / 2, w / 2 - panel / 2]) {
      const side = new Mesh(new BoxGeometry(panel, h, d), shell);
      side.position.set(x, h / 2, 0);
      group.add(side);
    }
    const top = new Mesh(new BoxGeometry(w, panel, d), shell);
    top.position.set(0, h - panel / 2, 0);
    group.add(top);
    const mid = new Mesh(new BoxGeometry(w, panel, d), shell);
    mid.position.set(0, h / 2, 0);
    group.add(mid);
    const third = w / 3;
    for (const x of [-third / 2, third / 2]) {
      const divider = new Mesh(new BoxGeometry(panel, h, d), shell);
      divider.position.set(x, h / 2, 0);
      group.add(divider);
    }
  }

  /** Translucent cold-room enclosure with a door seam on the front face. */
  private addColdRoom(group: Group, w: number, d: number, h: number): void {
    const glass = new MeshStandardMaterial({
      color: COLD_COLOR,
      transparent: true,
      opacity: 0.28,
      roughness: 0.15,
      metalness: 0.1
    });
    const shell = new Mesh(new BoxGeometry(w, h, d), glass);
    shell.position.y = h / 2;
    group.add(shell);
    const rim = new MeshStandardMaterial({ color: COLD_COLOR, roughness: 0.3 });
    const lid = new Mesh(new BoxGeometry(w, 0.06, d), rim);
    lid.position.y = h + 0.03;
    group.add(lid);
    const door = new Mesh(new BoxGeometry(w * 0.35, h * 0.75, 0.04), rim);
    door.position.set(0, (h * 0.75) / 2, d / 2 + 0.02);
    group.add(door);
  }

  /** Painted floor marking; pallet stacks appear when the spot holds stock. */
  private addFloorMarking(group: Group, w: number, d: number, units: number): void {
    const marking = new Mesh(
      new PlaneGeometry(w, d),
      new MeshBasicMaterial({ color: new Color(locationFillColor(units, 0)), transparent: true, opacity: 0.3 })
    );
    marking.rotation.x = -Math.PI / 2;
    marking.position.y = 0.011;
    group.add(marking);
    if (units <= 0) return;
    const pallet = new MeshStandardMaterial({ color: PALLET_COLOR, roughness: 0.8 });
    const crate = new MeshStandardMaterial({ color: CRATE_COLOR, roughness: 0.75 });
    const spots = [
      { x: -w / 4, z: -d / 4 },
      { x: w / 4, z: d / 4 }
    ];
    for (const spot of spots) {
      const base = new Mesh(new BoxGeometry(1.1, 0.12, 0.9), pallet);
      base.position.set(spot.x, 0.06, spot.z);
      group.add(base);
      const load = new Mesh(new BoxGeometry(0.95, 0.55, 0.75), crate);
      load.position.set(spot.x, 0.12 + 0.55 / 2, spot.z);
      group.add(load);
    }
  }

  /** Inner translucent volume rising with the fill ratio (the 3D gauge). */
  private addFillGauge(group: Group, loc: StorageLocation, w: number, d: number, h: number, units: number): void {
    if (loc.type === 'floor' || units <= 0) return;
    const ratio = loc.capacity > 0 ? occupancy(units, loc.capacity) : 1;
    const fillH = Math.max(0.12, ratio * h * 0.92);
    const gauge = new Mesh(
      new BoxGeometry(w * 0.78, fillH, d * 0.68),
      new MeshStandardMaterial({
        color: new Color(locationFillColor(units, loc.capacity)),
        transparent: true,
        opacity: 0.78,
        roughness: 0.6
      })
    );
    gauge.position.y = fillH / 2 + 0.02;
    group.add(gauge);
  }

  /** Amber/red floating badge when a cell of the location is under-min / over-max. */
  private addAlertBadge(group: Group, loc: StorageLocation, height: number): void {
    const cells = this.stock.filter((c) => c.locationId === loc.id);
    let alert: 'under' | 'over' | null = null;
    for (const cell of cells) {
      const product = this.products.find((p) => p.id === cell.productId);
      const status = stockStatus(cell.quantity, product);
      if (status === 'over') alert = 'over';
      else if (status === 'under' && alert !== 'over') alert = 'under';
    }
    if (!alert) return;
    group.add(makeBadgeSprite(alert === 'over' ? ALERT_OVER : ALERT_UNDER, height));
  }

  private disposeContent(): void {
    this.content.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        (m as MeshBasicMaterial | undefined)?.map?.dispose?.();
        m?.dispose?.();
      }
    });
    this.scene?.remove(this.content);
    this.content.clear();
  }

  // --- outlines / hover -------------------------------------------------------

  private refreshOutlines(): void {
    for (const [id, visual] of this.visuals) {
      const selected = id === this.selectedId;
      const hovered = id === this.hoveredId;
      visual.outline.visible = selected || hovered;
      const material = visual.outline.material as MeshBasicMaterial;
      material.color.set(selected ? OUTLINE_SELECTED : OUTLINE_HOVER);
      material.opacity = selected ? 0.9 : 0.5;
    }
    this.needsRender = true;
  }

  private setHovered(id: string): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.refreshOutlines();
    if (this.canvasEl && !this.editing) this.canvasEl.style.cursor = id ? 'pointer' : 'grab';
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

  private readonly onHoverMove = (e: PointerEvent): void => {
    if (this.orbiting || this.dragging) return;
    this.setHovered(this.locationAt(e) ?? '');
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
    const visual = d ? this.visuals.get(d.id) : undefined;
    const loc = d ? this.locations.find((l) => l.id === d.id) : undefined;
    const zone = loc ? this.zones.find((z) => z.id === loc.zoneId) : undefined;
    const point = this.floorPoint(e);
    if (!d || !visual || !loc || !zone || !point) return;
    const center = point.add(d.offset);
    // Zone-relative top-left, snapped and clamped inside the zone (label band kept free).
    const x = clamp(snap(center.x - zone.x - loc.w / 2), 0, Math.max(0, zone.w - loc.w));
    const y = clamp(snap(center.z - zone.y - loc.h / 2), ZONE_LABEL_BAND, Math.max(ZONE_LABEL_BAND, zone.h - loc.h));
    visual.group.position.x = zone.x + x + loc.w / 2;
    visual.group.position.z = zone.y + y + loc.h / 2;
    visual.group.userData['pendingX'] = x;
    visual.group.userData['pendingY'] = y;
    d.moved = true;
    this.needsRender = true;
  }

  private commitDrag(id: string): void {
    const visual = this.visuals.get(id);
    const loc = this.locations.find((l) => l.id === id);
    if (!visual || !loc) return;
    const x = visual.group.userData['pendingX'] as number | undefined;
    const y = visual.group.userData['pendingY'] as number | undefined;
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
    const hitboxes = [...this.visuals.values()].map((v) => v.hitbox);
    const hits = this.raycaster.intersectObjects(hitboxes, false);
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

/** Billboard label above the structure: location code + unit count. */
function makeLabelSprite(code: string, sub: string, structureHeight: number): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 108;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = 'rgba(13, 17, 23, 0.85)';
    roundRect(ctx, 4, 4, 248, 100, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.lineWidth = 2;
    roundRect(ctx, 4, 4, 248, 100, 16);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(code, 128, 48);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '30px system-ui, sans-serif';
    ctx.fillText(sub, 128, 88);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(1.9, 0.8, 1);
  sprite.position.y = structureHeight + 0.75;
  sprite.renderOrder = 10;
  return sprite;
}

/** Small floating "!" disc (amber = under-min, red = over-max). */
function makeBadgeSprite(color: string, structureHeight: number): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(32, 32, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(13, 17, 23, 0.9)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.fillStyle = '#0d1117';
    ctx.font = 'bold 42px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('!', 32, 47);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.scale.set(0.55, 0.55, 1);
  sprite.position.set(-1.15, structureHeight + 0.75, 0);
  sprite.renderOrder = 11;
  return sprite;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
