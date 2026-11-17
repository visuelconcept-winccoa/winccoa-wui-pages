// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The person on foot, in 3D (#89): a jointed figure that figure.ts' poses move, and the weapons
 * held in its right hand.
 *
 * Joints: hips (bounce, sway) → pelvis (turn, drop) → thighs → knees → ankles; trunk (lean,
 * twist) → shoulders → elbows → hands; neck → head (kept level and facing ahead). Shapes are
 * turned from anatomical profiles (thigh fuller at the top, calf bulging at the back, a waist,
 * a chest, deltoids), with a face (jaw, nose, ears, eyes, brows), hands with a thumb, shoes on a
 * sole. A jacket in the player's colour (neon zip, belt, sleeve stripes and cuffs); the build,
 * the skin and the hair vary from one person to the next.
 *
 * Weapons point along the hand (down when the arm hangs): the WebUI hammer, the star sword (an
 * original eight-ray star on the guard and a glowing blade), the cube crossbow (a WinCC OA logo
 * cube loaded). The cubes it shoots are drawn by world.ts with {@link makeCube}.
 */
import {
  BoxGeometry,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  SphereGeometry,
  TorusGeometry,
  LatheGeometry,
  Vector2,
  type Material,
  type Object3D
} from 'three';
import type { Pose } from './figure.js';
import { logoCanvas } from './logo.js';
import { mix } from './palette.js';
import type { WeaponId } from './weapons.js';

const HIP_Y = 0.95;
const THIGH = 0.44;
const SHIN = 0.43;
const UPPER_ARM = 0.29;
const FOREARM = 0.26;

const SKINS = [0xe8c4a8, 0xd9a882, 0xb98462, 0x8d5a3b, 0x613f2b];
const HAIRS = [0x1d1612, 0x3b2a1e, 0x6b4a2b, 0xb08a52, 0x2a2a2e];

/** A rounded limb or trunk turned from a profile: [radius, height] pairs, top first. */
function lathe(profile: readonly (readonly [number, number])[], mat: Material, sx = 1, sz = 1): Mesh {
  const pts = profile.map(([r, y]) => new Vector2(Math.max(0.001, r), y));
  const m = new Mesh(new LatheGeometry(pts, 18), mat);
  m.scale.set(sx, 1, sz);
  m.castShadow = true;
  return m;
}

/** A limb hanging from its joint (top at 0): radii along its length (fractions of it). */
function limb(length: number, radii: readonly (readonly [number, number])[], mat: Material, sz = 1): Mesh {
  // LatheGeometry wants the points from bottom to top
  const profile = [...radii].reverse().map(([r, f]) => [r, -f * length] as const);
  return lathe([[0.001, -length], ...profile, [0.001, 0]], mat, 1, sz);
}

