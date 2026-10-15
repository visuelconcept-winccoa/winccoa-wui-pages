// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Badges" (/auth-badge/admin) — the badge login's administration, by role
 * (Application Security, module `auth-badge`):
 *
 *   configure   the settings: the badge login enabled; every user enrols
 *               their own badge on "Mon badge" (self-service), or not
 *   enrol       the WinCC OA users and their badge: associate one (reader or
 *               typed, Enter included) or remove it
 *
 * Without either role the page only says so. The server checks the same roles
 * on every call (backend/badgeAuth.ts); the badge numbers never reach the
 * browser, only their last digits.
 */
import { fetchAsUser } from '../session.js';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { combineLatest, Subscription } from 'rxjs';
import appSecurityRoles from '../app-security.roles.json';

const API = '/api/auth-badge';

interface BadgeSettings {
  badgeLoginEnabled: boolean;
  selfEnrolment: boolean;
}

interface BadgeUser {
  userId: number;
  username: string;
  fullName: string;
  enabled: boolean;
  /** The last digits of the associated number, or null when there is none. */
  badge: string | null;
}

type EnrolStatus = 'ok' | 'taken' | 'invalid';

@customElement('wui-auth-badge-admin')
export class WuiAuthBadgeAdmin extends LitElement {
  static override styles = css`
    :host {
      display: block;
      padding: 1.5rem;
      max-width: 64rem;
    }
    section {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-bottom: 2rem;
    }
    .option {
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    .hint {
      color: var(--theme-color-soft-text);
    }
    table {
      border-collapse: collapse;
      width: 100%;
    }
    th,
    td {
      text-align: left;
      padding: 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
      align-items: center;
    }
    tr.disabled td {
      color: var(--theme-color-weak-text);
    }
    input {
      font: inherit;
      padding: 0.25rem 0.5rem;
    }
    .filter {
      max-width: 24rem;
    }
    .error {
      color: var(--theme-color-alarm);
    }
    .success {
      color: var(--theme-color-success);
    }
  `;

  @state() private canConfigure = true; // open until assigned
  @state() private canEnrol = true;
  @state() private settings?: BadgeSettings;
  @state() private users: BadgeUser[] = [];
  @state() private filter = '';
  /** The user whose badge is being presented, or the one whose removal awaits confirmation. */
  @state() private enrolling?: number;
  @state() private confirmingRemoval?: number;
  @state() private message = '';
  @state() private failed = false;

