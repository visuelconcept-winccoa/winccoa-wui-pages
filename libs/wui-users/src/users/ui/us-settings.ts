// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Settings tab:
 *  - the authentication method of the project (WinCC OA / Active Directory / a
 *    user-defined one available here) — changed with the `configure` role, after
 *    a confirmation (emits `wui:write` `/auth/mode`);
 *  - the usersService manager: the user it runs as, whether it may administer
 *    users, the audit DP;
 *  - read-only: the config/config entries of the user administration and the user
 *    settings (`_UserDefinedSettings`, base / per group / per user — sensitive
 *    contents such as badge numbers are masked by the manager).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@visuelconcept-winccoa/wui-kit/ui/wui-confirm-dialog.js';
import { MSG, fill, localize, localizeDir } from '../i18n.js';
import { AUTH_AD, AUTH_STANDARD } from '../model.js';
import { loadSettings } from '../data/api.js';
import type { ConfigEntry, Health, OaGroup, OaUser, UserSetting, WriteIntent } from '../types.js';
import { listStyles } from './styles.js';

@customElement('us-settings')
export class UsSettings extends LitElement {
  static override readonly styles = [IXCoreStyles, listStyles()];

  @property() authName = '';
  @property({ attribute: false }) auths: string[] = [];
  @property({ attribute: false }) health: Health | null = null;
  @property({ attribute: false }) users: OaUser[] = [];
  @property({ attribute: false }) groups: OaGroup[] = [];
  @property({ type: Boolean }) canConfigure = false;

  @state() private mode = '';
  @state() private confirming = false;
  @state() private config: ConfigEntry[] = [];
  @state() private userSettings: UserSetting[] = [];
  @state() private error = '';

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const res = await loadSettings();
      this.config = res.config ?? [];
      this.userSettings = res.userSettings ?? [];
      this.error = '';
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    }
  }

  override render(): TemplateResult {
    return html`${this.renderAuth()} ${this.renderManager()} ${this.renderConfig()} ${this.renderUserSettings()}
      ${this.confirming
        ? html`<wui-confirm-dialog
            .heading=${localize(MSG.settings.authTitle)}
            .confirmLabel=${localize(MSG.settings.apply)}
            message=${fill(localize(MSG.settings.confirmAuth), { mode: authLabel(this.mode) })}
            @wui:confirm=${() => this.applyMode()}
            @wui:cancel=${() => (this.confirming = false)}
          ></wui-confirm-dialog>`
        : nothing}`;
  }

  private renderAuth(): TemplateResult {
    const t = MSG.settings;
    const selected = this.mode || this.authName;
    return html`<div class="section">
      <h3>${localizeDir(t.authTitle)}</h3>
      <div class="hint">${localizeDir(t.authHint)}</div>
      <div class="row">
        ${this.auths.map(
          (auth) => html`<ix-button
            variant=${selected === auth ? 'primary' : 'secondary'}
            ?disabled=${!this.canConfigure}
            @click=${() => (this.mode = auth)}
            >${authLabel(auth)}</ix-button
          >`
        )}
        ${this.canConfigure && selected !== this.authName
          ? html`<ix-button @click=${() => (this.confirming = true)}><ix-icon name="disk" slot="icon"></ix-icon>${localizeDir(t.apply)}</ix-button>`
          : nothing}
      </div>
    </div>`;
  }

  private applyMode(): void {
    this.confirming = false;
    const detail: WriteIntent = { ops: [{ path: '/auth/mode', body: { mode: this.mode } }] };
    this.mode = '';
    this.dispatchEvent(new CustomEvent('wui:write', { detail, bubbles: true, composed: true }));
  }

  private renderManager(): TemplateResult {
    const t = MSG.settings;
    const h = this.health;
    return html`<div class="section">
      <h3>${localizeDir(t.managerTitle)}</h3>
      ${h?.serviceAvailable
        ? html`<table>
            <tr>
              <th>${localizeDir(t.runsAs)}</th>
              <td>${h.userName} (id ${h.userId})</td>
            </tr>
            <tr>
              <th>${localizeDir(t.canManage)}</th>
              <td>${localizeDir(h.canManage ? t.yes : t.no)} (_System.Auth.UserManagement = ${h.level})</td>
            </tr>
            <tr>
              <th>${localizeDir(t.audit)}</th>
              <td>${h.auditDp} ${h.auditDpExists ? nothing : localizeDir(t.auditMissing)}</td>
            </tr>
            <tr>
              <th>Version</th>
              <td>${h.version}</td>
            </tr>
          </table>`
        : html`<div class="muted">${localizeDir(MSG.page.managerDown)} ${h?.error ?? ''}</div>`}
    </div>`;
  }

  private renderConfig(): TemplateResult {
    const t = MSG.settings;
    return html`<div class="section">
      <h3>${localizeDir(t.configTitle)}</h3>
      ${this.error ? html`<div class="muted">${this.error}</div>` : nothing}
      <table>
        <thead>
          <tr>
            <th>${localizeDir(t.colSection)}</th>
            <th>${localizeDir(t.colKey)}</th>
            <th>${localizeDir(t.colValue)}</th>
            <th>${localizeDir(t.colDefault)}</th>
          </tr>
        </thead>
        <tbody>
          ${this.config.map(
            (e) => html`<tr>
              <td>[${e.section}]</td>
              <td>${e.key}</td>
              <td>${e.value ?? html`<span class="muted">${localizeDir(t.notSet)}</span>`}</td>
              <td class="muted">${e.default}</td>
            </tr>`
          )}
        </tbody>
      </table>
    </div>`;
  }

  private renderUserSettings(): TemplateResult {
    const t = MSG.settings;
    const userName = (id: number): string => this.users.find((u) => u.id === id)?.name ?? `#${id}`;
    const groupName = (id: number): string => this.groups.find((g) => g.id === id)?.name ?? `#${id}`;
    const content = (s: UserSetting, value: string[] | null): string | TemplateResult =>
      s.masked ? html`<span class="muted">${localizeDir(t.masked)}</span>` : (value ?? []).join(', ') || '—';
    return html`<div class="section">
      <h3>${localizeDir(t.userSettingsTitle)}</h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>${localizeDir(t.colSetting)}</th>
              <th>${localizeDir(t.colBase)}</th>
              <th>${localizeDir(t.colPerGroup)}</th>
              <th>${localizeDir(t.colPerUser)}</th>
            </tr>
          </thead>
          <tbody>
            ${this.userSettings.length === 0 ? html`<tr><td colspan="4" class="muted">${localizeDir(MSG.common.empty)}</td></tr>` : nothing}
            ${this.userSettings.map(
              (s) => html`<tr>
                <td>${s.name}${s.fullName ? html`<div class="muted">${s.fullName}</div>` : nothing}</td>
                <td>${content(s, s.base)}</td>
                <td>${s.groups.map((g) => html`<div>${groupName(g.id)} : ${content(s, g.content)}</div>`)}</td>
                <td>${s.users.map((u) => html`<div>${userName(u.id)} : ${content(s, u.content)}</div>`)}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    </div>`;
  }
}

/** The label of an authentication method. */
export function authLabel(auth: string): string {
  if (auth === AUTH_STANDARD) return localize(MSG.page.authStandard);
  if (auth === AUTH_AD) return localize(MSG.page.authAd);
  return auth;
}
