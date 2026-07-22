// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * 2D warehouse plan: each zone is a translucent rectangle with a reserved label
 * band, each location a cell filled by its occupancy (grey empty → green →
 * amber → red full · blue = occupied uncapped floor). Grid units are scaled by
 * {@link SCALE} into SVG user units so text renders crisply (sub-pixel font
 * sizes have erratic letter-spacing).
 *
 * Display mode: clicking a location emits `wui:select {locationId}`.
 * Edit mode (`editing`): drag a zone or location to move it (grid-snapped, the
 * ampère `getScreenCTM().inverse()` + global pointer-listener pattern), drag the
 * corner handle to resize. Commits emit `wui:layout {kind, id, x, y, w, h}`;
 * the page persists. A live preview offsets the dragged rect locally without
 * mutating the stored entities.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, svg, type PropertyValues, type SVGTemplateResult, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { MSG, localizeDir } from '../i18n.js';
import { locationFillColor, locationUnits, ZONE_LABEL_BAND } from '../model.js';
import type { StockCell, StorageLocation, Zone } from '../types.js';

const PAD = 1;
/** Grid-unit → SVG-user-unit factor (text at font-size ≥5 renders cleanly). */
const SCALE = 10;
/** Snap step in grid units while dragging. */
const SNAP = 0.5;
const MIN_ZONE = { w: 3, h: 3 };
const MIN_LOC = { w: 1, h: 1 };
const HANDLE = 0.8;

interface DragState {
  kind: 'zone' | 'location';
  mode: 'move' | 'resize';
  id: string;
  /** Pointer origin in grid units. */
  startX: number;
  startY: number;
  /** Entity rect at drag start (location rect is zone-relative). */
  rect: { x: number; y: number; w: number; h: number };
  /** Live-preview rect (grid units, same space as `rect`). */
  preview: { x: number; y: number; w: number; h: number };
  moved: boolean;
}

@customElement('wh-plan')
export class WhPlan extends LitElement {
  static override readonly styles = [IXCoreStyles, planStyles()];

  @property({ attribute: false }) zones: Zone[] = [];
  @property({ attribute: false }) locations: StorageLocation[] = [];
  @property({ attribute: false }) stock: StockCell[] = [];
  @property({ type: String }) selectedId = '';
  @property({ type: Boolean }) editing = false;

  @state() private drag: DragState | null = null;

