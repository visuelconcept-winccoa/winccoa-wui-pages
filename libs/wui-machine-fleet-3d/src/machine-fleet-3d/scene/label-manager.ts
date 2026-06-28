// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * HTML overlay labels projected from 3D anchors.
 *
 * Each machine has three overlay elements:
 *  - a coloured **dot** pinned slightly above the machine (always shown);
 *  - a **bubble** card (name / state badge / stop cause / KPIs); and
 *  - a thin **leader line** connecting the dot to its bubble.
 *
 * Bubbles are decluttered every frame (greedy vertical stacking) so they don't
 * overlap. Far machines collapse to the dot only.
 */
import { Vector3, type Camera } from 'three';
import {
  DEFAULT_STATE_COLOR_MAP,
  DISCONNECTED_LABEL,
  KPI_TYPE_INFO,
  STATE_LABELS,
  isDisconnected,
  resolveDisplaySlots,
  type DisplaySlot,
  type Kpi,
  type Machine,
  type StateColorKey
} from '../types.js';

/** Beyond this distance only the dot is shown (no bubble / leader). */
const BUBBLE_MAX_DIST = 280;
/** Gap (px) the dot sits above the bubble's bottom edge, and between bubbles. */
const LEADER_LEN = 16;
const DECLUTTER_GAP = 6;
const DECLUTTER_GUARD = 60;
const DEFAULT_BUBBLE_W = 152;
const DEFAULT_BUBBLE_H = 40;
/** Horizontal gap (px) kept between the building silhouette and the bubbles. */
const BUILDING_MARGIN = 24;
const EDGE_PAD = 2;
/** Minimum gutter (px) above/below the building needed to seat a row of bubbles. */
const MIN_ROW_GUTTER = BUILDING_MARGIN + DEFAULT_BUBBLE_H;
const HIDDEN = 'none';
const STATE_VAR = '--mf-state';
/** CSS class for a numeric/value bubble line (parameters, KPIs, obsolescence). */
const LINE_KPI_CLS = 'mf-label__kpi-line';

/** Axis-aligned world footprint of the building (centred at the origin). */
interface BuildingBounds {
  x1: number;
  x2: number;
  z1: number;
  z2: number;
  height: number;
}

interface LabelEntry {
  machine: Machine;
  el: HTMLElement;
  dotEl: HTMLElement;
  leaderEl: HTMLElement;
  nameEl: HTMLElement;
  /** Single ordered container for all visible info lines (order = Affichage tab). */
  linesEl: HTMLElement;
}

interface Placeable {
  entry: LabelEntry;
  ax: number;
  ay: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A bubble line: text + CSS class (by item kind) + optional colour. */
interface BubbleLine {
  text: string;
  cls: string;
  color?: string;
}

const DECIMALS = 2;

/** Ordered, visible bubble lines for a machine (order = the Affichage tab). */
function buildBubbleLines(m: Machine): BubbleLine[] {
  const lines: BubbleLine[] = [];
  for (const slot of resolveDisplaySlots(m)) {
    if (!slot.inBubble) continue;
    const line = bubbleLineFor(slot, m);
    if (line) lines.push(line);
  }
  return lines;
}

function bubbleLineFor(slot: DisplaySlot, m: Machine): BubbleLine | null {
  if (slot.kind === 'state') return { text: STATE_LABELS[m.state], cls: 'mf-label__badge' };
  if (slot.kind === 'stopCause') {
    return m.state !== 'ok' && m.stopCauseLabel
      ? { text: m.stopCauseLabel, cls: 'mf-label__cause' }
      : null;
  }
  if (slot.kind === 'workOrder') {
    return m.workOrder != null && m.workOrder !== ''
      ? { text: `OF ${m.workOrder}`, cls: 'mf-label__prod-line' }
      : null;
  }
  if (slot.kind === 'operation') {
    return m.operation != null && m.operation !== ''
      ? { text: `Op. ${m.operation}`, cls: 'mf-label__prod-line' }
      : null;
  }
  if (slot.kind === 'param') {
    const text = formatKpi(slot.param);
    return text ? { text, cls: LINE_KPI_CLS } : null;
  }
  if (slot.kind === 'obsolescence') {
    // Composite ALI risk score (0–100) + level, resolved from the linked asset.
    if (m.aliRiskScore == null) return null;
    const label = m.aliRiskLabel ? ` · ${m.aliRiskLabel}` : '';
    return { text: `Obs. ${m.aliRiskScore}${label}`, cls: LINE_KPI_CLS, color: m.aliRiskColor };
  }
  // kind === 'kpi' (server-computed value).
  const kpi = slot.kpi;
  const v = kpi ? (m.kpiCalcValues ?? {})[kpi.id] : undefined;
  if (!kpi || v == null) return null;
  const num = Number.isInteger(v) ? String(v) : v.toFixed(DECIMALS);
  return {
    text: `${slot.label} ${num} ${KPI_TYPE_INFO[kpi.type].unit}`,
    cls: LINE_KPI_CLS,
    color: (m.kpiCalcColors ?? {})[kpi.id]
  };
}

function formatKpi(kpi: Kpi | undefined): string {
  if (!kpi || kpi.value == null) return '';
  const v = kpi.value;
  let num: string;
  if (typeof v === 'number') num = Number.isInteger(v) ? String(v) : v.toFixed(DECIMALS);
  else num = String(v);
  return kpi.unit ? `${num} ${kpi.unit}` : num;
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.w + gap < b.x ||
    b.x + b.w + gap < a.x ||
    a.y + a.h + gap < b.y ||
    b.y + b.h + gap < a.y
  );
}

