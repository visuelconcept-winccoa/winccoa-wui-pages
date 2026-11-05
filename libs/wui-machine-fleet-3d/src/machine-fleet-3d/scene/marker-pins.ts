// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Placement markers drawn as location pins: HTML overlay elements projected from their floor
 * point, the same size on screen whatever the zoom or the building's size (a 3D object sized in
 * metres was tiny on a large building seen whole, and read as one more column).
 *
 * The pins show in edit mode only (they are placement guides, #58). In edit mode a pin is dragged
 * on the floor; a click without moving asks to edit it (rename / delete, by the page). A new pin
 * is placed by `startPlacement`: a ghost pin follows the pointer over the floor until a click
 * drops it.
 */
import { Plane, Raycaster, Vector2, Vector3, type Camera } from 'three';
import type { PlacementMarker } from '../types.js';

/** Pointer travel (px) under which a press on a pin is a click, not a drag. */
const CLICK_SLOP_PX = 4;

interface PinEntry {
  marker: PlacementMarker;
  el: HTMLElement;
  nameEl: HTMLElement;
}

export interface MarkerPinsHost {
  /** The camera projecting the pins (orthographic in 2D). */
  camera(): Camera;
  /** The canvas the pointer is read against. */
  canvas(): HTMLCanvasElement;
}

export class MarkerPins {
  /** A pin was dropped at a new floor point (x, z) by a drag. */
  onMove: ((id: string, x: number, z: number) => void) | null = null;
  /** A pin was clicked (no drag): the page offers to rename or delete it. */
  onPick: ((id: string, screenX: number, screenY: number) => void) | null = null;

  private entries: PinEntry[] = [];
  private visible = false;
  private readonly world = new Vector3();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly floor = new Plane(new Vector3(0, 1, 0), 0);
  private readonly hit = new Vector3();
  /** The ghost pin of a placement in progress, and what to call with the floor point. */
  private ghost: HTMLElement | null = null;
  private placeDone: ((x: number, z: number) => void) | null = null;

  constructor(
    private readonly overlay: HTMLElement,
    private readonly host: MarkerPinsHost
  ) {}

  setMarkers(markers: readonly PlacementMarker[]): void {
    for (const e of this.entries) e.el.remove();
    this.entries = markers.map((m) => this.createEntry(m));
  }

  /** Shown in edit mode only. */
  setVisible(on: boolean): void {
    this.visible = on;
    if (!on) this.cancelPlacement();
    for (const e of this.entries) e.el.style.display = on ? '' : 'none';
  }

  /** Ghost pin following the pointer over the floor; a click drops it and calls `done`. */
  startPlacement(done: (x: number, z: number) => void): void {
    this.cancelPlacement();
    const ghost = pinElement('');
    ghost.classList.add('mf-pin--ghost');
    ghost.style.display = 'none';
    this.overlay.appendChild(ghost);
    this.ghost = ghost;
    this.placeDone = done;
    const canvas = this.host.canvas();
    canvas.style.cursor = 'crosshair';
    canvas.addEventListener('pointermove', this.onGhostMove);
    canvas.addEventListener('pointerdown', this.onGhostDown, { capture: true });
    window.addEventListener('keydown', this.onGhostKey);
  }

  cancelPlacement(): void {
    if (!this.ghost) return;
    this.ghost.remove();
    this.ghost = null;
    this.placeDone = null;
    const canvas = this.host.canvas();
    canvas.style.cursor = '';
    canvas.removeEventListener('pointermove', this.onGhostMove);
    canvas.removeEventListener('pointerdown', this.onGhostDown, { capture: true });
    window.removeEventListener('keydown', this.onGhostKey);
  }

  get placing(): boolean {
    return this.ghost !== null;
  }

  /** Project every pin onto the screen (every frame). */
  update(camera: Camera, width: number, height: number): void {
    if (!this.visible) return;
    for (const e of this.entries) {
      this.world.set(e.marker.x, 0, e.marker.z).project(camera);
      const behind = this.world.z > 1 || this.world.z < -1;
      const x = ((this.world.x + 1) / 2) * width;
      const y = ((1 - this.world.y) / 2) * height;
      const out = behind || x < -40 || x > width + 40 || y < -40 || y > height + 40;
      e.el.style.display = out ? 'none' : '';
      if (!out) e.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  }

  dispose(): void {
    this.cancelPlacement();
    for (const e of this.entries) e.el.remove();
    this.entries = [];
  }

  private createEntry(marker: PlacementMarker): PinEntry {
    const el = pinElement(marker.label);
    el.style.display = this.visible ? '' : 'none';
    const entry: PinEntry = { marker: { ...marker }, el, nameEl: el.querySelector('.mf-pin__name') as HTMLElement };
    el.addEventListener('pointerdown', (e) => this.startDrag(entry, e));
    this.overlay.appendChild(el);
    return entry;
  }

  private startDrag(entry: PinEntry, down: PointerEvent): void {
    if (down.button !== 0 || this.ghost) return;
    down.stopPropagation();
    down.preventDefault();
    let moved = false;
    const move = (e: PointerEvent): void => {
      if (!moved && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < CLICK_SLOP_PX) return;
      moved = true;
      const p = this.floorAt(e);
      if (!p) return;
      entry.marker.x = p.x;
      entry.marker.z = p.z;
    };
    const up = (e: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) this.onMove?.(entry.marker.id, entry.marker.x, entry.marker.z);
      else this.onPick?.(entry.marker.id, e.clientX, e.clientY);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /** The floor point (y = 0) under the pointer, if any. */
  private floorAt(e: PointerEvent): Vector3 | null {
    const rect = this.host.canvas().getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.host.camera());
    return this.raycaster.ray.intersectPlane(this.floor, this.hit);
  }

  private readonly onGhostMove = (e: PointerEvent): void => {
    if (!this.ghost) return;
    const rect = this.host.canvas().getBoundingClientRect();
    this.ghost.style.display = '';
    this.ghost.style.transform = `translate(${e.clientX - rect.left}px, ${e.clientY - rect.top}px)`;
  };

  private readonly onGhostDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const p = this.floorAt(e);
    const done = this.placeDone;
    this.cancelPlacement();
    if (p && done) done(Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10);
  };

  private readonly onGhostKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.cancelPlacement();
  };
}

/** A pin: the location icon, its tip on the anchor, and the marker's name beside it. */
function pinElement(label: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'mf-pin';
  const icon = document.createElement('ix-icon');
  icon.setAttribute('name', 'location');
  icon.setAttribute('size', '32');
  icon.className = 'mf-pin__icon';
  const name = document.createElement('span');
  name.className = 'mf-pin__name';
  name.textContent = label;
  el.append(icon, name);
  return el;
}
