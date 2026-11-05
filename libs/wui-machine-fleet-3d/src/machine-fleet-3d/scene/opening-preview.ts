// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Small live renders of an opening view (#70) for the configuration dialogs: an atelier reduced
 * to its floor and blocks (one per symbol), framed with fleet-core `frameOpeningView` exactly as
 * the scene frames it — perspective camera for `tilted`, orthographic camera sized at the target
 * distance for `plan` and `tilted-ortho`. One WebGL renderer for the whole page, copied into 2D
 * canvases (a dialog shows up to a dozen thumbnails; browsers cap WebGL contexts).
 */
import {
  AmbientLight,
  Box3,
  Box3Helper,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshLambertMaterial,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from 'three';
import {
  floorBox,
  frameOpeningView,
  symbolsBox,
  type FrontSide,
  type OpeningViewSetting
} from '@visuelconcept-winccoa/wui-fleet-core/opening-view.js';
import type { Atelier } from '../types.js';

/** A symbol as previewed: its footprint (world coordinates) and height. */
export interface PreviewSymbol {
  bbox: { x1: number; x2: number; z1: number; z2: number };
  topY: number;
  toPlace?: boolean;
  hidden?: boolean;
}

/** An atelier as previewed: its floor (centred on the origin) and its symbols. */
export interface PreviewAtelier {
  name: string;
  note?: string;
  length: number;
  width: number;
  symbols: PreviewSymbol[];
}

/** The footprint a symbol is previewed with when its model is not built (another atelier). */
const DEFAULT_FOOTPRINT = { w: 6, d: 5, h: 3 };
const FOV = 45;
const COLORS = { floor: 0xd9e0e5, wall: 0xa9b6bf, symbol: 0x6b8796, pending: 0xc48a2c, box: 0x0a7f8f, sky: 0xf2f5f7 };

/** An atelier of the site, previewed from its definition (blocks of a default size). */
export function previewOf(atelier: Atelier): PreviewAtelier {
  return {
    name: atelier.name,
    note: `${atelier.machines.length}`,
    length: atelier.building.length,
    width: atelier.building.width,
    symbols: atelier.machines.map((m) => ({
      bbox: { x1: m.x - DEFAULT_FOOTPRINT.w / 2, x2: m.x + DEFAULT_FOOTPRINT.w / 2, z1: m.z - DEFAULT_FOOTPRINT.d / 2, z2: m.z + DEFAULT_FOOTPRINT.d / 2 },
      topY: DEFAULT_FOOTPRINT.h,
      toPlace: m.toPlace,
      hidden: m.hidden
    }))
  };
}

const block = (x: number, z: number, w: number, d: number, h: number): PreviewSymbol => ({
  bbox: { x1: x - w / 2, x2: x + w / 2, z1: z - d / 2, z2: z + d / 2 },
  topY: h
});

/** Example ateliers, to try a module setting on very different layouts. Names are i18n keys' text. */
export const EXAMPLE_ATELIERS: readonly Omit<PreviewAtelier, 'name' | 'note'>[] = [
  // a compact cluster in a large hall
  { length: 80, width: 50, symbols: [block(18, -8, 5, 4, 3), block(25, -8, 5, 4, 3), block(18, -1, 5, 4, 2.5), block(25, -1, 5, 4, 2.5), block(21.5, 6, 8, 4, 4), block(30, 2, 3, 3, 1.8)] },
  // a long line of 14 posts
  { length: 100, width: 24, symbols: Array.from({ length: 14 }, (_, i) => block(-44 + i * 6.6, 0, 4.5, 4, 2 + (i % 3) * 0.6)) },
  // a full atelier
  { length: 50, width: 40, symbols: Array.from({ length: 40 }, (_, i) => block(-20 + (i % 8) * 5.7, -15 + Math.floor(i / 8) * 7.5, 3.5, 4, 1.5 + ((i * 7) % 5) * 0.5)) }
];

let renderer: WebGLRenderer | null = null;

function sharedRenderer(): WebGLRenderer | null {
  if (renderer) return renderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
  } catch {
    renderer = null; // no WebGL: the dialogs show the cards without thumbnails
  }
  return renderer;
}

