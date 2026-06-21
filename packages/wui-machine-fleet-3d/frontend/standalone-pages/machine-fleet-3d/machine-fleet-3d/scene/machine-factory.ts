/**
 * Machine geometry factory.
 *
 * `makeFour` is a faithful 1:1 port of the prototype's `makeFour`. The other
 * machine types are recognisable first-pass builds sharing the prototype's
 * material language (base + anchor bolts + status LEDs); their full-detail
 * geometry ports (`makeRobotMAG`, `makeTour`, `makeFraiseuse`, …) are tracked
 * for a follow-up pass.
 *
 * Every type accepts an optional `accent` colour: when a machine defines a
 * custom colour it is applied to that type's principal painted parts.
 */
import {
  BoxGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RingGeometry,
  SRGBColorSpace,
  Texture,
  TorusGeometry
} from 'three';
import { PORTIQUE_SPANS, type MachineDef, type PortiqueSize } from '../types.js';
import { MachineMaterials } from './machine-materials.js';

const HEX_RADIX = 16;

function makeFour(mats: MachineMaterials, tonnage: number, accent?: number): Group {
  const g = new Group();
  const w = tonnage === 600 ? 14 : 9;
  const d = tonnage === 600 ? 10 : 7;
  const h = tonnage === 600 ? 6 : 5;
  mats.addBase(g, w + 2, d + 2);
  mats.addAnchorBolts(g, w + 2, d + 2);

  const body = new Mesh(new BoxGeometry(w, h, d), mats.refractoryMat);
  body.position.y = 0.4 + h / 2;
  body.castShadow = true;
  g.add(body);

  for (const yFrac of [0.25, 0.75]) {
    const belt = new Mesh(new BoxGeometry(w + 0.1, 0.25, d + 0.1), mats.steelDark);
    belt.position.y = 0.4 + h * yFrac;
    g.add(belt);
  }

  const doorFrame = new Mesh(new BoxGeometry(w * 0.72, h * 0.82, 0.1), mats.steelDark);
  doorFrame.position.set(0, 0.4 + h / 2, d / 2 + 0.05);
  g.add(doorFrame);
  const door = new Mesh(new BoxGeometry(w * 0.7, h * 0.8, 0.3), mats.byColor(accent ?? 0xC6_4D_3A, 0.12));
  door.position.set(0, 0.4 + h / 2, d / 2 + 0.18);
  g.add(door);

  const hublotMat = new MeshStandardMaterial({
    color: 0xFF_6A_1F,
    emissive: 0xFF_6A_1F,
    emissiveIntensity: 1.8,
    roughness: 0.1,
    metalness: 0.3
  });
  const hublot = new Mesh(new CircleGeometry(0.35, 16), hublotMat);
  hublot.position.set(0, 0.4 + h / 2 + 0.3, d / 2 + 0.34);
  g.add(hublot);
  const hublotFrame = new Mesh(new RingGeometry(0.32, 0.45, 16), mats.steelDark);
  hublotFrame.position.set(0, 0.4 + h / 2 + 0.3, d / 2 + 0.33);
  g.add(hublotFrame);
  const handle = new Mesh(new BoxGeometry(0.15, 0.6, 0.15), mats.metal);
  handle.position.set(w * 0.3, 0.4 + h / 2 - 0.8, d / 2 + 0.35);
  g.add(handle);

  const ch = new Mesh(new CylinderGeometry(0.55, 0.75, 8), mats.steelDark);
  ch.position.set(w / 3, 0.4 + h + 4, 0);
  ch.castShadow = true;
  g.add(ch);
  const chHat = new Mesh(new ConeGeometry(0.9, 0.6, 12), mats.steelDark);
  chHat.position.set(w / 3, 0.4 + h + 8.3, 0);
  g.add(chHat);
  const chCollar = new Mesh(new CylinderGeometry(0.95, 0.95, 0.25), mats.steelDark);
  chCollar.position.set(w / 3, 0.4 + h + 0.15, 0);
  g.add(chCollar);

  const cab = new Mesh(new BoxGeometry(1.5, 2.2, 1), mats.byColor(0x2B_33_40));
  cab.position.set(-w / 2 - 1.5, 1.1, d / 3);
  cab.castShadow = true;
  g.add(cab);
  const panel = new Mesh(new BoxGeometry(1.2, 1.9, 0.05), mats.byColor(0x3B_42_52));
  panel.position.set(-w / 2 - 1.5, 1.15, d / 3 + 0.52);
  g.add(panel);
  mats.addStatusLED(g, [-w / 2 - 1.5 - 0.25, 1.8, d / 3 + 0.56], 0x10_B9_81);
  mats.addStatusLED(g, [-w / 2 - 1.5, 1.8, d / 3 + 0.56], 0xF5_9E_0B);
  mats.addStatusLED(g, [-w / 2 - 1.5 + 0.25, 1.8, d / 3 + 0.56], 0xEF_44_44);
  const hmiMat = new MeshStandardMaterial({
    color: 0x3B_82_F6,
    emissive: 0x3B_82_F6,
    emissiveIntensity: 0.7,
    roughness: 0.2
  });
  const hmi = new Mesh(new BoxGeometry(0.55, 0.35, 0.02), hmiMat);
  hmi.position.set(-w / 2 - 1.5, 1.3, d / 3 + 0.555);
  g.add(hmi);

  mats.addPipe(g, [-w / 2 - 1.5, 0.5, d / 3 - 0.3], [-w / 2 - 0.1, 0.5, d / 3 - 0.3], 0.1);
  mats.addPipe(g, [-w / 2 - 0.1, 0.5, d / 3 - 0.3], [-w / 2 - 0.1, 1.5, d / 3 - 0.3], 0.1);
  mats.addVentGrille(g, 1.2, 0.8, [w / 2 + 0.01, 0.4 + h * 0.3, 0], Math.PI / 2);
  mats.addVentGrille(g, 1.2, 0.8, [w / 2 + 0.01, 0.4 + h * 0.3, d * 0.3], Math.PI / 2);
  return g;
}