/**
 * Resolve overlapping 1-D placements: turn each item's desired centre into a
 * non-overlapping start, kept within `[min, max]`. Two-pass label spreader
 * (push forward, then pull back from the far edge). Items must be pre-sorted by
 * `desired` ascending; `sizes[i]` is item i's extent along the axis.
 */
// eslint-disable-next-line max-params -- a 1-D spreader needs its bounds + gap
function spreadAlong(desired: number[], sizes: number[], gap: number, min: number, max: number): number[] {
  const pos = desired.map((d, i) => d - sizes[i] / 2);
  let cursor = min;
  for (let i = 0; i < pos.length; i++) {
    if (pos[i] < cursor) pos[i] = cursor;
    cursor = pos[i] + sizes[i] + gap;
  }
  cursor = max;
  for (let i = pos.length - 1; i >= 0; i--) {
    if (pos[i] + sizes[i] > cursor) pos[i] = cursor - sizes[i];
    cursor = pos[i] - gap;
  }
  for (let i = 0; i < pos.length; i++) if (pos[i] < min) pos[i] = min;
  return pos;
}

/** Keep as many bubbles as a vertical gutter column can stack without overlap;
 * the rest spill into `overflow` (to be re-routed to the top/bottom rows). */
function fitColumn(items: Placeable[], height: number): { kept: Placeable[]; overflow: Placeable[] } {
  const avail = height - 2 * EDGE_PAD;
  const kept: Placeable[] = [];
  const overflow: Placeable[] = [];
  let used = 0;
  for (const item of items) {
    const h = item.entry.el.offsetHeight || DEFAULT_BUBBLE_H;
    const need = h + (kept.length > 0 ? DECLUTTER_GAP : 0);
    if (used + need <= avail) {
      kept.push(item);
      used += need;
    } else overflow.push(item);
  }
  return { kept, overflow };
}

/** Keep as many bubbles as a top/bottom row can lay out across the building's
 * width without overlap; `rest` is what does not fit (or all of them when the
 * gutter outside the building is too short to seat a row). */
// eslint-disable-next-line max-params -- a row fit needs the building rect + bounds
function fitRow(
  items: Placeable[],
  building: Rect,
  width: number,
  height: number,
  isTop: boolean
): { kept: Placeable[]; rest: Placeable[] } {
  const gutter = isTop ? building.y - EDGE_PAD : height - EDGE_PAD - (building.y + building.h);
  if (gutter < MIN_ROW_GUTTER) return { kept: [], rest: items };
  const minX = Math.max(EDGE_PAD, building.x);
  const maxX = Math.min(width - EDGE_PAD, building.x + building.w);
  const avail = maxX - minX;
  const kept: Placeable[] = [];
  const rest: Placeable[] = [];
  let used = 0;
  for (const item of items) {
    const w = item.entry.el.offsetWidth || DEFAULT_BUBBLE_W;
    const need = w + (kept.length > 0 ? DECLUTTER_GAP : 0);
    if (used + need <= avail) {
      kept.push(item);
      used += need;
    } else rest.push(item);
  }
  return { kept, rest };
}

