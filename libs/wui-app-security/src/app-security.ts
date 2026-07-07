// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Application Security — Standalone page (WinCC OA WebUI Runtime).
 *
 * Discovers the ROLES each installed page module expects (declared in one
 * `AppSecurity_<module>` datapoint per module) and lets an administrator map
 * every role to WinCC OA user GROUPS. The page writes ONLY the `.assignments`
 * element; the `.roles` declaration belongs to the providing modules (self
 * registration at page load) and to the "Discover modules" seeding here.
 *
 * Enforcement: pages gate their UI live via the wui-kit `hasRole$` primitive;
 * sensitive backend routes apply the same rules server-side (requireRole).
 * Per the validated design a role with NO assigned group is OPEN to every
 * connected user — deploying this page locks nothing until roles are assigned.
 * This page protects itself with its own `manage` role.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import {
  hasRole$,
  identity$,
  registerModuleRoles,
  type AppRoleAssignments,
  type AppSecurityIdentity
} from '@visuelconcept/wui-kit/data/app-security.js';
import { MODULE_MANIFEST } from './app-security/manifest.js';
import { AppSecurityStore, type ModuleEntry, type OaGroup } from './app-security/store.js';
import { MSG, catalogCountMsg, discoveredMsg, localize, localizeDir } from './app-security/i18n.js';

/** The role editor currently open (one at a time). */
interface RoleEdit {
  module: string;
  roleId: string;
  groups: Set<string>;
  free: string;
}

