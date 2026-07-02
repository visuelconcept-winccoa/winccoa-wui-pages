// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Operating-mode editor — compose a reflex sequence in the UI: identity
 * (name / severity / description) and the ordered action list, each action
 * being one command point of one equipment set to one of its catalog values
 * (reorder with the arrows). Only equipment whose kind exposes command points
 * is offered. Emits `wui:save` with the edited mode copy; the tunnel view
 * merges it into `tunnel.modes` and persists.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { kindLabel, pointsOf } from '../data/catalog.js';
import { MSG, localize, localizeDir, severityLabel } from '../i18n.js';
import {
  pkLabel,
  type EquipmentDef,
  type ModeAction,
  type OperatingMode,
  type PointDef,
  type Tunnel
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string;
}

const SEVERITIES: readonly OperatingMode['severity'][] = ['normal', 'degraded', 'closure', 'fire'];

/** Command points of an equipment's kind (empty for sensors etc.). */
function commandPoints(equipment: EquipmentDef): PointDef[] {
  return pointsOf(equipment.kind).filter((p) => p.role === 'command');
}

/** Human label of one action (equipment — point → value). */
function actionLabel(equipment: EquipmentDef, point: PointDef, value: number): string {
  const valueLabel = point.commandValues?.find((cv) => cv.value === value)?.label ?? String(value);
  return `${equipment.name} — ${point.label} → ${valueLabel}`;
}

