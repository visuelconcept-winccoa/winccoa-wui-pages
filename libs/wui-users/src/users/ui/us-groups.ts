// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Groups tab: the WinCC OA groups (origin, system permissions, domains, members),
 * and — with `canEdit` (role manage-groups) — new, edit (us-group-dialog),
 * delete (confirmed) and the permission names. Emits `wui:write`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@visuelconcept-winccoa/wui-kit/ui/wui-confirm-dialog.js';
import { MSG, fill, localize, localizeDir } from '../i18n.js';
import { bitsSummary, byName, matches, memberIds } from '../model.js';
import type { OaArea, OaGroup, OaUser, WriteIntent } from '../types.js';
import { listStyles } from './styles.js';
import './us-group-dialog.js';
import './us-names-dialog.js';

@customElement('us-groups')
export class UsGroups extends LitElement {
  static override readonly styles = [IXCoreStyles, listStyles()];

  @property({ attribute: false }) groups: OaGroup[] = [];
  @property({ attribute: false }) areas: OaArea[] = [];
  @property({ attribute: false }) users: OaUser[] = [];
  @property({ attribute: false }) permissionNames: string[] = [];
  @property({ type: Boolean }) canEdit = false;

  @state() private query = '';
  @state() private editing: OaGroup | null | undefined = undefined;
  @state() private deleting: OaGroup | null = null;
  @state() private namesOpen = false;

  override render(): TemplateResult {
    const c = MSG.common;
    const rows = [...this.groups].sort(byName).filter((g) => matches(this.query, g.name, g.fullName, g.comment));
    return html`
      <div class="toolbar">
        <ix-input placeholder=${localize(c.search)} .value=${this.query} @valueChange=${(e: CustomEvent<string>) => (this.query = String(e.detail))}></ix-input>
        <span class="grow"></span>
        ${this.canEdit
          ? html`<ix-button variant="secondary" @click=${() => (this.namesOpen = true)}>
                <ix-icon name="rename" slot="icon"></ix-icon>${localizeDir(MSG.groups.names)}
              </ix-button>
              <ix-button @click=${() => (this.editing = null)}><ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.groups.add)}</ix-button>`
          : html`<span class="muted">${localizeDir(c.readOnly)}</span>`}
      </div>
      <table>
        <thead>
          <tr>
            <th>${localizeDir(c.name)}</th>
            <th>${localizeDir(c.fullName)}</th>
            <th>${localizeDir(c.origin)}</th>
            <th>${localizeDir(c.permissions)}</th>
            <th>${localizeDir(MSG.groups.colAreas)}</th>
            <th>${localizeDir(MSG.groups.colMembers)}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0 ? html`<tr><td colspan="7" class="muted">${localizeDir(c.empty)}</td></tr>` : nothing}
          ${rows.map((g) => this.row(g))}
        </tbody>
      </table>
      ${this.renderDialogs()}
    `;
  }

  private row(g: OaGroup): TemplateResult {
    const c = MSG.common;
    const areaNames = g.areas.map((a) => this.areas.find((x) => x.id === a.id)?.name ?? `#${a.id}`);
    return html`<tr>
      <td>${g.name}</td>
      <td>${g.fullName}</td>
      <td>${g.osId ? html`<span class="tag ad">${localizeDir(c.originAd)}</span>` : localizeDir(c.originLocal)}</td>
      <td>${bitsSummary(g.permissions)}</td>
      <td>${areaNames.map((n) => html`<span class="tag">${n}</span>`)}</td>
      <td>${memberIds(g, this.users).length}</td>
      <td class="actions">
        ${this.canEdit
          ? html`<ix-icon-button icon="pen" variant="secondary" ghost title=${localize(c.edit)} @click=${() => (this.editing = g)}></ix-icon-button>
              <ix-icon-button icon="trashcan" variant="secondary" ghost title=${localize(c.delete)} @click=${() => (this.deleting = g)}></ix-icon-button>`
          : nothing}
      </td>
    </tr>`;
  }

  private renderDialogs(): TemplateResult {
    const c = MSG.common;
    return html`
      ${this.editing !== undefined
        ? html`<us-group-dialog
            .group=${this.editing}
            .areas=${this.areas}
            .users=${this.users}
            .permissionNames=${this.permissionNames}
            @wui:write=${(e: CustomEvent<WriteIntent>) => this.forward(e)}
            @wui:cancel=${() => (this.editing = undefined)}
          ></us-group-dialog>`
        : nothing}
      ${this.namesOpen
        ? html`<us-names-dialog
            .names=${this.permissionNames}
            @wui:write=${(e: CustomEvent<WriteIntent>) => this.forward(e)}
            @wui:cancel=${() => (this.namesOpen = false)}
          ></us-names-dialog>`
        : nothing}
      ${this.deleting
        ? html`<wui-confirm-dialog
            .heading=${localize(c.delete)}
            .confirmLabel=${localize(c.confirmDelete)}
            message=${fill(localize(MSG.groups.confirmDelete), { name: this.deleting.name, count: memberIds(this.deleting, this.users).length })}
            @wui:confirm=${() => this.deleteConfirmed()}
            @wui:cancel=${() => (this.deleting = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  private forward(e: CustomEvent<WriteIntent>): void {
    e.stopPropagation();
    this.editing = undefined;
    this.namesOpen = false;
    this.emit(e.detail);
  }

  private deleteConfirmed(): void {
    const group = this.deleting;
    this.deleting = null;
    if (group) this.emit({ ops: [{ path: '/groups/delete', body: { id: group.id } }] });
  }

  private emit(detail: WriteIntent): void {
    this.dispatchEvent(new CustomEvent('wui:write', { detail, bubbles: true, composed: true }));
  }
}
