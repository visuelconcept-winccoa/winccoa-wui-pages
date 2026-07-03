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
import { customElement, property, state } from 'lit/decorators.js';
import { CATALOG_KINDS, kindLabel } from '../data/catalog.js';
import { MSG, localizeDir } from '../i18n.js';
import {
  STATE_FAULT,
  STATE_OFF,
  STATE_RUN,
  STATE_WARNING,
  pkLabel,
  stateColor,
  tubeEquipment,
  tubeLengthM,
  type EquipmentDef,
  type EquipmentKind,
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

  /** '' = every kind. */
  @state() private kindFilter: EquipmentKind | '' = '';
  /** null = every state; a code filters to that state (undefined→off bucket). */
  @state() private stateFilter: number | null = null;
  @state() private showNames = false;

  override render(): TemplateResult | typeof nothing {
    const tunnel = this.tunnel;
    if (!tunnel) return nothing;
    return html`
      <div class="wrap">
        ${this.renderToolbar(tunnel)}
        ${tunnel.tubes.map((tube) => this.renderTube(tunnel, tube))}
      </div>
    `;
  }

  /** Bucket an equipment state for counting/filtering (undefined → off). */
  private bucketOf(equipment: EquipmentDef): number {
    return equipment.state ?? STATE_OFF;
  }

  private countByState(tunnel: Tunnel, bucket: number): number {
    return tunnel.equipment.filter((e) => this.bucketOf(e) === bucket).length;
  }

  /** Clickable state counters + kind filter + name toggle. */
  private renderToolbar(tunnel: Tunnel): TemplateResult {
    const buckets: { code: number; cls: string; label: unknown }[] = [
      { code: STATE_FAULT, cls: 'fault', label: localizeDir(MSG.synoptic.legendFault) },
      { code: STATE_WARNING, cls: 'warn', label: localizeDir(MSG.synoptic.legendWarning) },
      { code: STATE_RUN, cls: 'run', label: localizeDir(MSG.synoptic.legendRun) },
      { code: STATE_OFF, cls: 'off', label: localizeDir(MSG.synoptic.legendOff) }
    ];
    return html`
      <div class="toolbar">
        ${buckets.map(
          (b) => html`<button
            class="state-chip ${b.cls} ${this.stateFilter === b.code ? 'on' : ''}"
            @click=${() => (this.stateFilter = this.stateFilter === b.code ? null : b.code)}
          >
            <i class="dot ${b.cls}"></i>${this.countByState(tunnel, b.code)} ${b.label}
          </button>`
        )}
        <span class="spacer"></span>
        <ix-select
          class="kind-filter"
          .value=${this.kindFilter}
          @valueChange=${(e: CustomEvent<string>) => (this.kindFilter = String(e.detail) as EquipmentKind | '')}
        >
          <ix-select-item label=${String(localizeDir(MSG.synoptic.allKinds))} value=""></ix-select-item>
          ${CATALOG_KINDS.map((k) => html`<ix-select-item label=${kindLabel(k)} value=${k}></ix-select-item>`)}
        </ix-select>
        <ix-icon-button
          icon="label"
          variant=${this.showNames ? 'primary' : 'secondary'}
          ghost
          title=${String(localizeDir(MSG.synoptic.showNames))}
          @click=${() => (this.showNames = !this.showNames)}
        ></ix-icon-button>
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
          ${tubeEquipment(tunnel, tube.id)
            .filter((e) => this.kindFilter === '' || e.kind === this.kindFilter)
            .filter((e) => this.stateFilter === null || this.bucketOf(e) === this.stateFilter)
            .map((e) => this.renderEquipment(e, x))}
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
    const pulse = equipment.state === STATE_FAULT ? 'pulse' : '';
    const title = `${equipment.name} — ${kindLabel(equipment.kind)} (${pkLabel(equipment.pkM)})`;
    const name = this.showNames
      ? svg`<text class="glyph-name" x=${cx} y=${cy - 10} text-anchor="middle">${equipment.name}</text>`
      : nothing;
    // Exits are squares, SOS niches diamonds, the rest dots — shape carries kind.
    if (equipment.kind === 'emergency-exit') {
      return svg`${name}<rect class="glyph ${pulse}" x=${cx - 5} y=${cy - 5} width="10" height="10" fill=${color}
        tabindex="0" @click=${() => this.select(equipment)} @keydown=${(e: KeyboardEvent) => this.key(e, equipment)}>
        <title>${title}</title></rect>`;
    }
    if (equipment.kind === 'sos-niche') {
      return svg`${name}<rect class="glyph ${pulse}" x=${cx - 5} y=${cy - 5} width="10" height="10" fill=${color}
        transform="rotate(45 ${cx} ${cy})" tabindex="0" @click=${() => this.select(equipment)}
        @keydown=${(e: KeyboardEvent) => this.key(e, equipment)}><title>${title}</title></rect>`;
    }
    return svg`${name}<circle class="glyph ${pulse}" cx=${cx} cy=${cy} r="6" fill=${color} tabindex="0"
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
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .toolbar .spacer {
      flex: 1;
    }
    .state-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font: inherit;
      font-size: 0.85rem;
      padding: 0.2rem 0.7rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 1rem;
      background: transparent;
      color: var(--theme-color-soft-text);
      cursor: pointer;
      font-variant-numeric: tabular-nums;
    }
    .state-chip.on {
      border-color: var(--theme-color-primary);
      color: var(--theme-color-std-text);
    }
    .state-chip:focus-visible {
      outline: 1px solid var(--theme-color-primary);
    }
    .kind-filter {
      min-width: 13rem;
    }
    .glyph-name {
      fill: var(--theme-color-soft-text);
      font-size: 9px;
      pointer-events: none;
    }
    .glyph.pulse {
      animation: hd-pulse 1.1s ease-in-out infinite;
    }
    @keyframes hd-pulse {
      50% {
        opacity: 0.25;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .glyph.pulse {
        animation: none;
      }
    }
    .legend .dot,
    .toolbar .dot {
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