function makeCabinet(mats: MachineMaterials, accent?: number, w = 2, d = 1.4): Group {
  const g = new Group();
  const body = new Mesh(new BoxGeometry(w, 2.2, d), mats.byColor(accent ?? 0x64_74_8B));
  body.position.y = 1.1;
  body.castShadow = true;
  g.add(body);
  mats.addStatusLED(g, [w * 0.25, 1.9, d / 2 + 0.02], 0x10_B9_81);
  return g;
}

/** Articulated robot arm (FANUC/KUKA-style) — first-pass build. */
function makeRobot(mats: MachineMaterials, accent = 0xF5_9E_0B): Group {
  const g = new Group();
  mats.addBase(g, 3, 3, 0.5);
  const pedestal = new Mesh(new CylinderGeometry(0.9, 1.1, 1.2, 20), mats.byColor(accent));
  pedestal.position.y = 1.1;
  pedestal.castShadow = true;
  g.add(pedestal);
  const shoulder = new Mesh(new BoxGeometry(1.4, 1.2, 1.2), mats.byColor(accent));
  shoulder.position.y = 2.1;
  g.add(shoulder);
  const upperArm = new Mesh(new BoxGeometry(0.8, 3.4, 0.8), mats.byColor(accent));
  upperArm.position.set(0, 3.6, 0);
  upperArm.rotation.z = 0.35;
  g.add(upperArm);
  const foreArm = new Mesh(new BoxGeometry(0.6, 2.8, 0.6), mats.byColor(accent));
  foreArm.position.set(1.6, 4.9, 0);
  foreArm.rotation.z = -0.9;
  g.add(foreArm);
  const wrist = new Mesh(new CylinderGeometry(0.3, 0.3, 0.8, 12), mats.steelDark);
  wrist.rotation.z = Math.PI / 2;
  wrist.position.set(3, 5.1, 0);
  g.add(wrist);
  return g;
}

