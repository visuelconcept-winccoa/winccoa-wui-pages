// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Equipment dialog — identity (name / kind / tube / PK / side), the datapoint
 * bindings of every catalog point (autocomplete via the shared `wui-dp-input`),
 * the live values of bound measures, and the manual command buttons. Commands
 * are only EMITTED here (`wui:command`); the tunnel view confirms and runs
 * them through the audited {@link CommandRunner}. `wui:save` returns the
 * edited copy; the caller persists and re-binds.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import '@visuelconcept/wui-kit/ui/wui-dp-input.js';
import { ArchiveService, type ArchiveStatus } from '../data/archive.js';
import { aksChOf, kindLabel, pointsOf, CATALOG_KINDS } from '../data/catalog.js';
import { MSG, localize, localizeDir, sideLabel } from '../i18n.js';
import {
  pkLabel,
  stateColor,
  type EquipmentDef,
  type EquipmentKind,
  type EquipmentSide,
  type PointDef,
  type Tunnel
} from '../types.js';
import { dialogStyles } from './dialog-styles.js';

interface IxValueEvent {
  detail: string;
}

const SIDES: readonly EquipmentSide[] = ['left', 'right', 'ceiling', 'roadway'];

/** Detail of a manual command requested from the dialog. */
export interface CommandRequest {
  equipmentId: string;
  pointKey: string;
  value: number;
  label: string;
}

