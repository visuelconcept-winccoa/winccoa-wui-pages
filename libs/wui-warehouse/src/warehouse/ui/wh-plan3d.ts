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
 * Every location carries a per-instance COLOUR (its `color`, else the per-type
 * default) applied to the structure body, and a per-instance HEIGHT (its
 * `height`, else the per-type default).
 *
 * Interactions: click selects (raycast on invisible full-size hitboxes,
 * pointermove hover); the selection HIGHLIGHT is a translucent box enclosing the
 * whole structure (glass fill + bright edges). In edit mode, drag a location
 * along the floor plane to move it inside its zone (grid-snapped), or drag one
 * of the selected location's three RESIZE HANDLES to change its width, depth or
 * height. Both move and resize emit the same `wui:layout` event as the 2D editor
 * (resize adds the `height`). Left-drag orbits, wheel zooms, right-drag pans
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
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  type Ray,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three';
import { locationColor, locationFillColor, locationHeight, locationUnits, occupancy, stockStatus, ZONE_LABEL_BAND } from '../model.js';
import type { LocationType, Product, StockCell, StorageLocation, Zone } from '../types.js';
import { createWarehouseTextures, type WarehouseTextures } from './plan3d-textures.js';

const LEVELS_BY_TYPE: Record<LocationType, number> = { rack: 3, shelf: 4, bin: 2, floor: 0, cold: 0 };
const SNAP = 0.5;
const DRAG_THRESHOLD_PX = 5;
/** Resize bounds (grid units for width/depth, world units for height). */
const MIN_SIZE = 1;
const MIN_HEIGHT = 0.4;
const MAX_HEIGHT = 12;
const HANDLE_SIZE = 0.5;
const HANDLE_GAP = 0.35;

// Axis unit vectors + a scratch vector for the ray/axis closest-point solve.
const UNIT_X = new Vector3(1, 0, 0);
const UNIT_Y = new Vector3(0, 1, 0);
const UNIT_Z = new Vector3(0, 0, 1);
const TMP_AXIS = new Vector3();

// Scene palette. Per-location structure colours come from the location itself
// (locationColor); the constants below are the fixed scene accents only.
const BG = 0x0D_11_17;
const FLOOR_COLOR = 0x1A_22_30;
const GRID_MAJOR = 0x2A_35_50;
const GRID_MINOR = 0x22_2C_42;
const BEAM_COLOR = 0xD9_7B_29; // pallet-rack orange beam accent
const DECK_COLOR = 0x2C_35_48;
const PALLET_COLOR = 0x8A_5A_2B;
const CRATE_COLOR = 0xB9_9A_6B;
const OUTLINE_SELECTED = 0xFF_FF_FF;
const OUTLINE_HOVER = 0x7D_D3_FC;
const HANDLE_COLOR = 0x38_BD_F8;
const ALERT_UNDER = '#f59e0b';
const ALERT_OVER = '#ef4444';

const POST = 0.09;
const BEAM = 0.07;
const DECK = 0.03;
const BRACE = 0.03;
const FOOT_H = 0.06;
const FOOT_COLOR = 0x2F_39_4D;

interface OrbitPose {
  theta: number;
  phi: number;
  radius: number;
}

/** One resizable axis of a location and the dimension it drives. */
type ResizeAxis = 'w' | 'd' | 'h';

interface LocationVisual {
  group: Group;
  hitbox: Mesh;
  /** Translucent box + edges enclosing the whole structure (hover/selection). */
  highlight: Group;
  highlightBox: Mesh;
  highlightEdges: LineSegments;
  /** The three resize handles (visible only for the selected location in edit mode). */
  handles: Group;
  handleMeshes: Mesh[];
  /** Committed footprint width / depth and vertical height. */
  w: number;
  d: number;
  height: number;
}

