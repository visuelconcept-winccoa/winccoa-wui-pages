// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `<wui-vnc-viewer>` — the in-browser VNC viewer of one connection, by id.
 *
 * PUBLIC, for other modules: `import '@visuelconcept-winccoa/wui-remote-vnc/vnc-viewer.js'`
 * (this file, `src/vnc-viewer.ts`; the import path is stable). The host module
 * declares `remote-vnc` in `wuiPage.optional` and the package in its
 * `dependencies` — see docs/wui-remote-vnc/EMBEDDING.md. The Remote VNC page
 * itself uses this same element on `/remote-vnc/:connectionid`.
 *
 *   <wui-vnc-viewer connection-id="vnc-demo-hmi-ligne1" fill></wui-vnc-viewer>
 *
 * Attributes:
 *   connection-id  the connection to open (the only input: everything else —
 *                  name, endpoint label, session options — comes from
 *                  `GET /api/vnc/connection/:id`, never the password);
 *   fill           take the whole width AND height of the container;
 *   scale          `fit` (default: scale the remote screen to the element) or
 *                  `none` (native resolution, scrollbars);
 *   back           show a "Back" button (emits `wui:back`) — the page sets it,
 *                  an embedding host normally does not;
 *   label          optional plain text naming the remote screen (e.g.
 *                  `WC_SOUDAGE_1 · Écran poste`), set by the host and not
 *                  interpreted: shown as a small overlay in the stage's top-left
 *                  corner and used as the stage's accessible name. No label →
 *                  no overlay, no change;
 *   label-mode     `fullscreen` (default: the overlay shows only while the
 *                  viewer is full screen, when the host page's own context is
 *                  hidden) or `always`;
 *   hide-endpoint  do not show the connection's host:port (toolbar, connecting
 *                  card): for a host page whose operators need not see network
 *                  addresses (e.g. a workcenter tab). The module's page shows it.
 * Events (bubbling, composed):
 *   ended          `{ connectionId, reason, message }` when the session ends or
 *                  cannot start: reason `manual` | `clean` | `lost` | `auth` |
 *                  `forbidden` | `not-found` | `unavailable`. Not fired when the
 *                  host removes the element.
 *   wui:back       the Back button (with `back` only).
 *
 * States shown IN the element, without opening a session: no `connect` role
 * (live, via hasRole$ — a revocation closes an open session), connection not
 * found, relay unavailable (backend not deployed / not restarted, relay not
 * mounted). Then connecting / connected / reconnecting, with the connection's
 * own timeout and reconnect policy.
 *
 * Label overlay: it lives INSIDE the stage (the element that goes full screen),
 * never takes input (`pointer-events: none`, so clicks, keys and the noVNC
 * cursor go through), uses theme variables only, and dims after
 * LABEL_DIM_DELAY_MS — back to full opacity on pointer move / touch over the
 * stage. Full-screen state follows `fullscreenchange` on the document: the
 * viewer is full screen when its stage (or anything in its shadow root) is, or
 * when one of its composed ancestors is. The viewer is often nested in several
 * shadow roots (a host page inside the shell), where `document.fullscreenElement`
 * is retargeted to the outermost host: each root's own `fullscreenElement` is
 * read instead, walking up from the viewer (`fullscreenCovers`).
 * The overlay is `aria-hidden`; the stage carries the label as `aria-label`
 * (role `group`), so the name is announced once.
 *
 * Lifecycle: the session opens on connectedCallback and closes on
 * disconnectedCallback. Keep the element mounted only while it is visible —
 * each session holds a WebSocket, and a browser opens only 6 HTTP/1.1
 * connections per server.
 *
 * Session security: the element asks `POST /api/vnc/session` (role `connect`)
 * for a one-shot ticket and opens `/api/vnc/ws?id=&ticket=`; the relay checks
 * the ticket and the role again, resolves the id server-side and answers the
 * VNC authentication itself — noVNC is offered security type None and never
 * sees the password (backend/vncRelay.ts, backend/rfbBroker.ts).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import RFB from '@novnc/novnc/core/rfb.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$ } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { vncCall } from './remote-vnc/data/api.js';
import { MSG, authFailureMsg, giveUpMsg, localize, localizeDir, reconnectMsg } from './remote-vnc/i18n.js';
import {
  DEFAULT_CONNECT_TIMEOUT_SEC,
  DEFAULT_MAX_RECONNECT_ATTEMPTS,
  DEFAULT_RECONNECT_DELAY_SEC,
  endpoint,
  type VncConnection
} from './remote-vnc/types.js';