function joint(name: string, x: number, y: number, z = 0): Group {
  const g = new Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

function ball(r: number, mat: Material, sx = 1, sy = 1, sz = 1): Mesh {
  const m = new Mesh(new SphereGeometry(r, 16, 12), mat);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  return m;
}

/** A hand: palm, four fingers curled together, the thumb apart. */
function makeHand(skin: Material, side: 1 | -1): Group {
  const hand = new Group();
  const palm = ball(0.045, skin, 0.85, 1.05, 0.45);
  palm.position.y = -0.04;
  const fingers = ball(0.04, skin, 0.85, 1.0, 0.42);
  fingers.position.set(0, -0.1, 0.012);
  fingers.rotation.x = 0.45;
  const thumb = ball(0.018, skin, 1, 2.2, 1);
  thumb.position.set(side * -0.035, -0.045, 0.025);
  thumb.rotation.z = side * 0.6;
  hand.add(palm, fingers, thumb);
  return hand;
}

/** A head: skull, jaw, nose, ears, eyes, hair. */
function makeHead(skin: Material, hairColor: number): Group {
  const head = new Group();
  const skull = ball(0.105, skin, 0.92, 1.05, 1.0);
  skull.position.y = 0.11;
  const jaw = ball(0.075, skin, 1.0, 0.85, 1.0);
  jaw.position.set(0, 0.045, 0.025);
  const nose = new Mesh(new ConeGeometry(0.016, 0.045, 8), skin);
  nose.rotation.x = Math.PI / 2 + 0.3;
  nose.position.set(0, 0.095, 0.105);
  const eyeMat = new MeshStandardMaterial({ color: 0x15100d, roughness: 0.3 });
  const brow = new MeshStandardMaterial({ color: hairColor, roughness: 0.9 });
  head.add(skull, jaw, nose);
  for (const sx of [-1, 1]) {
    const ear = ball(0.024, skin, 0.45, 1.0, 0.8);
    ear.position.set(sx * 0.097, 0.1, -0.005);
    const eye = ball(0.012, eyeMat);
    eye.position.set(sx * 0.036, 0.122, 0.092);
    const eyebrow = new Mesh(new BoxGeometry(0.035, 0.008, 0.01), brow);
    eyebrow.position.set(sx * 0.036, 0.143, 0.097);
    head.add(ear, eye, eyebrow);
  }
  const hair = new Mesh(new SphereGeometry(0.11, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), new MeshStandardMaterial({ color: hairColor, roughness: 0.95 }));
  hair.scale.set(0.95, 1.05, 1.05);
  hair.position.set(0, 0.125, -0.008);
  hair.rotation.x = -0.35;
  head.add(hair);
  return head;
}

/** A shoe: a rounded upper on a sole, the toe forward. */
function makeShoe(mat: Material, sole: Material): Group {
  const shoe = new Group();
  const upper = ball(0.06, mat, 0.85, 0.7, 2.0);
  upper.position.set(0, 0.035, 0.055);
  const s = new Mesh(new BoxGeometry(0.095, 0.022, 0.25), sole);
  s.position.set(0, 0.005, 0.055);
  shoe.add(upper, s);
  return shoe;
}

/**
 * A person in the player's neon colour. `seed` (0..1) varies the build, the skin and the hair,
 * so that two people are not the same doll.
 */
export function makeFigure(color: number, seed = 0.37): Group {
  const root = new Group();
  const rnd = (k: number): number => {
    const x = Math.sin((seed + 1) * 9301 + k * 49297) * 233280;
    return x - Math.floor(x);
  };
  const skin = new MeshStandardMaterial({ color: SKINS[Math.floor(rnd(1) * SKINS.length)], roughness: 0.62 });
  const trousers = new MeshStandardMaterial({ color: mix(0x1c2328, 0x2a3a52, rnd(2)), roughness: 0.85 });
  const jacket = new MeshStandardMaterial({ color: mix(color, 0x000000, 0.62), roughness: 0.55 });
  const shoes = new MeshStandardMaterial({ color: 0x14181b, roughness: 0.45 });
  const sole = new MeshStandardMaterial({ color: 0xd8dcdc, roughness: 0.7 });
  const neon = new MeshBasicMaterial({ color, toneMapped: false });
  const build = 0.94 + rnd(3) * 0.12; // height
  const broad = 0.93 + rnd(4) * 0.14; // shoulders, chest
  root.scale.setScalar(build);

  const hips = joint('hips', 0, HIP_Y);
  root.add(hips);
  const pelvis = joint('pelvis', 0, 0);
  hips.add(pelvis);
  const seat = lathe(
    [
      [0.001, -0.1],
      [0.12, -0.08],
      [0.155, 0.0],
      [0.15, 0.08],
      [0.001, 0.1]
    ],
    trousers,
    1.1,
    0.75
  );
  pelvis.add(seat);
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const thigh = joint(`thigh${side}`, sx * 0.095, -0.03);
    // thigh: full at the top, slimmer to the knee
    thigh.add(
      limb(
        THIGH,
        [
          [0.088, 0],
          [0.084, 0.25],
          [0.07, 0.6],
          [0.056, 0.92],
          [0.05, 1]
        ],
        trousers,
        0.95
      )
    );
    const knee = joint(`knee${side}`, 0, -THIGH);
    // shin: the calf bulges at the back, slim ankle
    const shin = limb(
      SHIN,
      [
        [0.052, 0],
        [0.058, 0.22],
        [0.05, 0.5],
        [0.038, 0.85],
        [0.034, 1]
      ],
      trousers,
      1.05
    );
    shin.position.z = -0.006;
    knee.add(shin);
    const ankle = joint(`ankle${side}`, 0, -SHIN);
    ankle.add(makeShoe(shoes, sole));
    knee.add(ankle);
    thigh.add(knee);
    pelvis.add(thigh);
  }

  const trunk = joint('trunk', 0, 0.06);
  hips.add(trunk);
  // trunk: waist, chest, shoulders, narrowing to the neck
  const chest = lathe(
    [
      [0.001, 0.0],
      [0.15, 0.0],
      [0.142, 0.1],
      [0.138, 0.18],
      [0.158, 0.32],
      [0.172, 0.42],
      [0.165, 0.5],
      [0.12, 0.55],
      [0.001, 0.57]
    ],
    jacket,
    1.18 * broad,
    0.72
  );
  const zip = new Mesh(new BoxGeometry(0.012, 0.42, 0.01), neon);
  zip.position.set(0, 0.26, 0.122);
  const belt = new Mesh(new CylinderGeometry(0.162, 0.162, 0.04, 24), neon);
  belt.scale.set(1.12, 1, 0.76);
  belt.position.y = 0.0;
  const collar = new Mesh(new TorusGeometry(0.065, 0.018, 8, 20), jacket);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.56;
  trunk.add(chest, zip, belt, collar);
  const neck = joint('neck', 0, 0.56);
  const neckMesh = new Mesh(new CylinderGeometry(0.045, 0.052, 0.09, 12), skin);
  neckMesh.position.y = 0.03;
  neck.add(neckMesh);
  const head = joint('head', 0, 0.06);
  head.add(makeHead(skin, HAIRS[Math.floor(rnd(5) * HAIRS.length)]));
  neck.add(head);
  trunk.add(neck);
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const shoulder = joint(`shoulder${side}`, sx * 0.19 * broad, 0.48);
    const deltoid = ball(0.058, jacket, 1.05, 0.95, 1);
    deltoid.position.y = -0.02;
    shoulder.add(deltoid);
    shoulder.add(
      limb(
        UPPER_ARM,
        [
          [0.05, 0],
          [0.05, 0.3],
          [0.046, 0.6],
          [0.04, 1]
        ],
        jacket
      )
    );
    const stripe = new Mesh(new CylinderGeometry(0.049, 0.049, 0.022, 14), neon);
    stripe.position.y = -UPPER_ARM * 0.55;
    shoulder.add(stripe);
    const elbow = joint(`elbow${side}`, 0, -UPPER_ARM);
    elbow.add(
      limb(
        FOREARM,
        [
          [0.042, 0],
          [0.044, 0.22],
          [0.036, 0.7],
          [0.03, 1]
        ],
        jacket,
        0.85
      )
    );
    const cuff = new Mesh(new CylinderGeometry(0.033, 0.033, 0.02, 12), neon);
    cuff.position.y = -FOREARM + 0.015;
    elbow.add(cuff);
    const hand = joint(`hand${side}`, 0, -FOREARM);
    hand.add(makeHand(skin, sx));
    elbow.add(hand);
    shoulder.add(elbow);
    trunk.add(shoulder);
  }
  root.userData.color = color;
  return root;
}

