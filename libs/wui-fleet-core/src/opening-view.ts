// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The opening view of an atelier that has no default viewpoint (#70): the camera framed on the
 * atelier's placed symbols, in one of three modes —
 *
 *   plan          A — straight down, the 2D (orthographic) plan of today
 *   tilted        B — above the plan, tilted towards the back, in perspective (the 3D camera)
 *   tilted-ortho  C — the same tilt without perspective (the 2D orthographic camera, locked at
 *                     that angle: zoom and pan only, as the plan, #57)
 *
 * Set once for every atelier in the module settings (`MachineFleet3D_Settings`, role
 * `machine-fleet-3d/configure`) and per atelier in its configuration (`Atelier.opening`, role
 * `edit`). The atelier's "front" side (where the camera stands, the entrance) is the atelier's.
 *
 * Which pose an atelier opens on: the user's own default viewpoint, else the atelier's public
 * one, else the atelier's opening view, else the module's (`resolveOpeningView`).
 *
 * `frameOpeningView` is the pure framing: from the box of the symbols, the mode, the tilt, the
 * front side, the camera's field of view and aspect and a margin, the orbit pose (azimuth,
 * polar angle, target, radius) — the projected box centred and filling the view. No three.js
 * here: the scene controller applies the pose; the unit tests check it.
 */

export type OpeningMode = 'plan' | 'tilted' | 'tilted-ortho';

export const OPENING_MODES: readonly OpeningMode[] = ['plan', 'tilted', 'tilted-ortho'];

/** One opening view setting (the module's, or an atelier's own). */
export interface OpeningViewSetting {
  mode: OpeningMode;
  /** Tilt towards the back, degrees from the vertical (ignored in `plan`). */
  tilt: number;
  /** Margin around the symbols, percent of the view. */
  margin: number;
}

/** The "front" side of a building: where the camera stands (the entrance), at the bottom of the screen. */
export type FrontSide = 0 | 90 | 180 | 270;

export const FRONT_SIDES: readonly FrontSide[] = [0, 90, 180, 270];

/** What an atelier stores (`Atelier.opening`): its front side, and its own view if any. */
export interface AtelierOpening {
  /** Absent = 0 (the side of +z, "south"). */
  front?: FrontSide;
  /** Absent = the module's setting. */
  view?: OpeningViewSetting;
}

/** The module settings (`MachineFleet3D_Settings`): the default opening view of every atelier. */
export interface FleetModuleSettings {
  openingView: OpeningViewSetting;
}

export const TILT_MIN = 5;
export const TILT_MAX = 60;
export const MARGIN_MIN = 0;
export const MARGIN_MAX = 40;

export const DEFAULT_OPENING_VIEW: Readonly<OpeningViewSetting> = Object.freeze({ mode: 'tilted', tilt: 30, margin: 12 });

const clampInt = (v: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(max, Math.max(min, n));
};

/** An opening view setting, bounded; whatever is missing or wrong takes the default. */
export function normalizeOpeningView(raw: unknown, fallback: OpeningViewSetting = DEFAULT_OPENING_VIEW): OpeningViewSetting {
  const r = raw && typeof raw === 'object' ? (raw as Partial<OpeningViewSetting>) : {};
  return {
    mode: OPENING_MODES.includes(r.mode as OpeningMode) ? (r.mode as OpeningMode) : fallback.mode,
    tilt: clampInt(r.tilt, TILT_MIN, TILT_MAX, fallback.tilt),
    margin: clampInt(r.margin, MARGIN_MIN, MARGIN_MAX, fallback.margin)
  };
}

export function normalizeFront(raw: unknown): FrontSide {
  return FRONT_SIDES.includes(raw as FrontSide) ? (raw as FrontSide) : 0;
}

/** The module settings as stored (JSON), bounded; defaults when absent or unreadable. */
export function parseModuleSettings(raw: unknown): FleetModuleSettings {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = raw.trim() === '' ? {} : JSON.parse(raw);
    } catch {
      value = {};
    }
  }
  const v = value && typeof value === 'object' ? (value as Partial<FleetModuleSettings>) : {};
  return { openingView: normalizeOpeningView(v.openingView) };
}

