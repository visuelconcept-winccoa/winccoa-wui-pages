// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog for one entry of the pmon configuration of the active server.
 *
 * - **Add** (no `manager`): executable name (without .exe), start mode, restart settings
 *   (secKill, restart count, reset minutes), command line options and an optional insert
 *   position (appended at the end when empty). Emits `wui:save` with a {@link ManagerSpec}.
 * - **Edit** (issue 40, `manager` set, index ≥ 1): pre-filled with that entry; the executable
 *   name is read-only (another executable is another manager). For a running manager it says
 *   that a new start mode or new options take effect at the next start, and offers "Save and
 *   restart" (default off, only with the `control` grant, `canRestart`). Emits `wui:update` with
 *   a {@link ManagerUpdateIntent}, and `wui:delete` from its labelled "Delete manager" button.
 *
 * Presentational — emits `wui:cancel` too; the page performs the API call + tracing.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type CSSResult, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { dialogCore } from '@visuelconcept-winccoa/wui-kit/ui/dialog-styles.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { CONFIG_BOUNDS, boundedInt, configChanges, configOf, type BoundedKey } from '../managers.js';
import type { ManagerConfig, ManagerInfo, ManagerSpec, ManagerStartMode, ManagerUpdateIntent } from '../types.js';

interface IxValueEvent {
  detail: string | number;
}

const START_MODES: ManagerStartMode[] = ['always', 'once', 'manual'];

