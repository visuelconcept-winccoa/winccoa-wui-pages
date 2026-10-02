// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `wui-alarms-widget` — the Alarms module as a WinCC OA **dashboard widget**.
 *
 * The "Suivi Alarmes" band of the Machine Fleet machine dashboard, lifted into a
 * widget of the built-in dashboard editor: the shared `<wui-alarm-view>` of
 * `@visuelconcept/wui-alarms-core` in its panel form, scoped to a machine's
 * datapoints and driven by the dashboard time range — exactly the three lines the
 * fleet dashboard uses (`layout="panel" hide-period strict-scope .from .to .scope`).
 *
 * Inputs (set by the dashboard's widget wrapper — the widget never fetches):
 *   atelier         `{ value, datapoint }` — the atelier configuration read live off
 *                   `MachineFleet3D_<atelier>.json` (the settings picker is restricted
 *                   to that datapoint type, so the editor picks an atelier, not a name)
 *   machineId       the machine preselected in the widget's machine list; empty =
 *                   the whole atelier (every machine's datapoints). The operator can
 *                   switch machine in the widget unless `lockMachine`.
 *   dpFilter        extra scope entries picked with the datapoint selector
 *                   (`[{ dp }]`, a plain name covers the datapoint and its elements)
 *   strictScope     an empty scope shows NOTHING instead of the whole plant
 *   sTimeRange      the dashboard time range (spread from the widget `variables`)
 *   showRangePicker range button in the widget + the host drives `from`/`to`;
 *                   off → the view shows its own period controls
 *   source          `active` | `history` (the operator flips the tabs unless `lockSource`)
 *   layout          `panel` | `page`,  hideStats, noAck, pageSize
 *
 * The scope of a machine is `scopeFromDpes` over its bound datapoint ELEMENTS
 * (state, communication, stop cause, work order, operation, parameters), so an alarm
 * on any element of those datapoints is the machine's alarm — the fleet dashboard's
 * reading.
 *
 * Application Security is the alarms module's own: `view` gates the body,
 * `acknowledge` folds into `no-ack`. The impersonated acknowledgement route stays
 * role-gated server-side whatever a widget shows.
 *
 * This file is BUILT by the pages build (`libs/wui-<page>/src/widgets/<widget>.ts` →
 * `/data/dashboard-wc/widgets/wui-alarms.js`), because the alarms kit is not part
 * of the dashboard import map. Its definition lives in
 * `oa-data/WebUI/widgets-v2/Alarms/wui-alarms/wui-alarms.widget.json`.
 */
import {
  hasRole$,
  registerModuleRoles,
  type AppModuleRoles
} from '@visuelconcept/wui-kit/data/app-security.js';
import {
  MSG,
  localize,
  localizeDir
} from '@visuelconcept/wui-alarms-core/i18n.js';
import type { AlarmSource } from '@visuelconcept/wui-alarms-core/query.js';
import {
  parseScopeAttribute,
  scopeFromDpes
} from '@visuelconcept/wui-alarms-core/scope.js';
import type { AlarmViewLayout } from '@visuelconcept/wui-alarms-core/ui/wui-alarm-view.js';
import '@visuelconcept/wui-alarms-core/ui/wui-alarm-view.js';
import '@wincc-oa/wui-ui-elements/wui-datetime-range-button/wui-datetime-range-button.js';
import { parseTimeRange } from '@wincc-oa/wui-shared/parseTimeRange.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import appSecurityRoles from '../app-security.roles.json';

/** Application-Security module id — the alarms page's, this is the same module. */
const MODULE_ID = 'alarms';
const DEFAULT_PAGE_SIZE = 25;
/** Re-render cadence while the range ends at "now", so `to` follows the clock. */
const LIVE_TICK_MS = 60_000;

/** Value of the machine list entry meaning "every machine of the atelier". */
const WHOLE_ATELIER = '';

const ml = (en: string, fr: string, de: string): MultiLangString => ({
  'en_US.utf8': en,
  'fr_FR.utf8': fr,
  'de_AT.utf8': de
});
const WIDGET_MSG = {
  machine: ml('Machine', 'Machine', 'Maschine'),
  wholeAtelier: ml('Whole atelier', 'Atelier entier', 'Gesamtes Atelier'),
  noAtelier: ml(
    'Bind an atelier configuration or a datapoint filter in the widget settings.',
    'Liez une configuration d’atelier ou un filtre de datapoints dans les paramètres du widget.',
    'Binden Sie eine Atelier-Konfiguration oder einen Datenpunktfilter in den Widget-Einstellungen.'
  )
};

/**
 * The slice of a fleet `MachineDef` this widget reads — the bound datapoint
 * elements the fleet dashboard scopes its alarm panel on. Structural on purpose:
 * the alarms module takes no dependency on the fleet kit for six field names.
 */
interface MachineBindings {
  id?: unknown;
  name?: unknown;
  stateDp?: unknown;
  commDp?: unknown;
  stopCauseDp?: unknown;
  workOrderDp?: unknown;
  operationDp?: unknown;
  kpis?: { dp?: unknown }[];
}

/** A machine of the bound atelier, as listed in the widget. */
interface MachineEntry {
  id: string;
  name: string;
  dpes: string[];
}

/** What the `data-point` context hands over for the atelier binding. */
interface AtelierBinding {
  value?: unknown;
  datapoint?: unknown;
}

/** One entry of the `dpFilter` series (a group with the picked datapoint). */
type DpFilterEntry = string | { dp?: unknown; datapoint?: unknown };

export class WuiAlarmsWidget extends LitElement {
  static override readonly styles = [IXCoreStyles, widgetStyles()];

  /** Atelier configuration binding (`MachineFleet3D_<atelier>.json`, live). */
  @property({ attribute: false }) atelier: AtelierBinding | undefined;
  /** Preselected machine id; empty = the whole atelier. */
  @property() machineId = '';
  /** Hide the machine list — the configured machine is final. */
  @property({ type: Boolean }) lockMachine = false;
  /** Extra scope entries picked with the datapoint selector. */
  @property({ attribute: false }) dpFilter: DpFilterEntry[] | undefined;
  /** Dashboard time range (`now/d`, `24h`, `1w/w-1w/w`…), spread from `variables`. */
  @property() sTimeRange = '';
  @property() source: AlarmSource = 'active';
  @property() layout: AlarmViewLayout = 'panel';
  @property({ type: Boolean }) lockSource = false;
  @property({ type: Boolean }) hideStats = false;
  @property({ type: Boolean }) noAck = false;
  @property({ type: Boolean }) strictScope = false;
  @property({ type: Boolean }) showRangePicker = false;
  @property({ type: Number }) pageSize = DEFAULT_PAGE_SIZE;

  /** Application-Security grants (open until assigned). */
  @state() private roleView = true;
  @state() private roleAck = true;
  /** The operator's machine choice for this session (undefined = the setting). */
  @state() private viewMachine: string | undefined;
  /**
   * The tab the VIEW currently shows (the operator flips it inside the view). The
   * dashboard period concerns the archive only: the active tab is the standing
   * alarms, all of them, whatever the range says — so `from`/`to` and the range
   * button are tied to this being `history`.
   */
  @state() private viewSource: AlarmSource = 'active';

  private roleSub = new Subscription();
  private liveTimer = 0;
  /** Follows the view's reflected `source` attribute (no event is emitted on a tab switch). */
  private sourceObserver: MutationObserver | null = null;
  private observedView: Element | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    // Same module as the page: declaring is idempotent, and a project that ships
    // the widget without the page still gets the roles listed in /app-security.
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.sourceObserver = new MutationObserver(() => this.syncViewSource());
    this.roleSub = hasRole$(MODULE_ID, 'view').subscribe(
      (granted) => (this.roleView = granted)
    );
    this.roleSub.add(
      hasRole$(MODULE_ID, 'acknowledge').subscribe(
        (granted) => (this.roleAck = granted)
      )
    );
    this.liveTimer = window.setInterval(() => {
      // Only the archive follows the clock; ticking on the active tab would
      // merely restart the live subscription for nothing.
      if (
        document.visibilityState !== 'hidden' &&
        this.viewSource === 'history' &&
        this.range().live
      ) {
        this.requestUpdate();
      }
    }, LIVE_TICK_MS);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.roleSub.unsubscribe();
    window.clearInterval(this.liveTimer);
    this.sourceObserver?.disconnect();
    this.observedView = null;
  }

  /** (Re)attach the tab observer whenever the rendered view element changes. */
  override updated(): void {
    const view = this.renderRoot.querySelector('wui-alarm-view');
    if (view === this.observedView) return;
    this.sourceObserver?.disconnect();
    this.observedView = view;
    if (view) {
      this.sourceObserver?.observe(view, {
        attributes: true,
        attributeFilter: ['source']
      });
      this.syncViewSource();
    }
  }

  override render(): TemplateResult {
    if (!this.roleView)
      return html`<div class="center">${localizeDir(MSG.view.forbidden)}</div>`;
    const machines = this.machines();
    const filter = this.filterEntries();
    if (machines.length === 0 && filter.length === 0 && this.strictScope) {
      return html`${this.renderHead(machines)}
        <div class="center">${localizeDir(WIDGET_MSG.noAtelier)}</div>`;
    }
    // The archive alone takes the dashboard period; the active tab is never bounded.
    const { from, to } =
      this.viewSource === 'history' ? this.range() : { from: 0, to: 0 };
    return html`
      ${this.renderHead(machines)}
      <wui-alarm-view
        layout=${this.layout}
        source=${this.source}
        ?lock-source=${this.lockSource}
        ?hide-stats=${this.hideStats}
        ?hide-period=${this.showRangePicker}
        ?strict-scope=${this.strictScope}
        ?no-ack=${this.noAck || !this.roleAck}
        page-size=${this.pageSize > 0 ? this.pageSize : DEFAULT_PAGE_SIZE}
        .from=${from}
        .to=${to}
        .scope=${this.scope(machines, filter)}
      ></wui-alarm-view>
    `;
  }

  private syncViewSource(): void {
    const value = this.observedView?.getAttribute('source');
    this.viewSource = value === 'history' ? 'history' : 'active';
  }

  /**
   * Machine list (unless locked) and range button — the latter only while the
   * view shows the archive, since the period does not apply to the active tab.
   */
  private renderHead(
    machines: MachineEntry[]
  ): TemplateResult | typeof nothing {
    const showMachines = machines.length > 0 && !this.lockMachine;
    const showRange = this.showRangePicker && this.viewSource === 'history';
    if (!showMachines && !showRange) return nothing;
    return html`
      <div class="head">
        ${showMachines ? this.renderMachineSelect(machines) : nothing}
        <span class="grow"></span>
        ${showRange ? this.renderRangeButton() : nothing}
      </div>
    `;
  }

  private renderRangeButton(): TemplateResult {
    return html`
      <wui-datetime-range-button
        .value=${this.sTimeRange}
        @wui:rangeselected=${this.onRangeSelected}
      ></wui-datetime-range-button>
    `;
  }

  private renderMachineSelect(machines: MachineEntry[]): TemplateResult {
    return html`
      <ix-select
        class="machine"
        .value=${this.currentMachineId(machines)}
        @valueChange=${this.onMachineChange}
        aria-label=${localize(WIDGET_MSG.machine)}
      >
        <ix-select-item
          value=${WHOLE_ATELIER}
          label=${localize(WIDGET_MSG.wholeAtelier)}
        ></ix-select-item>
        ${machines.map((m) => html`<ix-select-item value=${m.id} label=${m.name}></ix-select-item>`)}
      </ix-select>
    `;
  }

  /**
   * The period the host drives when it owns the range button (`from`/`to` win
   * over the view's own period); zeros hand the period back to the view.
   */
  private range(): { from: number; to: number; live: boolean } {
    if (!this.showRangePicker || this.sTimeRange === '')
      return { from: 0, to: 0, live: false };
    try {
      const { start, end, live } = parseTimeRange(this.sTimeRange);
      return { from: start.getTime(), to: end.getTime(), live };
    } catch {
      return { from: 0, to: 0, live: false };
    }
  }

  /** The machines of the bound atelier, with the datapoint elements each one binds. */
  private machines(): MachineEntry[] {
    const list = parseAtelier(this.atelier?.value)?.machines;
    if (!Array.isArray(list)) return [];
    return (list as MachineBindings[])
      .filter(
        (m): m is MachineBindings & { id: string } =>
          Boolean(m) && typeof m.id === 'string'
      )
      .map((m) => machineEntry(m));
  }

  /** The machine shown: the session choice, else the setting; unknown ids → whole atelier. */
  private currentMachineId(machines: MachineEntry[]): string {
    const wanted = this.viewMachine ?? this.machineId;
    return machines.some((m) => m.id === wanted) ? wanted : WHOLE_ATELIER;
  }

  /** The datapoint filter entries, whichever shape the series group produced. */
  private filterEntries(): string[] {
    const out: string[] = [];
    for (const entry of this.dpFilter ?? []) {
      const name =
        typeof entry === 'string' ? entry : (entry?.dp ?? entry?.datapoint);
      if (typeof name === 'string') out.push(...parseScopeAttribute(name));
    }
    return out;
  }

  /**
   * The chosen machine's datapoints (or every machine's), plus the filter.
   * `null` (not `[]`) when nothing is scoped and strict mode is off, so the view
   * reads the whole system like the Alarms page does.
   */
  private scope(
    machines: MachineEntry[],
    filter: string[]
  ): readonly string[] | null {
    const current = this.currentMachineId(machines);
    const selected =
      current === WHOLE_ATELIER
        ? machines
        : machines.filter((m) => m.id === current);
    const entries = new Set<string>([
      ...scopeFromDpes(selected.flatMap((m) => m.dpes)),
      ...filter
    ]);
    if (entries.size > 0) return [...entries];
    return this.strictScope ? [] : null;
  }

  private readonly onMachineChange = (
    event: CustomEvent<string | string[]>
  ): void => {
    const value = Array.isArray(event.detail) ? event.detail[0] : event.detail;
    this.viewMachine = typeof value === 'string' ? value : WHOLE_ATELIER;
  };

  private readonly onRangeSelected = (
    event: CustomEvent<{ value?: string }>
  ): void => {
    const value = event.detail?.value;
    if (typeof value === 'string' && value !== '') this.sTimeRange = value;
  };
}

/** The atelier configuration as an object — a JSON string (the usual case), an object, or nothing. */
function parseAtelier(raw: unknown): { machines?: unknown } | undefined {
  if (raw && typeof raw === 'object') return raw as { machines?: unknown };
  if (typeof raw !== 'string' || raw.trim() === '') return undefined;
  try {
    return JSON.parse(raw) as { machines?: unknown };
  } catch {
    return undefined;
  }
}

/** A non-empty datapoint element name, else nothing. */
function asDpe(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A machine as the widget lists it: id, display name and bound datapoint elements. */
function machineEntry(m: MachineBindings & { id: string }): MachineEntry {
  const dpes = [
    asDpe(m.stateDp),
    asDpe(m.commDp),
    asDpe(m.stopCauseDp),
    asDpe(m.workOrderDp),
    asDpe(m.operationDp),
    ...(Array.isArray(m.kpis) ? m.kpis.map((k) => asDpe(k?.dp)) : [])
  ].filter((d): d is string => d !== undefined);
  return {
    id: m.id,
    name: typeof m.name === 'string' && m.name !== '' ? m.name : m.id,
    dpes
  };
}

function widgetStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      box-sizing: border-box;
      color: var(--theme-color-std-text);
      overflow: hidden;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.25rem 0;
    }
    .grow {
      flex: 1 1 auto;
    }
    ix-select.machine {
      min-width: 10rem;
      max-width: 18rem;
    }
    wui-alarm-view {
      flex: 1;
      min-height: 0;
    }
    .center {
      display: flex;
      flex: 1;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 1rem;
      color: var(--theme-color-soft-text);
    }
  `;
}

// Guarded: the dashboard may import the widget bundle next to a page bundle that
// shares the same custom-element registry.
if (!customElements.get('wui-alarms-widget'))
  customElements.define('wui-alarms-widget', WuiAlarmsWidget);