/** Where the opening pose of an atelier comes from (the first that exists). */
export type OpeningSource = 'user-viewpoint' | 'public-viewpoint' | 'atelier' | 'module';

/**
 * The opening view of an atelier: a default viewpoint (the user's, else the atelier's) wins;
 * else the atelier's own view, else the module's. `view` is set unless a viewpoint wins.
 */
export function resolveOpeningView(input: {
  userViewpoint?: boolean;
  publicViewpoint?: boolean;
  atelier?: AtelierOpening;
  module: FleetModuleSettings;
}): { source: OpeningSource; view?: OpeningViewSetting; front: FrontSide } {
  const front = normalizeFront(input.atelier?.front);
  if (input.userViewpoint) return { source: 'user-viewpoint', front };
  if (input.publicViewpoint) return { source: 'public-viewpoint', front };
  if (input.atelier?.view) return { source: 'atelier', view: normalizeOpeningView(input.atelier.view), front };
  return { source: 'module', view: normalizeOpeningView(input.module.openingView), front };
}

// ---- framing --------------------------------------------------------------------------------

export interface Box3D {
  min: [number, number, number];
  max: [number, number, number];
}

/** The box of the placed symbols, from their footprints and heights (null when there are none). */
export function symbolsBox(
  symbols: readonly { bbox: { x1: number; x2: number; z1: number; z2: number }; topY: number; hidden?: boolean; toPlace?: boolean }[]
): Box3D | null {
  let box: Box3D | null = null;
  for (const s of symbols) {
    if (s.hidden || s.toPlace) continue;
    const x0 = Math.min(s.bbox.x1, s.bbox.x2), x1 = Math.max(s.bbox.x1, s.bbox.x2);
    const z0 = Math.min(s.bbox.z1, s.bbox.z2), z1 = Math.max(s.bbox.z1, s.bbox.z2);
    const top = Math.max(0, s.topY);
    if (!box) box = { min: [x0, 0, z0], max: [x1, top, z1] };
    else {
      box.min = [Math.min(box.min[0], x0), 0, Math.min(box.min[2], z0)];
      box.max = [Math.max(box.max[0], x1), Math.max(box.max[1], top), Math.max(box.max[2], z1)];
    }
  }
  return box;
}

/** The building's floor (centred on the origin, `length` along x, `width` along z): the fallback. */
export function floorBox(building: { length: number; width: number }): Box3D {
  return { min: [-building.length / 2, 0, -building.width / 2], max: [building.length / 2, 0, building.width / 2] };
}

/** The orbit pose: azimuth θ and polar angle φ (radians), target, radius — as OrbitController stores it. */
export interface OrbitPose {
  theta: number;
  phi: number;
  target: [number, number, number];
  radius: number;
}

type V3 = [number, number, number];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** The polar angle of the plan view (OrbitController PLAN_PHI): straight down, minus a hair. */
export const PLAN_POLAR = 0.07;

/**
 * Frame `box` for an opening view. The camera stands on the `front` side (0 = +z), tilted from
 * the vertical by `tilt` degrees (`plan`: straight down); `fovDeg` / `aspect` are the perspective
 * camera's (the 2D orthographic camera is sized from them at the target distance, as the scene
 * does). The target is shifted so the projected box is centred, the radius set so it fills
 * `1 / (1 + margin)` of the view.
 */
