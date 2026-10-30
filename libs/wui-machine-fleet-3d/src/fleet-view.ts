// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `<wui-fleet-3d-view>` — the 3D view of ONE atelier of Machine Fleet, by id,
 * display only.
 *
 * PUBLIC, for other modules: `import '@visuelconcept-winccoa/wui-machine-fleet-3d/fleet-view.js'`
 * (this file, `src/fleet-view.ts`; the import path is stable). The host module
 * declares `machine-fleet-3d` in `wuiPage.optional` (or `requires`) and the
 * package in its `dependencies` — see docs/wui-machine-fleet-3d/EMBEDDING.md.
 * Ateliers stay declared and edited ONLY in the Machine Fleet page; a host
 * stores an atelier id, nothing else.
 *
 *   <wui-fleet-3d-view atelier="demo" fill></wui-fleet-3d-view>
 *
 * Attributes:
 *   atelier       the atelier id (`MachineFleet3D_<id>`) — the only input;
 *                 changing it releases the scene and loads the new atelier;
 *   fill          take the whole width AND height of the container (else
 *                 `height: var(--wui-fleet-3d-view-height, 480px)`);
 *   hide-toolbar  hide the view's top bar (title, display toggles, machine list,
 *                 full screen);
 *   hide-nav      hide the navigation pad and the saved-viewpoint bar (the
 *                 mouse / touch camera stays).
 *
 * It renders the page's own `mf-atelier-view` (no second scene implementation)
 * in its display-only mode: camera navigation, live machine states, labels,
 * machine selection and its detail card, the machine list, saved viewpoints;
 * no edit, no atelier management, no AI prompt, no navigation away from the
 * host, nothing ever written.
 *
 * States shown IN the element, without building a scene: no atelier id, no
 * `view` role (client grant via hasRole$, live; and the 403 of the server-side
 * check where the atelier is read), atelier not found, data unavailable (with a
 * Retry button). The atelier comes from `GET /api/ai/fleet/ateliers/:id` (this
 * module's backend, `view` role) — the element reads no configuration
 * datapoint; the live values come over the shell's existing WebSocket
 * (one `dpConnect` block per view, see the view).
 *
 * Full screen: the toolbar's toggle puts THIS element full screen
 * (`requestFullscreen`), a host may call `el.requestFullscreen()` itself (e.g.
 * with `hide-toolbar`). The element is usually nested in several shadow roots
 * (a host page inside the shell), where `document.fullscreenElement` is
 * retargeted to the outermost host: the element reads its OWN root's
 * `fullscreenElement` (a Document or a ShadowRoot), which is the element itself
 * exactly when it — or something in its shadow tree — is full screen.
 *
 * Lifecycle: everything is created on connect and released on disconnect — the
 * request in flight is aborted, the view (WebGL renderer + context, observers,
 * live subscription, timers) is removed and disposes itself. Mount the element
 * only while it is visible (the active tab), one at a time: each one holds a
 * WebGL context on the GPU.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$ } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { fetchAtelier, type AtelierPayload } from './machine-fleet-3d/data/fleet-api.js';
import { FleetStore } from './machine-fleet-3d/data/fleet-store.js';
import { MSG, localizeDir } from './machine-fleet-3d/i18n.js';
import './machine-fleet-3d/ui/mf-atelier-view.js';

export { listAteliers, type AtelierSummary } from './machine-fleet-3d/data/fleet-api.js';

export const FLEET_VIEW_TAG = 'wui-fleet-3d-view';
const MODULE_ID = 'machine-fleet-3d';

/** What the element shows. */
export type FleetViewState = 'idle' | 'loading' | 'forbidden' | 'not-found' | 'unavailable' | 'ready';

const BLOCKED: Partial<Record<FleetViewState, MultiLangString>> = {
  forbidden: MSG.embed.forbidden,
  'not-found': MSG.embed.notFound,
  unavailable: MSG.embed.unavailable
};

/** The full-screen element of `el`'s own root (Document or ShadowRoot), retargeted to that root. */
function ownRootFullscreen(el: Element): Element | null {
  return (el.getRootNode() as Document | ShadowRoot).fullscreenElement ?? null;
}

export class WuiFleet3dView extends LitElement {
  static override readonly styles = [IXCoreStyles, fleetViewStyles()];

  /** The atelier to show (its id, `MachineFleet3D_<id>`). */
  @property({ reflect: true }) atelier = '';
  /** Take the whole width and height of the container. */
  @property({ type: Boolean, reflect: true }) fill = false;
  /** Hide the view's top bar. */
  @property({ type: Boolean, attribute: 'hide-toolbar' }) hideToolbar = false;
  /** Hide the navigation pad and the saved-viewpoint bar. */
  @property({ type: Boolean, attribute: 'hide-nav' }) hideNav = false;

  @state() private state: FleetViewState = 'idle';
  @state() private data: AtelierPayload | null = null;
  @state() private message = '';
  @state() private isFullscreen = false;