  @query('svg') private svgEl?: SVGSVGElement;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.detachGlobal();
  }

  override render(): TemplateResult {
    const extent = this.extent();
    return html`
      <div class="canvas ${this.editing ? 'editing' : ''}">
        <svg viewBox="0 0 ${extent.w * SCALE} ${extent.h * SCALE}" preserveAspectRatio="xMidYMid meet">
          ${this.zones.map((z) => this.renderZoneRect(z))} ${this.locations.map((l) => this.renderLocation(l))}
          ${this.zones.map((z) => this.renderZoneLabel(z))} ${this.editing ? this.renderHandles() : svg``}
        </svg>
      </div>
      <div class="legend">
        <span class="lg-title">${localizeDir(MSG.plan.legend)}:</span>
        <span class="dot" style="--c:#64748b"></span>${localizeDir(MSG.plan.legEmpty)}
        <span class="dot" style="--c:#10b981"></span>${localizeDir(MSG.plan.legOk)}
        <span class="dot" style="--c:#f59e0b"></span>${localizeDir(MSG.plan.legHigh)}
        <span class="dot" style="--c:#ef4444"></span>${localizeDir(MSG.plan.legFull)}
        <span class="dot" style="--c:#3b82f6"></span>${localizeDir(MSG.plan.legUncapped)}
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('editing') && !this.editing) this.drag = null;
  }

  private readonly onGlobalMove = (e: PointerEvent): void => this.dragMove(e);
  private readonly onGlobalUp = (): void => this.dragEnd();

  // --- rendering -----------------------------------------------------------

  /** Effective (preview-aware) rect of a zone, in grid units. */
  private zoneRect(zone: Zone): { x: number; y: number; w: number; h: number } {
    const d = this.drag;
    if (d && d.kind === 'zone' && d.id === zone.id) return d.preview;
    return { x: zone.x, y: zone.y, w: zone.w, h: zone.h };
  }

  /** Effective (preview-aware) rect of a location, relative to its zone. */
  private locationRect(loc: StorageLocation): { x: number; y: number; w: number; h: number } {
    const d = this.drag;
    if (d && d.kind === 'location' && d.id === loc.id) return d.preview;
    return { x: loc.x, y: loc.y, w: loc.w, h: loc.h };
  }

  private renderZoneRect(zone: Zone): SVGTemplateResult {
    const r = this.zoneRect(zone);
    return svg`
      <rect class=${this.editing ? 'zone-rect draggable' : 'zone-rect'}
        x=${r.x * SCALE} y=${r.y * SCALE} width=${r.w * SCALE} height=${r.h * SCALE} rx="4"
        fill=${zone.color} fill-opacity="0.08" stroke=${zone.color} stroke-width="1.2"
        @pointerdown=${(e: PointerEvent) => this.dragStart(e, 'zone', zone.id, 'move')}></rect>`;
  }

  private renderZoneLabel(zone: Zone): SVGTemplateResult {
    const r = this.zoneRect(zone);
    return svg`
      <text class="zone-label" x=${(r.x + 0.4) * SCALE} y=${(r.y + ZONE_LABEL_BAND - 0.4) * SCALE} fill=${zone.color}>
        ${zone.code} · ${zone.name}
      </text>`;
  }

  private renderLocation(loc: StorageLocation): SVGTemplateResult {
    const zone = this.zones.find((z) => z.id === loc.zoneId);
    if (!zone) return svg``;
    const zr = this.zoneRect(zone);
    const lr = this.locationRect(loc);
    const gx = zr.x + lr.x;
    const gy = zr.y + lr.y;
    const units = locationUnits(this.stock, loc.id);
    const color = locationFillColor(units, loc.capacity);
    const selected = loc.id === this.selectedId;
    return svg`
      <g class=${this.editing ? 'loc draggable' : 'loc'}
         @click=${() => this.select(loc.id)}
         @pointerdown=${(e: PointerEvent) => this.dragStart(e, 'location', loc.id, 'move')}>
        <rect x=${gx * SCALE} y=${gy * SCALE} width=${lr.w * SCALE} height=${lr.h * SCALE} rx="2.5"
          fill=${color} fill-opacity=${units > 0 ? 0.85 : 0.22}
          stroke=${selected ? '#ffffff' : color} stroke-width=${selected ? 2.2 : 0.6}></rect>
        <text x=${(gx + lr.w / 2) * SCALE} y=${(gy + lr.h / 2 - 0.1) * SCALE} text-anchor="middle" class="loc-code">${loc.code}</text>
        <text x=${(gx + lr.w / 2) * SCALE} y=${(gy + lr.h / 2 + 0.85) * SCALE} text-anchor="middle" class="loc-units">${units}</text>
      </g>`;
  }

  /** SE resize handles for every zone and location (edit mode only). */
  private renderHandles(): SVGTemplateResult[] {
    const handles: SVGTemplateResult[] = [];
    for (const zone of this.zones) {
      const r = this.zoneRect(zone);
      handles.push(this.renderHandle('zone', zone.id, r.x + r.w, r.y + r.h));
    }
    for (const loc of this.locations) {
      const zone = this.zones.find((z) => z.id === loc.zoneId);
      if (!zone) continue;
      const zr = this.zoneRect(zone);
      const lr = this.locationRect(loc);
      handles.push(this.renderHandle('location', loc.id, zr.x + lr.x + lr.w, zr.y + lr.y + lr.h));
    }
    return handles;
  }

  private renderHandle(kind: 'zone' | 'location', id: string, gx: number, gy: number): SVGTemplateResult {
    const s = HANDLE * SCALE;
    return svg`
      <rect class="handle" x=${gx * SCALE - s} y=${gy * SCALE - s} width=${s} height=${s} rx="1.5"
        @pointerdown=${(e: PointerEvent) => this.dragStart(e, kind, id, 'resize')}></rect>`;
  }

  // --- edit interactions (ampère pattern) ------------------------------------

  /** Pointer position in grid units via the inverse screen CTM. */
  private toGrid(e: PointerEvent): { x: number; y: number } {
    const ctm = this.svgEl?.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    return { x: p.x / SCALE, y: p.y / SCALE };
  }

  private dragStart(e: PointerEvent, kind: 'zone' | 'location', id: string, mode: 'move' | 'resize'): void {
    if (!this.editing) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = this.startRect(kind, id);
    if (!rect) return;
    const start = this.toGrid(e);
    this.drag = { kind, mode, id, startX: start.x, startY: start.y, rect, preview: { ...rect }, moved: false };
    globalThis.addEventListener('pointermove', this.onGlobalMove);
    globalThis.addEventListener('pointerup', this.onGlobalUp);
  }

  private startRect(kind: 'zone' | 'location', id: string): { x: number; y: number; w: number; h: number } | undefined {
    if (kind === 'zone') {
      const zone = this.zones.find((z) => z.id === id);
      return zone ? { x: zone.x, y: zone.y, w: zone.w, h: zone.h } : undefined;
    }
    const loc = this.locations.find((l) => l.id === id);
    return loc ? { x: loc.x, y: loc.y, w: loc.w, h: loc.h } : undefined;
  }

  private dragMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    const p = this.toGrid(e);
    const dx = snap(p.x - d.startX);
    const dy = snap(p.y - d.startY);
    if (dx !== 0 || dy !== 0) d.moved = true;
    d.preview = d.mode === 'move' ? this.clampMove(d, dx, dy) : this.clampResize(d, dx, dy);
    this.drag = { ...d };
  }

  private clampMove(d: DragState, dx: number, dy: number): { x: number; y: number; w: number; h: number } {
    let x = d.rect.x + dx;
    let y = d.rect.y + dy;
    if (d.kind === 'zone') {
      x = Math.max(0, x);
      y = Math.max(0, y);
    } else {
      // Keep the location inside its zone rectangle.
      const loc = this.locations.find((l) => l.id === d.id);
      const zone = this.zones.find((z) => z.id === loc?.zoneId);
      if (zone) {
        x = clamp(x, 0, Math.max(0, zone.w - d.rect.w));
        y = clamp(y, ZONE_LABEL_BAND, Math.max(ZONE_LABEL_BAND, zone.h - d.rect.h));
      }
    }
    return { x, y, w: d.rect.w, h: d.rect.h };
  }

  private clampResize(d: DragState, dx: number, dy: number): { x: number; y: number; w: number; h: number } {
    const min = d.kind === 'zone' ? MIN_ZONE : MIN_LOC;
    let w = Math.max(min.w, d.rect.w + dx);
    let h = Math.max(min.h, d.rect.h + dy);
    if (d.kind === 'location') {
      const loc = this.locations.find((l) => l.id === d.id);
      const zone = this.zones.find((z) => z.id === loc?.zoneId);
      if (zone) {
        w = Math.min(w, zone.w - d.rect.x);
        h = Math.min(h, zone.h - d.rect.y);
      }
    }
    return { x: d.rect.x, y: d.rect.y, w, h };
  }

  private dragEnd(): void {
    const d = this.drag;
    this.drag = null;
    this.detachGlobal();
    if (!d?.moved) return;
    this.dispatchEvent(
      new CustomEvent('wui:layout', {
        detail: { kind: d.kind, id: d.id, ...d.preview },
        bubbles: true,
        composed: true
      })
    );
  }

  private detachGlobal(): void {
    globalThis.removeEventListener('pointermove', this.onGlobalMove);
    globalThis.removeEventListener('pointerup', this.onGlobalUp);
  }

  private select(locationId: string): void {
    if (this.drag?.moved) return;
    this.dispatchEvent(new CustomEvent('wui:select', { detail: { locationId }, bubbles: true, composed: true }));
  }

  /** Bounding grid extent (max zone corner) plus a padding margin. */
  private extent(): { w: number; h: number } {
    let w = 10;
    let h = 8;
    for (const z of this.zones) {
      const r = this.zoneRect(z);
      w = Math.max(w, r.x + r.w);
      h = Math.max(h, r.y + r.h);
    }
    return { w: w + PAD, h: h + PAD };
  }
}

function snap(v: number): number {
  return Math.round(v / SNAP) * SNAP;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function planStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .canvas {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .canvas.editing {
      outline: 1px dashed var(--theme-color-primary);
      outline-offset: -4px;
    }
    svg {
      width: 100%;
      height: 100%;
      max-height: 70vh;
    }
    .zone-label {
      font-size: 8px;
      font-weight: 600;
      paint-order: stroke;
      stroke: var(--theme-color-1, #000000);
      stroke-width: 2.5px;
      stroke-linejoin: round;
      pointer-events: none;
    }
    .loc {
      cursor: pointer;
    }
    .draggable {
      cursor: grab;
    }
    .loc-code {
      font-size: 6px;
      font-weight: 700;
      fill: #ffffff;
      pointer-events: none;
    }
    .loc-units {
      font-size: 5px;
      fill: rgba(255, 255, 255, 0.9);
      pointer-events: none;
    }
    .handle {
      fill: var(--theme-color-primary, #00b3d1);
      stroke: #ffffff;
      stroke-width: 0.8;
      cursor: nwse-resize;
    }
    .legend {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      padding: 0.5rem 0.25rem 0;
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .lg-title {
      font-weight: 600;
    }
    .dot {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      background: var(--c);
      margin-left: 0.5rem;
    }
  `;
}
