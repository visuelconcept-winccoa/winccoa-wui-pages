// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Create or edit one group, as the WinCC OA user administration does: name, full
 * name, comment, its 32 system permission bits, its domains with their own bits,
 * and its members. Emits `wui:write` (one create or update carrying only what
 * changed) and `wui:cancel`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type CSSResult, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { dialogCore } from '@visuelconcept-winccoa/wui-kit/ui/dialog-styles.js';
import { MSG, fill, localize, localizeDir } from '../i18n.js';
import { byName, changedFields, emptyBits, isValidName, memberIds, normalizeBits, toggleId } from '../model.js';
import type { GroupArea, OaArea, OaGroup, OaUser, PermissionBits, WriteIntent } from '../types.js';
import './us-bits.js';

interface IxValueEvent {
  detail: string | number;
}

@customElement('us-group-dialog')
export class UsGroupDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  /** The group to edit; null for a new one. */
  @property({ attribute: false }) group: OaGroup | null = null;
  @property({ attribute: false }) areas: OaArea[] = [];
  @property({ attribute: false }) users: OaUser[] = [];
  @property({ attribute: false }) permissionNames: string[] = [];

  @state() private name = '';
  @state() private fullName = '';
  @state() private comment = '';
  @state() private permissions: PermissionBits = emptyBits();
  @state() private groupAreas: GroupArea[] = [];
  @state() private members: number[] = [];

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('group') && this.group) {
      this.name = this.group.name;
      this.fullName = this.group.fullName;
      this.comment = this.group.comment;
      this.permissions = normalizeBits(this.group.permissions);
      this.groupAreas = this.group.areas.map((a) => ({ id: a.id, permissions: normalizeBits(a.permissions) }));
      this.members = memberIds(this.group, this.users);
    }
  }

  override render(): TemplateResult {
    const t = MSG.groupDialog;
    const c = MSG.common;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(this.group ? t.titleEdit : t.titleNew)}</ix-typography>
          </div>
          <div class="panel-body">
            ${this.group?.osId ? html`<div class="hint">${fill(localize(t.adGroup), { osId: this.group.osId })}</div>` : nothing}
            <div class="grid3">
              ${this.text(c.name, this.name, (v) => (this.name = v))}
              ${this.text(c.fullName, this.fullName, (v) => (this.fullName = v))}
              ${this.text(c.comment, this.comment, (v) => (this.comment = v))}
            </div>

            <div class="subhead">${localizeDir(t.permissions)}</div>
            <us-bits
              .bits=${this.permissions}
              .names=${this.permissionNames}
              @wui:bitschange=${(e: CustomEvent<PermissionBits>) => (this.permissions = e.detail)}
            ></us-bits>

            <div class="subhead">${localizeDir(t.areas)}</div>
            <div class="hint">${localizeDir(t.areasHint)}</div>
            ${this.areas.length === 0 ? html`<div class="hint">${localizeDir(c.none)}</div>` : nothing}
            ${[...this.areas].sort(byName).map((a) => this.areaCard(a))}

            <div class="subhead">${localizeDir(t.members)}</div>
            <div class="checks">
              ${[...this.users].sort(byName).map(
                (u) => html`<ix-checkbox
                  label=${u.fullName ? `${u.name} (${u.fullName})` : u.name}
                  .checked=${this.members.includes(u.id)}
                  @checkedChange=${(e: CustomEvent<boolean>) => (this.members = toggleId(this.members, u.id, e.detail))}
                ></ix-checkbox>`
              )}
            </div>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(c.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${!isValidName(this.name)}>
              <ix-icon name=${this.group ? 'disk' : 'plus'} slot="icon"></ix-icon>${localizeDir(this.group ? c.save : c.add)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private areaCard(area: OaArea): TemplateResult {
    const entry = this.groupAreas.find((a) => a.id === area.id);
    return html`<div class="card">
      <ix-checkbox
        label=${area.fullName && area.fullName !== area.name ? `${area.name} (${area.fullName})` : area.name}
        .checked=${entry !== undefined}
        @checkedChange=${(e: CustomEvent<boolean>) => this.toggleArea(area, e.detail)}
      ></ix-checkbox>
      ${entry
        ? html`<us-bits
            .bits=${entry.permissions}
            .names=${this.permissionNames}
            @wui:bitschange=${(e: CustomEvent<PermissionBits>) => this.setAreaBits(area.id, e.detail)}
          ></us-bits>`
        : nothing}
    </div>`;
  }

  /** A domain added starts with its default bits (as UserManagementBaseType.addArea). */
  private toggleArea(area: OaArea, on: boolean): void {
    const rest = this.groupAreas.filter((a) => a.id !== area.id);
    this.groupAreas = on ? [...rest, { id: area.id, permissions: normalizeBits(area.permissions) }] : rest;
  }

  private setAreaBits(id: number, bits: PermissionBits): void {
    this.groupAreas = this.groupAreas.map((a) => (a.id === id ? { id, permissions: bits } : a));
  }

  private text(label: typeof MSG.common.name, value: string, set: (v: string) => void): TemplateResult {
    return html`<div class="field">
      <label>${localizeDir(label)}</label>
      <ix-input .value=${value} @valueChange=${(e: IxValueEvent) => set(String(e.detail))}></ix-input>
    </div>`;
  }

  private save(): void {
    if (!isValidName(this.name)) return;
    const fields = {
      name: this.name,
      fullName: this.fullName,
      comment: this.comment,
      permissions: this.permissions,
      areas: [...this.groupAreas].sort((a, b) => a.id - b.id)
    };
    let detail: WriteIntent;
    if (this.group === null) {
      detail = { ops: [{ path: '/groups/create', body: { ...fields, memberIds: this.members } }] };
    } else {
      const before = { ...this.group, areas: [...this.group.areas].sort((a, b) => a.id - b.id) };
      const changed: Record<string, unknown> = changedFields(before, fields);
      const beforeMembers = memberIds(this.group, this.users).sort((a, b) => a - b);
      const members = [...this.members].sort((a, b) => a - b);
      if (JSON.stringify(beforeMembers) !== JSON.stringify(members)) changed.memberIds = members;
      if (Object.keys(changed).length === 0) {
        this.cancel();
        return;
      }
      detail = { ops: [{ path: '/groups/update', body: { id: this.group.id, ...changed } }] };
    }
    this.dispatchEvent(new CustomEvent('wui:write', { detail, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 860px;
    }
    .checks {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 0.2rem 0.75rem;
    }
    .card us-bits {
      margin-top: 0.4rem;
    }
  `;
}
