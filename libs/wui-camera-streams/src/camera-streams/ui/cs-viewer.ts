// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-browser RTSP viewer for one camera, using the bundled JSMpeg player.
 *
 * JSMpeg opens a WebSocket to the dedicated `rtspProxy` manager
 * (`ws://<host>:<port>/api/rtsp/stream/<id>`), which resolves the id to the rtsp
 * URL server-side, pulls the stream once with ffmpeg, transcodes it to MPEG1-TS
 * and fans it out to every connected client. The browser never talks RTSP.
 *
 * Robustness: JSMpeg reconnects its WebSocket on its own (`reconnectInterval`,
 * driven by the camera's auto-reconnect settings). On top of that we track a
 * **liveness timeout** — if no video frame is decoded for a while the status
 * flips to "reconnecting" (and to "error" on the initial connect timeout) while
 * JSMpeg keeps retrying. `wui:back` returns to the list.
 *
 * Mixed-content caveat: the proxy serves plain `ws://`. Over an HTTPS dashboard
 * the browser blocks it — a notice is shown in that case.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import JSMpeg from '@cycjimmy/jsmpeg-player';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import {
  DEFAULT_RECONNECT_DELAY_SEC,
  streamHost,
  streamWsUrl,
  type CameraStream
} from '../types.js';

type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

const CONNECT_TIMEOUT_MS = 12_000;
/** No decoded frame for this long while connected → consider the feed stalled. */
const STALL_TIMEOUT_MS = 6000;
const STALL_CHECK_MS = 2000;
/** JSMpeg video decode buffer (1 MiB). */
const VIDEO_BUFFER_BYTES = 1_048_576;

const STATUS_LABELS: Record<Status, string> = {
  idle: 'Inactif',
  connecting: 'Connexion…',
  connected: 'En direct',
  reconnecting: 'Reconnexion…',
  disconnected: 'Arrêté',
  error: 'Erreur'
};

const STATUS_COLORS: Record<Status, string> = {
  idle: '#94a3b8',
  connecting: '#f59e0b',
  connected: '#10b981',
  reconnecting: '#f59e0b',
  disconnected: '#94a3b8',
  error: '#ef4444'
};

@customElement('cs-viewer')
export class CsViewer extends LitElement {
  static override readonly styles = [IXCoreStyles, viewerStyles()];

  @property({ attribute: false }) stream!: CameraStream;

  @state() private status: Status = 'idle';
  @state() private errorMsg = '';

  @query('.screen') private canvas!: HTMLCanvasElement;

  private player: JSMpeg.Player | null = null;
  private connectedId = '';
  private manualStop = false;
  private lastFrameAt = 0;
  private connectTimer = 0;
  private stallTimer = 0;

  override render(): TemplateResult {
    const c = this.stream;
    const busy = this.status === 'connected' || this.status === 'connecting' || this.status === 'reconnecting';
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" @click=${this.back}>‹ Retour</ix-button>
        <span class="title">${c.name}</span>
        <span class="endpoint mono">${streamHost(c)}</span>
        <span class="status" style="--c:${STATUS_COLORS[this.status]}">
          <span class="dot"></span>${STATUS_LABELS[this.status]}${c.audio ? ' · audio' : ''}
        </span>
        <span class="grow"></span>
        <ix-button variant="secondary" @click=${this.fullscreen}>
          <ix-icon name="maximize" slot="icon"></ix-icon>Plein écran
        </ix-button>
        ${busy
          ? html`<ix-button variant="secondary" @click=${this.stop}>
              <ix-icon name="close" slot="icon"></ix-icon>Arrêter
            </ix-button>`
          : html`<ix-button @click=${this.reconnect}>
              <ix-icon name="play" slot="icon"></ix-icon>Relancer
            </ix-button>`}
      </div>

      ${this.errorMsg
        ? html`<div class="notice ${this.status === 'error' ? 'error' : ''}">
            <ix-icon name=${this.status === 'error' ? 'warning' : 'info'}></ix-icon>${this.errorMsg}
          </div>`
        : null}

      <div class="stage">
        <canvas class="screen"></canvas>
        ${this.status === 'connecting' || this.status === 'reconnecting'
          ? html`<div class="overlay">
              <div class="connecting">
                <ix-spinner></ix-spinner>
                <div class="c-status">${STATUS_LABELS[this.status]}</div>
                <div class="c-target">${c.name} · <span class="mono">${streamHost(c)}</span></div>
                ${this.errorMsg ? html`<div class="c-hint">${this.errorMsg}</div>` : null}
              </div>
            </div>`
          : null}
      </div>
    `;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.manualStop = true;
    this.clearTimers();
    this.teardownPlayer();
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    this.connect();
  }

  protected override updated(changed: PropertyValues): void {
    // Switched to a different camera → reset and reconnect.
    if (changed.has('stream') && this.stream.id !== this.connectedId) {
      this.connect();
    }
  }

  // --- connection lifecycle --------------------------------------------------

  private connect(): void {
    this.clearTimers();
    this.teardownPlayer();
    const c = this.stream;
    if (!c?.url) {
      this.status = 'error';
      this.errorMsg = 'URL RTSP non renseignée.';
      return;
    }
    this.manualStop = false;
    this.errorMsg = '';
    this.status = 'connecting';
    this.connectedId = c.id;
    this.lastFrameAt = 0;
    const reconnectInterval = c.autoReconnect ? c.reconnectDelaySec || DEFAULT_RECONNECT_DELAY_SEC : 0;
    try {
      this.player = new JSMpeg.Player(streamWsUrl(c), {
        canvas: this.canvas,
        audio: c.audio,
        autoplay: true,
        videoBufferSize: VIDEO_BUFFER_BYTES,
        reconnectInterval,
        onVideoDecode: () => this.onFrame()
      });
    } catch (error) {
      this.status = 'error';
      this.errorMsg = error instanceof Error ? error.message : 'Échec de l’initialisation du lecteur.';
      return;
    }
    this.connectTimer = window.setTimeout(() => this.onConnectTimeout(), CONNECT_TIMEOUT_MS);
    this.stallTimer = window.setInterval(() => this.checkStall(), STALL_CHECK_MS);
  }

  /** Called by JSMpeg after each decoded frame — our liveness signal. */
  private onFrame(): void {
    this.lastFrameAt = Date.now();
    if (this.status !== 'connected') {
      this.clearConnectTimer();
      this.status = 'connected';
      this.errorMsg = '';
    }
  }

  private onConnectTimeout(): void {
    if (this.status === 'connected' || this.manualStop) return;
    this.status = 'error';
    const retry = this.stream.autoReconnect ? ' Nouvelle tentative en cours…' : '';
    this.errorMsg = `Aucun flux reçu (proxy RTSP injoignable, caméra hors ligne ou URL invalide).${retry}`;
  }

  private checkStall(): void {
    if (this.manualStop || this.lastFrameAt === 0) return;
    const idleMs = Date.now() - this.lastFrameAt;
    if (idleMs > STALL_TIMEOUT_MS && this.status === 'connected') {
      this.status = 'reconnecting';
      this.errorMsg = 'Flux interrompu — reconnexion…';
    }
  }

  private reconnect(): void {
    this.connect();
  }

  private stop(): void {
    this.manualStop = true;
    this.clearTimers();
    this.teardownPlayer();
    this.status = 'disconnected';
    this.errorMsg = '';
  }

  private teardownPlayer(): void {
    const player = this.player;
    this.player = null;
    if (player) {
      try {
        player.destroy();
      } catch {
        // already gone
      }
    }
  }

  private clearTimers(): void {
    this.clearConnectTimer();
    if (this.stallTimer) {
      window.clearInterval(this.stallTimer);
      this.stallTimer = 0;
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = 0;
    }
  }

  private fullscreen(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage');
    void stage?.requestFullscreen?.();
  }

  private back(): void {
    this.manualStop = true;
    this.clearTimers();
    this.teardownPlayer();
    this.dispatchEvent(new CustomEvent('wui:back', { bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function viewerStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
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
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .screen {
      max-width: 100%;
      max-height: 100%;
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.35);
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
    .c-hint {
      font-size: 0.8rem;
      opacity: 0.75;
      max-width: 28rem;
    }
  `;
}
