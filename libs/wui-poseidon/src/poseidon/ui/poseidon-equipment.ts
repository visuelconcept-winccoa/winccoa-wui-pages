// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Equipment control: one card per motorised device (grouped water / sludge line)
 * showing live state / mode / load / current / run-hours, with start-stop and
 * auto-manual controls. Controls are permission-gated (`canEdit`); a start/stop
 * asks for confirmation. Commands are emitted as a `wui:control` event — the
 * shell forwards them to the backend and writes the audit trail.
 */
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { EQ_FAULT, EQ_RUNNING, EQUIPMENT, MODE_AUTO, type EquipmentDef } from '../model.js';
import { MSG, confirmControlMsg, localize, localizeDir } from '../i18n.js';
import { fmt } from '../format.js';
import type { ControlAction, EquipmentState, EquipmentStates } from '../types.js';

type PendingIntent = { equipment: string; action: 'start' | 'stop'; name: string };

export class PoseidonEquipment extends LitElement {
  static override readonly styles = [IXCoreStyles, equipStyles()];

  @property({ attribute: false }) equipment: EquipmentStates = {};
  @property({ type: Boolean }) canEdit = true;

  @state() private pending: PendingIntent | null = null;

  override render(): TemplateResult {
    return html`
      <section class="equip">
        <div class="head">
          <h3>${localizeDir(MSG.equipment.title)}</h3>
          ${this.canEdit ? nothing : html`<ix-pill variant="warning">${localizeDir(MSG.equipment.viewOnly)}</ix-pill>`}
        </div>
        ${this.renderLine('water', MSG.equipment.waterLine)}
        ${this.renderLine('sludge', MSG.equipment.sludgeLine)}
      </section>
      ${this.pending
        ? html`<wui-confirm-dialog
            message=${confirmControlMsg(this.pending.action, this.pending.name)}
            @wui:confirm=${() => this.confirm()}
            @wui:cancel=${() => (this.pending = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  private renderLine(line: EquipmentDef['line'], label: typeof MSG.equipment.waterLine): TemplateResult {
    const items = EQUIPMENT.filter((e) => e.line === line);
    return html`
      <h4>${localizeDir(label)}</h4>
      <div class="grid">${items.map((e) => this.renderCard(e))}</div>
    `;
  }

  private renderCard(def: EquipmentDef): TemplateResult {
    const s: EquipmentState = this.equipment[def.id] ?? { state: 0, mode: 1, feedback: 0, current: 0, runningHours: 0 };
    const running = s.state === EQ_RUNNING;
    const fault = s.state === EQ_FAULT;
    const auto = s.mode === MODE_AUTO;
    const cls = fault ? 'fault' : running ? 'run' : 'stop';
    return html`
      <div class="card ${cls}">
        <div class="card-top">
          <ix-icon name=${def.icon} size="20"></ix-icon>
          <span class="name">${localize(def.label)}</span>
          <span class="state ${cls}">${this.stateLabel(s.state)}</span>
        </div>
        <div class="metrics">
          <div><span class="m-label">${localizeDir(MSG.equipment.mode)}</span>${auto ? localizeDir(MSG.equipment.modeAuto) : localizeDir(MSG.equipment.modeManual)}</div>
          <div><span class="m-label">${localizeDir(MSG.equipment.load)}</span>${fmt(s.feedback, 0)} %</div>
          <div><span class="m-label">${localizeDir(MSG.equipment.current)}</span>${fmt(s.current, 1)} A</div>
          <div><span class="m-label">${localizeDir(MSG.equipment.hours)}</span>${fmt(s.runningHours, 1)} h</div>
        </div>
        <div class="actions">
          <ix-button
            variant="primary"
            ?disabled=${!this.canEdit || running}
            @click=${() => this.ask(def, 'start')}
          >${localizeDir(MSG.equipment.start)}</ix-button>
          <ix-button
            variant="secondary"
            ?disabled=${!this.canEdit || (!running && !fault)}
            @click=${() => this.ask(def, 'stop')}
          >${localizeDir(MSG.equipment.stop)}</ix-button>
          <ix-button
            variant="secondary"
            outline
            ?disabled=${!this.canEdit}
            @click=${() => this.emit(def.id, auto ? 'manual' : 'auto')}
          >${auto ? localizeDir(MSG.equipment.setManual) : localizeDir(MSG.equipment.setAuto)}</ix-button>
        </div>
      </div>
    `;
  }

  private stateLabel(state: number): string {
    if (state === EQ_RUNNING) return localize(MSG.equipment.stateRunning);
    if (state === EQ_FAULT) return localize(MSG.equipment.stateFault);
    return localize(MSG.equipment.stateStopped);
  }

  private ask(def: EquipmentDef, action: 'start' | 'stop'): void {
    if (!this.canEdit) return;
    this.pending = { equipment: def.id, action, name: localize(def.label) };
  }

  private confirm(): void {
    const p = this.pending;
    this.pending = null;
    if (p) this.emit(p.equipment, p.action);
  }

  private emit(equipment: string, action: ControlAction): void {
    this.dispatchEvent(
      new CustomEvent('wui:control', { detail: { equipment, action }, bubbles: true, composed: true })
    );
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function equipStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .equip {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.8rem;
    }
    h3,
    h4 {
      margin: 0;
    }
    h4 {
      margin-top: 0.4rem;
      opacity: 0.8;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 0.6rem;
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-left: 4px solid var(--theme-color-soft-bdr);
      border-radius: 6px;
      background: var(--theme-color-1);
      padding: 0.7rem 0.8rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .card.run {
      border-left-color: var(--theme-color-success, #01893a);
    }
    .card.stop {
      border-left-color: var(--theme-color-neutral, #7f8081);
    }
    .card.fault {
      border-left-color: var(--theme-color-alarm, #d1002e);
    }
    .card-top {
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }
    .name {
      font-weight: 600;
      flex: 1;
    }
    .state {
      font-size: 0.75rem;
      padding: 0.05rem 0.45rem;
      border-radius: 999px;
      background: rgba(127, 127, 127, 0.2);
    }
    .state.run {
      color: var(--theme-color-success, #01893a);
    }
    .state.fault {
      color: var(--theme-color-alarm, #d1002e);
    }
    .metrics {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.2rem 0.6rem;
      font-size: 0.82rem;
      font-variant-numeric: tabular-nums;
    }
    .m-label {
      opacity: 0.65;
      margin-right: 0.35rem;
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
  `;
}

if (!customElements.get('poseidon-equipment')) {
  customElements.define('poseidon-equipment', PoseidonEquipment);
}
