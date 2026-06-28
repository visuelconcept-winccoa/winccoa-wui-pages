// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Right-hand drawer for the Machine Fleet 3D page.
 *
 * Holds the labelled display toggles and the machine list (search field on top,
 * one compact row per machine with focus / edit / delete actions). Building
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
  DISCONNECTED_COLOR,
  DISCONNECTED_LABEL,
  STATE_COLORS,
  STATE_LABELS,
  isDisconnected,
  type MachineDef,
  type MachineState
} from '../types.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';

export type { DisplayConfig } from '../types.js';

/** Machine-list sort priority: alert → stopped → production → maintenance. */
const STATE_ORDER: Record<MachineState, number> = { warn: 0, stop: 1, ok: 2, maint: 3 };

interface IxValueEvent {
  detail: string | number;
}

@customElement('mf-config-panel')
export class MfConfigPanel extends LitElement {
  static override readonly styles = [IXCoreStyles, panelStyles()];

  @property({ attribute: false }) machines: MachineDef[] = [];
  /** When false, edit/delete/add are hidden and the row action becomes view-only. */
  @property({ type: Boolean }) canEdit = true;

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
        heading="Supprimer la machine"
        message=${`Supprimer la machine « ${m?.name ?? ''} » de cet atelier ?`}
        @wui:confirm=${this.confirmDelete}
        @wui:cancel=${() => (this.confirmId = null)}
      ></wui-confirm-dialog>
    `;
  }

  private renderMachineSection(): TemplateResult {
    const filtered = this.filteredMachines();
    return html`
      <section class="machines">
        <div class="section-title">Machines (${filtered.length}/${this.machines.length})</div>
        <ix-input
          class="search"
          placeholder="Rechercher une machine…"
          .value=${this.query}
          @valueChange=${(e: IxValueEvent) => (this.query = String(e.detail))}
        >
          <ix-icon name="search" slot="input-start"></ix-icon>
        </ix-input>
        <div class="list">${filtered.map((m) => this.renderRow(m))}</div>
        ${this.canEdit
          ? html`<ix-button class="add" variant="secondary" @click=${this.emitAdd}>
              <ix-icon name="plus" slot="icon"></ix-icon>Ajouter une machine
            </ix-button>`
          : ''}
      </section>
    `;
  }

  private renderRow(m: MachineDef): TemplateResult {
    const offline = isDisconnected(m);
    const color = offline ? DISCONNECTED_COLOR : STATE_COLORS[m.state];
    const label = offline ? DISCONNECTED_LABEL : STATE_LABELS[m.state];
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
        <span class="badge" style="--c:${color}">${label}</span>
        <ix-icon-button
          ghost
          size="16"
          icon=${this.canEdit ? 'pen' : 'eye'}
          title=${this.canEdit ? 'Éditer' : 'Visualiser'}
          @click=${(e: Event) => this.onEdit(e, m.id)}
        ></ix-icon-button>
        ${this.canEdit
          ? html`<ix-icon-button
              ghost
              size="16"
              icon="trashcan"
              title="Supprimer"
              @click=${(e: Event) => this.onDelete(e, m.id)}
            ></ix-icon-button>`
          : ''}
      </div>
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
    return isDisconnected(m) ? -1 : STATE_ORDER[m.state];
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
    .add {
      margin-top: 0.5rem;
    }
  `;
}
