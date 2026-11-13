// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to manage named value→state mappings. Each mapping has an
 * ordered list of rules (state + optional min/max bounds, first match wins) and
 * a fallback state. Machines reference a mapping by id to resolve their state
 * datapoint into a colour state.
 *
 * With several inputs (winccoa-fra-msp-stma#339): named inputs besides the state datapoint (each symbol binds
 * a datapoint to them), conditions on them in each rule (=, ≠, between, outside; all must hold), rules moved up
 * and down, and a rule "By the cause" giving the planned or the other state by the class of the cause in
 * progress. Editing logic in mapping-edit.ts.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  BUILTIN_STATES,
  STATE_COLOR_KEYS,
  STATE_COLOR_LABELS,
  isFaultState,
  mappingStates,
  stateColor,
  type MachineState,
  type StateColorKey,
  type StateDef,
  type StateMapping,
  type StateRule
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';
import {
  CAUSE_STATE,
  DECLARED_INPUT,
  STATE_INPUT,
  addInput,
  boundText,
  conditionInputs,
  conditionOf,
  conditionView,
  inputKeyError,
  moveRule,
  relabelInput,
  removeInput,
  renameInput,
  usesCause,
  withBounds,
  withWhen,
  type ConditionOp,
  type ConditionView
} from '../mapping-edit.js';
import { overlayClicked, overlayDown } from '@visuelconcept-winccoa/wui-fleet-core/ui/overlay-dismiss.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

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
  /** Input whose typed key is refused (index, -1 none): the key stays as it was. */
  @state() private badInput = -1;

  override render(): TemplateResult {
    const mapping = this.working[this.selected];
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.close()}>
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
      ${this.renderInputs(mapping)}
      <div class="subhead">${localizeDir(MSG.stateMapping.rulesHeading)}</div>
      <div class="rules">${mapping.rules.map((r, i) => this.renderRule(r, i, mapping.rules.length))}</div>
      <ix-button class="link" variant="secondary" ?disabled=${!this.canEdit} @click=${this.addRule}>
        <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.stateMapping.addRule)}
      </ix-button>
      ${usesCause(mapping) ? this.renderCauseStates(mapping) : ''}
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
        <label class="running" title=${localize(MSG.stateMapping.stateFaultHint)}>
          <input
            type="checkbox"
            .checked=${isFaultState(s)}
            ?disabled=${!this.canEdit || Boolean(s.running)}
            @change=${(e: Event) => this.patchState(i, { fault: (e.target as HTMLInputElement).checked })}
          />
          ${localizeDir(MSG.stateMapping.stateFault)}
        </label>
        <label class="running" title=${localize(MSG.stateMapping.stateOffOpeningHint)}>
          <input
            type="checkbox"
            .checked=${Boolean(s.outsideOpening)}
            ?disabled=${!this.canEdit || Boolean(s.running)}
            @change=${(e: Event) => this.patchState(i, { outsideOpening: (e.target as HTMLInputElement).checked })}
          />
          ${localizeDir(MSG.stateMapping.stateOffOpening)}
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
    const fix = (s: MachineState): MachineState => (known.has(s) || s === CAUSE_STATE ? s : 'ok');
    this.patch({
      states: undefined,
      fallback: fix(mapping.fallback),
      rules: mapping.rules.map((r) => ({ ...r, state: fix(r.state) })),
      ...(mapping.causeStates ? { causeStates: { planned: fix(mapping.causeStates.planned), unplanned: fix(mapping.causeStates.unplanned) } } : {})
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
    const cs = mapping.causeStates;
    this.patch({
      states: states.map((s, i) => (i === index ? { ...s, key } : s)),
      fallback: mapping.fallback === old ? key : mapping.fallback,
      rules: mapping.rules.map((r) => (r.state === old ? { ...r, state: key } : r)),
      ...(cs ? { causeStates: { planned: cs.planned === old ? key : cs.planned, unplanned: cs.unplanned === old ? key : cs.unplanned } } : {})
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
    const cs = mapping.causeStates;
    this.patch({
      states,
      fallback: mapping.fallback === removed ? first : mapping.fallback,
      rules: mapping.rules.map((r) => (r.state === removed ? { ...r, state: first } : r)),
      ...(cs ? { causeStates: { planned: cs.planned === removed ? first : cs.planned, unplanned: cs.unplanned === removed ? first : cs.unplanned } } : {})
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

  /** The inputs of the mapping: the state datapoint (main, fixed), then the named ones. */
  private renderInputs(mapping: StateMapping): TemplateResult {
    const inputs = mapping.inputs ?? [];
    return html`
      <div class="subhead">${localizeDir(MSG.stateMapping.inputsHeading)}</div>
      <div class="hint">${localizeDir(MSG.stateMapping.inputsHint)}</div>
      <div class="inputs">
        <div class="input-row">
          <ix-input label=${localize(MSG.stateMapping.inputKey)} .value=${STATE_INPUT} readonly></ix-input>
          <ix-input label=${localize(MSG.stateMapping.inputLabel)} .value=${localize(MSG.stateMapping.mainInput)} readonly></ix-input>
          <span></span>
        </div>
        ${inputs.map(
          (inp, i) => html`<div class="input-row">
            <ix-input
              label=${localize(MSG.stateMapping.inputKey)}
              class=${this.badInput === i ? 'ix-invalid' : ''}
              invalid-text=${localize(MSG.stateMapping.inputKeyInvalid)}
              .value=${inp.key}
              ?readonly=${!this.canEdit}
              @valueChange=${(e: IxValueEvent) => this.renameInputAt(i, String(e.detail).trim())}
            ></ix-input>
            <ix-input
              label=${localize(MSG.stateMapping.inputLabel)}
              .value=${inp.label}
              ?readonly=${!this.canEdit}
              @valueChange=${(e: IxValueEvent) => this.patch(relabelInput(this.working[this.selected], i, String(e.detail)))}
            ></ix-input>
            <ix-icon-button
              ghost
              icon="trashcan"
              title=${localize(MSG.stateMapping.deleteInput)}
              ?disabled=${!this.canEdit}
              @click=${() => this.patch(removeInput(this.working[this.selected], i))}
            ></ix-icon-button>
          </div>`
        )}
      </div>
      ${this.badInput >= 0 ? html`<div class="error">${localizeDir(MSG.stateMapping.inputKeyInvalid)}</div>` : ''}
      <ix-button class="link" variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.patch(addInput(this.working[this.selected], localize(MSG.stateMapping.newInputLabel)))}>
        <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.stateMapping.addInput)}
      </ix-button>
    `;
  }

  private renameInputAt(index: number, key: string): void {
    const mapping = this.working[this.selected];
    const inputs = mapping.inputs ?? [];
    if (key === inputs[index]?.key) {
      this.badInput = -1;
      return;
    }
    if (inputKeyError(key, inputs.filter((_, i) => i !== index).map((i) => i.key))) {
      this.badInput = index;
      return;
    }
    this.badInput = -1;
    this.patch(renameInput(mapping, index, key));
  }

  /** States a rule "By the cause" gives: for a planned cause, for any other. */
  private renderCauseStates(mapping: StateMapping): TemplateResult {
    const cs = mapping.causeStates ?? { planned: mapping.fallback, unplanned: mapping.fallback };
    return html`
      <div class="subhead">${localizeDir(MSG.stateMapping.causeStatesHeading)}</div>
      <div class="hint">${localizeDir(MSG.stateMapping.causeStatesHint)}</div>
      <div class="grid2">
        <ix-select
          label=${localize(MSG.stateMapping.causePlanned)}
          .value=${cs.planned}
          ?readonly=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.patch({ causeStates: { ...cs, planned: e.detail as MachineState } })}
        >
          ${this.stateOptions(mapping)}
        </ix-select>
        <ix-select
          label=${localize(MSG.stateMapping.causeUnplanned)}
          .value=${cs.unplanned}
          ?readonly=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.patch({ causeStates: { ...cs, unplanned: e.detail as MachineState } })}
        >
          ${this.stateOptions(mapping)}
        </ix-select>
      </div>
    `;
  }

  /** A rule: its state (or "By the cause"), its bounds on the main input (empty: none), its conditions, its place. */
  private renderRule(rule: StateRule, i: number, count: number): TemplateResult {
    const mapping = this.working[this.selected];
    return html`
      <div class="rule">
        <div class="rule-row">
          <ix-select
            .value=${rule.state}
            ?readonly=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.setRuleState(i, e.detail as MachineState)}
          >
            ${this.stateOptions(mapping)}
            <ix-select-item label=${localize(MSG.stateMapping.causeState)} value=${CAUSE_STATE}></ix-select-item>
          </ix-select>
          <ix-input
            label=${localize(MSG.stateMapping.min)}
            placeholder=${localize(MSG.stateMapping.boundsHint)}
            .value=${boundText(rule.min)}
            ?readonly=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.replaceRule(i, withBounds(this.ruleAt(i), String(e.detail), boundText(this.ruleAt(i).max)))}
          ></ix-input>
          <ix-input
            label=${localize(MSG.stateMapping.max)}
            placeholder=${localize(MSG.stateMapping.boundsHint)}
            .value=${boundText(rule.max)}
            ?readonly=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.replaceRule(i, withBounds(this.ruleAt(i), boundText(this.ruleAt(i).min), String(e.detail)))}
          ></ix-input>
          <span class="rule-actions">
            <ix-icon-button ghost icon="chevron-up" title=${localize(MSG.stateMapping.moveUp)} ?disabled=${!this.canEdit || i === 0} @click=${() => this.patch(moveRule(this.working[this.selected], i, -1))}></ix-icon-button>
            <ix-icon-button ghost icon="chevron-down" title=${localize(MSG.stateMapping.moveDown)} ?disabled=${!this.canEdit || i === count - 1} @click=${() => this.patch(moveRule(this.working[this.selected], i, 1))}></ix-icon-button>
            <ix-icon-button ghost icon="trashcan" title=${localize(MSG.stateMapping.deleteRule)} ?disabled=${!this.canEdit} @click=${() => this.removeRule(i)}></ix-icon-button>
          </span>
        </div>
        ${(rule.when ?? []).map((c, ci) => this.renderCondition(mapping, i, ci, conditionView(c)))}
        <ix-button class="cond-add" variant="secondary" ghost ?disabled=${!this.canEdit} @click=${() => this.addCondition(i)}>
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.stateMapping.addCondition)}
        </ix-button>
      </div>
    `;
  }

  private renderCondition(mapping: StateMapping, ruleIndex: number, index: number, v: ConditionView): TemplateResult {
    const set = (patch: Partial<ConditionView>): void => this.setCondition(ruleIndex, index, { ...v, ...patch });
    const ranged = v.op === 'in' || v.op === 'out';
    const ops: [ConditionOp, MultiLangString][] = [['eq', MSG.stateMapping.opEq], ['ne', MSG.stateMapping.opNe], ['in', MSG.stateMapping.opIn], ['out', MSG.stateMapping.opOut]];
    return html`
      <div class="cond-row">
        <span class="cond-and">${localizeDir(MSG.stateMapping.ruleAll)}</span>
        <ix-select label=${localize(MSG.stateMapping.conditionInput)} .value=${v.input} ?readonly=${!this.canEdit} @valueChange=${(e: IxValueEvent) => set({ input: String(e.detail) })}>
          ${conditionInputs(mapping).map((inp) => html`<ix-select-item label=${inputLabel(inp)} value=${inp.key}></ix-select-item>`)}
        </ix-select>
        <ix-select .value=${v.op} ?readonly=${!this.canEdit} @valueChange=${(e: IxValueEvent) => set({ op: e.detail as ConditionOp })}>
          ${ops.map(([op, label]) => html`<ix-select-item label=${localize(label)} value=${op}></ix-select-item>`)}
        </ix-select>
        ${ranged
          ? html`<span class="cond-bounds">
              <ix-input label=${localize(MSG.stateMapping.min)} placeholder=${localize(MSG.stateMapping.boundsHint)} .value=${v.min} ?readonly=${!this.canEdit} @valueChange=${(e: IxValueEvent) => set({ min: String(e.detail) })}></ix-input>
              <ix-input label=${localize(MSG.stateMapping.max)} placeholder=${localize(MSG.stateMapping.boundsHint)} .value=${v.max} ?readonly=${!this.canEdit} @valueChange=${(e: IxValueEvent) => set({ max: String(e.detail) })}></ix-input>
            </span>`
          : html`<ix-input label=${localize(MSG.stateMapping.conditionValue)} .value=${v.value} ?readonly=${!this.canEdit} @valueChange=${(e: IxValueEvent) => set({ value: String(e.detail) })}></ix-input>`}
        <ix-icon-button ghost icon="trashcan" title=${localize(MSG.stateMapping.deleteCondition)} ?disabled=${!this.canEdit} @click=${() => this.removeCondition(ruleIndex, index)}></ix-icon-button>
      </div>
    `;
  }

  private ruleAt(index: number): StateRule {
    return this.working[this.selected].rules[index];
  }

  private replaceRule(index: number, rule: StateRule): void {
    const mapping = this.working[this.selected];
    this.patch({ rules: mapping.rules.map((r, i) => (i === index ? rule : r)) });
  }

  /** A rule's state; "By the cause" for the first time sets the two states from the fallback. */
  private setRuleState(index: number, state: MachineState): void {
    const mapping = this.working[this.selected];
    this.patchRule(index, { state });
    if (state === CAUSE_STATE && !mapping.causeStates) this.patch({ causeStates: { planned: mapping.fallback, unplanned: mapping.fallback } });
  }

  private addCondition(ruleIndex: number): void {
    const rule = this.ruleAt(ruleIndex);
    const first = (this.working[this.selected].inputs ?? [])[0]?.key ?? STATE_INPUT;
    this.replaceRule(ruleIndex, withWhen(rule, [...(rule.when ?? []), { input: first, equals: 1 }]));
  }

  private setCondition(ruleIndex: number, index: number, v: ConditionView): void {
    const rule = this.ruleAt(ruleIndex);
    this.replaceRule(ruleIndex, withWhen(rule, (rule.when ?? []).map((c, i) => (i === index ? conditionOf(v) : c))));
  }

  private removeCondition(ruleIndex: number, index: number): void {
    const rule = this.ruleAt(ruleIndex);
    this.replaceRule(ruleIndex, withWhen(rule, (rule.when ?? []).filter((_, i) => i !== index)));
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

/** An input as a condition shows it: the main one and the declared state by name, the others by label (key). */
function inputLabel(inp: { key: string; label: string }): string {
  if (inp.key === STATE_INPUT) return localize(MSG.stateMapping.mainInput);
  if (inp.key === DECLARED_INPUT) return localize(MSG.stateMapping.declaredInput);
  return `${inp.label} (${inp.key})`;
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
    .rule {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
      padding: 0.4rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .rule-row {
      display: grid;
      grid-template-columns: 1.4fr 1fr 1fr auto;
      gap: 0.4rem;
      align-items: end;
    }
    .rule-actions {
      display: flex;
    }
    .cond-row {
      display: grid;
      grid-template-columns: auto 1.3fr 0.7fr 1.6fr auto;
      gap: 0.4rem;
      align-items: end;
      padding-left: 0.75rem;
    }
    .cond-and {
      color: var(--theme-color-soft-text);
      font-size: 0.8rem;
      padding-bottom: 0.45rem;
    }
    .cond-bounds {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.4rem;
    }
    .cond-add {
      align-self: flex-start;
      margin-left: 0.75rem;
    }
    .inputs {
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .input-row {
      display: grid;
      grid-template-columns: 1fr 2fr auto;
      gap: 0.4rem;
      align-items: end;
    }
    .hint {
      color: var(--theme-color-soft-text);
      font-size: 0.8rem;
      margin-bottom: 0.3rem;
    }
    .error {
      color: var(--theme-color-alarm);
      font-size: 0.8rem;
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
      grid-template-columns: auto 1fr 1.6fr auto auto auto auto;
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