export class LabelManager {
  private entries: LabelEntry[] = [];
  private enabled = true;
  private alertOnly = false;
  private readonly anchor = new Vector3();
  private readonly corner = new Vector3();
  private buildingBounds: BuildingBounds | null = null;
  /** State/overlay colours (from the atelier's mapping), with defaults. */
  private stateColors: Record<StateColorKey, string> = DEFAULT_STATE_COLOR_MAP;

  constructor(
    private readonly overlay: HTMLElement,
    private readonly onSelect: (id: string) => void
  ) {}

  /** Set the state/overlay colour map (dot, leader, bubble accent). */
  setStateColors(colors: Record<StateColorKey, string>): void {
    this.stateColors = colors;
  }

  setMachines(machines: Machine[]): void {
    this.clearEntries();
    for (const machine of machines) {
      if (machine.suppressLabel) continue;
      this.entries.push(this.createEntry(machine));
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) this.hideAll();
  }

  setAlertOnly(on: boolean): void {
    this.alertOnly = on;
  }

  /** Building footprint used to keep bubbles outside its projected silhouette. */
  setBuildingBounds(bounds: BuildingBounds): void {
    this.buildingBounds = bounds;
  }

  update(camera: Camera, width: number, height: number): void {
    if (!this.enabled) return;
    // Pass 1: project anchors, paint dots, fill bubble content.
    const placeable: Placeable[] = [];
    for (const entry of this.entries) {
      const place = this.updateAnchor(entry, camera, width, height);
      if (place) placeable.push(place);
    }
    // Pass 2: push bubbles outside the building silhouette, then draw leaders.
    const buildingRect = this.projectBuildingRect(camera, width, height);
    this.placeBubbles(placeable, width, height, buildingRect);
  }

  dispose(): void {
    this.clearEntries();
  }

  private createEntry(machine: Machine): LabelEntry {
    const onPick = (e: Event): void => {
      e.stopPropagation();
      this.onSelect(machine.id);
    };
    const leaderEl = document.createElement('div');
    leaderEl.className = 'mf-leader';
    // Emphasise the leader line while the cursor is over this machine's dot or
    // bubble, so the dot↔bubble association is unambiguous when bubbles stack.
    const onEnter = (): void => leaderEl.classList.add('mf-leader--hover');
    const onLeave = (): void => leaderEl.classList.remove('mf-leader--hover');
    const dotEl = document.createElement('div');
    dotEl.className = 'mf-dot';
    dotEl.addEventListener('pointerdown', onPick);
    dotEl.addEventListener('pointerenter', onEnter);
    dotEl.addEventListener('pointerleave', onLeave);
    const el = document.createElement('div');
    el.className = 'mf-label';
    el.addEventListener('pointerdown', onPick);
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    const nameEl = document.createElement('div');
    nameEl.className = 'mf-label__name';
    nameEl.textContent = machine.name;
    const linesEl = document.createElement('div');
    linesEl.className = 'mf-label__lines';
    el.append(nameEl, linesEl);
    this.overlay.append(leaderEl, dotEl, el);
    return { machine, el, dotEl, leaderEl, nameEl, linesEl };
  }

  /** Project the anchor, place + colour the dot, fill the bubble. Returns a
   * placeable when the bubble should be shown, else null (dot only / hidden). */
  private updateAnchor(
    entry: LabelEntry,
    camera: Camera,
    width: number,
    height: number
  ): Placeable | null {
    const { machine, el, dotEl, leaderEl } = entry;
    if (this.alertOnly && machine.state === 'ok') {
      this.hideEntry(entry);
      return null;
    }
    this.anchor.set(machine.mesh.position.x, machine.topY, machine.mesh.position.z);
    const dist = camera.position.distanceTo(this.anchor);
    const projected = this.anchor.clone().project(camera);
    // Hide entirely when the anchor is behind the camera or outside the view
    // frustum, rather than clamping the bubble into a screen corner.
    if (projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) {
      this.hideEntry(entry);
      return null;
    }
    const ax = (projected.x * 0.5 + 0.5) * width;
    const ay = (-projected.y * 0.5 + 0.5) * height;
    const offline = isDisconnected(machine);
    const color = this.stateColors[offline ? 'disconnected' : machine.state];
    el.style.setProperty(STATE_VAR, color);
    dotEl.style.setProperty(STATE_VAR, color);
    leaderEl.style.setProperty(STATE_VAR, color);

    // Dot is always shown (within the view frustum).
    dotEl.style.display = 'block';
    dotEl.style.transform = `translate(-50%, -50%) translate(${ax}px, ${ay}px)`;

    if (dist > BUBBLE_MAX_DIST) {
      el.style.display = HIDDEN;
      leaderEl.style.display = HIDDEN;
      return null;
    }

    el.style.display = 'flex';
    // Offline shows only the disconnected badge; otherwise the ordered, visible
    // info lines (state / production / params / KPIs) per the Affichage config.
    const lines = offline
      ? [{ text: DISCONNECTED_LABEL, cls: 'mf-label__badge' }]
      : buildBubbleLines(machine);
    this.renderLines(entry.linesEl, lines);
    return { entry, ax, ay };
  }