/** Welding positioner (turntable + L-arm) — first-pass build. */
function makePositionneur(mats: MachineMaterials, accent?: number): Group {
  const g = new Group();
  mats.addBase(g, 4, 4, 0.5);
  const post = new Mesh(new BoxGeometry(1, 3.2, 1), mats.byColor(accent ?? 0x3B_82_F6));
  post.position.set(-1.4, 1.6 + 0.5, 0);
  post.castShadow = true;
  g.add(post);
  const head = new Mesh(new CylinderGeometry(0.7, 0.7, 0.8, 20), mats.steelDark);
  head.rotation.z = Math.PI / 2;
  head.position.set(-0.7, 3, 0);
  g.add(head);
  const table = new Mesh(new CylinderGeometry(1.8, 1.8, 0.25, 28), mats.metal);
  table.rotation.z = Math.PI / 2;
  table.position.set(0.1, 3, 0);
  table.castShadow = true;
  g.add(table);
  return g;
}

/** Lathe (tour) — long bed + headstock + tailstock — first-pass build. */
function makeTour(mats: MachineMaterials, size: string, accent = 0x2F_6E_4F): Group {
  const g = new Group();
  const len = size === 'L' ? 12 : 8;
  mats.addBase(g, len + 1, 2.6, 0.6);
  const bed = new Mesh(new BoxGeometry(len, 1.1, 1.6), mats.byColor(accent));
  bed.position.y = 1.15;
  bed.castShadow = true;
  g.add(bed);
  const headstock = new Mesh(new BoxGeometry(2.2, 1.8, 1.8), mats.byColor(accent));
  headstock.position.set(-len / 2 + 1.1, 2.1, 0);
  g.add(headstock);
  const spindle = new Mesh(new CylinderGeometry(0.4, 0.4, 1.4, 16), mats.metal);
  spindle.rotation.z = Math.PI / 2;
  spindle.position.set(-len / 2 + 2.2, 2.2, 0);
  g.add(spindle);
  const tailstock = new Mesh(new BoxGeometry(1.4, 1.3, 1.4), mats.steelDark);
  tailstock.position.set(len / 2 - 1, 1.95, 0);
  g.add(tailstock);
  mats.addStatusLED(g, [-len / 2 + 1.1, 3.1, 0.9], 0x10_B9_81);
  return g;
}

/** Milling machine (fraiseuse) — column + table + spindle — first-pass build. */
function makeFraiseuse(mats: MachineMaterials, accent = 0x4B_55_63): Group {
  const g = new Group();
  mats.addBase(g, 5, 4, 0.6);
  const column = new Mesh(new BoxGeometry(1.6, 4.5, 1.6), mats.byColor(accent));
  column.position.set(-1.4, 2.85, 0);
  column.castShadow = true;
  g.add(column);
  const knee = new Mesh(new BoxGeometry(3.2, 0.6, 2.6), mats.byColor(accent));
  knee.position.set(0.4, 1.4, 0);
  g.add(knee);
  const table = new Mesh(new BoxGeometry(3.6, 0.3, 1.4), mats.metal);
  table.position.set(0.4, 1.85, 0);
  table.castShadow = true;
  g.add(table);
  const head = new Mesh(new BoxGeometry(1.2, 1.2, 1.2), mats.byColor(accent));
  head.position.set(0.2, 4.4, 0);
  g.add(head);
  const spindle = new Mesh(new CylinderGeometry(0.22, 0.22, 1, 12), mats.metal);
  spindle.position.set(0.2, 3.4, 0);
  g.add(spindle);
  return g;
}

/** Band/circular saw (scie) — first-pass build. */
function makeScie(mats: MachineMaterials, accent?: number): Group {
  const g = new Group();
  mats.addBase(g, 4, 2.4, 0.5);
  const table = new Mesh(new BoxGeometry(3.6, 0.3, 2), mats.metal);
  table.position.y = 1;
  table.castShadow = true;
  g.add(table);
  const blade = new Mesh(new CylinderGeometry(1.1, 1.1, 0.04, 36), mats.steelDark);
  blade.position.set(0, 1.9, 0);
  g.add(blade);
  const guard = new Mesh(new TorusGeometry(1.15, 0.12, 8, 28, Math.PI), mats.byColor(accent ?? 0xF5_9E_0B));
  guard.position.set(0, 1.9, 0);
  g.add(guard);
  return g;
}