export const VNC_VIEWER_TAG = 'wui-vnc-viewer';
const MODULE_ID = 'remote-vnc';
const SEC_MS = 1000;
/** The label overlay dims after this long without pointer activity over the stage. */
export const LABEL_DIM_DELAY_MS = 3000;

/** What the element shows. */
export type VncViewerState =
  | 'idle'
  | 'checking'
  | 'forbidden'
  | 'not-found'
  | 'unavailable'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

/** Why a session ended (or never started). */
export type VncEndReason = 'manual' | 'clean' | 'lost' | 'auth' | 'forbidden' | 'not-found' | 'unavailable';

/** `detail` of the `ended` event. */
export interface VncViewerEndedDetail {
  connectionId: string;
  reason: VncEndReason;
  message: string;
}

const STATE_LABELS: Record<VncViewerState, MultiLangString> = {
  idle: MSG.viewer.statusIdle,
  checking: MSG.viewer.statusChecking,
  forbidden: MSG.viewer.statusError,
  'not-found': MSG.viewer.statusError,
  unavailable: MSG.viewer.statusError,
  connecting: MSG.viewer.statusConnecting,
  connected: MSG.viewer.statusConnected,
  reconnecting: MSG.viewer.statusReconnecting,
  disconnected: MSG.viewer.statusDisconnected,
  error: MSG.viewer.statusError
};

const STATE_COLORS: Record<VncViewerState, string> = {
  idle: 'var(--theme-color-soft-text)',
  checking: 'var(--theme-color-warning)',
  forbidden: 'var(--theme-color-alarm)',
  'not-found': 'var(--theme-color-alarm)',
  unavailable: 'var(--theme-color-alarm)',
  connecting: 'var(--theme-color-warning)',
  connected: 'var(--theme-color-success)',
  reconnecting: 'var(--theme-color-warning)',
  disconnected: 'var(--theme-color-soft-text)',
  error: 'var(--theme-color-alarm)'
};

/** States that block the element before any session (shown as a notice in the stage). */
const BLOCKED: Partial<Record<VncViewerState, MultiLangString>> = {
  forbidden: MSG.viewer.stateForbidden,
  'not-found': MSG.viewer.stateNotFound,
  unavailable: MSG.viewer.stateUnavailable
};

export class WuiVncViewer extends LitElement {
  static override readonly styles = [IXCoreStyles, viewerStyles()];

  /** The connection to open (`RemoteVnc_<id>`). */
  @property({ attribute: 'connection-id', reflect: true }) connectionId = '';
  /** Take the whole width and height of the container. */
  @property({ type: Boolean, reflect: true }) fill = false;
  /** `fit`: scale the remote screen to the element; `none`: native resolution. */
  @property() scale: 'fit' | 'none' = 'fit';
  /** Show a Back button (`wui:back`). */
  @property({ type: Boolean }) back = false;
  /** Plain text naming the remote screen: overlay + accessible name of the stage. */
  @property() label = '';
  /** `fullscreen`: overlay only while full screen; `always`: overlay all the time. */
  @property({ attribute: 'label-mode' }) labelMode: 'fullscreen' | 'always' = 'fullscreen';
  /** Hide the host:port of the connection (toolbar, connecting card). */
  @property({ type: Boolean, attribute: 'hide-endpoint' }) hideEndpoint = false;

  @state() private state: VncViewerState = 'idle';
  @state() private message = '';
  @state() private meta: VncConnection | null = null;
  @state() private isFullscreen = false;
  @state() private labelDim = false;

  @query('.screen') private screen!: HTMLElement;

  private rfb: RFB | null = null;
  private attempt = 0;
  private manualClose = false;
  private connectTimer = 0;
  private reconnectTimer = 0;
  /** Bumped on every (re)start / teardown: a stale async continuation sees it changed. */
  private generation = 0;
  private abort: AbortController | null = null;
  private canConnect = true;
  private roleSub = new Subscription();
  /** Whether the label overlay is currently rendered (drives the dim timer). */
  private labelShown = false;
  private dimTimer = 0;
  private readonly onFullscreenChange = (): void => {
    this.isFullscreen = this.inFullscreen();
  };
  /** Pointer move / touch over the stage, in the capture phase (noVNC stops its own events). */
  private readonly wakeListener = { handleEvent: (): void => this.wakeLabel(), capture: true, passive: true };