@customElement('pm-manager-dialog')
export class PmManagerDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  /** The entry to edit; null for an add. */
  @property({ attribute: false }) manager: ManagerInfo | null = null;
  /** `control` grant: "Save and restart" is offered for a running manager. */
  @property({ type: Boolean }) canRestart = false;
  /** `edit-managers` grant: the labelled delete button (the page checks `control` for a running one). */
  @property({ type: Boolean }) canDelete = false;

  @state() private name = '';
  @state() private startMode: ManagerStartMode = 'always';
  @state() private options = '';
  /** Insert position as typed; empty string appends at the end (add only). */
  @state() private position = '';
  @state() private secKill = '30';
  @state() private restartCount = '3';
  @state() private resetMin = '1';
  @state() private restart = false;

  override willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('manager') && this.manager) {
      const c = configOf(this.manager);
      this.name = this.manager.name;
      this.startMode = c.startMode;
      this.options = c.options;
      this.secKill = String(c.secKill);
      this.restartCount = String(c.restartCount);
      this.resetMin = String(c.resetMin);
      this.restart = false;
    }
  }

  private get editing(): boolean {
    return this.manager !== null;
  }

  private get running(): boolean {
    return this.manager !== null && this.manager.state !== 0;
  }

  override render(): TemplateResult {
    const t = MSG.managerDialog;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(this.editing ? t.editTitle : t.title)}</ix-typography>
          </div>

          <div class="panel-body">
            <div class="field">
              <label>${localizeDir(t.fName)}</label>
              ${this.editing
                ? html`<ix-input .value=${`${this.name} (#${this.manager?.index ?? ''})`} readonly></ix-input>
                    <div class="hint">${localizeDir(t.nameReadOnly)}</div>`
                : html`<ix-input placeholder="WCCOActrl" .value=${this.name} @valueChange=${(e: IxValueEvent) => (this.name = String(e.detail))}></ix-input>`}
            </div>

            <div class="grid2">
              <div class="field">
                <label>${localizeDir(t.fStartMode)}</label>
                <ix-select
                  .selectedIndices=${[START_MODES.indexOf(this.startMode)]}
                  @valueChange=${(e: CustomEvent<string | string[]>) => this.readStartMode(e.detail)}
                >
                  <ix-select-item value="always" label=${localize(t.modeAlways)}></ix-select-item>
                  <ix-select-item value="once" label=${localize(t.modeOnce)}></ix-select-item>
                  <ix-select-item value="manual" label=${localize(t.modeManual)}></ix-select-item>
                </ix-select>
              </div>
              ${this.editing
                ? nothing
                : html`<div class="field">
                    <label>${localizeDir(t.fPosition)}</label>
                    <ix-input placeholder="—" .value=${this.position} @valueChange=${(e: IxValueEvent) => (this.position = String(e.detail))}></ix-input>
                  </div>`}
            </div>
            ${this.editing ? nothing : html`<div class="hint">${localizeDir(t.positionHint)}</div>`}

            <div class="grid3">
              ${this.numberField('secKill', t.fSecKill, this.secKill, (v) => (this.secKill = v))}
              ${this.numberField('restartCount', t.fRestartCount, this.restartCount, (v) => (this.restartCount = v))}
              ${this.numberField('resetMin', t.fResetMin, this.resetMin, (v) => (this.resetMin = v))}
            </div>

            <div class="field">
              <label>${localizeDir(t.fOptions)}</label>
              <ix-input
                placeholder="-f script.ctl -num 2"
                .value=${this.options}
                @valueChange=${(e: IxValueEvent) => (this.options = String(e.detail))}
              ></ix-input>
            </div>

            ${this.running ? html`<div class="note">${localizeDir(t.runningNote)}</div>` : nothing}
            ${this.running && this.canRestart
              ? html`<ix-checkbox
                  label=${localize(t.saveAndRestart)}
                  .checked=${this.restart}
                  @checkedChange=${(e: CustomEvent<boolean>) => (this.restart = e.detail)}
                ></ix-checkbox>`
              : nothing}
            <div class="hint">${localizeDir(this.editing ? t.editHint : t.hint)}</div>
          </div>

          <div class="panel-foot">
            ${this.editing && this.canDelete
              ? html`<ix-button class="delete" variant="danger" outline @click=${this.requestDelete}>
                  <ix-icon name="trashcan" slot="icon"></ix-icon>${localizeDir(t.delete)}
                </ix-button>`
              : nothing}
            <span class="grow"></span>
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(t.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${!this.isValid()} title=${this.editing && !this.hasChanges() ? localize(t.noChange) : ''}>
              <ix-icon name=${this.editing ? 'disk' : 'plus'} slot="icon"></ix-icon>${localizeDir(this.editing ? t.save : t.add)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private numberField(key: BoundedKey, label: typeof MSG.managerDialog.fSecKill, value: string, set: (v: string) => void): TemplateResult {
    const [min, max] = CONFIG_BOUNDS[key];
    const invalid = boundedInt(key, value) === null;
    return html`<div class="field">
      <label>${localizeDir(label)}</label>
      <ix-input
        type="number"
        min=${min}
        max=${max}
        .value=${value}
        class=${invalid ? 'ix-invalid' : ''}
        title=${`${min}–${max}`}
        @valueChange=${(e: IxValueEvent) => set(String(e.detail))}
      ></ix-input>
    </div>`;
  }

  private readStartMode(detail: string | string[]): void {
    const value = Array.isArray(detail) ? detail[0] : detail;
    this.startMode = START_MODES.includes(value as ManagerStartMode) ? (value as ManagerStartMode) : 'always';
  }

  /** The typed configuration, or null when a restart setting is out of bounds. */
  private config(): ManagerConfig | null {
    const secKill = boundedInt('secKill', this.secKill);
    const restartCount = boundedInt('restartCount', this.restartCount);
    const resetMin = boundedInt('resetMin', this.resetMin);
    if (secKill === null || restartCount === null || resetMin === null) return null;
    return { startMode: this.startMode, secKill, restartCount, resetMin, options: this.options.replace(/[\r\n]+/g, ' ').trim() };
  }

  private hasChanges(): boolean {
    const c = this.config();
    return this.manager !== null && c !== null && configChanges(configOf(this.manager), c).length > 0;
  }

  /** Name restricted to what survives the pmon TCP protocol line (backend-enforced too). */
  private isValid(): boolean {
    if (this.config() === null) return false;
    if (this.editing) return this.hasChanges() || this.restart;
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
    const config = this.config();
    if (!this.isValid() || config === null) return;
    if (this.manager) {
      const detail: ManagerUpdateIntent = {
        index: this.manager.index,
        name: this.manager.name,
        before: configOf(this.manager),
        config,
        restart: this.running && this.canRestart && this.restart
      };
      this.dispatchEvent(new CustomEvent('wui:update', { detail, bubbles: true, composed: true }));
      return;
    }
    const spec: ManagerSpec = {
      name: this.name.trim().replace(/\.exe$/i, ''),
      startMode: config.startMode,
      options: config.options,
      index: this.parsePosition(),
      secKill: config.secKill,
      restartCount: config.restartCount,
      resetMin: config.resetMin
    };
    this.dispatchEvent(new CustomEvent('wui:save', { detail: spec, bubbles: true, composed: true }));
  }

  private requestDelete(): void {
    this.dispatchEvent(new CustomEvent('wui:delete', { detail: this.manager, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 600px;
    }
    .grid3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }
    .note {
      font-size: 0.85rem;
      color: var(--theme-color-warning-text, var(--theme-color-std-text));
      border-left: 3px solid var(--theme-color-warning);
      padding-left: 0.5rem;
    }
    .grow {
      flex: 1;
    }
  `;
}