/** Broaching machine (brocheuse) — tall vertical ram — first-pass build. */
function makeBrocheuse(mats: MachineMaterials, accent?: number): Group {
  const g = new Group();
  const column = new Mesh(new BoxGeometry(1.8, 7, 1.8), mats.byColor(accent ?? 0x33_41_55));
  mats.addBase(g, 3, 3, 0.6);
  column.position.y = 4;
  column.castShadow = true;
  g.add(column);
  const ram = new Mesh(new BoxGeometry(0.7, 5, 0.7), mats.metal);
  ram.position.set(0, 3.8, 1);
  g.add(ram);
  const tableTop = new Mesh(new BoxGeometry(2.4, 0.4, 2.4), mats.steelDark);
  tableTop.position.set(0, 0.8, 1);
  g.add(tableTop);
  return g;
}

/** Dye-penetrant inspection table (ressuage) — first-pass build. */
function makeTableRessuage(mats: MachineMaterials, accent?: number): Group {
  const g = new Group();
  mats.addBase(g, 6, 3, 0.4);
  const tableTop = new Mesh(new BoxGeometry(5.5, 0.25, 2.6), mats.byColor(accent ?? 0x0E_A5_E9));
  tableTop.position.y = 1;
  tableTop.castShadow = true;
  g.add(tableTop);
  for (let i = 0; i < 3; i++) {
    const tank = new Mesh(new BoxGeometry(1.4, 0.9, 2.2), mats.steelDark);
    tank.position.set(-1.8 + i * 1.8, 0.6, 0);
    g.add(tank);
  }
  return g;
}

/**
 * Welding / machining gantry (portique). A `span`-wide bridge rides on two
 * legs travelling along floor rails; a trolley carries a vertical ram with a
 * tool head (torch / spindle). `span` and `height` (metres) drive the scale;
 * `legWidth` (metres) overrides the leg/pillar cross-section when > 0.
 */
// eslint-disable-next-line max-params -- span + height + legWidth + accent read clearly
function makePortique(
  mats: MachineMaterials,
  span: number,
  height: number,
  legWidth?: number,
  accent?: number
): Group {
  const g = new Group();
  const paint = accent ?? 0x3B_82_F6;
  const h = height;
  const legW = legWidth && legWidth > 0 ? legWidth : 0.5 + span * 0.03;
  const depth = 2.2 + span * 0.12;
  const beamTop = 0.4 + h;
  const beamH = 0.6 + span * 0.025;
  const trolleyX = span * 0.12;

  mats.addBase(g, span + legW * 2 + 1, depth + 1, 0.3);

  for (const sx of [-span / 2, span / 2]) {
    const rail = new Mesh(new BoxGeometry(0.4, 0.2, depth + 0.6), mats.steelDark);
    rail.position.set(sx, 0.45, 0);
    g.add(rail);
    const leg = new Mesh(new BoxGeometry(legW, h, legW * 1.4), mats.byColor(paint));
    leg.position.set(sx, 0.4 + h / 2, 0);
    leg.castShadow = true;
    g.add(leg);
    const foot = new Mesh(new BoxGeometry(legW * 1.7, 0.5, depth * 0.5), mats.steelDark);
    foot.position.set(sx, 0.65, 0);
    g.add(foot);
  }

  const beam = new Mesh(new BoxGeometry(span + legW, beamH, legW * 1.3), mats.byColor(paint));
  beam.position.set(0, beamTop + beamH / 2, 0);
  beam.castShadow = true;
  g.add(beam);

  const trolley = new Mesh(new BoxGeometry(1.2, 0.7, legW * 1.3 + 0.3), mats.metal);
  trolley.position.set(trolleyX, beamTop + beamH * 0.5, 0);
  g.add(trolley);

  const ramLen = h * 0.5;
  const ram = new Mesh(new BoxGeometry(0.4, ramLen, 0.4), mats.steelDark);
  ram.position.set(trolleyX, beamTop - ramLen / 2 + 0.3, 0);
  g.add(ram);
  const toolHead = new Mesh(new CylinderGeometry(0.18, 0.05, 0.8, 12), mats.byColor(accent ?? 0xF5_9E_0B));
  toolHead.position.set(trolleyX, beamTop - ramLen + 0.1, 0);
  g.add(toolHead);

  mats.addStatusLED(g, [-span / 2 + legW, 0.4 + h * 0.6, legW * 0.9], 0x10_B9_81);
  return g;
}

