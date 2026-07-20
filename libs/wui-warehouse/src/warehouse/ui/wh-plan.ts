// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * 2D warehouse plan: each zone is a translucent rectangle, each location a cell
 * filled by its occupancy (grey empty → green → amber → red full). Presentational
 * — clicking a location emits `wui:select {locationId}`; the page shows its
 * contents. Coordinates are in grid units (zone rect absolute, location rect
 * relative to its zone) fed straight into the SVG viewBox.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localizeDir } from '../i18n.js';
import { locationUnits, occupancy, occupancyColor } from '../model.js';
import type { StockCell, StorageLocation, Zone } from '../types.js';

const PAD = 1;

@customElement('wh-plan')
export class WhPlan extends LitElement {
  static override readonly styles = [IXCoreStyles, planStyles()];

  @property({ attribute: false }) zones: Zone[] = [];
  @property({ attribute: false }) locations: StorageLocation[] = [];
  @property({ attribute: false }) stock: StockCell[] = [];
  @property({ type: String }) selectedId = '';

  override render(): TemplateResult {
    const extent = this.extent();
    return html`
      <div class="canvas">
        <svg viewBox="0 0 ${extent.w} ${extent.h}" preserveAspectRatio="xMidYMid meet">
          ${this.zones.map((z) => this.renderZone(z))} ${this.locations.map((l) => this.renderLocation(l))}
        </svg>
      </div>
      <div class="legend">
        <span class="lg-title">${localizeDir(MSG.plan.legend)}:</span>
        <span class="dot" style="--c:#64748b"></span>${localizeDir(MSG.plan.legEmpty)}
        <span class="dot" style="--c:#10b981"></span>${localizeDir(MSG.plan.legOk)}
        <span class="dot" style="--c:#f59e0b"></span>${localizeDir(MSG.plan.legHigh)}
        <span class="dot" style="--c:#ef4444"></span>${localizeDir(MSG.plan.legFull)}
      </div>
    `;
  }

  private renderZone(zone: Zone): SVGTemplateResult {
    return svg`
      <g>
        <rect x=${zone.x} y=${zone.y} width=${zone.w} height=${zone.h} rx="0.4"
          fill=${zone.color} fill-opacity="0.08" stroke=${zone.color} stroke-width="0.12"></rect>
        <text x=${zone.x + 0.4} y=${zone.y + 0.95} class="zone-label" fill=${zone.color}>
          ${zone.code} · ${zone.name}
        </text>
      </g>`;
  }

  private renderLocation(loc: StorageLocation): SVGTemplateResult {
    const zone = this.zones.find((z) => z.id === loc.zoneId);
    if (!zone) return svg``;
    const gx = zone.x + loc.x;
    const gy = zone.y + loc.y;
    const units = locationUnits(this.stock, loc.id);
    const color = occupancyColor(occupancy(units, loc.capacity), units > 0);
    const selected = loc.id === this.selectedId;
    return svg`
      <g class="loc" @click=${() => this.select(loc.id)}>
        <rect x=${gx} y=${gy} width=${loc.w} height=${loc.h} rx="0.25"
          fill=${color} fill-opacity=${units > 0 ? 0.85 : 0.22}
          stroke=${selected ? '#ffffff' : color} stroke-width=${selected ? 0.22 : 0.06}></rect>
        <text x=${gx + loc.w / 2} y=${gy + loc.h / 2 - 0.1} text-anchor="middle" class="loc-code">${loc.code}</text>
        <text x=${gx + loc.w / 2} y=${gy + loc.h / 2 + 0.85} text-anchor="middle" class="loc-units">${units}</text>
      </g>`;
  }

  private select(locationId: string): void {
    this.dispatchEvent(new CustomEvent('wui:select', { detail: { locationId }, bubbles: true, composed: true }));
  }

  /** Bounding grid extent (max zone corner) plus a padding margin. */
  private extent(): { w: number; h: number } {
    let w = 10;
    let h = 8;
    for (const z of this.zones) {
      w = Math.max(w, z.x + z.w);
      h = Math.max(h, z.y + z.h);
    }
    return { w: w + PAD, h: h + PAD };
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function planStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .canvas {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0.5rem;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    svg {
      width: 100%;
      height: 100%;
      max-height: 60vh;
    }
    .zone-label {
      font-size: 0.7px;
      font-weight: 600;
    }
    .loc {
      cursor: pointer;
    }
    .loc-code {
      font-size: 0.62px;
      font-weight: 700;
      fill: #ffffff;
    }
    .loc-units {
      font-size: 0.55px;
      fill: rgba(255, 255, 255, 0.9);
    }
    .legend {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      padding: 0.5rem 0.25rem 0;
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .lg-title {
      font-weight: 600;
    }
    .dot {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      background: var(--c);
      margin-left: 0.5rem;
    }
  `;
}
