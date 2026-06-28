// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to create a new atelier: a name plus an id that is either
 * auto-generated from the name or chosen manually, with live uniqueness
 * checking against the existing atelier ids. Emits `wui:submit` with
 * { name, id, demo } on accept, `wui:cancel` on dismiss.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { ATELIER_TEMPLATES } from '../data/atelier-templates.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/(^-|-$)/g, '')
    .slice(0, 32);
}

@customElement('mf-atelier-create-dialog')
export class MfAtelierCreateDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) existingIds: string[] = [];
  @property() defaultName = 'Nouvel atelier';
  /** Pre-selected template id (example set). */
  @property() defaultTemplate = '';
  /** When false, creation is disabled (view-only user). */
  @property({ type: Boolean }) canEdit = true;

  @state() private atelierName = '';
  @state() private atelierId = '';
  @state() private atelierIdEdited = false;
  @state() private template = '';

  override render(): TemplateResult {
    const taken = this.existingIds.includes(this.atelierId);
    const invalid = this.atelierId === '' || taken;
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel create" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">Nouvel atelier</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="panel-body">
            <ix-select
              label="Modèle de départ"
              .value=${this.template}
              @valueChange=${(e: IxValueEvent) => this.onTemplate(e.detail)}
            >
              ${ATELIER_TEMPLATES.map(
                (t) => html`<ix-select-item label=${t.name} value=${t.id}></ix-select-item>`
              )}
            </ix-select>
            <ix-input
              label="Nom"
              .value=${this.atelierName}
              @valueChange=${(e: IxValueEvent) => this.onName(e.detail)}
            ></ix-input>
            <div class="id-row">
              <ix-input
                class="id-input"
                label="Identifiant"
                .value=${this.atelierId}
                invalid=${invalid || undefined}
                @valueChange=${(e: IxValueEvent) => this.onId(e.detail)}
              ></ix-input>
              <ix-icon-button
                ghost
                icon="refresh"
                title="Générer automatiquement"
                @click=${this.regenerate}
              ></ix-icon-button>
            </div>
            ${taken
              ? html`<div class="err">Cet identifiant existe déjà — choisissez-en un autre.</div>`
              : html`<div class="hint">Sert de nom du datapoint (MachineFleet3D_&lt;id&gt;).</div>`}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>Annuler</ix-button>
            <ix-button ?disabled=${invalid || !this.canEdit} @click=${this.submit}>Créer</ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('defaultName') && this.atelierName === '') {
      this.atelierName = this.defaultName;
      this.atelierId = this.uniqueId(this.defaultName);
    }
    if (changed.has('defaultTemplate')) this.template = this.defaultTemplate;
  }

  private onTemplate(value: string): void {
    this.template = value;
  }

  private onName(value: string): void {
    this.atelierName = value;
    if (!this.atelierIdEdited) this.atelierId = this.uniqueId(value);
  }

  private onId(value: string): void {
    this.atelierIdEdited = true;
    this.atelierId = slugify(value);
  }

  private regenerate(): void {
    this.atelierIdEdited = false;
    this.atelierId = this.uniqueId(this.atelierName);
  }

  private uniqueId(fromName: string): string {
    const base = slugify(fromName) || 'atelier';
    if (!this.existingIds.includes(base)) return base;
    let i = 2;
    while (this.existingIds.includes(`${base}-${i}`)) i++;
    return `${base}-${i}`;
  }

  private submit(): void {
    if (this.atelierId === '' || this.existingIds.includes(this.atelierId)) return;
    this.dispatchEvent(
      new CustomEvent('wui:submit', {
        detail: {
          name: this.atelierName.trim() || this.atelierId,
          id: this.atelierId,
          seed: this.template
        },
        bubbles: true,
        composed: true
      })
    );
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .panel.create {
      width: 460px;
    }
    .panel-body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .id-row {
      display: flex;
      align-items: flex-end;
      gap: 0.25rem;
    }
    .id-row .id-input {
      flex: 1;
    }
    .err {
      color: var(--theme-color-alarm);
      font-size: 0.85rem;
    }
    .hint {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
  `;
}
