// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The badge login page — the login provider of wui-auth-badge, shown by the
 * shell's login extension (`#/login?login=auth-badge`, or a station opened
 * with `/?login=auth-badge`).
 *
 * The reader is captured while this page is shown (badge-reader.ts, the
 * capture "Badges" uses too): an invisible field that keeps the focus, only a
 * reader's frame kept. The badge → user resolution, the lock after
 * unknown badges and the audit are the server's (/api/auth-badge/login): the
 * badge numbers never reach the browser.
 *
 * The badge login turned off on the "Badges" page (`/config`'s `enabled`, or a
 * login answered `disabled`): the page says so; the password form stays.
 *
 * Test mode, `login-test=1` (`/?login=auth-badge&login-test=1`): a button sends
 * the frame of a test badge, to try the whole login without a reader.
 */
import { LoginProviderElement, postJson } from '../login-provider.js';
import { html, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import { DEFAULT_BADGE_FRAME_OPTIONS, type BadgeFrameOptions } from '../badge-frame-detector.js';
import { fetchBadgeConfig, WuiAuthBadgeReader } from '../badge-reader.js';

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
  | { status: 'locked'; lockedUntil: number }
  | { status: 'disabled' };

type Phase = 'idle' | 'resolving' | 'welcome' | 'error' | 'locked' | 'disabled';

@customElement('wui-auth-badge-login')
export class WuiAuthBadgeLogin extends LoginProviderElement {
  static override styles = LoginProviderElement.styles;

  @state() private phase: Phase = 'idle';
  @state() private message = '';
  @state() private sessionReady = false;
  @state() private lockedUntil = 0;

  @state() private frameOptions: BadgeFrameOptions = DEFAULT_BADGE_FRAME_OPTIONS;

  @query('wui-auth-badge-reader') private readonly reader?: WuiAuthBadgeReader;

  private returnToIdleTimer?: ReturnType<typeof setTimeout>;

  override connectedCallback(): void {
    super.connectedCallback();
    void fetchBadgeConfig().then(({ enabled, ...options }) => {
      this.frameOptions = options;
      if (enabled === false) this.phase = 'disabled';
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.returnToIdleTimer);
  }

  private get testMode(): boolean {
    return this.params['login-test'] === '1';
  }

  protected override render(): unknown {
    const prompt = this.prompt();
    return this.renderFrame(
      'Connexion par badge',
      html`<wui-auth-badge-reader
          heading=${prompt.heading}
          .message=${prompt.message ?? ''}
          tone=${prompt.tone ?? ''}
          .options=${this.frameOptions}
          ?paused=${this.phase === 'resolving' || this.phase === 'welcome' || this.phase === 'disabled'}
          @badge-read=${(e: CustomEvent<string>) => void this.handleBadge(e.detail)}
        ></wui-auth-badge-reader>
        ${this.testMode
          ? html`<div>
              <ix-button variant="primary" data-testid="simulate-badge" @click=${() => this.reader?.simulate(TEST_BADGE)}>
                Mode test : présenter le badge ${TEST_BADGE}
              </ix-button>
            </div>`
          : nothing}`
    );
  }

  /** What the reader shows in the current phase. */
  private prompt(): { heading: string; message?: unknown; tone?: 'success' | 'error' } {
    switch (this.phase) {
      case 'resolving':
        return { heading: 'Lecture du badge…' };
      case 'welcome':
        return this.sessionReady
          ? { heading: `Bonjour ${this.message}`, message: 'Connexion réussie', tone: 'success' }
          : { heading: `Bonjour ${this.message}`, message: 'Ouverture de la session…' };
      case 'error':
        return { heading: 'Présentez votre badge', message: this.message, tone: 'error' };
      case 'disabled':
        return {
          heading: 'Connexion par badge désactivée',
          message: 'Connectez-vous par identifiant et mot de passe.',
          tone: 'error'
        };
      case 'locked':
        return {
          heading: 'Connexion par badge verrouillée',
          message: html`${this.message ? html`${this.message}<br />` : nothing} Réessayez après
            ${formatTime(this.lockedUntil)}, ou connectez-vous par identifiant et mot de passe.`,
          tone: 'error'
        };
      default:
        return { heading: 'Présentez votre badge' };
    }
  }

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
    if (result.status === 'disabled') {
      this.phase = 'disabled';
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
  }

  private showLocked(lockedUntil: number, message: string): void {
    this.phase = 'locked';
    this.lockedUntil = lockedUntil;
    this.message = message;
    this.returnToIdleTimer = setTimeout(() => this.returnToIdle(), Math.max(0, lockedUntil - Date.now()));
  }

  private returnToIdle(): void {
    this.phase = 'idle';
    this.message = '';
    this.reader?.reset();
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
