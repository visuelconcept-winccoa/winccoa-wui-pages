// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Linear synoptic — the tunnel unrolled on its PK axis, one band per tube:
 * segments as proportional blocks (labelled with gradient/zone), every
 * equipment as a glyph at its PK coloured by live state, and PK ticks every
 * 250 m. This is the control-room "scan it in two seconds" view; clicking a
 * glyph opens the same equipment dialog as the 3D twin. Pure SVG generated
 * from the tunnel config — no extra dependency.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, svg, type SVGTemplateResult, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { kindLabel } from '../data/catalog.js';
import { MSG, localizeDir } from '../i18n.js';
import {
  pkLabel,
  stateColor,
  tubeEquipment,
  tubeLengthM,
  type EquipmentDef,
  type Tunnel,
  type TubeDef
} from '../types.js';

const VIEW_W = 1200;
const BAND_H = 150;
const TUBE_Y = 58;
const TUBE_H = 40;
const MARGIN_X = 40;
const TICK_EVERY_M = 250;
/** Vertical glyph lanes so co-located equipment doesn't overlap. */
const SIDE_Y: Record<EquipmentDef['side'], number> = {
  ceiling: TUBE_Y - 14,
  left: TUBE_Y + 8,
  right: TUBE_Y + TUBE_H - 8,
  roadway: TUBE_Y + TUBE_H + 16
};

@customElement('hd-synoptic')
export class HdSynoptic extends LitElement {
  static override readonly styles = [IXCoreStyles, synopticStyles()];

  @property({ attribute: false }) tunnel: Tunnel | null = null;
  /** Bumped by the tunnel view on every live emission (recolours the glyphs). */
  @property({ type: Number }) liveTick = 0;

  override render(): TemplateResult | typeof nothing {
    const tunnel = this.tunnel;
    if (!tunnel) return nothing;
    return html`
      <div class="wrap">
        ${tunnel.tubes.map((tube) => this.renderTube(tunnel, tube))}
        <div class="legend">
          <span><i class="dot run"></i>${localizeDir(MSG.synoptic.legendRun)}</span>
          <span><i class="dot warn"></i>${localizeDir(MSG.synoptic.legendWarning)}</span>
          <span><i class="dot fault"></i>${localizeDir(MSG.synoptic.legendFault)}</span>
          <span><i class="dot off"></i>${localizeDir(MSG.synoptic.legendOff)}</span>
        </div>
      </div>
    `;
  }

  private renderTube(tunnel: Tunnel, tube: TubeDef): TemplateResult {
    const lengthM = Math.max(1, tubeLengthM(tube));
    const scale = (VIEW_W - 2 * MARGIN_X) / lengthM;
    const x = (pkM: number): number => MARGIN_X + pkM * scale;
    return html`
      <div class="tube-card">
        <div class="tube-title">
          ${tube.name} — ${Math.round(lengthM)} m ·
          ${tube.lanes} ${localizeDir(MSG.synoptic.lanes)}
        </div>
        <svg viewBox="0 0 ${VIEW_W} ${BAND_H}" role="img">
          ${this.renderSegments(tube, x)} ${this.renderTicks(lengthM, x)}
          ${tubeEquipment(tunnel, tube.id).map((e) => this.renderEquipment(e, x))}
        </svg>
      </div>
    `;
  }

  private renderSegments(tube: TubeDef, x: (pk: number) => number): SVGTemplateResult[] {
    const parts: SVGTemplateResult[] = [];
    let pk = 0;
    for (const segment of tube.segments) {
      const x0 = x(pk);
      const x1 = x(pk + segment.lengthM);
      parts.push(svg`
        <rect class="segment ${segment.lightingZone}" x=${x0} y=${TUBE_Y} width=${x1 - x0} height=${TUBE_H}></rect>
        <text class="segment-label" x=${(x0 + x1) / 2} y=${TUBE_Y + TUBE_H / 2 + 4} text-anchor="middle">
          ${segment.name} · ${segment.gradientPct > 0 ? '+' : ''}${segment.gradientPct}%
        </text>
      `);
      pk += segment.lengthM;
    }
    return parts;
  }

