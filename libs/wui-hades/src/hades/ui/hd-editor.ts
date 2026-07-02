// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Segment editor + compliance advisor.
 *
 * Left: the tunnel identity (regulatory profile, traffic) and, per tube, the
 * ordered segment table (length / gradient / curve / clearance / lighting
 * zone) plus the equipment list of that tube. Right: the compliance advisor
 * re-checked on EVERY edit — deviations from the selected regulatory profile
 * appear while the user is still typing. Emits `wui:save` with the edited
 * tunnel copy (the shell persists + audits) and `wui:equipment` to open one
 * equipment in the dialog.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { CATALOG_KINDS, kindLabel } from '../data/catalog.js';
import { ALL_PROFILES, checkCompliance, profileLabel, type ComplianceIssue } from '../data/compliance.js';
import { fixIssue, isFixable, placeSeries, type SeriesOptions } from '../data/placement.js';
import { MSG, dirLabel, localize, localizeDir, sideLabel, zoneLabel } from '../i18n.js';
import {
  pkLabel,
  tubeEquipment,
  tubeLengthM,
  type EquipmentDef,
  type EquipmentKind,
  type EquipmentSide,
  type LightingZone,
  type RegulatoryProfileId,
  type SegmentDef,
  type Tunnel,
  type TubeDef,
  type TubeDirection
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string;
}

const ZONES: readonly LightingZone[] = ['entrance', 'transition', 'interior', 'exit'];
const DIRECTIONS: readonly TubeDirection[] = ['unidirectional', 'bidirectional'];
const SIDES: readonly EquipmentSide[] = ['left', 'right', 'ceiling', 'roadway'];
/** Series-dialog defaults. */
const DEFAULT_SERIES_EVERY_M = 200;
const SEVERITY_ICON: Record<ComplianceIssue['severity'], string> = {
  error: 'warning',
  warning: 'info',
  info: 'bulb'
};

