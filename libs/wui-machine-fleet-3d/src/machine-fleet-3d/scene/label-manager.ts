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
 * Each bubble sits right above its machine (#55); bubbles are decluttered every frame (a
 * greedy search of the nearest free spot, upward first, then sideways) so they never overlap,
 * and a leader is drawn only for a bubble moved away from its machine. Far machines collapse to
 * the dot only. In edit mode a bubble can be dragged to a spot of its own and resized (#59);
 * in hover mode a bubble shows only while the pointer is over its machine (#56).
 */
import { Vector3, type Camera } from 'three';
import {
  DEFAULT_STATE_COLOR_MAP,
  DISCONNECTED_LABEL,
  BUILTIN_STATES,
  KPI_TYPE_INFO,
  UNKNOWN_STATE_COLOR,
  BUBBLE_SCALE_MAX,
  BUBBLE_SCALE_MIN,
  formatParamValue,
  isDisconnected,
  shownSlots,
  type DisplaySlot,
  type Kpi,
  type Machine,
  type StateColorKey,
  type StateDef
} from '../types.js';
import { MSG, localize } from '../i18n.js';

/** What the bubbles need to know about the atelier's states. */
interface StateInfo {
  label(key: string): string;
  running(key: string): boolean;
}

/** Beyond this distance only the dot is shown (no bubble / leader), or beyond
 * BUBBLE_DIST_PER_SPAN times the building's longest side for a larger building, so
 * that its whole view still shows the bubbles. */
const BUBBLE_MAX_DIST = 280;
const BUBBLE_DIST_PER_SPAN = 2;
/** Gap (px) the dot sits below the bubble's bottom edge, and between bubbles. */
const LEADER_LEN = 16;
const DECLUTTER_GAP = 6;
/** A third larger than the first 152 × 40 px bubbles (#59). */
const DEFAULT_BUBBLE_W = 203;
const DEFAULT_BUBBLE_H = 53;
const EDGE_PAD = 2;
/** Half-size (px) of a machine's dot, kept clear of the other bubbles. */
const DOT_R = 7;
/** Candidate spots of a bubble around its own (half-width column steps, row steps up; a
 * negative row is below the machine), cheapest first: up costs less than sideways, below the
 * machine the most — so bubbles stay above their machine whenever there is room. */
const SPOTS: [number, number][] = (() => {
  const out: [number, number][] = [];
  for (let i = -4; i <= 4; i++) for (let j = -3; j <= 5; j++) out.push([i, j]);
  const cost = ([i, j]: [number, number]): number => Math.abs(i) * 1.6 + (j >= 0 ? j : 4 - j * 2);
  return out.sort((a, b) => cost(a) - cost(b));
})();
/** Pointer travel (px) under which a press on a bubble in edit mode is a click, not a drag. */
const CLICK_SLOP_PX = 4;
/** Delay (ms) before a hover-mode bubble hides once the pointer has left it. */
const HOVER_HIDE_MS = 300;
const HIDDEN = 'none';
const STATE_VAR = '--mf-state';
/** CSS class for a numeric/value bubble line (parameters, KPIs, obsolescence). */
const LINE_KPI_CLS = 'mf-label__kpi-line';
/** CSS class of the "à placer" bubble line, and modifier of the dot of such a machine. */
const TO_PLACE_CLS = 'mf-label__to-place';
const DOT_TO_PLACE_CLS = 'mf-dot--to-place';

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
  /** Placed by hand: offset (px) of the bubble's bottom centre from the dot; null = automatic. */
  offset: [number, number] | null;
  /** Where the bubble was last drawn (bottom centre) and its dot, for a drag in edit mode. */
  lastBox?: { cx: number; bottom: number; ax: number; ay: number };
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

/** Ordered, visible bubble lines for a machine (order and visibility = the Affichage tab). */
function buildBubbleLines(m: Machine, states: StateInfo): BubbleLine[] {
  const lines: BubbleLine[] = [];
  for (const slot of shownSlots(m)) {
    if (!slot.inBubble) continue;
    const line = bubbleLineFor(slot, m, states);
    if (line) lines.push(line);
  }
  return lines;
}

function bubbleLineFor(slot: DisplaySlot, m: Machine, states: StateInfo): BubbleLine | null {
  if (slot.kind === 'state') return { text: states.label(m.state), cls: 'mf-label__badge' };
  if (slot.kind === 'stopCause') {
    return !states.running(m.state) && m.stopCauseLabel
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
  if (slot.kind === 'alarmCode') {
    // Shown while the machine is not producing (stop, maintenance…), as the stop cause.
    return !states.running(m.state) && m.alarmCode != null && m.alarmCode !== ''
      ? { text: `${localize(MSG.view.alarmCode)} ${m.alarmCode}`, cls: 'mf-label__cause' }
      : null;
  }
  if (slot.kind === 'param') {
    // Label – value, as the other lines (a bare value says nothing once several are shown).
    const text = formatKpi(slot.param);
    return text ? { text: `${slot.label} ${text}`, cls: LINE_KPI_CLS } : null;
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
  const num = formatParamValue(v);
  return {
    text: `${slot.label} ${num} ${KPI_TYPE_INFO[kpi.type].unit}`,
    cls: LINE_KPI_CLS,
    color: (m.kpiCalcColors ?? {})[kpi.id]
  };
}

function formatKpi(kpi: Kpi | undefined): string {
  if (!kpi || kpi.value == null) return '';
  const num = formatParamValue(kpi.value, kpi.decimals);
  return kpi.unit ? `${num} ${kpi.unit}` : num;
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 1;
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.w + gap < b.x ||
    b.x + b.w + gap < a.x ||
    a.y + a.h + gap < b.y ||
    b.y + b.h + gap < a.y
  );
}

export class LabelManager {
  private entries: LabelEntry[] = [];
  private enabled = true;
  private alertOnly = false;
  /** Machines left out by the filter bar: no bubble, no dot. */
  private filteredOut: ReadonlySet<string> = new Set();
  private readonly anchor = new Vector3();
  private buildingBounds: BuildingBounds | null = null;
  /** State/overlay colours (from the atelier's mapping), with defaults. */
  private stateColors: Record<StateColorKey, string> = DEFAULT_STATE_COLOR_MAP;
  /** States of the atelier (labels, producing ones), built-in four until told otherwise. */
  private stateDefs: StateDef[] = BUILTIN_STATES;
  private readonly states: StateInfo = {
    label: (key) => this.stateDefs.find((s) => s.key === key)?.label ?? key,
    running: (key) => this.stateDefs.find((s) => s.key === key)?.running ?? key === 'ok'
  };

  /** Fired when the pointer enters a machine's bubble or dot (its id), and leaves it (null). */
  onHover: ((id: string | null) => void) | null = null;
  /** A bubble was moved or resized by hand in edit mode; `null` = back to automatic (#59). */
  onBubbleEdit: ((id: string, patch: { bubbleScale?: number | null; bubbleOffset?: [number, number] | null }) => void) | null =
    null;

  private editMode = false;
  /** Hover mode (#56): a bubble shows only for the machine under the pointer. */
  private hoverMode = false;
  /** The machine under the pointer on the canvas (its 3D model and a margin around it). */
  private hoveredId: string | null = null;
  /** The machine whose dot or bubble the pointer is over, kept a moment after it leaves. */
  private overId: string | null = null;
  private overTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly overlay: HTMLElement,
    private readonly onSelect: (id: string) => void
  ) {}

  /** Set the state/overlay colour map (dot, leader, bubble accent). */
  setStateColors(colors: Record<StateColorKey, string>): void {
    this.stateColors = colors;
  }

  /** Set the atelier's states (bubble state label, stop cause shown outside producing states, alert-only filter). */
  setStateDefs(defs: StateDef[]): void {
    this.stateDefs = defs;
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

  /** Edit mode: bubbles can be dragged and resized (#59), and all show in hover mode. */
  setEditMode(on: boolean): void {
    this.editMode = on;
    for (const e of this.entries) e.el.classList.toggle('mf-label--editable', on);
  }

  setHoverMode(on: boolean): void {
    this.hoverMode = on;
  }

  /** The machine under the pointer on the canvas (hover mode), or null. */
  setHovered(id: string | null): void {
    this.hoveredId = id;
  }

  setFilteredOut(ids: ReadonlySet<string>): void {
    this.filteredOut = ids;
    for (const entry of this.entries) if (ids.has(entry.machine.id)) this.hideEntry(entry);
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
    // Pass 2: each bubble above its machine, decluttered, then the leaders.
    this.placeBubbles(placeable, width, height);
  }

  dispose(): void {
    clearTimeout(this.overTimer);
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
    const onEnter = (): void => {
      leaderEl.classList.add('mf-leader--hover');
      clearTimeout(this.overTimer);
      this.overId = machine.id;
      this.onHover?.(machine.id);
    };
    const onLeave = (): void => {
      leaderEl.classList.remove('mf-leader--hover');
      // Hover mode: the bubble stays a moment, so the pointer can go from the machine onto it.
      clearTimeout(this.overTimer);
      this.overTimer = setTimeout(() => {
        if (this.overId === machine.id) this.overId = null;
      }, HOVER_HIDE_MS);
      this.onHover?.(null);
    };
    const dotEl = document.createElement('div');
    dotEl.className = 'mf-dot';
    dotEl.addEventListener('pointerdown', onPick);
    dotEl.addEventListener('pointerenter', onEnter);
    dotEl.addEventListener('pointerleave', onLeave);
    const el = document.createElement('div');
    el.className = this.editMode ? 'mf-label mf-label--editable' : 'mf-label';
    el.style.setProperty('--mf-bubble-scale', String(machine.bubbleScale ?? 1));
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    const nameEl = document.createElement('div');
    nameEl.className = 'mf-label__name';
    nameEl.textContent = machine.name;
    const linesEl = document.createElement('div');
    linesEl.className = 'mf-label__lines';
    const resizeEl = document.createElement('div');
    resizeEl.className = 'mf-label__resize';
    resizeEl.title = localize(MSG.bubble.resize);
    const resetEl = document.createElement('button');
    resetEl.className = 'mf-label__reset';
    resetEl.textContent = '↺';
    resetEl.title = localize(MSG.bubble.reset);
    el.append(nameEl, linesEl, resizeEl, resetEl);
    this.overlay.append(leaderEl, dotEl, el);
    const entry: LabelEntry = { machine, el, dotEl, leaderEl, nameEl, linesEl, offset: machine.bubbleOffset ?? null };
    el.classList.toggle('mf-label--manual', this.isCustom(entry));
    el.addEventListener('pointerdown', (e) => (this.editMode ? this.dragBubble(entry, e) : onPick(e)));
    resizeEl.addEventListener('pointerdown', (e) => this.resizeBubble(entry, e));
    resetEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    resetEl.addEventListener('click', (e) => {
      e.stopPropagation();
      entry.offset = null;
      delete machine.bubbleScale;
      el.style.setProperty('--mf-bubble-scale', '1');
      el.classList.remove('mf-label--manual');
      this.onBubbleEdit?.(machine.id, { bubbleOffset: null, bubbleScale: null });
    });
    return entry;
  }

  private isCustom(entry: LabelEntry): boolean {
    return entry.offset !== null || (entry.machine.bubbleScale ?? 1) !== 1;
  }

  /** Edit mode: drag a bubble to a spot of its own (offset from its dot, kept at any zoom). */
  private dragBubble(entry: LabelEntry, down: PointerEvent): void {
    if (down.button !== 0) return;
    down.stopPropagation();
    down.preventDefault();
    const start = entry.lastBox;
    if (!start) return;
    let moved = false;
    const move = (e: PointerEvent): void => {
      const dx = e.clientX - down.clientX;
      const dy = e.clientY - down.clientY;
      if (!moved && Math.hypot(dx, dy) < CLICK_SLOP_PX) return;
      moved = true;
      // Offset of the bubble's bottom centre from the dot.
      entry.offset = [Math.round(start.cx + dx - start.ax), Math.round(start.bottom + dy - start.ay)];
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (!moved) {
        this.onSelect(entry.machine.id);
        return;
      }
      entry.el.classList.add('mf-label--manual');
      if (entry.offset) this.onBubbleEdit?.(entry.machine.id, { bubbleOffset: entry.offset });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /**
   * Edit mode: the corner handle enlarges or reduces the whole bubble, text included, keeping its
   * proportions; dragging right or down enlarges it, whichever moves it most (#275).
   */
  private resizeBubble(entry: LabelEntry, down: PointerEvent): void {
    if (down.button !== 0) return;
    down.stopPropagation();
    down.preventDefault();
    const startScale = entry.machine.bubbleScale ?? 1;
    const startW = entry.el.offsetWidth || DEFAULT_BUBBLE_W * startScale;
    const startH = entry.el.offsetHeight || DEFAULT_BUBBLE_H * startScale;
    let scale = startScale;
    const move = (e: PointerEvent): void => {
      const fx = (startW + e.clientX - down.clientX) / startW;
      const fy = (startH + e.clientY - down.clientY) / startH;
      const f = Math.abs(fx - 1) >= Math.abs(fy - 1) ? fx : fy;
      scale = Math.min(BUBBLE_SCALE_MAX, Math.max(BUBBLE_SCALE_MIN, startScale * f));
      scale = Math.round(scale * 20) / 20;
      entry.el.style.setProperty('--mf-bubble-scale', String(scale));
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (scale === startScale) return;
      entry.machine.bubbleScale = scale;
      entry.el.classList.add('mf-label--manual');
      this.onBubbleEdit?.(entry.machine.id, { bubbleScale: scale });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
    if (
      this.filteredOut.has(machine.id) ||
      (this.alertOnly && this.states.running(machine.state))
    ) {
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
    const color = this.stateColors[offline ? 'disconnected' : machine.state] ?? UNKNOWN_STATE_COLOR;
    el.style.setProperty(STATE_VAR, color);
    dotEl.style.setProperty(STATE_VAR, color);
    leaderEl.style.setProperty(STATE_VAR, color);

    // Dot is always shown (within the view frustum). A machine "à placer" is said on the dot
    // too (ring + tooltip + accessible name), for when its bubble is collapsed or hidden.
    this.markToPlace(entry);
    dotEl.style.display = 'block';
    dotEl.style.transform = `translate(-50%, -50%) translate(${ax}px, ${ay}px)`;

    // Hover mode (outside edit mode): only the machine under the pointer, at any distance.
    if (this.hoverMode && !this.editMode) {
      if (machine.id !== this.hoveredId && machine.id !== this.overId) {
        el.style.display = HIDDEN;
        leaderEl.style.display = HIDDEN;
        return null;
      }
    } else if (dist > this.bubbleMaxDist()) {
      el.style.display = HIDDEN;
      leaderEl.style.display = HIDDEN;
      return null;
    }

    el.style.display = 'flex';
    // Offline shows only the disconnected badge; otherwise the ordered, visible
    // info lines (state / production / params / KPIs) per the Affichage config.
    const lines = offline
      ? [{ text: DISCONNECTED_LABEL, cls: 'mf-label__badge' }]
      : buildBubbleLines(machine, this.states);
    // "À placer" heads the bubble, as text (not only a colour), whatever the configuration.
    if (machine.toPlace) lines.unshift({ text: localize(MSG.toPlace.label), cls: TO_PLACE_CLS });
    this.renderLines(entry.linesEl, lines);
    return { entry, ax, ay };
  }

  /** Camera distance beyond which only the dots are shown, by the building's size. */
  private bubbleMaxDist(): number {
    const b = this.buildingBounds;
    if (!b) return BUBBLE_MAX_DIST;
    return Math.max(BUBBLE_MAX_DIST, BUBBLE_DIST_PER_SPAN * Math.max(b.x2 - b.x1, b.z2 - b.z1));
  }

  /** Mark (or unmark) the dot of a machine "à placer": ring, tooltip and accessible name. */
  private markToPlace({ machine, dotEl }: LabelEntry): void {
    const on = machine.toPlace === true;
    if (dotEl.classList.contains(DOT_TO_PLACE_CLS) === on) return;
    dotEl.classList.toggle(DOT_TO_PLACE_CLS, on);
    if (on) {
      const text = `${machine.name} — ${localize(MSG.toPlace.label)} : ${localize(MSG.toPlace.hint)}`;
      dotEl.title = text;
      dotEl.setAttribute('aria-label', text);
    } else {
      dotEl.removeAttribute('title');
      dotEl.removeAttribute('aria-label');
    }
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

  /**
   * Each bubble right above its machine (#55). Bubbles placed by hand go first, at their own
   * spot; then, nearest machines first (lowest on screen), each takes the cheapest free spot
   * around its own: straight above, else higher, else sideways (SPOTS). A leader joins the dot
   * to a bubble moved away from its machine.
   */
  private placeBubbles(placeable: Placeable[], width: number, height: number): void {
    // The machines' dots are obstacles too: a bubble does not hide another machine's dot.
    const dots: Rect[] = placeable.map((p) => ({ x: p.ax - DOT_R, y: p.ay - DOT_R, w: 2 * DOT_R, h: 2 * DOT_R }));
    const placed: Rect[] = [...dots];
    const auto: Placeable[] = [];
    for (const item of placeable) {
      const off = item.entry.offset;
      if (!off) {
        auto.push(item);
        continue;
      }
      const { w, h } = this.size(item.entry);
      const r = this.clampRect(item.ax + off[0] - w / 2, item.ay + off[1] - h, w, h, width, height);
      placed.push(r);
      this.setBox(item, r, true);
    }
    auto.sort((a, b) => b.ay - a.ay);
    for (const item of auto) {
      const { w, h } = this.size(item.entry);
      const x0 = item.ax - w / 2;
      const y0 = item.ay - LEADER_LEN - h;
      // The first free spot; none free (a crowded view): the one the others cover the least.
      let best: Rect | null = null;
      let bestCover = Infinity;
      for (const [i, j] of SPOTS) {
        const r = this.clampRect(x0 + i * (w / 2 + DECLUTTER_GAP), y0 - j * (h + DECLUTTER_GAP), w, h, width, height);
        let cover = 0;
        for (const p of placed) if (rectsOverlap(r, p, DECLUTTER_GAP)) cover += overlapArea(r, p);
        if (cover === 0) {
          best = r;
          break;
        }
        if (cover < bestCover) {
          bestCover = cover;
          best = r;
        }
      }
      const r = best ?? this.clampRect(x0, y0, w, h, width, height);
      placed.push(r);
      this.setBox(item, r, r.x !== x0 || r.y !== y0);
    }
  }

  private size(entry: LabelEntry): { w: number; h: number } {
    const scale = entry.machine.bubbleScale ?? 1;
    return {
      w: entry.el.offsetWidth || DEFAULT_BUBBLE_W * scale,
      h: entry.el.offsetHeight || DEFAULT_BUBBLE_H * scale
    };
  }

  // eslint-disable-next-line max-params -- a rect and the viewport it is kept in
  private clampRect(x: number, y: number, w: number, h: number, width: number, height: number): Rect {
    return {
      x: Math.max(EDGE_PAD, Math.min(x, width - w - EDGE_PAD)),
      y: Math.max(EDGE_PAD, Math.min(y, height - h - EDGE_PAD)),
      w,
      h
    };
  }

  /** Put the bubble at `r`; a leader from the dot to its bottom centre when `moved` away. */
  private setBox(item: Placeable, r: Rect, moved: boolean): void {
    const { entry, ax, ay } = item;
    entry.el.style.transform = `translate(${r.x}px, ${r.y}px)`;
    entry.lastBox = { cx: r.x + r.w / 2, bottom: r.y + r.h, ax, ay };
    if (moved) this.drawLeader(entry, ax, ay, r.x + r.w / 2, r.y + r.h);
    else entry.leaderEl.style.display = HIDDEN;
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