  /** The current state (for hosts and tests). */
  get viewerState(): VncViewerState {
    return this.state;
  }

  override render(): TemplateResult {
    const meta = this.meta;
    const busy = this.state === 'connected' || this.state === 'connecting' || this.state === 'reconnecting';
    const blocked = BLOCKED[this.state];
    return html`
      <div class="toolbar">
        ${this.back
          ? html`<ix-button variant="secondary" @click=${this.goBack}>${localizeDir(MSG.viewer.back)}</ix-button>`
          : nothing}
        <span class="title">${meta?.name ?? this.connectionId}</span>
        ${meta && !this.hideEndpoint ? html`<span class="endpoint mono">${endpoint(meta)}</span>` : nothing}
        <span class="status" style="--c:${STATE_COLORS[this.state]}">
          <span class="dot"></span>${localizeDir(STATE_LABELS[this.state])}${meta?.viewOnly
            ? localizeDir(MSG.viewer.viewOnlySuffix)
            : ''}
        </span>
        <span class="grow"></span>
        <ix-button
          variant="secondary"
          ?disabled=${this.state !== 'connected' || Boolean(meta?.viewOnly)}
          @click=${this.sendCad}
        >
          ${localizeDir(MSG.viewer.ctrlAltDel)}
        </ix-button>
        <ix-button variant="secondary" ?disabled=${!busy} @click=${this.fullscreen}>
          <ix-icon name="maximize" slot="icon"></ix-icon>${localizeDir(MSG.viewer.fullscreen)}
        </ix-button>
        ${this.renderSessionButton(busy)}
      </div>

      ${this.message && !blocked
        ? html`<div class="notice ${this.state === 'error' ? 'error' : ''}">
            <ix-icon name=${this.state === 'error' ? 'warning' : 'info'}></ix-icon>${this.message}
          </div>`
        : nothing}

      <div
        class="stage"
        role=${this.label ? 'group' : nothing}
        aria-label=${this.label || nothing}
        @pointermove=${this.wakeListener}
        @touchstart=${this.wakeListener}
      >
        <div class="screen"></div>
        ${blocked ? this.renderBlocked(blocked) : nothing}
        ${this.state === 'checking' || this.state === 'connecting' || this.state === 'reconnecting'
          ? html`<div class="overlay">
              <div class="connecting">
                <ix-spinner></ix-spinner>
                <div class="c-status">${localizeDir(STATE_LABELS[this.state])}</div>
                ${meta ? html`<div class="c-target">${meta.name}${this.hideEndpoint ? nothing : html` · <span class="mono">${endpoint(meta)}</span>`}</div>` : nothing}
                ${this.message ? html`<div class="c-hint">${this.message}</div>` : nothing}
              </div>
            </div>`
          : nothing}
        ${this.labelShown
          ? html`<div class="label ${this.labelDim ? 'dim' : ''}" aria-hidden="true">${this.label}</div>`
          : nothing}
      </div>
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.isFullscreen = this.inFullscreen();
    this.roleSub = hasRole$(MODULE_ID, 'connect').subscribe((granted) => this.onRole(granted));
    void this.updateComplete.then(() => {
      if (this.isConnected) void this.start();
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.clearDimTimer();
    this.isFullscreen = false;
    this.stopAll();
    this.state = 'idle';
  }

  protected override willUpdate(_changed: PropertyValues): void {
    // Show / hide the label overlay; (re)arm the dim timer when it appears.
    const show = Boolean(this.label) && (this.labelMode === 'always' || this.isFullscreen);
    if (show === this.labelShown) return;
    this.labelShown = show;
    if (show) {
      this.labelDim = false;
      this.armDimTimer();
    } else {
      this.clearDimTimer();
    }
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('connectionId') && changed.get('connectionId') !== undefined && this.isConnected) {
      // After this update: start() resets reactive state.
      void this.updateComplete.then(() => this.start());
    }
    if (changed.has('scale') && this.rfb) this.rfb.scaleViewport = this.scale !== 'none';
  }

  // --- label overlay ------------------------------------------------------------

  private inFullscreen(): boolean {
    return fullscreenCovers(this);
  }

  private wakeLabel(): void {
    if (!this.labelShown) return;
    this.labelDim = false;
    this.armDimTimer();
  }

  private armDimTimer(): void {
    this.clearDimTimer();
    this.dimTimer = window.setTimeout(() => {
      this.dimTimer = 0;
      this.labelDim = true;
    }, LABEL_DIM_DELAY_MS);
  }

  private clearDimTimer(): void {
    if (this.dimTimer) {
      window.clearTimeout(this.dimTimer);
      this.dimTimer = 0;
    }
  }

  // --- states without a session ----------------------------------------------

  private renderBlocked(message: MultiLangString): TemplateResult {
    return html`<div class="blocked" role="status" data-state=${this.state}>
      <ix-icon name=${this.state === 'unavailable' ? 'warning' : 'info'}></ix-icon>
      <ix-typography>${localizeDir(this.connectionId ? message : MSG.viewer.noConnectionId)}</ix-typography>
      ${this.state === 'unavailable'
        ? html`<ix-button variant="secondary" @click=${() => void this.start()}>${localizeDir(MSG.viewer.retry)}</ix-button>`
        : nothing}
    </div>`;
  }

  private renderSessionButton(busy: boolean): TemplateResult | typeof nothing {
    if (busy) {
      return html`<ix-button variant="secondary" @click=${this.disconnect}>
        <ix-icon name="close" slot="icon"></ix-icon>${localizeDir(MSG.viewer.disconnect)}
      </ix-button>`;
    }
    if (this.state === 'disconnected' || this.state === 'error') {
      return html`<ix-button @click=${() => void this.start()}>
        <ix-icon name="play" slot="icon"></ix-icon>${localizeDir(MSG.viewer.reconnect)}
      </ix-button>`;
    }
    return nothing;
  }

  private onRole(granted: boolean): void {
    const was = this.canConnect;
    this.canConnect = granted;
    if (!granted && was && this.state !== 'idle') this.block('forbidden');
    else if (granted && !was && this.state === 'forbidden' && this.isConnected) void this.start();
  }

  /** Stop everything and show a blocking state; tells the host. */
  private block(kind: 'forbidden' | 'not-found' | 'unavailable', message = ''): void {
    this.stopAll();
    this.state = kind;
    this.message = message;
    this.end(kind, message);
  }

  // --- session lifecycle -------------------------------------------------------

  /** (Re)start from scratch: metadata, then a session. */
  private async start(): Promise<void> {
    this.stopAll();
    const gen = this.generation;
    this.attempt = 0;
    this.message = '';
    this.meta = null;
    if (!this.connectionId) {
      this.state = 'not-found';
      return;
    }
    if (!this.canConnect) {
      this.block('forbidden');
      return;
    }
    this.state = 'checking';
    this.abort = new AbortController();
    const out = await vncCall<{ connection: VncConnection }>(`/connection/${encodeURIComponent(this.connectionId)}`, {
      signal: this.abort.signal
    });
    if (gen !== this.generation) return;
    if (out.kind !== 'ok') {
      this.block(out.kind === 'forbidden' || out.kind === 'not-found' ? out.kind : 'unavailable', out.kind === 'unavailable' ? out.message : '');
      return;
    }
    this.meta = out.body.connection;
    await this.openSession(gen);
  }

  /** Ask a ticket, then open noVNC on the relay. */
  private async openSession(gen: number): Promise<void> {
    const meta = this.meta;
    if (!meta) return;
    this.manualClose = false;
    this.state = this.attempt > 0 ? 'reconnecting' : 'connecting';
    this.abort = new AbortController();
    const out = await vncCall<{ ticket: string }>('/session', {
      method: 'POST',
      body: { id: meta.id },
      signal: this.abort.signal
    });
    if (gen !== this.generation) return;
    if (out.kind === 'forbidden' || out.kind === 'not-found') {
      this.block(out.kind);
      return;
    }
    if (out.kind !== 'ok') {
      // A blip while reconnecting retries; at the first attempt the relay is unavailable.
      if (this.attempt > 0) this.scheduleReconnect(localize(MSG.viewer.connectFailed));
      else this.block('unavailable', out.kind === 'unavailable' ? out.message : '');
      return;
    }
    let rfb: RFB;
    try {
      rfb = new RFB(this.screen, this.wsUrl(meta.id, out.body.ticket), { shared: meta.shared });
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : localize(MSG.viewer.connectFailed));
      return;
    }
    rfb.viewOnly = meta.viewOnly;
    rfb.scaleViewport = this.scale !== 'none';
    rfb.background = '#000';
    this.attachHandlers(rfb);
    this.rfb = rfb;
    this.connectTimer = window.setTimeout(() => this.onConnectTimeout(rfb), this.timeoutMs());
  }

  private attachHandlers(rfb: RFB): void {
    rfb.addEventListener('connect', () => {
      if (this.rfb !== rfb) return;
      this.clearConnectTimer();
      this.attempt = 0;
      this.message = '';
      this.state = 'connected';
    });
    rfb.addEventListener('disconnect', (e: Event) => {
      if (this.rfb !== rfb) return; // stale rfb (we tore it down)
      this.clearConnectTimer();
      if (this.manualClose) {
        this.rfb = null;
        this.state = 'disconnected';
        this.end('manual', '');
        return;
      }
      // clean === true → normal server-side close; do not auto-reconnect.
      if ((e as CustomEvent<{ clean: boolean }>).detail?.clean) {
        this.rfb = null;
        this.state = 'disconnected';
        this.end('clean', '');
      } else {
        this.scheduleReconnect(localize(MSG.viewer.connectionLost));
      }
    });
    rfb.addEventListener('credentialsrequired', () => {
      // The relay answers the VNC authentication itself: the browser has no
      // password to give. Reaching this means a relay older than 0.2.
      if (this.rfb === rfb) this.authFailed('');
    });
    rfb.addEventListener('securityfailure', (e: Event) => {
      if (this.rfb !== rfb) return;
      // The reason the VNC server (or the relay) gave; a retry would not fix it.
      this.authFailed((e as CustomEvent<{ reason?: string }>).detail?.reason ?? '');
    });
  }

  private authFailed(reason: string): void {
    this.clearTimers();
    this.teardownRfb();
    this.state = 'error';
    this.message = authFailureMsg(reason);
    this.end('auth', this.message);
  }

  private onConnectTimeout(rfb: RFB): void {
    if (this.rfb !== rfb || this.state === 'connected') return;
    this.scheduleReconnect(localize(MSG.viewer.connectTimeout));
  }

  private scheduleReconnect(reason: string): void {
    this.clearTimers();
    this.teardownRfb();
    const max = this.maxAttempts();
    if (!this.autoReconnect() || (max > 0 && this.attempt >= max)) {
      this.state = 'error';
      const giveUp = this.autoReconnect() ? giveUpMsg(max) : '';
      this.message = `${reason}.${giveUp}`;
      this.end('lost', this.message);
      return;
    }
    this.attempt += 1;
    const total = max > 0 ? `/${max}` : '';
    const delaySec = Math.round(this.reconnectDelayMs() / SEC_MS);
    this.state = 'reconnecting';
    this.message = reconnectMsg(reason, this.attempt, total, delaySec);
    const gen = this.generation;
    this.reconnectTimer = window.setTimeout(() => void this.openSession(gen), this.reconnectDelayMs());
  }

  private disconnect(): void {
    this.manualClose = true;
    this.clearTimers();
    this.abort?.abort();
    if (this.rfb) {
      // noVNC answers with a `disconnect` event → state + `ended` (manual).
      try {
        this.rfb.disconnect();
      } catch {
        this.rfb = null;
      }
    }
    if (!this.rfb || this.state !== 'connected') {
      this.teardownRfb();
      this.state = 'disconnected';
      this.message = '';
      this.end('manual', '');
    }
  }

  /** Close the session and every pending step (no event). */
  private stopAll(): void {
    this.generation += 1;
    this.manualClose = true;
    this.abort?.abort();
    this.abort = null;
    this.clearTimers();
    this.teardownRfb();
  }

  private teardownRfb(): void {
    const rfb = this.rfb;
    this.rfb = null; // null first so its 'disconnect' event is treated as stale
    if (rfb) {
      try {
        rfb.disconnect();
      } catch {
        // already gone
      }
    }
  }

  private clearTimers(): void {
    this.clearConnectTimer();
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = 0;
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = 0;
    }
  }

  private end(reason: VncEndReason, message: string): void {
    this.dispatchEvent(
      new CustomEvent<VncViewerEndedDetail>('ended', {
        detail: { connectionId: this.connectionId, reason, message },
        bubbles: true,
        composed: true
      })
    );
  }

  // --- resolved parameters (defaults when unset) -----------------------------

  private timeoutMs(): number {
    return (this.meta?.connectTimeoutSec || DEFAULT_CONNECT_TIMEOUT_SEC) * SEC_MS;
  }

  private reconnectDelayMs(): number {
    return (this.meta?.reconnectDelaySec || DEFAULT_RECONNECT_DELAY_SEC) * SEC_MS;
  }

  private maxAttempts(): number {
    const m = this.meta?.maxReconnectAttempts;
    return typeof m === 'number' && Number.isFinite(m) && m >= 0 ? m : DEFAULT_MAX_RECONNECT_ATTEMPTS;
  }

  private autoReconnect(): boolean {
    return this.meta?.autoReconnect ?? true;
  }

  private wsUrl(id: string, ticket: string): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/api/vnc/ws?id=${encodeURIComponent(id)}&ticket=${encodeURIComponent(ticket)}`;
  }

