// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Users — standalone WinCC OA WebUI page: the project's user administration, as
 * the WinCC OA user administration panel does it.
 *  - **Users**: create (local, with a password), edit, enable / disable, groups,
 *    password of a local user, delete — role 'manage-users'.
 *  - **Groups**: the 32 system permission bits, the domains with their own bits,
 *    the members, the permission names — role 'manage-groups'.
 *  - **Domains** (WinCC OA areas) and their default bits — role 'manage-groups'.
 *  - **AD import** (Active Directory authentication): new AD users imported
 *    manually or cyclically by the usersService manager (role 'configure' for the
 *    mode), manual import of AD users ('manage-users') and groups ('manage-groups').
 *    Existing users are left to the standard WCCOAupdateUserGroups script.
 *  - **Settings**: the authentication method (WinCC OA / Active Directory, role
 *    'configure'), the manager's state, config/config entries and user settings
 *    (read-only).
 * Role 'view' opens the page. The same roles are enforced on /api/users.
 *
 * Backend: `/api/users` (customer-webserver) → MSA vRPC → the `usersService` JS
 * manager → WinCC OA's UserManagement classes (CTRL) → _CommandChannel. Every
 * change is audited by the manager.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { MSG, fill, localize, localizeDir } from './users/i18n.js';
import { health, isBridgeError, loadState, write } from './users/data/api.js';
import { isAdMode } from './users/model.js';
import type { Health, UsersState, WriteIntent } from './users/types.js';
import { authLabel } from './users/ui/us-settings.js';
import './users/ui/us-users.js';
import './users/ui/us-groups.js';
import './users/ui/us-areas.js';
import './users/ui/us-ad-import.js';
import './users/ui/us-settings.js';

type Tab = 'users' | 'groups' | 'areas' | 'ad' | 'settings';

/** Application-Security module id of this page. */
const MODULE_ID = 'users';

const EMPTY: UsersState = { users: [], groups: [], areas: [], permissionNames: [], authName: '', auths: [] };