const scenes = new WeakMap<PreviewAtelier, { scene: Scene; helper: Box3Helper; framed: Box3 }>();

function sceneOf(atelier: PreviewAtelier): { scene: Scene; helper: Box3Helper; framed: Box3 } {
  const known = scenes.get(atelier);
  if (known) return known;
  const scene = new Scene();
  scene.background = new Color(COLORS.sky);
  scene.add(new AmbientLight(0xffffff, 0.75));
  const sun = new DirectionalLight(0xffffff, 0.6);
  sun.position.set(-30, 60, 40);
  scene.add(sun);
  const floor = new Mesh(new BoxGeometry(atelier.length, 0.2, atelier.width), new MeshLambertMaterial({ color: COLORS.floor }));
  floor.position.y = -0.1;
  scene.add(floor);
  const wall = new MeshLambertMaterial({ color: COLORS.wall, transparent: true, opacity: 0.6 });
  const L = atelier.length;
  const W = atelier.width;
  for (const [x, z, w, d] of [[0, -W / 2, L, 0.4], [-L / 2, 0, 0.4, W], [L / 2, 0, 0.4, W], [0, W / 2, L, 0.4]] as const) {
    const m = new Mesh(new BoxGeometry(w, 1.2, d), wall);
    m.position.set(x, 0.6, z);
    scene.add(m);
  }
  const group = new Group();
  const placed = new MeshLambertMaterial({ color: COLORS.symbol });
  const pending = new MeshLambertMaterial({ color: COLORS.pending });
  for (const s of atelier.symbols) {
    if (s.hidden) continue;
    const w = Math.abs(s.bbox.x2 - s.bbox.x1);
    const d = Math.abs(s.bbox.z2 - s.bbox.z1);
    const h = Math.max(0.5, s.topY);
    const m = new Mesh(new BoxGeometry(w, h, d), s.toPlace ? pending : placed);
    m.position.set((s.bbox.x1 + s.bbox.x2) / 2, h / 2, (s.bbox.z1 + s.bbox.z2) / 2);
    group.add(m);
  }
  scene.add(group);
  const b = symbolsBox(atelier.symbols) ?? floorBox(atelier);
  const framed = new Box3(new Vector3(...b.min), new Vector3(...b.max));
  const helper = new Box3Helper(framed, new Color(COLORS.box));
  scene.add(helper);
  const built = { scene, helper, framed };
  scenes.set(atelier, built);
  return built;
}

/**
 * Draw `atelier` in `canvas` as `view` opens it from `front`. `showBox`: the framed box outlined.
 * Returns false when WebGL is not available.
 */
export function drawOpeningPreview(canvas: HTMLCanvasElement, atelier: PreviewAtelier, view: OpeningViewSetting, front: FrontSide, showBox = true): boolean {
  const r = sharedRenderer();
  const ctx = canvas.getContext('2d');
  if (!r || !ctx) return false;
  const w = canvas.width;
  const h = canvas.height;
  r.setSize(w, h, false);
  const { scene, helper, framed } = sceneOf(atelier);
  helper.visible = showBox;
  const aspect = w / h;
  const box = { min: framed.min.toArray() as [number, number, number], max: framed.max.toArray() as [number, number, number] };
  const pose = frameOpeningView(box, view, front, FOV, aspect);
  const dir = new Vector3(Math.sin(pose.phi) * Math.cos(pose.theta), Math.cos(pose.phi), Math.sin(pose.phi) * Math.sin(pose.theta));
  const target = new Vector3(...pose.target);
  let camera: PerspectiveCamera | OrthographicCamera;
  if (view.mode === 'tilted') {
    camera = new PerspectiveCamera(FOV, aspect, 0.5, pose.radius * 4 + 100);
  } else {
    const halfH = Math.tan(((FOV * Math.PI) / 180) / 2) * pose.radius;
    camera = new OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, 0.5, pose.radius * 4 + 100);
  }
  camera.position.copy(target).add(dir.multiplyScalar(pose.radius));
  camera.lookAt(target);
  r.render(scene, camera);
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(r.domElement, 0, 0, w, h);
  return true;
}
