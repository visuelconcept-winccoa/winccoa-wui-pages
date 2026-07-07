// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to add one manager to the pmon configuration of the active
 * server: executable name (without .exe), start mode, command line options and
 * an optional insert position (appended at the end when empty). Presentational —
 * emits `wui:save` with a {@link ManagerSpec} and `wui:cancel`; the page
 * performs the API call + tracing.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type CSSResult, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { dialogCore } from '@visuelconcept/wui-kit/ui/dialog-styles.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { ManagerSpec, ManagerStartMode } from '../types.js';

interface IxValueEvent {
  detail: string | number;
}

const START_MODES: ManagerStartMode[] = ['always', 'once', 'manual'];

@customElement('pm-manager-dialog')
export class PmManagerDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  @state() private name = '';
  @state() private startMode: ManagerStartMode = 'always';
  @state() private options = '';
  /** Insert position as typed; empty string appends at the end. */
  @state() private position = '';

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.managerDialog.title)}</ix-typography>
          </div>

          <div class="panel-body">
            <div class="field">
              <label>${localizeDir(MSG.managerDialog.fName)}</label>
              <ix-input
                placeholder="WCCOActrl"
                .value=${this.name}
                @valueChange=${(e: IxValueEvent) => (this.name = String(e.detail))}
              ></ix-input>
            </div>

            <div class="grid2">
              <div class="field">
                <label>${localizeDir(MSG.managerDialog.fStartMode)}</label>
                <ix-select
                  .selectedIndices=${[START_MODES.indexOf(this.startMode)]}
                  @valueChange=${(e: CustomEvent<string | string[]>) => this.readStartMode(e.detail)}
                >
                  <ix-select-item value="always" label=${localize(MSG.managerDialog.modeAlways)}></ix-select-item>
                  <ix-select-item value="once" label=${localize(MSG.managerDialog.modeOnce)}></ix-select-item>
                  <ix-select-item value="manual" label=${localize(MSG.managerDialog.modeManual)}></ix-select-item>
                </ix-select>
              </div>
              <div class="field">
                <label>${localizeDir(MSG.managerDialog.fPosition)}</label>
                <ix-input
                  placeholder="—"
                  .value=${this.position}
                  @valueChange=${(e: IxValueEvent) => (this.position = String(e.detail))}
                ></ix-input>
              </div>
            </div>
            <div class="hint">${localizeDir(MSG.managerDialog.positionHint)}</div>

            <div class="field">
              <label>${localizeDir(MSG.managerDialog.fOptions)}</label>
              <ix-input
                placeholder="-f script.ctl -num 2"
                .value=${this.options}
                @valueChange=${(e: IxValueEvent) => (this.options = String(e.detail))}
              ></ix-input>
            </div>

            <div class="hint">${localizeDir(MSG.managerDialog.hint)}</div>
          </div>

          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.managerDialog.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${!this.isValid()}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.managerDialog.add)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private readStartMode(detail: string | string[]): void {
    const value = Array.isArray(detail) ? detail[0] : detail;
    this.startMode = START_MODES.includes(value as ManagerStartMode) ? (value as ManagerStartMode) : 'always';
  }

  /** Name restricted to what survives the pmon TCP protocol line (backend-enforced too). */
  private isValid(): boolean {
    return /^[A-Za-z0-9_.-]+$/.test(this.name.trim().replace(/\.exe$/i, '')) && this.parsePosition() !== 0;
  }

  /** The typed position as a number, `undefined` to append, 0 when invalid/pmon. */
  private parsePosition(): number | undefined {
    const raw = this.position.trim();
    if (raw === '') return undefined;
    const n = Number.parseInt(raw, 10);
    return Number.isInteger(n) && n >= 1 && String(n) === raw ? n : 0;
  }

  private save(): void {
    if (!this.isValid()) return;
    const spec: ManagerSpec = {
      name: this.name.trim().replace(/\.exe$/i, ''),
      startMode: this.startMode,
      options: this.options.trim(),
      index: this.parsePosition()
    };
    this.dispatchEvent(new CustomEvent('wui:save', { detail: spec, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 560px;
    }
  `;
}
