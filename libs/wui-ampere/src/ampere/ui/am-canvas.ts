// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * SVG drawing surface of the Ampère page (edit + runtime).
 *
 * Display mode renders the live diagram: wires/symbols tint green when
 * energised, measurement labels show live values, and a symbol whose bound
 * datapoint is in alarm gets a pulsing frame in the alert colour. With `fit`
 * (embedded tile) the drawing stretches to the host box.
 *
 * Edit mode adds the authoring gestures: with a symbol tool armed, clicking an
 * empty spot places it (`wui:place`); with the *select* tool, dragging on empty
 * space draws a **rubber-band** that selects everything inside it, clicking
 * selects one item (Shift+click toggles it in the selection), and dragging any
 * selected item moves the WHOLE selection on the magnetic grid
 * (`wui:move-multi` on commit). Symbol labels drag freely (`wui:move-label`).
 * Clicking a port (○) starts a wire and clicking a second port completes it
 * (`wui:connect`, Esc cancels). Delete/⌫ removes the selection (`wui:delete`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';
import { SYMBOLS, type SymbolId } from '../symbols/catalog.js';
import type { EnergyState } from '../topology.js';
import { MSG, localizeDir } from '../i18n.js';
import {
  CANVAS_H,
  CANVAS_W,
  contentBounds,
  edgeEnds,
  measurementPos,
  nodeCenter,
  nodeExit,
  nodeSize,
  orthPath,
  portWorld,
  snap,
  type Measurement,
  type Network,
  type Node,
  type PortRef,
  type Point
} from '../types.js';

/** Current pointer tool: pick a symbol to place, `select` to move, `wire` implied by clicking ports. */
export type Tool = 'select' | SymbolId;

/** One selected object on the canvas (the page holds an array of these). */
export interface Selection {
  kind: 'node' | 'edge' | 'measurement';
  id: string;
}

/** Selection-changed event name (emitted with the new {@link Selection} array). */
const WUI_SELECT = 'wui:select';
/** Pointer movement below this (canvas units) is a click, not a drag. */
const CLICK_SLOP = 3;
/** Default gap between a symbol's box and its label baseline. */
const LABEL_GAP = 16;

@customElement('am-canvas')
export class AmCanvas extends LitElement {
  static override readonly styles = [IXCoreStyles, canvasStyles()];

  @property({ attribute: false }) network: Network = {
    id: '',
    name: '',
    description: '',
    nodes: [],
    edges: [],
    measurements: [],
    updatedAt: ''
  };
  @property({ type: Boolean }) editing = false;
  @property({ attribute: false }) tool: Tool = 'select';
  @property({ type: Number }) zoom = 1;
  @property({ attribute: false }) energy: EnergyState | null = null;
  @property({ attribute: false }) closed: Map<string, boolean> = new Map();
  /** Formatted live measurement readouts, keyed by measurement id. */
  @property({ attribute: false }) readout: Map<string, string> = new Map();
  /** Per-node alarm frame colour (CSS), keyed by node id — empty map = no alarm. */
  @property({ attribute: false }) alarm: Map<string, string> = new Map();
  @property({ attribute: false }) selection: Selection[] = [];
  /** Stretch the diagram to the host box (embedded/Mosaic tile display). */
  @property({ type: Boolean }) fit = false;

  /** Group-drag preview: grid-snapped delta applied to every dragged item. */
  @state() private dragDelta: Point | null = null;
  /** Label-drag preview: the dragged label's current offset. */
  @state() private labelDrag: { id: string; dx: number; dy: number } | null = null;
  /** Rubber-band rectangle while marquee-selecting (canvas units). */
  @state() private marquee: { a: Point; b: Point } | null = null;
  /** First port picked while drawing a wire (null = not wiring). */
  @state() private wireFrom: PortRef | null = null;
  /** Live cursor position (canvas units) for the wire rubber-band. */
  @state() private cursor: Point | null = null;

  private dragNodeIds = new Set<string>();
  private dragMeasIds = new Set<string>();
  private dragMoved = false;
  private start: Point = { x: 0, y: 0 };

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener('keydown', this.onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    globalThis.removeEventListener('keydown', this.onKey);
  }

  override render(): TemplateResult {
    // Apply the live group-drag preview so wires/labels follow the moved items,
    // without mutating the stored network (committed only on pointer-up).
    const delta = this.dragDelta;
    const nodes =
      delta && this.dragNodeIds.size > 0
        ? this.network.nodes.map((n) => (this.dragNodeIds.has(n.id) ? { ...n, x: n.x + delta.x, y: n.y + delta.y } : n))
        : this.network.nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const bounds = this.fit ? contentBounds(this.network) : null;
    const vb = bounds ?? { x: 0, y: 0, w: CANVAS_W, h: CANVAS_H };
    const empty = this.network.nodes.length === 0 && this.network.measurements.length === 0;
    return html`
      <div class="scroll ${this.fit ? 'fit' : ''}">
        <svg
          class="canvas ${this.editing ? 'editing' : ''} ${this.fit ? 'fit' : ''}"
          width=${ifDefined(this.fit ? undefined : CANVAS_W * this.zoom)}
          height=${ifDefined(this.fit ? undefined : CANVAS_H * this.zoom)}
          viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}"
          preserveAspectRatio="xMidYMid meet"
          @pointerdown=${this.onCanvasDown}
          @pointermove=${this.onCanvasMove}
        >
          ${this.editing ? svg`<rect class="bg" x="0" y="0" width=${CANVAS_W} height=${CANVAS_H} fill="url(#am-grid)" />` : nothing}
          ${this.editing ? gridDefs() : nothing}
          <g class="edges">
            ${repeat(
              this.network.edges,
              (e) => e.id,
              (e) => this.renderEdge(e, byId)
            )}
          </g>
          ${this.wireFrom && this.cursor ? this.renderRubberBand(byId) : nothing}
          <g class="nodes">
            ${repeat(
              nodes,
              (n) => n.id,
              (n) => this.renderNode(n)
            )}
          </g>
          <g class="measurements">
            ${repeat(
              this.network.measurements,
              (m) => m.id,
              (m) => this.renderMeasurement(m, byId)
            )}
          </g>
          ${this.marquee ? this.renderMarquee() : nothing}
        </svg>
      </div>
      ${empty
        ? html`<div class="empty">
            <ix-icon name="electrical-energy" size="32"></ix-icon>
            <span>${this.editing ? localizeDir(MSG.canvas.emptyEditing) : localizeDir(MSG.canvas.emptyDisplay)}</span>
          </div>`
        : nothing}
      ${this.editing && this.wireFrom ? html`<div class="wire-hint">${localizeDir(MSG.canvas.wireHint)}</div>` : nothing}
    `;
  }

  // --- rendering -------------------------------------------------------------

  private isSelected(kind: Selection['kind'], id: string): boolean {
    return this.selection.some((s) => s.kind === kind && s.id === id);
  }

  private renderEdge(edge: { id: string; from: PortRef; to: PortRef }, byId: Map<string, Node>): SVGTemplateResult {
    const ends = edgeEnds(edge, byId);
    if (!ends) return svg``;
    const live = this.energy?.edge(edge.id) ?? false;
    const sel = this.isSelected('edge', edge.id);
    const cls = `wire ${live ? 'live' : ''} ${sel ? 'selected' : ''}`;
    return svg`<path
      class=${cls}
      d=${orthPath(ends[0], ends[1])}
      @pointerdown=${(e: PointerEvent) => this.onEdgeDown(e, edge.id)}
    ></path>`;
  }

  private renderNode(node: Node): SVGTemplateResult {
    const def = SYMBOLS[node.symbol];
    const size = nodeSize(node);
    const cx = size.w / 2;
    const cy = size.h / 2;
    const live = this.energy?.node(node.id) ?? false;
    const sel = this.isSelected('node', node.id);
    const isClosed = this.closed.get(node.id) ?? true;
    const alarmColor = this.alarm.get(node.id);
    const center = nodeCenter(node);
    const drag = this.labelDrag?.id === node.id ? this.labelDrag : null;
    const lx = center.x + (drag ? drag.dx : (node.labelDx ?? 0));
    const ly = node.y + size.h + LABEL_GAP + (drag ? drag.dy : (node.labelDy ?? 0));
    return svg`
      <g class="sym ${live ? 'live' : ''} ${sel ? 'selected' : ''}">
        <g
          transform="translate(${node.x} ${node.y}) rotate(${node.rotation} ${cx} ${cy})"
          @pointerdown=${(e: PointerEvent) => this.onNodeDown(e, node)}
        >
          ${alarmColor ? svg`<rect class="alarm-frame" x="-8" y="-8" width=${size.w + 16} height=${size.h + 16} rx="8" style=${`stroke:${alarmColor}`} />` : nothing}
          ${sel ? svg`<rect class="halo" x="-6" y="-6" width=${size.w + 12} height=${size.h + 12} rx="6" />` : nothing}
          <rect class="hit" x="0" y="0" width=${size.w} height=${size.h} />
          ${def.render({ closed: isClosed, exit: nodeExit(node) ?? undefined, w: size.w, h: size.h })}
        </g>
        ${node.label
          ? svg`<text
              class="label ${this.editing ? 'editing' : ''}"
              x=${lx}
              y=${ly}
              text-anchor="middle"
              @pointerdown=${(e: PointerEvent) => this.onLabelDown(e, node)}
            >${node.label}</text>`
          : nothing}
        ${this.editing ? this.renderPorts(node) : nothing}
      </g>
    `;
  }

  private renderPorts(node: Node): SVGTemplateResult {
    const def = SYMBOLS[node.symbol];
    return svg`${Object.keys(def.ports).map((key) => {
      const p = portWorld(node, key);
      if (!p) return svg``;
      const active = this.wireFrom?.nodeId === node.id && this.wireFrom.port === key;
      return svg`<circle
        class="port ${active ? 'active' : ''}"
        cx=${p.x}
        cy=${p.y}
        r="7"
        @pointerdown=${(e: PointerEvent) => this.onPortDown(e, { nodeId: node.id, port: key })}
      ></circle>`;
    })}`;
  }

  private renderMeasurement(m: Measurement, byId: Map<string, Node>): SVGTemplateResult {
    const delta = this.dragDelta && this.dragMeasIds.has(m.id) ? this.dragDelta : { x: 0, y: 0 };
    const pos = measurementPos(m, byId);
    const base = { x: pos.x + delta.x, y: pos.y + delta.y };
    const sel = this.isSelected('measurement', m.id);
    const value = this.readout.get(m.id) ?? '—';
    const text = `${m.label ? `${m.label} ` : ''}${value}${m.unit ? ` ${m.unit}` : ''}`;
    return svg`
      <g
        class="meas ${sel ? 'selected' : ''}"
        transform="translate(${base.x} ${base.y})"
        @pointerdown=${(e: PointerEvent) => this.onMeasDown(e, m)}
      >
        <rect class="meas-bg" x="-4" y="-16" width="92" height="24" rx="4"></rect>
        <text class="meas-text" x="0" y="0" data-dp=${m.dp}>${text}</text>
      </g>
    `;
  }

  private renderRubberBand(byId: Map<string, Node>): SVGTemplateResult {
    const from = this.wireFrom ? portWorld(byId.get(this.wireFrom.nodeId)!, this.wireFrom.port) : undefined;
    if (!from || !this.cursor) return svg``;
    return svg`<path class="rubber" d=${orthPath(from, this.cursor)}></path>`;
  }

  private renderMarquee(): SVGTemplateResult {
    const m = this.marquee!;
    const x = Math.min(m.a.x, m.b.x);
    const y = Math.min(m.a.y, m.b.y);
    return svg`<rect class="marquee" x=${x} y=${y} width=${Math.abs(m.b.x - m.a.x)} height=${Math.abs(m.b.y - m.a.y)} />`;
  }

  // --- interaction -----------------------------------------------------------

  private toUser(e: PointerEvent): Point {
    const svgEl = this.renderRoot.querySelector<SVGSVGElement>('svg.canvas');
    const ctm = svgEl?.getScreenCTM();
    if (!svgEl || !ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  private onCanvasDown(e: PointerEvent): void {
    if (!this.editing) return;
    // A symbol tool places on empty space; the select tool starts a marquee.
    if (this.tool !== 'select') {
      const p = this.toUser(e);
      const def = SYMBOLS[this.tool];
      this.emit('wui:place', { symbol: this.tool, x: snap(p.x - def.w / 2), y: snap(p.y - def.h / 2) });
      return;
    }
    if (this.wireFrom) {
      this.cancelWire();
      return;
    }
    this.beginMarquee(e);
  }

  private onCanvasMove(e: PointerEvent): void {
    if (this.editing && this.wireFrom) this.cursor = this.toUser(e);
  }

  private onNodeDown(e: PointerEvent, node: Node): void {
    if (!this.editing || this.tool !== 'select') return;
    e.stopPropagation();
    if (e.shiftKey) {
      this.emit(WUI_SELECT, toggleSelection(this.selection, { kind: 'node', id: node.id }));
      return;
    }
    let sel = this.selection;
    if (!this.isSelected('node', node.id)) {
      sel = [{ kind: 'node', id: node.id }];
      this.emit(WUI_SELECT, sel);
    }
    this.beginGroupDrag(e, sel);
  }

  private onMeasDown(e: PointerEvent, m: Measurement): void {
    if (!this.editing || this.tool !== 'select') return;
    e.stopPropagation();
    if (e.shiftKey) {
      this.emit(WUI_SELECT, toggleSelection(this.selection, { kind: 'measurement', id: m.id }));
      return;
    }
    let sel = this.selection;
    if (!this.isSelected('measurement', m.id)) {
      sel = [{ kind: 'measurement', id: m.id }];
      this.emit(WUI_SELECT, sel);
    }
    this.beginGroupDrag(e, sel);
  }

  private onLabelDown(e: PointerEvent, node: Node): void {
    if (!this.editing || this.tool !== 'select') return;
    e.stopPropagation();
    const start = this.toUser(e);
    const ox = node.labelDx ?? 0;
    const oy = node.labelDy ?? 0;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      const p = this.toUser(ev);
      if (Math.abs(p.x - start.x) > CLICK_SLOP || Math.abs(p.y - start.y) > CLICK_SLOP) moved = true;
      this.labelDrag = { id: node.id, dx: ox + p.x - start.x, dy: oy + p.y - start.y };
    };
    const up = (): void => {
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', up);
      const d = this.labelDrag;
      this.labelDrag = null;
      if (moved && d) this.emit('wui:move-label', { id: d.id, dx: Math.round(d.dx), dy: Math.round(d.dy) });
    };
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', up);
  }

  private onEdgeDown(e: PointerEvent, id: string): void {
    if (!this.editing || this.tool !== 'select') return;
    e.stopPropagation();
    if (e.shiftKey) {
      this.emit(WUI_SELECT, toggleSelection(this.selection, { kind: 'edge', id }));
      return;
    }
    this.emit(WUI_SELECT, [{ kind: 'edge', id }]);
  }

  private onPortDown(e: PointerEvent, ref: PortRef): void {
    if (!this.editing) return;
    e.stopPropagation();
    if (!this.wireFrom) {
      this.wireFrom = ref;
      this.cursor = this.toUser(e);
      return;
    }
    if (this.wireFrom.nodeId !== ref.nodeId || this.wireFrom.port !== ref.port) {
      this.emit('wui:connect', { from: this.wireFrom, to: ref });
    }
    this.cancelWire();
  }

  /** Drag every selected item (grid-snapped delta); commit `wui:move-multi` on release. */
  private beginGroupDrag(e: PointerEvent, sel: Selection[]): void {
    this.dragNodeIds = new Set(sel.filter((s) => s.kind === 'node').map((s) => s.id));
    // Anchored measurements whose anchor node is also dragged follow it — do
    // not ALSO offset them, or the move would apply twice.
    const byId = new Map(this.network.measurements.map((m) => [m.id, m]));
    this.dragMeasIds = new Set(
      sel
        .filter((s) => s.kind === 'measurement')
        .map((s) => s.id)
        .filter((id) => {
          const m = byId.get(id);
          return m != null && !(m.nodeId && this.dragNodeIds.has(m.nodeId));
        })
    );
    this.dragMoved = false;
    this.start = this.toUser(e);
    globalThis.addEventListener('pointermove', this.onGroupDragMove);
    globalThis.addEventListener('pointerup', this.onGroupDragUp);
  }

  private readonly onGroupDragMove = (ev: PointerEvent): void => {
    const p = this.toUser(ev);
    const dx = snap(p.x - this.start.x);
    const dy = snap(p.y - this.start.y);
    if (dx !== 0 || dy !== 0) this.dragMoved = true;
    this.dragDelta = { x: dx, y: dy };
  };

  private readonly onGroupDragUp = (): void => {
    globalThis.removeEventListener('pointermove', this.onGroupDragMove);
    globalThis.removeEventListener('pointerup', this.onGroupDragUp);
    const d = this.dragDelta;
    this.dragDelta = null;
    if (!this.dragMoved || !d) return;
    this.emit('wui:move-multi', { dx: d.x, dy: d.y, nodes: [...this.dragNodeIds], measurements: [...this.dragMeasIds] });
  };

  /** Rubber-band selection: drag on empty space, release to select what it covers. */
  private beginMarquee(e: PointerEvent): void {
    const start = this.toUser(e);
    this.dragMoved = false;
    const move = (ev: PointerEvent): void => {
      const p = this.toUser(ev);
      if (Math.abs(p.x - start.x) > CLICK_SLOP || Math.abs(p.y - start.y) > CLICK_SLOP) this.dragMoved = true;
      this.marquee = { a: start, b: p };
    };
    const up = (): void => {
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', up);
      const rect = this.marquee;
      this.marquee = null;
      // A plain click (no drag) clears the selection — the previous behaviour.
      this.emit(WUI_SELECT, this.dragMoved && rect ? this.hitTest(rect) : []);
    };
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', up);
  }

  /** Everything covered by the marquee: symbols, free/anchored labels, and wires whose both ends are taken. */
  private hitTest(rect: { a: Point; b: Point }): Selection[] {
    const x0 = Math.min(rect.a.x, rect.b.x);
    const x1 = Math.max(rect.a.x, rect.b.x);
    const y0 = Math.min(rect.a.y, rect.b.y);
    const y1 = Math.max(rect.a.y, rect.b.y);
    const out: Selection[] = [];
    const nodeIds = new Set<string>();
    for (const n of this.network.nodes) {
      const size = nodeSize(n);
      if (n.x < x1 && n.x + size.w > x0 && n.y < y1 && n.y + size.h > y0) {
        out.push({ kind: 'node', id: n.id });
        nodeIds.add(n.id);
      }
    }
    for (const e of this.network.edges) {
      if (nodeIds.has(e.from.nodeId) && nodeIds.has(e.to.nodeId)) out.push({ kind: 'edge', id: e.id });
    }
    const byId = new Map(this.network.nodes.map((n) => [n.id, n]));
    for (const m of this.network.measurements) {
      const p = measurementPos(m, byId);
      if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) out.push({ kind: 'measurement', id: m.id });
    }
    return out;
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.editing) return;
    if (e.key === 'Escape' && this.wireFrom) {
      this.cancelWire();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.length > 0 && !this.isTypingTarget(e)) {
      e.preventDefault();
      this.emit('wui:delete', this.selection);
    }
  };

  private isTypingTarget(e: KeyboardEvent): boolean {
    const el = e.composedPath()[0] as HTMLElement | undefined;
    const tag = el?.tagName?.toLowerCase();
    return tag === 'input' || tag === 'textarea' || el?.isContentEditable === true;
  }

  private cancelWire(): void {
    this.wireFrom = null;
    this.cursor = null;
  }

  private emit(type: string, detail: unknown): void {
    // eslint-disable-next-line no-restricted-syntax -- `type` is a fixed internal `wui:*` event name; the rule only validates string literals.
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

/** Add the item to the selection, or remove it when already selected (Shift+click). */
function toggleSelection(selection: Selection[], item: Selection): Selection[] {
  const without = selection.filter((s) => !(s.kind === item.kind && s.id === item.id));
  return without.length === selection.length ? [...selection, item] : without;
}

function gridDefs(): SVGTemplateResult {
  return svg`
    <defs>
      <pattern id="am-grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--am-grid-color)" stroke-width="1" />
      </pattern>
    </defs>
  `;
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function canvasStyles(): ReturnType<typeof css> {
  return css`
    :host {
      position: relative;
      display: block;
      height: 100%;
      min-height: 0;
    }
    .scroll {
      height: 100%;
      overflow: auto;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .scroll.fit {
      overflow: hidden;
      border: none;
      border-radius: 0;
    }
    svg.canvas {
      display: block;
      --am-grid-color: color-mix(in srgb, var(--theme-color-soft-text, #94a3b8) 16%, transparent);
      color: var(--theme-color-std-text);
      touch-action: none;
    }
    svg.canvas.fit {
      width: 100%;
      height: 100%;
    }
    svg.canvas.editing {
      cursor: crosshair;
    }
    .bg {
      pointer-events: none;
    }
    /* wires */
    .wire {
      fill: none;
      stroke: var(--theme-color-std-text);
      stroke-width: 3;
      stroke-linejoin: round;
      stroke-linecap: round;
    }
    .wire.live {
      stroke: var(--theme-color-success, #2fd44f);
    }
    .editing .wire {
      cursor: pointer;
    }
    .wire.selected {
      stroke: var(--theme-color-primary, #0ea5e9);
      stroke-width: 5;
    }
    .rubber {
      fill: none;
      stroke: var(--theme-color-primary, #0ea5e9);
      stroke-width: 2;
      stroke-dasharray: 6 5;
      pointer-events: none;
    }
    .marquee {
      fill: color-mix(in srgb, var(--theme-color-primary, #0ea5e9) 10%, transparent);
      stroke: var(--theme-color-primary, #0ea5e9);
      stroke-width: 1.5;
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
    /* symbols */
    .sym {
      color: var(--theme-color-std-text);
    }
    .sym.live {
      color: var(--theme-color-success, #2fd44f);
    }
    .sym .hit {
      fill: transparent;
    }
    .editing .sym .hit {
      cursor: move;
    }
    .halo {
      fill: color-mix(in srgb, var(--theme-color-primary, #0ea5e9) 16%, transparent);
      stroke: var(--theme-color-primary, #0ea5e9);
      stroke-width: 1.5;
    }
    .alarm-frame {
      fill: none;
      stroke-width: 5;
      pointer-events: none;
      animation: am-alarm-pulse 1s ease-in-out infinite;
    }
    @keyframes am-alarm-pulse {
      50% {
        opacity: 0.2;
      }
    }
    .label {
      fill: var(--theme-color-soft-text);
      font-size: 15px;
      font-family: var(--theme-font-family, sans-serif);
      pointer-events: none;
    }
    .label.editing {
      pointer-events: auto;
      cursor: move;
    }
    /* ports */
    .port {
      fill: color-mix(in srgb, var(--theme-color-primary, #0ea5e9) 25%, transparent);
      stroke: var(--theme-color-primary, #0ea5e9);
      stroke-width: 1.5;
      cursor: crosshair;
    }
    .port:hover,
    .port.active {
      fill: var(--theme-color-primary, #0ea5e9);
    }
    /* measurements */
    .meas-text {
      fill: var(--theme-color-std-text);
      font-size: 16px;
      font-family: var(--theme-font-family, monospace);
      dominant-baseline: middle;
    }
    .meas-bg {
      fill: color-mix(in srgb, var(--theme-color-2) 85%, transparent);
      stroke: var(--theme-color-soft-bdr);
      stroke-width: 1;
    }
    .editing .meas {
      cursor: move;
    }
    .meas.selected .meas-bg {
      stroke: var(--theme-color-primary, #0ea5e9);
      stroke-width: 2;
    }
    /* overlays */
    .empty {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--theme-color-soft-text);
      pointer-events: none;
      text-align: center;
      padding: 1rem;
    }
    .wire-hint {
      position: absolute;
      left: 50%;
      bottom: 0.75rem;
      transform: translateX(-50%);
      padding: 0.35rem 0.7rem;
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-primary, #0ea5e9);
      color: var(--theme-color-std-text);
      font-size: 0.82rem;
      pointer-events: none;
    }
  `;
}
