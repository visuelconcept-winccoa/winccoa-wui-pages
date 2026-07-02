// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Ampère drawing surface — a single `<svg>` (viewBox in canvas units,
 * CSS-scaled by `zoom`) rendering the network's wires, symbols and measurement
 * labels.
 *
 * **Display** mode is a read-only single-line view: every wire/symbol is tinted
 * green when energised (see {@link ../topology.ts}) and each switchgear blade is
 * drawn open/closed from its live position.
 *
 * **Edit** mode adds the ergonomics: with a *symbol* tool selected, clicking an
 * empty spot places it (`wui:place`); with the *select* tool, symbols and
 * measurements drag on a magnetic grid (`wui:move` / `wui:move-meas` on commit)
 * and click to select (`wui:select`); clicking a port (○) starts a wire and
 * clicking a second port completes it (`wui:connect`, Esc cancels). Delete/⌫
 * removes the current selection (`wui:delete`). Pointer capture keeps a drag
 * alive over other elements.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { SYMBOLS, type SymbolId } from '../symbols/catalog.js';
import { MSG, localizeDir } from '../i18n.js';
import type { EnergyState } from '../topology.js';
import {
  CANVAS_H,
  CANVAS_W,
  clamp,
  edgeEnds,
  measurementPos,
  nodeCenter,
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

/** What is currently selected on the canvas. */
export interface Selection {
  kind: 'node' | 'edge' | 'measurement';
  id: string;
}

/** Selection-changed event name (emitted with a {@link Selection} or `null` to clear). */
const WUI_SELECT = 'wui:select';

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
  @property({ attribute: false }) selection: Selection | null = null;

  /** Drag state (node or measurement being moved), with a live preview position. */
  @state() private preview: (Point & { id: string; kind: 'node' | 'meas' }) | null = null;
  /** First port picked while drawing a wire (null = not wiring). */
  @state() private wireFrom: PortRef | null = null;
  /** Live cursor position (canvas units) for the wire rubber-band. */
  @state() private cursor: Point | null = null;

  private dragMoved = false;
  private start: Point = { x: 0, y: 0 };
  private origin: Point = { x: 0, y: 0 };

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.addEventListener('keydown', this.onKey);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    globalThis.removeEventListener('keydown', this.onKey);
  }

  override render(): TemplateResult {
    // Apply the live drag preview to the dragged node so wires/labels follow it,
    // without mutating the stored network (committed only on pointer-up).
    const drag = this.preview?.kind === 'node' ? this.preview : null;
    const nodes = drag
      ? this.network.nodes.map((n) => (n.id === drag.id ? { ...n, x: drag.x, y: drag.y } : n))
      : this.network.nodes;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const w = CANVAS_W * this.zoom;
    const h = CANVAS_H * this.zoom;
    const empty = this.network.nodes.length === 0 && this.network.measurements.length === 0;
    return html`
      <div class="scroll">
        <svg
          class="canvas ${this.editing ? 'editing' : ''}"
          width=${w}
          height=${h}
          viewBox="0 0 ${CANVAS_W} ${CANVAS_H}"
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
        </svg>
      </div>
      ${empty
        ? html`<div class="empty">
            <ix-icon name="flash" size="32"></ix-icon>
            <span>${this.editing ? localizeDir(MSG.canvas.emptyEditing) : localizeDir(MSG.canvas.emptyDisplay)}</span>
          </div>`
        : nothing}
      ${this.editing && this.wireFrom ? html`<div class="wire-hint">${localizeDir(MSG.canvas.wireHint)}</div>` : nothing}
    `;
  }

  // --- rendering -------------------------------------------------------------

  private renderEdge(edge: { id: string; from: PortRef; to: PortRef }, byId: Map<string, Node>): SVGTemplateResult {
    const ends = edgeEnds(edge, byId);
    if (!ends) return svg``;
    const live = this.energy?.edge(edge.id) ?? false;
    const sel = this.selection?.kind === 'edge' && this.selection.id === edge.id;
    const cls = `wire ${live ? 'live' : ''} ${sel ? 'selected' : ''}`;
    return svg`<path
      class=${cls}
      d=${orthPath(ends[0], ends[1])}
      @pointerdown=${(e: PointerEvent) => this.onEdgeDown(e, edge.id)}
    ></path>`;
  }

  private renderNode(node: Node): SVGTemplateResult {
    const def = SYMBOLS[node.symbol];
    const cx = def.w / 2;
    const cy = def.h / 2;
    const live = this.energy?.node(node.id) ?? false;
    const sel = this.selection?.kind === 'node' && this.selection.id === node.id;
    const isClosed = this.closed.get(node.id) ?? true;
    const center = nodeCenter(node);
    return svg`
      <g class="sym ${live ? 'live' : ''} ${sel ? 'selected' : ''}">
        <g
          transform="translate(${node.x} ${node.y}) rotate(${node.rotation} ${cx} ${cy})"
          @pointerdown=${(e: PointerEvent) => this.onNodeDown(e, node)}
        >
          ${sel ? svg`<rect class="halo" x="-6" y="-6" width=${def.w + 12} height=${def.h + 12} rx="6" />` : nothing}
          <rect class="hit" x="0" y="0" width=${def.w} height=${def.h} />
          ${def.render({ closed: isClosed })}
        </g>
        ${node.label
          ? svg`<text class="label" x=${center.x} y=${node.y + def.h + 16} text-anchor="middle">${node.label}</text>`
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
    const base = this.preview && this.preview.kind === 'meas' && this.preview.id === m.id ? this.preview : measurementPos(m, byId);
    const sel = this.selection?.kind === 'measurement' && this.selection.id === m.id;
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
    // A symbol tool places on empty space; the select tool clears the selection.
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
    this.emit(WUI_SELECT, null);
  }

  private onCanvasMove(e: PointerEvent): void {
    if (this.editing && this.wireFrom) this.cursor = this.toUser(e);
  }

  private onNodeDown(e: PointerEvent, node: Node): void {
    if (!this.editing || this.tool !== 'select') return;
    e.stopPropagation();
    this.emit(WUI_SELECT, { kind: 'node', id: node.id });
    this.beginDrag(e, node.id, 'node', { x: node.x, y: node.y });
  }

  private onMeasDown(e: PointerEvent, m: Measurement): void {
    if (!this.editing || this.tool !== 'select') return;
    e.stopPropagation();
    this.emit(WUI_SELECT, { kind: 'measurement', id: m.id });
    this.beginDrag(e, m.id, 'meas', { x: m.x, y: m.y });
  }

  private onEdgeDown(e: PointerEvent, id: string): void {
    if (!this.editing || this.tool !== 'select') return;
    e.stopPropagation();
    this.emit(WUI_SELECT, { kind: 'edge', id });
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

  private beginDrag(e: PointerEvent, id: string, kind: 'node' | 'meas', origin: Point): void {
    this.dragMoved = false;
    this.start = this.toUser(e);
    this.origin = origin;
    this.preview = { id, kind, x: origin.x, y: origin.y };
    const move = (ev: PointerEvent): void => this.onDragMove(ev, id, kind);
    const up = (ev: PointerEvent): void => {
      globalThis.removeEventListener('pointermove', move);
      globalThis.removeEventListener('pointerup', up);
      this.onDragUp(id, kind);
      void ev;
    };
    globalThis.addEventListener('pointermove', move);
    globalThis.addEventListener('pointerup', up);
  }

  private onDragMove(e: PointerEvent, id: string, kind: 'node' | 'meas'): void {
    const p = this.toUser(e);
    const nx = snap(this.origin.x + (p.x - this.start.x));
    const ny = snap(this.origin.y + (p.y - this.start.y));
    if (nx !== this.origin.x || ny !== this.origin.y) this.dragMoved = true;
    this.preview = {
      id,
      kind,
      x: kind === 'node' ? clamp(nx, 0, CANVAS_W) : nx,
      y: kind === 'node' ? clamp(ny, 0, CANVAS_H) : ny
    };
  }

  private onDragUp(id: string, kind: 'node' | 'meas'): void {
    const p = this.preview;
    this.preview = null;
    if (!p || !this.dragMoved) return;
    this.emit(kind === 'node' ? 'wui:move' : 'wui:move-meas', { id, x: p.x, y: p.y });
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (!this.editing) return;
    if (e.key === 'Escape' && this.wireFrom) {
      this.cancelWire();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection && !this.isTypingTarget(e)) {
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
    svg.canvas {
      display: block;
      --am-grid-color: color-mix(in srgb, var(--theme-color-soft-text, #94a3b8) 16%, transparent);
      color: var(--theme-color-std-text);
      touch-action: none;
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
    .label {
      fill: var(--theme-color-soft-text);
      font-size: 15px;
      font-family: var(--theme-font-family, sans-serif);
      pointer-events: none;
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