export class WuiAppSecurity extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private entries: ModuleEntry[] = [];
  @state() private loading = true;
  @state() private offline = false;
  @state() private me: AppSecurityIdentity | null = null;
  @state() private meLoaded = false;
  @state() private oaGroups: OaGroup[] = [];
  @state() private canManage = true;
  @state() private edit: RoleEdit | null = null;
  @state() private info = '';

  private readonly store = new AppSecurityStore();
  private roleSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    // Self-registration: this page declares its own role like any module.
    const self = MODULE_MANIFEST.find((m) => m.module === 'app-security');
    if (self) registerModuleRoles(self);
    this.roleSub = hasRole$('app-security', 'manage').subscribe((granted) => (this.canManage = granted));
    // Reactive identity: re-emits when the shell session user changes
    // (login/logout without a SPA reload) or loads late — the banner always
    // shows the CURRENT user, never a stale or not-yet-loaded one.
    this.roleSub.add(
      identity$().subscribe((who) => {
        this.me = who;
        this.meLoaded = true;
      })
    );
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Application Security', fr: 'Sécurité applicative', 'de_AT.utf8': 'Anwendungssicherheit' }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>
        <div class="body">
          <div class="intro">${localizeDir(MSG.page.intro)}</div>
          ${this.renderMe()}
          ${this.offline ? html`<div class="notice"><ix-icon name="info"></ix-icon>${localizeDir(MSG.page.offline)}</div>` : nothing}
          ${this.meLoaded && !this.me
            ? html`<div class="notice"><ix-icon name="warning"></ix-icon>${localizeDir(MSG.page.noIdentity)}</div>`
            : nothing}
          ${this.canManage
            ? nothing
            : html`<div class="notice error"><ix-icon name="warning"></ix-icon>${localizeDir(MSG.page.forbidden)}</div>`}
          ${this.info ? html`<div class="notice ok"><ix-icon name="info"></ix-icon>${this.info}</div>` : nothing}
          ${this.renderBody()}
        </div>
      </div>
    `;
  }

  protected override firstUpdated(): void {
    void this.refresh();
    void this.store.groups().then((groups) => (this.oaGroups = groups ?? []));
  }

  private renderMe(): TemplateResult {
    if (!this.me) return html``;
    const groups = this.me.groups.length > 0 ? this.me.groups.join(', ') : localize(MSG.me.noGroups);
    return html`<div class="me">
      <ix-icon name="user" size="16"></ix-icon>
      <span>${localizeDir(MSG.me.connectedAs)} <b>${this.me.username}</b></span>
      ${this.me.admin
        ? html`<span class="chip admin">${localizeDir(MSG.me.admin)}</span>`
        : html`<span class="soft">${localizeDir(MSG.me.groups)} : ${groups}</span>`}
    </div>`;
  }

  private renderBody(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const roleCount = this.entries.reduce((sum, e) => sum + e.roles.length, 0);
    return html`
      <div class="toolbar">
        <span class="count">${catalogCountMsg(this.entries.length, roleCount)}</span>
        <span class="grow"></span>
        <ix-button variant="secondary" @click=${() => void this.refresh()}>
          <ix-icon name="refresh" slot="icon"></ix-icon>${localizeDir(MSG.page.refresh)}
        </ix-button>
        ${this.canManage
          ? html`<ix-button title=${localize(MSG.page.discoverHint)} @click=${() => void this.discover()}>
              <ix-icon name="search" slot="icon"></ix-icon>${localizeDir(MSG.page.discover)}
            </ix-button>`
          : nothing}
      </div>
      ${this.entries.length === 0
        ? html`<div class="center empty"><ix-typography>${localizeDir(MSG.page.empty)}</ix-typography></div>`
        : this.renderTable()}
    `;
  }

  private renderTable(): TemplateResult {
    return html`
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th class="col-module">${localizeDir(MSG.table.module)}</th>
              <th class="col-role">${localizeDir(MSG.table.role)}</th>
              <th>${localizeDir(MSG.table.groups)}</th>
              <th class="col-actions"></th>
            </tr>
          </thead>
          <tbody>
            ${this.entries.map((entry) => this.renderModule(entry))}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderModule(entry: ModuleEntry): TemplateResult {
    // Declared roles first, then stale assignments (assigned but no longer declared).
    const declared = new Set(entry.roles.map((r) => r.id));
    const stale = Object.keys(entry.assignments).filter((id) => !declared.has(id));
    const rows = [
      ...entry.roles.map((role) => ({ id: role.id, label: localize(role.label), description: role.description, stale: false })),
      ...stale.map((id) => ({ id, label: id, description: undefined, stale: true }))
    ];
    return html`${rows.map(
      (row, i) => html`
        <tr class=${i === rows.length - 1 ? 'module-end' : ''}>
          ${i === 0
            ? html`<td class="col-module" rowspan=${rows.length}>
                <div class="module-name">${entry.title ? localize(entry.title) : entry.module}</div>
                <div class="module-id">${entry.module}</div>
              </td>`
            : nothing}
          <td class="col-role">
            <div class="role-label">${row.label}</div>
            ${row.description ? html`<div class="role-desc">${localize(row.description)}</div>` : nothing}
            ${row.stale ? html`<div class="role-stale"><ix-icon name="warning" size="12"></ix-icon> ${localizeDir(MSG.table.stale)}</div>` : nothing}
          </td>
          ${this.isEditing(entry.module, row.id) ? this.renderEditor(entry) : this.renderAssignment(entry, row.id)}
        </tr>
      `
    )}`;
  }

  private renderAssignment(entry: ModuleEntry, roleId: string): TemplateResult {
    const groups = entry.assignments[roleId] ?? [];
    return html`
      <td>
        ${groups.length === 0
          ? html`<span class="open">${localizeDir(MSG.table.openToAll)}</span>`
          : groups.map((g) => html`<span class="chip">${g}</span>`)}
      </td>
      <td class="col-actions">
        ${this.canManage
          ? html`<ix-icon-button
              ghost
              size="16"
              icon="pen"
              title=${localize(MSG.table.edit)}
              @click=${() => this.beginEdit(entry, roleId)}
            ></ix-icon-button>`
          : nothing}
      </td>
    `;
  }

  // eslint-disable-next-line max-lines-per-function -- single editor template
  private renderEditor(entry: ModuleEntry): TemplateResult {
    const edit = this.edit!;
    const known = new Set(this.oaGroups.map((g) => g.name));
    const extra = [...edit.groups].filter((g) => !known.has(g));
    return html`
      <td colspan="2">
        <div class="editor">
          ${this.oaGroups.length === 0 && extra.length === 0
            ? html`<div class="hint-empty"><ix-icon name="info" size="14"></ix-icon>${localizeDir(MSG.table.noDirectory)}</div>`
            : nothing}
          <div class="checks">
            ${this.oaGroups.map(
              (g) => html`<label class="check">
                <input
                  type="checkbox"
                  ?checked=${edit.groups.has(g.name)}
                  @change=${(e: Event) => this.toggleGroup(g.name, (e.target as HTMLInputElement).checked)}
                />
                <span>${g.name}</span>
              </label>`
            )}
            ${extra.map(
              (g) => html`<label class="check">
                <input type="checkbox" checked @change=${(e: Event) => this.toggleGroup(g, (e.target as HTMLInputElement).checked)} />
                <span>${g} *</span>
              </label>`
            )}
          </div>
          <div class="free-row">
            <input
              class="in"
              placeholder=${localize(MSG.table.addGroupPlaceholder)}
              .value=${edit.free}
              @input=${(e: Event) => (this.edit = { ...edit, free: (e.target as HTMLInputElement).value })}
              @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.addFreeGroup()}
            />
            <ix-button variant="secondary" @click=${() => this.addFreeGroup()}>${localizeDir(MSG.table.add)}</ix-button>
          </div>
          <div class="editor-actions">
            <ix-button variant="secondary" @click=${() => (this.edit = null)}>${localizeDir(MSG.table.cancel)}</ix-button>
            <ix-button variant="secondary" @click=${() => void this.saveEdit(entry, true)}>${localizeDir(MSG.table.clear)}</ix-button>
            <ix-button @click=${() => void this.saveEdit(entry, false)}>
              <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.table.save)}
            </ix-button>
          </div>
        </div>
      </td>
    `;
  }

  // --- actions ----------------------------------------------------------------

  private isEditing(module: string, roleId: string): boolean {
    return this.edit?.module === module && this.edit.roleId === roleId;
  }

  private beginEdit(entry: ModuleEntry, roleId: string): void {
    this.info = '';
    this.edit = { module: entry.module, roleId, groups: new Set(entry.assignments[roleId] ?? []), free: '' };
    // The group directory may have become available since page load (backend
    // deployed later) — retry when the picker is actually needed.
    if (this.oaGroups.length === 0) {
      void this.store.groups().then((groups) => (this.oaGroups = groups ?? []));
    }
  }

  private toggleGroup(name: string, on: boolean): void {
    if (!this.edit) return;
    const groups = new Set(this.edit.groups);
    if (on) groups.add(name);
    else groups.delete(name);
    this.edit = { ...this.edit, groups };
  }

  private addFreeGroup(): void {
    if (!this.edit) return;
    const name = this.edit.free.trim();
    if (!name) return;
    const groups = new Set(this.edit.groups);
    groups.add(name);
    this.edit = { ...this.edit, groups, free: '' };
  }

  private async saveEdit(entry: ModuleEntry, clear: boolean): Promise<void> {
    const edit = this.edit;
    if (!edit) return;
    const next: AppRoleAssignments = { ...entry.assignments };
    const groups = clear ? [] : [...edit.groups].sort((a, b) => a.localeCompare(b));
    if (groups.length === 0) delete next[edit.roleId];
    else next[edit.roleId] = groups;
    await this.store.saveAssignments(entry, next);
    this.offline = this.store.offline;
    this.edit = null;
    this.entries = [...this.entries];
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.info = '';
    this.entries = await this.store.list();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private async discover(): Promise<void> {
    this.loading = true;
    const count = await this.store.discover();
    this.info = discoveredMsg(count);
    this.offline = this.store.offline;
    this.entries = await this.store.list();
    this.loading = false;
  }
}

