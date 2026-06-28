// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to manage named TRS threshold configs. Each config has an
 * ordered list of colour bands (min % + colour + optional label); a machine
 * references a config by id to colour its TRS. Mirrors the state-mapping dialog
 * so threshold configs are shareable across machines of the atelier.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { type TrsThresholdRule, type TrsThresholds } from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string | number;
}

const NEW_BAND_COLOR = '#10b981';

@customElement('mf-trs-thresholds-dialog')
export class MfTrsThresholdsDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) thresholds: TrsThresholds[] = [];
  /** When false, the dialog is view-only: saving is disabled. */
  @property({ type: Boolean }) canEdit = true;

  @state() private working: TrsThresholds[] = [];
  @state() private selected = 0;

  override render(): TemplateResult {
    const config = this.working[this.selected];
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">Seuils TRS</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            ${this.renderSelector()} ${config ? this.renderEditor(config) : ''}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${this.canEdit ? 'Annuler' : 'Fermer'}</ix-button>
            ${this.canEdit ? html`<ix-button @click=${this.apply}>Enregistrer</ix-button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('thresholds')) {
      this.working = structuredClone(this.thresholds);
      this.selected = Math.min(this.selected, Math.max(0, this.working.length - 1));
    }
  }

  private renderSelector(): TemplateResult {
    return html`
      <div class="selector">
        <ix-select
          label="Configuration"
          .value=${this.working[this.selected]?.id ?? ''}
          @valueChange=${(e: IxValueEvent) => this.selectById(String(e.detail))}
        >
          ${this.working.map(
            (t) => html`<ix-select-item label=${t.name} value=${t.id}></ix-select-item>`
          )}
        </ix-select>
        <ix-button variant="secondary" @click=${this.addConfig}>
          <ix-icon name="plus" slot="icon"></ix-icon>Nouveau
        </ix-button>
        <ix-icon-button
          ghost
          icon="trashcan"
          title="Supprimer cette configuration"
          @click=${this.removeConfig}
        ></ix-icon-button>
      </div>
    `;
  }

  private renderEditor(config: TrsThresholds): TemplateResult {
    const rules = [...config.rules].sort((a, b) => a.min - b.min);
    return html`
      <ix-input
        label="Nom"
        .value=${config.name}
        @valueChange=${(e: IxValueEvent) => this.patch({ name: String(e.detail) })}
      ></ix-input>
      <div class="subhead">Bandes de valeurs (TRS ≥ seuil → couleur)</div>
      <div class="rules">
        <div class="rule-row rule-head">
          <span>Seuil (%)</span><span>Couleur</span><span>Libellé</span><span></span>
        </div>
        ${config.rules.map((r, i) => this.renderRule(r, i))}
      </div>
      <ix-button class="link" variant="secondary" @click=${this.addRule}>
        <ix-icon name="plus" slot="icon"></ix-icon>Ajouter une bande
      </ix-button>
      <div class="preview">
        ${rules.map(
          (r) => html`<span class="swatch" style="background:${r.color}">${r.min}%</span>`
        )}
      </div>
    `;
  }

  private renderRule(rule: TrsThresholdRule, i: number): TemplateResult {
    return html`
      <div class="rule-row">
        <ix-number-input
          min="0"
          max="100"
          .value=${rule.min}
          @valueChange=${(e: IxValueEvent) => this.patchRule(i, { min: Number(e.detail) })}
        ></ix-number-input>
        <input
          class="color"
          type="color"
          .value=${rule.color}
          @input=${(e: Event) => this.patchRule(i, { color: (e.target as HTMLInputElement).value })}
        />
        <ix-input
          .value=${rule.label ?? ''}
          @valueChange=${(e: IxValueEvent) => this.patchRule(i, { label: String(e.detail) })}
        ></ix-input>
        <ix-icon-button ghost icon="trashcan" @click=${() => this.removeRule(i)}></ix-icon-button>
      </div>
    `;
  }

  private selectById(id: string): void {
    const idx = this.working.findIndex((t) => t.id === id);
    if (idx !== -1) this.selected = idx;
  }

  private patch(patch: Partial<TrsThresholds>): void {
    this.working = this.working.map((t, i) => (i === this.selected ? { ...t, ...patch } : t));
  }

  private patchRule(index: number, patch: Partial<TrsThresholdRule>): void {
    const config = this.working[this.selected];
    const rules = config.rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    this.patch({ rules });
  }

  private addRule(): void {
    const config = this.working[this.selected];
    this.patch({ rules: [...config.rules, { min: 0, color: NEW_BAND_COLOR, label: '' }] });
  }

  private removeRule(index: number): void {
    const config = this.working[this.selected];
    this.patch({ rules: config.rules.filter((_, i) => i !== index) });
  }

  private addConfig(): void {
    const id = `trs-${Date.now()}`;
    this.working = [
      ...this.working,
      { id, name: 'Nouveaux seuils', rules: [{ min: 0, color: NEW_BAND_COLOR, label: '' }] }
    ];
    this.selected = this.working.length - 1;
  }

  private removeConfig(): void {
    if (this.working.length <= 1) return;
    this.working = this.working.filter((_, i) => i !== this.selected);
    this.selected = Math.max(0, this.selected - 1);
  }

  private apply(): void {
    this.dispatchEvent(
      new CustomEvent('wui:apply', {
        detail: { thresholds: this.working },
        bubbles: true,
        composed: true
      })
    );
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .selector {
      display: flex;
      align-items: flex-end;
      gap: 0.5rem;
      margin-bottom: 0.75rem;
    }
    .selector ix-select {
      flex: 1;
    }
    .rules {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
    }
    .rule-row {
      display: grid;
      grid-template-columns: 6rem 3rem 1fr auto;
      gap: 0.5rem;
      align-items: center;
    }
    .rule-head {
      color: var(--theme-color-soft-text);
      font-size: 0.78rem;
      font-weight: 600;
    }
    .color {
      width: 100%;
      height: 2rem;
      padding: 0;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: none;
      cursor: pointer;
    }
    .link {
      margin-top: 0.5rem;
    }
    .preview {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-top: 0.75rem;
    }
    .swatch {
      padding: 0.15rem 0.5rem;
      border-radius: 0.3rem;
      font-size: 0.72rem;
      font-weight: 700;
      color: #fff;
    }
  `;
}
