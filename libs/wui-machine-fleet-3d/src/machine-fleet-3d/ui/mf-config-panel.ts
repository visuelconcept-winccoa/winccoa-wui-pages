// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Right-hand drawer for the Machine Fleet 3D page.
 *
 * Holds the labelled display toggles, the machine list (search field on top,
 * one compact row per machine with focus / edit / delete actions). The
 * placement markers are placed and edited on the view itself (pins, #63). Building
 * configuration lives in a separate dialog (`mf-building-dialog`); per-machine
 * editing opens `mf-machine-dialog`. This component only lists and emits intent
 * — the page owns the source of truth.
 *
 * iX components are registered globally by the app shell (used as bare tags).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  BUILTIN_STATES,
  DISCONNECTED_COLOR,
  DISCONNECTED_LABEL,
  UNKNOWN_STATE_COLOR,
  isDisconnected,
  type MachineDef,
  type StateDef
} from '../types.js';
import '@visuelconcept-winccoa/wui-kit/ui/wui-confirm-dialog.js';
import {
  MSG,
  confirmDeleteMachineMsg,
  localize,
  localizeDir,
  machinesCountMsg
} from '../i18n.js';

export type { DisplayConfig } from '../types.js';

/** Machine-list sort priority of the built-in states: alert → stopped → production → maintenance. */
const STATE_ORDER: Record<string, number> = { warn: 0, stop: 1, ok: 2, maint: 3 };
/** Declared states sort after the built-in ones: non-producing first, in their order, then producing. */
const DECLARED_RANK = 10;
const RUNNING_RANK = 50;

interface IxValueEvent {
  detail: string | number;
}

@customElement('mf-config-panel')
export class MfConfigPanel extends LitElement {
  static override readonly styles = [IXCoreStyles, panelStyles()];

  @property({ attribute: false }) machines: MachineDef[] = [];
  /** States of the atelier (label, colour, producing), from its mappings. */
  @property({ attribute: false }) states: StateDef[] = BUILTIN_STATES;
  /** When false, edit/delete/add are hidden and the row action becomes view-only. */
  @property({ type: Boolean }) canEdit = true;
  /**
   * List only (the embeddable view): rows focus their machine, nothing else — no
   * view/edit/delete action per row, no Add. Overrides `canEdit`.
   */
  @property({ type: Boolean, attribute: 'list-only' }) listOnly = false;

  @state() private query = '';
  @state() private confirmId: string | null = null;

  override render(): TemplateResult {
    return html`
      <div class="panel">${this.renderMachineSection()}</div>
      ${this.renderConfirm()}
    `;
  }

  private renderConfirm(): TemplateResult {
    if (!this.confirmId) return html``;
    const m = this.machines.find((x) => x.id === this.confirmId);
    return html`
      <wui-confirm-dialog
        heading=${localize(MSG.configPanel.deleteMachineHeading)}
        message=${confirmDeleteMachineMsg(m?.name ?? '')}
        @wui:confirm=${this.confirmDelete}
        @wui:cancel=${() => (this.confirmId = null)}
      ></wui-confirm-dialog>
    `;
  }

