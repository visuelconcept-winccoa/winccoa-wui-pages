// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Warehouse floor plan with the live position of every vehicle.
 *
 * The SVG user space **is** the hall in metres ({@link FLOOR_WIDTH_M} ×
 * {@link FLOOR_HEIGHT_M}), so a vehicle's `posX` / `posY` are plotted as-is and
 * the static layout below is authored in the same units. Each marker is a disc
 * coloured by state with a nose showing `heading` (degrees clockwise from north).
 *
 * Emits: `wui:select` (`{ id }`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, svg, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localizeDir, markerTitle, stateLabel } from '../i18n.js';
import {
  AGV_STATES,
  FLOOR_HEIGHT_M,
  FLOOR_WIDTH_M,
  STATE_COLORS,
  type Agv
} from '../types.js';

/** A labelled rectangular area of the hall, in metres. */
interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  kind: 'rack' | 'charge' | 'maint' | 'dock' | 'park' | 'pick';
}

/** Static layout of the demo hall — racking, charging bay, docks, pick stations. */
const AREAS: Area[] = [
  { x: 12, y: 11, w: 19, h: 2, label: 'R10 – R19', kind: 'rack' },
  { x: 12, y: 16, w: 19, h: 2, label: 'R20 – R29', kind: 'rack' },
  { x: 12, y: 21, w: 19, h: 2, label: 'R30 – R39', kind: 'rack' },
  { x: 0.8, y: 19, w: 5.2, h: 5.5, label: 'C1', kind: 'charge' },
  { x: 0.8, y: 25, w: 5.2, h: 5.5, label: 'M1', kind: 'maint' },
  { x: 3, y: 2, w: 6, h: 4, label: 'Z0', kind: 'park' },
  { x: 20, y: 30, w: 5, h: 1.5, label: 'D1', kind: 'dock' },
  { x: 27, y: 30, w: 5, h: 1.5, label: 'D2', kind: 'dock' },
  { x: 9.2, y: 11, w: 2, h: 2, label: 'P1', kind: 'pick' },
  { x: 9.2, y: 16, w: 2, h: 2, label: 'P2', kind: 'pick' },
  { x: 9.2, y: 21, w: 2, h: 2, label: 'P3', kind: 'pick' }
];

/** Guide paths the vehicles follow (polyline point lists, metres). */
const GUIDE_PATHS = [
  '8,1.5 8,30.5',
  '8,8.5 34,8.5',
  '8,14.5 34,14.5',
  '8,19.5 34,19.5',
  '8,25.5 34,25.5',
  '33.5,8.5 33.5,30'
];

/** Marker geometry, metres. */
const MARKER_RADIUS = 1.05;
const NOSE_LENGTH = 0.75;
/** Half-width of the heading nose and how far its base sinks into the disc. */
const NOSE_HALF_WIDTH = 0.55;
const NOSE_BASE_INSET = 0.15;
/** Distance from the marker centre to its id label, metres. */
const LABEL_OFFSET = 2;
/** Selection halo radius, as a multiple of the marker radius. */
const HALO_SCALE = 2;

/** Inset of the hall outline from the viewBox edge, metres. */
const HALL_INSET = 0.2;
/** Half divisor used to centre an area label on its rectangle. */
const HALF = 2;

@customElement('af-map')
export class AfMap extends LitElement {
  static override readonly styles = [IXCoreStyles, mapStyles()];

  @property({ attribute: false }) fleet: Agv[] = [];
  /** Id of the selected vehicle, empty when none. */
  @property() selected = '';

  override render(): TemplateResult {
    return html`
      <div class="frame">
        <svg
          viewBox="0 0 ${FLOOR_WIDTH_M} ${FLOOR_HEIGHT_M}"
          preserveAspectRatio="xMidYMid meet"
          role="img"
        >
          <rect
            class="hall"
            x=${HALL_INSET}
            y=${HALL_INSET}
            width=${FLOOR_WIDTH_M - HALL_INSET * HALF}
            height=${FLOOR_HEIGHT_M - HALL_INSET * HALF}
            rx="0.4"
          />
          ${GUIDE_PATHS.map((points) => svg`<polyline class="guide" points=${points} />`)}
          ${AREAS.map((area) => this.renderArea(area))}
          ${this.fleet.map((agv) => this.renderMarker(agv))}
        </svg>
      </div>
      ${this.renderLegend()}
    `;
  }

  private renderArea(area: Area): TemplateResult {
    return svg`
      <g class="area ${area.kind}">
        <rect x=${area.x} y=${area.y} width=${area.w} height=${area.h} rx="0.25" />
        <text x=${area.x + area.w / HALF} y=${area.y + area.h / HALF} dominant-baseline="middle" text-anchor="middle">
          ${area.label}
        </text>
      </g>
    `;
  }

