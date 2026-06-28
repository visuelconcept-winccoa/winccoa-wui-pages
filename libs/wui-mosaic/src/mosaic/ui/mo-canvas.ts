// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The mosaic canvas: renders every tile as an absolutely-positioned frame
 * holding an `<iframe>`, sized as a percentage of the canvas so the layout
 * survives canvas resizes.
 *
 * In **display** mode tiles are a read-only wall: each iframe only forwards
 * pointer/keyboard events when its tile is interactive (never for Remote-VNC —
 * see {@link isInteractive}); a thin header offers reload + fullscreen.
 *
 * In **edit** mode the header doubles as a drag handle and a bottom-right gripper
 * resizes the tile; both use pointer capture so dragging keeps working even when
 * the cursor passes over an iframe (iframes also get `pointer-events: none` while
 * a drag is in progress). Committed moves/resizes emit `wui:layout` with the full
 * updated tile list; the header buttons emit `wui:edit` / `wui:remove`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { GRID_PCT, MIN_TILE_H, MIN_TILE_W, isInteractive, snapToGrid, tileSrc, type Tile } from '../types.js';

type DragMode = 'move' | 'resize';

const FULL = 100;
const SECOND_MS = 1000;
/** Poll an embedded same-origin frame to style late-rendered (lazy shadow-DOM) content. */
const FRAME_POLL_MS = 200;
const FRAME_POLL_MAX = 25;
const CUSTOM_STYLES_HREF = '/data/dashboard-wc/customstyles.css';
const THEME_ATTR_PREFIX = 'data-ix';

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

@customElement('mo-canvas')
export class MoCanvas extends LitElement {
  static override readonly styles = [IXCoreStyles, canvasStyles()];

  @property({ attribute: false }) tiles: Tile[] = [];
  @property({ type: Boolean }) editing = false;

  /** Live layout while a drag/resize is in progress (null otherwise). */
  @state() private preview: Tile[] | null = null;

  private dragId: string | null = null;
  private dragMode: DragMode = 'move';
  private startPx = { x: 0, y: 0 };
  private startBox: Pick<Tile, 'x' | 'y' | 'w' | 'h'> = { x: 0, y: 0, w: 0, h: 0 };
  private canvasRect: DOMRect | null = null;
  private readonly timers = new Map<string, number>();
  /** Bounded polling timers used to style embedded same-origin frames. */
  private readonly frameTimers = new Set<number>();
  /** One constructable stylesheet per embedded document (its own realm). */
  private readonly frameSheets = new WeakMap<Document, CSSStyleSheet>();
  private themeObserver: MutationObserver | null = null;

