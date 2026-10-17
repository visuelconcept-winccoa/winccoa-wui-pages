// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Mon badge" — the logged-in user associates their badge with their account
 * (the user setting RFID_UID the badge login resolves), or removes it. The
 * badge is read as on the login page (badge-reader.ts): presented to the
 * reader, never typed. The server takes the user from the session's token, and
 * refuses a number another user already has.
 *
 * When the "Badges" page's self-service is off (`selfEnrolment`), the page only
 * shows the user's badge, whatever their roles: a user with the `enrol` role
 * associates it on "Badges".
 *
 * The page module also defines "Badges" (/auth-badge/admin, admin/badge-admin.ts).
 */
import './admin/badge-admin.js';
import { fetchAsUser } from './session.js';
import { DEFAULT_BADGE_FRAME_OPTIONS, type BadgeFrameOptions } from './badge-frame-detector.js';
import { fetchBadgeConfig } from './badge-reader.js';
import { registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import appSecurityRoles from './app-security.roles.json';

const API = '/api/auth-badge';

interface MyBadge {
  username: string;
  /** The last digits of the associated number in clear, or null (none, or a fingerprint). */
  badge: string | null;
  /** A badge is associated, stored as a fingerprint (no digits to show). */
  hashed: boolean;
  /** The user may associate or remove their badge here: self-service on, roles aside. */
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
  /** A badge presented is being associated. */
  @state() private associating = false;
  /** The last badge presented was refused: why, under the reader. */
  @state() private readerError = '';
  @state() private frameOptions: BadgeFrameOptions = DEFAULT_BADGE_FRAME_OPTIONS;

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    void this.load();
    void fetchBadgeConfig().then((config) => (this.frameOptions = config));
  }

  protected override render(): unknown {
    if (!this.me) {
      return html`<ix-typography format="h2">Mon badge</ix-typography>
        <p class=${this.failed ? 'error' : ''}>${this.message || 'Chargement…'}</p>`;
    }
    return html`<div class="card">
      <ix-typography format="h2">Mon badge</ix-typography>
      <p>
        ${this.me.hashed
          ? html`Un badge est associé au compte <b>${this.me.username}</b> (code chiffré).`
          : this.me.badge
          ? html`Un badge est associé au compte <b>${this.me.username}</b> (numéro se terminant par
              <b>${this.me.badge}</b>).`
          : html`Aucun badge n'est associé au compte <b>${this.me.username}</b>.`}
      </p>
      ${!this.me.canChange
        ? html`<p>
            Pour associer ${this.hasBadge ? 'un autre badge' : 'un badge'} à votre compte ou le retirer, demandez
            l'enrôlement à une personne habilitée.
          </p>`
        : this.enrolling
        ? html`<wui-auth-badge-reader
              heading=${this.associating ? 'Lecture du badge…' : 'Présentez votre badge'}
              .message=${this.readerError}
              tone=${this.readerError ? 'error' : ''}
              .options=${this.frameOptions}
              ?paused=${this.associating}
              @badge-read=${(e: CustomEvent<string>) => void this.associate(e.detail)}
            ></wui-auth-badge-reader>
            <div class="row">
              <ix-button variant="secondary" @click=${() => (this.enrolling = false)}>Annuler</ix-button>
            </div>`
        : html`<div class="row">
            <ix-button data-testid="enrol-badge" @click=${this.startEnrolment}>
              ${this.hasBadge ? 'Associer un autre badge' : 'Associer un badge'}
            </ix-button>
            ${this.hasBadge
              ? html`<ix-button variant="secondary" data-testid="forget-badge" @click=${this.forget}>Retirer le badge</ix-button>`
              : nothing}
          </div>`}
      <p class=${this.failed ? 'error' : 'success'}>${this.message}</p>
    </div>`;
  }

  private get hasBadge(): boolean {
    return this.me !== undefined && (this.me.badge !== null || this.me.hashed);
  }

  private async load(): Promise<void> {
    try {
      this.me = await fetchAsUser<MyBadge>(`${API}/me`);
    } catch (error) {
      this.failed = true;
      this.message = `Service de connexion par badge indisponible (${String(error)}).`;
    }
  }

  private startEnrolment(): void {
    this.enrolling = true;
    this.readerError = '';
    this.message = '';
  }

  private async associate(uid: string): Promise<void> {
    this.associating = true;
    try {
      const { status } = await fetchAsUser<{ status: 'ok' | 'taken' | 'invalid' }>(`${API}/me`, {
        method: 'PUT',
        body: JSON.stringify({ uid })
      });
      if (status === 'ok') {
        this.enrolling = false;
        this.failed = false;
        this.message = 'Badge associé : il ouvre désormais votre session.';
        await this.load();
      } else {
        this.readerError = status === 'taken' ? 'Ce badge est déjà associé à un autre compte.' : 'Numéro de badge trop court.';
      }
    } catch (error) {
      this.readerError = `Association impossible (${String(error)}).`;
    } finally {
      this.associating = false;
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