@customElement('hd-equipment-dialog')
export class HdEquipmentDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles(), extraStyles()];

  @property({ attribute: false }) tunnel: Tunnel | null = null;
  @property({ attribute: false }) equipment: EquipmentDef | null = null;
  @property({ type: Boolean }) canEdit = false;
  /** Bumped by the tunnel view on every live emission (re-renders the values). */
  @property({ type: Number }) liveTick = 0;

  @state() private working: EquipmentDef | null = null;
  @state() private archiveGroups: string[] = [];
  /** DPE → current NGA archive status (loaded when the dialog opens). */
  @state() private archiveStatus: Record<string, ArchiveStatus> = {};

  private readonly archive = new ArchiveService();

  protected override willUpdate(changed: PropertyValues): void {
    // Re-snapshot only when ANOTHER equipment opens: live telemetry mutates the
    // prop object in place and must not wipe the operator's pending edits.
    if (changed.has('equipment') && this.equipment?.id !== this.working?.id) {
      this.working = this.equipment ? structuredClone(this.equipment) : null;
      if (this.equipment) void this.loadArchive(this.equipment);
    }
    if (changed.has('equipment') && !this.equipment) this.working = null;
  }

  /** Load the archive groups (once) + the current status of every bound DPE. */
  private async loadArchive(equipment: EquipmentDef): Promise<void> {
    if (this.archiveGroups.length === 0) {
      this.archiveGroups = await this.archive.listArchiveGroups();
    }
    const status: Record<string, ArchiveStatus> = {};
    for (const dpe of Object.values(equipment.bindings)) {
      const clean = dpe.trim();
      if (clean) status[clean] = await this.archive.readArchiveStatus(clean);
    }
    this.archiveStatus = status;
  }

  override render(): TemplateResult | typeof nothing {
    const working = this.working;
    if (!working || !this.tunnel) return nothing;
    const points = pointsOf(working.kind);
    return html`
      <div class="overlay" @click=${() => this.close()}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${working.name} — ${kindLabel(working.kind)}
              <span class="pk-chip">${pkLabel(working.pkM)}</span>
              ${this.tunnel?.profile === 'ch-astra'
                ? html`<span class="pk-chip aks" title=${localize(MSG.equipment.aksHint)}>
                    AKS-CH · ${aksChOf(working.kind)}
                  </span>`
                : nothing}
            </ix-typography>
          </div>
          <div class="panel-body">
            ${this.renderIdentity(working)}
            ${this.renderLive(working, points)}
            ${this.renderCommands(working, points)}
            ${this.renderBindings(working, points)}
            ${this.renderArchiving(working)}
          </div>
          <div class="panel-foot">
            ${this.canEdit
              ? html`<ix-button variant="secondary" @click=${() => this.removeEquipment()}>
                    <ix-icon name="trashcan" slot="icon"></ix-icon>${localizeDir(MSG.equipment.delete)}
                  </ix-button>
                  <div class="spacer"></div>
                  <ix-button variant="secondary" @click=${() => this.close()}>
                    ${localizeDir(MSG.equipment.cancel)}
                  </ix-button>
                  <ix-button @click=${() => this.save()}>${localizeDir(MSG.equipment.save)}</ix-button>`
              : html`<div class="spacer"></div>
                  <ix-button variant="secondary" @click=${() => this.close()}>
                    ${localizeDir(MSG.equipment.close)}
                  </ix-button>`}
          </div>
        </div>
      </div>
    `;
  }

  private renderIdentity(working: EquipmentDef): TemplateResult {
    const tunnel = this.tunnel;
    return html`
      <div class="section-title">${localizeDir(MSG.equipment.identity)}</div>
      <div class="grid2">
        <ix-input
          label=${localize(MSG.equipment.name)}
          .value=${working.name}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.patch({ name: e.detail })}
        ></ix-input>
        <ix-select
          label=${localize(MSG.equipment.kind)}
          .value=${working.kind}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.onKind(String(e.detail) as EquipmentKind)}
        >
          ${CATALOG_KINDS.map((k) => html`<ix-select-item label=${kindLabel(k)} value=${k}></ix-select-item>`)}
        </ix-select>
      </div>
      <div class="grid3">
        <ix-select
          label=${localize(MSG.equipment.tube)}
          .value=${working.tubeId}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.patch({ tubeId: String(e.detail) })}
        >
          ${tunnel?.tubes.map((t) => html`<ix-select-item label=${t.name} value=${t.id}></ix-select-item>`)}
        </ix-select>
        <ix-number-input
          label=${localize(MSG.equipment.pk)}
          .value=${working.pkM}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.patch({ pkM: Number(e.detail) })}
        ></ix-number-input>
        <ix-select
          label=${localize(MSG.equipment.side)}
          .value=${working.side}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => this.patch({ side: String(e.detail) as EquipmentSide })}
        >
          ${SIDES.map((s) => html`<ix-select-item label=${sideLabel(s)} value=${s}></ix-select-item>`)}
        </ix-select>
      </div>
    `;
  }

  private renderLive(working: EquipmentDef, points: PointDef[]): TemplateResult | typeof nothing {
    const measures = points.filter((p) => p.role === 'measure');
    // Live values come from the PROP (mutated in place by the live binding),
    // not from the edit snapshot — `liveTick` triggers the re-render.
    const live = this.equipment ?? working;
    return html`
      <div class="section-title">${localizeDir(MSG.equipment.live)}</div>
      <div class="live-row">
        <span class="state-dot" style="background:${stateColor(live.state)}"></span>
        <span>${localize(MSG.equipment.state)}: ${live.state ?? '—'}</span>
        ${measures.map((p) => {
          const value = live.measures?.[p.key];
          return html`<span class="measure">
            ${p.label}: <b>${value === undefined ? '—' : formatValue(value)}</b> ${p.unit ?? ''}
          </span>`;
        })}
      </div>
    `;
  }

  private renderCommands(working: EquipmentDef, points: PointDef[]): TemplateResult | typeof nothing {
    const commands = points.filter((p) => p.role === 'command');
    if (commands.length === 0) return nothing;
    return html`
      <div class="section-title">${localizeDir(MSG.equipment.commands)}</div>
      ${commands.map(
        (p) => html`
          <div class="row cmd-row">
            <span class="cmd-label">${p.label}</span>
            ${(p.commandValues ?? []).map(
              (cv) => html`<ix-button
                variant="secondary"
                ?disabled=${!working.bindings[p.key]?.trim()}
                @click=${() => this.command(working, p, cv.value, cv.label)}
                >${cv.label}</ix-button
              >`
            )}
          </div>
        `
      )}
    `;
  }

  private renderBindings(working: EquipmentDef, points: PointDef[]): TemplateResult {
    return html`
      <div class="section-title">${localizeDir(MSG.equipment.bindings)}</div>
      ${points.map(
        (p) => html`
          <div class="binding-row">
            <span class="cmd-label">${p.label} <i class="role">(${p.role})</i></span>
            ${this.canEdit
              ? html`<wui-dp-input
                  .value=${working.bindings[p.key] ?? ''}
                  @wui:change=${(e: CustomEvent<string>) => this.bind(p.key, e.detail)}
                ></wui-dp-input>`
              : html`<code>${working.bindings[p.key] || '—'}</code>`}
          </div>
        `
      )}
    `;
  }

  /** NGA archiving of the bound DPEs (enables the future incident replay). */
  private renderArchiving(working: EquipmentDef): TemplateResult | typeof nothing {
    const bound = Object.values(working.bindings)
      .map((dpe) => dpe.trim())
      .filter((dpe) => dpe !== '');
    if (bound.length === 0) return nothing;
    return html`
      <div class="section-title">${localizeDir(MSG.equipment.archiving)}</div>
      ${this.archiveGroups.length === 0
        ? html`<div class="archive-note">${localizeDir(MSG.equipment.noArchiveGroup)}</div>`
        : bound.map((dpe) => this.renderArchiveRow(dpe))}
    `;
  }

  private renderArchiveRow(dpe: string): TemplateResult {
    const status = this.archiveStatus[dpe] ?? { enabled: false, group: '' };
    const group = status.group || this.archiveGroups[0] || '';
    return html`
      <div class="archive-row">
        <code title=${dpe}>${dpe}</code>
        <ix-select
          ?disabled=${!this.canEdit}
          .value=${group}
          @valueChange=${(e: IxValueEvent) => void this.onArchive(dpe, status.enabled, String(e.detail))}
        >
          ${this.archiveGroups.map((g) => html`<ix-select-item label=${g} value=${g}></ix-select-item>`)}
        </ix-select>
        <ix-toggle
          hide-text
          ?disabled=${!this.canEdit}
          ?checked=${status.enabled}
          @checkedChange=${(e: CustomEvent<boolean>) => void this.onArchive(dpe, e.detail, group)}
        ></ix-toggle>
      </div>
    `;
  }

  private async onArchive(dpe: string, enabled: boolean, group: string): Promise<void> {
    const ok = await this.archive.setArchive(dpe, enabled, group);
    if (ok) {
      this.archiveStatus = { ...this.archiveStatus, [dpe]: { enabled, group } };
      return;
    }
    // Failed write (rights / backend) — re-read so the toggle snaps back.
    this.archiveStatus = { ...this.archiveStatus, [dpe]: await this.archive.readArchiveStatus(dpe) };
  }

  private patch(part: Partial<EquipmentDef>): void {
    if (this.working) this.working = { ...this.working, ...part };
  }

  /** Changing the kind resets bindings to the new kind's points (stale keys dropped). */
  private onKind(kind: EquipmentKind): void {
    if (!this.working) return;
    const keys = new Set(pointsOf(kind).map((p) => p.key));
    const bindings: Record<string, string> = {};
    for (const [key, dpe] of Object.entries(this.working.bindings)) {
      if (keys.has(key)) bindings[key] = dpe;
    }
    this.working = { ...this.working, kind, bindings };
  }

  private bind(pointKey: string, dpe: string): void {
    if (!this.working) return;
    this.working = { ...this.working, bindings: { ...this.working.bindings, [pointKey]: dpe } };
  }

  private command(working: EquipmentDef, point: PointDef, value: number, valueLabel: string): void {
    const detail: CommandRequest = {
      equipmentId: working.id,
      pointKey: point.key,
      value,
      label: `${working.name} — ${point.label} → ${valueLabel}`
    };
    this.dispatchEvent(new CustomEvent<CommandRequest>('wui:command', { detail }));
  }

  private save(): void {
    if (!this.working) return;
    this.dispatchEvent(new CustomEvent<EquipmentDef>('wui:save', { detail: this.working }));
  }

  private removeEquipment(): void {
    if (!this.working) return;
    this.dispatchEvent(new CustomEvent<string>('wui:remove', { detail: this.working.id }));
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close'));
  }
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function extraStyles(): ReturnType<typeof css> {
  return css`
    .pk-chip {
      margin-left: 0.6rem;
      padding: 0.1rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .live-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.9rem;
    }
    .state-dot {
      width: 0.8rem;
      height: 0.8rem;
      border-radius: 50%;
      display: inline-block;
    }
    .measure {
      color: var(--theme-color-soft-text);
    }
    .cmd-row {
      margin-bottom: 0.4rem;
      flex-wrap: wrap;
    }
    .cmd-label {
      min-width: 11rem;
    }
    .role {
      color: var(--theme-color-weak-text);
      font-size: 0.75rem;
    }
    .binding-row {
      display: grid;
      grid-template-columns: 13rem 1fr;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.4rem;
    }
    .pk-chip.aks {
      color: var(--theme-color-info);
    }
    .archive-row {
      display: grid;
      grid-template-columns: 1fr 12rem auto;
      align-items: center;
      gap: 0.6rem;
      margin-bottom: 0.35rem;
    }
    .archive-row code {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .archive-note {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-equipment-dialog': HdEquipmentDialog;
  }
}
