// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Users tab: the WinCC OA users (name, full name, groups, origin AD / local,
 * active), a filter, and — with `canEdit` (role manage-users) — new, edit and
 * delete (confirmed). Emits `wui:write`; the page runs it.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@visuelconcept-winccoa/wui-kit/ui/wui-confirm-dialog.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { byName, groupNames, matches } from '../model.js';
import type { OaGroup, OaUser, WriteIntent } from '../types.js';
import { listStyles } from './styles.js';
import { confirmDeleteUser } from './us-user-dialog.js';
import './us-user-dialog.js';

@customElement('us-users')
export class UsUsers extends LitElement {
  static override readonly styles = [IXCoreStyles, listStyles()];

  @property({ attribute: false }) users: OaUser[] = [];
  @property({ attribute: false }) groups: OaGroup[] = [];
  @property({ type: Boolean }) canEdit = false;
  @property({ type: Boolean }) adMode = false;

  @state() private query = '';
  /** The user in the dialog: undefined = closed, null = a new one. */
  @state() private editing: OaUser | null | undefined = undefined;
  @state() private deleting: OaUser | null = null;

  override render(): TemplateResult {
    const c = MSG.common;
    const rows = [...this.users]
      .sort(byName)
      .filter((u) => matches(this.query, u.name, u.fullName, u.comment, ...groupNames(u, this.groups)));
    return html`
      <div class="toolbar">
        <ix-input placeholder=${localize(c.search)} .value=${this.query} @valueChange=${(e: CustomEvent<string>) => (this.query = String(e.detail))}></ix-input>
        <span class="grow"></span>
        ${this.canEdit
          ? html`<ix-button @click=${() => (this.editing = null)}><ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.users.add)}</ix-button>`
          : html`<span class="muted">${localizeDir(c.readOnly)}</span>`}
      </div>
      ${this.adMode ? html`<div class="hint">${localizeDir(MSG.users.adHint)}</div>` : nothing}
      <table>
        <thead>
          <tr>
            <th>${localizeDir(c.name)}</th>
            <th>${localizeDir(c.fullName)}</th>
            <th>${localizeDir(MSG.users.colGroups)}</th>
            <th>${localizeDir(c.origin)}</th>
            <th>${localizeDir(MSG.users.colEnabled)}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0 ? html`<tr><td colspan="6" class="muted">${localizeDir(c.empty)}</td></tr>` : nothing}
          ${rows.map((u) => this.row(u))}
        </tbody>
      </table>
      ${this.editing !== undefined
        ? html`<us-user-dialog
            .user=${this.editing}
            .groups=${this.groups}
            @wui:write=${(e: CustomEvent<WriteIntent>) => this.forward(e)}
            @wui:cancel=${() => (this.editing = undefined)}
          ></us-user-dialog>`
        : nothing}
      ${this.deleting
        ? html`<wui-confirm-dialog
            .heading=${localize(c.delete)}
            .confirmLabel=${localize(c.confirmDelete)}
            message=${confirmDeleteUser(this.deleting)}
            @wui:confirm=${() => this.deleteConfirmed()}
            @wui:cancel=${() => (this.deleting = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  private row(u: OaUser): TemplateResult {
    const c = MSG.common;
    return html`<tr class=${u.enabled ? '' : 'off'}>
      <td>${u.name}</td>
      <td>${u.fullName}</td>
      <td>${groupNames(u, this.groups).map((g) => html`<span class="tag">${g}</span>`)}</td>
      <td>${u.osId ? html`<span class="tag ad">${localizeDir(c.originAd)}</span>` : localizeDir(c.originLocal)}</td>
      <td>${localizeDir(u.enabled ? MSG.users.enabled : MSG.users.disabled)}</td>
      <td class="actions">
        ${this.canEdit
          ? html`<ix-icon-button icon="pen" variant="secondary" ghost title=${localize(c.edit)} @click=${() => (this.editing = u)}></ix-icon-button>`
          : nothing}
        ${this.canEdit && u.id !== 0
          ? html`<ix-icon-button icon="trashcan" variant="secondary" ghost title=${localize(c.delete)} @click=${() => (this.deleting = u)}></ix-icon-button>`
          : nothing}
      </td>
    </tr>`;
  }

  /** The dialog's writes go up to the page; the dialog closes (a refusal shows in the page's banner). */
  private forward(e: CustomEvent<WriteIntent>): void {
    e.stopPropagation();
    this.editing = undefined;
    this.emit(e.detail);
  }

  private deleteConfirmed(): void {
    const user = this.deleting;
    this.deleting = null;
    if (user) this.emit({ ops: [{ path: '/users/delete', body: { id: user.id } }] });
  }

  private emit(detail: WriteIntent): void {
    this.dispatchEvent(new CustomEvent('wui:write', { detail, bubbles: true, composed: true }));
  }
}