  private renderMachineSection(): TemplateResult {
    const filtered = this.filteredMachines();
    return html`
      <section class="machines">
        <div class="section-title">${machinesCountMsg(filtered.length, this.machines.length)}</div>
        <ix-input
          class="search"
          placeholder=${localize(MSG.configPanel.searchMachine)}
          .value=${this.query}
          @valueChange=${(e: IxValueEvent) => (this.query = String(e.detail))}
        >
          <ix-icon name="search" slot="input-start"></ix-icon>
        </ix-input>
        <div class="list">${filtered.map((m) => this.renderRow(m))}</div>
        ${this.canEdit && !this.listOnly
          ? html`<ix-button class="add" variant="secondary" @click=${this.emitAdd}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.configPanel.addMachine)}
            </ix-button>`
          : ''}
      </section>
    `;
  }

  private renderRow(m: MachineDef): TemplateResult {
    const offline = isDisconnected(m);
    const def = this.states.find((s) => s.key === m.state);
    const color = offline ? DISCONNECTED_COLOR : (def?.color ?? UNKNOWN_STATE_COLOR);
    const label = offline ? DISCONNECTED_LABEL : (def?.label ?? m.state);
    return html`
      <div
        class="row"
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent('wui:focus', { detail: { id: m.id }, bubbles: true, composed: true })
          )}
      >
        <span class="dot" style="background:${color}"></span>
        <span class="row-text">
          <span class="row-name">${m.name}</span>
          <span class="row-sub">${m.type}${m.loc ? ` · ${m.loc}` : ''}</span>
        </span>
        ${m.toPlace
          ? html`<span class="to-place" title=${localize(MSG.toPlace.hint)}>${localize(MSG.toPlace.label)}</span>`
          : ''}
        ${m.hidden ? this.renderHidden(m) : ''}
        <span class="badge" style="--c:${color}">${label}</span>
        ${this.listOnly ? '' : this.renderRowActions(m)}
      </div>
    `;
  }

  /** Crossed eye on a machine hidden from the scene; in edit, a click shows it again (#280). */
  private renderHidden(m: MachineDef): TemplateResult {
    if (!this.canEdit || this.listOnly) {
      return html`<ix-icon class="hidden-mark" name="eye-cancelled" size="16" title=${localize(MSG.configPanel.hidden)}></ix-icon>`;
    }
    return html`<ix-icon-button
      ghost
      size="16"
      icon="eye-cancelled"
      title=${localize(MSG.configPanel.showAgain)}
      @click=${(e: Event) => {
        e.stopPropagation();
        this.dispatchEvent(new CustomEvent('wui:show', { detail: { id: m.id }, bubbles: true, composed: true }));
      }}
    ></ix-icon-button>`;
  }

  private renderRowActions(m: MachineDef): TemplateResult {
    return html`
      <ix-icon-button
        ghost
        size="16"
        icon=${this.canEdit ? 'pen' : 'eye'}
        title=${this.canEdit ? localize(MSG.configPanel.edit) : localize(MSG.configPanel.viewOnly)}
        @click=${(e: Event) => this.onEdit(e, m.id)}
      ></ix-icon-button>
      ${this.canEdit
        ? html`<ix-icon-button
            ghost
            size="16"
            icon="trashcan"
            title=${localize(MSG.configPanel.delete)}
            @click=${(e: Event) => this.onDelete(e, m.id)}
          ></ix-icon-button>`
        : ''}
    `;
  }

  private filteredMachines(): MachineDef[] {
    const q = this.query.trim().toLowerCase();
    const list = q
      ? this.machines.filter((m) =>
          `${m.name} ${m.type} ${m.loc ?? ''}`.toLowerCase().includes(q)
        )
      : this.machines;
    // Disconnected machines first (priority over every state), then by severity:
    // alert (warn) → stopped → production (ok) → maintenance.
    return [...list].sort((a, b) => this.rank(a) - this.rank(b));
  }

  private rank(m: MachineDef): number {
    if (isDisconnected(m)) return -1;
    const builtin = STATE_ORDER[m.state];
    if (builtin !== undefined) return builtin;
    const i = this.states.findIndex((s) => s.key === m.state);
    if (i < 0) return RUNNING_RANK * 2;
    return (this.states[i].running ? RUNNING_RANK : DECLARED_RANK) + i;
  }

  private onEdit(e: Event, id: string): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('wui:edit', { detail: { id }, bubbles: true, composed: true })
    );
  }

  private onDelete(e: Event, id: string): void {
    e.stopPropagation();
    this.confirmId = id;
  }

  private confirmDelete(): void {
    const id = this.confirmId;
    this.confirmId = null;
    if (!id) return;
    this.dispatchEvent(
      new CustomEvent('wui:delete', { detail: { id }, bubbles: true, composed: true })
    );
  }

  private emitAdd(): void {
    this.dispatchEvent(new CustomEvent('wui:add', { bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function panelStyles() {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      color: var(--theme-color-std-text);
    }
    .panel {
      padding: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      height: 100%;
      box-sizing: border-box;
    }
    .section-title {
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: var(--theme-color-soft-text);
    }
    .toggles {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.3rem 0;
      cursor: pointer;
    }
    .toggle-label {
      flex: 1;
    }
    .machines {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1;
    }
    .search {
      margin-bottom: 0.5rem;
    }
    .list {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      cursor: pointer;
    }
    .row:hover {
      border-color: var(--theme-color-primary);
    }
    .row .dot {
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .row-text {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .row-name {
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .row-sub {
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
    }
    .badge {
      flex-shrink: 0;
      padding: 0.1rem 0.45rem;
      border-radius: 0.7rem;
      font-size: 0.68rem;
      font-weight: 600;
      white-space: nowrap;
      color: var(--c, var(--theme-color-primary));
      border: 1px solid var(--c, var(--theme-color-primary));
      background: color-mix(in srgb, var(--c) 16%, transparent);
    }
    .hidden-mark {
      flex-shrink: 0;
      color: var(--theme-color-weak-text);
    }
    .to-place {
      flex-shrink: 0;
      padding: 0.1rem 0.45rem;
      border-radius: 0.3rem;
      font-size: 0.68rem;
      font-weight: 700;
      white-space: nowrap;
      color: var(--theme-color-std-text);
      border: 1px dashed var(--theme-color-warning);
      background: color-mix(in srgb, var(--theme-color-warning) 22%, transparent);
    }
    .add {
      margin-top: 0.5rem;
    }
  `;
}
