// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to create or edit one VNC connection: identity (name/group),
 * target (host/port), the optional stored password, a description and the RFB
 * options (read-only, shared). Emits `wui:save` / `wui:cancel`.
 *
 * The password is write-only (the backend never sends it back): when editing,
 * the field starts empty and `password` stays absent from the saved detail —
 * the stored one is kept — unless the user types a new one or removes it
 * (empty string).
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import {
  DEFAULT_CONNECT_TIMEOUT_SEC,
  DEFAULT_RECONNECT_DELAY_SEC,
  DEFAULT_VNC_PORT,
  blankConnection,
  type VncConnection
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string | number;
}

@customElement('rv-connection-dialog')
export class RvConnectionDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  /** Connection to edit; when null the dialog creates a new one. */
  @property({ attribute: false }) connection: VncConnection | null = null;

  @state() private working: VncConnection = blankConnection();
  @state() private showPassword = false;

  // eslint-disable-next-line max-lines-per-function -- single form template
  override render(): TemplateResult {
    const isNew = !this.connection;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${isNew
                ? localizeDir(MSG.dialog.newConnection)
                : html`${localizeDir(MSG.dialog.editPrefix)} — ${this.working.name}`}
            </ix-typography>
          </div>

          <div class="panel-body">
            <div class="grid2">
              ${this.textField(MSG.dialog.fName, 'name')} ${this.textField(MSG.dialog.fGroup, 'group')}
            </div>
            <div class="grid2">
              ${this.textField(MSG.dialog.fHost, 'host')}
              <div class="field">
                <label>${localizeDir(MSG.dialog.fPort)}</label>
                <ix-number-input
                  .value=${this.working.port}
                  @valueChange=${(e: IxValueEvent) =>
                    this.patch({ port: Number(e.detail) || DEFAULT_VNC_PORT })}
                ></ix-number-input>
              </div>
            </div>

            <div class="field">
              <label>${localizeDir(MSG.dialog.fPassword)}</label>
              <div class="pw-row">
                <input
                  class="pw"
                  .type=${this.showPassword ? 'text' : 'password'}
                  autocomplete="new-password"
                  placeholder=${this.keepsPassword() ? localize(MSG.dialog.passwordKept) : ''}
                  .value=${this.working.password ?? ''}
                  @input=${(e: Event) => this.onPasswordInput((e.target as HTMLInputElement).value)}
                />
                <ix-button
                  variant="secondary"
                  outline
                  @click=${() => (this.showPassword = !this.showPassword)}
                >
                  <ix-icon name="eye" slot="icon"></ix-icon>
                  ${this.showPassword ? localizeDir(MSG.dialog.hide) : localizeDir(MSG.dialog.show)}
                </ix-button>
              </div>
              ${this.renderPasswordRemoval()}
              <div class="warn">
                <ix-icon name="warning"></ix-icon>${localizeDir(MSG.dialog.passwordWarning)}
              </div>
            </div>

            <div class="field">
              <label>${localizeDir(MSG.dialog.fDescription)}</label>
              <ix-input
                .value=${this.working.description}
                @valueChange=${(e: IxValueEvent) => this.patch({ description: String(e.detail) })}
              ></ix-input>
            </div>

            <div class="subhead">${localizeDir(MSG.dialog.secSession)}</div>
            <div class="toggle-row">
              <span>${localizeDir(MSG.dialog.viewOnly)}</span>
              <ix-toggle
                hide-text
                ?checked=${this.working.viewOnly}
                @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ viewOnly: e.detail })}
              ></ix-toggle>
            </div>
            <div class="toggle-row">
              <span>${localizeDir(MSG.dialog.shared)}</span>
              <ix-toggle
                hide-text
                ?checked=${this.working.shared}
                @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ shared: e.detail })}
              ></ix-toggle>
            </div>

            <div class="subhead">${localizeDir(MSG.dialog.secReconnect)}</div>
            <div class="toggle-row">
              <span>${localizeDir(MSG.dialog.autoReconnect)}</span>
              <ix-toggle
                hide-text
                ?checked=${this.working.autoReconnect}
                @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ autoReconnect: e.detail })}
              ></ix-toggle>
            </div>
            <div class="grid3">
              <div class="field">
                <label>${localizeDir(MSG.dialog.fConnectTimeout)}</label>
                <ix-number-input
                  .value=${this.working.connectTimeoutSec}
                  @valueChange=${(e: IxValueEvent) =>
                    this.patch({ connectTimeoutSec: Number(e.detail) || DEFAULT_CONNECT_TIMEOUT_SEC })}
                ></ix-number-input>
              </div>
              <div class="field">
                <label>${localizeDir(MSG.dialog.fReconnectDelay)}</label>
                <ix-number-input
                  .value=${this.working.reconnectDelaySec}
                  @valueChange=${(e: IxValueEvent) =>
                    this.patch({ reconnectDelaySec: Number(e.detail) || DEFAULT_RECONNECT_DELAY_SEC })}
                ></ix-number-input>
              </div>
              <div class="field">
                <label>${localizeDir(MSG.dialog.fMaxAttempts)}</label>
                <ix-number-input
                  .value=${this.working.maxReconnectAttempts}
                  @valueChange=${(e: IxValueEvent) =>
                    this.patch({ maxReconnectAttempts: Math.max(0, Number(e.detail) || 0) })}
                ></ix-number-input>
              </div>
            </div>
          </div>

          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.dialog.cancel)}</ix-button>
            <ix-button
              @click=${this.save}
              ?disabled=${this.working.name.trim() === '' || this.working.host.trim() === ''}
            >
              <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.dialog.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('connection')) {
      // Spread over blankConnection() so records saved before the timeout /
      // reconnect fields existed are backfilled with the default values.
      if (this.connection) {
        this.working = { ...blankConnection(), ...structuredClone(this.connection) };
        // Write-only: absent = keep the stored password.
        delete this.working.password;
      } else {
        this.working = blankConnection();
      }
      this.showPassword = false;
    }
  }

  /** Editing a connection whose stored password is kept as is. */
  private keepsPassword(): boolean {
    return Boolean(this.connection?.hasPassword) && this.working.password === undefined;
  }

  private onPasswordInput(value: string): void {
    // Emptying the field of an existing connection goes back to "keep it".
    if (value === '' && this.connection) {
      const { password: _password, ...rest } = this.working;
      this.working = rest;
      return;
    }
    this.patch({ password: value });
  }

  private renderPasswordRemoval(): TemplateResult | typeof nothing {
    if (!this.connection?.hasPassword) return nothing;
    if (this.working.password === '') {
      return html`<div class="pw-note">
        ${localizeDir(MSG.dialog.passwordRemoved)}
        <ix-button variant="secondary" ghost @click=${() => this.onPasswordInput('')}>${localizeDir(MSG.dialog.undo)}</ix-button>
      </div>`;
    }
    if (this.working.password !== undefined) return nothing;
    return html`<div class="pw-note">
      <ix-button variant="secondary" ghost @click=${() => this.patch({ password: '' })}>
        <ix-icon name="trashcan" slot="icon"></ix-icon>${localizeDir(MSG.dialog.passwordRemove)}
      </ix-button>
    </div>`;
  }

  private textField(label: MultiLangString, key: 'name' | 'group' | 'host'): TemplateResult {
    return html`
      <div class="field">
        <label>${localizeDir(label)}</label>
        <ix-input
          .value=${this.working[key]}
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ [key]: String(e.detail) } as Partial<VncConnection>)}
        ></ix-input>
      </div>
    `;
  }

  private patch(part: Partial<VncConnection>): void {
    this.working = { ...this.working, ...part };
  }

  private save(): void {
    if (this.working.name.trim() === '' || this.working.host.trim() === '') return;
    this.dispatchEvent(
      new CustomEvent('wui:save', { detail: this.working, bubbles: true, composed: true })
    );
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .pw-row {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .pw {
      flex: 1;
      box-sizing: border-box;
      padding: 0.4rem 0.5rem;
      color: var(--theme-color-std-text);
      background: var(--theme-color-component-1, var(--theme-color-1));
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      font-family: inherit;
      font-size: 0.9rem;
    }
    .pw-note {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-top: 0.35rem;
      font-size: 0.8rem;
    }
    .warn {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.35rem;
      font-size: 0.78rem;
      color: var(--theme-color-warning);
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0.4rem 0;
      font-size: 0.9rem;
    }
  `;
}
