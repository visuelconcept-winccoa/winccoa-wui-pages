// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The base of a login provider's element — the contract of the shell's login
 * extension (wui-toolkit, `shell/login/`):
 *
 *   properties  logo, backgroundImage   the standard form's images
 *               redirect                the page to open after login
 *               dbrw                    a write token is requested
 *               params                  the login parameters (station's, route's)
 *               context                 what the site's modules pass on with the
 *                                       login — `item`: the audit line's item
 *   events      wui:login-token { token }   the shell opens the session
 *               wui:login-password          back to the standard form
 *
 * `renderFrame` lays the provider's content out as the standard form is: the
 * form on the left, the login screen image on the right.
 */
import { styles as loginFormStyles } from '@wincc-oa/wui-iam-feature/wui-login-form/wui-login-form.styles.js';
import { css, html, LitElement, TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';

export abstract class LoginProviderElement extends LitElement {
  static override styles = [
    loginFormStyles,
    css`
      .login-form {
        display: flex;
        flex-direction: column;
        gap: 1.5rem;
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
    `
  ];

  @property({ attribute: false }) logo = '';
  @property({ attribute: false }) backgroundImage = '';
  /** The page to open after login (`/msp?p=…`). */
  @property({ attribute: false }) redirect?: string;
  /** A write token is requested (`dbrw` in the address), as on the standard form. */
  @property({ attribute: false }) dbrw = false;
  /** The login parameters: the station's (`/?login-…`), then the login route's. */
  @property({ attribute: false }) params: Record<string, string> = {};
  /** What the site's modules pass on with the login (`item`: what it is about, for the audit line). */
  @property({ attribute: false }) context: Record<string, string> = {};

  /** The form on the left, the login screen on the right — as the standard form. */
  protected renderFrame(title: string, content: TemplateResult): TemplateResult {
    return html`
      <div class="login-container">
        <div class="login-form">
          <img alt="" class="logo-img" src=${this.logo} />
          <ix-typography format="h1">${title}</ix-typography>
          ${content}
          <div>
            <ix-button variant="secondary" data-testid="switch-to-password" @click=${this.backToPassword}>
              Identifiant / mot de passe
            </ix-button>
          </div>
        </div>
        <div class="login-screen" style="background-image:url(${this.backgroundImage})"></div>
      </div>
    `;
  }

  /** The user is recognised: the shell stores the token and opens the session. */
  protected openSession(token: string): void {
    this.dispatchEvent(new CustomEvent('wui:login-token', { detail: { token }, bubbles: true, composed: true }));
  }

  protected readonly backToPassword = (): void => {
    this.dispatchEvent(new CustomEvent('wui:login-password', { bubbles: true, composed: true }));
  };
}

/** `fetch` of a provider's backend, JSON in and out; throws on a network error or an HTTP error. */
export async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}