export class WuiUsers extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private tab: Tab = 'users';
  @state() private data: UsersState = EMPTY;
  @state() private health: Health | null = null;
  @state() private errorMsg: MultiLangString | null = null;
  @state() private errorDetail = '';
  @state() private bridgeDown = false;
  @state() private busy = false;
  @state() private roleView = true;
  @state() private roleUsers = true;
  @state() private roleGroups = true;
  @state() private roleConfigure = true;

  private subs = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles and follow the grants
    // (the same rules are ENFORCED server-side on /api/users).
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.subs.add(hasRole$(MODULE_ID, 'view').subscribe((granted) => (this.roleView = granted)));
    this.subs.add(hasRole$(MODULE_ID, 'manage-users').subscribe((granted) => (this.roleUsers = granted)));
    this.subs.add(hasRole$(MODULE_ID, 'manage-groups').subscribe((granted) => (this.roleGroups = granted)));
    this.subs.add(hasRole$(MODULE_ID, 'configure').subscribe((granted) => (this.roleConfigure = granted)));
    void this.reload();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subs.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator .config=${{ headerTitle: { context: 'translate', config: MSG.title } }}>
          <wui-content-header></wui-content-header>
        </wui-context-generator>
        <div class="body">${this.roleView ? this.renderBody() : html`<ix-message-bar type="warning" persistent>${localizeDir(MSG.page.reserved)}</ix-message-bar>`}</div>
      </div>
    `;
  }

  private renderBody(): TemplateResult {
    const adMode = isAdMode(this.data.authName);
    return html`
      <div class="tabs">
        ${this.tabBtn('users', MSG.tabs.users)} ${this.tabBtn('groups', MSG.tabs.groups)} ${this.tabBtn('areas', MSG.tabs.areas)}
        ${this.tabBtn('ad', MSG.tabs.ad)} ${this.tabBtn('settings', MSG.tabs.settings)}
        <span class="grow"></span>
        ${this.busy ? html`<ix-spinner size="small"></ix-spinner>` : nothing}
        ${this.data.authName
          ? html`<span class="auth">${localizeDir(MSG.page.authLabel)} : <strong>${authLabel(this.data.authName)}</strong></span>`
          : nothing}
        <ix-icon-button icon="refresh" variant="secondary" ghost title=${localize(MSG.common.refresh)} @click=${() => void this.reload()}></ix-icon-button>
      </div>
      ${this.renderHealth()} ${this.renderError()}
      <div class="content" @wui:write=${(e: CustomEvent<WriteIntent>) => void this.runWrites(e.detail)} @wui:changed=${() => void this.reload()}>
        ${this.tab === 'users'
          ? html`<us-users .users=${this.data.users} .groups=${this.data.groups} .canEdit=${this.roleUsers} .adMode=${adMode}></us-users>`
          : nothing}
        ${this.tab === 'groups'
          ? html`<us-groups
              .groups=${this.data.groups}
              .areas=${this.data.areas}
              .users=${this.data.users}
              .permissionNames=${this.data.permissionNames}
              .canEdit=${this.roleGroups}
            ></us-groups>`
          : nothing}
        ${this.tab === 'areas'
          ? html`<us-areas
              .areas=${this.data.areas}
              .groups=${this.data.groups}
              .permissionNames=${this.data.permissionNames}
              .canEdit=${this.roleGroups}
            ></us-areas>`
          : nothing}
        ${this.tab === 'ad'
          ? html`<us-ad-import
              .groups=${this.data.groups}
              .adMode=${adMode}
              .canConfigure=${this.roleConfigure}
              .canUsers=${this.roleUsers}
              .canGroups=${this.roleGroups}
            ></us-ad-import>`
          : nothing}
        ${this.tab === 'settings'
          ? html`<us-settings
              .authName=${this.data.authName}
              .auths=${this.data.auths}
              .health=${this.health}
              .users=${this.data.users}
              .groups=${this.data.groups}
              .canConfigure=${this.roleConfigure}
            ></us-settings>`
          : nothing}
      </div>
    `;
  }

  /** The manager is down, or runs as a user who may not administer users: every write would fail. */
  private renderHealth(): TemplateResult | typeof nothing {
    const h = this.health;
    if (h === null) return nothing;
    if (!h.serviceAvailable) {
      return html`<ix-message-bar class="bar" type="alarm" persistent>${localizeDir(MSG.page.managerDown)}${h.error ? ` — ${h.error}` : ''}</ix-message-bar>`;
    }
    if (h.canManage === false) {
      return html`<ix-message-bar class="bar" type="warning" persistent>
        ${fill(localize(MSG.page.noPermission), { user: h.userName ?? '?', level: h.level ?? '?' })}
      </ix-message-bar>`;
    }
    return nothing;
  }

  private renderError(): TemplateResult | typeof nothing {
    if (this.errorMsg === null) return nothing;
    return html`<ix-message-bar class="bar" type="alarm" persistent @closedChange=${() => this.clearError()}>
      ${localizeDir(this.errorMsg)}${this.errorDetail ? ` — ${this.errorDetail}` : ''}
      ${this.bridgeDown ? html`<div class="hint">${localizeDir(MSG.page.managerDown)}</div>` : nothing}
    </ix-message-bar>`;
  }

  private tabBtn(tab: Tab, label: MultiLangString): TemplateResult {
    return html`<ix-button variant=${this.tab === tab ? 'primary' : 'secondary'} @click=${() => (this.tab = tab)}>${localizeDir(label)}</ix-button>`;
  }

  private async reload(): Promise<void> {
    this.busy = true;
    try {
      const [h, data] = await Promise.all([health(), loadState().catch((error: unknown) => error)]);
      this.health = h;
      if (data instanceof Error) {
        this.reportError(MSG.page.loadError, data);
      } else {
        this.data = data as UsersState;
        if (this.errorMsg === MSG.page.loadError) this.clearError();
      }
    } finally {
      this.busy = false;
    }
  }

  /** Run the writes in order; the first refusal stops them and is shown. Then reload. */
  private async runWrites(intent: WriteIntent): Promise<void> {
    this.busy = true;
    try {
      for (const op of intent.ops) await write(op.path, op.body);
      this.clearError();
    } catch (error) {
      this.reportError(MSG.page.writeError, error);
    } finally {
      this.busy = false;
    }
    await this.reload();
  }

  private reportError(message: MultiLangString, error: unknown): void {
    this.errorMsg = message;
    this.errorDetail = error instanceof Error ? error.message : String(error);
    this.bridgeDown = isBridgeError(error);
  }

  private clearError(): void {
    this.errorMsg = null;
    this.errorDetail = '';
    this.bridgeDown = false;
  }
}

function pageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
    }
    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      padding: 0 1rem 1rem;
      overflow: auto;
    }
    .tabs {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0;
    }
    .grow {
      flex: 1;
    }
    .auth {
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .bar {
      margin-bottom: 0.6rem;
    }
    .hint {
      padding-top: 0.25rem;
      font-size: 0.85rem;
    }
  `;
}

if (!customElements.get('wui-users')) {
  customElements.define('wui-users', WuiUsers);
}