  private renderMarker(agv: Agv): TemplateResult {
    const isSelected = agv.id === this.selected;
    const shortName = agv.id.replace(/^AGV_?/i, '');
    return svg`
      <g
        class="marker ${isSelected ? 'selected' : ''}"
        style="--state-color: ${STATE_COLORS[agv.state]}"
        @click=${() => this.requestSelect(agv.id)}
      >
        <title>${markerTitle(agv.name || agv.id, stateLabel(agv.state), agv.battery)}</title>
        ${
          isSelected
            ? svg`<circle class="halo" cx=${agv.posX} cy=${agv.posY} r=${MARKER_RADIUS * HALO_SCALE} />`
            : ''
        }
        <g transform="rotate(${agv.heading} ${agv.posX} ${agv.posY})">
          <circle class="body" cx=${agv.posX} cy=${agv.posY} r=${MARKER_RADIUS} />
          <polygon class="nose" points=${this.nosePoints(agv.posX, agv.posY)} />
        </g>
        <text class="tag" x=${agv.posX} y=${agv.posY + LABEL_OFFSET} text-anchor="middle">${shortName}</text>
      </g>
    `;
  }

  /** Triangle pointing north from the marker's rim — rotated with the vehicle's heading. */
  private nosePoints(x: number, y: number): string {
    const tip = y - MARKER_RADIUS - NOSE_LENGTH;
    const base = y - MARKER_RADIUS + NOSE_BASE_INSET;
    return `${x},${tip} ${x - NOSE_HALF_WIDTH},${base} ${x + NOSE_HALF_WIDTH},${base}`;
  }

  private renderLegend(): TemplateResult {
    return html`
      <div class="legend">
        ${AGV_STATES.map(
          (state) => html`
            <span class="item" style="--state-color: ${STATE_COLORS[state]}">
              <span class="dot"></span>${stateLabel(state)}
            </span>
          `
        )}
        <span class="grow"></span>
        <span class="item muted"
          >${localizeDir(MSG.map.charging)} C1 ·
          ${localizeDir(MSG.map.maintenance)} M1 · ${localizeDir(MSG.map.docks)}
          D1/D2 · ${localizeDir(MSG.map.parking)} Z0</span
        >
      </div>
    `;
  }

  private requestSelect(id: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:select', {
        detail: { id },
        bubbles: true,
        composed: true
      })
    );
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function mapStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      gap: 0.5rem;
    }
    .frame {
      flex: 1;
      min-height: 0;
      display: flex;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      padding: 0.5rem;
    }
    svg {
      width: 100%;
      height: 100%;
      min-height: 0;
    }
    .hall {
      fill: var(--theme-color-2);
      stroke: var(--theme-color-soft-bdr);
      stroke-width: 0.12;
    }
    .guide {
      fill: none;
      stroke: var(--theme-color-soft-bdr);
      stroke-width: 0.1;
      stroke-dasharray: 0.6 0.5;
    }
    .area text {
      font-size: 0.85px;
      fill: var(--theme-color-soft-text);
      pointer-events: none;
    }
    /*
     * Areas are IDENTIFIED BY THEIR OUTLINE, not by a saturated fill: a vehicle
     * marker sits on top of them, and a strongly tinted zone swallowed it —
     * a charging AGV on a charging-blue bay is the same hue as its own bay, and
     * the rack fill used to be the near-black --theme-color-component-1. Fills
     * stay ≤ 10% so every state colour keeps its contrast against them.
     */
    .area rect {
      stroke-width: 0.08;
    }
    .area.rack rect {
      fill: color-mix(in srgb, var(--theme-color-soft-text) 20%, transparent);
      stroke: var(--theme-color-soft-bdr);
    }
    .area.charge rect {
      fill: color-mix(in srgb, var(--theme-color-information) 10%, transparent);
      stroke: var(--theme-color-information);
    }
    .area.maint rect {
      fill: color-mix(in srgb, var(--theme-color-warning) 8%, transparent);
      stroke: var(--theme-color-warning);
    }
    .area.dock rect {
      fill: color-mix(in srgb, var(--theme-color-primary) 10%, transparent);
      stroke: var(--theme-color-primary);
    }
    .area.park rect,
    .area.pick rect {
      fill: transparent;
      stroke: var(--theme-color-soft-bdr);
      stroke-dasharray: 0.4 0.3;
    }
    .marker {
      cursor: pointer;
    }
    /*
     * Two-ring outline: an outer ring in the page background separates the
     * marker from whatever it stands on, so it stays readable inside a zone
     * regardless of theme.
     */
    .marker .body {
      fill: var(--state-color);
      stroke: var(--theme-color-1);
      stroke-width: 0.24;
      paint-order: stroke;
    }
    .marker .nose {
      fill: var(--state-color);
      stroke: var(--theme-color-1);
      stroke-width: 0.18;
      paint-order: stroke;
    }
    .marker:hover .body {
      stroke: var(--theme-color-std-text);
    }
    .marker .halo {
      fill: none;
      stroke: var(--theme-color-primary);
      stroke-width: 0.18;
    }
    .marker .tag {
      font-size: 0.9px;
      font-weight: 600;
      fill: var(--theme-color-std-text);
      pointer-events: none;
    }
    .legend {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      font-size: 0.75rem;
    }
    .legend .grow {
      flex: 1;
    }
    .item {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      white-space: nowrap;
    }
    .item.muted {
      color: var(--theme-color-soft-text);
    }
    .dot {
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 50%;
      background: var(--state-color);
    }
  `;
}
