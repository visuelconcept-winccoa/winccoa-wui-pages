// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Lightweight spherical orbit camera (azimuth θ / polar φ / radius r), ported in
 * spirit from the prototype's hand-rolled `applyOrbit`. Left-drag orbits,
 * right-drag pans the target, wheel zooms. No external OrbitControls dependency.
 *
 * What the buttons ask — a preset, a machine to frame, a viewpoint, a step of
 * rotation or zoom — the camera glides to (eased), so the eye follows where it
 * goes; a drag or the wheel takes over at once. No glide when the user's system
 * asks for reduced motion.
 */
import { PerspectiveCamera, Vector3 } from 'three';

interface OrbitState {
  theta: number;
  phi: number;
  radius: number;
}

const MIN_PHI = 0.05;
const MAX_PHI = Math.PI / 2 - 0.02;
const MIN_RADIUS = 12;
const MAX_RADIUS = 900;
const ORBIT_SPEED = 0.005;
const PAN_SPEED = 0.0016;
const ZOOM_STEP = 0.0009;
/** Glide durations (ms): a whole new viewpoint, then a single button step. */
const GLIDE_VIEW = 900;
const GLIDE_STEP = 320;
/** Plan (2D) mode: the camera looks straight down, north up. */
const PLAN_THETA = Math.PI / 2;
const PLAN_PHI = MIN_PHI + 0.02;
/** Screen pixels panned per radian of a rotate input (pad arrows) in plan mode. */
const PLAN_PAN_PX = 300;
/** Pixels panned / zoom factors of one key press. */
const KEY_PAN_PX = 60;
const KEY_ORBIT = 0.12;
const KEY_ZOOM_IN = 0.85;
const KEY_ZOOM_OUT = 1.18;

const easeInOut = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** The shortest way round from one azimuth to another. */
const angleDelta = (from: number, to: number): number => {
  const d = (to - from) % (2 * Math.PI);
  return d > Math.PI ? d - 2 * Math.PI : d < -Math.PI ? d + 2 * Math.PI : d;
};
const reducedMotion = (): boolean => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

interface Glide {
  from: OrbitState;
  fromTarget: Vector3;
  start: number;
  ms: number;
  frame: number;
}

export class OrbitController {
  /** Fired when the user ROTATES the camera (left-drag, `orbitBy`, arrow keys) — not on
   * pan/zoom, and never in plan (2D) mode, where rotate inputs pan. */
  onRotate: (() => void) | null = null;
  /**
   * Fired when the USER moves the camera — drag, wheel, keys, and the steps, presets and focus
   * the page's buttons ask for — never for `frame` (the opening view) nor a mode change (#72).
   */
  onUserMove: (() => void) | null = null;

  private readonly target = new Vector3(0, 4, 0);
  private readonly state: OrbitState = { theta: Math.PI / 4, phi: 0.9, radius: 300 };
  private readonly home: OrbitState;
  private readonly homeTarget: Vector3;
  /** What the camera shows: `state` / `target`, or on its way there during a glide. */
  private readonly shown: OrbitState = { ...this.state };
  private readonly shownTarget = this.target.clone();
  private glide: Glide | null = null;

  /** Plan (2D) mode: the angle is locked straight down; rotate inputs pan instead (#57). */
  private planLock = false;
  /** The angle the 2D mode is locked at: straight down, or tilted (opening view C, #70). */
  private planTheta = PLAN_THETA;
  private planPhi = PLAN_PHI;
  private dragButton = -1;
  private lastX = 0;
  private lastY = 0;

