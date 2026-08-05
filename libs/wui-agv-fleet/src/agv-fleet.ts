// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AGV Fleet — Standalone page (WinCC OA WebUI Runtime).
 *
 * Live supervision of an AGV fleet: one WinCC OA datapoint of type `AGV_Vehicle`
 * per vehicle, discovered at startup and followed through a single `dpConnect`
 * block (see {@link AgvStore}). The page is read-only — it never commands a
 * vehicle.
 *
 * Layout: a KPI strip over a split view — the sortable status list on the left,
 * the warehouse floor plan on the right, and the detail card of the selected
 * vehicle under the plan. Selecting a row highlights the marker and vice versa.
 *
 * When no `AGV_Vehicle` datapoint exists (or the backend is unreachable) the page
 * serves a simulated demo fleet and says so in a non-blocking notice, so it stays
 * demonstrable on a project that has not been provisioned yet.
 *
 * Built as a separate entry point (auto-discovered by build:pages) and loaded at
 * runtime via dynamic import.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { WuiUserService } from '@wincc-oa/wui-iam-data/user-service.js';
import { container } from 'tsyringe';
import { AgvStore, type StoreStatus } from './agv-fleet/data/agv-store.js';
import {
  MissionStore,
  type MissionAction
} from './agv-fleet/data/mission-store.js';
import { MSG, fleetCountMsg, localizeDir } from './agv-fleet/i18n.js';
import {
  needsAttention,
  type Agv,
  type MissionRow
} from './agv-fleet/types.js';
import './agv-fleet/ui/af-detail.js';
import './agv-fleet/ui/af-fleet-table.js';
import './agv-fleet/ui/af-kpi-bar.js';
import './agv-fleet/ui/af-map.js';
import './agv-fleet/ui/af-missions.js';

/** Tab order — the index `ix-tabs` reports and selects. */
const TAB_ORDER = ['fleet', 'missions'] as const;
type Tab = (typeof TAB_ORDER)[number];

/** Page header config — the shell renders the title from it. */
const HEADER_CONFIG = {
  headerTitle: {
    context: 'translate',
    config: {
      'en_US.utf8': 'AGV Fleet',
      'fr.utf8': 'Flotte AGV',
      'de_AT.utf8': 'AGV-Flotte'
    }
  }
} as const;

