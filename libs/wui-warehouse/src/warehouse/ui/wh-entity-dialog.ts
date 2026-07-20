// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Generic schema-driven modal form used for every warehouse entity (zone,
 * location, product, stock entry, campaign). The parent passes a `fields` schema
 * and an initial `value`; the dialog renders a two-column form of iX inputs and
 * emits `wui:save` with the edited record (`wui:cancel` on dismiss). Keeping one
 * dialog avoids five near-identical components and one style copy per entity.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { dialogCore } from '@visuelconcept/wui-kit/ui/dialog-styles.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { LitElement, css, html, nothing, type CSSResult, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localizeDir } from '../i18n.js';

export interface FieldOption {
  value: string;
  label: string;
}

export type FieldKind = 'text' | 'number' | 'color' | 'textarea' | 'select';

export interface FieldDef {
  key: string;
  label: MultiLangString;
  kind: FieldKind;
  options?: FieldOption[];
  min?: number;
  step?: number;
  placeholder?: string;
  required?: boolean;
  /** Span the whole form width (default: half). */
  full?: boolean;
  /** Cannot be edited (shown read-only) — e.g. the product/location of a stock cell. */
  readonly?: boolean;
}

export type EntityDraft = Record<string, string | number>;

interface IxValueEvent {
  detail: string | number;
}

@customElement('wh-entity-dialog')
export class WhEntityDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  @property() heading = '';
  @property({ attribute: false }) fields: FieldDef[] = [];
  @property({ attribute: false }) value: EntityDraft = {};

  @state() private draft: EntityDraft = {};

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('value')) this.draft = { ...this.value };
  }

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${this.heading}</ix-typography>
          </div>
          <div class="panel-body">
            <div class="form">${this.fields.map((f) => this.renderField(f))}</div>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}>${localizeDir(MSG.common.cancel)}</ix-button>
            <ix-button @click=${this.save} ?disabled=${!this.isValid()}>
              <ix-icon name="save" slot="icon"></ix-icon>${localizeDir(MSG.common.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderField(field: FieldDef): TemplateResult {
    const current = this.draft[field.key];
    return html`
      <div class="field ${field.full || field.kind === 'textarea' ? 'full' : ''}">
        <label>${localizeDir(field.label)}</label>
        ${field.kind === 'select' ? this.renderSelect(field, current) : nothing}
        ${field.kind === 'textarea' ? this.renderTextarea(field, current) : nothing}
        ${field.kind === 'color' ? this.renderColor(field, current) : nothing}
        ${field.kind === 'text' || field.kind === 'number' ? this.renderInput(field, current) : nothing}
      </div>
    `;
  }

  private renderInput(field: FieldDef, current: string | number | undefined): TemplateResult {
    return html`<ix-input
      placeholder=${field.placeholder ?? ''}
      ?disabled=${field.readonly ?? false}
      .value=${current == null ? '' : String(current)}
      @valueChange=${(e: IxValueEvent) => this.set(field, e.detail)}
    ></ix-input>`;
  }

  private renderTextarea(field: FieldDef, current: string | number | undefined): TemplateResult {
    return html`<textarea
      class="ta"
      rows="2"
      placeholder=${field.placeholder ?? ''}
      .value=${current == null ? '' : String(current)}
      @input=${(e: Event) => this.set(field, (e.target as HTMLTextAreaElement).value)}
    ></textarea>`;
  }

  private renderColor(field: FieldDef, current: string | number | undefined): TemplateResult {
    return html`<input
      class="color"
      type="color"
      .value=${current == null ? '#3b82f6' : String(current)}
      @input=${(e: Event) => this.set(field, (e.target as HTMLInputElement).value)}
    />`;
  }

  private renderSelect(field: FieldDef, current: string | number | undefined): TemplateResult {
    const options = field.options ?? [];
    const index = options.findIndex((o) => o.value === String(current));
    return html`<ix-select
      .selectedIndices=${[Math.max(0, index)]}
      ?disabled=${field.readonly ?? false}
      @valueChange=${(e: CustomEvent<string | string[]>) => this.readSelect(field, e.detail)}
    >
      ${options.map((o) => html`<ix-select-item value=${o.value} label=${o.label}></ix-select-item>`)}
    </ix-select>`;
  }

  private readSelect(field: FieldDef, detail: string | string[]): void {
    const value = Array.isArray(detail) ? detail[0] : detail;
    this.draft = { ...this.draft, [field.key]: value ?? '' };
  }

  private set(field: FieldDef, raw: string | number): void {
    if (field.readonly) return;
    const value = field.kind === 'number' ? this.toNumber(raw) : String(raw);
    this.draft = { ...this.draft, [field.key]: value };
  }

  private toNumber(raw: string | number): number {
    const n = typeof raw === 'number' ? raw : Number.parseFloat(raw);
    return Number.isFinite(n) ? n : 0;
  }

  private isValid(): boolean {
    return this.fields.every((f) => {
      if (!f.required) return true;
      const v = this.draft[f.key];
      return typeof v === 'number' ? true : String(v ?? '').trim() !== '';
    });
  }

  private save(): void {
    if (!this.isValid()) return;
    this.dispatchEvent(new CustomEvent<EntityDraft>('wui:save', { detail: { ...this.draft }, bubbles: true, composed: true }));
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }
}

function dialogStyles(): CSSResult {
  return css`
    ${dialogCore()}
    .panel {
      width: 620px;
    }
    .form {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }
    .field.full {
      grid-column: 1 / -1;
    }
    .ta {
      font: inherit;
      color: var(--theme-color-std-text);
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.4rem 0.5rem;
      resize: vertical;
    }
    .color {
      width: 100%;
      height: 2.2rem;
      padding: 0.1rem;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
  `;
}
