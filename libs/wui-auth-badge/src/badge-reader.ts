// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The badge reader — the one component the login page, "Mon badge" and
 * "Badges" read a badge with: the prompt (a heading, a message below it) and
 * the capture. An RFID reader in keyboard emulation types into an invisible
 * field that keeps the focus while the element is in the page (back on any
 * blur or click) and never shows what is typed. Only a reader's frame is kept
 * (badge-frame-detector.ts): a number typed on the keyboard, even exact, is
 * ignored.
 *
 * The field is a text field, not a password one: a password field makes the
 * browser fill the text field before it with a saved login ("Badges"' filter).
 *
 * Fires `badge-read` (detail: the number) per frame; `paused` ignores the keys.
 * The frame's options are the server's (`fetchBadgeConfig`, GET /config).
 */
import { css, html, LitElement, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';
import { BadgeFrameDetector, BadgeFrameOptions, DEFAULT_BADGE_FRAME_OPTIONS } from './badge-frame-detector.js';

const API = '/api/auth-badge';

export type BadgeConfig = BadgeFrameOptions & {
  enabled?: boolean;
  /** The requesting station's badge login is locked (the blacklist); until `lockedUntil` (null: until unlocked). */
  locked?: boolean;
  lockedUntil?: number | null;
};

/** GET /config: the reader's frame, whether the badge login is on and the station locked — the defaults when it fails. */
export async function fetchBadgeConfig(): Promise<BadgeConfig> {
  const config = await fetch(`${API}/config`, { cache: 'no-store' })
    .then((res) => (res.ok ? (res.json() as Promise<Partial<BadgeConfig>>) : {}))
    .catch(() => ({}));
  return { ...DEFAULT_BADGE_FRAME_OPTIONS, ...config };
}

@customElement('wui-auth-badge-reader')
export class WuiAuthBadgeReader extends LitElement {
  static override styles = css`
    :host {
      position: relative;
      display: block;
    }
    .prompt {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-height: 6rem;
    }
    .message {
      min-height: 3rem;
    }
    .message.success {
      color: var(--theme-color-success);
    }
    .message.error {
      color: var(--theme-color-alarm);
    }
    /* Focusable, out of sight, never readable. */
    .capture {
      position: absolute;
      top: 0;
      left: 0;
      width: 1px;
      height: 1px;
      opacity: 0;
      border: 0;
      padding: 0;
      pointer-events: none;
    }
  `;

  @property() heading = 'Présentez votre badge';
  /** Below the heading: a text or a template. */
  @property({ attribute: false }) message: unknown = '';
  @property() tone: '' | 'success' | 'error' = '';
  @property({ attribute: false }) options: BadgeFrameOptions = DEFAULT_BADGE_FRAME_OPTIONS;
  /** The keys are ignored (a badge being resolved, the login off…). */
  @property({ type: Boolean }) paused = false;

  @query('.capture') private readonly captureInput?: HTMLInputElement;

  private detector = new BadgeFrameDetector();

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('click', this.restoreFocus);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener('click', this.restoreFocus);
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('options')) this.detector = new BadgeFrameDetector(this.options);
    if (changed.has('paused')) this.detector.reset();
  }

  protected override firstUpdated(): void {
    this.restoreFocus();
  }

  protected override render(): unknown {
    return html`<div class="prompt" role="status" aria-live="polite">
        <ix-typography format="h3">${this.heading}</ix-typography>
        <ix-typography class="message ${this.tone}">${this.message || html`&nbsp;`}</ix-typography>
      </div>
      <input
        class="capture"
        type="text"
        autocomplete="off"
        inputmode="none"
        spellcheck="false"
        data-lpignore="true"
        data-1p-ignore
        aria-label="Lecteur de badge"
        tabindex="-1"
        @keydown=${this.handleKeydown}
        @blur=${this.restoreFocus}
      />`;
  }

  /** Forgets the keys received so far. */
  reset(): void {
    this.detector.reset();
  }

  /** Test mode: the reader's frame of `uid` (prefix, number, end key) in one burst — the path of a real badge. */
  simulate(uid: string): void {
    const input = this.captureInput;
    if (!input) return;
    for (const key of [...`${this.options.prefix}${uid}`, this.options.endKey]) {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
    }
    this.restoreFocus();
  }

  private readonly restoreFocus = (): void => {
    // Deferred: the click or the blur ends first.
    setTimeout(() => this.isConnected && this.captureInput?.focus({ preventScroll: true }), 0);
  };

  private handleKeydown(event: KeyboardEvent): void {
    // Nothing typed is ever written in the field.
    event.preventDefault();
    if (this.paused) return;
    const uid = this.detector.push(event.key, event.timeStamp);
    if (uid) this.dispatchEvent(new CustomEvent<string>('badge-read', { detail: uid, bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-auth-badge-reader': WuiAuthBadgeReader;
  }
}