  private roleSub?: Subscription;
  /** The users were asked for since `enrol` was last granted. */
  private usersRequested = false;

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = combineLatest([hasRole$('auth-badge', 'configure'), hasRole$('auth-badge', 'enrol')]).subscribe(
      ([configure, enrol]) => {
        this.canConfigure = configure;
        this.canEnrol = enrol;
        if (!enrol) {
          this.enrolling = this.confirmingRemoval = undefined;
          this.usersRequested = false;
        } else if (!this.usersRequested) {
          this.usersRequested = true;
          void this.loadUsers();
        }
      }
    );
    void this.loadSettings();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub?.unsubscribe();
  }

  protected override render(): unknown {
    if (!this.canConfigure && !this.canEnrol) {
      return html`<ix-typography format="h2">Badges</ix-typography>
        <p>Accès réservé aux personnes habilitées à configurer la connexion par badge ou à enrôler les badges.</p>`;
    }
    return html`<ix-typography format="h2">Badges</ix-typography>
      ${this.renderSettings()} ${this.canEnrol ? this.renderUsers() : nothing}
      <p class=${this.failed ? 'error' : 'success'} role="status">${this.message}</p>`;
  }

  private renderSettings(): unknown {
    const settings = this.settings;
    return html`<section>
      <ix-typography format="h3">Options</ix-typography>
      ${settings
        ? html`<label class="option">
              <ix-toggle
                hide-text
                data-testid="badge-login-enabled"
                ?checked=${settings.badgeLoginEnabled}
                ?disabled=${!this.canConfigure}
                @checkedChange=${(e: CustomEvent<boolean>) => void this.patchSettings({ badgeLoginEnabled: e.detail })}
              ></ix-toggle>
              <span>
                Connexion par badge activée
                <div class="hint">Désactivée : le badge n'ouvre plus de session, seul l'identifiant / mot de passe le fait.</div>
              </span>
            </label>
            <label class="option">
              <ix-toggle
                hide-text
                data-testid="self-enrolment"
                ?checked=${settings.selfEnrolment}
                ?disabled=${!this.canConfigure}
                @checkedChange=${(e: CustomEvent<boolean>) => void this.patchSettings({ selfEnrolment: e.detail })}
              ></ix-toggle>
              <span>
                Page « Mon badge » ouverte à tous
                <div class="hint">
                  Chacun associe lui-même son badge. Désactivée : l'utilisateur voit son badge mais doit demander
                  l'enrôlement à une personne habilitée.
                </div>
              </span>
            </label>
            ${this.canConfigure ? nothing : html`<p class="hint">Modification réservée au rôle « Configurer ».</p>`}`
        : html`<p>Chargement…</p>`}
    </section>`;
  }

  private renderUsers(): unknown {
    const needle = this.filter.trim().toLowerCase();
    const shown = needle
      ? this.users.filter((user) => `${user.username} ${user.fullName}`.toLowerCase().includes(needle))
      : this.users;
    return html`<section>
      <ix-typography format="h3">Utilisateurs</ix-typography>
      <ix-input
        class="filter"
        placeholder="Filtrer les utilisateurs"
        aria-label="Filtrer les utilisateurs"
        .value=${this.filter}
        @valueChange=${(e: CustomEvent<string>) => (this.filter = e.detail)}
      ></ix-input>
      <table>
        <thead>
          <tr>
            <th>Utilisateur</th>
            <th>Nom complet</th>
            <th>Badge</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${shown.map((user) => this.renderUser(user))}
        </tbody>
      </table>
    </section>`;
  }

  private renderUser(user: BadgeUser): unknown {
    return html`<tr class=${user.enabled ? '' : 'disabled'}>
      <td>${user.username}${user.enabled ? nothing : html` (désactivé)`}</td>
      <td>${user.fullName}</td>
      <td>${user.badge ? html`•••• ${user.badge}` : '—'}</td>
      <td><div class="actions">${this.renderActions(user)}</div></td>
    </tr>`;
  }

  private renderActions(user: BadgeUser): unknown {
    if (this.enrolling === user.userId) {
      return html`<input
          type="password"
          autocomplete="off"
          placeholder="Présentez le badge au lecteur"
          aria-label="Numéro du badge de ${user.username}"
          @keydown=${(e: KeyboardEvent) => void this.handleKey(e, user)}
        />
        <ix-button variant="secondary" @click=${() => (this.enrolling = undefined)}>Annuler</ix-button>`;
    }
    if (this.confirmingRemoval === user.userId) {
      return html`<ix-button variant="danger-primary" @click=${() => void this.removeBadge(user)}>Confirmer le retrait</ix-button>
        <ix-button variant="secondary" @click=${() => (this.confirmingRemoval = undefined)}>Annuler</ix-button>`;
    }
    return html`<ix-button data-testid="enrol-${user.userId}" @click=${() => void this.startEnrolment(user)}>
        ${user.badge ? 'Remplacer' : 'Associer'}
      </ix-button>
      ${user.badge
        ? html`<ix-button variant="secondary" @click=${() => (this.confirmingRemoval = user.userId)}>Retirer</ix-button>`
        : nothing}`;
  }

  private async loadSettings(): Promise<void> {
    try {
      this.settings = await fetchAsUser<BadgeSettings>(`${API}/settings`);
    } catch (error) {
      this.report(false, `Options indisponibles (${String(error)}).`);
    }
  }

  private async loadUsers(): Promise<void> {
    if (!this.canEnrol) return;
    try {
      this.users = await fetchAsUser<BadgeUser[]>(`${API}/users`);
    } catch (error) {
      this.users = [];
      // 403: the role was withdrawn meanwhile — the gate hides the list.
      if (!String(error).includes('403')) this.report(false, `Liste des utilisateurs indisponible (${String(error)}).`);
    }
  }

  private async patchSettings(patch: Partial<BadgeSettings>): Promise<void> {
    try {
      this.settings = await fetchAsUser<BadgeSettings>(`${API}/settings`, { method: 'PUT', body: JSON.stringify(patch) });
      this.report(true, 'Options enregistrées.');
    } catch (error) {
      this.report(false, `Options non enregistrées (${String(error)}).`);
      await this.loadSettings();
    }
  }

  private async startEnrolment(user: BadgeUser): Promise<void> {
    this.enrolling = user.userId;
    this.confirmingRemoval = undefined;
    this.message = '';
    await this.updateComplete;
    this.renderRoot.querySelector<HTMLInputElement>('.actions input')?.focus();
  }

  private async handleKey(event: KeyboardEvent, user: BadgeUser): Promise<void> {
    if (event.key !== 'Enter') return;
    const field = event.target as HTMLInputElement;
    const uid = field.value.trim();
    field.value = '';
    if (!uid) return;
    try {
      const { status } = await fetchAsUser<{ status: EnrolStatus }>(`${API}/users/${user.userId}`, {
        method: 'PUT',
        body: JSON.stringify({ uid })
      });
      if (status === 'ok') {
        this.enrolling = undefined;
        this.report(true, `Badge associé au compte ${user.username}.`);
      } else {
        this.report(false, status === 'taken' ? 'Ce badge est déjà associé à un autre compte.' : 'Numéro de badge trop court.');
      }
      await this.loadUsers();
    } catch (error) {
      this.report(false, `Association impossible (${String(error)}).`);
    }
  }

  private async removeBadge(user: BadgeUser): Promise<void> {
    this.confirmingRemoval = undefined;
    try {
      await fetchAsUser(`${API}/users/${user.userId}`, { method: 'DELETE' });
      this.report(true, `Badge retiré du compte ${user.username}.`);
      await this.loadUsers();
    } catch (error) {
      this.report(false, `Retrait impossible (${String(error)}).`);
    }
  }

  private report(ok: boolean, message: string): void {
    this.failed = !ok;
    this.message = message;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-auth-badge-admin': WuiAuthBadgeAdmin;
  }
}
