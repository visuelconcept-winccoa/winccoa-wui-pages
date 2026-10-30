// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Domains tab (WinCC OA "areas"): name, full name, comment, default permission
 * bits and the groups using each domain; with `canEdit` (role manage-groups) new,
 * edit and delete (confirmed). A group's own bits per domain are set on the group.
 * Emits `wui:write`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type CSSResult, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { dialogCore } from '@visuelconcept-winccoa/wui-kit/ui/dialog-styles.js';
import '@visuelconcept-winccoa/wui-kit/ui/wui-confirm-dialog.js';
import { MSG, fill, localize, localizeDir } from '../i18n.js';
import { bitsSummary, byName, changedFields, emptyBits, isValidName, normalizeBits } from '../model.js';
import type { OaArea, OaGroup, PermissionBits, WriteIntent } from '../types.js';
import { listStyles } from './styles.js';
import './us-bits.js';

@customElement('us-areas')
export class UsAreas extends LitElement {
  static override readonly styles = [IXCoreStyles, listStyles()];

  @property({ attribute: false }) areas: OaArea[] = [];
  @property({ attribute: false }) groups: OaGroup[] = [];
  @property({ attribute: false }) permissionNames: string[] = [];
  @property({ type: Boolean }) canEdit = false;

  @state() private editing: OaArea | null | undefined = undefined;
  @state() private deleting: OaArea | null = null;

  private groupsOf(area: OaArea): OaGroup[] {
    return this.groups.filter((g) => g.areas.some((a) => a.id === area.id));
  }

  override render(): TemplateResult {
    const c = MSG.common;
    const rows = [...this.areas].sort(byName);
    return html`
      <div class="toolbar">
        <span class="grow"></span>
        ${this.canEdit
          ? html`<ix-button @click=${() => (this.editing = null)}><ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.areas.add)}</ix-button>`
          : html`<span class="muted">${localizeDir(c.readOnly)}</span>`}
      </div>
      <table>
        <thead>
          <tr>
            <th>${localizeDir(c.name)}</th>
            <th>${localizeDir(c.fullName)}</th>
            <th>${localizeDir(c.comment)}</th>
            <th>${localizeDir(c.permissions)}</th>
            <th>${localizeDir(MSG.areas.colGroups)}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${rows.length === 0 ? html`<tr><td colspan="6" class="muted">${localizeDir(c.empty)}</td></tr>` : nothing}
          ${rows.map(
            (a) => html`<tr>
              <td>${a.name}</td>
              <td>${a.fullName}</td>
              <td>${a.comment}</td>
              <td>${bitsSummary(a.permissions)}</td>
              <td>${this.groupsOf(a).map((g) => html`<span class="tag">${g.name}</span>`)}</td>
              <td class="actions">
                ${this.canEdit
                  ? html`<ix-icon-button icon="pen" variant="secondary" ghost title=${localize(c.edit)} @click=${() => (this.editing = a)}></ix-icon-button>
                      <ix-icon-button icon="trashcan" variant="secondary" ghost title=${localize(c.delete)} @click=${() => (this.deleting = a)}></ix-icon-button>`
                  : nothing}
              </td>
            </tr>`
          )}
        </tbody>
      </table>
      ${this.editing !== undefined
        ? html`<us-area-dialog
            .area=${this.editing}
            .permissionNames=${this.permissionNames}
            @wui:write=${(e: CustomEvent<WriteIntent>) => this.forward(e)}
            @wui:cancel=${() => (this.editing = undefined)}
          ></us-area-dialog>`
        : nothing}
      ${this.deleting
        ? html`<wui-confirm-dialog
            .heading=${localize(c.delete)}
            .confirmLabel=${localize(c.confirmDelete)}
            message=${fill(localize(MSG.areas.confirmDelete), { name: this.deleting.name, count: this.groupsOf(this.deleting).length })}
            @wui:confirm=${() => this.deleteConfirmed()}
            @wui:cancel=${() => (this.deleting = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  private forward(e: CustomEvent<WriteIntent>): void {
    e.stopPropagation();
    this.editing = undefined;
    this.emit(e.detail);
  }

  private deleteConfirmed(): void {
    const area = this.deleting;
    this.deleting = null;
    if (area) this.emit({ ops: [{ path: '/areas/delete', body: { id: area.id } }] });
  }

  private emit(detail: WriteIntent): void {
    this.dispatchEvent(new CustomEvent('wui:write', { detail, bubbles: true, composed: true }));
  }
}

@customElement('us-area-dialog')
export class UsAreaDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, areaDialogStyles()];

  @property({ attribute: false }) area: OaArea | null = null;
  @property({ attribute: false }) permissionNames: string[] = [];

  @state() private name = '';
  @state() private fullName = '';
  @state() private comment = '';
  @state() private permissions: PermissionBits = emptyBits();

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('area') && this.area) {
      this.name = this.area.name;
      this.fullName = this.area.fullName;
      this.comment = this.area.comment;
      this.permissions = normalizeBits(this.area.permissions);
    }
  }

  override render(): TemplateResult {
    const c = MSG.common;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(this.area ? MSG.areas.titleEdit : MSG.areas.titleNew)}</ix-typography>
          </div>
          <div class="panel-body">
            <div class="grid3">
              ${this.text(c.name, this.name, (v) => (this.name = v))}
              ${this.text(c.fullName, this.fullName, (v) => (this.fullName = v))}
              ${this.text(c.comment, this.comment, (v) => (this.comment = v))}
            </div>
            <div class="subhead">${localizeDir(MSG.areas.defaultBits)}</div>
            <us-bits
              .bits=${this.permissions}
              .names=${this.permissionNames}
              @wui:bitschange=${(e: CustomEvent<PermissionBits>) => (this.permissions = e.detail)}
            ></us-bits>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(c.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${!isValidName(this.name)}>
              <ix-icon name=${this.area ? 'disk' : 'plus'} slot="icon"></ix-icon>${localizeDir(this.area ? c.save : c.add)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private text(label: typeof MSG.common.name, value: string, set: (v: string) => void): TemplateResult {
    return html`<div class="field">
      <label>${localizeDir(label)}</label>
      <ix-input .value=${value} @valueChange=${(e: CustomEvent<string>) => set(String(e.detail))}></ix-input>
    </div>`;
  }

  private save(): void {
    if (!isValidName(this.name)) return;
    const fields = { name: this.name, fullName: this.fullName, comment: this.comment, permissions: this.permissions };
    let detail: WriteIntent;
    if (this.area === null) {
      detail = { ops: [{ path: '/areas/create', body: fields }] };
    } else {
      const changed = changedFields(this.area, fields);
      if (Object.keys(changed).length === 0) {
        this.cancel();
        return;
      }
      detail = { ops: [{ path: '/areas/update', body: { id: this.area.id, ...changed } }] };
    }
    this.dispatchEvent(new CustomEvent('wui:write', { detail, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function areaDialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 760px;
    }
  `;
}
