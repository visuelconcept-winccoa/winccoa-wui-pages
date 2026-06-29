// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to manage named value→state mappings. Each mapping has an
 * ordered list of rules (state + optional min/max bounds, first match wins) and
 * a fallback state. Machines reference a mapping by id to resolve their state
 * datapoint into a colour state.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  STATE_COLOR_KEYS,
  STATE_COLOR_LABELS,
  stateColor,
  type MachineState,
  type StateColorKey,
  type StateMapping,
  type StateRule
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';
import { MSG, localize, localizeDir } from '../i18n.js';

interface IxValueEvent {
  detail: string | number;
}

const STATES: MachineState[] = ['ok', 'warn', 'stop', 'maint'];

@customElement('mf-state-mapping-dialog')
export class MfStateMappingDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) mappings: StateMapping[] = [];
  /** When false, the dialog is view-only: saving is disabled. */
  @property({ type: Boolean }) canEdit = true;

  @state() private working: StateMapping[] = [];
  @state() private selected = 0;

  override render(): TemplateResult {
    const mapping = this.working[this.selected];
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.stateMapping.title)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            ${this.renderSelector()} ${mapping ? this.renderEditor(mapping) : ''}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${this.canEdit ? localizeDir(MSG.stateMapping.cancel) : localizeDir(MSG.stateMapping.close)}</ix-button>
            ${this.canEdit ? html`<ix-button @click=${this.apply}>${localizeDir(MSG.stateMapping.save)}</ix-button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('mappings')) {
      this.working = structuredClone(this.mappings);
      this.selected = Math.min(this.selected, Math.max(0, this.working.length - 1));
    }
  }

  private renderSelector(): TemplateResult {
    return html`
      <div class="selector">
        <ix-select
          label=${localize(MSG.stateMapping.mapping)}
          .value=${this.working[this.selected]?.id ?? ''}
          @valueChange=${(e: IxValueEvent) => this.selectById(String(e.detail))}
        >
          ${this.working.map(
            (mp) => html`<ix-select-item label=${mp.name} value=${mp.id}></ix-select-item>`
          )}
        </ix-select>
        <ix-button variant="secondary" @click=${this.addMapping}>
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.stateMapping.newItem)}
        </ix-button>
        <ix-icon-button
          ghost
          icon="trashcan"
          title=${localize(MSG.stateMapping.deleteMapping)}
          @click=${this.removeMapping}
        ></ix-icon-button>
      </div>
    `;
  }

  private renderEditor(mapping: StateMapping): TemplateResult {
    return html`
      <div class="grid2">
        <ix-input
          label=${localize(MSG.stateMapping.name)}
          .value=${mapping.name}
          @valueChange=${(e: IxValueEvent) => this.patch({ name: String(e.detail) })}
        ></ix-input>
        <ix-select
          label=${localize(MSG.stateMapping.fallbackState)}
          .value=${mapping.fallback}
          @valueChange=${(e: IxValueEvent) => this.patch({ fallback: e.detail as MachineState })}
        >
          ${STATES.map((s) => html`<ix-select-item label=${s} value=${s}></ix-select-item>`)}
        </ix-select>
      </div>
      <div class="subhead">${localizeDir(MSG.stateMapping.rulesHeading)}</div>
      <div class="rules">${mapping.rules.map((r, i) => this.renderRule(r, i))}</div>
      <ix-button class="link" variant="secondary" @click=${this.addRule}>
        <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.stateMapping.addRule)}
      </ix-button>
      <div class="subhead">${localizeDir(MSG.stateMapping.colorsHeading)}</div>
      <div class="colors">${STATE_COLOR_KEYS.map((k) => this.renderColor(mapping, k))}</div>
    `;
  }

  private renderColor(mapping: StateMapping, key: StateColorKey): TemplateResult {
    const color = stateColor(mapping, key);
    return html`
      <label class="color-row">
        <input
          type="color"
          .value=${color}
          ?disabled=${!this.canEdit}
          @input=${(e: Event) => this.patchColor(key, (e.target as HTMLInputElement).value)}
        />
        <span>${STATE_COLOR_LABELS[key]}</span>
      </label>
    `;
  }

  private patchColor(key: StateColorKey, value: string): void {
    const mapping = this.working[this.selected];
    this.patch({ colors: { ...mapping.colors, [key]: value } });
  }

  private renderRule(rule: StateRule, i: number): TemplateResult {
    return html`
      <div class="rule-row">
        <ix-select
          .value=${rule.state}
          @valueChange=${(e: IxValueEvent) => this.patchRule(i, { state: e.detail as MachineState })}
        >
          ${STATES.map((s) => html`<ix-select-item label=${s} value=${s}></ix-select-item>`)}
        </ix-select>
        <ix-number-input
          label=${localize(MSG.stateMapping.min)}
          .value=${rule.min ?? 0}
          @valueChange=${(e: IxValueEvent) => this.patchRule(i, { min: Number(e.detail) })}
        ></ix-number-input>
        <ix-number-input
          label=${localize(MSG.stateMapping.max)}
          .value=${rule.max ?? 0}
          @valueChange=${(e: IxValueEvent) => this.patchRule(i, { max: Number(e.detail) })}
        ></ix-number-input>
        <ix-icon-button
          ghost
          icon="trashcan"
          @click=${() => this.removeRule(i)}
        ></ix-icon-button>
      </div>
    `;
  }

  private selectById(id: string): void {
    const idx = this.working.findIndex((m) => m.id === id);
    if (idx !== -1) this.selected = idx;
  }

  private patch(patch: Partial<StateMapping>): void {
    this.working = this.working.map((m, i) => (i === this.selected ? { ...m, ...patch } : m));
  }

  private patchRule(index: number, patch: Partial<StateRule>): void {
    const mapping = this.working[this.selected];
    const rules = mapping.rules.map((r, i) => (i === index ? { ...r, ...patch } : r));
    this.patch({ rules });
  }

  private addRule(): void {
    const mapping = this.working[this.selected];
    this.patch({ rules: [...mapping.rules, { state: 'ok', min: 0, max: 0 }] });
  }

  private removeRule(index: number): void {
    const mapping = this.working[this.selected];
    this.patch({ rules: mapping.rules.filter((_, i) => i !== index) });
  }

  private addMapping(): void {
    const id = `map-${Date.now()}`;
    this.working = [
      ...this.working,
      { id, name: localize(MSG.stateMapping.newMappingName), fallback: 'ok', rules: [] }
    ];
    this.selected = this.working.length - 1;
  }

  private removeMapping(): void {
    if (this.working.length <= 1) return;
    this.working = this.working.filter((_, i) => i !== this.selected);
    this.selected = Math.max(0, this.selected - 1);
  }

  private apply(): void {
    this.dispatchEvent(
      new CustomEvent('wui:apply', {
        detail: { mappings: this.working },
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
      grid-template-columns: 1.4fr 1fr 1fr auto;
      gap: 0.4rem;
      align-items: center;
    }
    .link {
      margin-top: 0.5rem;
    }
    .colors {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 0.4rem;
    }
    .color-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .color-row input[type='color'] {
      width: 2.2rem;
      height: 1.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 0.2rem;
      background: none;
      cursor: pointer;
    }
  `;
}
