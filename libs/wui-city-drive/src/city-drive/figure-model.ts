// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The person on foot, in 3D (#89): a jointed figure that figure.ts' poses move — a man or a
 * woman — and the WinCC OA logo cube it throws.
 *
 * Joints: hips (bounce, sway) → pelvis (turn, drop) → thighs → knees → ankles; trunk (lean,
 * twist) → shoulders → elbows → hands; neck → head (kept level and facing ahead). Shapes are
 * turned from anatomical profiles (thigh fuller at the top, calf bulging at the back, a waist,
 * a chest, deltoids), with a face (jaw, nose, ears, eyes, brows), hands with a thumb, shoes on a
 * sole. A jacket in the player's colour (neon zip, belt, sleeve stripes and cuffs); the build,
 * the skin and the hair vary from one person to the next.
 *
 * A woman: narrower shoulders and waist, wider hips, a finer jaw, hair down to the shoulders.
 * The cube shows in the right hand while a throw winds up ({@link setFigureHolding}); the cubes
 * in flight are drawn by world.ts with {@link makeCube}.
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
import type { Gender } from './vehicles.js';

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

/** A head: skull, jaw, nose, ears, eyes, hair (short, or down to the shoulders for a woman). */
function makeHead(skin: Material, hairColor: number, woman: boolean): Group {
  const head = new Group();
  const skull = ball(0.105, skin, 0.92, 1.05, 1.0);
  skull.position.y = 0.11;
  const jaw = woman ? ball(0.068, skin, 0.9, 0.85, 0.95) : ball(0.075, skin, 1.0, 0.85, 1.0);
  jaw.position.set(0, woman ? 0.05 : 0.045, 0.025);
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
  const hairMat = new MeshStandardMaterial({ color: hairColor, roughness: 0.9 });
  const hair = new Mesh(new SphereGeometry(0.11, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52), hairMat);
  hair.scale.set(0.95, 1.05, 1.05);
  hair.position.set(0, 0.125, -0.008);
  hair.rotation.x = -0.35;
  head.add(hair);
  if (woman) {
    // hair down to the shoulders, behind the face and over the ears
    const back = ball(0.112, hairMat, 1.05, 1.5, 0.82);
    back.position.set(0, 0.06, -0.035);
    const lips = ball(0.016, new MeshStandardMaterial({ color: 0xb4545e, roughness: 0.5 }), 1.6, 0.6, 0.6);
    lips.position.set(0, 0.052, 0.094);
    head.add(back, lips);
    for (const sx of [-1, 1]) {
      const lock = ball(0.04, hairMat, 0.7, 2.1, 1);
      lock.position.set(sx * 0.088, 0.04, 0.0);
      head.add(lock);
    }
  }
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
 * so that two people are not the same doll; `look` sets the skin (index in SKINS) and whether
 * it is a man or a woman — the local players' own characters, from their garage (otherwise both
 * come from the seed).
 */
export function makeFigure(color: number, seed = 0.37, look: { skin?: number; gender?: Gender } = {}): Group {
  const root = new Group();
  const rnd = (k: number): number => {
    const x = Math.sin((seed + 1) * 9301 + k * 49297) * 233280;
    return x - Math.floor(x);
  };
  const skin = new MeshStandardMaterial({ color: SKINS[look.skin ?? Math.floor(rnd(1) * SKINS.length)] ?? SKINS[0], roughness: 0.62 });
  const woman = (look.gender ?? (rnd(6) < 0.5 ? 'man' : 'woman')) === 'woman';
  const trousers = new MeshStandardMaterial({ color: mix(0x1c2328, 0x2a3a52, rnd(2)), roughness: 0.85 });
  const jacket = new MeshStandardMaterial({ color: mix(color, 0x000000, 0.62), roughness: 0.55 });
  const shoes = new MeshStandardMaterial({ color: 0x14181b, roughness: 0.45 });
  const sole = new MeshStandardMaterial({ color: 0xd8dcdc, roughness: 0.7 });
  const neon = new MeshBasicMaterial({ color, toneMapped: false });
  const build = (woman ? 0.92 : 0.95) + rnd(3) * 0.1; // height
  const broad = (woman ? 0.84 : 0.93) + rnd(4) * 0.12; // shoulders, chest
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
    woman ? 1.2 : 1.1,
    0.75
  );
  pelvis.add(seat);
  for (const side of ['L', 'R'] as const) {
    const sx = side === 'L' ? 1 : -1;
    const thigh = joint(`thigh${side}`, sx * (woman ? 0.1 : 0.095), -0.03);
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
      [woman ? 0.155 : 0.15, 0.0],
      [woman ? 0.132 : 0.142, 0.1],
      [woman ? 0.125 : 0.138, 0.18],
      [woman ? 0.155 : 0.158, 0.32],
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
  head.add(makeHead(skin, HAIRS[Math.floor(rnd(5) * HAIRS.length)], woman));
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
  root.userData.gender = woman ? 'woman' : 'man';
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

// --- the cube --------------------------------------------------------------------------------

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

/** The WinCC OA logo cube a player throws. */
export function makeCube(size: number): Mesh {
  const map = texture('cube', (g, c) => g.drawImage(logoCanvas(256), 0, 0, c.width, c.height), 256, 256);
  const mat = new MeshBasicMaterial({ map, toneMapped: false });
  mat.color.setScalar(1.2);
  return new Mesh(new BoxGeometry(size, size, size), mat);
}

/**
 * Shows the cube of edge `size` (m) in the figure's right hand, from the start of a throw to its
 * release, or hides it (null). A big cube rests on the palm, its centre away from the hand.
 */
export function setFigureHolding(fig: Group, size: number | null): void {
  const hand = fig.getObjectByName('handR');
  if (!hand) return;
  let cube = hand.getObjectByName('held');
  if (cube && size !== null && cube.userData.size !== size) {
    hand.remove(cube);
    cube = undefined;
  }
  if (!cube && size !== null) {
    cube = makeCube(size);
    cube.name = 'held';
    cube.userData.size = size;
    cube.position.set(0, -0.06 - size / 2, 0.04 + size * 0.15);
    hand.add(cube);
  }
  if (cube) cube.visible = size !== null;
}