/**
 * Industrial tilter / dumper (basculeur). A ground-level cradle (floor plate +
 * back wall) is hinged on a low axis at the rear edge; it tips the container up
 * and forward, driven by a hydraulic cylinder. The cradle sits ON the floor at
 * rest — only its front lifts. `w`/`h`/`d` (metres) set the size.
 */
// eslint-disable-next-line max-params -- size + accent + initial tilt read clearly
function makeBasculeur(
  mats: MachineMaterials,
  w: number,
  h: number,
  d: number,
  accent = 0xF5_9E_0B,
  tilt = -0.5
): Group {
  const g = new Group();
  const baseTop = 0.4;
  const pivotZ = -d / 2;
  const pivotY = baseTop + 0.15;

  mats.addBase(g, w + 1, d + 1, baseTop);

  // Low hinge axis (cylinder along X) at the rear, just above the floor.
  const hinge = new Mesh(new CylinderGeometry(0.16, 0.16, w * 0.95, 16), mats.metal);
  hinge.rotation.z = Math.PI / 2;
  hinge.position.set(0, pivotY, pivotZ);
  g.add(hinge);

  // Tilting cradle, hinged at the floor: plate extends forward (+z) from pivot.
  // Named so the scene can drive its angle live from a datapoint.
  const cradle = new Group();
  cradle.name = 'mf-tilt';
  const plate = new Mesh(new BoxGeometry(w * 0.9, 0.18, d), mats.byColor(accent));
  plate.position.set(0, 0, d / 2);
  plate.castShadow = true;
  cradle.add(plate);
  const backWall = new Mesh(new BoxGeometry(w * 0.9, h * 0.4, 0.18), mats.byColor(accent));
  backWall.position.set(0, h * 0.2, 0);
  cradle.add(backWall);
  const bin = new Mesh(new BoxGeometry(w * 0.74, h * 0.42, d * 0.62), mats.byColor(0x4A_55_68));
  bin.position.set(0, h * 0.2 + 0.1, d * 0.5);
  bin.castShadow = true;
  cradle.add(bin);
  cradle.position.set(0, pivotY, pivotZ);
  cradle.rotation.x = tilt;
  g.add(cradle);

  // Hydraulic cylinder pushing the plate up, from the base to the plate midpoint.
  const midZ = pivotZ + d * 0.5 * Math.cos(tilt);
  const midY = pivotY - d * 0.5 * Math.sin(tilt);
  mats.addPipe(g, [0, baseTop + 0.1, midZ], [0, midY - 0.1, midZ], 0.16, 0x9A_A1_AD);
  mats.addStatusLED(g, [w / 2 - 0.3, baseTop + 0.4, pivotZ + 0.3], 0x10_B9_81);
  return g;
}

/**
 * Gantry with a rotary machining table (portique-table): a {@link makePortique}
 * gantry plus a circular, rotary work table standing on the floor within the
 * span (against the gantry). `tableDiameter` (metres) sets the table size.
 */