@customElement('hd-editor')
export class HdEditor extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), editorStyles()];

  @property({ attribute: false }) tunnel: Tunnel | null = null;
  @property({ type: Boolean }) canEdit = false;

  @state() private working: Tunnel | null = null;
  @state() private dirty = false;
  /** Tube targeted by the open "place a series" dialog ('' = closed). */
  @state() private seriesTubeId = '';
  @state() private seriesDraft: Omit<SeriesOptions, 'tubeId'> = freshSeriesDraft(0);

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('tunnel')) {
      this.working = this.tunnel ? structuredClone(this.tunnel) : null;
      this.dirty = false;
    }
  }

  override render(): TemplateResult | typeof nothing {
    const working = this.working;
    if (!working) return nothing;
    const issues = checkCompliance(working);
    return html`
      <div class="layout">
        <div class="main">
          ${this.renderIdentity(working)}
          ${working.tubes.map((tube) => this.renderTube(working, tube))}
          <div class="actions">
            <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.addTube()}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addTube)}
            </ix-button>
            <div class="spacer"></div>
            <ix-button ?disabled=${!this.canEdit || !this.dirty} @click=${() => this.save()}>
              ${localizeDir(MSG.editor.save)}
            </ix-button>
          </div>
        </div>
        <aside class="advisor">
          <ix-typography format="h4">${localizeDir(MSG.editor.advisorTitle)}</ix-typography>
          <div class="advisor-sub">${profileLabel(working.profile)}</div>
          ${issues.length === 0
            ? html`<div class="ok-note">
                <ix-icon name="check" size="16"></ix-icon>${localizeDir(MSG.editor.noIssue)}
              </div>`
            : issues.map(
                (issue) => html`
                  <div class="issue ${issue.severity}">
                    <ix-icon name=${SEVERITY_ICON[issue.severity]} size="16"></ix-icon>
                    <div class="issue-body">
                      <div>${issue.message}</div>
                      <span class="ref">${issue.ref}</span>
                      ${this.canEdit && isFixable(issue)
                        ? html`<ix-button
                            class="fix"
                            variant="secondary"
                            @click=${() => this.onFix(issue)}
                          >
                            <ix-icon name="cogwheel" slot="icon"></ix-icon>
                            ${localizeDir(MSG.editor.fix)}
                          </ix-button>`
                        : nothing}
                    </div>
                  </div>
                `
              )}
          <div class="disclaimer">${localizeDir(MSG.editor.disclaimer)}</div>
        </aside>
      </div>
      ${this.seriesTubeId !== '' ? this.renderSeriesDialog(working) : nothing}
    `;
  }

  private renderIdentity(working: Tunnel): TemplateResult {
    return html`
      <div class="card">
        <div class="grid3">
          <ix-input
            label=${localize(MSG.editor.tunnelName)}
            .value=${working.name}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.patch({ name: e.detail })}
          ></ix-input>
          <ix-select
            label=${localize(MSG.editor.profile)}
            .value=${working.profile}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.patch({ profile: String(e.detail) as RegulatoryProfileId })}
          >
            ${ALL_PROFILES.map(
              (p) => html`<ix-select-item label=${profileLabel(p)} value=${p}></ix-select-item>`
            )}
          </ix-select>
          <ix-number-input
            label=${localize(MSG.editor.traffic)}
            .value=${working.trafficPerLane}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.patch({ trafficPerLane: Number(e.detail) })}
          ></ix-number-input>
        </div>
        <div class="row shadow-row">
          <ix-toggle
            ?checked=${working.shadowMode === true}
            ?disabled=${!this.canEdit}
            @checkedChange=${(e: CustomEvent<boolean>) => this.patch({ shadowMode: e.detail })}
          ></ix-toggle>
          <span>${localizeDir(MSG.editor.shadowMode)}</span>
          <span class="shadow-hint">${localizeDir(MSG.editor.shadowModeHint)}</span>
        </div>
      </div>
    `;
  }

  private renderTube(working: Tunnel, tube: TubeDef): TemplateResult {
    const equipment = tubeEquipment(working, tube.id);
    return html`
      <div class="card">
        <div class="tube-head">
          <ix-input
            label=${localize(MSG.editor.tubeName)}
            .value=${tube.name}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.patchTube(tube.id, { name: e.detail })}
          ></ix-input>
          <ix-select
            label=${localize(MSG.editor.direction)}
            .value=${tube.direction}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) =>
              this.patchTube(tube.id, { direction: String(e.detail) as TubeDirection })}
          >
            ${DIRECTIONS.map((d) => html`<ix-select-item label=${dirLabel(d)} value=${d}></ix-select-item>`)}
          </ix-select>
          <ix-number-input
            label=${localize(MSG.editor.lanes)}
            .value=${tube.lanes}
            ?disabled=${!this.canEdit}
            @valueChange=${(e: IxValueEvent) => this.patchTube(tube.id, { lanes: Math.max(1, Number(e.detail)) })}
          ></ix-number-input>
          <div class="tube-length">${Math.round(tubeLengthM(tube))} m</div>
          <ix-icon-button
            icon="trashcan"
            variant="secondary"
            ghost
            ?disabled=${!this.canEdit || working.tubes.length <= 1}
            title=${localize(MSG.editor.removeTube)}
            @click=${() => this.removeTube(tube.id)}
          ></ix-icon-button>
        </div>
        <table class="segments">
          <thead>
            <tr>
              <th>${localizeDir(MSG.editor.colSegment)}</th>
              <th>${localizeDir(MSG.editor.colLength)}</th>
              <th>${localizeDir(MSG.editor.colGradient)}</th>
              <th>${localizeDir(MSG.editor.colRadius)}</th>
              <th>${localizeDir(MSG.editor.colClearance)}</th>
              <th>${localizeDir(MSG.editor.colZone)}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${tube.segments.map((segment) => this.renderSegment(tube, segment))}
          </tbody>
        </table>
        <div class="row">
          <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.addSegment(tube.id)}>
            <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addSegment)}
          </ix-button>
        </div>
        <div class="equipment-head">
          <ix-typography format="h4">
            ${localizeDir(MSG.editor.equipmentTitle)} (${equipment.length})
          </ix-typography>
          <div class="equipment-actions">
            <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.openSeries(tube)}>
              <ix-icon name="add-circle" slot="icon"></ix-icon>${localizeDir(MSG.editor.placeSeries)}
            </ix-button>
            <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.addEquipment(tube.id)}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.editor.addEquipment)}
            </ix-button>
          </div>
        </div>
        <div class="equipment-list">
          ${equipment.map(
            (e) => html`
              <button class="equipment-item" @click=${() => this.openEquipment(e)}>
                <span class="pk">${pkLabel(e.pkM)}</span>
                <span class="name">${e.name}</span>
                <span class="kind">${kindLabel(e.kind)}</span>
              </button>
            `
          )}
        </div>
      </div>
    `;
  }

  private renderSegment(tube: TubeDef, segment: SegmentDef): TemplateResult {
    const disabled = !this.canEdit;
    return html`
      <tr>
        <td>
          <ix-input
            .value=${segment.name}
            ?disabled=${disabled}
            @valueChange=${(e: IxValueEvent) => this.patchSegment(tube.id, segment.id, { name: e.detail })}
          ></ix-input>
        </td>
        <td>
          <ix-number-input
            .value=${segment.lengthM}
            ?disabled=${disabled}
            @valueChange=${(e: IxValueEvent) =>
              this.patchSegment(tube.id, segment.id, { lengthM: Math.max(1, Number(e.detail)) })}
          ></ix-number-input>
        </td>
        <td>
          <ix-number-input
            .value=${segment.gradientPct}
            ?disabled=${disabled}
            @valueChange=${(e: IxValueEvent) =>
              this.patchSegment(tube.id, segment.id, { gradientPct: Number(e.detail) })}
          ></ix-number-input>
        </td>
        <td>
          <ix-number-input
            .value=${segment.curveRadiusM}
            ?disabled=${disabled}
            @valueChange=${(e: IxValueEvent) =>
              this.patchSegment(tube.id, segment.id, { curveRadiusM: Number(e.detail) })}
          ></ix-number-input>
        </td>
        <td>
          <ix-number-input
            .value=${segment.clearanceM}
            ?disabled=${disabled}
            @valueChange=${(e: IxValueEvent) =>
              this.patchSegment(tube.id, segment.id, { clearanceM: Math.max(2, Number(e.detail)) })}
          ></ix-number-input>
        </td>
        <td>
          <ix-select
            .value=${segment.lightingZone}
            ?disabled=${disabled}
            @valueChange=${(e: IxValueEvent) =>
              this.patchSegment(tube.id, segment.id, { lightingZone: String(e.detail) as LightingZone })}
          >
            ${ZONES.map((z) => html`<ix-select-item label=${zoneLabel(z)} value=${z}></ix-select-item>`)}
          </ix-select>
        </td>
        <td>
          <ix-icon-button
            icon="trashcan"
            variant="secondary"
            ghost
            ?disabled=${disabled || tube.segments.length <= 1}
            @click=${() => this.removeSegment(tube.id, segment.id)}
          ></ix-icon-button>
        </td>
      </tr>
    `;
  }

  private renderSeriesDialog(working: Tunnel): TemplateResult | typeof nothing {
    const tube = working.tubes.find((t) => t.id === this.seriesTubeId);
    if (!tube) return nothing;
    const draft = this.seriesDraft;
    return html`
      <div class="overlay" @click=${() => (this.seriesTubeId = '')}>
        <div class="panel series" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(MSG.editor.seriesTitle)} — ${tube.name}</ix-typography>
          </div>
          <div class="panel-body">
            <div class="grid2">
              <ix-select
                label=${localize(MSG.equipment.kind)}
                .value=${draft.kind}
                @valueChange=${(e: IxValueEvent) => this.patchSeries({ kind: String(e.detail) as EquipmentKind })}
              >
                ${CATALOG_KINDS.map(
                  (k) => html`<ix-select-item label=${kindLabel(k)} value=${k}></ix-select-item>`
                )}
              </ix-select>
              <ix-select
                label=${localize(MSG.equipment.side)}
                .value=${draft.side}
                @valueChange=${(e: IxValueEvent) => this.patchSeries({ side: String(e.detail) as EquipmentSide })}
              >
                ${SIDES.map((s) => html`<ix-select-item label=${sideLabel(s)} value=${s}></ix-select-item>`)}
              </ix-select>
            </div>
            <div class="grid3">
              <ix-number-input
                label=${localize(MSG.editor.seriesStart)}
                .value=${draft.startM}
                @valueChange=${(e: IxValueEvent) => this.patchSeries({ startM: Math.max(0, Number(e.detail)) })}
              ></ix-number-input>
              <ix-number-input
                label=${localize(MSG.editor.seriesEnd)}
                .value=${draft.endM}
                @valueChange=${(e: IxValueEvent) => this.patchSeries({ endM: Math.max(0, Number(e.detail)) })}
              ></ix-number-input>
              <ix-number-input
                label=${localize(MSG.editor.seriesEvery)}
                .value=${draft.everyM}
                @valueChange=${(e: IxValueEvent) => this.patchSeries({ everyM: Math.max(1, Number(e.detail)) })}
              ></ix-number-input>
            </div>
            <ix-input
              label=${localize(MSG.editor.seriesPrefix)}
              .value=${draft.prefix ?? ''}
              @valueChange=${(e: IxValueEvent) => this.patchSeries({ prefix: e.detail || undefined })}
            ></ix-input>
            <div class="series-count">
              ${seriesCount(draft)} ${localizeDir(MSG.editor.seriesCount)}
            </div>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${() => (this.seriesTubeId = '')}>
              ${localizeDir(MSG.overview.cancel)}
            </ix-button>
            <ix-button ?disabled=${seriesCount(draft) === 0} @click=${() => this.applySeries()}>
              ${localizeDir(MSG.editor.seriesAdd)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  // --- mutations ---------------------------------------------------------------

  private openSeries(tube: TubeDef): void {
    this.seriesDraft = freshSeriesDraft(Math.round(tubeLengthM(tube)));
    this.seriesTubeId = tube.id;
  }

  private patchSeries(part: Partial<Omit<SeriesOptions, 'tubeId'>>): void {
    this.seriesDraft = { ...this.seriesDraft, ...part };
  }

  private applySeries(): void {
    if (!this.working || this.seriesTubeId === '') return;
    const result = placeSeries(this.working, { ...this.seriesDraft, tubeId: this.seriesTubeId });
    this.seriesTubeId = '';
    if (result.added > 0) this.touch(result.tunnel);
  }

  /** Generate the equipment satisfying one advisor deviation (unsaved edit). */
  private onFix(issue: ComplianceIssue): void {
    if (!this.working) return;
    const result = fixIssue(this.working, issue);
    if (result.added > 0) this.touch(result.tunnel);
  }

  private touch(next: Tunnel): void {
    this.working = next;
    this.dirty = true;
  }

  private patch(part: Partial<Tunnel>): void {
    if (this.working) this.touch({ ...this.working, ...part });
  }

  private patchTube(tubeId: string, part: Partial<TubeDef>): void {
    if (!this.working) return;
    this.touch({
      ...this.working,
      tubes: this.working.tubes.map((t) => (t.id === tubeId ? { ...t, ...part } : t))
    });
  }

  private patchSegment(tubeId: string, segmentId: string, part: Partial<SegmentDef>): void {
    if (!this.working) return;
    this.touch({
      ...this.working,
      tubes: this.working.tubes.map((t) =>
        t.id === tubeId
          ? { ...t, segments: t.segments.map((s) => (s.id === segmentId ? { ...s, ...part } : s)) }
          : t
      )
    });
  }

  private addTube(): void {
    if (!this.working) return;
    const id = `tube-${Date.now().toString(36)}`;
    const tube: TubeDef = {
      id,
      name: localize(MSG.editor.newTubeName),
      direction: 'unidirectional',
      lanes: 2,
      segments: [this.freshSegment()]
    };
    this.touch({ ...this.working, tubes: [...this.working.tubes, tube] });
  }

  private removeTube(tubeId: string): void {
    if (!this.working) return;
    this.touch({
      ...this.working,
      tubes: this.working.tubes.filter((t) => t.id !== tubeId),
      equipment: this.working.equipment.filter((e) => e.tubeId !== tubeId)
    });
  }

  private freshSegment(): SegmentDef {
    return {
      id: `seg-${Date.now().toString(36)}`,
      name: localize(MSG.editor.newSegmentName),
      lengthM: 300,
      gradientPct: 0,
      curveRadiusM: 0,
      clearanceM: 4.5,
      lightingZone: 'interior'
    };
  }

  private addSegment(tubeId: string): void {
    if (!this.working) return;
    this.touch({
      ...this.working,
      tubes: this.working.tubes.map((t) =>
        t.id === tubeId ? { ...t, segments: [...t.segments, this.freshSegment()] } : t
      )
    });
  }

  private removeSegment(tubeId: string, segmentId: string): void {
    if (!this.working) return;
    this.touch({
      ...this.working,
      tubes: this.working.tubes.map((t) =>
        t.id === tubeId ? { ...t, segments: t.segments.filter((s) => s.id !== segmentId) } : t
      )
    });
  }

  private addEquipment(tubeId: string): void {
    if (!this.working) return;
    const id = `equip-${Date.now().toString(36)}`;
    const equipment: EquipmentDef = {
      id,
      name: localize(MSG.editor.newEquipmentName),
      kind: 'sos-niche',
      tubeId,
      pkM: 0,
      side: 'right',
      bindings: {}
    };
    this.touch({ ...this.working, equipment: [...this.working.equipment, equipment] });
    this.openEquipment(equipment);
  }

  private openEquipment(equipment: EquipmentDef): void {
    // Hand the pending edits along so the dialog operates on the same copy.
    this.dispatchEvent(
      new CustomEvent<{ equipment: EquipmentDef; tunnel: Tunnel | null }>('wui:equipment', {
        detail: { equipment, tunnel: this.dirty ? this.working : null }
      })
    );
  }

  private save(): void {
    if (!this.working) return;
    this.dispatchEvent(new CustomEvent<Tunnel>('wui:save', { detail: this.working }));
    this.dirty = false;
  }
}

/** Fresh series draft for a tube of the given length. */
function freshSeriesDraft(tubeLength: number): Omit<SeriesOptions, 'tubeId'> {
  return {
    kind: 'sos-niche',
    side: 'right',
    startM: DEFAULT_SERIES_EVERY_M,
    endM: Math.max(0, tubeLength - DEFAULT_SERIES_EVERY_M / 2),
    everyM: DEFAULT_SERIES_EVERY_M
  };
}

/** How many units the current draft would generate. */
function seriesCount(draft: Omit<SeriesOptions, 'tubeId'>): number {
  if (draft.everyM <= 0 || draft.endM < draft.startM) return 0;
  return Math.floor((draft.endM - draft.startM) / draft.everyM) + 1;
}

function editorStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 22rem;
      gap: 1rem;
      padding: 1rem;
      align-items: start;
    }
    .card {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.9rem;
      margin-bottom: 1rem;
    }
    .grid3 {
      display: grid;
      grid-template-columns: 2fr 2fr 1fr;
      gap: 0.75rem;
    }
    .shadow-row {
      margin-top: 0.7rem;
    }
    .shadow-hint {
      color: var(--theme-color-weak-text);
      font-size: 0.78rem;
    }
    .tube-head {
      display: grid;
      grid-template-columns: 2fr 1.4fr 6rem auto auto;
      gap: 0.75rem;
      align-items: end;
      margin-bottom: 0.6rem;
    }
    .equipment-actions {
      display: flex;
      gap: 0.5rem;
    }
    .panel.series {
      width: 520px;
    }
    .panel.series .panel-body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .series-count {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .issue-body .fix {
      margin-top: 0.35rem;
    }
    .tube-length {
      color: var(--theme-color-soft-text);
      padding-bottom: 0.45rem;
      font-variant-numeric: tabular-nums;
    }
    table.segments {
      width: 100%;
      border-collapse: collapse;
    }
    table.segments th {
      text-align: left;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--theme-color-soft-text);
      padding: 0.25rem 0.3rem;
    }
    table.segments td {
      padding: 0.15rem 0.3rem;
    }
    .row,
    .actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      margin-top: 0.6rem;
    }
    .actions .spacer,
    .equipment-head + .spacer {
      flex: 1;
    }
    .equipment-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 1rem;
    }
    .equipment-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 0.5rem;
      max-height: 16rem;
      overflow: auto;
    }
    .equipment-item {
      display: grid;
      grid-template-columns: 6.5rem 1fr auto;
      gap: 0.6rem;
      align-items: center;
      padding: 0.35rem 0.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: transparent;
      color: var(--theme-color-std-text);
      cursor: pointer;
      text-align: left;
      font: inherit;
    }
    .equipment-item:hover,
    .equipment-item:focus-visible {
      border-color: var(--theme-color-primary);
      outline: none;
    }
    .equipment-item .pk {
      font-variant-numeric: tabular-nums;
      color: var(--theme-color-soft-text);
    }
    .equipment-item .kind {
      color: var(--theme-color-soft-text);
      font-size: 0.8rem;
    }
    aside.advisor {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.9rem;
      position: sticky;
      top: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      max-height: calc(100vh - 12rem);
      overflow: auto;
    }
    .advisor-sub {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .issue {
      display: flex;
      gap: 0.5rem;
      padding: 0.5rem;
      border-radius: var(--theme-default-border-radius);
      border-left: 3px solid var(--theme-color-neutral);
      background: var(--theme-color-2);
      font-size: 0.85rem;
    }
    .issue.error {
      border-left-color: var(--theme-color-alarm);
    }
    .issue.warning {
      border-left-color: var(--theme-color-warning);
    }
    .issue.info {
      border-left-color: var(--theme-color-info);
    }
    .issue .ref {
      color: var(--theme-color-weak-text);
      font-size: 0.72rem;
    }
    .ok-note {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      color: var(--theme-color-success);
    }
    .disclaimer {
      color: var(--theme-color-weak-text);
      font-size: 0.72rem;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-editor': HdEditor;
  }
}
