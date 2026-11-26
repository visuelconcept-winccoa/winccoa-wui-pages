// @vitest-environment jsdom
import { PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { OrbitController, pinchStep } from './orbit-controller.js';

/** An orbit on a detached element; glides run synchronously to their end. */
function orbit(): { o: OrbitController; el: HTMLElement; moves: () => number; camera: PerspectiveCamera } {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(performance.now() + 10_000);
    return 1;
  });
  const el = document.createElement('div');
  const camera = new PerspectiveCamera(45, 1.6, 0.5, 2000);
  const o = new OrbitController(camera, el);
  let n = 0;
  o.onUserMove = () => (n += 1);
  return { o, el, moves: () => n, camera };
}

const POSE = { theta: Math.PI / 2, phi: Math.PI / 6, target: [10, 0, -4] as [number, number, number], radius: 120 };

describe('OrbitController user moves (#72)', () => {
  it('the opening framing and a mode change are not moves of the user', () => {
    const { o, moves } = orbit();
    o.frame(POSE);
    o.frame(POSE, { immediate: true });
    o.setPlanLock(true, { theta: POSE.theta, phi: POSE.phi });
    o.setPlanLock(false);
    expect(moves()).toBe(0);
  });

  it('steps, presets, focus, drag, wheel and keys are', () => {
    const { o, el, moves } = orbit();
    o.orbitBy(0.1, 0);
    o.zoomBy(0.9);
    o.panBy(10, 0);
    o.setView('iso');
    o.setFocus([50, 50, 50], [0, 0, 0]);
    expect(moves()).toBe(5);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
    expect(moves()).toBe(6);
    el.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    expect(moves()).toBe(7);
    el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientX: 10, clientY: 10 }));
    globalThis.dispatchEvent(new MouseEvent('pointermove', { clientX: 30, clientY: 10 }));
    expect(moves()).toBe(8);
  });

  it('an immediate framing places the camera at once on the pose', () => {
    const { o, camera } = orbit();
    o.frame(POSE, { immediate: true });
    const pose = o.getPose();
    expect(pose.target).toEqual(POSE.target);
    expect(camera.position.distanceTo({ x: 10, y: 0, z: -4 } as never)).toBeCloseTo(120, 3);
  });
});

/** A touch pointer event (jsdom has no PointerEvent): a finger `id` at (x, y). */
function finger(type: string, id: number, x: number, y: number): Event {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, button: 0 });
  Object.defineProperty(e, 'pointerType', { value: 'touch' });
  Object.defineProperty(e, 'pointerId', { value: id });
  return e;
}

const distance = (o: OrbitController): number => {
  const { pos, target } = o.getPose();
  return Math.hypot(pos[0] - target[0], pos[1] - target[1], pos[2] - target[2]);
};

describe('touch gestures (winccoa-fra-msp-stma#399)', () => {
  it('a pinch step: how much the fingers spread and how far their midpoint moved', () => {
    expect(pinchStep([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: -50, y: 0 }, { x: 150, y: 0 }])).toEqual({ scale: 2, dx: 0, dy: 0 });
    expect(pinchStep([{ x: 0, y: 0 }, { x: 100, y: 0 }], [{ x: 10, y: 20 }, { x: 110, y: 20 }])).toEqual({ scale: 1, dx: 10, dy: 20 });
    expect(pinchStep([{ x: 5, y: 5 }, { x: 5, y: 5 }], [{ x: 0, y: 0 }, { x: 10, y: 0 }]).scale).toBe(1);
  });

  it('the page neither scrolls nor zooms under the fingers', () => {
    const { el } = orbit();
    expect(el.style.touchAction).toBe('none');
  });

  it('two fingers spread apart zoom in, pinched together zoom out', () => {
    const { o, el, moves } = orbit();
    o.frame(POSE, { immediate: true });
    const r0 = distance(o);
    el.dispatchEvent(finger('pointerdown', 1, 100, 200));
    el.dispatchEvent(finger('pointerdown', 2, 200, 200));
    window.dispatchEvent(finger('pointermove', 2, 300, 200));
    const r1 = distance(o);
    expect(r1).toBeLessThan(r0);
    window.dispatchEvent(finger('pointermove', 2, 150, 200));
    expect(distance(o)).toBeGreaterThan(r1);
    expect(moves()).toBeGreaterThan(0);
    window.dispatchEvent(finger('pointerup', 2, 150, 200));
    window.dispatchEvent(finger('pointerup', 1, 100, 200));
  });

  it('one finger orbits as the left button does, and the camera does not jump when a second finger lifts', () => {
    const { o, el } = orbit();
    o.frame(POSE, { immediate: true });
    let rotations = 0;
    o.onRotate = () => (rotations += 1);
    const before = o.getPose().pos;
    el.dispatchEvent(finger('pointerdown', 1, 100, 100));
    window.dispatchEvent(finger('pointermove', 1, 140, 100));
    expect(rotations).toBe(1);
    expect(o.getPose().pos).not.toEqual(before);
    el.dispatchEvent(finger('pointerdown', 2, 300, 100));
    window.dispatchEvent(finger('pointerup', 2, 300, 100));
    const still = o.getPose().pos;
    window.dispatchEvent(finger('pointermove', 1, 140, 100));
    expect(o.getPose().pos).toEqual(still);
    window.dispatchEvent(finger('pointerup', 1, 140, 100));
  });
});