// eslint-disable-next-line max-params -- span/height/legWidth/diameter/accent read clearly
function makePortiqueWithTable(
  mats: MachineMaterials,
  span: number,
  height: number,
  legWidth: number | undefined,
  tableDiameter: number,
  accent?: number
): Group {
  const g = makePortique(mats, span, height, legWidth, accent);
  const r = Math.max(0.4, tableDiameter / 2);
  // Pedestal + rotary top (named `mf-rotary` so the scene can spin it live).
  const pedestal = new Mesh(new CylinderGeometry(r * 0.55, r * 0.7, 0.7, 24), mats.steelDark);
  pedestal.position.set(0, 0.75, 0);
  pedestal.castShadow = true;
  g.add(pedestal);
  const top = new Mesh(new CylinderGeometry(r, r, 0.22, 40), mats.byColor(accent ?? 0x9A_A1_AD));
  top.name = 'mf-rotary';
  top.position.set(0, 1.2, 0);
  top.castShadow = true;
  // T-slot hints across the table face.
  for (const off of [-r * 0.45, 0, r * 0.45]) {
    const slot = new Mesh(new BoxGeometry(r * 1.7, 0.04, 0.12), mats.steelDark);
    slot.position.set(0, 0.13, off);
    top.add(slot);
  }
  g.add(top);
  return g;
}

/** Default gantry height (metres) derived from its span. */
function portiqueDefaultHeight(span: number): number {
  return 3 + span * 0.45;
}

/** Resolve a portique `variant` (size preset string or explicit metres) to a span. */
function portiqueSpan(variant: string | number | undefined): number {
  if (typeof variant === 'number' && variant > 0) return variant;
  if (typeof variant === 'string' && variant in PORTIQUE_SPANS) {
    return PORTIQUE_SPANS[variant as PortiqueSize];
  }
  return PORTIQUE_SPANS.M;
}

/** Name of the camera-facing child group inside a billboard machine. */
export const BILLBOARD_CHILD = 'mf-billboard';

/**
 * A flat icon "billboard": a textured plane standing on a small base/pole, kept
 * facing the camera by the scene controller. Used for SemiFab utility/process
 * posts represented by SVG icons rather than procedural geometry.
 */
function makeBillboard(mats: MachineMaterials, w: number, h: number): Group {
  const g = new Group();
  mats.addBase(g, Math.max(w, 2), 1.6, 0.3);
  const poleH = Math.max(0.6, h * 0.15);
  const pole = new Mesh(new BoxGeometry(0.25, poleH, 0.25), mats.steelDark);
  pole.position.y = 0.4 + poleH / 2;
  g.add(pole);
  const card = new Group();
  card.name = BILLBOARD_CHILD;
  card.position.y = 0.4 + poleH + h / 2;
  const mat = new MeshBasicMaterial({ transparent: true, side: DoubleSide, depthWrite: false });
  card.add(new Mesh(new PlaneGeometry(w, h), mat));
  g.add(card);
  mats.addStatusLED(g, [Math.max(w, 2) / 2 - 0.3, 0.55, 0.4], 0x10_B9_81);
  return g;
}

/** Load an icon (SVG or raster, URL or data:) onto a billboard's plane texture. */
export function applyBillboardTexture(group: Group, src: string): void {
  const card = group.getObjectByName(BILLBOARD_CHILD);
  const mesh = card?.children.find((c): c is Mesh => c instanceof Mesh);
  const mat = mesh?.material;
  if (!mat || Array.isArray(mat)) return;
  void resolveImageSrc(src)
    .then((finalSrc) => {
      const img = new Image();
      img.addEventListener('load', () => {
        const tex = new Texture(img);
        tex.colorSpace = SRGBColorSpace;
        tex.needsUpdate = true;
        (mat as MeshBasicMaterial).map = tex;
        mat.needsUpdate = true;
      });
      img.src = finalSrc;
    })
    .catch(() => {
      /* icon unavailable — leave the plane blank */
    });
}

