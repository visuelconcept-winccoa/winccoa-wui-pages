// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The badge login page — the login provider of wui-auth-badge, shown by the
 * shell's login extension (`#/login?login=auth-badge`, or a station opened
 * with `/?login=auth-badge`).
 *
 * The only place the reader is captured: the capture field exists while this
 * page is shown. It is invisible, keeps the focus (back on any blur or click)
 * and never shows what is typed; only a reader's frame is kept
 * (badge-frame-detector.ts). The badge → user resolution, the lock after
 * unknown badges and the audit are the server's (/api/auth-badge/login): the
 * badge numbers never reach the browser.
 *
 * Test mode, `login-test=1` (`/?login=auth-badge&login-test=1`): a button sends
 * the frame of a test badge, to try the whole login without a reader.
 */
import { LoginProviderElement, postJson } from '../login-provider.js';
import { css, html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { BadgeFrameDetector, BadgeFrameOptions, DEFAULT_BADGE_FRAME_OPTIONS } from '../badge-frame-detector.js';

const API = '/api/auth-badge';
/** How long an error stays before the page is back at rest (ms). */
const ERROR_DISPLAY_MS = 4000;
/** How long the user's name and the success stay before the session opens (ms). */
const WELCOME_DISPLAY_MS = 3000;
/** The number the test mode's button presents. */
const TEST_BADGE = '12345678';

type LoginResult =
  | { status: 'ok'; username: string; fullName?: string; token: string }
  | { status: 'unknown' }
  | { status: 'locked'; lockedUntil: number };

type Phase = 'idle' | 'resolving' | 'welcome' | 'error' | 'locked';

@customElement('wui-auth-badge-login')
export class WuiAuthBadgeLogin extends LoginProviderElement {
  static override styles = [
    ...LoginProviderElement.styles,
    // The capture field: focusable, out of sight, never readable.
    css`
      .capture {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        border: 0;
        padding: 0;
        pointer-events: none;
      }
    `
  ];

  @state() private phase: Phase = 'idle';
  @state() private message = '';
  @state() private sessionReady = false;
  @state() private lockedUntil = 0;

  @query('.capture') private readonly captureInput?: HTMLInputElement;

  private frameOptions: BadgeFrameOptions = DEFAULT_BADGE_FRAME_OPTIONS;
  private detector = new BadgeFrameDetector();
  private returnToIdleTimer?: ReturnType<typeof setTimeout>;

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('click', this.restoreFocus);
    void fetch(`${API}/config`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<Partial<BadgeFrameOptions>>) : {}))
      .catch(() => ({}))
      .then((options) => {
        this.frameOptions = { ...DEFAULT_BADGE_FRAME_OPTIONS, ...options };
        this.detector = new BadgeFrameDetector(this.frameOptions);
      });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('click', this.restoreFocus);
    clearTimeout(this.returnToIdleTimer);
  }

  protected override firstUpdated(): void {
    this.restoreFocus();
  }

  private get testMode(): boolean {
    return this.params['login-test'] === '1';
  }

  protected override render(): unknown {
    return this.renderFrame(
      'Connexion par badge',
      html`<div class="prompt" role="status" aria-live="polite">${this.renderState()}</div>
        <input
          class="capture"
          type="password"
          autocomplete="off"
          aria-label="Lecteur de badge"
          tabindex="-1"
          @keydown=${this.handleKeydown}
          @blur=${this.restoreFocus}
        />
        ${this.testMode
          ? html`<div>
              <ix-button variant="primary" data-testid="simulate-badge" @click=${this.simulateBadge}>
                Mode test : présenter le badge ${TEST_BADGE}
              </ix-button>
            </div>`
          : nothing}`
    );
  }

  private renderState(): unknown {
    switch (this.phase) {
      case 'resolving':
        return html`<ix-typography format="h3">Lecture du badge…</ix-typography>`;
      case 'welcome':
        return html`<ix-typography format="h3">Bonjour ${this.message}</ix-typography>
          ${this.sessionReady
            ? html`<ix-typography class="message success">Connexion réussie</ix-typography>`
            : html`<ix-typography>Ouverture de la session…</ix-typography>`}`;
      case 'error':
        return html`<ix-typography format="h3">Présentez votre badge</ix-typography>
          <ix-typography class="message error">${this.message}</ix-typography>`;
      case 'locked':
        return html`<ix-typography format="h3">Connexion par badge verrouillée</ix-typography>
          <ix-typography class="message error">
            ${this.message ? html`${this.message}<br />` : nothing} Réessayez après ${formatTime(this.lockedUntil)}, ou
            connectez-vous par identifiant et mot de passe.
          </ix-typography>`;
      default:
        return html`<ix-typography format="h3">Présentez votre badge</ix-typography>
          <ix-typography class="message">&nbsp;</ix-typography>`;
    }
  }

  private readonly restoreFocus = (): void => {
    // Deferred: the click or the blur ends first.
    setTimeout(() => this.captureInput?.focus({ preventScroll: true }), 0);
  };

  private handleKeydown(event: KeyboardEvent): void {
    // Nothing typed is ever written in the field.
    event.preventDefault();
    if (this.phase === 'resolving' || this.phase === 'welcome') return;
    const uid = this.detector.push(event.key, event.timeStamp);
    if (uid) void this.handleBadge(uid);
  }

  /** Test mode: the reader's frame (prefix, number, Enter) in one burst — the path of a real badge. */
  private readonly simulateBadge = (): void => {
    const input = this.captureInput;
    if (!input) return;
    for (const key of [...`${this.frameOptions.prefix}${TEST_BADGE}`, 'Enter']) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
    }
    this.restoreFocus();
  };

  private async handleBadge(uid: string): Promise<void> {
    clearTimeout(this.returnToIdleTimer);
    const wasLocked = this.phase === 'locked';
    this.phase = 'resolving';

    let result: LoginResult;
    try {
      result = await postJson<LoginResult>(`${API}/login`, { uid, dbrw: this.dbrw, item: this.context['item'] });
    } catch {
      this.showError('Service de connexion par badge indisponible.');
      return;
    }
    if (result.status === 'locked') {
      this.showLocked(result.lockedUntil, wasLocked ? 'Badge refusé : la mire est verrouillée.' : '');
      return;
    }
    if (result.status !== 'ok' || !result.token) {
      this.showError('Badge non reconnu');
      return;
    }

    this.phase = 'welcome';
    this.message = result.fullName || result.username;
    // The name and the success stay a moment before the session opens.
    this.sessionReady = true;
    await new Promise((resolve) => setTimeout(resolve, WELCOME_DISPLAY_MS));
    this.openSession(result.token);
  }

  private showError(message: string): void {
    this.phase = 'error';
    this.message = message;
    this.returnToIdleTimer = setTimeout(() => this.returnToIdle(), ERROR_DISPLAY_MS);
    this.restoreFocus();
  }

  private showLocked(lockedUntil: number, message: string): void {
    this.phase = 'locked';
    this.lockedUntil = lockedUntil;
    this.message = message;
    this.returnToIdleTimer = setTimeout(() => this.returnToIdle(), Math.max(0, lockedUntil - Date.now()));
    this.restoreFocus();
  }

  private returnToIdle(): void {
    this.phase = 'idle';
    this.message = '';
    this.detector.reset();
  }
}

function formatTime(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-auth-badge-login': WuiAuthBadgeLogin;
  }
}
