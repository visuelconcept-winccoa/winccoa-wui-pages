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
  BUILTIN_STATES,
  STATE_COLOR_KEYS,
  STATE_COLOR_LABELS,
  mappingStates,
  stateColor,
  type MachineState,
  type StateColorKey,
  type StateDef,
  type StateMapping,
  type StateRule
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';
import { MSG, localize, localizeDir } from '../i18n.js';

interface IxValueEvent {
  detail: string | number;
}

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
          ${this.stateOptions(mapping)}
        </ix-select>
      </div>
      <div class="subhead">${localizeDir(MSG.stateMapping.statesHeading)}</div>
      <label class="own">
        <input
          type="checkbox"
          .checked=${Boolean(mapping.states?.length)}
          ?disabled=${!this.canEdit}
          @change=${(e: Event) => this.toggleOwnStates((e.target as HTMLInputElement).checked)}
        />
        ${localizeDir(MSG.stateMapping.ownStates)}
      </label>
      ${mapping.states?.length ? this.renderStates(mapping.states) : ''}
      <div class="subhead">${localizeDir(MSG.stateMapping.rulesHeading)}</div>
      <div class="rules">${mapping.rules.map((r, i) => this.renderRule(r, i))}</div>
      <ix-button class="link" variant="secondary" @click=${this.addRule}>
        <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.stateMapping.addRule)}
      </ix-button>
      <div class="subhead">${localizeDir(MSG.stateMapping.colorsHeading)}</div>
      <div class="colors">${this.colorKeys(mapping).map((k) => this.renderColor(mapping, k))}</div>
    `;
  }

  /** Options of a state select: the mapping's states, by label. */
  private stateOptions(mapping: StateMapping): TemplateResult[] {
    return mappingStates(mapping).map(
      (s) => html`<ix-select-item label=${s.label} value=${s.key}></ix-select-item>`
    );
  }

  /** Colour rows: the built-in states and the overlay, or only the overlay when the
   * mapping declares its own states (their colour is edited with them). */
  private colorKeys(mapping: StateMapping): StateColorKey[] {
    return mapping.states?.length ? ['disconnected'] : STATE_COLOR_KEYS;
  }

  private renderStates(states: StateDef[]): TemplateResult {
    return html`
      <div class="states">
        ${states.map((s, i) => this.renderState(s, i, states.length))}
      </div>
      <ix-button class="link" variant="secondary" ?disabled=${!this.canEdit} @click=${this.addState}>
        <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.stateMapping.addState)}
      </ix-button>
    `;
  }

  private renderState(s: StateDef, i: number, count: number): TemplateResult {
    return html`
      <div class="state-row">
        <input
          type="color"
          .value=${s.color}
          ?disabled=${!this.canEdit}
          aria-label=${localize(MSG.stateMapping.stateColor)}
          @input=${(e: Event) => this.patchState(i, { color: (e.target as HTMLInputElement).value })}
        />
        <ix-input
          label=${localize(MSG.stateMapping.stateKey)}
          .value=${s.key}
          ?readonly=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.renameState(i, String(e.detail).trim())}
        ></ix-input>
        <ix-input
          label=${localize(MSG.stateMapping.stateLabel)}
          .value=${s.label}
          ?readonly=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.patchState(i, { label: String(e.detail) })}
        ></ix-input>
        <label class="running" title=${localize(MSG.stateMapping.stateRunningHint)}>
          <input
            type="checkbox"
            .checked=${Boolean(s.running)}
            ?disabled=${!this.canEdit}
            @change=${(e: Event) => this.patchState(i, { running: (e.target as HTMLInputElement).checked })}
          />
          ${localizeDir(MSG.stateMapping.stateRunning)}
        </label>
        <ix-icon-button
          ghost
          icon="trashcan"
          title=${localize(MSG.stateMapping.deleteState)}
          ?disabled=${!this.canEdit || count <= 1}
          @click=${() => this.removeState(i)}
        ></ix-icon-button>
      </div>
    `;
  }

  private toggleOwnStates(on: boolean): void {
    const mapping = this.working[this.selected];
    if (on) {
      // Start from the states the mapping shows today, so nothing changes until edited.
      this.patch({ states: mappingStates(mapping).map((s) => ({ ...s })) });
      return;
    }
    // Back to the built-in four: rules and fallback naming another state fall back to 'ok'.
    const known = new Set(BUILTIN_STATES.map((s) => s.key));
    const fix = (s: MachineState): MachineState => (known.has(s) ? s : 'ok');
    this.patch({
      states: undefined,
      fallback: fix(mapping.fallback),
      rules: mapping.rules.map((r) => ({ ...r, state: fix(r.state) }))
    });
  }

  private patchState(index: number, patch: Partial<StateDef>): void {
    const states = (this.working[this.selected].states ?? []).map((s, i) =>
      i === index ? { ...s, ...patch } : s
    );
    this.patch({ states });
  }

  /** Rename a state and the rules / fallback that produce it, so the mapping stays consistent. */
  private renameState(index: number, key: string): void {
    const mapping = this.working[this.selected];
    const states = mapping.states ?? [];
    const old = states[index]?.key;
    if (!key || key === old || states.some((s, i) => i !== index && s.key === key)) return;
    this.patch({
      states: states.map((s, i) => (i === index ? { ...s, key } : s)),
      fallback: mapping.fallback === old ? key : mapping.fallback,
      rules: mapping.rules.map((r) => (r.state === old ? { ...r, state: key } : r))
    });
  }

  private addState(): void {
    const states = this.working[this.selected].states ?? [];
    let n = states.length + 1;
    while (states.some((s) => s.key === `state${n}`)) n++;
    this.patch({ states: [...states, { key: `state${n}`, label: `${n}`, color: '#9ca3af' }] });
  }

  /** Remove a state; the rules and fallback that produced it move to the first remaining state. */
  private removeState(index: number): void {
    const mapping = this.working[this.selected];
    const removed = mapping.states?.[index]?.key;
    const states = (mapping.states ?? []).filter((_, i) => i !== index);
    const first = states[0]?.key ?? 'ok';
    this.patch({
      states,
      fallback: mapping.fallback === removed ? first : mapping.fallback,
      rules: mapping.rules.map((r) => (r.state === removed ? { ...r, state: first } : r))
    });
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
        <span>${STATE_COLOR_LABELS[key as keyof typeof STATE_COLOR_LABELS] ?? key}</span>
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
          ${this.stateOptions(this.working[this.selected])}
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
    this.patch({ rules: [...mapping.rules, { state: mappingStates(mapping)[0]?.key ?? 'ok', min: 0, max: 0 }] });
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
    .own,
    .running {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .states {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-top: 0.4rem;
    }
    .state-row {
      display: grid;
      grid-template-columns: auto 1fr 1.6fr auto auto;
      gap: 0.4rem;
      align-items: end;
    }
    .state-row input[type='color'] {
      width: 2.2rem;
      height: 1.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 0.2rem;
      background: none;
      cursor: pointer;
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