  /** Resolves `dp:` graphics references (GLB / billboard) with a read-only dpGet. */
  private store: FleetStore | null = null;
  private canView = true;
  private roleSub = new Subscription();
  /** Bumped on every (re)load / teardown: a stale async continuation sees it changed. */
  private generation = 0;
  private abort: AbortController | null = null;
  private readonly onFullscreenChange = (): void => {
    this.isFullscreen = ownRootFullscreen(this) === this;
  };

  /** The current state (for hosts and tests). */
  get viewState(): FleetViewState {
    return this.state;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.onFullscreenChange();
    // hasRole$ answers at once (open until assigned), then follows the grants live.
    this.roleSub = hasRole$(MODULE_ID, 'view').subscribe((granted) => this.onRole(granted));
    void this.load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.isFullscreen = false;
    this.stop();
    // The view leaves the DOM with this element and disposes its scene; drop it for good.
    this.data = null;
    this.state = 'idle';
  }

  override render(): TemplateResult {
    const data = this.data;
    if (this.state === 'ready' && data) {
      return html`<mf-atelier-view
        display-only
        fullscreen-button
        ?hide-toolbar=${this.hideToolbar}
        ?hide-nav=${this.hideNav}
        .fullscreenActive=${this.isFullscreen}
        .atelier=${data.atelier}
        .stopCauseCatalog=${data.stopCauses}
        .store=${this.store}
        .canEdit=${false}
        .roleAi=${false}
        @wui:fullscreen=${this.toggleFullscreen}
      ></mf-atelier-view>`;
    }
    const blocked = BLOCKED[this.state];
    if (blocked) return this.renderBlocked(blocked);
    return html`<div class="notice" role="status" data-state=${this.state}>
      <ix-spinner></ix-spinner>
      <ix-typography>${localizeDir(MSG.embed.loading)}</ix-typography>
    </div>`;
  }

  protected override willUpdate(changed: PropertyValues): void {
    // Another atelier: release the current view and load the new one (in this same update).
    if (changed.has('atelier') && changed.get('atelier') !== undefined && this.isConnected) void this.load();
  }

  private renderBlocked(message: MultiLangString): TemplateResult {
    const text = this.state === 'not-found' && !this.atelier ? MSG.embed.noAtelier : message;
    return html`<div class="notice" role="status" data-state=${this.state}>
      <ix-icon name=${this.state === 'unavailable' ? 'warning' : 'info'}></ix-icon>
      <ix-typography>${localizeDir(text)}</ix-typography>
      ${this.message ? html`<span class="detail">${this.message}</span>` : ''}
      ${this.state === 'unavailable'
        ? html`<ix-button variant="secondary" @click=${() => void this.load()}>${localizeDir(MSG.embed.retry)}</ix-button>`
        : ''}
    </div>`;
  }

  private onRole(granted: boolean): void {
    const was = this.canView;
    this.canView = granted;
    if (!granted && was) {
      // Revoked: the scene goes away with the view.
      this.stop();
      this.data = null;
      this.message = '';
      this.state = 'forbidden';
    } else if (granted && !was && this.state === 'forbidden' && this.isConnected) {
      void this.load();
    }
  }

  /** (Re)load the atelier from the backend, then show it. */
  private async load(): Promise<void> {
    this.stop();
    const gen = this.generation;
    this.data = null;
    this.message = '';
    if (!this.atelier) {
      this.state = 'not-found';
      return;
    }
    if (!this.canView) {
      this.state = 'forbidden';
      return;
    }
    this.state = 'loading';
    this.abort = new AbortController();
    const out = await fetchAtelier(this.atelier, this.abort.signal);
    if (gen !== this.generation) return;
    this.abort = null;
    if (out.kind !== 'ok') {
      this.state = out.kind;
      this.message = out.kind === 'unavailable' ? out.message : '';
      return;
    }
    this.store ??= new FleetStore();
    this.data = out.body;
    this.state = 'ready';
  }

  /** Abort what is pending; later continuations of it are ignored. */
  private stop(): void {
    this.generation += 1;
    this.abort?.abort();
    this.abort = null;
  }

  private readonly toggleFullscreen = (): void => {
    if (ownRootFullscreen(this) === this) {
      void document.exitFullscreen?.();
      return;
    }
    void this.requestFullscreen?.();
  };
}

// Guarded: the page bundle and a host module's bundle may both import this file.
if (!customElements.get(FLEET_VIEW_TAG)) {
  customElements.define(FLEET_VIEW_TAG, WuiFleet3dView);
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-fleet-3d-view': WuiFleet3dView;
  }
}

function fleetViewStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      position: relative;
      min-height: 0;
      height: var(--wui-fleet-3d-view-height, 480px);
    }
    :host([fill]) {
      width: 100%;
      height: 100%;
    }
    :host(:fullscreen) {
      width: 100%;
      height: 100%;
      background: var(--theme-color-1);
    }
    mf-atelier-view {
      height: 100%;
    }
    .notice {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      height: 100%;
      padding: 1rem;
      box-sizing: border-box;
      text-align: center;
      color: var(--theme-color-soft-text);
    }
    .detail {
      font-size: 0.8rem;
      opacity: 0.8;
    }
  `;
}
