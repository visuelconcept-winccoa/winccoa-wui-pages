import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENING_VIEW,
  floorBox,
  frameOpeningView,
  normalizeOpeningView,
  parseModuleSettings,
  projectToNdc,
  resolveOpeningView,
  symbolsBox,
  type Box3D,
  type OpeningViewSetting
} from './opening-view.js';

const FOV = 45;
const ASPECT = 16 / 10;
/** Symbols mostly on the left of a 60 × 36 m building (the prototype's atelier). */
const BOX: Box3D = { min: [-25.5, 0, -12.5], max: [8, 3.5, 12.5] };

function corners(b: Box3D): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

/** The projected box: its NDC extent. */
function ndcExtent(view: OpeningViewSetting, front: 0 | 90 | 180 | 270 = 0) {
  const pose = frameOpeningView(BOX, view, front, FOV, ASPECT);
  const pts = corners(BOX).map((c) => projectToNdc(c, pose, view.mode, FOV, ASPECT));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { pose, x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

describe('frameOpeningView (#70)', () => {
  for (const mode of ['plan', 'tilted', 'tilted-ortho'] as const) {
    it(`${mode}: the whole box is in view, centred, and fills it within the margin`, () => {
      const view = { mode, tilt: 30, margin: 12 };
      const { x0, x1, y0, y1 } = ndcExtent(view);
      const fill = 1 / 1.12;
      expect(Math.max(-x0, x1, -y0, y1)).toBeLessThanOrEqual(fill + 1e-6);
      expect(Math.max(-x0, x1, -y0, y1)).toBeGreaterThan(fill - 0.01);
      expect(Math.abs((x0 + x1) / 2)).toBeLessThan(0.01);
      expect(Math.abs((y0 + y1) / 2)).toBeLessThan(0.01);
    });
  }

  it('stands on the front side: entrance south puts the camera on +z, tilted by the angle', () => {
    const pose = frameOpeningView(BOX, { mode: 'tilted', tilt: 30, margin: 12 }, 0, FOV, ASPECT);
    expect(pose.theta).toBeCloseTo(Math.PI / 2, 6);
    expect(pose.phi).toBeCloseTo(Math.PI / 6, 6);
    expect(frameOpeningView(BOX, { mode: 'tilted', tilt: 30, margin: 12 }, 90, FOV, ASPECT).theta).toBeCloseTo(0, 6);
    expect(Math.abs(frameOpeningView(BOX, { mode: 'tilted', tilt: 30, margin: 12 }, 180, FOV, ASPECT).theta)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('plan looks straight down (the plan angle), whatever the tilt', () => {
    expect(frameOpeningView(BOX, { mode: 'plan', tilt: 50, margin: 0 }, 0, FOV, ASPECT).phi).toBeLessThan(0.1);
  });

  it('a larger margin moves the camera away', () => {
    const near = frameOpeningView(BOX, { mode: 'tilted', tilt: 30, margin: 0 }, 0, FOV, ASPECT).radius;
    const far = frameOpeningView(BOX, { mode: 'tilted', tilt: 30, margin: 40 }, 0, FOV, ASPECT).radius;
    expect(far).toBeGreaterThan(near);
  });

  it('frames a flat floor (no symbol placed) as well', () => {
    const floor = floorBox({ length: 240, width: 160 });
    const view = { mode: 'tilted-ortho' as const, tilt: 30, margin: 12 };
    const pose = frameOpeningView(floor, view, 0, FOV, ASPECT);
    const pts = corners(floor).map((c) => projectToNdc(c, pose, view.mode, FOV, ASPECT));
    expect(Math.max(...pts.map((p) => Math.max(Math.abs(p[0]), Math.abs(p[1]))))).toBeLessThanOrEqual(1);
  });
});

describe('symbolsBox', () => {
  const s = (x1: number, x2: number, z1: number, z2: number, topY: number, extra = {}) => ({ bbox: { x1, x2, z1, z2 }, topY, ...extra });

  it('spans the placed symbols only — not the hidden ones nor those "à placer"', () => {
    expect(symbolsBox([s(-10, -5, 0, 4, 3), s(2, 6, -8, -2, 5), s(40, 44, 40, 44, 9, { toPlace: true }), s(-90, -80, 0, 1, 1, { hidden: true })])).toEqual({
      min: [-10, 0, -8],
      max: [6, 5, 4]
    });
  });

  it('is null without a placed symbol (the floor is framed instead)', () => {
    expect(symbolsBox([s(0, 1, 0, 1, 1, { toPlace: true })])).toBeNull();
    expect(floorBox({ length: 60, width: 36 })).toEqual({ min: [-30, 0, -18], max: [30, 0, 18] });
  });
});

describe('settings', () => {
  it('bounds a setting and takes the default for what is missing', () => {
    expect(normalizeOpeningView({ mode: 'tilted-ortho', tilt: 90, margin: -3 })).toEqual({ mode: 'tilted-ortho', tilt: 60, margin: 0 });
    expect(normalizeOpeningView({ mode: 'fish-eye', tilt: 2 })).toEqual({ mode: 'tilted', tilt: 5, margin: 12 });
    expect(parseModuleSettings('')).toEqual({ openingView: DEFAULT_OPENING_VIEW });
    expect(parseModuleSettings('{"openingView":{"mode":"plan","tilt":20,"margin":5}}').openingView).toEqual({ mode: 'plan', tilt: 20, margin: 5 });
    expect(parseModuleSettings('not json').openingView).toEqual(DEFAULT_OPENING_VIEW);
  });

  it('opens on the user’s viewpoint, else the public one, else the atelier’s view, else the module’s', () => {
    const module = { openingView: { mode: 'plan' as const, tilt: 30, margin: 12 } };
    const atelier = { front: 90 as const, view: { mode: 'tilted-ortho' as const, tilt: 40, margin: 10 } };
    expect(resolveOpeningView({ userViewpoint: true, publicViewpoint: true, atelier, module }).source).toBe('user-viewpoint');
    expect(resolveOpeningView({ publicViewpoint: true, atelier, module }).source).toBe('public-viewpoint');
    expect(resolveOpeningView({ atelier, module })).toEqual({ source: 'atelier', view: atelier.view, front: 90 });
    expect(resolveOpeningView({ atelier: { front: 180 }, module })).toEqual({ source: 'module', view: module.openingView, front: 180 });
    expect(resolveOpeningView({ module }).front).toBe(0);
  });
});