export function frameOpeningView(box: Box3D, view: OpeningViewSetting, front: FrontSide, fovDeg: number, aspect: number): OrbitPose {
  const o = (front * Math.PI) / 180;
  const phi = view.mode === 'plan' ? PLAN_POLAR : Math.max(PLAN_POLAR, (view.tilt * Math.PI) / 180);
  // Camera position = target + r·(sinφ cosθ, cosφ, sinφ sinθ); the front side (sin o, 0, cos o).
  const theta = Math.atan2(Math.cos(o), Math.sin(o));
  const d: V3 = [Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta)];
  // Camera basis as Object3D.lookAt builds it (world up +y): z along d, x = up × z, y = z × x.
  const zc = norm(d);
  const xc = norm(cross([0, 1, 0], zc));
  const yc = cross(zc, xc);
  const center: V3 = [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2];
  const corners: V3[] = [];
  for (const x of [box.min[0], box.max[0]]) for (const y of [box.min[1], box.max[1]]) for (const z of [box.min[2], box.max[2]]) corners.push([x - center[0], y - center[1], z - center[2]]);
  const cam = corners.map((c) => [dot(c, xc), dot(c, yc), dot(c, zc)] as V3);
  const tanH = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  const fill = 1 / (1 + view.margin / 100);
  const minRadius = Math.max(1, Math.hypot(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]) * 0.05);

  let ox = 0;
  let oy = 0;
  let radius: number;
  if (view.mode === 'tilted') {
    // Perspective: a corner at camera-space (x, y, z) relative to the target, the camera at
    // `radius` along z, projects to x / ((radius - z)·tanH·aspect). Fit by bisection, centre, again.
    const extent = (r: number): [number, number, number, number] => {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const [x, y, z] of cam) {
        const depth = Math.max(1e-6, r - z);
        const px = (x - ox) / (depth * tanH * aspect);
        const py = (y - oy) / (depth * tanH);
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      return [x0, x1, y0, y1];
    };
    const zMax = Math.max(...cam.map((c) => c[2]));
    const search = (): number => {
      let lo = zMax + minRadius;
      let hi = lo + 1e6;
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2;
        const [x0, x1, y0, y1] = extent(mid);
        if (Math.max(-x0, x1, -y0, y1) > fill) lo = mid;
        else hi = mid;
      }
      return hi;
    };
    radius = search();
    for (let k = 0; k < 4; k++) {
      const [x0, x1, y0, y1] = extent(radius);
      // Shift the target on the screen plane by the projected offset, at the target's depth.
      ox += ((x0 + x1) / 2) * radius * tanH * aspect;
      oy += ((y0 + y1) / 2) * radius * tanH;
      radius = search();
    }
  } else {
    // Orthographic (plan, tilted-ortho): the frustum is tanH·radius high at the target.
    const xs = cam.map((c) => c[0]);
    const ys = cam.map((c) => c[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    ox = (x0 + x1) / 2;
    oy = (y0 + y1) / 2;
    const halfH = Math.max((y1 - y0) / 2, (x1 - x0) / 2 / aspect);
    radius = Math.max(minRadius, halfH / (tanH * fill));
  }
  const target: V3 = [
    center[0] + xc[0] * ox + yc[0] * oy,
    center[1] + xc[1] * ox + yc[1] * oy,
    center[2] + xc[2] * ox + yc[2] * oy
  ];
  return { theta, phi, target, radius };
}

/**
 * Where a corner of `box` lands for a pose, in NDC (-1..1) — the check of the framing: the
 * camera of the pose, perspective (`tilted`) or orthographic sized at the target distance.
 */
export function projectToNdc(point: V3, pose: OrbitPose, mode: OpeningMode, fovDeg: number, aspect: number): [number, number] {
  const d: V3 = [Math.sin(pose.phi) * Math.cos(pose.theta), Math.cos(pose.phi), Math.sin(pose.phi) * Math.sin(pose.theta)];
  const zc = norm(d);
  const xc = norm(cross([0, 1, 0], zc));
  const yc = cross(zc, xc);
  const rel: V3 = [point[0] - pose.target[0], point[1] - pose.target[1], point[2] - pose.target[2]];
  const x = dot(rel, xc);
  const y = dot(rel, yc);
  const z = dot(rel, zc);
  const tanH = Math.tan(((fovDeg * Math.PI) / 180) / 2);
  if (mode === 'tilted') {
    const depth = pose.radius - z;
    return [x / (depth * tanH * aspect), y / (depth * tanH)];
  }
  return [x / (pose.radius * tanH * aspect), y / (pose.radius * tanH)];
}
