// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * In-browser VNC viewer for one connection, using the bundled noVNC client.
 *
 * noVNC's `RFB` speaks the RFB protocol over a WebSocket to the same-origin
 * relay `/api/vnc/ws?id=<connectionId>`, which resolves the id to host:port
 * server-side (the `VncProxy` MSA manager) and proxies the raw TCP stream. The
 * VNC password (when stored) is sent client-side by noVNC — the relay only
 * pipes bytes.
 *
 * Robustness: a **connection timeout** aborts a stalled connect, and an
 * **auto-reconnect** policy (configurable delay + max attempts per connection,
 * with sensible defaults) retries after an unexpected drop or a timeout. A
 * manual disconnect, an auth failure, or a clean server-side close stop the
 * retries. `wui:back` returns to the list.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import RFB from '@novnc/novnc/core/rfb.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import {
  DEFAULT_CONNECT_TIMEOUT_SEC,
  DEFAULT_MAX_RECONNECT_ATTEMPTS,
  DEFAULT_RECONNECT_DELAY_SEC,
  endpoint,
  type VncConnection
} from '../types.js';

type Status = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

const SEC_MS = 1000;

const STATUS_LABELS: Record<Status, string> = {
  idle: 'Inactif',
  connecting: 'Connexion…',
  connected: 'Connecté',
  reconnecting: 'Reconnexion…',
  disconnected: 'Déconnecté',
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

@customElement('rv-viewer')
export class RvViewer extends LitElement {
  static override readonly styles = [IXCoreStyles, viewerStyles()];

  @property({ attribute: false }) connection!: VncConnection;

  @state() private status: Status = 'idle';
  @state() private errorMsg = '';
  @state() private attempt = 0;

  @query('.screen') private screen!: HTMLElement;

  private rfb: RFB | null = null;
  private connectedId = '';
  private manualClose = false;
  private connectTimer = 0;
  private reconnectTimer = 0;

  override render(): TemplateResult {
    const c = this.connection;
    const connected = this.status === 'connected';
    const busy = connected || this.status === 'connecting' || this.status === 'reconnecting';
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" @click=${this.back}>‹ Retour</ix-button>
        <span class="title">${c.name}</span>
        <span class="endpoint mono">${endpoint(c)}</span>
        <span class="status" style="--c:${STATUS_COLORS[this.status]}">
          <span class="dot"></span>${STATUS_LABELS[this.status]}${c.viewOnly ? ' · lecture seule' : ''}
        </span>
        <span class="grow"></span>
        <ix-button variant="secondary" ?disabled=${!connected || c.viewOnly} @click=${this.sendCad}>
          Ctrl+Alt+Suppr
        </ix-button>
        <ix-button variant="secondary" @click=${this.fullscreen}>
          <ix-icon name="maximize" slot="icon"></ix-icon>Plein écran
        </ix-button>
        ${busy
          ? html`<ix-button variant="secondary" @click=${this.disconnect}>
              <ix-icon name="close" slot="icon"></ix-icon>Déconnecter
            </ix-button>`
          : html`<ix-button @click=${this.reconnect}>
              <ix-icon name="play" slot="icon"></ix-icon>Reconnecter
            </ix-button>`}
      </div>

      ${this.errorMsg
        ? html`<div class="notice ${this.status === 'error' ? 'error' : ''}">
            <ix-icon name=${this.status === 'error' ? 'warning' : 'info'}></ix-icon>${this.errorMsg}
          </div>`
        : null}

      <div class="stage">
        <div class="screen"></div>
        ${this.status === 'connecting' || this.status === 'reconnecting'
          ? html`<div class="overlay">
              <div class="connecting">
                <ix-spinner></ix-spinner>
                <div class="c-status">${STATUS_LABELS[this.status]}</div>
                <div class="c-target">${c.name} · <span class="mono">${endpoint(c)}</span></div>
                ${this.errorMsg ? html`<div class="c-hint">${this.errorMsg}</div>` : null}
              </div>
            </div>`
          : null}
      </div>
    `;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.manualClose = true;
    this.clearTimers();
    this.teardownRfb();
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    this.attempt = 0;
    this.connect();
  }

  protected override updated(changed: PropertyValues): void {
    // Switched to a different connection → reset and reconnect.
    if (changed.has('connection') && this.connection.id !== this.connectedId) {
      this.attempt = 0;
      this.connect();
    }
  }

  // --- connection lifecycle --------------------------------------------------

  private connect(): void {
    this.clearTimers();
    this.teardownRfb();
    const c = this.connection;
    if (!c?.host) {
      this.status = 'error';
      this.errorMsg = 'Hôte non renseigné.';
      return;
    }
    this.manualClose = false;
    this.errorMsg = '';
    this.status = this.attempt > 0 ? 'reconnecting' : 'connecting';
    this.connectedId = c.id;
    let rfb: RFB;
    try {
      rfb = new RFB(this.screen, this.wsUrl(c), {
        shared: c.shared,
        credentials: { password: c.password }
      });
    } catch (error) {
      this.scheduleReconnect(error instanceof Error ? error.message : 'Échec de la connexion');
      return;
    }
    rfb.viewOnly = c.viewOnly;
    rfb.scaleViewport = true;
    rfb.background = '#000';
    this.attachHandlers(rfb, c);
    this.rfb = rfb;
    this.connectTimer = window.setTimeout(() => this.onConnectTimeout(rfb), this.timeoutMs());
  }

  private attachHandlers(rfb: RFB, c: VncConnection): void {
    rfb.addEventListener('connect', () => {
      if (this.rfb !== rfb) return;
      this.clearConnectTimer();
      this.attempt = 0;
      this.errorMsg = '';
      this.status = 'connected';
    });
    rfb.addEventListener('disconnect', (e: Event) => {
      if (this.rfb !== rfb) return; // stale rfb (we tore it down)
      this.clearConnectTimer();
      if (this.manualClose) {
        this.status = 'disconnected';
        return;
      }
      // clean === true → normal server-side close; do not auto-reconnect.
      const clean = (e as CustomEvent<{ clean: boolean }>).detail?.clean;
      if (clean) this.status = 'disconnected';
      else this.scheduleReconnect('Connexion interrompue');
    });
    rfb.addEventListener('credentialsrequired', () => {
      if (this.rfb === rfb) rfb.sendCredentials({ password: c.password });
    });
    rfb.addEventListener('securityfailure', (e: Event) => {
      if (this.rfb !== rfb) return;
      // Auth won't fix itself on retry — stop and report.
      this.clearTimers();
      const reason = (e as CustomEvent<{ reason?: string }>).detail?.reason;
      const suffix = reason ? ` : ${reason}` : '';
      this.status = 'error';
      this.errorMsg = `Échec d'authentification VNC${suffix}.`;
    });
  }

  private onConnectTimeout(rfb: RFB): void {
    if (this.rfb !== rfb || this.status === 'connected') return;
    this.scheduleReconnect('Délai de connexion dépassé');
  }

  private scheduleReconnect(reason: string): void {
    this.clearTimers();
    this.teardownRfb();
    const max = this.maxAttempts();
    if (!this.autoReconnect() || (max > 0 && this.attempt >= max)) {
      this.status = 'error';
      const giveUp = this.autoReconnect() ? ` Reconnexion abandonnée après ${max} tentative(s).` : '';
      this.errorMsg = `${reason}.${giveUp}`;
      return;
    }
    this.attempt += 1;
    const total = max > 0 ? `/${max}` : '';
    const delaySec = Math.round(this.reconnectDelayMs() / SEC_MS);
    this.status = 'reconnecting';
    this.errorMsg = `${reason} — reconnexion ${this.attempt}${total} dans ${delaySec}s…`;
    this.reconnectTimer = window.setTimeout(() => this.connect(), this.reconnectDelayMs());
  }

  private reconnect(): void {
    this.attempt = 0;
    this.connect();
  }

  private disconnect(): void {
    this.manualClose = true;
    this.clearTimers();
    this.teardownRfb();
    this.status = 'disconnected';
    this.errorMsg = '';
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

  // --- resolved parameters (defaults when unset) -----------------------------

  private timeoutMs(): number {
    return (this.connection.connectTimeoutSec || DEFAULT_CONNECT_TIMEOUT_SEC) * SEC_MS;
  }

  private reconnectDelayMs(): number {
    return (this.connection.reconnectDelaySec || DEFAULT_RECONNECT_DELAY_SEC) * SEC_MS;
  }

  private maxAttempts(): number {
    const m = this.connection.maxReconnectAttempts;
    return Number.isFinite(m) && m >= 0 ? m : DEFAULT_MAX_RECONNECT_ATTEMPTS;
  }

  private autoReconnect(): boolean {
    return this.connection.autoReconnect ?? true;
  }

  private wsUrl(c: VncConnection): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/api/vnc/ws?id=${encodeURIComponent(c.id)}`;
  }

  private sendCad(): void {
    this.rfb?.sendCtrlAltDel();
  }

  private fullscreen(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage');
    void stage?.requestFullscreen?.();
  }

  private back(): void {
    this.manualClose = true;
    this.clearTimers();
    this.teardownRfb();
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
    }
    .screen {
      width: 100%;
      height: 100%;
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