  private renderTicks(lengthM: number, x: (pk: number) => number): SVGTemplateResult[] {
    const ticks: SVGTemplateResult[] = [];
    for (let pk = 0; pk <= lengthM; pk += TICK_EVERY_M) {
      ticks.push(svg`
        <line class="tick" x1=${x(pk)} y1=${TUBE_Y + TUBE_H} x2=${x(pk)} y2=${TUBE_Y + TUBE_H + 26}></line>
        <text class="tick-label" x=${x(pk)} y=${TUBE_Y + TUBE_H + 40} text-anchor="middle">${pkLabel(pk)}</text>
      `);
    }
    return ticks;
  }

  private renderEquipment(equipment: EquipmentDef, x: (pk: number) => number): SVGTemplateResult {
    const cx = x(equipment.pkM);
    const cy = SIDE_Y[equipment.side];
    const color = stateColor(equipment.state);
    const title = `${equipment.name} — ${kindLabel(equipment.kind)} (${pkLabel(equipment.pkM)})`;
    // Exits are squares, SOS niches diamonds, the rest dots — shape carries kind.
    if (equipment.kind === 'emergency-exit') {
      return svg`<rect class="glyph" x=${cx - 5} y=${cy - 5} width="10" height="10" fill=${color}
        tabindex="0" @click=${() => this.select(equipment)} @keydown=${(e: KeyboardEvent) => this.key(e, equipment)}>
        <title>${title}</title></rect>`;
    }
    if (equipment.kind === 'sos-niche') {
      return svg`<rect class="glyph" x=${cx - 5} y=${cy - 5} width="10" height="10" fill=${color}
        transform="rotate(45 ${cx} ${cy})" tabindex="0" @click=${() => this.select(equipment)}
        @keydown=${(e: KeyboardEvent) => this.key(e, equipment)}><title>${title}</title></rect>`;
    }
    return svg`<circle class="glyph" cx=${cx} cy=${cy} r="6" fill=${color} tabindex="0"
      @click=${() => this.select(equipment)} @keydown=${(e: KeyboardEvent) => this.key(e, equipment)}>
      <title>${title}</title></circle>`;
  }

  private key(event: KeyboardEvent, equipment: EquipmentDef): void {
    if (event.key === 'Enter' || event.key === ' ') this.select(equipment);
  }

  private select(equipment: EquipmentDef): void {
    this.dispatchEvent(new CustomEvent<EquipmentDef>('wui:equipment', { detail: equipment }));
  }
}

function synopticStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .wrap {
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .tube-card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.8rem;
      overflow-x: auto;
    }
    .tube-title {
      color: var(--theme-color-soft-text);
      margin-bottom: 0.4rem;
    }
    svg {
      width: 100%;
      min-width: 760px;
      height: auto;
      display: block;
    }
    .segment {
      fill: var(--theme-color-2);
      stroke: var(--theme-color-soft-bdr);
    }
    .segment.entrance,
    .segment.exit {
      fill: var(--theme-color-3);
    }
    .segment-label {
      fill: var(--theme-color-soft-text);
      font-size: 11px;
    }
    .tick {
      stroke: var(--theme-color-soft-bdr);
    }
    .tick-label {
      fill: var(--theme-color-weak-text);
      font-size: 10px;
      font-variant-numeric: tabular-nums;
    }
    .glyph {
      cursor: pointer;
      stroke: var(--theme-color-1);
      stroke-width: 1;
    }
    .glyph:hover,
    .glyph:focus-visible {
      stroke: var(--theme-color-primary);
      stroke-width: 2;
      outline: none;
    }
    .legend {
      display: flex;
      gap: 1.2rem;
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .legend .dot {
      display: inline-block;
      width: 0.7rem;
      height: 0.7rem;
      border-radius: 50%;
      margin-right: 0.35rem;
    }
    .legend .dot.run {
      background: var(--theme-color-success);
    }
    .legend .dot.warn {
      background: var(--theme-color-warning);
    }
    .legend .dot.fault {
      background: var(--theme-color-alarm);
    }
    .legend .dot.off {
      background: var(--theme-color-neutral);
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-synoptic': HdSynoptic;
  }
}
