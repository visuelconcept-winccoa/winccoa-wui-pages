/** Compact KPI strip: report counts by workflow state kind. */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { currentState } from '../engine.js';
import { STATE_COLORS, type Report } from '../types.js';

@customElement('rb-kpi-bar')
export class RbKpiBar extends LitElement {
  static override readonly styles = [IXCoreStyles, kpiStyles()];

  @property({ attribute: false }) reports: Report[] = [];

  override render(): TemplateResult {
    let inProgress = 0;
    let approved = 0;
    let rejected = 0;
    for (const r of this.reports) {
      const kind = currentState(r)?.kind;
      if (kind === 'final') approved += 1;
      else if (kind === 'rejected') rejected += 1;
      else inProgress += 1;
    }
    return html`
      ${this.tile('Rapports', this.reports.length, 'var(--theme-color-std-text)')}
      ${this.tile('En cours', inProgress, STATE_COLORS.intermediate)}
      ${this.tile('Approuvés', approved, STATE_COLORS.final)}
      ${this.tile('Rejetés', rejected, STATE_COLORS.rejected)}
    `;
  }

  private tile(label: string, value: number, color: string): TemplateResult {
    return html`<div class="tile">
      <div class="value" style="color:${color}">${value}</div>
      <div class="label">${label}</div>
    </div>`;
  }
}

function kpiStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .tile {
      min-width: 5.5rem;
      padding: 0.4rem 0.75rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
    }
    .value {
      font-size: 1.4rem;
      font-weight: 700;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .label {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
  `;
}
