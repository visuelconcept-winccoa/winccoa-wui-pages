// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Poseidon — standalone WinCC OA WebUI page for wastewater-treatment-plant
 * supervision (activated-sludge process).
 *
 * The shell owns the two live subscriptions (station sensors + equipment) via
 * `OaRxJsApi.dpConnect` and shares the snapshots down to five tabs:
 *  - **Synoptic**: process flow (water + sludge lines) with live equipment states.
 *  - **KPI**: removal efficiencies, discharge conformity and specific energy.
 *  - **Trends**: archived curves of the key signals (`dpGetPeriod`).
 *  - **Alarms**: threshold breaches + equipment faults, with acknowledgement.
 *  - **Equipment**: per-device control (start/stop/auto-manual), permission-gated
 *    (`canEditFleet`) with confirmation and GxP audit-trail tracing.
 *
 * Live values come from the `poseidon` simulator manager; equipment commands and
 * the server-side KPI/report summaries go through the `/api/poseidon` route.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { canEditFleet, canEditFleet$ } from '@visuelconcept/wui-kit/data/permissions.js';
import { MSG, localizeDir } from './poseidon/i18n.js';
import { connectEquipment, connectSensors, controlEquipment } from './poseidon/data/api.js';
import { ensureStores, traceControl } from './poseidon/data/stores.js';
import { deriveAlarms } from './poseidon/alarms.js';
import type { Alarm, ControlAction, EquipmentStates, SensorValues } from './poseidon/types.js';
import './poseidon/ui/poseidon-synoptic.js';
import './poseidon/ui/poseidon-kpi.js';
import './poseidon/ui/poseidon-trends.js';
import './poseidon/ui/poseidon-alarms.js';
import './poseidon/ui/poseidon-equipment.js';

type Tab = 'synoptic' | 'kpi' | 'trends' | 'alarms' | 'equipment';

export class WuiPoseidon extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private tab: Tab = 'synoptic';
  @state() private sensors: SensorValues = {};
  @state() private equipment: EquipmentStates = {};
  @state() private alarms: Alarm[] = [];
  @state() private lastUpdate = '';
  @state() private canEdit = canEditFleet();

  /** Acknowledgement + first-seen memory, keyed by alarm id (survives refreshes). */
  private ackedIds = new Set<string>();
  private firstSeen = new Map<string, string>();

  private subs = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    void ensureStores();
    this.subs = new Subscription();
    this.subs.add(canEditFleet$().subscribe((allowed) => (this.canEdit = allowed)));
    const sensorSub = connectSensors((values) => this.onSensors(values));
    const equipSub = connectEquipment((states) => this.onEquipment(states));
    if (sensorSub) this.subs.add(sensorSub);
    if (equipSub) this.subs.add(equipSub);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subs.unsubscribe();
  }

  private onSensors(values: SensorValues): void {
    this.sensors = values;
    this.lastUpdate = new Date().toLocaleTimeString();
    this.recomputeAlarms();
  }

  private onEquipment(states: EquipmentStates): void {
    this.equipment = states;
    this.recomputeAlarms();
  }

  private recomputeAlarms(): void {
    this.alarms = deriveAlarms(this.sensors, this.equipment, this.firstSeen, this.ackedIds);
  }

  private onAck(id: string): void {
    this.ackedIds.add(id);
    this.recomputeAlarms();
  }

  private async onControl(detail: { equipment: string; action: ControlAction }): Promise<void> {
    let ok = false;
    try {
      const res = await controlEquipment(detail.equipment, detail.action);
      ok = res.ok !== false;
    } catch {
      ok = false;
    }
    await traceControl(detail.equipment, detail.action, ok);
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Poseidon', fr: 'Poséidon', 'de_AT.utf8': 'Poseidon' }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <div class="body">
          <div class="tabs">
            ${this.tabBtn('synoptic', MSG.tabs.synoptic)}
            ${this.tabBtn('kpi', MSG.tabs.kpi)}
            ${this.tabBtn('trends', MSG.tabs.trends)}
            ${this.tabBtn('alarms', MSG.tabs.alarms, this.activeAlarmCount)}
            ${this.tabBtn('equipment', MSG.tabs.equipment)}
          </div>
          ${this.renderTab()}
        </div>
      </div>
    `;
  }

  private get activeAlarmCount(): number {
    return this.alarms.filter((a) => !a.acknowledged).length;
  }

  private renderTab(): TemplateResult {
    switch (this.tab) {
      case 'synoptic':
        return html`<poseidon-synoptic
          .sensors=${this.sensors}
          .equipment=${this.equipment}
          .lastUpdate=${this.lastUpdate}
        ></poseidon-synoptic>`;
      case 'kpi':
        return html`<poseidon-kpi .sensors=${this.sensors}></poseidon-kpi>`;
      case 'trends':
        return html`<poseidon-trends></poseidon-trends>`;
      case 'alarms':
        return html`<poseidon-alarms
          .alarms=${this.alarms}
          @wui:ack=${(e: CustomEvent<{ id: string }>) => this.onAck(e.detail.id)}
        ></poseidon-alarms>`;
      case 'equipment':
        return html`<poseidon-equipment
          .equipment=${this.equipment}
          .canEdit=${this.canEdit}
          @wui:control=${(e: CustomEvent<{ equipment: string; action: ControlAction }>) => void this.onControl(e.detail)}
        ></poseidon-equipment>`;
      default:
        return html`${nothing}`;
    }
  }

  private tabBtn(tab: Tab, label: typeof MSG.tabs.synoptic, badge = 0): TemplateResult {
    return html`<ix-button variant=${this.tab === tab ? 'primary' : 'secondary'} @click=${() => (this.tab = tab)}>
      ${localizeDir(label)}${badge > 0 ? html`<span class="badge">${badge}</span>` : nothing}
    </ix-button>`;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function pageStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
    }
    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      padding: 0 1rem 1rem;
      overflow: auto;
    }
    .tabs {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0.5rem 0;
    }
    .badge {
      margin-left: 0.4rem;
      padding: 0.02rem 0.4rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      background: var(--theme-color-alarm, #d1002e);
      color: #fff;
    }
  `;
}

if (!customElements.get('wui-poseidon')) {
  customElements.define('wui-poseidon', WuiPoseidon);
}
