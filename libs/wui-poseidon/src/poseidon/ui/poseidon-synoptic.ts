// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Process synoptic: the activated-sludge flow as a chain of stage cards — the
 * water line (screening → lift → aeration → clarifier → UV → outfall) with the
 * sludge line (RAS/WAS + dewatering) below. Each stage shows its key live sensor
 * readouts and a status dot per equipment (green running / grey stopped / red
 * fault). Read-only; commands live on the Equipment tab.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { EQ_FAULT, EQ_RUNNING, EQUIPMENT, sensorByPath } from '../model.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { fmt } from '../format.js';
import type { EquipmentStates, SensorValues } from '../types.js';

/** A stage of the process: its label, icon, key sensor paths and equipment ids. */
interface Stage {
  label: typeof MSG.synoptic.stageScreening;
  icon: string;
  sensors: string[];
  equipment: string[];
}

const WATER_LINE: Stage[] = [
  { label: MSG.synoptic.stageScreening, icon: 'list', sensors: ['inlet.flow', 'inlet.cod', 'inlet.tss', 'inlet.nh4'], equipment: [] },
  { label: MSG.synoptic.stageLift, icon: 'cogwheel', sensors: ['inlet.flow'], equipment: ['liftPump1', 'liftPump2', 'liftPump3'] },
  { label: MSG.synoptic.stageBio, icon: 'refresh', sensors: ['bio.do', 'bio.mlss', 'bio.redox'], equipment: ['blower1', 'blower2', 'mixer1', 'mixer2'] },
  { label: MSG.synoptic.stageClarifier, icon: 'refresh', sensors: ['clarifier.turbidity', 'clarifier.sludgeBlanket'], equipment: ['scraper'] },
  { label: MSG.synoptic.stageUv, icon: 'star-filled', sensors: [], equipment: ['uvReactor'] },
  { label: MSG.synoptic.stageOutfall, icon: 'export', sensors: ['outlet.flow', 'outlet.cod', 'outlet.tss', 'outlet.nh4'], equipment: [] }
];

const SLUDGE_LINE: Stage[] = [
  { label: MSG.synoptic.stageBio, icon: 'refresh', sensors: [], equipment: ['rasPump'] },
  { label: MSG.synoptic.stageDewatering, icon: 'cogwheel', sensors: ['sludge.flow', 'sludge.dryness'], equipment: ['wasPump', 'centrifuge'] }
];

export class PoseidonSynoptic extends LitElement {
  static override readonly styles = [IXCoreStyles, synopticStyles()];

  @property({ attribute: false }) sensors: SensorValues = {};
  @property({ attribute: false }) equipment: EquipmentStates = {};
  @property({ type: String }) lastUpdate = '';

  override render(): TemplateResult {
    return html`
      <section class="synoptic">
        <div class="head">
          <h3>${localizeDir(MSG.synoptic.title)}</h3>
          ${this.lastUpdate ? html`<span class="upd">${localizeDir(MSG.synoptic.lastUpdate)} : ${this.lastUpdate}</span>` : nothing}
        </div>

        <div class="line-label">${localizeDir(MSG.synoptic.waterLine)}</div>
        <div class="line">${WATER_LINE.map((s, i) => this.renderStage(s, i < WATER_LINE.length - 1))}</div>

        <div class="line-label">${localizeDir(MSG.synoptic.sludgeLine)}</div>
        <div class="line">${SLUDGE_LINE.map((s, i) => this.renderStage(s, i < SLUDGE_LINE.length - 1))}</div>
      </section>
    `;
  }

  private renderStage(stage: Stage, arrow: boolean): TemplateResult {
    return html`
      <div class="stage">
        <div class="card">
          <div class="card-top">
            <ix-icon name=${stage.icon} size="18"></ix-icon>
            <span>${localizeDir(stage.label)}</span>
          </div>
          ${stage.sensors.length > 0
            ? html`<div class="sensors">${stage.sensors.map((p) => this.renderSensor(p))}</div>`
            : nothing}
          ${stage.equipment.length > 0
            ? html`<div class="equip">${stage.equipment.map((id) => this.renderEquip(id))}</div>`
            : nothing}
        </div>
        ${arrow ? html`<div class="arrow"><ix-icon name="chevron-right" size="20"></ix-icon></div>` : nothing}
      </div>
    `;
  }

  private renderSensor(path: string): TemplateResult {
    const f = sensorByPath(path);
    if (!f) return html`${nothing}`;
    const v = fmt(this.sensors[path], f.decimals);
    return html`<div class="sensor">
      <span class="s-label">${localize(f.label)}</span>
      <span class="s-val">${v}${f.unit ? html` <span class="s-unit">${f.unit}</span>` : nothing}</span>
    </div>`;
  }

  private renderEquip(id: string): TemplateResult {
    const def = EQUIPMENT.find((e) => e.id === id);
    if (!def) return html`${nothing}`;
    const st = this.equipment[id]?.state ?? 0;
    const cls = st === EQ_RUNNING ? 'run' : st === EQ_FAULT ? 'fault' : 'stop';
    return html`<span class="e-chip" title=${localize(def.label)}>
      <span class="dot ${cls}"></span>${localize(def.label)}
    </span>`;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function synopticStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .synoptic {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 1rem;
    }
    h3 {
      margin: 0;
    }
    .upd {
      font-size: 0.8rem;
      opacity: 0.65;
    }
    .line-label {
      font-size: 0.8rem;
      font-weight: 600;
      opacity: 0.75;
      margin-top: 0.4rem;
    }
    .line {
      display: flex;
      flex-wrap: wrap;
      align-items: stretch;
      gap: 0.2rem;
    }
    .stage {
      display: flex;
      align-items: center;
    }
    .card {
      min-width: 150px;
      height: 100%;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.6rem 0.7rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 6px;
      background: var(--theme-color-1);
    }
    .card-top {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .sensors {
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .sensor {
      display: flex;
      justify-content: space-between;
      gap: 0.6rem;
      font-size: 0.8rem;
    }
    .s-label {
      opacity: 0.7;
    }
    .s-val {
      font-variant-numeric: tabular-nums;
      font-weight: 600;
    }
    .s-unit {
      font-weight: 400;
      opacity: 0.7;
    }
    .equip {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .e-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.75rem;
    }
    .dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      background: var(--theme-color-neutral, #7f8081);
      flex: 0 0 auto;
    }
    .dot.run {
      background: var(--theme-color-success, #01893a);
    }
    .dot.fault {
      background: var(--theme-color-alarm, #d1002e);
    }
    .arrow {
      display: flex;
      align-items: center;
      opacity: 0.5;
      padding: 0 0.1rem;
    }
  `;
}

if (!customElements.get('poseidon-synoptic')) {
  customElements.define('poseidon-synoptic', PoseidonSynoptic);
}
