// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Logbook tab ("main courante") — the tunnel's timestamped operations journal:
 * kind-filtered timeline (alarm transitions, commands, mode engagements,
 * notes, incident milestones, drills), a note composer, and the incident
 * lifecycle (open with title/severity, banner while active, close with a
 * note). Pure presentation: the tunnel view owns the LogbookStore and passes
 * the data down / receives the intents up.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir, incidentSeverityLabel } from '../i18n.js';
import type { Incident, LogEntry, LogEntryKind } from '../data/logbook.js';
import { pkLabel } from '../types.js';

interface IxValueEvent {
  detail: string;
}

type Filter = 'all' | LogEntryKind;
const FILTERS: readonly Filter[] = ['all', 'alarm', 'command', 'mode', 'note', 'incident', 'exercise'];
const KIND_ICON: Record<LogEntryKind, string> = {
  alarm: 'warning',
  command: 'play',
  mode: 'cogwheel',
  note: 'pen',
  incident: 'bell',
  exercise: 'analysis'
};
const SEVERITIES: readonly Incident['severity'][] = ['minor', 'major', 'critical'];

/** Detail of the `wui:open-incident` event. */
export interface OpenIncidentDetail {
  title: string;
  severity: Incident['severity'];
}

@customElement('hd-logbook')
export class HdLogbook extends LitElement {
  static override readonly styles = [IXCoreStyles, logbookStyles()];

  @property({ attribute: false }) entries: LogEntry[] = [];
  @property({ attribute: false }) activeIncident: Incident | null = null;
  @property({ type: Boolean }) canEdit = false;

  @state() private filter: Filter = 'all';
  @state() private noteDraft = '';
  @state() private incidentDraft = '';
  @state() private incidentSeverity: Incident['severity'] = 'major';
  @state() private opening = false;

  override render(): TemplateResult {
    const entries = this.filter === 'all' ? this.entries : this.entries.filter((e) => e.kind === this.filter);
    return html`
      ${this.renderIncidentBanner()}
      <div class="composer">
        <ix-input
          class="note-input"
          placeholder=${localize(MSG.logbook.notePlaceholder)}
          .value=${this.noteDraft}
          ?disabled=${!this.canEdit}
          @valueChange=${(e: IxValueEvent) => (this.noteDraft = e.detail)}
        ></ix-input>
        <ix-button ?disabled=${!this.canEdit || this.noteDraft.trim() === ''} @click=${() => this.sendNote()}>
          <ix-icon name="pen" slot="icon"></ix-icon>${localizeDir(MSG.logbook.addNote)}
        </ix-button>
        ${this.activeIncident === null
          ? html`<ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => (this.opening = true)}>
              <ix-icon name="bell" slot="icon"></ix-icon>${localizeDir(MSG.logbook.openIncident)}
            </ix-button>`
          : nothing}
      </div>
      ${this.opening ? this.renderOpenIncident() : nothing}
      <div class="filters">
        ${FILTERS.map(
          (f) => html`<button
            class="chip ${this.filter === f ? 'on' : ''}"
            @click=${() => (this.filter = f)}
          >
            ${localizeDir(MSG.logbook.filters[f])}
          </button>`
        )}
      </div>
      ${entries.length === 0
        ? html`<div class="empty">${localizeDir(MSG.logbook.empty)}</div>`
        : html`<ol class="timeline">
            ${entries.map((entry) => this.renderEntry(entry))}
          </ol>`}
    `;
  }

  private renderIncidentBanner(): TemplateResult | typeof nothing {
    const incident = this.activeIncident;
    if (!incident) return nothing;
    return html`
      <div class="incident ${incident.severity}">
        <ix-icon name="bell" size="24"></ix-icon>
        <div class="incident-body">
          <b>${incident.title}</b>
          <span>
            ${incidentSeverityLabel(incident.severity)} —
            ${localizeDir(MSG.logbook.openedAt)} ${new Date(incident.openedTs).toLocaleTimeString()}
            ${incident.pkM !== undefined ? html` — ${pkLabel(incident.pkM)}` : nothing}
          </span>
        </div>
        <ix-button variant="secondary" ?disabled=${!this.canEdit} @click=${() => this.closeIncident()}>
          <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.logbook.closeIncident)}
        </ix-button>
      </div>
    `;
  }

  private renderOpenIncident(): TemplateResult {
    return html`
      <div class="open-incident">
        <ix-input
          class="note-input"
          placeholder=${localize(MSG.logbook.incidentTitlePlaceholder)}
          .value=${this.incidentDraft}
          @valueChange=${(e: IxValueEvent) => (this.incidentDraft = e.detail)}
        ></ix-input>
        <ix-select
          .value=${this.incidentSeverity}
          @valueChange=${(e: IxValueEvent) => (this.incidentSeverity = String(e.detail) as Incident['severity'])}
        >
          ${SEVERITIES.map(
            (s) => html`<ix-select-item label=${incidentSeverityLabel(s)} value=${s}></ix-select-item>`
          )}
        </ix-select>
        <ix-button ?disabled=${this.incidentDraft.trim() === ''} @click=${() => this.openIncident()}>
          ${localizeDir(MSG.logbook.open)}
        </ix-button>
        <ix-button variant="secondary" @click=${() => (this.opening = false)}>
          ${localizeDir(MSG.logbook.cancel)}
        </ix-button>
      </div>
    `;
  }

  private renderEntry(entry: LogEntry): TemplateResult {
    return html`
      <li class="entry ${entry.kind} ${entry.exercise ? 'drill' : ''}">
        <span class="when">${new Date(entry.ts).toLocaleString()}</span>
        <ix-icon name=${KIND_ICON[entry.kind]} size="16"></ix-icon>
        <span class="text">
          ${entry.exercise ? html`<span class="drill-tag">${localizeDir(MSG.logbook.drillTag)}</span>` : nothing}
          ${entry.text}
          ${entry.pkM !== undefined ? html`<span class="pk">${pkLabel(entry.pkM)}</span>` : nothing}
        </span>
        <span class="who">${entry.user}</span>
      </li>
    `;
  }

  private sendNote(): void {
    const text = this.noteDraft.trim();
    if (text === '') return;
    this.noteDraft = '';
    this.dispatchEvent(new CustomEvent<string>('wui:note', { detail: text }));
  }

  private openIncident(): void {
    const title = this.incidentDraft.trim();
    if (title === '') return;
    this.opening = false;
    this.incidentDraft = '';
    this.dispatchEvent(
      new CustomEvent<OpenIncidentDetail>('wui:open-incident', {
        detail: { title, severity: this.incidentSeverity }
      })
    );
  }

  private closeIncident(): void {
    this.dispatchEvent(new CustomEvent('wui:close-incident'));
  }
}

function logbookStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      padding: 1rem;
    }
    .incident {
      display: flex;
      align-items: center;
      gap: 0.8rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-left: 4px solid var(--theme-color-warning);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.7rem 0.9rem;
      margin-bottom: 0.8rem;
    }
    .incident.critical {
      border-left-color: var(--theme-color-alarm);
    }
    .incident.minor {
      border-left-color: var(--theme-color-info);
    }
    .incident-body {
      display: flex;
      flex-direction: column;
      flex: 1;
    }
    .incident-body span {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .composer,
    .open-incident {
      display: flex;
      gap: 0.6rem;
      align-items: center;
      margin-bottom: 0.6rem;
    }
    .note-input {
      flex: 1;
    }
    .filters {
      display: flex;
      gap: 0.4rem;
      flex-wrap: wrap;
      margin-bottom: 0.8rem;
    }
    .chip {
      font: inherit;
      font-size: 0.8rem;
      padding: 0.2rem 0.7rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 1rem;
      background: transparent;
      color: var(--theme-color-soft-text);
      cursor: pointer;
    }
    .chip.on {
      border-color: var(--theme-color-primary);
      color: var(--theme-color-primary);
    }
    .chip:focus-visible {
      outline: 1px solid var(--theme-color-primary);
    }
    .empty {
      color: var(--theme-color-soft-text);
      padding: 1.5rem 0;
    }
    ol.timeline {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.3rem;
    }
    .entry {
      display: grid;
      grid-template-columns: 11rem 1.4rem 1fr auto;
      gap: 0.5rem;
      align-items: baseline;
      padding: 0.35rem 0.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      font-size: 0.88rem;
    }
    .entry.alarm {
      border-left: 3px solid var(--theme-color-alarm);
    }
    .entry.incident {
      border-left: 3px solid var(--theme-color-warning);
    }
    .entry.command,
    .entry.mode {
      border-left: 3px solid var(--theme-color-info);
    }
    .entry.drill {
      opacity: 0.85;
    }
    .when {
      color: var(--theme-color-soft-text);
      font-variant-numeric: tabular-nums;
      font-size: 0.8rem;
    }
    .who {
      color: var(--theme-color-weak-text);
      font-size: 0.8rem;
    }
    .pk {
      color: var(--theme-color-soft-text);
      margin-left: 0.4rem;
      font-variant-numeric: tabular-nums;
    }
    .drill-tag {
      border: 1px solid var(--theme-color-info);
      color: var(--theme-color-info);
      border-radius: var(--theme-default-border-radius);
      font-size: 0.7rem;
      padding: 0 0.3rem;
      margin-right: 0.3rem;
      text-transform: uppercase;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-logbook': HdLogbook;
  }
}
