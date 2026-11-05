// @vitest-environment jsdom
import { PerspectiveCamera } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { OrbitController } from './orbit-controller.js';

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