@customElement('wui-agv-fleet')
export class WuiAgvFleet extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  @state() private fleet: Agv[] = [];
  /** What the fleet on screen is (live / seeded / demo) and why, if degraded. */
  @state() private status: StoreStatus = { mode: 'loading', detail: '' };
  /** Id of the selected vehicle, empty when none. */
  @state() private selected = '';
  /** Restrict the list + plan to the vehicles that need attention. */
  @state() private attentionOnly = false;
  /** Active tab. */
  @state() private tab: Tab = 'fleet';
  /** Mission book published by the agvSim manager. */
  @state() private missionRows: MissionRow[] = [];
  /** False until a mission book arrives — the tab then explains why. */
  @state() private missionsAvailable = false;

  private readonly store = new AgvStore();
  private readonly missionStore = new MissionStore();
  private subs = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.subs = new Subscription();
    // The fleet subject starts empty and the status subject starts on 'loading',
    // so the spinner is driven by the status — never by the first empty fleet.
    this.subs.add(this.store.fleet.subscribe((fleet) => (this.fleet = fleet)));
    this.subs.add(
      this.store.status.subscribe((status) => (this.status = status))
    );
    this.subs.add(
      this.missionStore.rows.subscribe((rows) => (this.missionRows = rows))
    );
    this.subs.add(
      this.missionStore.available.subscribe(
        (ok) => (this.missionsAvailable = ok)
      )
    );
    void this.store.start();
    void this.missionStore.start();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.store.stop();
    this.missionStore.stop();
    this.subs.unsubscribe();
    this.subs = new Subscription();
  }

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator .config=${HEADER_CONFIG}>
          <wui-content-header></wui-content-header>
        </wui-context-generator>

        <ix-tabs
          .selected=${TAB_ORDER.indexOf(this.tab)}
          @selectedChange=${(event: CustomEvent<number>) => this.onTab(event.detail)}
        >
          <ix-tab-item>${localizeDir(MSG.tabs.fleet)}</ix-tab-item>
          <ix-tab-item
            >${localizeDir(MSG.tabs.missions)}${this.missionCountSuffix()}</ix-tab-item
          >
        </ix-tabs>

        <div class="body">
          ${this.renderStatusNotice()}
          ${
            this.status.mode === 'loading'
              ? html`<div class="center"><ix-spinner></ix-spinner></div>`
              : this.renderPanel()
          }
        </div>
      </div>
    `;
  }

  /** `ix-tabs` reports an INDEX; the tab name is what everything else reads. */
  private onTab(index: number): void {
    const tab = TAB_ORDER[index];
    if (tab !== undefined) this.tab = tab;
  }

  /** " (3)" — active order count on the Missions tab label. */
  private missionCountSuffix(): string {
    const active = this.missionRows.filter((row) => row.id !== '').length;
    return active > 0 ? ` (${active})` : '';
  }

  private renderPanel(): TemplateResult {
    if (this.tab === 'missions') {
      return html`<af-missions
        .rows=${this.missionRows}
        ?available=${this.missionsAvailable}
        ?canWrite=${this.canWrite()}
        @wui:action=${this.onMissionAction}
      ></af-missions>`;
    }
    return this.renderFleet();
  }

  /** Commanding the fleet writes a datapoint, so it needs write permission. */
  private canWrite(): boolean {
    try {
      return container.resolve<WuiUserService>(WuiUserService).canWrite;
    } catch {
      return false;
    }
  }

  private onMissionAction(
    event: CustomEvent<{ action: MissionAction; vehicle: string }>
  ): void {
    const { action, vehicle } = event.detail;
    void this.missionStore.send(action, vehicle);
  }

  /**
   * Say what the values on screen actually are whenever they are not live. The
   * store's `detail` is shown verbatim — it names the failing step, so a broken
   * page diagnoses itself instead of looking merely empty.
   */
  private renderStatusNotice(): TemplateResult | typeof nothing {
    const { mode, detail } = this.status;
    if (mode === 'demo') {
      return html`<div class="notice">
        <ix-icon name="info" size="16"></ix-icon>
        <span
          >${localizeDir(MSG.page.demo)}
          <span class="detail">${detail}</span></span
        >
      </div>`;
    }
    if (mode === 'seeded' || mode === 'partial') {
      const message = mode === 'seeded' ? MSG.page.stale : MSG.page.partial;
      return html`<div class="notice warn">
        <ix-icon name="warning" size="16"></ix-icon>
        <span
          >${localizeDir(message)} <span class="detail">${detail}</span></span
        >
      </div>`;
    }
    return nothing;
  }

  private renderFleet(): TemplateResult {
    if (this.fleet.length === 0) {
      return html`<div class="center empty">
        <ix-typography>${localizeDir(MSG.page.empty)}</ix-typography>
      </div>`;
    }
    const shown = this.visibleFleet();
    return html`
      <af-kpi-bar .fleet=${this.fleet}></af-kpi-bar>
      ${this.renderToolbar(shown.length)}
      <div class="split" @wui:select=${this.onSelect}>
        <af-fleet-table
          class="panel"
          .fleet=${shown}
          selected=${this.selected}
        ></af-fleet-table>
        <div class="right">
          <af-map
            class="panel"
            .fleet=${shown}
            selected=${this.selected}
          ></af-map>
          ${this.renderDetail()}
        </div>
      </div>
    `;
  }

  private renderToolbar(shownCount: number): TemplateResult {
    return html`
      <div class="toolbar">
        <span class="count"
          >${fleetCountMsg(shownCount, this.fleet.length)}</span
        >
        <span class="grow"></span>
        <ix-button
          variant=${this.attentionOnly ? 'primary' : 'secondary'}
          @click=${() => (this.attentionOnly = !this.attentionOnly)}
        >
          <ix-icon name="warning" slot="icon"></ix-icon
          >${localizeDir(MSG.page.filterAttention)}
        </ix-button>
        ${
          this.attentionOnly || this.selected
            ? html`<ix-button variant="secondary" @click=${this.clearFilters}>
                ${localizeDir(MSG.page.clearFilter)}
              </ix-button>`
            : nothing
        }
      </div>
    `;
  }

  private renderDetail(): TemplateResult | typeof nothing {
    const agv = this.fleet.find((v) => v.id === this.selected);
    if (!agv) return nothing;
    return html`<af-detail
      .agv=${agv}
      @wui:close=${() => (this.selected = '')}
    ></af-detail>`;
  }

  /** The vehicles the list and the plan currently show. */
  private visibleFleet(): Agv[] {
    return this.attentionOnly
      ? this.fleet.filter((agv) => needsAttention(agv))
      : this.fleet;
  }

  /** Row / marker click — select, or toggle the selection off. */
  private onSelect(event: CustomEvent<{ id: string }>): void {
    const { id } = event.detail;
    this.selected = this.selected === id ? '' : id;
  }

  private clearFilters(): void {
    this.attentionOnly = false;
    this.selected = '';
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
      gap: 0.5rem;
      padding: 0 1rem 1rem;
      overflow: hidden;
    }
    ix-tabs {
      flex-shrink: 0;
      padding: 0 1rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    af-missions {
      flex: 1;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    .toolbar .grow {
      flex: 1;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.9rem;
    }
    .split {
      display: grid;
      grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
      gap: 0.5rem;
      flex: 1;
      min-height: 0;
    }
    .right {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-height: 0;
      overflow: auto;
    }
    af-fleet-table.panel {
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      min-height: 0;
    }
    af-map.panel {
      flex: 1;
      min-height: 18rem;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--theme-color-information);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-information);
      background: color-mix(
        in srgb,
        var(--theme-color-information) 12%,
        transparent
      );
      font-size: 0.8125rem;
    }
    .notice.warn {
      border-color: var(--theme-color-warning);
      color: var(--theme-color-warning);
      background: color-mix(
        in srgb,
        var(--theme-color-warning) 12%,
        transparent
      );
    }
    .notice .detail {
      opacity: 0.75;
      font-family: var(--theme-font-family-mono, monospace);
    }
    .center {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
    }
    .empty {
      color: var(--theme-color-soft-text);
    }

    /* Single column on a narrow viewport — the plan drops under the list. */
    @media (max-width: 1100px) {
      .split {
        grid-template-columns: minmax(0, 1fr);
        overflow: auto;
      }
      af-fleet-table.panel {
        max-height: 22rem;
      }
    }
  `;
}