/** Applies a pose (figure.ts) to the figure's joints. */
export function applyPose(fig: Group, pose: Pose): void {
  const j = (name: string): Object3D | undefined => fig.getObjectByName(name);
  const hips = j('hips');
  if (hips) {
    hips.position.y = HIP_Y + pose.bob;
    hips.position.x = pose.sway;
  }
  const pelvis = j('pelvis');
  if (pelvis) pelvis.rotation.set(0, pose.pelvisYaw, pose.pelvisRoll);
  const rx = (name: string, x: number, z = 0): void => {
    const o = j(name);
    if (o) o.rotation.set(x, 0, z);
  };
  rx('thighL', -pose.hipL);
  rx('thighR', -pose.hipR);
  rx('kneeL', pose.kneeL);
  rx('kneeR', pose.kneeR);
  rx('ankleL', -pose.ankleL);
  rx('ankleR', -pose.ankleR);
  // arms a little off the body; "across" brings the hand towards the middle
  rx('shoulderL', -pose.shoulderL, 0.1 - pose.acrossL);
  rx('shoulderR', -pose.shoulderR, -0.1 + pose.acrossR);
  rx('elbowL', -pose.elbowL);
  rx('elbowR', -pose.elbowR);
  const trunk = j('trunk');
  if (trunk) trunk.rotation.set(pose.lean, pose.twist, -pose.pelvisRoll * 0.5);
  // the head keeps facing ahead and level
  const neck = j('neck');
  if (neck) neck.rotation.set(pose.nod - pose.lean * 0.6, -pose.twist * 0.75, pose.pelvisRoll * 0.4);
}

// --- weapons ---------------------------------------------------------------------------------

const TEXTURES = new Map<string, CanvasTexture>();

function texture(key: string, draw: (g: CanvasRenderingContext2D, c: HTMLCanvasElement) => void, w = 256, h = 128): CanvasTexture {
  const kept = TEXTURES.get(key);
  if (kept) return kept;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d') as CanvasRenderingContext2D, c);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  TEXTURES.set(key, t);
  return t;
}

/** "WebUI" on the hammer's head. */
const webuiLabel = (): CanvasTexture =>
  texture('webui', (g, c) => {
    g.fillStyle = '#0d1a20';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#00eaff';
    g.font = 'bold 78px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('WebUI', c.width / 2, c.height / 2 + 4);
  });

/** An original eight-ray star, warm orange, on the sword's guard. */
const starMark = (): CanvasTexture =>
  texture(
    'star',
    (g, c) => {
      g.fillStyle = '#1a1310';
      g.fillRect(0, 0, c.width, c.height);
      g.translate(c.width / 2, c.height / 2);
      g.fillStyle = '#e07a50';
      for (let k = 0; k < 8; k++) {
        g.rotate(Math.PI / 4);
        g.beginPath();
        g.moveTo(-7, 0);
        g.quadraticCurveTo(0, -58, 7, 0);
        g.closePath();
        g.fill();
      }
      g.beginPath();
      g.arc(0, 0, 9, 0, Math.PI * 2);
      g.fill();
    },
    128,
    128
  );

