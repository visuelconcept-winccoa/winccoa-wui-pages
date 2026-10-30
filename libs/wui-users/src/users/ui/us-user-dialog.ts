// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Create or edit one WinCC OA user: name, full name, comment, language, active,
 * groups, and the password of a LOCAL user (an AD user's password is the AD's).
 * Emits `wui:write` with the writes to run (an update, then the password when one
 * was typed) and `wui:cancel`. Presentational: the page runs the writes.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type CSSResult, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { dialogCore } from '@visuelconcept-winccoa/wui-kit/ui/dialog-styles.js';
import { MSG, fill, localize, localizeDir } from '../i18n.js';
import { byName, changedFields, isValidName, toggleId } from '../model.js';
import type { OaGroup, OaUser, WriteIntent, WriteOp } from '../types.js';

interface IxValueEvent {
  detail: string | number;
}

@customElement('us-user-dialog')
export class UsUserDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  /** The user to edit; null for a new (local) user. */
  @property({ attribute: false }) user: OaUser | null = null;
  @property({ attribute: false }) groups: OaGroup[] = [];

  @state() private name = '';
  @state() private fullName = '';
  @state() private comment = '';
  @state() private language = '';
  @state() private enabled = true;
  @state() private groupIds: number[] = [];
  @state() private password = '';
  @state() private confirm = '';

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('user') && this.user) {
      this.name = this.user.name;
      this.fullName = this.user.fullName;
      this.comment = this.user.comment;
      this.language = this.user.language;
      this.enabled = this.user.enabled;
      this.groupIds = [...this.user.groupIds];
    }
  }

  private get isRoot(): boolean {
    return this.user?.id === 0;
  }

  /** A user of the Active Directory: no WinCC OA password. */
  private get isAd(): boolean {
    return (this.user?.osId ?? '') !== '';
  }

  override render(): TemplateResult {
    const t = MSG.userDialog;
    const c = MSG.common;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(this.user ? t.titleEdit : t.titleNew)}</ix-typography>
            ${this.isAd ? html`<span class="tag">${localizeDir(c.originAd)}</span>` : nothing}
          </div>
          <div class="panel-body">
            <div class="grid2">
              ${this.text(c.name, this.name, (v) => (this.name = v), this.isRoot)}
              ${this.text(c.fullName, this.fullName, (v) => (this.fullName = v))}
            </div>
            <div class="grid2">
              ${this.text(c.comment, this.comment, (v) => (this.comment = v))}
              ${this.text(t.language, this.language, (v) => (this.language = v), false, 'fr_FR.utf8')}
            </div>
            <ix-checkbox
              label=${localize(t.enabled)}
              .checked=${this.enabled}
              ?disabled=${this.isRoot}
              @checkedChange=${(e: CustomEvent<boolean>) => (this.enabled = e.detail)}
            ></ix-checkbox>
            ${this.isRoot ? html`<div class="hint">${localizeDir(t.rootHint)}</div>` : nothing}

            <div class="subhead">${localizeDir(this.user ? t.newPassword : t.password)}</div>
            ${this.isAd
              ? html`<div class="hint">${localizeDir(t.adPassword)}</div>`
              : html`<div class="grid2">
                    ${this.text(this.user ? t.newPassword : t.password, this.password, (v) => (this.password = v), false, '', 'password')}
                    ${this.text(t.confirm, this.confirm, (v) => (this.confirm = v), false, '', 'password')}
                  </div>
                  ${this.password !== this.confirm && this.confirm !== '' ? html`<div class="error">${localizeDir(t.mismatch)}</div>` : nothing}
                  <div class="hint">${localizeDir(t.policy)}</div>`}

            <div class="subhead">${localizeDir(t.groups)}</div>
            <div class="checks">
              ${[...this.groups].sort(byName).map(
                (g) => html`<ix-checkbox
                  label=${g.osId ? `${g.name} (AD)` : g.name}
                  .checked=${this.groupIds.includes(g.id)}
                  @checkedChange=${(e: CustomEvent<boolean>) => (this.groupIds = toggleId(this.groupIds, g.id, e.detail))}
                ></ix-checkbox>`
              )}
            </div>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(c.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${!this.isValid()}>
              <ix-icon name=${this.user ? 'disk' : 'plus'} slot="icon"></ix-icon>${localizeDir(this.user ? c.save : c.add)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private text(
    label: typeof MSG.common.name,
    value: string,
    set: (v: string) => void,
    readonly = false,
    placeholder = '',
    type = 'text'
  ): TemplateResult {
    return html`<div class="field">
      <label>${localizeDir(label)}</label>
      <ix-input
        type=${type}
        placeholder=${placeholder}
        .value=${value}
        ?readonly=${readonly}
        @valueChange=${(e: IxValueEvent) => set(String(e.detail))}
      ></ix-input>
    </div>`;
  }

  private isValid(): boolean {
    if (!isValidName(this.name)) return false;
    if (this.password !== this.confirm) return false;
    // A new user is local: the password policy of the project requires one.
    return this.user !== null || this.password !== '';
  }

  private save(): void {
    if (!this.isValid()) return;
    const fields = {
      name: this.name,
      fullName: this.fullName,
      comment: this.comment,
      language: this.language,
      enabled: this.enabled,
      groupIds: this.groupIds
    };
    const ops: WriteOp[] = [];
    if (this.user === null) {
      ops.push({ path: '/users/create', body: { ...fields, password: this.password } });
    } else {
      const changed: Record<string, unknown> = changedFields(this.user, fields);
      if (this.isRoot) {
        delete changed.name;
        delete changed.enabled;
      }
      if (Object.keys(changed).length > 0) ops.push({ path: '/users/update', body: { id: this.user.id, ...changed } });
      if (!this.isAd && this.password !== '') ops.push({ path: '/users/password', body: { id: this.user.id, password: this.password } });
    }
    if (ops.length === 0) {
      this.cancel();
      return;
    }
    const detail: WriteIntent = { ops };
    this.dispatchEvent(new CustomEvent('wui:write', { detail, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

/** The confirmation of a user's deletion (used by the users tab). */
export function confirmDeleteUser(user: OaUser): string {
  return fill(localize(MSG.users.confirmDelete), { name: user.name });
}

function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 640px;
    }
    .checks {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 0.2rem 0.75rem;
    }
    .error {
      color: var(--theme-color-alarm);
      font-size: 0.85rem;
    }
    .tag {
      padding: 0.05rem 0.5rem;
      border-radius: 999px;
      font-size: 0.75rem;
      border: 1px solid var(--theme-color-primary);
    }
  `;
}