  private sendCad(): void {
    this.rfb?.sendCtrlAltDel();
  }

  private fullscreen(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage');
    void stage?.requestFullscreen?.();
  }

  private goBack(): void {
    this.stopAll();
    this.dispatchEvent(new CustomEvent('wui:back', { bubbles: true, composed: true }));
  }
}

/** The full-screen element of a document or shadow root, retargeted to it (null when outside it). */
function fullscreenOf(root: Node): Element | null {
  return (root as Document | ShadowRoot).fullscreenElement ?? null;
}

/**
 * Is `el` shown in full screen: its own shadow tree (the stage) or a composed ancestor of `el` is the
 * full-screen element? Each root's `fullscreenElement` is retargeted to that root, so walking up from
 * `el`, the first root that reports one decides: it is an ancestor of the chain (or the chain element
 * itself), or something unrelated (another element in full screen). Works whatever the nesting of
 * shadow roots, where `document.fullscreenElement` only gives the outermost host.
 */
export function fullscreenCovers(el: Element): boolean {
  if (el.shadowRoot && fullscreenOf(el.shadowRoot)) return true;
  let node: Element | null = el;
  while (node) {
    const root = node.getRootNode();
    const fs = fullscreenOf(root);
    if (fs) return fs === node || fs.contains(node);
    node = root instanceof ShadowRoot ? root.host : null;
  }
  return false;
}