/** SVG sources are normalised (explicit size) before use; raster passes through. */
async function resolveImageSrc(src: string): Promise<string> {
  const isSvg = src.startsWith('data:image/svg') || /\.svg(\?|$)/i.test(src);
  if (!isSvg) return src;
  const svg = src.startsWith('data:') ? decodeDataUrl(src) : await fetch(src).then((r) => r.text());
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(ensureSvgSize(svg))}`;
}

/** Decode a data: URL payload (base64 or percent-encoded) to text. */
function decodeDataUrl(url: string): string {
  const comma = url.indexOf(',');
  if (comma === -1) return '';
  const meta = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  return meta.includes('base64') ? atob(payload) : decodeURIComponent(payload);
}

/** Ensure the SVG has explicit width/height (from its viewBox) so it rasterises
 * at the right aspect when used as an <img> texture source. */
function ensureSvgSize(svg: string): string {
  if (/<svg[^>]*\swidth=/.test(svg)) return svg;
  const vb = svg.match(/viewBox="([\d.\s-]+)"/);
  if (!vb) return svg;
  const parts = vb[1].trim().split(/\s+/).map(Number);
  const w = Math.round(parts[2] || 256);
  const h = Math.round(parts[3] || 256);
  return svg.replace('<svg', `<svg width="${w}" height="${h}"`);
}

/** Neutral host shell for an imported GLB (no detail until the model loads). */
function makeGlbHost(mats: MachineMaterials): Group {
  const g = new Group();
  const shell = new Mesh(new BoxGeometry(4, 3, 4), mats.flatMat(0x47_55_69));
  shell.position.y = 1.5;
  shell.castShadow = true;
  g.add(shell);
  return g;
}

/** Parse a `#RRGGBB` colour string to a Three.js numeric colour. */
function parseHexColor(hex: string | undefined): number | undefined {
  if (!hex) return undefined;
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  const value = Number.parseInt(clean, HEX_RADIX);
  return Number.isNaN(value) ? undefined : value;
}

/** Build a machine mesh for the given definition. */
export function buildMachine(def: MachineDef, mats: MachineMaterials): Group {
  const accent = parseHexColor(def.color);
  switch (def.type) {
    case 'four': {
      return makeFour(mats, typeof def.variant === 'number' ? def.variant : 300, accent);
    }
    case 'robot': {
      return makeRobot(mats, accent);
    }
    case 'positionneur': {
      return makePositionneur(mats, accent);
    }
    case 'tour': {
      return makeTour(mats, typeof def.variant === 'string' ? def.variant : 'M', accent);
    }
    case 'fraiseuse': {
      return makeFraiseuse(mats, accent);
    }
    case 'scie': {
      return makeScie(mats, accent);
    }
    case 'brocheuse': {
      return makeBrocheuse(mats, accent);
    }
    case 'ressuage': {
      return makeTableRessuage(mats, accent);
    }
    case 'portique': {
      const span = def.portiqueSpan && def.portiqueSpan > 0 ? def.portiqueSpan : portiqueSpan(def.variant);
      const height = def.portiqueHeight && def.portiqueHeight > 0 ? def.portiqueHeight : portiqueDefaultHeight(span);
      return makePortique(mats, span, height, def.portiqueLegW, accent);
    }
    case 'portique-table': {
      const span = def.portiqueSpan && def.portiqueSpan > 0 ? def.portiqueSpan : portiqueSpan(def.variant);
      const height = def.portiqueHeight && def.portiqueHeight > 0 ? def.portiqueHeight : portiqueDefaultHeight(span);
      const diameter = def.tableDiameter && def.tableDiameter > 0 ? def.tableDiameter : 3;
      return makePortiqueWithTable(mats, span, height, def.portiqueLegW, diameter, accent);
    }
    case 'basculeur': {
      const w = def.basculeurW && def.basculeurW > 0 ? def.basculeurW : 4;
      const h = def.basculeurH && def.basculeurH > 0 ? def.basculeurH : 3.5;
      const d = def.basculeurD && def.basculeurD > 0 ? def.basculeurD : 3;
      // Start flat when the angle is datapoint-driven; otherwise show a tilt.
      const tilt = def.tiltDp ? 0 : -0.5;
      return makeBasculeur(mats, w, h, d, accent, tilt);
    }
    case 'cabinet': {
      return makeCabinet(mats, accent);
    }
    case 'billboard': {
      const w = def.billboardW && def.billboardW > 0 ? def.billboardW : 6;
      const h = def.billboardH && def.billboardH > 0 ? def.billboardH : 6;
      return makeBillboard(mats, w, h);
    }
    case 'glb': {
      return makeGlbHost(mats);
    }
    default: {
      return makeCabinet(mats, accent);
    }
  }
}
