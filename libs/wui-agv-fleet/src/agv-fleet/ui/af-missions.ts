// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mission management board — one row per vehicle, showing its current transport
 * order, the leg chain with progress, and the operator actions.
 *
 * Actions go to the `agvSim` manager through `AGV_Command.json`; the manager owns
 * the missions, so this tab never mutates a vehicle datapoint directly. Actions
 * are hidden without write permission.
 *
 * Emits: `wui:action` (`{ action, vehicle }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { MissionAction } from '../data/mission-store.js';
import { MSG, localize, localizeDir, stateLabel } from '../i18n.js';
import {
  STATE_COLORS,
  STATE_ICONS,
  type MissionLegRow,
  type MissionRow
} from '../types.js';

const ONE_DECIMAL = 1;

/** Row class of one leg: served, running, or still ahead. */
function legClass(leg: MissionLegRow): string {
  if (leg.done) return 'done';
  return leg.active ? 'active' : '';
}

/** Progress glyph of one leg. */
function legBullet(leg: MissionLegRow): string {
  if (leg.done) return '✓';
  return leg.active ? '▶' : '○';
}

@customElement('af-missions')
export class AfMissions extends LitElement {
  static override readonly styles = [IXCoreStyles, missionStyles()];

  @property({ attribute: false }) rows: MissionRow[] = [];
  /** False when the mission book datapoint is absent (simulator not running). */
  @property({ type: Boolean }) available = false;
  /** Operator actions require write permission. */
  @property({ type: Boolean }) canWrite = false;

  override render(): TemplateResult {
    if (!this.available) {
      return html`<div class="center empty">
        <ix-icon name="info" size="24"></ix-icon>
        <ix-typography>${localizeDir(MSG.missions.unavailable)}</ix-typography>
      </div>`;
    }
    const active = this.rows.filter((row) => row.id !== '').length;
    return html`
      <div class="toolbar">
        <span class="count"
          >${localizeDir(MSG.missions.active)}: <strong>${active}</strong> /
          ${this.rows.length}</span
        >
        <span class="grow"></span>
        ${this.canWrite ? nothing : html`<span class="count">${localizeDir(MSG.missions.readOnly)}</span>`}
      </div>
      <div class="board">${this.rows.map((row) => this.renderRow(row))}</div>
    `;
  }

  private renderRow(row: MissionRow): TemplateResult {
    return html`
      <div class="card" style="--state-color: ${STATE_COLORS[row.state]}">
        <div class="head">
          <ix-icon name=${STATE_ICONS[row.state]} size="16"></ix-icon>
          <span class="vehicle">${row.vehicleName || row.vehicle}</span>
          <span class="chip">${stateLabel(row.state)}</span>
          <span class="grow"></span>
          ${
            row.id
              ? html`<span class="order mono">${row.id}</span>
                  <span class="kind">${this.kindLabel(row.kind)}</span>`
              : html`<span class="muted"
                  >${localizeDir(MSG.missions.noOrder)}</span
                >`
          }
        </div>

        ${row.legs.length > 0 ? this.renderLegs(row) : nothing}

        <div class="meta">
          <span>${localizeDir(MSG.table.zone)}: ${row.zone || '—'}</span>
          ${row.load ? html`<span>${localizeDir(MSG.detail.payload)}: <span class="mono">${row.load}</span></span>` : nothing}
          ${
            row.id
              ? html`<span
                  >${localizeDir(MSG.missions.remaining)}:
                  <span class="mono"
                    >${row.remainingM.toFixed(ONE_DECIMAL)} m</span
                  ></span
                >`
              : nothing
          }
          <span
            >${localizeDir(MSG.table.battery)}:
            <span class="mono"
              >${row.battery.toFixed(ONE_DECIMAL)} %</span
            ></span
          >
        </div>

        ${this.canWrite ? this.renderActions(row) : nothing}
      </div>
    `;
  }

  private renderLegs(row: MissionRow): TemplateResult {
    return html`
      <ol class="legs">
        ${row.legs.map(
          (leg) => html`
            <li class=${legClass(leg)}>
              <span class="bullet">${legBullet(leg)}</span>
              <span class="leg-label">${leg.label}</span>
              <span class="leg-action">${this.actionLabel(leg.action)}</span>
            </li>
          `
        )}
      </ol>
    `;
  }

  private renderActions(row: MissionRow): TemplateResult {
    if (row.parked) {
      return html`<div class="actions">
        ${this.button('recover', MSG.missions.actRecover, 'refresh', row.vehicle)}
      </div>`;
    }
    return html`
      <div class="actions">
        ${this.button('dispatch', MSG.missions.actDispatch, 'plus', row.vehicle)}
        ${row.id ? this.button('cancel', MSG.missions.actCancel, 'trashcan', row.vehicle) : nothing}
        ${this.button('charge', MSG.missions.actCharge, 'battery-charge', row.vehicle)}
        ${this.button('park', MSG.missions.actPark, 'pause', row.vehicle)}
        ${this.button('fault', MSG.missions.actFault, 'warning', row.vehicle)}
      </div>
    `;
  }

  private button(
    action: MissionAction,
    label: Parameters<typeof localize>[0],
    icon: string,
    vehicle: string
  ): TemplateResult {
    return html`
      <ix-button
        variant="secondary"
        size="s"
        title=${localize(label)}
        @click=${() => this.request(action, vehicle)}
      >
        <ix-icon name=${icon} slot="icon"></ix-icon>${localizeDir(label)}
      </ix-button>
    `;
  }

  private kindLabel(kind: string): string {
    const labels = MSG.missions.kinds as Record<
      string,
      Parameters<typeof localize>[0]
    >;
    const entry = labels[kind];
    return entry ? localize(entry) : kind;
  }

  private actionLabel(action: string): string {
    const labels = MSG.missions.legActions as Record<
      string,
      Parameters<typeof localize>[0]
    >;
    const entry = labels[action];
    return entry ? localize(entry) : action;
  }

  private request(action: MissionAction, vehicle: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:action', {
        detail: { action, vehicle },
        bubbles: true,
        composed: true
      })
    );
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function missionStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      overflow: auto;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0 0 0.5rem;
    }
    .toolbar .grow {
      flex: 1;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.875rem;
    }
    .board {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
      gap: 0.5rem;
    }
    .card {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.625rem 0.75rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-left: 3px solid var(--state-color);
      border-radius: var(--theme-default-border-radius);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--state-color);
      flex-wrap: wrap;
    }
    .head .grow {
      flex: 1;
    }
    .vehicle {
      font-weight: 600;
      color: var(--theme-color-std-text);
    }
    .chip {
      padding: 0.0625rem 0.5rem;
      border-radius: 1rem;
      font-size: 0.75rem;
      white-space: nowrap;
      border: 1px solid var(--state-color);
      background: color-mix(in srgb, var(--state-color) 14%, transparent);
    }
    .order {
      font-weight: 600;
      color: var(--theme-color-std-text);
    }
    .kind {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .legs {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.125rem;
      font-size: 0.8125rem;
    }
    .legs li {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      color: var(--theme-color-soft-text);
    }
    .legs li.done {
      opacity: 0.6;
    }
    .legs li.active {
      color: var(--theme-color-std-text);
      font-weight: 600;
    }
    .bullet {
      width: 1rem;
      text-align: center;
      color: var(--state-color);
    }
    .leg-label {
      flex: 1;
    }
    .leg-action {
      font-size: 0.75rem;
      opacity: 0.8;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.75rem;
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
    }
    .muted {
      color: var(--theme-color-soft-text);
    }
    .mono {
      font-family: var(--theme-font-family-mono, monospace);
      font-variant-numeric: tabular-nums;
    }
    .center {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 3rem 1rem;
      text-align: center;
    }
    .empty {
      color: var(--theme-color-soft-text);
    }
  `;
}