  constructor(
    private readonly camera: PerspectiveCamera,
    private readonly el: HTMLElement
  ) {
    this.home = { ...this.state };
    this.homeTarget = this.target.clone();
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContext);
    el.addEventListener('keydown', this.onKey);
    if (el.tabIndex < 0) el.tabIndex = 0;
    this.apply();
  }

  /** Frame a focus pose (used by "fly to machine", a saved viewpoint): the camera glides there. */
  setFocus(pos: [number, number, number], target: [number, number, number]): void {
    this.onUserMove?.();
    this.target.set(...target);
    const dx = pos[0] - target[0];
    const dy = pos[1] - target[1];
    const dz = pos[2] - target[2];
    this.state.radius = Math.hypot(dx, dy, dz) || this.state.radius;
    this.state.theta = Math.atan2(dz, dx);
    this.state.phi = Math.acos(Math.min(1, Math.max(-1, dy / this.state.radius)));
    this.clamp();
    this.glideTo(GLIDE_VIEW);
  }

  reset(): void {
    Object.assign(this.state, this.home);
    this.target.copy(this.homeTarget);
    this.clamp();
    this.glideTo(GLIDE_VIEW);
  }

  /**
   * Plan (2D) mode: the camera looks straight down and stays so — wheel, drag, pad arrows and
   * keys zoom and pan in the plan, never tilt or rotate it (#57).
   */
  setPlanLock(on: boolean, angle?: { theta: number; phi: number }): void {
    this.planLock = on;
    this.planTheta = angle?.theta ?? PLAN_THETA;
    this.planPhi = angle?.phi ?? PLAN_PHI;
    if (!on) return;
    this.clamp();
    this.glideTo(GLIDE_VIEW);
  }

  /**
   * Glide to an orbit pose (the opening view of an atelier, #70): azimuth, polar angle, target and
   * radius as computed by fleet-core `frameOpeningView`.
   */
  frame(pose: { theta: number; phi: number; target: [number, number, number]; radius: number }, { immediate = false } = {}): void {
    this.state.theta = pose.theta;
    this.state.phi = pose.phi;
    this.state.radius = pose.radius;
    this.target.set(...pose.target);
    this.clamp();
    // Immediate (a resize, #72): placed at once — a glide in progress ends on the new framing.
    if (immediate) this.apply();
    else this.glideTo(GLIDE_VIEW);
  }

  /** Current camera pose (position + target) for saving a viewpoint. */
  getPose(): { pos: [number, number, number]; target: [number, number, number] } {
    return {
      pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.shownTarget.x, this.shownTarget.y, this.shownTarget.z]
    };
  }

  /** Rotate the camera (azimuth / polar deltas in radians). */
  orbitBy(dTheta: number, dPhi: number): void {
    this.onUserMove?.();
    if (this.planLock) {
      // In the plan a pad arrow moves the view that way (left arrow: see further left).
      this.panBy(-dTheta * PLAN_PAN_PX, -dPhi * PLAN_PAN_PX);
      return;
    }
    this.state.theta += dTheta;
    this.state.phi += dPhi;
    this.clamp();
    this.glideTo(GLIDE_STEP);
    if (dTheta !== 0 || dPhi !== 0) this.onRotate?.();
  }

  /** Zoom by a multiplicative factor (<1 closer, >1 farther). */
  zoomBy(factor: number): void {
    this.onUserMove?.();
    this.state.radius *= factor;
    this.clamp();
    this.glideTo(GLIDE_STEP);
  }

  /** Pan the target by screen-space deltas (pixels). */
  panBy(dx: number, dy: number): void {
    this.onUserMove?.();
    this.pan(dx, dy);
    this.glideTo(GLIDE_STEP);
  }

  /** Snap to a preset orientation, keeping the current target/radius. */
  setView(preset: 'top' | 'front' | 'side' | 'iso'): void {
    this.onUserMove?.();
    switch (preset) {
      case 'top': {
        this.state.theta = Math.PI / 2;
        this.state.phi = MIN_PHI + 0.02;
        break;
      }
      case 'front': {
        this.state.theta = Math.PI / 2;
        this.state.phi = MAX_PHI;
        break;
      }
      case 'side': {
        this.state.theta = 0;
        this.state.phi = MAX_PHI;
        break;
      }
      default: {
        this.state.theta = Math.PI / 4;
        this.state.phi = 0.9;
      }
    }
    this.clamp();
    this.glideTo(GLIDE_VIEW);
  }

  dispose(): void {
    this.stopGlide();
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContext);
    this.el.removeEventListener('keydown', this.onKey);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  /** Keyboard (the canvas focused): arrows rotate in 3D and pan in the plan; + / - zoom. */
  private handleKey(e: KeyboardEvent): void {
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const dir = arrows[e.key];
    if (dir) {
      if (this.planLock || e.shiftKey) this.panBy(-dir[0] * KEY_PAN_PX, -dir[1] * KEY_PAN_PX);
      else this.orbitBy(dir[0] * KEY_ORBIT, dir[1] * KEY_ORBIT);
    } else if (e.key === '+' || e.key === '=') this.zoomBy(KEY_ZOOM_IN);
    else if (e.key === '-') this.zoomBy(KEY_ZOOM_OUT);
    else return;
    e.preventDefault();
  }

  private handleDown(e: PointerEvent): void {
    this.takeOver();
    this.dragButton = e.button;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private handleMove(e: PointerEvent): void {
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    if (dx !== 0 || dy !== 0) this.onUserMove?.();
    if (this.dragButton === 0 && !this.planLock) {
      this.state.theta -= dx * ORBIT_SPEED;
      this.state.phi -= dy * ORBIT_SPEED;
      if (dx !== 0 || dy !== 0) this.onRotate?.();
    } else {
      this.pan(dx, dy);
    }
    this.clamp();
    this.apply();
  }

  private handleUp(e: PointerEvent): void {
    if (e.button === this.dragButton) this.dragButton = -1;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  private handleWheel(e: WheelEvent): void {
    e.preventDefault();
    this.takeOver();
    this.onUserMove?.();
    this.state.radius *= 1 + e.deltaY * ZOOM_STEP;
    this.clamp();
    this.apply();
  }

  private pan(dx: number, dy: number): void {
    const scale = this.state.radius * PAN_SPEED;
    // Right vector and ground-projected forward, derived from azimuth.
    const cosT = Math.cos(this.state.theta);
    const sinT = Math.sin(this.state.theta);
    this.target.x += (-cosT * dy - sinT * dx) * scale;
    this.target.z += (-sinT * dy + cosT * dx) * scale;
  }

  private clamp(): void {
    if (this.planLock) {
      this.state.theta = this.planTheta;
      this.state.phi = this.planPhi;
    }
    this.state.phi = Math.min(MAX_PHI, Math.max(MIN_PHI, this.state.phi));
    this.state.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, this.state.radius));
  }

  /** The camera at `state` / `target` at once (a drag, the wheel). */
  private apply(): void {
    this.stopGlide();
    Object.assign(this.shown, this.state);
    this.shownTarget.copy(this.target);
    this.place();
  }

  /** From what is shown now to `state` / `target`, eased over `ms`. */
  private glideTo(ms: number): void {
    if (reducedMotion()) {
      this.apply();
      return;
    }
    this.stopGlide();
    const glide: Glide = { from: { ...this.shown }, fromTarget: this.shownTarget.clone(), start: performance.now(), ms, frame: 0 };
    const dTheta = angleDelta(glide.from.theta, this.state.theta);
    const step = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - glide.start) / glide.ms));
      const e = easeInOut(t);
      this.shown.theta = glide.from.theta + dTheta * e;
      this.shown.phi = glide.from.phi + (this.state.phi - glide.from.phi) * e;
      // Geometric: a zoom from far away does not rush the last metres.
      this.shown.radius = glide.from.radius * (this.state.radius / glide.from.radius) ** e;
      this.shownTarget.lerpVectors(glide.fromTarget, this.target, e);
      this.place();
      if (t < 1) glide.frame = requestAnimationFrame(step);
      else this.glide = null;
    };
    this.glide = glide;
    glide.frame = requestAnimationFrame(step);
  }

  private stopGlide(): void {
    if (this.glide) cancelAnimationFrame(this.glide.frame);
    this.glide = null;
  }

  /** The user takes the camera mid-glide: it goes on from where it is. */
  private takeOver(): void {
    if (!this.glide) return;
    this.stopGlide();
    Object.assign(this.state, this.shown);
    this.target.copy(this.shownTarget);
    // Taken mid-way into the plan (a wheel during the glide to 2D): still straight down.
    this.clamp();
  }

  private place(): void {
    const { theta, phi, radius } = this.shown;
    const sinPhi = Math.sin(phi);
    this.camera.position.set(
      this.shownTarget.x + radius * sinPhi * Math.cos(theta),
      this.shownTarget.y + radius * Math.cos(phi),
      this.shownTarget.z + radius * sinPhi * Math.sin(theta)
    );
    this.camera.lookAt(this.shownTarget);
  }

  private readonly onPointerDown = (e: PointerEvent): void => this.handleDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.handleMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.handleUp(e);
  private readonly onWheel = (e: WheelEvent): void => this.handleWheel(e);
  private readonly onContext = (e: Event): void => e.preventDefault();
  private readonly onKey = (e: KeyboardEvent): void => this.handleKey(e);
}
