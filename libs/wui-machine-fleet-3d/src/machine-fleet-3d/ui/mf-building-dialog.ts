// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog to configure the building (length / width / height / bays /
 * column step / roof / floor), mirroring the prototype's "Architecture" modal.
 * Self-contained overlay inside the shadow root (guide-approved pattern).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import {
  DEFAULT_BUILDING,
  DEFAULT_NAV_CORNER,
  NAV_CORNER_LABELS,
  type BuildingConfig,
  type FloorType,
  type NavCorner,
  type RoofType
} from '../types.js';
import { FLOOR_PATTERNS } from '../scene/floor-patterns.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string | number;
}

const ROOF_TYPES: RoofType[] = ['shed', 'flat', 'monoslope', 'none'];
const ROOF_TYPE_LABELS: Record<RoofType, string> = {
  shed: 'Sheds (redents)',
  flat: 'Plate',
  monoslope: 'Monopente',
  none: 'Aucune'
};
// Driven from the pattern registry so new floor types appear automatically.
const FLOOR_TYPES = Object.keys(FLOOR_PATTERNS) as FloorType[];
const NAV_CORNERS = Object.keys(NAV_CORNER_LABELS) as NavCorner[];

@customElement('mf-building-dialog')
export class MfBuildingDialog extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    dialogStyles(),
    css`
      .sliders {
        display: flex;
        flex-direction: column;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      .slider-head {
        display: flex;
        justify-content: space-between;
        margin-bottom: 0.1rem;
        color: var(--theme-color-soft-text);
      }
      .slider-val {
        font-weight: 600;
        color: var(--theme-color-std-text);
      }
    `
  ];

  @property({ attribute: false }) building: BuildingConfig = { ...DEFAULT_BUILDING };
  /** When false, the dialog is view-only: applying changes is disabled. */
  @property({ type: Boolean }) canEdit = true;

  /** Dialog-owned working copy: edits stay local until "Appliquer", and parent
   * re-renders (live datapoint updates) never reset the in-progress selection. */
  @state() private working: BuildingConfig = { ...DEFAULT_BUILDING };
  private seeded = false;

  override render(): TemplateResult {
    const b = this.working;
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">Configuration du bâtiment</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="sliders">
              ${this.slider('Longueur (m)', b.length, 40, 400, 5, (v) => this.patch({ length: v }))}
              ${this.slider('Largeur (m)', b.width, 30, 200, 5, (v) => this.patch({ width: v }))}
              ${this.slider('Hauteur (m)', b.height, 5, 25, 1, (v) => this.patch({ height: v }))}
              ${this.slider('Travées', b.bays, 1, 6, 1, (v) => this.patch({ bays: v }))}
              ${this.slider('Pas poteaux (m)', b.colStep, 6, 40, 1, (v) => this.patch({ colStep: v }))}
            </div>
            <div class="grid2">
              <ix-select
                label="Type de toiture"
                .value=${b.roofType}
                @valueChange=${(e: IxValueEvent) => this.patch({ roofType: e.detail as RoofType })}
              >
                ${ROOF_TYPES.map(
                  (t) => html`<ix-select-item label=${ROOF_TYPE_LABELS[t]} value=${t}></ix-select-item>`
                )}
              </ix-select>
              <ix-select
                label="Type de sol"
                .value=${b.floorType}
                @valueChange=${(e: IxValueEvent) => this.patch({ floorType: e.detail as FloorType })}
              >
                ${FLOOR_TYPES.map(
                  (t) => html`<ix-select-item
                    label=${FLOOR_PATTERNS[t].label}
                    value=${t}
                  ></ix-select-item>`
                )}
              </ix-select>
              <ix-select
                label="Boutons de navigation"
                .value=${b.navCorner ?? DEFAULT_NAV_CORNER}
                @valueChange=${(e: IxValueEvent) => this.patch({ navCorner: e.detail as NavCorner })}
              >
                ${NAV_CORNERS.map(
                  (c) => html`<ix-select-item label=${NAV_CORNER_LABELS[c]} value=${c}></ix-select-item>`
                )}
              </ix-select>
            </div>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>Fermer</ix-button>
            ${this.canEdit ? html`<ix-button @click=${this.apply}>Appliquer</ix-button>` : ''}
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    // Seed once per dialog instance (it is recreated on each open), so parent
    // re-renders that re-pass `building` cannot overwrite in-progress edits.
    if (!this.seeded && changed.has('building') && this.building) {
      this.working = { ...this.building };
      this.seeded = true;
    }
  }

  // eslint-disable-next-line max-params -- a labelled slider needs its bounds/step
  private slider(
    label: string,
    value: number,
    min: number,
    max: number,
    step: number,
    onChange: (v: number) => void
  ): TemplateResult {
    return html`
      <div class="slider-field">
        <div class="slider-head">
          <span>${label}</span>
          <span class="slider-val">${value}</span>
        </div>
        <ix-slider
          .value=${value}
          min=${min}
          max=${max}
          step=${step}
          @valueChange=${(e: IxValueEvent) => onChange(Number(e.detail))}
        ></ix-slider>
      </div>
    `;
  }

  private patch(patch: Partial<BuildingConfig>): void {
    this.working = { ...this.working, ...patch };
  }

  private apply(): void {
    this.dispatchEvent(
      new CustomEvent('wui:apply', {
        detail: { building: this.working },
        bubbles: true,
        composed: true
      })
    );
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}
