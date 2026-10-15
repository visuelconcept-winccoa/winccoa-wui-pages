// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Mon badge" — the logged-in user associates their badge with their account
 * (the user setting RFID_UID the badge login resolves), or removes it. The
 * reader types the badge's number into the field like a keyboard, Enter
 * included; it may also be typed. The server takes the user from the session's
 * token, and refuses a number another user already has.
 *
 * When the "Badges" page's self-service is off (`selfEnrolment`), the page only
 * shows the user's badge: a user with the `enrol` role associates it.
 *
 * The page module also defines "Badges" (/auth-badge/admin, admin/badge-admin.ts).
 */
import './admin/badge-admin.js';
import { fetchAsUser } from './session.js';
import { registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, query, state } from 'lit/decorators.js';
import appSecurityRoles from './app-security.roles.json';

const API = '/api/auth-badge';

interface MyBadge {
  username: string;
  /** The last digits of the associated number, or null when there is none. */
  badge: string | null;
  /** The user may associate or remove their badge here (self-service, or the `enrol` role). */
  canChange: boolean;
}

@customElement('wui-auth-badge')
export class WuiAuthBadge extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 1.5rem;
      max-width: 40rem;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    input {
      font: inherit;
      padding: 0.5rem;
      min-width: 16rem;
    }
    .error {
      color: var(--theme-color-alarm);
    }
    .success {
      color: var(--theme-color-success);
    }
  `;

  @state() private me?: MyBadge;
  @state() private message = '';
  @state() private failed = false;
  @state() private enrolling = false;

  @query('input') private readonly field?: HTMLInputElement;

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    void this.load();
  }

  protected override render(): unknown {
    if (!this.me) {
      return html`<ix-typography format="h2">Mon badge</ix-typography>
        <p class=${this.failed ? 'error' : ''}>${this.message || 'Chargement…'}</p>`;
    }
    return html`<div class="card">
      <ix-typography format="h2">Mon badge</ix-typography>
      <p>
        ${this.me.badge
          ? html`Un badge est associé au compte <b>${this.me.username}</b> (numéro se terminant par
              <b>${this.me.badge}</b>).`
          : html`Aucun badge n'est associé au compte <b>${this.me.username}</b>.`}
      </p>
      ${!this.me.canChange
        ? html`<p>
            Pour associer ${this.me.badge ? 'un autre badge' : 'un badge'} à votre compte ou le retirer, demandez
            l'enrôlement à une personne habilitée.
          </p>`
        : this.enrolling
        ? html`<div class="row">
            <input
              type="password"
              autocomplete="off"
              placeholder="Présentez le badge au lecteur"
              aria-label="Numéro du badge"
              @keydown=${this.handleKey}
            />
            <ix-button variant="secondary" @click=${() => (this.enrolling = false)}>Annuler</ix-button>
          </div>`
        : html`<div class="row">
            <ix-button data-testid="enrol-badge" @click=${this.startEnrolment}>
              ${this.me.badge ? 'Associer un autre badge' : 'Associer un badge'}
            </ix-button>
            ${this.me.badge
              ? html`<ix-button variant="secondary" data-testid="forget-badge" @click=${this.forget}>Retirer le badge</ix-button>`
              : nothing}
          </div>`}
      <p class=${this.failed ? 'error' : 'success'}>${this.message}</p>
    </div>`;
  }

  private async load(): Promise<void> {
    try {
      this.me = await fetchAsUser<MyBadge>(`${API}/me`);
    } catch (error) {
      this.failed = true;
      this.message = `Service de connexion par badge indisponible (${String(error)}).`;
    }
  }

  private async startEnrolment(): Promise<void> {
    this.enrolling = true;
    this.message = '';
    await this.updateComplete;
    this.field?.focus();
  }

  private async handleKey(event: KeyboardEvent): Promise<void> {
    if (event.key !== 'Enter') return;
    const uid = (event.target as HTMLInputElement).value.trim();
    (event.target as HTMLInputElement).value = '';
    if (!uid) return;
    try {
      const result = await fetchAsUser<{ status: 'ok' | 'taken' | 'invalid' }>(`${API}/me`, {
        method: 'PUT',
        body: JSON.stringify({ uid })
      });
      this.failed = result.status !== 'ok';
      this.message =
        result.status === 'ok'
          ? 'Badge associé : il ouvre désormais votre session.'
          : result.status === 'taken'
            ? 'Ce badge est déjà associé à un autre compte.'
            : 'Numéro de badge trop court.';
      if (result.status === 'ok') this.enrolling = false;
      await this.load();
    } catch (error) {
      this.failed = true;
      this.message = `Association impossible (${String(error)}).`;
    }
  }

  private readonly forget = async (): Promise<void> => {
    try {
      await fetchAsUser(`${API}/me`, { method: 'DELETE' });
      this.failed = false;
      this.message = 'Badge retiré.';
      await this.load();
    } catch (error) {
      this.failed = true;
      this.message = `Retrait impossible (${String(error)}).`;
    }
  };
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-auth-badge': WuiAuthBadge;
  }
}
