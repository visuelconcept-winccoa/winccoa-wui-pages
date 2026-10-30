// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AD import tab (Active Directory authentication only):
 *  - **New AD users**: manual (import the users one selects) or automatic (the
 *    usersService manager imports cyclically the new users of the AD-linked groups,
 *    every N minutes, restricted to some groups if wished) — role configure; the
 *    last report and the next run; "Run now".
 *  - **Manual import of users** (role manage-users): read the AD, tick, import —
 *    each one in the WinCC OA groups it belongs to in the AD.
 *  - **Import of AD groups** (role manage-groups): read the AD groups, tick, import
 *    (linked by their OSID — the groups the automatic import works with).
 * Existing users are never touched here: WCCOAupdateUserGroups maintains them.
 * Calls the API itself; emits `wui:changed` after an import so the page reloads.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, dateLabel, fill, localize, localizeDir } from '../i18n.js';
import { byName, matches } from '../model.js';
import { adGroups, adUsers, importAdGroups, importAdUsers, importState, runImport, saveImportSettings } from '../data/api.js';
import type { AdEntry, ImportSettings, ImportStatus, OaGroup } from '../types.js';
import { listStyles } from './styles.js';

const POLL_MS = 3000;

@customElement('us-ad-import')
export class UsAdImport extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    listStyles(),
    css`
      .error {
        color: var(--theme-color-alarm);
        font-size: 0.85rem;
        white-space: pre-line;
      }
      .ok {
        color: var(--theme-color-success);
        font-size: 0.85rem;
      }
      .checks {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: 0.2rem 0.75rem;
      }
      ix-input.interval {
        width: 120px;
      }
    `
  ];

  @property({ attribute: false }) groups: OaGroup[] = [];
  @property({ type: Boolean }) adMode = false;
  @property({ type: Boolean }) canConfigure = false;
  @property({ type: Boolean }) canUsers = false;
  @property({ type: Boolean }) canGroups = false;

  @state() private settings: ImportSettings = { enabled: false, intervalMin: 60, groups: [] };
  @state() private draft: ImportSettings = { enabled: false, intervalMin: 60, groups: [] };
  @state() private status: ImportStatus = { running: false, lastRun: null, nextRunAt: null };
  @state() private settingsError = '';
  @state() private settingsSaved = false;

  @state() private adUserList: AdEntry[] | null = null;
  @state() private adGroupList: AdEntry[] | null = null;
  @state() private selectedUsers: string[] = [];
  @state() private selectedGroups: string[] = [];
  @state() private userQuery = '';
  @state() private groupQuery = '';
  @state() private showImported = false;
  @state() private busy: '' | 'users' | 'groups' = '';
  @state() private usersMessage = '';
  @state() private groupsMessage = '';
  @state() private usersError = '';
  @state() private groupsError = '';

  private poll: ReturnType<typeof globalThis.setTimeout> | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    void this.loadImport();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    globalThis.clearTimeout(this.poll);
  }

  private get linkedGroups(): OaGroup[] {
    return this.groups.filter((g) => g.osId).sort(byName);
  }

  private async loadImport(): Promise<void> {
    try {
      const res = await importState();
      this.settings = res.settings;
      this.draft = { ...res.settings, groups: [...res.settings.groups] };
      this.setStatus(res.status);
    } catch (error) {
      this.settingsError = message(error);
    }
  }

  /** Follow a running import until it ends (then the page reloads its lists). */
  private setStatus(status: ImportStatus): void {
    const wasRunning = this.status.running;
    this.status = status;
    globalThis.clearTimeout(this.poll);
    if (status.running) {
      this.poll = globalThis.setTimeout(() => void this.refreshStatus(), POLL_MS);
    } else if (wasRunning) {
      this.changed();
    }
  }

  private async refreshStatus(): Promise<void> {
    try {
      this.setStatus((await importState()).status);
    } catch (error) {
      this.settingsError = message(error);
    }
  }

  override render(): TemplateResult {
    if (!this.adMode) return html`<div class="section">${localizeDir(MSG.ad.notAd)}</div>`;
    return html`${this.renderMode()} ${this.renderUsers()} ${this.renderGroups()}`;
  }

  // ---- mode: manual / automatic ----------------------------------------------------------------

  private renderMode(): TemplateResult {
    const t = MSG.ad;
    const ro = !this.canConfigure;
    const dirty = JSON.stringify(this.draft) !== JSON.stringify(this.settings);
    return html`<div class="section">
      <h3>${localizeDir(t.modeTitle)}</h3>
      <div class="row">
        <ix-button variant=${this.draft.enabled ? 'secondary' : 'primary'} ?disabled=${ro} @click=${() => (this.draft = { ...this.draft, enabled: false })}>
          ${localizeDir(t.modeManual)}
        </ix-button>
        <ix-button variant=${this.draft.enabled ? 'primary' : 'secondary'} ?disabled=${ro} @click=${() => (this.draft = { ...this.draft, enabled: true })}>
          ${localizeDir(t.modeAuto)}
        </ix-button>
      </div>
      ${this.draft.enabled
        ? html`<div class="hint">${localizeDir(t.autoHint)}</div>
            <div class="row">
              <label>${localizeDir(t.interval)}</label>
              <ix-input
                class="interval"
                type="number"
                min="60"
                .value=${String(this.draft.intervalMin)}
                ?readonly=${ro}
                @valueChange=${(e: CustomEvent<string>) => (this.draft = { ...this.draft, intervalMin: Number.parseInt(String(e.detail), 10) || 0 })}
              ></ix-input>
            </div>
            <div class="row"><strong>${localizeDir(t.scope)}</strong> <span class="muted">${localizeDir(t.scopeAll)}</span></div>
            ${this.linkedGroups.length === 0
              ? html`<div class="hint">${localizeDir(t.noLinkedGroup)}</div>`
              : html`<div class="checks">
                  ${this.linkedGroups.map(
                    (g) => html`<ix-checkbox
                      label=${g.name}
                      ?disabled=${ro}
                      .checked=${this.draft.groups.includes(g.name)}
                      @checkedChange=${(e: CustomEvent<boolean>) => this.toggleScope(g.name, e.detail)}
                    ></ix-checkbox>`
                  )}
                </div>`}`
        : nothing}
      <div class="row">
        ${this.canConfigure
          ? html`<ix-button ?disabled=${!dirty || this.draft.intervalMin < 60} @click=${() => void this.saveSettings()}>
                <ix-icon name="disk" slot="icon"></ix-icon>${localizeDir(MSG.common.save)}
              </ix-button>
              <ix-button variant="secondary" ?disabled=${this.status.running} @click=${() => void this.run()}>
                <ix-icon name="play" slot="icon"></ix-icon>${localizeDir(t.runNow)}
              </ix-button>`
          : html`<span class="muted">${localizeDir(MSG.common.readOnly)}</span>`}
        ${this.settingsSaved ? html`<span class="ok">${localizeDir(MSG.page.saved)}</span>` : nothing}
      </div>
      ${this.settingsError ? html`<div class="error">${this.settingsError}</div>` : nothing} ${this.renderReport()}
    </div>`;
  }

  private renderReport(): TemplateResult {
    const t = MSG.ad;
    const run = this.status.lastRun;
    return html`
      ${this.status.running ? html`<div class="row"><ix-spinner size="small"></ix-spinner>${localizeDir(t.running)}</div>` : nothing}
      ${run
        ? html`<div class="row">
              <strong>${localizeDir(t.lastRun)}</strong>
              ${dateLabel(run.finishedAt || run.startedAt)} (${localizeDir(run.trigger === 'auto' ? t.triggerAuto : t.triggerManual)}${run.by ? ` — ${run.by}` : ''})
            </div>
            <div class="row">
              ${fill(localize(t.report), {
                created: run.created.length,
                existing: run.skippedExisting,
                noGroup: run.skippedNoGroup,
                errors: run.errors.length
              })}
            </div>
            ${run.message === 'no-target-group' ? html`<div class="hint">${localizeDir(t.noLinkedGroup)}</div>` : nothing}
            ${run.created.length > 0 ? html`<div>${run.created.map((n) => html`<span class="tag">${n}</span>`)}</div>` : nothing}
            ${run.errors.length > 0 ? html`<div class="error">${run.errors.join('\n')}</div>` : nothing}`
        : nothing}
      ${this.settings.enabled && this.status.nextRunAt
        ? html`<div class="row"><strong>${localizeDir(t.nextRun)}</strong> ${dateLabel(this.status.nextRunAt)}</div>`
        : nothing}
    `;
  }

  private toggleScope(name: string, on: boolean): void {
    const rest = this.draft.groups.filter((g) => g !== name);
    this.draft = { ...this.draft, groups: on ? [...rest, name] : rest };
  }

  private async saveSettings(): Promise<void> {
    this.settingsError = '';
    this.settingsSaved = false;
    try {
      const res = await saveImportSettings(this.draft);
      this.settings = res.settings;
      this.draft = { ...res.settings, groups: [...res.settings.groups] };
      this.setStatus(res.status);
      this.settingsSaved = true;
    } catch (error) {
      this.settingsError = message(error);
    }
  }

  private async run(): Promise<void> {
    this.settingsError = '';
    try {
      this.setStatus((await runImport()).status);
    } catch (error) {
      this.settingsError = message(error);
    }
  }

  // ---- manual import of users / groups ----------------------------------------------------------

  private renderUsers(): TemplateResult | typeof nothing {
    if (!this.canUsers) return nothing;
    const t = MSG.ad;
    return html`<div class="section">
      <h3>${localizeDir(t.usersTitle)}</h3>
      <div class="hint">${localizeDir(t.usersHint)}</div>
      ${this.listing(
        'users',
        this.adUserList,
        this.selectedUsers,
        this.userQuery,
        (q) => (this.userQuery = q),
        (s) => (this.selectedUsers = s),
        () => void this.loadAdUsers(),
        () => void this.importUsers()
      )}
      ${this.usersMessage ? html`<div class="ok">${this.usersMessage}</div>` : nothing}
      ${this.usersError ? html`<div class="error">${this.usersError}</div>` : nothing}
    </div>`;
  }

  private renderGroups(): TemplateResult | typeof nothing {
    if (!this.canGroups) return nothing;
    const t = MSG.ad;
    return html`<div class="section">
      <h3>${localizeDir(t.groupsTitle)}</h3>
      ${this.listing(
        'groups',
        this.adGroupList,
        this.selectedGroups,
        this.groupQuery,
        (q) => (this.groupQuery = q),
        (s) => (this.selectedGroups = s),
        () => void this.loadAdGroups(),
        () => void this.importGroups()
      )}
      ${this.groupsMessage ? html`<div class="ok">${this.groupsMessage}</div>` : nothing}
      ${this.groupsError ? html`<div class="error">${this.groupsError}</div>` : nothing}
    </div>`;
  }

  // eslint-disable-next-line max-params -- one listing, two instances
  private listing(
    kind: 'users' | 'groups',
    list: AdEntry[] | null,
    selected: string[],
    query: string,
    setQuery: (q: string) => void,
    setSelected: (s: string[]) => void,
    load: () => void,
    importSelected: () => void
  ): TemplateResult {
    const t = MSG.ad;
    const rows = (list ?? []).filter((e) => (this.showImported || !e.imported) && matches(query, e.name, e.comment));
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" ?disabled=${this.busy !== ''} @click=${load}>
          <ix-icon name="refresh" slot="icon"></ix-icon>${localizeDir(t.list)}
        </ix-button>
        ${list
          ? html`<ix-input placeholder=${localize(MSG.common.search)} .value=${query} @valueChange=${(e: CustomEvent<string>) => setQuery(String(e.detail))}></ix-input>
              <ix-checkbox
                label=${localize(t.showImported)}
                .checked=${this.showImported}
                @checkedChange=${(e: CustomEvent<boolean>) => (this.showImported = e.detail)}
              ></ix-checkbox>`
          : nothing}
        <span class="grow"></span>
        ${list
          ? html`<ix-button ?disabled=${selected.length === 0 || this.busy !== ''} @click=${importSelected}>
              <ix-icon name="import" slot="icon"></ix-icon>${fill(localize(t.import), { count: selected.length })}
            </ix-button>`
          : nothing}
      </div>
      ${this.busy === kind ? html`<div class="row"><ix-spinner size="small"></ix-spinner>${localizeDir(t.listing)}</div>` : nothing}
      ${list
        ? html`<div class="scroll">
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>${localizeDir(MSG.common.name)}</th>
                  <th>${localizeDir(MSG.common.comment)}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows.length === 0 ? html`<tr><td colspan="4" class="muted">${localizeDir(MSG.common.empty)}</td></tr>` : nothing}
                ${rows.map(
                  (e) => html`<tr>
                    <td>
                      <ix-checkbox
                        ?disabled=${e.imported}
                        .checked=${selected.includes(e.name)}
                        @checkedChange=${(ev: CustomEvent<boolean>) =>
                          setSelected(ev.detail ? [...selected.filter((s) => s !== e.name), e.name] : selected.filter((s) => s !== e.name))}
                      ></ix-checkbox>
                    </td>
                    <td>${e.name}</td>
                    <td>${e.comment}</td>
                    <td>${e.imported ? html`<span class="tag ad">${localizeDir(t.imported)}</span>` : nothing}</td>
                  </tr>`
                )}
              </tbody>
            </table>
          </div>`
        : nothing}
    `;
  }

  private async loadAdUsers(): Promise<void> {
    this.busy = 'users';
    this.usersError = '';
    try {
      this.adUserList = await adUsers();
      this.selectedUsers = [];
    } catch (error) {
      this.usersError = message(error);
    } finally {
      this.busy = '';
    }
  }

  private async loadAdGroups(): Promise<void> {
    this.busy = 'groups';
    this.groupsError = '';
    try {
      this.adGroupList = await adGroups();
      this.selectedGroups = [];
    } catch (error) {
      this.groupsError = message(error);
    } finally {
      this.busy = '';
    }
  }

  private async importUsers(): Promise<void> {
    this.busy = 'users';
    this.usersError = '';
    this.usersMessage = '';
    try {
      const res = await importAdUsers(this.selectedUsers);
      this.showUsersResult(res.created, res.noGroup, res.errors);
    } catch (error) {
      this.usersError = message(error);
    } finally {
      this.busy = '';
    }
    await this.relistUsers();
    this.changed();
  }

  private showUsersResult(created: string[], noGroup: string[], errors: string[]): void {
    this.usersMessage = fill(localize(MSG.ad.result), {
      created: created.length,
      noGroup: noGroup.length,
      errors: errors.length > 0 ? ` · ${errors.length}` : ''
    });
    if (noGroup.length > 0) this.usersMessage += ` — ${noGroup.join(', ')}`;
    if (errors.length > 0) this.usersError = errors.join('\n');
  }

  /** The listing again from the manager's cache, its `imported` flags up to date. */
  private async relistUsers(): Promise<void> {
    try {
      this.adUserList = await adUsers(true);
      this.selectedUsers = [];
    } catch {
      // the import's own result is already shown
    }
  }

  private async importGroups(): Promise<void> {
    this.busy = 'groups';
    this.groupsError = '';
    this.groupsMessage = '';
    try {
      const res = await importAdGroups(this.selectedGroups);
      this.groupsMessage = fill(localize(MSG.ad.groupsResult), { created: res.created.length });
      this.adGroupList = await adGroups(true);
      this.selectedGroups = [];
    } catch (error) {
      this.groupsError = message(error);
    } finally {
      this.busy = '';
    }
    this.changed();
  }

  private changed(): void {
    this.dispatchEvent(new CustomEvent('wui:changed', { bubbles: true, composed: true }));
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