// Guarded: the page bundle and a host module's bundle may both import this file.
if (!customElements.get(VNC_VIEWER_TAG)) {
  customElements.define(VNC_VIEWER_TAG, WuiVncViewer);
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-vnc-viewer': WuiVncViewer;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function viewerStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      height: var(--wui-vnc-viewer-height, 100%);
    }
    :host([fill]) {
      width: 100%;
      height: 100%;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding-bottom: 0.5rem;
    }
    .title {
      font-weight: 600;
    }
    .endpoint {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.85rem;
      color: var(--c);
    }
    .status .dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      background: var(--c);
    }
    .grow {
      flex: 1;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      border: 1px solid var(--theme-color-warning);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-warning);
      background: color-mix(in srgb, var(--theme-color-warning) 12%, transparent);
    }
    .notice.error {
      border-color: var(--theme-color-alarm);
      color: var(--theme-color-alarm);
      background: color-mix(in srgb, var(--theme-color-alarm) 12%, transparent);
    }
    .stage {
      position: relative;
      flex: 1;
      min-height: 0;
      background: #000;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      overflow: hidden;
    }
    :host([fill]) .stage {
      border-radius: 0;
    }
    .screen {
      width: 100%;
      height: 100%;
      overflow: auto;
    }
    .overlay,
    .blocked {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .overlay {
      background: rgba(0, 0, 0, 0.35);
    }
    .blocked {
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      text-align: center;
      color: var(--theme-color-std-text);
      background: var(--theme-color-1);
    }
    .connecting {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.6rem;
      padding: 1.25rem 1.75rem;
      border-radius: var(--theme-default-border-radius);
      background: rgba(0, 0, 0, 0.55);
      color: #fff;
      text-align: center;
    }
    .c-status {
      font-size: 1.05rem;
      font-weight: 600;
    }
    .c-target {
      font-size: 0.85rem;
      opacity: 0.85;
    }
    .label {
      position: absolute;
      top: 0.5rem;
      left: 0.5rem;
      z-index: 1;
      max-width: calc(100% - 1rem);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      padding: 0.2rem 0.5rem;
      font-size: 0.8rem;
      color: var(--theme-color-std-text);
      background: color-mix(in srgb, var(--theme-color-1) 70%, transparent);
      border-radius: var(--theme-default-border-radius);
      pointer-events: none;
      user-select: none;
      opacity: 1;
      transition: opacity 0.6s ease;
    }
    .label.dim {
      opacity: 0.35;
    }
    .c-hint {
      font-size: 0.8rem;
      opacity: 0.75;
      max-width: 28rem;
    }
  `;
}
