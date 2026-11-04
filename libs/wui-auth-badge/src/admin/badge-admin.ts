// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * "Badges" (/auth-badge/admin) — the badge login's administration, by role
 * (Application Security, module `auth-badge`):
 *
 *   configure   the settings: the badge login enabled; every user enrols
 *               their own badge on "Mon badge" (self-service), or not; the
 *               reader's frame (prefix, longest burst, shortest number, end
 *               key), saved together; the numbers stored as one-way
 *               fingerprints (confirmed first: the numbers in clear are
 *               rewritten, for good); the stations' lock (refused badges
 *               before it, its duration), saved together
 *   enrol       the WinCC OA users and their badge: associate one, presented
 *               to the reader (badge-reader.ts, the login page's capture),
 *               test that a presented badge opens that user's session, or
 *               remove it; a locked station (IP address) unlocked, with a
 *               reason
 *
 * Three tabs: "Utilisateurs" (`enrol`; hidden without it), "Liste noire" (the
 * stations' locks, active or all with the history — read with either role,
 * "Déverrouiller" with `enrol`) and "Configuration".
 * Without either role the page only says so. The server checks the same roles
 * on every call (backend/badgeAuth.ts); the badge numbers never reach the
 * browser, only the last digits of a number in clear.
 */
import { fetchAsUser } from '../session.js';
import { DEFAULT_BADGE_FRAME_OPTIONS, type BadgeFrameOptions } from '../badge-frame-detector.js';
import '../badge-reader.js';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { css, html, LitElement, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { combineLatest, Subscription } from 'rxjs';
import appSecurityRoles from '../app-security.roles.json';

const API = '/api/auth-badge';

/** Tab keys (the ix-tab-item `tab-key`s — iX 5 selects tabs by key, not index). */
const TAB_USERS = 'users';
const TAB_BLACKLIST = 'blacklist';
const TAB_CONFIGURATION = 'configuration';

type ReaderSettings = Pick<BadgeFrameOptions, 'prefix' | 'maxFrameMs' | 'minUidLength' | 'endKey'>;

interface LockSettings {
  /** Refused badges in a row from a station before its badge login is locked; 0: never. */
  lockAfterFailures: number;
  /** Minutes; 0: until unlocked here. */
  lockDurationMin: number;
}

interface BadgeSettings extends ReaderSettings, LockSettings {
  badgeLoginEnabled: boolean;
  selfEnrolment: boolean;
  hashBadges: boolean;
}

/** The server's bounds (backend/badgeSettings.ts, LIMITS). */
const LIMITS = {
  prefixLength: 16,
  maxFrameMs: [20, 2000],
  minUidLength: [1, 64],
  lockAfterFailures: [0, 20],
  lockDurationMin: [0, 1440]
} as const;
/** The longest reason of an unlock (the server cuts beyond). */
const MAX_REASON_LENGTH = 200;
const END_KEYS: { key: ReaderSettings['endKey']; label: string }[] = [
  { key: 'Enter', label: 'Entrée' },
  { key: 'Tab', label: 'Tabulation' }
];

interface BadgeUser {
  userId: number;
  username: string;
  fullName: string;
  enabled: boolean;
  /** The last digits of the associated number in clear, or null (none, or a fingerprint). */
  badge: string | null;
  /** A badge is associated, stored as a fingerprint. */
  hashed: boolean;
}

/** A station's lock, current or past (GET /blacklist; backend/badgeBlacklist.ts). */
interface BlacklistRecord {
  id: string;
  ip: string;
  lockedAt: number;
  /** null: until unlocked here. */
  lockedUntil: number | null;
  failures: number;
  /** The last item the station sent (its workcenter…). */
  item: string;
  state: 'active' | 'expired' | 'lifted';
  liftedBy: string | null;
  liftedAt: number | null;
  reason: string | null;
}

/** A station's refused badges counted, not locked (yet). */
interface PendingFailures {
  ip: string;
  failures: number;
  item: string;
  lastAt: number;
}

const LOCK_STATES: Record<BlacklistRecord['state'], string> = {
  active: 'Verrouillé',
  expired: 'Expiré',
  lifted: 'Levé'
};

type EnrolStatus = 'ok' | 'taken' | 'invalid';
type TestResult = { status: 'match' | 'none' | 'invalid' } | { status: 'other'; username: string };
/** What the badge presented under a user's row is for. */
type CaptureMode = 'enrol' | 'test';

function hasBadge(user: BadgeUser): boolean {
  return user.badge !== null || user.hashed;
}

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
    .tab-body {
      padding-top: 1.5rem;
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
    tr.enrolment td {
      padding: 1rem 0.5rem;
    }
    .confirm {
      padding: 0.75rem 1rem;
      border: 1px solid var(--theme-color-warning);
      border-radius: var(--theme-default-border-radius);
    }
    .filter {
      max-width: 24rem;
    }
    .reader-fields {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
      gap: 1rem;
    }
    .buttons {
      display: flex;
      gap: 0.5rem;
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
  @state() private activeTab: string = TAB_USERS;
  @state() private settings?: BadgeSettings;
  @state() private users: BadgeUser[] = [];
  @state() private filter = '';
  /** The user whose badge is being presented (to enrol or to test), or the one whose removal awaits confirmation. */
  @state() private capture?: { userId: number; mode: CaptureMode };
  @state() private confirmingRemoval?: number;
  /** The stations' locks (newest first) and the refusals counted; undefined until loaded. */
  @state() private blacklist?: { records: BlacklistRecord[]; pending: PendingFailures[] };
  /** The blacklist's filter: the active locks, or all of them with the history. */
  @state() private blacklistScope: 'active' | 'all' = 'active';
  /** The station whose unlock awaits its reason and confirmation. */
  @state() private unlocking?: { ip: string; reason: string };
  /** Hashing asked for, awaiting confirmation. */
  @state() private confirmingHash = false;
  @state() private message = '';
  @state() private failed = false;
  /** A badge presented is being associated or tested. */
  @state() private associating = false;
  /** The last badge presented was refused: why, under the reader. */
  @state() private readerError = '';
  @state() private frameOptions: BadgeFrameOptions = DEFAULT_BADGE_FRAME_OPTIONS;
  /** The reader's settings being edited, saved together. */
  @state() private readerDraft?: ReaderSettings;
  /** The lock's settings being edited, saved together. */
  @state() private lockDraft?: LockSettings;

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
          this.capture = undefined;
          this.confirmingRemoval = undefined;
          this.unlocking = undefined;
          this.usersRequested = false;
        } else if (!this.usersRequested) {
          this.usersRequested = true;
          void this.loadUsers();
        }
        if (enrol || configure) void this.loadBlacklist();
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
    // The users without `enrol`: the blacklist (read-only) and the configuration (read-only without `configure`).
    const tab = !this.canEnrol && this.activeTab === TAB_USERS ? TAB_BLACKLIST : this.activeTab;
    return html`<ix-typography format="h2">Badges</ix-typography>
      <ix-tabs .activeTabKey=${tab} @tabChange=${this.onTabChange}>
        ${this.canEnrol ? html`<ix-tab-item tab-key=${TAB_USERS}>Utilisateurs</ix-tab-item>` : nothing}
        <ix-tab-item tab-key=${TAB_BLACKLIST}>Liste noire</ix-tab-item>
        <ix-tab-item tab-key=${TAB_CONFIGURATION}>Configuration</ix-tab-item>
      </ix-tabs>
      <div class="tab-body">
        ${tab === TAB_USERS ? this.renderUsers() : tab === TAB_BLACKLIST ? this.renderBlacklist() : this.renderSettings()}
      </div>
      <p class=${this.failed ? 'error' : 'success'} role="status">${this.message}</p>`;
  }

  private onTabChange(event: CustomEvent<string | undefined>): void {
    if (!event.detail || event.detail === this.activeTab) return;
    // Leaving the users: no badge awaited, no removal or unlock pending.
    this.capture = undefined;
    this.confirmingRemoval = undefined;
    this.unlocking = undefined;
    this.activeTab = event.detail;
    if (event.detail === TAB_BLACKLIST) void this.loadBlacklist();
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
            <label class="option">
              <ix-toggle
                hide-text
                data-testid="hash-badges"
                .checked=${settings.hashBadges || this.confirmingHash}
                ?disabled=${!this.canConfigure || this.confirmingHash}
                @checkedChange=${(e: CustomEvent<boolean>) => this.onHashToggle(e.detail)}
              ></ix-toggle>
              <span>
                Chiffrer les codes badge
                <div class="hint">
                  Les numéros sont stockés sous forme d'empreinte irréversible (HMAC-SHA256, clé secrète du serveur) et
                  seule l'empreinte est reconnue. Désactivée : les nouveaux badges sont stockés en clair ; les codes
                  déjà chiffrés le restent et sont toujours reconnus.
                </div>
              </span>
            </label>
            ${this.confirmingHash
              ? html`<div class="confirm" role="alertdialog" aria-label="Confirmer le chiffrement">
                  <p>
                    Tous les codes badge enregistrés en clair seront réécrits chiffrés. C'est définitif : désactiver
                    l'option plus tard ne les déchiffrera pas. Sauvegardez la clé du serveur
                    (<code>config/wui-auth-badge.key</code>) avec le projet : sans elle, les badges chiffrés devront être
                    réenrôlés.
                  </p>
                  <div class="buttons">
                    <ix-button data-testid="confirm-hash" @click=${() => void this.confirmHash()}>Chiffrer les codes</ix-button>
                    <ix-button variant="secondary" @click=${() => (this.confirmingHash = false)}>Annuler</ix-button>
                  </div>
                </div>`
              : nothing}
            ${this.canConfigure ? nothing : html`<p class="hint">Modification réservée au rôle « Configurer ».</p>`}`
        : html`<p>Chargement…</p>`}
    </section>
    ${settings && this.readerDraft ? this.renderReaderSettings(settings, this.readerDraft) : nothing}
    ${settings && this.lockDraft ? this.renderLockSettings(settings, this.lockDraft) : nothing}`;
  }

  /** The account lock: after how many refused badge logins, for how long. */
  private renderLockSettings(settings: BadgeSettings, draft: LockSettings): unknown {
    const changed = (Object.keys(draft) as (keyof LockSettings)[]).some((key) => draft[key] !== settings[key]);
    const [minFailures, maxFailures] = LIMITS.lockAfterFailures;
    const [minDuration, maxDuration] = LIMITS.lockDurationMin;
    return html`<section>
      <ix-typography format="h3">Verrouillage des postes</ix-typography>
      <p class="hint">
        Un poste (adresse IP) sur lequel plusieurs badges sont refusés de suite — badge inconnu, compte désactivé ou sans
        droit de connexion WebUI — voit sa connexion par badge verrouillée ; les autres postes ne sont pas touchés et la
        connexion par identifiant et mot de passe reste possible. Une connexion réussie remet le compteur du poste à
        zéro. Les verrouillages sont listés dans l'onglet « Liste noire ».
      </p>
      <div class="reader-fields">
        <ix-number-input
          label="Tentatives avant verrouillage"
          helper-text="${minFailures + 1} à ${maxFailures} ; 0 : jamais."
          min=${minFailures}
          max=${maxFailures}
          .value=${draft.lockAfterFailures}
          ?disabled=${!this.canConfigure}
          @valueChange=${(e: CustomEvent<number>) => this.patchLockDraft({ lockAfterFailures: Number(e.detail) })}
        ></ix-number-input>
        <ix-number-input
          label="Durée du verrouillage (min)"
          helper-text="${minDuration + 1} à ${maxDuration} ; 0 : jusqu'au déverrouillage manuel."
          min=${minDuration}
          max=${maxDuration}
          .value=${draft.lockDurationMin}
          ?disabled=${!this.canConfigure}
          @valueChange=${(e: CustomEvent<number>) => this.patchLockDraft({ lockDurationMin: Number(e.detail) })}
        ></ix-number-input>
      </div>
      ${this.canConfigure
        ? html`<div class="buttons">
            <ix-button
              data-testid="save-lock"
              ?disabled=${!changed || !lockValid(draft)}
              @click=${() => void this.patchSettings(draft)}
              >Enregistrer</ix-button
            >
            <ix-button variant="secondary" ?disabled=${!changed} @click=${() => (this.lockDraft = lockOf(settings))}
              >Annuler</ix-button
            >
          </div>`
        : nothing}
    </section>`;
  }

  private patchLockDraft(patch: Partial<LockSettings>): void {
    if (this.lockDraft) this.lockDraft = { ...this.lockDraft, ...patch };
  }

  /** The reader's frame: what the login page, Mon badge and this page accept as a badge. */
  private renderReaderSettings(settings: BadgeSettings, draft: ReaderSettings): unknown {
    const changed = (Object.keys(draft) as (keyof ReaderSettings)[]).some((key) => draft[key] !== settings[key]);
    const [minFrame, maxFrame] = LIMITS.maxFrameMs;
    const [minLength, maxLength] = LIMITS.minUidLength;
    return html`<section>
      <ix-typography format="h3">Lecteur de badge</ix-typography>
      <p class="hint">
        Le lecteur tape le numéro comme un clavier : le préfixe, le numéro puis la touche de fin, en une rafale. Seule une
        rafale conforme est lue ; un numéro tapé à la main est ignoré.
      </p>
      <div class="reader-fields">
        <ix-input
          label="Préfixe"
          helper-text="Caractères émis avant le numéro ; vide si aucun."
          maxlength=${LIMITS.prefixLength}
          .value=${draft.prefix}
          ?disabled=${!this.canConfigure}
          @valueChange=${(e: CustomEvent<string>) => this.patchDraft({ prefix: e.detail ?? '' })}
        ></ix-input>
        <ix-number-input
          label="Délai maximal de lecture (ms)"
          helper-text="Du premier caractère à la touche de fin (${minFrame} à ${maxFrame})."
          min=${minFrame}
          max=${maxFrame}
          .value=${draft.maxFrameMs}
          ?disabled=${!this.canConfigure}
          @valueChange=${(e: CustomEvent<number>) => this.patchDraft({ maxFrameMs: Number(e.detail) })}
        ></ix-number-input>
        <ix-number-input
          label="Longueur minimale du numéro"
          helper-text="Préfixe exclu (${minLength} à ${maxLength})."
          min=${minLength}
          max=${maxLength}
          .value=${draft.minUidLength}
          ?disabled=${!this.canConfigure}
          @valueChange=${(e: CustomEvent<number>) => this.patchDraft({ minUidLength: Number(e.detail) })}
        ></ix-number-input>
        <ix-select
          label="Touche de fin"
          .value=${draft.endKey}
          ?disabled=${!this.canConfigure}
          @valueChange=${(e: CustomEvent<string>) => this.patchDraft({ endKey: String(e.detail) as ReaderSettings['endKey'] })}
        >
          ${END_KEYS.map(({ key, label }) => html`<ix-select-item label=${label} value=${key}></ix-select-item>`)}
        </ix-select>
      </div>
      ${this.canConfigure
        ? html`<div class="buttons">
            <ix-button
              data-testid="save-reader"
              ?disabled=${!changed || !readerValid(draft)}
              @click=${() => void this.patchSettings(draft)}
              >Enregistrer</ix-button
            >
            <ix-button variant="secondary" ?disabled=${!changed} @click=${() => (this.readerDraft = readerOf(settings))}
              >Annuler</ix-button
            >
          </div>`
        : nothing}
    </section>`;
  }

  private patchDraft(patch: Partial<ReaderSettings>): void {
    if (this.readerDraft) this.readerDraft = { ...this.readerDraft, ...patch };
  }

  private renderUsers(): unknown {
    const needle = this.filter.trim().toLowerCase();
    const shown = needle
      ? this.users.filter((user) => `${user.username} ${user.fullName}`.toLowerCase().includes(needle))
      : this.users;
    return html`<section>
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
      <td>${user.hashed ? 'Associé (chiffré)' : user.badge ? html`•••• ${user.badge}` : '—'}</td>
      <td><div class="actions">${this.renderActions(user)}</div></td>
    </tr>
    ${this.capture?.userId === user.userId ? this.renderCapture(user, this.capture.mode) : nothing}`;
  }

  /** The stations' locks: the active ones, or all of them (the history, read-only). */
  private renderBlacklist(): unknown {
    const blacklist = this.blacklist;
    if (!blacklist) return html`<p>Chargement…</p>`;
    const records =
      this.blacklistScope === 'active' ? blacklist.records.filter((record) => record.state === 'active') : blacklist.records;
    return html`<section>
      <p class="hint">
        Un poste est verrouillé après ${this.settings ? this.settings.lockAfterFailures : 'N'} badges refusés de suite
        (onglet « Configuration »). Le déverrouillage demande un motif ; il est tracé.
      </p>
      <div class="buttons">
        <ix-select
          class="filter"
          label="Afficher"
          data-testid="blacklist-scope"
          .value=${this.blacklistScope}
          @valueChange=${(e: CustomEvent<string>) => (this.blacklistScope = e.detail === 'all' ? 'all' : 'active')}
        >
          <ix-select-item label="Verrouillages actifs" value="active"></ix-select-item>
          <ix-select-item label="Tous (historique)" value="all"></ix-select-item>
        </ix-select>
        <ix-button variant="secondary" data-testid="blacklist-refresh" @click=${() => void this.loadBlacklist()}>Actualiser</ix-button>
      </div>
      ${records.length === 0
        ? html`<p>${this.blacklistScope === 'active' ? 'Aucun poste verrouillé.' : 'Aucun verrouillage enregistré.'}</p>`
        : html`<table>
            <thead>
              <tr>
                <th>Adresse IP</th>
                <th>État</th>
                <th>Verrouillé depuis</th>
                <th>Jusqu'à</th>
                <th>Refus</th>
                <th>Poste / item</th>
                <th>Levée</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${records.map((record) => this.renderLock(record))}
            </tbody>
          </table>`}
      ${blacklist.pending.length > 0
        ? html`<p class="hint">
            Refus en cours, sans verrouillage :
            ${blacklist.pending.map((pending) => `${pending.ip} (${pending.failures})`).join(', ')}.
          </p>`
        : nothing}
    </section>`;
  }

  private renderLock(record: BlacklistRecord): unknown {
    const unlocking = this.unlocking?.ip === record.ip && record.state === 'active' ? this.unlocking : undefined;
    return html`<tr>
        <td>${record.ip}</td>
        <td class=${record.state === 'active' ? 'error' : ''}>${LOCK_STATES[record.state]}</td>
        <td>${formatDateTime(record.lockedAt)}</td>
        <td>${record.lockedUntil === null ? 'Déverrouillage manuel' : formatDateTime(record.lockedUntil)}</td>
        <td>${record.failures}</td>
        <td>${record.item || '—'}</td>
        <td>
          ${record.state === 'lifted'
            ? `${record.liftedBy ?? '?'}, ${record.liftedAt === null ? '' : formatDateTime(record.liftedAt)} : ${record.reason ?? ''}`
            : '—'}
        </td>
        <td>
          <div class="actions">
            ${record.state === 'active' && this.canEnrol && !unlocking
              ? html`<ix-button variant="secondary" data-testid="unlock-${record.ip}" @click=${() => this.startUnlock(record.ip)}>
                  Déverrouiller
                </ix-button>`
              : nothing}
          </div>
        </td>
      </tr>
      ${unlocking ? this.renderUnlock(record, unlocking.reason) : nothing}`;
  }

  /** The unlock's confirmation: a reason is required (the server refuses one without). */
  private renderUnlock(record: BlacklistRecord, reason: string): unknown {
    return html`<tr class="enrolment">
      <td colspan="8">
        <div class="confirm" role="alertdialog" aria-label="Confirmer le déverrouillage">
          <p>
            Déverrouiller la connexion par badge du poste ${record.ip} et remettre son compteur de refus à zéro. Le motif est
            tracé.
          </p>
          <ix-input
            label="Motif du déverrouillage"
            required
            maxlength=${MAX_REASON_LENGTH}
            data-testid="unlock-reason"
            .value=${reason}
            @valueChange=${(e: CustomEvent<string>) => (this.unlocking = { ip: record.ip, reason: e.detail ?? '' })}
          ></ix-input>
          <div class="buttons">
            <ix-button data-testid="confirm-unlock" ?disabled=${reason.trim() === ''} @click=${() => void this.unlock(record.ip, reason)}
              >Déverrouiller</ix-button
            >
            <ix-button variant="secondary" @click=${() => (this.unlocking = undefined)}>Annuler</ix-button>
          </div>
        </div>
      </td>
    </tr>`;
  }

  private renderCapture(user: BadgeUser, mode: CaptureMode): unknown {
    const prompt = mode === 'test' ? `Présentez le badge à tester pour ${user.username}` : `Présentez le badge de ${user.username}`;
    return html`<tr class="enrolment">
      <td colspan="4">
        <wui-auth-badge-reader
          heading=${this.associating ? 'Lecture du badge…' : prompt}
          .message=${this.readerError}
          tone=${this.readerError ? 'error' : ''}
          .options=${this.frameOptions}
          ?paused=${this.associating}
          @badge-read=${(e: CustomEvent<string>) =>
            void (mode === 'test' ? this.testBadge(user, e.detail) : this.associate(user, e.detail))}
        ></wui-auth-badge-reader>
        <ix-button variant="secondary" @click=${() => (this.capture = undefined)}>Annuler</ix-button>
      </td>
    </tr>`;
  }

  private renderActions(user: BadgeUser): unknown {
    if (this.capture?.userId === user.userId) return nothing;
    if (this.confirmingRemoval === user.userId) {
      return html`<ix-button variant="danger-primary" @click=${() => void this.removeBadge(user)}>Confirmer le retrait</ix-button>
        <ix-button variant="secondary" @click=${() => (this.confirmingRemoval = undefined)}>Annuler</ix-button>`;
    }
    return html`${hasBadge(user)
        ? html`<ix-button variant="secondary" data-testid="test-${user.userId}" @click=${() => this.startCapture(user, 'test')}>
            Tester
          </ix-button>`
        : nothing}
      <ix-button data-testid="enrol-${user.userId}" @click=${() => this.startCapture(user, 'enrol')}>
        ${hasBadge(user) ? 'Remplacer' : 'Associer'}
      </ix-button>
      ${hasBadge(user)
        ? html`<ix-button variant="secondary" @click=${() => (this.confirmingRemoval = user.userId)}>Retirer</ix-button>`
        : nothing}`;
  }

  private startUnlock(ip: string): void {
    this.unlocking = { ip, reason: '' };
    this.message = '';
  }

  private async unlock(ip: string, reason: string): Promise<void> {
    if (reason.trim() === '') return;
    try {
      // The address in the body, not the path: an IPv6 one holds `:` (#24).
      await fetchAsUser(`${API}/blacklist/unlock`, {
        method: 'POST',
        body: JSON.stringify({ ip, reason: reason.trim() })
      });
      this.unlocking = undefined;
      this.report(true, `Poste ${ip} déverrouillé.`);
    } catch (error) {
      if (String(error).includes('HTTP 404')) {
        // Its lock ran out or was lifted meanwhile: the reloaded list shows it.
        this.unlocking = undefined;
        this.report(false, `Le poste ${ip} n'est plus verrouillé (verrou expiré ou déjà levé).`);
      } else {
        this.report(false, `Déverrouillage impossible (${String(error)}).`);
      }
    }
    await this.loadBlacklist();
  }

  private async loadBlacklist(): Promise<void> {
    if (!this.canEnrol && !this.canConfigure) return;
    try {
      this.blacklist = await fetchAsUser<{ records: BlacklistRecord[]; pending: PendingFailures[] }>(`${API}/blacklist`);
    } catch (error) {
      this.blacklist = { records: [], pending: [] };
      if (!String(error).includes('403')) this.report(false, `Liste noire indisponible (${String(error)}).`);
    }
  }

  private async loadSettings(): Promise<void> {
    try {
      this.applySettings(await fetchAsUser<BadgeSettings>(`${API}/settings`));
    } catch (error) {
      this.report(false, `Options indisponibles (${String(error)}).`);
    }
  }

  /**
   * The settings in the page; a draft follows them when `saved` holds one of its fields (or
   * none was given: a load), else it is kept.
   */
  private applySettings(settings: BadgeSettings, saved?: string[]): void {
    this.settings = settings;
    this.frameOptions = readerOf(settings);
    const touches = (fields: object): boolean => !saved || saved.some((key) => key in fields);
    if (!this.readerDraft || touches(readerOf(settings))) this.readerDraft = readerOf(settings);
    if (!this.lockDraft || touches(lockOf(settings))) this.lockDraft = lockOf(settings);
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
      const { migrated, ...settings } = await fetchAsUser<BadgeSettings & { migrated?: number }>(`${API}/settings`, {
        method: 'PUT',
        body: JSON.stringify(patch)
      });
      // A draft follows a save of its own fields, not a toggle's.
      this.applySettings(settings, Object.keys(patch));
      this.report(true, migrated ? `Options enregistrées : ${migrated} code(s) badge chiffré(s).` : 'Options enregistrées.');
      if (migrated) await this.loadUsers();
    } catch (error) {
      this.report(false, `Options non enregistrées (${String(error)}).`);
      await this.loadSettings();
    }
  }

  /** Turning hashing on asks for confirmation first; turning it off does not (the fingerprints stay). */
  private onHashToggle(checked: boolean): void {
    if (!this.settings || checked === this.settings.hashBadges) return;
    if (checked) {
      this.confirmingHash = true;
      return;
    }
    void this.patchSettings({ hashBadges: false });
  }

  private async confirmHash(): Promise<void> {
    this.confirmingHash = false;
    await this.patchSettings({ hashBadges: true });
  }

  private startCapture(user: BadgeUser, mode: CaptureMode): void {
    this.capture = { userId: user.userId, mode };
    this.confirmingRemoval = undefined;
    this.readerError = '';
    this.message = '';
  }

  private async associate(user: BadgeUser, uid: string): Promise<void> {
    this.associating = true;
    try {
      const { status } = await fetchAsUser<{ status: EnrolStatus }>(`${API}/users/${user.userId}`, {
        method: 'PUT',
        body: JSON.stringify({ uid })
      });
      if (status === 'ok') {
        this.capture = undefined;
        this.report(true, `Badge associé au compte ${user.username}.`);
        await this.loadUsers();
      } else {
        this.readerError = status === 'taken' ? 'Ce badge est déjà associé à un autre compte.' : 'Numéro de badge trop court.';
      }
    } catch (error) {
      this.readerError = `Association impossible (${String(error)}).`;
    } finally {
      this.associating = false;
    }
  }

  /** Does the presented badge open that user's session — by the login's own rules? Nothing is written. */
  private async testBadge(user: BadgeUser, uid: string): Promise<void> {
    this.associating = true;
    try {
      const result = await fetchAsUser<TestResult>(`${API}/users/${user.userId}/test`, {
        method: 'POST',
        body: JSON.stringify({ uid })
      });
      if (result.status === 'invalid') {
        this.readerError = 'Numéro de badge trop court.';
        return;
      }
      this.capture = undefined;
      if (result.status === 'match') {
        this.report(true, `Badge reconnu : il ouvre la session de ${user.username}${user.enabled ? '' : ' (compte désactivé)'}.`);
      } else if (result.status === 'other') {
        this.report(false, `Ce badge ne correspond pas à ${user.username} : il est associé au compte ${result.username}.`);
      } else {
        this.report(false, `Ce badge ne correspond pas à ${user.username} : il n'est associé à aucun compte.`);
      }
    } catch (error) {
      this.readerError = `Test impossible (${String(error)}).`;
    } finally {
      this.associating = false;
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

function readerOf({ prefix, maxFrameMs, minUidLength, endKey }: ReaderSettings): ReaderSettings {
  return { prefix, maxFrameMs, minUidLength, endKey };
}

function lockOf({ lockAfterFailures, lockDurationMin }: LockSettings): LockSettings {
  return { lockAfterFailures, lockDurationMin };
}

function lockValid({ lockAfterFailures, lockDurationMin }: LockSettings): boolean {
  const within = (value: number, [min, max]: readonly [number, number]): boolean =>
    Number.isInteger(value) && value >= min && value <= max;
  return within(lockAfterFailures, LIMITS.lockAfterFailures) && within(lockDurationMin, LIMITS.lockDurationMin);
}

function formatDateTime(epochMs: number): string {
  return new Date(epochMs).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function readerValid({ prefix, maxFrameMs, minUidLength }: ReaderSettings): boolean {
  const within = (value: number, [min, max]: readonly [number, number]): boolean =>
    Number.isInteger(value) && value >= min && value <= max;
  return (
    prefix.length <= LIMITS.prefixLength &&
    within(maxFrameMs, LIMITS.maxFrameMs) &&
    within(minUidLength, LIMITS.minUidLength)
  );
}

declare global {
  interface HTMLElementTagNameMap {
    'wui-auth-badge-admin': WuiAuthBadgeAdmin;
  }
}