if (!customElements.get('wui-app-security')) {
  customElements.define('wui-app-security', WuiAppSecurity);
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
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
      overflow: hidden;
    }
    .intro {
      color: var(--theme-color-soft-text);
      font-size: 0.88rem;
      margin: 0.4rem 0;
    }
    .me {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
    }
    .me .soft {
      color: var(--theme-color-soft-text);
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
    }
    .toolbar .grow {
      flex: 1;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.9rem;
    }
    .scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.88rem;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      text-align: left;
      padding: 0.5rem 0.6rem;
      background: var(--theme-color-2);
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
    }
    td {
      padding: 0.45rem 0.6rem;
      border-bottom: 1px solid color-mix(in srgb, var(--theme-color-soft-bdr) 45%, transparent);
      vertical-align: top;
    }
    tr.module-end td {
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .col-module {
      width: 220px;
    }
    .col-role {
      width: 320px;
    }
    .col-actions {
      width: 44px;
      text-align: right;
    }
    .module-name {
      font-weight: 600;
    }
    .module-id {
      color: var(--theme-color-soft-text);
      font-size: 0.78rem;
      font-family: monospace;
    }
    .role-label {
      font-weight: 500;
    }
    .role-desc {
      color: var(--theme-color-soft-text);
      font-size: 0.78rem;
    }
    .role-stale {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      color: var(--theme-color-warning);
      font-size: 0.76rem;
    }
    .open {
      color: var(--theme-color-soft-text);
      font-style: italic;
    }
    .chip {
      display: inline-block;
      padding: 0.1rem 0.5rem;
      margin: 0 0.25rem 0.25rem 0;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 999px;
      background: var(--theme-color-2);
      font-size: 0.8rem;
    }
    .chip.admin {
      border-color: var(--theme-color-warning);
      color: var(--theme-color-warning);
    }
    .editor {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .hint-empty {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      color: var(--theme-color-soft-text);
      font-size: 0.8rem;
    }
    .checks {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem 1rem;
      max-height: 10rem;
      overflow-y: auto;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.85rem;
      cursor: pointer;
    }
    .free-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .in {
      box-sizing: border-box;
      width: 16rem;
      padding: 0.35rem 0.5rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
    }
    .editor-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      border: 1px solid var(--theme-color-warning);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-warning);
      background: color-mix(in srgb, var(--theme-color-warning) 12%, transparent);
    }
    .notice.error {
      border-color: var(--theme-color-alarm);
      color: var(--theme-color-alarm);
      background: color-mix(in srgb, var(--theme-color-alarm) 12%, transparent);
    }
    .notice.ok {
      border-color: var(--theme-color-success, #2fd44f);
      color: var(--theme-color-success, #2fd44f);
      background: color-mix(in srgb, var(--theme-color-success, #2fd44f) 12%, transparent);
    }
    .center {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
    }
    .empty {
      color: var(--theme-color-soft-text);
    }
  `;
}
