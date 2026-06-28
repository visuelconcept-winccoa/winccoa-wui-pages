// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to create or edit one production order: identity/product,
 * atelier+machine assignment (cascading selects fed by the Machine Fleet 3D
 * fleet), planned/actual schedule, status, priority and progress.
 *
 * Emits `wui:save` with the edited order, `wui:cancel` on dismiss.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Atelier } from '@visuelconcept/wui-fleet-core/types.js';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  blankOrder,
  type OrderPriority,
  type OrderStatus,
  type ProductionOrder
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string | number;
}

function options<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

const STATUS_OPTIONS = options<OrderStatus>(STATUS_LABELS);
const PRIORITY_OPTIONS = options<OrderPriority>(PRIORITY_LABELS);

@customElement('po-order-dialog')
export class PoOrderDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  /** Order to edit; when null the dialog creates a new one. */
  @property({ attribute: false }) order: ProductionOrder | null = null;

  /** Fleet catalogue used to populate the atelier / machine selects. */
  @property({ attribute: false }) ateliers: Atelier[] = [];

  /** Local working copy so parent re-renders never discard in-progress edits. */
  @state() private working: ProductionOrder = blankOrder();

  // eslint-disable-next-line max-lines-per-function -- single form template
  override render(): TemplateResult {
    const isNew = !this.order;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${isNew ? 'Nouvel ordre de production' : `Édition — ${this.working.orderNo}`}
            </ix-typography>
          </div>

          <div class="panel-body">
            <div class="subhead">Identité & produit</div>
            <div class="grid2">
              ${this.textField('N° OF', 'orderNo')}
              ${this.textField('Désignation produit', 'product')}
              ${this.textField('Référence article', 'article')}
              <span></span>
              ${this.numberField('Quantité commandée', 'qtyOrdered')}
              ${this.numberField('Quantité produite', 'qtyProduced')}
            </div>

            <div class="subhead">Affectation</div>
            <div class="grid2">
              ${this.atelierField()} ${this.machineField()}
            </div>

            <div class="subhead">Planning</div>
            <div class="grid2">
              ${this.dateField('Début prévu', 'plannedStart')}
              ${this.dateField('Fin prévue', 'plannedEnd')}
              ${this.dateField('Début réel', 'actualStart')}
              ${this.dateField('Fin réelle', 'actualEnd')}
            </div>

            <div class="subhead">Statut & priorité</div>
            <div class="grid2">
              ${this.selectField('Statut', 'status', STATUS_OPTIONS)}
              ${this.selectField('Priorité', 'priority', PRIORITY_OPTIONS)}
              ${this.numberField('Avancement (%)', 'progress')}
            </div>

            <div class="subhead">Notes</div>
            <ix-input
              .value=${this.working.notes}
              @valueChange=${(e: IxValueEvent) => this.patch({ notes: String(e.detail) })}
            ></ix-input>
          </div>

          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>Annuler</ix-button>
            <ix-button @click=${this.save} ?disabled=${this.working.orderNo.trim() === ''}>
              <ix-icon name="check" slot="icon"></ix-icon>Enregistrer
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('order')) {
      this.working = this.order ? structuredClone(this.order) : blankOrder();
    }
  }

  private textField(label: string, key: keyof ProductionOrder): TemplateResult {
    return html`
      <div class="field">
        <label>${label}</label>
        <ix-input
          .value=${String(this.working[key] ?? '')}
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ [key]: String(e.detail) } as Partial<ProductionOrder>)}
        ></ix-input>
      </div>
    `;
  }

  private numberField(
    label: string,
    key: 'qtyOrdered' | 'qtyProduced' | 'progress'
  ): TemplateResult {
    return html`
      <div class="field">
        <label>${label}</label>
        <ix-number-input
          .value=${this.working[key]}
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ [key]: Number(e.detail) } as Partial<ProductionOrder>)}
        ></ix-number-input>
      </div>
    `;
  }

  private dateField(
    label: string,
    key: 'plannedStart' | 'plannedEnd' | 'actualStart' | 'actualEnd'
  ): TemplateResult {
    return html`
      <div class="field">
        <label>${label}</label>
        <input
          class="dt"
          type="datetime-local"
          .value=${this.working[key]}
          @change=${(e: Event) =>
            this.patch({ [key]: (e.target as HTMLInputElement).value } as Partial<ProductionOrder>)}
        />
      </div>
    `;
  }

  private selectField<T extends string>(
    label: string,
    key: keyof ProductionOrder,
    opts: { value: T; label: string }[]
  ): TemplateResult {
    return html`
      <div class="field">
        <label>${label}</label>
        <ix-select
          .value=${String(this.working[key])}
          @valueChange=${(e: IxValueEvent) =>
            this.patch({ [key]: String(e.detail) } as Partial<ProductionOrder>)}
        >
          ${opts.map((o) => html`<ix-select-item label=${o.label} value=${o.value}></ix-select-item>`)}
        </ix-select>
      </div>
    `;
  }

  private atelierField(): TemplateResult {
    return html`
      <div class="field">
        <label>Atelier</label>
        <ix-select
          .value=${this.working.atelierId}
          @valueChange=${(e: IxValueEvent) => this.onAtelierChange(String(e.detail))}
        >
          ${this.ateliers.map(
            (a) => html`<ix-select-item label=${a.name} value=${a.id}></ix-select-item>`
          )}
        </ix-select>
      </div>
    `;
  }

  private machineField(): TemplateResult {
    const atelier = this.ateliers.find((a) => a.id === this.working.atelierId);
    const machines = atelier?.machines ?? [];
    return html`
      <div class="field">
        <label>Machine</label>
        <ix-select
          .value=${this.working.machineId}
          ?disabled=${machines.length === 0}
          @valueChange=${(e: IxValueEvent) => this.onMachineChange(String(e.detail))}
        >
          ${machines.map(
            (m) => html`<ix-select-item label=${m.name} value=${m.id}></ix-select-item>`
          )}
        </ix-select>
      </div>
    `;
  }

  private onAtelierChange(atelierId: string): void {
    const atelier = this.ateliers.find((a) => a.id === atelierId);
    this.patch({
      atelierId,
      atelierName: atelier?.name ?? '',
      machineId: '',
      machineName: ''
    });
  }

  private onMachineChange(machineId: string): void {
    const atelier = this.ateliers.find((a) => a.id === this.working.atelierId);
    const machine = atelier?.machines.find((m) => m.id === machineId);
    this.patch({ machineId, machineName: machine?.name ?? '' });
  }

  private patch(part: Partial<ProductionOrder>): void {
    this.working = { ...this.working, ...part };
  }

  private save(): void {
    if (this.working.orderNo.trim() === '') return;
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
    .dt {
      width: 100%;
      box-sizing: border-box;
      padding: 0.4rem 0.5rem;
      color: var(--theme-color-std-text);
      background: var(--theme-color-component-1, var(--theme-color-1));
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      font-family: inherit;
      font-size: 0.9rem;
    }
    .dt::-webkit-calendar-picker-indicator {
      filter: invert(0.7);
      cursor: pointer;
    }
  `;
}