  /** Render one element per bubble line (class + text + colour), reusing existing
   * children to avoid rebuilding the DOM on every frame. */
  private renderLines(el: HTMLElement, lines: BubbleLine[]): void {
    while (el.childElementCount > lines.length) el.lastElementChild?.remove();
    while (el.childElementCount < lines.length) el.append(document.createElement('div'));
    for (const [i, line] of lines.entries()) {
      const child = el.children[i] as HTMLElement;
      child.className = line.cls;
      child.textContent = line.text;
      child.style.color = line.color ?? '';
    }
  }

  /** Project the building's 8 footprint corners → its screen-space AABB. */
  private projectBuildingRect(
    camera: Camera,
    width: number,
    height: number
  ): Rect | null {
    const b = this.buildingBounds;
    if (!b) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let seen = false;
    for (const x of [b.x1, b.x2]) {
      for (const y of [0, b.height]) {
        for (const z of [b.z1, b.z2]) {
          this.corner.set(x, y, z).project(camera);
          if (this.corner.z > 1) continue; // corner behind the camera
          seen = true;
          const sx = (this.corner.x * 0.5 + 0.5) * width;
          const sy = (-this.corner.y * 0.5 + 0.5) * height;
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy);
          maxY = Math.max(maxY, sy);
        }
      }
    }
    return seen ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  }

  /**
   * Lay bubbles out as callouts around the building's projected silhouette.
   *
   * Primary placement is a vertical column in the left and right gutters (chosen
   * by which side of the building centre the machine sits). When a column cannot
   * hold all of its bubbles, the overflow is re-routed into horizontal rows in
   * the gutters above and below the building — so bubbles stay aligned in rows
   * or columns and never sit over the 3D scene. Falls back to the above-anchor
   * layout when no building bounds are known.
   */
  private placeBubbles(
    placeable: Placeable[],
    width: number,
    height: number,
    building: Rect | null
  ): void {
    if (!building) {
      this.placeBubblesAbove(placeable, width, height);
      return;
    }
    const centreX = building.x + building.w / 2;
    const left: Placeable[] = [];
    const right: Placeable[] = [];
    for (const item of placeable) (item.ax < centreX ? left : right).push(item);
    left.sort((a, b) => a.ay - b.ay);
    right.sort((a, b) => a.ay - b.ay);

    const leftFit = fitColumn(left, height);
    const rightFit = fitColumn(right, height);
    this.placeColumn(leftFit.kept, building, true, width, height);
    this.placeColumn(rightFit.kept, building, false, width, height);

    const overflow = [...leftFit.overflow, ...rightFit.overflow];
    if (overflow.length === 0) return;
    overflow.sort((a, b) => a.ax - b.ax);
    const topFit = fitRow(overflow, building, width, height, true);
    const bottomFit = fitRow(topFit.rest, building, width, height, false);
    // Anything still left over (both rows full) joins the bottom row, where the
    // spreader compresses it as a last resort.
    this.placeRow([...bottomFit.kept, ...bottomFit.rest], building, false, width, height);
    this.placeRow(topFit.kept, building, true, width, height);
  }

  /** Lay a side's bubbles out as a non-overlapping vertical column just beyond
   * the building edge, with a leader from each dot to the bubble's inner edge. */
  private placeColumn(
    items: Placeable[],
    building: Rect,
    isLeft: boolean,
    width: number,
    height: number
  ): void {
    if (items.length === 0) return;
    const sizes = items.map((it) => it.entry.el.offsetHeight || DEFAULT_BUBBLE_H);
    const ys = spreadAlong(items.map((it) => it.ay), sizes, DECLUTTER_GAP, EDGE_PAD, height - EDGE_PAD);
    for (const [i, item] of items.entries()) {
      const el = item.entry.el;
      const w = el.offsetWidth || DEFAULT_BUBBLE_W;
      const h = sizes[i];
      const rawX = isLeft
        ? building.x - BUILDING_MARGIN - w
        : building.x + building.w + BUILDING_MARGIN;
      const bx = Math.max(EDGE_PAD, Math.min(rawX, width - w - EDGE_PAD));
      const by = ys[i];
      el.style.transform = `translate(${bx}px, ${by}px)`;
      const innerX = isLeft ? bx + w : bx;
      this.drawLeader(item.entry, item.ax, item.ay, innerX, by + h / 2);
    }
  }

  /** Lay overflow bubbles out as a non-overlapping horizontal row in the gutter
   * above (top) or below (bottom) the building, with a leader to the near edge. */
  private placeRow(
    items: Placeable[],
    building: Rect,
    isTop: boolean,
    width: number,
    height: number
  ): void {
    if (items.length === 0) return;
    const sizes = items.map((it) => it.entry.el.offsetWidth || DEFAULT_BUBBLE_W);
    const minX = Math.max(EDGE_PAD, building.x);
    const maxX = Math.min(width - EDGE_PAD, building.x + building.w);
    const xs = spreadAlong(items.map((it) => it.ax), sizes, DECLUTTER_GAP, minX, maxX);
    for (const [i, item] of items.entries()) {
      const el = item.entry.el;
      const w = sizes[i];
      const h = el.offsetHeight || DEFAULT_BUBBLE_H;
      const rawY = isTop
        ? building.y - BUILDING_MARGIN - h
        : building.y + building.h + BUILDING_MARGIN;
      const by = Math.max(EDGE_PAD, Math.min(rawY, height - h - EDGE_PAD));
      const bx = xs[i];
      el.style.transform = `translate(${bx}px, ${by}px)`;
      const edgeY = isTop ? by + h : by;
      this.drawLeader(item.entry, item.ax, item.ay, bx + w / 2, edgeY);
    }
  }

  private placeBubblesAbove(placeable: Placeable[], width: number, height: number): void {
    // Topmost anchors first so bubbles stack upward without cascading.
    placeable.sort((a, b) => a.ay - b.ay);
    const placed: Rect[] = [];
    for (const item of placeable) {
      const el = item.entry.el;
      const w = el.offsetWidth || DEFAULT_BUBBLE_W;
      const h = el.offsetHeight || DEFAULT_BUBBLE_H;
      let bx = item.ax - w / 2;
      let by = item.ay - LEADER_LEN - h;
      bx = Math.max(2, Math.min(bx, width - w - 2));
      let guard = 0;
      let moved = true;
      while (moved && guard < DECLUTTER_GUARD) {
        guard += 1;
        moved = false;
        for (const r of placed) {
          if (rectsOverlap({ x: bx, y: by, w, h }, r, DECLUTTER_GAP)) {
            by = r.y - h - DECLUTTER_GAP;
            moved = true;
          }
        }
        if (by < 2) {
          by = 2;
          break;
        }
      }
      by = Math.min(by, height - h - 2);
      placed.push({ x: bx, y: by, w, h });
      el.style.transform = `translate(${bx}px, ${by}px)`;
      this.drawLeader(item.entry, item.ax, item.ay, bx + w / 2, by + h);
    }
  }

  private drawLeader(entry: LabelEntry, sx: number, sy: number, ex: number, ey: number): void {
    const dx = ex - sx;
    const dy = ey - sy;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    entry.leaderEl.style.display = 'block';
    entry.leaderEl.style.width = `${len}px`;
    entry.leaderEl.style.transform = `translate(${sx}px, ${sy}px) rotate(${angle}rad)`;
  }

  private hideEntry(entry: LabelEntry): void {
    for (const el of [entry.el, entry.dotEl, entry.leaderEl]) el.style.display = HIDDEN;
  }

  private hideAll(): void {
    for (const e of this.entries) this.hideEntry(e);
  }

  private clearEntries(): void {
    for (const e of this.entries) {
      e.el.remove();
      e.dotEl.remove();
      e.leaderEl.remove();
    }
    this.entries = [];
  }
}
