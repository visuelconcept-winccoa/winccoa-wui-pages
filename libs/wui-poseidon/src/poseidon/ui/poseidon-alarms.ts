// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Alarms & events: the live list of active alarms (threshold breaches +
 * equipment faults) derived by the shell. Each unacknowledged alarm can be
 * acknowledged (emits `wui:ack` with its id); acknowledged alarms stay listed
 * until the underlying condition clears.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { MSG, dateLabel, localizeDir } from '../i18n.js';
import type { Alarm } from '../types.js';

export class PoseidonAlarms extends LitElement {
  static override readonly styles = [IXCoreStyles, alarmStyles()];

  @property({ attribute: false }) alarms: Alarm[] = [];

  override render(): TemplateResult {
    return html`
      <section class="alarms">
        <h3>${localizeDir(MSG.alarms.title)}</h3>
        ${this.alarms.length === 0
          ? html`<div class="empty">
              <ix-icon name="success" size="24"></ix-icon>${localizeDir(MSG.alarms.none)}
            </div>`
          : this.renderTable()}
      </section>
    `;
  }

  private renderTable(): TemplateResult {
    return html`
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.alarms.colSeverity)}</th>
            <th>${localizeDir(MSG.alarms.colSource)}</th>
            <th>${localizeDir(MSG.alarms.colMessage)}</th>
            <th>${localizeDir(MSG.alarms.colValue)}</th>
            <th>${localizeDir(MSG.alarms.colTime)}</th>
            <th>${localizeDir(MSG.alarms.colAck)}</th>
          </tr>
        </thead>
        <tbody>
          ${this.alarms.map((a) => this.renderRow(a))}
        </tbody>
      </table>
    `;
  }

  private renderRow(a: Alarm): TemplateResult {
    return html`<tr class=${a.acknowledged ? 'acked' : ''}>
      <td>
        <ix-pill variant=${a.severity === 'high' ? 'alarm' : 'warning'}>
          ${a.severity === 'high' ? localizeDir(MSG.alarms.sevHigh) : localizeDir(MSG.alarms.sevWarn)}
        </ix-pill>
      </td>
      <td>${a.source}</td>
      <td>${a.message}</td>
      <td class="num">${a.value || '—'}</td>
      <td>${dateLabel(a.since)}</td>
      <td>
        ${a.acknowledged
          ? html`<span class="ack-done"><ix-icon name="check" size="16"></ix-icon>${localizeDir(MSG.alarms.acknowledged)}</span>`
          : html`<ix-button variant="secondary" @click=${() => this.ack(a.id)}>${localizeDir(MSG.alarms.acknowledge)}</ix-button>`}
      </td>
    </tr>`;
  }

  private ack(id: string): void {
    this.dispatchEvent(new CustomEvent('wui:ack', { detail: { id }, bubbles: true, composed: true }));
  }
}

function alarmStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .alarms {
      display: flex;
      flex-direction: column;
      gap: 0.8rem;
    }
    h3 {
      margin: 0;
    }
    .empty {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 1.5rem;
      opacity: 0.75;
      color: var(--theme-color-success, #01893a);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th,
    td {
      text-align: left;
      padding: 0.4rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    th {
      font-weight: 600;
      opacity: 0.8;
    }
    td.num {
      font-variant-numeric: tabular-nums;
    }
    tr.acked {
      opacity: 0.55;
    }
    .ack-done {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      color: var(--theme-color-success, #01893a);
      font-size: 0.85rem;
    }
  `;
}

if (!customElements.get('poseidon-alarms')) {
  customElements.define('poseidon-alarms', PoseidonAlarms);
}