  override render(): TemplateResult {
    const tiles = this.preview ?? this.tiles;
    const gridStyle = this.editing
      ? styleMap({ backgroundSize: `${GRID_PCT}% ${GRID_PCT}%` })
      : styleMap({});
    return html`
      <div class="canvas ${this.editing ? 'editing' : ''} ${this.dragId ? 'dragging' : ''}" style=${gridStyle}>
        ${tiles.length === 0
          ? html`<div class="empty">
              <ix-icon name="tiles" size="32"></ix-icon>
              <span>${this.editing ? 'Ajoutez une tuile pour composer la mosaïque.' : 'Mosaïque vide.'}</span>
            </div>`
          : nothing}
        ${repeat(
          tiles,
          (tile) => tile.id,
          (tile) => this.renderTile(tile)
        )}
      </div>
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Propagate the host app's theme (dark/light) into embedded frames when it changes.
    this.themeObserver = new MutationObserver(() => this.resyncFrameThemes());
    this.themeObserver.observe(document.documentElement, { attributes: true });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    for (const id of this.timers.keys()) this.clearTimer(id);
    for (const id of this.frameTimers) globalThis.clearInterval(id);
    this.frameTimers.clear();
    this.themeObserver?.disconnect();
    this.themeObserver = null;
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('tiles')) this.syncTimers();
  }

  // eslint-disable-next-line max-lines-per-function -- single tile template
  private renderTile(tile: Tile): TemplateResult {
    const pos = styleMap({
      left: `${tile.x}%`,
      top: `${tile.y}%`,
      width: `${tile.w}%`,
      height: `${tile.h}%`
    });
    const src = tileSrc(tile);
    const live = !this.editing && isInteractive(tile);
    return html`
      <div class="tile" data-id=${tile.id} style=${pos}>
        <div
          class="bar ${this.editing ? 'grab' : ''}"
          @pointerdown=${(e: PointerEvent) => this.onDown(e, tile, 'move')}
          @pointermove=${this.onMove}
          @pointerup=${this.onUp}
          @pointercancel=${this.onUp}
        >
          ${this.editing ? html`<ix-icon name="drag-gripper" size="16"></ix-icon>` : nothing}
          <span class="title" title=${tile.title}>${tile.title}</span>
          ${!live && !this.editing
            ? html`<ix-icon class="lock" name="lock" size="12" title="Lecture seule"></ix-icon>`
            : nothing}
          <span class="grow"></span>
          ${this.editing
            ? html`
                <ix-icon-button
                  ghost
                  size="16"
                  icon="pen"
                  title="Modifier"
                  @pointerdown=${(e: Event) => e.stopPropagation()}
                  @click=${() => this.emitEdit(tile.id)}
                ></ix-icon-button>
                <ix-icon-button
                  ghost
                  size="16"
                  icon="trashcan"
                  title="Supprimer"
                  @pointerdown=${(e: Event) => e.stopPropagation()}
                  @click=${() => this.emitRemove(tile.id)}
                ></ix-icon-button>
              `
            : html`
                <ix-icon-button
                  ghost
                  size="16"
                  icon="refresh"
                  title="Recharger"
                  @click=${() => this.reload(tile.id)}
                ></ix-icon-button>
                <ix-icon-button
                  ghost
                  size="16"
                  icon="full-screen"
                  title="Plein écran"
                  @click=${() => this.fullscreen(tile.id)}
                ></ix-icon-button>
              `}
        </div>
        <div class="frame">
          ${src
            ? html`<iframe
                src=${src}
                title=${tile.title}
                style="pointer-events:${this.editing || !live ? 'none' : 'auto'}"
                referrerpolicy="no-referrer"
                @load=${(e: Event) => this.onFrameLoad(e, tile)}
              ></iframe>`
            : html`<div class="missing">
                <ix-icon name="warning"></ix-icon>${tile.kind === 'url' && tile.url.trim() !== ''
                  ? 'URL externe refusée'
                  : 'Source non renseignée'}
              </div>`}
        </div>
        ${this.editing
          ? html`<div
              class="gripper"
              title="Redimensionner"
              @pointerdown=${(e: PointerEvent) => this.onDown(e, tile, 'resize')}
              @pointermove=${this.onMove}
              @pointerup=${this.onUp}
              @pointercancel=${this.onUp}
            ></div>`
          : nothing}
      </div>
    `;
  }

  // --- drag / resize ---------------------------------------------------------

  private onDown(e: PointerEvent, tile: Tile, mode: DragMode): void {
    if (!this.editing) return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = this.renderRoot.querySelector<HTMLElement>('.canvas');
    if (!canvas) return;
    this.canvasRect = canvas.getBoundingClientRect();
    this.dragId = tile.id;
    this.dragMode = mode;
    this.startPx = { x: e.clientX, y: e.clientY };
    this.startBox = { x: tile.x, y: tile.y, w: tile.w, h: tile.h };
    this.preview = this.tiles.map((t) => ({ ...t }));
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent): void {
    if (!this.dragId || !this.canvasRect) return;
    const dx = ((e.clientX - this.startPx.x) / this.canvasRect.width) * FULL;
    const dy = ((e.clientY - this.startPx.y) / this.canvasRect.height) * FULL;
    const box = this.computeBox(dx, dy);
    this.preview = (this.preview ?? this.tiles).map((t) => (t.id === this.dragId ? { ...t, ...box } : t));
  }

  private onUp(e: PointerEvent): void {
    if (!this.dragId) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // pointer already released
    }
    const committed = this.preview ?? this.tiles; // already snapped to the grid
    this.dragId = null;
    this.canvasRect = null;
    this.preview = null;
    this.dispatchEvent(new CustomEvent('wui:layout', { detail: { tiles: committed }, bubbles: true, composed: true }));
  }

  // Snap to the grid live (magnetic placement), then clamp inside the canvas.
  private computeBox(dx: number, dy: number): Pick<Tile, 'x' | 'y' | 'w' | 'h'> {
    const s = this.startBox;
    if (this.dragMode === 'move') {
      return {
        x: clamp(snapToGrid(s.x + dx), 0, FULL - s.w),
        y: clamp(snapToGrid(s.y + dy), 0, FULL - s.h),
        w: s.w,
        h: s.h
      };
    }
    return {
      x: s.x,
      y: s.y,
      w: clamp(snapToGrid(s.w + dx), MIN_TILE_W, FULL - s.x),
      h: clamp(snapToGrid(s.h + dy), MIN_TILE_H, FULL - s.y)
    };
  }

  // --- iframe reload / fullscreen --------------------------------------------

  private syncTimers(): void {
    for (const id of this.timers.keys()) this.clearTimer(id);
    for (const tile of this.tiles) {
      if (tile.refresh > 0) {
        const handle = globalThis.setInterval(() => this.reload(tile.id), tile.refresh * SECOND_MS);
        this.timers.set(tile.id, handle);
      }
    }
  }

  private clearTimer(id: string): void {
    const handle = this.timers.get(id);
    if (handle !== undefined) globalThis.clearInterval(handle);
    this.timers.delete(id);
  }

  private reload(id: string): void {
    const frame = this.renderRoot.querySelector<HTMLIFrameElement>(`.tile[data-id="${id}"] iframe`);
    if (frame) frame.src = frame.src; // eslint-disable-line no-self-assign -- forces a reload
  }

  private fullscreen(id: string): void {
    const tile = this.renderRoot.querySelector<HTMLElement>(`.tile[data-id="${id}"]`);
    void tile?.requestFullscreen?.();
  }

  private emitEdit(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true }));
  }

  private emitRemove(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:remove', { detail: { id }, bubbles: true, composed: true }));
  }

  // --- embedded same-origin frame styling (theme + chromeless page content) --
  //
  // The embedded views run the dashboard SPA in `?embed` (chromeless) mode, which
  // drops the app shell — and with it the theme controller and any page header.
  // From here (same origin) we propagate the host theme into the frame, hide the
  // page's own content-header ("page name"), and for read-only tiles hide the
  // page action toolbars. All purely page-side: no change to the WebUI runtime.
  // External (cross-origin) frames simply throw on access and are skipped.

  private onFrameLoad(event: Event, tile: Tile): void {
    const frame = event.currentTarget as HTMLIFrameElement;
    this.styleEmbeddedFrame(frame, !isInteractive(tile));
  }

  private styleEmbeddedFrame(frame: HTMLIFrameElement, readonly: boolean): void {
    if (this.applyFrameStyles(frame, readonly)) return; // cross-origin → nothing to do
    // The routed page (and its nested components) render asynchronously after
    // load, so re-apply for a few seconds to catch lazily-created shadow roots.
    let ticks = 0;
    const id = globalThis.setInterval(() => {
      ticks += 1;
      if (this.applyFrameStyles(frame, readonly) || ticks >= FRAME_POLL_MAX) {
        globalThis.clearInterval(id);
        this.frameTimers.delete(id);
      }
    }, FRAME_POLL_MS);
    this.frameTimers.add(id);
  }

  /** Apply theme + hide rules to a frame; returns true when the frame is cross-origin (stop). */
  private applyFrameStyles(frame: HTMLIFrameElement, readonly: boolean): boolean {
    let doc: Document | null;
    try {
      doc = frame.contentDocument;
    } catch {
      return true; // cross-origin
    }
    if (!doc?.defaultView) return false;
    try {
      this.syncTheme(doc);
      this.ensureCustomStyles(doc);
      this.injectHideStyles(doc, readonly);
    } catch {
      // page not ready yet — retried by the poll
    }
    return false;
  }

  private syncTheme(doc: Document): void {
    const src = document.documentElement;
    const dst = doc.documentElement;
    for (const attr of src.getAttributeNames()) {
      if (attr.startsWith(THEME_ATTR_PREFIX) && dst.getAttribute(attr) !== src.getAttribute(attr)) {
        dst.setAttribute(attr, src.getAttribute(attr) ?? '');
      }
    }
  }

  private ensureCustomStyles(doc: Document): void {
    if (doc.querySelector(`link[href="${CUSTOM_STYLES_HREF}"]`)) return;
    const link = doc.createElement('link');
    link.rel = 'stylesheet';
    link.href = CUSTOM_STYLES_HREF;
    doc.head.append(link);
  }

  private injectHideStyles(doc: Document, readonly: boolean): void {
    const win = doc.defaultView;
    if (!win) return;
    let sheet = this.frameSheets.get(doc);
    if (!sheet) {
      // Hide the embedded page's own chrome: the standard page header
      // (wui-content-header/wui-context-generator) AND a page-level top bar
      // (`.topbar` — e.g. the Machine-Fleet atelier bar, which holds the atelier
      // title AND its toolbar). The tile already shows the title in its own header,
      // so the in-page title/toolbar would be redundant. `.toolbar` is additionally
      // hidden for read-only tiles (standalone page toolbars not nested in a topbar).
      const css = `wui-content-header,wui-context-generator,.topbar{display:none!important}${
        readonly ? '.toolbar{display:none!important}' : ''
      }`;
      sheet = new win.CSSStyleSheet();
      sheet.replaceSync(css);
      this.frameSheets.set(doc, sheet);
    }
    this.adoptInto(doc, sheet);
  }

  /** Recursively adopt the sheet into a root and every (open) shadow root beneath it. */
  private adoptInto(root: Document | ShadowRoot, sheet: CSSStyleSheet): void {
    if (!root.adoptedStyleSheets.includes(sheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
    for (const el of root.querySelectorAll('*')) {
      const sub = el.shadowRoot;
      if (sub) this.adoptInto(sub, sheet);
    }
  }

  private resyncFrameThemes(): void {
    for (const frame of this.renderRoot.querySelectorAll('iframe')) {
      try {
        const doc = frame.contentDocument;
        if (doc?.defaultView) this.syncTheme(doc);
      } catch {
        // cross-origin frame — skip
      }
    }
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function canvasStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
    }
    .canvas {
      position: relative;
      height: 100%;
      width: 100%;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      overflow: hidden;
    }
    /* Snap grid — shown only while composing. Two 1px line gradients draw a very
       fine, faint grid whose lines fall on the snap lines (0, G, 2G…), flush at
       the layout edge. Spacing (background-size) is set inline from GRID_PCT. */
    .canvas.editing {
      --mo-grid: color-mix(in srgb, var(--theme-color-soft-text, #94a3b8) 15%, transparent);
      background-image: linear-gradient(to right, var(--mo-grid) 1px, transparent 1px),
        linear-gradient(to bottom, var(--mo-grid) 1px, transparent 1px);
    }
    .canvas.dragging {
      user-select: none;
    }
    .canvas.dragging iframe {
      pointer-events: none !important;
    }
    .empty {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--theme-color-soft-text);
    }
    .tile {
      position: absolute;
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
      overflow: hidden;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      padding: 0.2rem 0.4rem;
      background: var(--theme-color-3, var(--theme-color-1));
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      font-size: 0.82rem;
      color: var(--theme-color-std-text);
      flex: 0 0 auto;
    }
    .bar.grab {
      cursor: move;
      touch-action: none;
    }
    .bar .title {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
    }
    .bar .grow {
      flex: 1;
    }
    .bar .lock {
      color: var(--theme-color-soft-text);
    }
    .frame {
      position: relative;
      flex: 1;
      min-height: 0;
      background: #000;
    }
    iframe {
      width: 100%;
      height: 100%;
      border: 0;
      display: block;
    }
    .missing {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.4rem;
      color: var(--theme-color-warning);
      font-size: 0.85rem;
    }
    .gripper {
      position: absolute;
      right: 0;
      bottom: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      touch-action: none;
      background: linear-gradient(
        135deg,
        transparent 0 50%,
        var(--theme-color-primary, #0ea5e9) 50% 100%
      );
      border-bottom-right-radius: var(--theme-default-border-radius);
    }
  `;
}