/** Live resize gesture (previewed via the highlight box, committed on release). */
interface ResizeState {
  id: string;
  axis: ResizeAxis;
  start: { w: number; d: number; height: number };
  pending: { w: number; d: number; height: number };
  moved: boolean;
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
  private textures?: WarehouseTextures;
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
  private resizing: ResizeState | null = null;

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
    this.textures = createWarehouseTextures();
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
    this.textures?.dispose();
    this.textures = undefined;
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = undefined;
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has('zones') || changed.has('locations') || changed.has('stock') || changed.has('products')) {
      this.rebuild();
    } else if (changed.has('selectedId')) {
      this.refreshHighlights();
      this.refreshHandles();
    }
    if (changed.has('editing')) {
      this.updateCursor();
      this.refreshHandles();
    }
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

    const concrete = this.textures?.concrete;
    if (concrete) concrete.repeat.set((extent.w + 8) / 4, (extent.h + 8) / 4);
    const ground = new Mesh(
      new PlaneGeometry(extent.w + 8, extent.h + 8),
      new MeshStandardMaterial({ color: FLOOR_COLOR, roughness: 0.95, map: concrete })
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
    this.refreshHighlights();
    this.refreshHandles();
    this.needsRender = true;
  }

  private buildZoneSlab(zone: Zone): Group {
    const group = new Group();
    const color = new Color(zone.color);
    const slab = new Mesh(
      new BoxGeometry(zone.w, 0.06, zone.h),
      new MeshStandardMaterial({ color, transparent: true, opacity: 0.2, roughness: 0.85 })
    );
    slab.position.y = 0.03;
    group.add(slab);
    // Bright coloured border around the slab edge for a finished, legible zone outline.
    const tmp = new BoxGeometry(zone.w, 0.06, zone.h);
    const border = new LineSegments(new EdgesGeometry(tmp), new LineBasicMaterial({ color, transparent: true, opacity: 0.65 }));
    tmp.dispose();
    border.position.y = 0.031;
    group.add(border);
    group.position.set(zone.x + zone.w / 2, 0, zone.y + zone.h / 2);
    return group;
  }

  /** Assemble one location: structure + fill gauge + label + badge + hitbox + highlight + handles. */
  private buildLocation(loc: StorageLocation): LocationVisual | undefined {
    const zone = this.zones.find((z) => z.id === loc.zoneId);
    if (!zone) return undefined;
    const fw = loc.w; // footprint (grid units) — the resize/highlight/handle space
    const fd = loc.h;
    const sw = fw * 0.94; // structure inset inside the footprint
    const sd = fd * 0.94;
    const sh = locationHeight(loc); // structure height
    const H = Math.max(sh, MIN_HEIGHT); // interaction/highlight height
    const color = locationColor(loc);
    const units = locationUnits(this.stock, loc.id);

    const group = new Group();
    group.position.set(zone.x + loc.x + fw / 2, 0, zone.y + loc.y + fd / 2);

    this.addStructure(group, loc.type, sw, sd, sh, units, color);
    this.addFillGauge(group, loc, sw, sd, sh, units);
    group.add(makeLabelSprite(loc.code, `${units}`, sh));
    this.addAlertBadge(group, loc, sh);

    // Invisible full-footprint hitbox — the raycast/selection target.
    const hitbox = new Mesh(new BoxGeometry(fw, H, fd), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    hitbox.position.y = H / 2;
    hitbox.userData['locationId'] = loc.id;
    group.add(hitbox);

    // Enclosing translucent highlight (glass box + bright edges) — hover/selection.
    const { highlight, highlightBox, highlightEdges } = buildHighlight(fw, fd, H);
    group.add(highlight);

    // Three resize handles (width / depth / height), shown only when selected in edit mode.
    const { handles, handleMeshes } = buildHandles(fw, fd, H, loc.id);
    group.add(handles);

    return { group, hitbox, highlight, highlightBox, highlightEdges, handles, handleMeshes, w: fw, d: fd, height: H };
  }

  /** Type-specific procedural structure, centred on the group origin. */
  private addStructure(group: Group, type: LocationType, w: number, d: number, h: number, units: number, color: string): void {
    switch (type) {
      case 'rack': {
        this.addFrame(group, w, d, h, new Color(color), new Color(BEAM_COLOR), LEVELS_BY_TYPE.rack, 1, true, this.textures?.steel, this.textures?.beam);
        break;
      }
      case 'shelf': {
        this.addFrame(group, w, d, h, new Color(color), new Color(color), LEVELS_BY_TYPE.shelf, 0.6, false, this.textures?.shelf, this.textures?.shelf);
        break;
      }
      case 'bin': {
        this.addBinBlock(group, w, d, h, new Color(color));
        break;
      }
      case 'cold': {
        this.addColdRoom(group, w, d, h, new Color(color));
        break;
      }
      default: {
        this.addFloorMarking(group, w, d, units);
      }
    }
  }

  /**
   * Pallet-rack / shelving frame: chamfered uprights on foot plates (+ mid posts
   * on wide bays), front/back beams and deck plates per level, and — for pallet
   * racks — X diagonal braces on the end frames for a more finished look.
   */
  private addFrame(
    group: Group,
    w: number,
    d: number,
    h: number,
    postColor: Color,
    beamColor: Color,
    levels: number,
    postScale: number,
    braces: boolean,
    bodyTexture?: Texture,
    beamTexture?: Texture
  ): void {
    const posts = new MeshStandardMaterial({ color: postColor, roughness: 0.45, metalness: 0.4, map: bodyTexture });
    const beams = new MeshStandardMaterial({ color: beamColor, roughness: 0.4, metalness: 0.35, map: beamTexture });
    const decks = new MeshStandardMaterial({ color: new Color(DECK_COLOR), roughness: 0.85, map: bodyTexture });
    const feet = new MeshStandardMaterial({ color: new Color(FOOT_COLOR), roughness: 0.6, metalness: 0.3, map: bodyTexture });
    const p = POST * postScale;
    const xs = [-w / 2 + p / 2, w / 2 - p / 2];
    if (w > 4) xs.push(0); // mid upright on wide bays
    const zs = [-d / 2 + p / 2, d / 2 - p / 2];
    for (const x of xs)
      for (const z of zs) {
        const post = new Mesh(new BoxGeometry(p, h, p), posts);
        post.position.set(x, h / 2, z);
        group.add(post);
        const foot = new Mesh(new BoxGeometry(p * 2.1, FOOT_H, p * 2.1), feet);
        foot.position.set(x, FOOT_H / 2, z);
        group.add(foot);
      }
    for (let level = 1; level <= levels; level++) {
      const y = (h / (levels + 0.35)) * level;
      for (const z of zs) {
        const beam = new Mesh(new BoxGeometry(w - p * 2, BEAM, BEAM), beams);
        beam.position.set(0, y, z);
        group.add(beam);
      }
      const deck = new Mesh(new BoxGeometry(w - p * 2, DECK, d - p), decks);
      deck.position.set(0, y - BEAM / 2 - DECK / 2, 0);
      group.add(deck);
    }
    if (braces) this.addEndBraces(group, w, d, h, posts, p);
  }

  /** Thin X braces on the two end frames (left/right), pallet-rack style. */
  private addEndBraces(group: Group, w: number, d: number, h: number, material: MeshStandardMaterial, p: number): void {
    const span = d - p;
    const diag = Math.hypot(span, h) ;
    const angle = Math.atan2(h, span);
    for (const x of [-w / 2 + p / 2, w / 2 - p / 2]) {
      for (const sign of [1, -1]) {
        const brace = new Mesh(new BoxGeometry(BRACE, diag * 0.98, BRACE), material);
        brace.position.set(x, h / 2, 0);
        brace.rotation.x = sign * (Math.PI / 2 - angle);
        group.add(brace);
      }
    }
  }

  /** Cubby block: shell open on the front, one horizontal + two vertical dividers. */
  private addBinBlock(group: Group, w: number, d: number, h: number, color: Color): void {
    const shell = new MeshStandardMaterial({ color, roughness: 0.65, metalness: 0.15, map: this.textures?.bin });
    const inner = new MeshStandardMaterial({ color: color.clone().multiplyScalar(0.82), roughness: 0.75, map: this.textures?.bin });
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
    const base = new Mesh(new BoxGeometry(w, panel, d), shell);
    base.position.set(0, panel / 2, 0);
    group.add(base);
    const mid = new Mesh(new BoxGeometry(w, panel, d), inner);
    mid.position.set(0, h / 2, 0);
    group.add(mid);
    const third = w / 3;
    for (const x of [-third / 2, third / 2]) {
      const divider = new Mesh(new BoxGeometry(panel, h, d), inner);
      divider.position.set(x, h / 2, 0);
      group.add(divider);
    }
  }

  /** Translucent cold-room enclosure: glass walls, solid rim/kick-plate and a framed door. */
  private addColdRoom(group: Group, w: number, d: number, h: number, color: Color): void {
    const glass = new MeshStandardMaterial({ color, transparent: true, opacity: 0.24, roughness: 0.12, metalness: 0.1 });
    const shell = new Mesh(new BoxGeometry(w, h, d), glass);
    shell.position.y = h / 2;
    group.add(shell);
    const rimMat = new MeshStandardMaterial({ color: color.clone().multiplyScalar(0.9), roughness: 0.3, metalness: 0.2 });
    const lid = new Mesh(new BoxGeometry(w + 0.04, 0.08, d + 0.04), rimMat);
    lid.position.y = h + 0.04;
    group.add(lid);
    const kick = new Mesh(new BoxGeometry(w + 0.04, 0.12, d + 0.04), rimMat);
    kick.position.y = 0.06;
    group.add(kick);
    // Door: recessed panel with a frame on the front face.
    const frame = new Mesh(new BoxGeometry(w * 0.42, h * 0.8, 0.05), rimMat);
    frame.position.set(0, (h * 0.8) / 2, d / 2 + 0.01);
    group.add(frame);
    const door = new Mesh(new BoxGeometry(w * 0.34, h * 0.72, 0.06), glass);
    door.position.set(0, (h * 0.72) / 2 + 0.02, d / 2 + 0.03);
    group.add(door);
  }

  /** Painted floor marking with a border stripe; pallet stacks appear when occupied. */
  private addFloorMarking(group: Group, w: number, d: number, units: number): void {
    const paint = new Color(locationFillColor(units, 0));
    const marking = new Mesh(new PlaneGeometry(w, d), new MeshBasicMaterial({ color: paint, transparent: true, opacity: 0.26 }));
    marking.rotation.x = -Math.PI / 2;
    marking.position.y = 0.011;
    group.add(marking);
    // Border stripe (four thin bars) for a painted-bay look.
    const stripe = new MeshBasicMaterial({ color: paint, transparent: true, opacity: 0.85 });
    const t = 0.08;
    for (const [gw, gd, x, z] of [
      [w, t, 0, -d / 2 + t / 2],
      [w, t, 0, d / 2 - t / 2],
      [t, d, -w / 2 + t / 2, 0],
      [t, d, w / 2 - t / 2, 0]
    ] as const) {
      const bar = new Mesh(new PlaneGeometry(gw, gd), stripe);
      bar.rotation.x = -Math.PI / 2;
      bar.position.set(x, 0.012, z);
      group.add(bar);
    }
    if (units <= 0) return;
    const pallet = new MeshStandardMaterial({ color: new Color(PALLET_COLOR), roughness: 0.8, map: this.textures?.wood });
    const crate = new MeshStandardMaterial({ color: new Color(CRATE_COLOR), roughness: 0.75, map: this.textures?.cardboard });
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
        // Per-instance maps (sprite label/badge canvases) are disposed here;
        // the shared/cached structure textures are kept for the next rebuild.
        const map = (m as MeshBasicMaterial | undefined)?.map;
        if (map && !map.userData['shared']) map.dispose();
        m?.dispose?.();
      }
    });
    this.scene?.remove(this.content);
    this.content.clear();
  }

  // --- highlight / handles / hover --------------------------------------------

  /** Enclosing translucent box + edges, tinted white (selected) or cyan (hover). */
  private refreshHighlights(): void {
    for (const [id, visual] of this.visuals) {
      const selected = id === this.selectedId;
      const hovered = id === this.hoveredId;
      visual.highlight.visible = selected || hovered;
      const color = selected ? OUTLINE_SELECTED : OUTLINE_HOVER;
      const box = visual.highlightBox.material as MeshBasicMaterial;
      box.color.set(color);
      box.opacity = selected ? 0.16 : 0.08;
      const edges = visual.highlightEdges.material as LineBasicMaterial;
      edges.color.set(color);
      edges.opacity = selected ? 0.95 : 0.55;
    }
    this.needsRender = true;
  }

  /** Resize handles are visible only for the selected location while editing. */
  private refreshHandles(): void {
    for (const [id, visual] of this.visuals) {
      const on = this.editing && id === this.selectedId;
      visual.handles.visible = on;
      if (on && this.resizing?.id !== id) resetHandlePositions(visual);
    }
    this.needsRender = true;
  }

  private setHovered(id: string): void {
    if (this.hoveredId === id) return;
    this.hoveredId = id;
    this.refreshHighlights();
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
      // A resize handle of the selected location takes priority over move/orbit.
      const axis = this.handleAt(e);
      if (axis) {
        this.beginResize(this.selectedId, axis);
        this.attachGlobal();
        return;
      }
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
    if (this.orbiting || this.dragging || this.resizing) return;
    if (this.editing && this.handleAt(e)) {
      if (this.canvasEl) this.canvasEl.style.cursor = 'move';
      return;
    }
    this.setHovered(this.locationAt(e) ?? '');
  };

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (this.resizing) {
      this.resizeDragged(e);
      return;
    }
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
    const wasResizing = this.resizing;
    const wasDragging = this.dragging;
    const movedPx = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    this.detachGlobal();
    this.orbiting = null;
    this.dragging = null;
    this.resizing = null;
    if (wasResizing) {
      if (wasResizing.moved) this.commitResize(wasResizing);
      else this.rebuild(); // discard the (empty) preview transform
      return;
    }
    if (wasDragging) {
      if (wasDragging.moved) this.commitDrag(wasDragging.id);
      // A click without a move selects the location (so its resize handles appear).
      else this.dispatchSelect(wasDragging.id);
      return;
    }
    if (movedPx <= DRAG_THRESHOLD_PX && e.button === 0) {
      const hit = this.locationAt(e);
      if (hit) this.dispatchSelect(hit);
    }
  };

  private dispatchSelect(locationId: string): void {
    this.dispatchEvent(new CustomEvent('wui:select', { detail: { locationId }, bubbles: true, composed: true }));
  }

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

  // --- 3D resize (width / depth / height handles) ------------------------------

  /** Which resize handle of the SELECTED location is under the pointer (if any). */
  private handleAt(e: PointerEvent): ResizeAxis | undefined {
    const visual = this.visuals.get(this.selectedId);
    if (!visual || !visual.handles.visible || !this.pointerRay(e)) return undefined;
    const hits = this.raycaster.intersectObjects(visual.handleMeshes, false);
    return hits[0]?.object.userData['handle'] as ResizeAxis | undefined;
  }

  private beginResize(id: string, axis: ResizeAxis): void {
    const visual = this.visuals.get(id);
    const loc = this.locations.find((l) => l.id === id);
    if (!visual || !loc) return;
    const start = { w: loc.w, d: loc.h, height: visual.height };
    this.resizing = { id, axis, start, pending: { ...start }, moved: false };
  }

  /** Drag a handle along its axis; preview the new size on the highlight + handles. */
  private resizeDragged(e: PointerEvent): void {
    const r = this.resizing;
    const visual = r ? this.visuals.get(r.id) : undefined;
    const loc = r ? this.locations.find((l) => l.id === r.id) : undefined;
    const zone = loc ? this.zones.find((z) => z.id === loc.zoneId) : undefined;
    const ray = this.pointerRay(e);
    if (!r || !visual || !loc || !zone || !ray) return;
    const center = visual.group.position;
    if (r.axis === 'w') {
      const originX = center.x - r.start.w / 2; // min-x corner stays anchored
      const span = scalarOnAxis(ray, new Vector3(originX, r.start.height / 2, center.z), UNIT_X);
      r.pending.w = clamp(snap(span), MIN_SIZE, Math.max(MIN_SIZE, zone.w - loc.x));
    } else if (r.axis === 'd') {
      const originZ = center.z - r.start.d / 2;
      const span = scalarOnAxis(ray, new Vector3(center.x, r.start.height / 2, originZ), UNIT_Z);
      r.pending.d = clamp(snap(span), MIN_SIZE, Math.max(MIN_SIZE, zone.h - loc.y));
    } else {
      const span = scalarOnAxis(ray, new Vector3(center.x, 0, center.z), UNIT_Y);
      r.pending.height = clamp(snap(span), MIN_HEIGHT, MAX_HEIGHT);
    }
    r.moved = true;
    applyResizePreview(visual, r);
    this.needsRender = true;
  }

  private commitResize(r: ResizeState): void {
    const loc = this.locations.find((l) => l.id === r.id);
    if (!loc) return;
    const { w, d, height } = r.pending;
    if (w === loc.w && d === loc.h && height === r.start.height) {
      this.rebuild(); // nothing changed — drop the preview transform
      return;
    }
    this.dispatchEvent(
      new CustomEvent('wui:layout', {
        detail: { kind: 'location', id: r.id, x: loc.x, y: loc.y, w, h: d, height },
        bubbles: true,
        composed: true
      })
    );
  }

  private locationAt(e: PointerEvent): string | undefined {
    if (!this.pointerRay(e)) return undefined;
    const hitboxes = [...this.visuals.values()].map((v) => v.hitbox);
    const hits = this.raycaster.intersectObjects(hitboxes, false);
    return hits[0]?.object.userData['locationId'] as string | undefined;
  }

  private floorPoint(e: PointerEvent): Vector3 | undefined {
    if (!this.pointerRay(e)) return undefined;
    const out = new Vector3();
    return this.raycaster.ray.intersectPlane(this.floorPlane, out) ?? undefined;
  }

  /** Set the raycaster from the pointer; returns the ray (undefined if not ready). */
  private pointerRay(e: PointerEvent): Ray | undefined {
    const canvas = this.canvasEl;
    if (!canvas || !this.camera) return undefined;
    const rect = canvas.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.ray;
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

/** Enclosing translucent highlight: glass box + bright edge lines (full footprint × height). */
function buildHighlight(w: number, d: number, h: number): { highlight: Group; highlightBox: Mesh; highlightEdges: LineSegments } {
  const highlight = new Group();
  const box = new Mesh(
    new BoxGeometry(w, h, d),
    new MeshBasicMaterial({ color: OUTLINE_SELECTED, transparent: true, opacity: 0.16, side: DoubleSide, depthWrite: false })
  );
  box.position.y = h / 2;
  highlight.add(box);
  const tmp = new BoxGeometry(w, h, d);
  const edges = new LineSegments(new EdgesGeometry(tmp), new LineBasicMaterial({ color: OUTLINE_SELECTED, transparent: true, opacity: 0.95 }));
  tmp.dispose();
  edges.position.y = h / 2;
  highlight.add(edges);
  highlight.visible = false;
  return { highlight, highlightBox: box, highlightEdges: edges };
}

/** The three resize handles (width +X, depth +Z, height +Y) as small always-on-top cubes. */
function buildHandles(w: number, d: number, h: number, id: string): { handles: Group; handleMeshes: Mesh[] } {
  const handles = new Group();
  const make = (axis: ResizeAxis): Mesh => {
    const mesh = new Mesh(
      new BoxGeometry(HANDLE_SIZE, HANDLE_SIZE, HANDLE_SIZE),
      new MeshBasicMaterial({ color: HANDLE_COLOR, depthTest: false, transparent: true, opacity: 0.95 })
    );
    mesh.renderOrder = 12;
    mesh.userData['handle'] = axis;
    mesh.userData['locationId'] = id;
    handles.add(mesh);
    return mesh;
  };
  const handleMeshes = [make('w'), make('d'), make('h')];
  layoutHandles(handleMeshes, w, d, h, w, d);
  handles.visible = false;
  return { handles, handleMeshes };
}

/** Place the handles on the moving faces, anchored at the fixed min corner (−sw/2, −sd/2, 0). */
function layoutHandles(meshes: Mesh[], w: number, d: number, height: number, sw: number, sd: number): void {
  const minX = -sw / 2;
  const minZ = -sd / 2;
  meshes[0]?.position.set(minX + w + HANDLE_GAP, height / 2, minZ + d / 2); // width
  meshes[1]?.position.set(minX + w / 2, height / 2, minZ + d + HANDLE_GAP); // depth
  meshes[2]?.position.set(minX + w / 2, height + HANDLE_GAP, minZ + d / 2); // height
}

/** Reset a location's handles to its committed size (min corner at −w/2, −d/2). */
function resetHandlePositions(visual: LocationVisual): void {
  layoutHandles(visual.handleMeshes, visual.w, visual.d, visual.height, visual.w, visual.d);
}

/** Preview a live resize: scale/offset the highlight box + edges and move the handles. */
function applyResizePreview(visual: LocationVisual, r: ResizeState): void {
  const { w, d, height } = r.pending;
  const { w: sw, d: sd, height: sh } = r.start;
  const cx = -sw / 2 + w / 2; // min-x corner anchored
  const cz = -sd / 2 + d / 2; // min-z corner anchored
  for (const object of [visual.highlightBox, visual.highlightEdges]) {
    object.scale.set(w / sw, height / sh, d / sd);
    object.position.set(cx, height / 2, cz);
  }
  layoutHandles(visual.handleMeshes, w, d, height, sw, sd);
}

/**
 * Signed distance along a unit axis (origin + s·dir) to its closest approach with
 * a ray — the standard line/line closest-point solve. Used to drag a resize
 * handle along one world axis regardless of the camera orientation.
 */
function scalarOnAxis(ray: Ray, origin: Vector3, dir: Vector3): number {
  const w0 = TMP_AXIS.copy(origin).sub(ray.origin);
  const b = dir.dot(ray.direction);
  const dOff = dir.dot(w0);
  const eOff = ray.direction.dot(w0);
  const denom = 1 - b * b; // dir and ray.direction are both unit vectors
  if (Math.abs(denom) < 1e-6) return dOff; // near-parallel — fall back to a plain projection
  return (b * eOff - dOff) / denom;
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
