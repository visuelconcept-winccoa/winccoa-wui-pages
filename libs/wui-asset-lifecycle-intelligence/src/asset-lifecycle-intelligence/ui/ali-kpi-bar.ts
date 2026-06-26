/**
 * Summary KPI strip: total asset count and a per-risk-level breakdown
 * (Low / Moderate / High / Critical) with the fleet's average score.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localizeDir } from '../i18n.js';
import { RISK_BANDS, computeRisk } from '../risk.js';
import type { Asset, RiskLevel } from '../types.js';

@customElement('ali-kpi-bar')
export class AliKpiBar extends LitElement {
  static override readonly styles = [IXCoreStyles, kpiStyles()];

  @property({ attribute: false }) assets: Asset[] = [];

  override render(): TemplateResult {
    const counts: Record<RiskLevel, number> = { low: 0, moderate: 0, high: 0, critical: 0 };
    let total = 0;
    for (const asset of this.assets) {
      const risk = computeRisk(asset);
      counts[risk.level] += 1;
      total += risk.score;
    }
    const avg = this.assets.length > 0 ? Math.round(total / this.assets.length) : 0;
    return html`
      <div class="bar">
        <div class="kpi total">
          <span class="value">${this.assets.length}</span>
          <span class="label">${localizeDir(MSG.kpi.assets)}</span>
        </div>
        ${RISK_BANDS.map(
          (band) => html`
            <div class="kpi" style="--c:${band.color}">
              <span class="value">${counts[band.level]}</span>
              <span class="label">${localizeDir(band.label)}</span>
            </div>
          `
        )}
        <div class="kpi avg">
          <span class="value">${avg}</span>
          <span class="label">${localizeDir(MSG.kpi.avgScore)}</span>
        </div>
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
    .kpi.total .value,
    .kpi.avg .value {
      color: var(--theme-color-std-text);
    }
    .label {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
  `;
}
