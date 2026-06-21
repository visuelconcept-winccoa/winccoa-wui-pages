/**
 * Lightweight spherical orbit camera (azimuth θ / polar φ / radius r), ported in
 * spirit from the prototype's hand-rolled `applyOrbit`. Left-drag orbits,
 * right-drag pans the target, wheel zooms. No external OrbitControls dependency.
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

export class OrbitController {
  /** Fired when the user ROTATES the camera (left-drag or `orbitBy`) — not on
   * pan/zoom. Used to leave the 2D (plan) mode automatically. */
  onRotate: (() => void) | null = null;

  private readonly target = new Vector3(0, 4, 0);
  private readonly state: OrbitState = { theta: Math.PI / 4, phi: 0.9, radius: 300 };
  private readonly home: OrbitState;
  private readonly homeTarget: Vector3;

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
    this.apply();
  }

  /** Frame a focus pose (used by "fly to machine"). */
  setFocus(pos: [number, number, number], target: [number, number, number]): void {
    this.target.set(...target);
    const dx = pos[0] - target[0];
    const dy = pos[1] - target[1];
    const dz = pos[2] - target[2];
    this.state.radius = Math.hypot(dx, dy, dz) || this.state.radius;
    this.state.theta = Math.atan2(dz, dx);
    this.state.phi = Math.acos(Math.min(1, Math.max(-1, dy / this.state.radius)));
    this.clamp();
    this.apply();
  }

  reset(): void {
    Object.assign(this.state, this.home);
    this.target.copy(this.homeTarget);
    this.apply();
  }

  /** Current camera pose (position + target) for saving a viewpoint. */
  getPose(): { pos: [number, number, number]; target: [number, number, number] } {
    return {
      pos: [this.camera.position.x, this.camera.position.y, this.camera.position.z],
      target: [this.target.x, this.target.y, this.target.z]
    };
  }

  /** Rotate the camera (azimuth / polar deltas in radians). */
  orbitBy(dTheta: number, dPhi: number): void {
    this.state.theta += dTheta;
    this.state.phi += dPhi;
    this.clamp();
    this.apply();
    if (dTheta !== 0 || dPhi !== 0) this.onRotate?.();
  }

  /** Zoom by a multiplicative factor (<1 closer, >1 farther). */
  zoomBy(factor: number): void {
    this.state.radius *= factor;
    this.clamp();
    this.apply();
  }

  /** Pan the target by screen-space deltas (pixels). */
  panBy(dx: number, dy: number): void {
    this.pan(dx, dy);
    this.apply();
  }

  /** Snap to a preset orientation, keeping the current target/radius. */
  setView(preset: 'top' | 'front' | 'side' | 'iso'): void {
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
    this.apply();
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onPointerDown);
    this.el.removeEventListener('wheel', this.onWheel);
    this.el.removeEventListener('contextmenu', this.onContext);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  private handleDown(e: PointerEvent): void {
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
    if (this.dragButton === 0) {
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
    this.state.phi = Math.min(MAX_PHI, Math.max(MIN_PHI, this.state.phi));
    this.state.radius = Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, this.state.radius));
  }

  private apply(): void {
    const { theta, phi, radius } = this.state;
    const sinPhi = Math.sin(phi);
    this.camera.position.set(
      this.target.x + radius * sinPhi * Math.cos(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * sinPhi * Math.sin(theta)
    );
    this.camera.lookAt(this.target);
  }

  private readonly onPointerDown = (e: PointerEvent): void => this.handleDown(e);
  private readonly onPointerMove = (e: PointerEvent): void => this.handleMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.handleUp(e);
  private readonly onWheel = (e: WheelEvent): void => this.handleWheel(e);
  private readonly onContext = (e: Event): void => e.preventDefault();
}
