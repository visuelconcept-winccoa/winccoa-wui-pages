/**
 * Summary KPI strip for the thermal-report list: total count plus a per-status
 * breakdown (en cours / terminés / validés) and a non-conformity count. Computed
 * locally from the `.reports` property.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { CONFORMITY_COLORS, STATUS_COLORS, type ThermalReport } from '../types.js';

interface Kpi {
  value: number;
  label: string;
  color?: string;
}

@customElement('tt-kpi-bar')
export class TtKpiBar extends LitElement {
  static override readonly styles = [IXCoreStyles, kpiStyles()];

  @property({ attribute: false }) reports: ThermalReport[] = [];

  override render(): TemplateResult {
    const running = this.reports.filter((r) => r.status === 'running').length;
    const completed = this.reports.filter((r) => r.status === 'completed').length;
    const validated = this.reports.filter((r) => r.status === 'validated').length;
    const nonconform = this.reports.filter((r) => r.conformity === 'nonconform').length;
    const kpis: Kpi[] = [
      { value: this.reports.length, label: 'Rapports' },
      { value: running, label: 'En cours', color: STATUS_COLORS.running },
      { value: completed, label: 'Terminés', color: STATUS_COLORS.completed },
      { value: validated, label: 'Validés', color: STATUS_COLORS.validated },
      { value: nonconform, label: 'Non conformes', color: CONFORMITY_COLORS.nonconform }
    ];
    return html`
      <div class="bar">
        ${kpis.map(
          (kpi) => html`
            <div class="kpi" style=${kpi.color ? `--c:${kpi.color}` : ''}>
              <span class="value">${kpi.value}</span>
              <span class="label">${kpi.label}</span>
            </div>
          `
        )}
      </div>
    `;
  }
}

function kpiStyles(): ReturnType<typeof css> {
  return css`
    .bar {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      padding: 0.75rem 0;
    }
    .kpi {
      flex: 1 1 0;
      min-width: 6rem;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.15rem;
      padding: 0.75rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-top: 3px solid var(--c, var(--theme-color-soft-bdr));
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
    }
    .value {
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--c, var(--theme-color-std-text));
    }
    .label {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
  `;
}