/** The WinCC OA logo cube of the crossbow (and of its shots). */
export function makeCube(size: number): Mesh {
  const map = texture('cube', (g, c) => g.drawImage(logoCanvas(256), 0, 0, c.width, c.height), 256, 256);
  const mat = new MeshBasicMaterial({ map, toneMapped: false });
  mat.color.setScalar(1.2);
  return new Mesh(new BoxGeometry(size, size, size), mat);
}

/** A weapon, pointing along -Y from the hand that holds it. */
export function makeWeapon(id: WeaponId, color: number): Group {
  const g = new Group();
  g.name = `weapon:${id}`;
  const metal = new MeshStandardMaterial({ color: 0x9aa4a8, metalness: 0.85, roughness: 0.3 });
  const grip = new MeshStandardMaterial({ color: 0x1a1d20, roughness: 0.8 });
  const neon = new MeshBasicMaterial({ color, toneMapped: false });
  if (id === 'hammer') {
    const handle = new Mesh(new CylinderGeometry(0.025, 0.03, 0.7, 10), grip);
    handle.position.y = -0.25;
    const ring = new Mesh(new CylinderGeometry(0.033, 0.033, 0.03, 10), neon);
    ring.position.y = -0.52;
    const head = new Mesh(new BoxGeometry(0.34, 0.17, 0.17), [metal, metal, metal, metal, new MeshStandardMaterial({ map: webuiLabel(), roughness: 0.4 }), new MeshStandardMaterial({ map: webuiLabel(), roughness: 0.4 })]);
    head.position.y = -0.62;
    head.rotation.y = Math.PI / 2; // the label faces the side
    const edge = new Mesh(new BoxGeometry(0.36, 0.02, 0.19), neon);
    edge.position.y = -0.535;
    edge.rotation.y = Math.PI / 2;
    g.add(handle, ring, head, edge);
  } else if (id === 'sword') {
    const hilt = new Mesh(new CylinderGeometry(0.022, 0.022, 0.16, 10), grip);
    hilt.position.y = 0.02;
    const pommel = new Mesh(new SphereGeometry(0.035, 10, 8), metal);
    pommel.position.y = 0.11;
    const guard = new Mesh(new BoxGeometry(0.22, 0.05, 0.06), [metal, metal, metal, metal, new MeshStandardMaterial({ map: starMark(), roughness: 0.4 }), new MeshStandardMaterial({ map: starMark(), roughness: 0.4 })]);
    guard.position.y = -0.08;
    const bladeMat = new MeshBasicMaterial({ color: mix(color, 0xffffff, 0.65), toneMapped: false });
    bladeMat.color.multiplyScalar(1.6);
    const blade = new Mesh(new BoxGeometry(0.05, 0.85, 0.012), bladeMat);
    blade.position.y = -0.53;
    const tip = new Mesh(new CylinderGeometry(0, 0.035, 0.1, 4), bladeMat);
    tip.rotation.y = Math.PI / 4;
    tip.scale.z = 0.25;
    tip.position.y = -1.0;
    tip.rotation.x = Math.PI;
    g.add(hilt, pommel, guard, blade, tip);
    g.rotation.x = -1.0; // held forward of the forearm, as a real grip, not in line with it
  } else {
    const stock = new Mesh(new BoxGeometry(0.07, 0.62, 0.08), grip);
    stock.position.y = -0.22;
    const rail = new Mesh(new BoxGeometry(0.03, 0.5, 0.02), neon);
    rail.position.set(0, -0.3, 0.05);
    // the bow: half a ring across the front, its string
    const bow = new Mesh(new TorusGeometry(0.3, 0.018, 8, 24, Math.PI), metal);
    bow.position.y = -0.48;
    bow.rotation.z = Math.PI;
    const string = new Mesh(new CylinderGeometry(0.004, 0.004, 0.6, 4), neon);
    string.rotation.z = Math.PI / 2;
    string.position.y = -0.4;
    const cube = makeCube(0.11);
    cube.position.set(0, -0.36, 0.1);
    cube.name = 'loaded';
    g.add(stock, rail, bow, string, cube);
  }
  return g;
}

/** Puts weapon `id` in the figure's right hand (or none). */
export function setFigureWeapon(fig: Group, id: WeaponId | null): void {
  const hand = fig.getObjectByName('handR');
  if (!hand) return;
  const current = hand.children.find((c) => c.name.startsWith('weapon:'));
  if (current?.name === `weapon:${id}`) return;
  if (current) hand.remove(current);
  if (id) hand.add(makeWeapon(id, fig.userData.color as number));
}