@customElement('hd-mode-dialog')
export class HdModeDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), modeDialogStyles()];

  @property({ attribute: false }) tunnel: Tunnel | null = null;
  /** Mode to edit (a fresh one for "new"); null = closed. */
  @property({ attribute: false }) mode: OperatingMode | null = null;

  @state() private working: OperatingMode | null = null;

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('mode')) {
      this.working = this.mode ? structuredClone(this.mode) : null;
    }
  }

  override render(): TemplateResult | typeof nothing {
    const working = this.working;
    const tunnel = this.tunnel;
    if (!working || !tunnel) return nothing;
    const commandable = tunnel.equipment.filter((e) => commandPoints(e).length > 0);
    return html`
      <div class="overlay" @click=${() => this.close()}>
        <div class="panel mode" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.modeDialog.title)}</ix-typography>
          </div>
          <div class="panel-body">
            <div class="grid2">
              <ix-input
                label=${localize(MSG.modeDialog.name)}
                .value=${working.name}
                @valueChange=${(e: IxValueEvent) => this.patch({ name: e.detail })}
              ></ix-input>
              <ix-select
                label=${localize(MSG.modeDialog.severity)}
                .value=${working.severity}
                @valueChange=${(e: IxValueEvent) =>
                  this.patch({ severity: String(e.detail) as OperatingMode['severity'] })}
              >
                ${SEVERITIES.map(
                  (s) => html`<ix-select-item label=${severityLabel(s)} value=${s}></ix-select-item>`
                )}
              </ix-select>
            </div>
            <ix-input
              label=${localize(MSG.modeDialog.description)}
              .value=${working.description}
              @valueChange=${(e: IxValueEvent) => this.patch({ description: e.detail })}
            ></ix-input>
            <div class="section-title">
              ${localizeDir(MSG.modeDialog.actions)} (${working.actions.length})
            </div>
            ${commandable.length === 0
              ? html`<div class="empty">${localizeDir(MSG.modeDialog.noCommandEquipment)}</div>`
              : html`
                  ${working.actions.map((action, i) => this.renderAction(working, commandable, action, i))}
                  <div class="row">
                    <ix-button variant="secondary" @click=${() => this.addAction(commandable)}>
                      <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.modeDialog.addAction)}
                    </ix-button>
                  </div>
                `}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${() => this.close()}>
              ${localizeDir(MSG.modeDialog.cancel)}
            </ix-button>
            <ix-button ?disabled=${working.name.trim() === ''} @click=${() => this.save()}>
              ${localizeDir(MSG.modeDialog.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderAction(
    working: OperatingMode,
    commandable: EquipmentDef[],
    action: ModeAction,
    index: number
  ): TemplateResult {
    const equipment = commandable.find((e) => e.id === action.equipmentId) ?? commandable[0];
    const points = equipment ? commandPoints(equipment) : [];
    const point = points.find((p) => p.key === action.pointKey) ?? points[0];
    return html`
      <div class="action-row">
        <ix-select
          .value=${action.equipmentId}
          @valueChange=${(e: IxValueEvent) => this.onActionEquipment(index, String(e.detail))}
        >
          ${commandable.map(
            (eq) => html`<ix-select-item
              label="${eq.name} · ${kindLabel(eq.kind)} · ${pkLabel(eq.pkM)}"
              value=${eq.id}
            ></ix-select-item>`
          )}
        </ix-select>
        <ix-select
          .value=${action.pointKey}
          @valueChange=${(e: IxValueEvent) => this.onActionPoint(index, String(e.detail))}
        >
          ${points.map((p) => html`<ix-select-item label=${p.label} value=${p.key}></ix-select-item>`)}
        </ix-select>
        <ix-select
          .value=${String(action.value)}
          @valueChange=${(e: IxValueEvent) => this.onActionValue(index, Number(e.detail))}
        >
          ${(point?.commandValues ?? []).map(
            (cv) => html`<ix-select-item label=${cv.label} value=${String(cv.value)}></ix-select-item>`
          )}
        </ix-select>
        <ix-icon-button
          icon="chevron-up"
          variant="secondary"
          ghost
          ?disabled=${index === 0}
          title=${localize(MSG.modeDialog.moveUp)}
          @click=${() => this.moveAction(index, -1)}
        ></ix-icon-button>
        <ix-icon-button
          icon="chevron-down"
          variant="secondary"
          ghost
          ?disabled=${index === working.actions.length - 1}
          title=${localize(MSG.modeDialog.moveDown)}
          @click=${() => this.moveAction(index, 1)}
        ></ix-icon-button>
        <ix-icon-button
          icon="trashcan"
          variant="secondary"
          ghost
          title=${localize(MSG.modeDialog.removeAction)}
          @click=${() => this.removeAction(index)}
        ></ix-icon-button>
      </div>
    `;
  }

  // --- mutations ---------------------------------------------------------------

  private patch(part: Partial<OperatingMode>): void {
    if (this.working) this.working = { ...this.working, ...part };
  }

  private patchAction(index: number, build: (action: ModeAction) => ModeAction): void {
    if (!this.working) return;
    this.working = {
      ...this.working,
      actions: this.working.actions.map((a, i) => (i === index ? build(a) : a))
    };
  }

  /** Rebuild an action against its (possibly new) equipment/point/value triple. */
  private rebuild(equipmentId: string, pointKey: string, value: number): ModeAction | null {
    const equipment = this.tunnel?.equipment.find((e) => e.id === equipmentId);
    if (!equipment) return null;
    const points = commandPoints(equipment);
    const point = points.find((p) => p.key === pointKey) ?? points[0];
    if (!point) return null;
    const allowed = point.commandValues ?? [];
    const kept = allowed.some((cv) => cv.value === value) ? value : (allowed[0]?.value ?? 0);
    return {
      equipmentId,
      pointKey: point.key,
      value: kept,
      label: actionLabel(equipment, point, kept)
    };
  }

  private onActionEquipment(index: number, equipmentId: string): void {
    this.patchAction(index, (a) => this.rebuild(equipmentId, a.pointKey, a.value) ?? a);
  }

  private onActionPoint(index: number, pointKey: string): void {
    this.patchAction(index, (a) => this.rebuild(a.equipmentId, pointKey, a.value) ?? a);
  }

  private onActionValue(index: number, value: number): void {
    this.patchAction(index, (a) => this.rebuild(a.equipmentId, a.pointKey, value) ?? a);
  }

  private addAction(commandable: EquipmentDef[]): void {
    const first = commandable[0];
    if (!this.working || !first) return;
    const action = this.rebuild(first.id, commandPoints(first)[0]?.key ?? '', 0);
    if (!action) return;
    this.working = { ...this.working, actions: [...this.working.actions, action] };
  }

  private moveAction(index: number, delta: number): void {
    if (!this.working) return;
    const actions = [...this.working.actions];
    const target = index + delta;
    if (target < 0 || target >= actions.length) return;
    [actions[index], actions[target]] = [actions[target], actions[index]];
    this.working = { ...this.working, actions };
  }

  private removeAction(index: number): void {
    if (!this.working) return;
    this.working = { ...this.working, actions: this.working.actions.filter((_, i) => i !== index) };
  }

  private save(): void {
    if (!this.working) return;
    this.dispatchEvent(new CustomEvent<OperatingMode>('wui:save', { detail: this.working }));
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close'));
  }
}

function modeDialogStyles(): ReturnType<typeof css> {
  return css`
    .panel.mode {
      width: 760px;
    }
    .panel-body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .action-row {
      display: grid;
      grid-template-columns: 2.2fr 1.2fr 1.2fr auto auto auto;
      gap: 0.4rem;
      align-items: center;
    }
    .empty {
      color: var(--theme-color-soft-text);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-mode-dialog': HdModeDialog;
  }
}
