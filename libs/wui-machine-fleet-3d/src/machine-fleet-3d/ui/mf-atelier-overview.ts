// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Overview grid of ateliers (workshops). One card per atelier showing its name
 * (two reserved lines for uniform card height), machine count, a per-state
 * breakdown and a lightweight 2D top-down minimap. Clicking a card opens its 3D
 * view. Rename / delete actions live inside the atelier view, not on the card.
 * A "new atelier" action and (when empty) an "import demo" action are offered.
 * The filter bar (machine tags) narrows the cards, counts and minimaps to the matching
 * machines; an atelier with none is hidden. The selection is remembered in the browser.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, svg, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import type { Subscription } from 'rxjs';
import type { FleetStore } from '../data/fleet-store.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import {
  filterDimensions,
  isFilterActive,
  loadFleetFilter,
  matchesFilter,
  pruneFilter,
  saveFleetFilter,
  type FleetFilter
} from '@visuelconcept-winccoa/wui-fleet-core/filters.js';
import '@visuelconcept-winccoa/wui-fleet-core/fleet-settings-service.js';
import { settingsCache } from '@visuelconcept-winccoa/wui-fleet-core/settings-cache.js';
import { UNKNOWN_STATE_COLOR, atelierStates, type Atelier, type MachineDef, type MachineState } from '../types.js';
import './mf-ai-prompt.js';
import './mf-atelier-create-dialog.js';
import './mf-filter-bar.js';
import './mf-graphics-catalog.js';
import './mf-module-settings-dialog.js';
import { parseModuleSettings, type FleetModuleSettings } from '@visuelconcept-winccoa/wui-fleet-core/opening-view.js';

/** Minimap rendered height (px) — must match the `.minimap { height }` CSS. */
const MINIMAP_HEIGHT_PX = 110;
/** Target machine-dot radius on screen (px) ≈ half a synthesis chip (1.4rem). */
const MINIMAP_DOT_RADIUS_PX = 5.5;

@customElement('mf-atelier-overview')
export class MfAtelierOverview extends LitElement {
  static override readonly styles = [IXCoreStyles, overviewStyles()];

  @property({ attribute: false }) ateliers: Atelier[] = [];
  @property({ attribute: false }) store: FleetStore | null = null;
  @property({ type: Boolean }) offline = false;
  /** Combined edit grant (canPublish && 'edit' role), provided by the page shell. */
  @property({ type: Boolean }) canEdit = true;
  /** Application-Security 'ai' grant — gates the AI-assistant affordance. */
  @property({ type: Boolean }) roleAi = true;
  /** The module settings (#70) and the grant to change them (canPublish && role 'configure'). */
  @property({ attribute: false }) moduleSettings: FleetModuleSettings = parseModuleSettings('');
  @property({ type: Boolean }) canConfigure = false;

  @state() private createOpen = false;
  @state() private createTemplate = '';
  @state() private createDefaultName = '';
  @state() private resourcesOpen = false;
  @state() private settingsOpen = false;
  @state() private settingsError = false;
  /** Remembered machine filter (the user's settings, shared with the atelier views). */
  @state() private filter: FleetFilter = loadFleetFilter();
  private settingsSub: Subscription | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.settingsSub = settingsCache.watch(['fleet-filter'], () => (this.filter = loadFleetFilter()));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.settingsSub?.unsubscribe();
    this.settingsSub = null;
  }

  override render(): TemplateResult {
    return html`
      <div class="head">
        <span class="spacer"></span>
        <ix-button variant="secondary" @click=${() => (this.resourcesOpen = true)}>
          <ix-icon name="box-open" slot="icon"></ix-icon>${localizeDir(MSG.overview.graphicsCatalog)}
        </ix-button>
        <ix-button variant="secondary" @click=${this.manageClosures}>
          <ix-icon name="calendar" slot="icon"></ix-icon>${localizeDir(MSG.overview.closures)}
        </ix-button>
        <ix-button variant="secondary" @click=${this.analyze}>
          <ix-icon name="analysis" slot="icon"></ix-icon>${localizeDir(MSG.overview.stopAnalysis)}
        </ix-button>
        <ix-button variant="secondary" @click=${this.analyzeKpi}>
          <ix-icon name="barchart" slot="icon"></ix-icon>${localizeDir(MSG.overview.kpiAnalysis)}
        </ix-button>
        <ix-button variant="secondary" @click=${() => ((this.settingsOpen = true), (this.settingsError = false))}>
          <ix-icon name="cogwheel" slot="icon"></ix-icon>${localizeDir(MSG.opening.moduleButton)}
        </ix-button>
        ${this.canEdit
          ? html`<ix-button @click=${this.create}>
              <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.overview.newEllipsis)}
            </ix-button>`
          : ''}
        ${this.roleAi ? html`<mf-ai-prompt></mf-ai-prompt>` : ''}
      </div>
      ${this.offline
        ? html`<div class="notice">
            <ix-icon name="info"></ix-icon>${localizeDir(MSG.overview.offlineNotice)}
          </div>`
        : ''}
      ${this.renderFilterBar()}
      ${this.ateliers.length === 0 ? this.renderEmpty() : this.renderGrid()}
      ${this.createOpen
        ? html`<mf-atelier-create-dialog
            .existingIds=${this.ateliers.map((a) => a.id)}
            .defaultTemplate=${this.createTemplate}
            .canEdit=${this.canEdit}
            defaultName=${this.createDefaultName}
            @wui:submit=${this.onCreateSubmit}
            @wui:cancel=${() => (this.createOpen = false)}
          ></mf-atelier-create-dialog>`
        : ''}
      ${this.settingsOpen
        ? html`<mf-module-settings-dialog
            .settings=${this.moduleSettings}
            .ateliers=${this.ateliers}
            .canConfigure=${this.canConfigure}
            .error=${this.settingsError}
            @wui:apply=${(e: CustomEvent<{ settings: FleetModuleSettings }>) => void this.saveModuleSettings(e.detail.settings)}
            @wui:close=${() => (this.settingsOpen = false)}
          ></mf-module-settings-dialog>`
        : ''}
      ${this.resourcesOpen
        ? html`<mf-graphics-catalog
            .store=${this.store}
            .canEdit=${this.canEdit}
            @wui:close=${() => (this.resourcesOpen = false)}
          ></mf-graphics-catalog>`
        : ''}
    `;
  }

  /** Save the module settings (#70) — /api/fleet checks the role `configure` again. */
  private async saveModuleSettings(settings: FleetModuleSettings): Promise<void> {
    const ok = (await this.store?.saveModuleSettings(settings)) ?? false;
    if (!ok) {
      this.settingsError = true;
      return;
    }
    this.settingsOpen = false;
    this.dispatchEvent(new CustomEvent('wui:module-settings', { detail: { settings }, bubbles: true, composed: true }));
  }

  private renderEmpty(): TemplateResult {
    return html`
      <div class="empty">
        <ix-typography>${localizeDir(MSG.overview.emptyNone)}</ix-typography>
        ${this.canEdit
          ? html`<ix-button variant="secondary" @click=${this.importDemo}>
              <ix-icon name="add" slot="icon"></ix-icon>${localizeDir(MSG.overview.importDemo)}
            </ix-button>`
          : ''}
      </div>
    `;
  }

  /** The filter bar over every atelier's machines; the filter is pruned to what still exists. */
  private renderFilterBar(): TemplateResult {
    const all = this.ateliers.flatMap((a) => a.machines);
    const dims = filterDimensions(all);
    if (dims.length === 0) return html``;
    const filter = pruneFilter(this.filter, dims);
    return html`<mf-filter-bar
      class="filters"
      .dimensions=${dims}
      .filter=${filter}
      .shown=${all.filter((m) => matchesFilter(m, filter)).length}
      .total=${all.length}
      @wui:filter=${(e: CustomEvent<FleetFilter>) => this.onFilter(e.detail)}
    ></mf-filter-bar>`;
  }

  private onFilter(filter: FleetFilter): void {
    this.filter = filter;
    saveFleetFilter(filter);
  }

  /** The machines of an atelier that pass the (pruned) filter. */
  private visible(a: Atelier): MachineDef[] {
    const filter = pruneFilter(this.filter, filterDimensions(this.ateliers.flatMap((x) => x.machines)));
    return isFilterActive(filter) ? a.machines.filter((m) => matchesFilter(m, filter)) : a.machines;
  }

  private renderGrid(): TemplateResult {
    // Without filter every atelier shows, empty ones included; with one, only those keeping a machine.
    const filtering = isFilterActive(pruneFilter(this.filter, filterDimensions(this.ateliers.flatMap((x) => x.machines))));
    const cards = this.ateliers
      .map((a) => ({ a, machines: this.visible(a) }))
      .filter(({ machines }) => !filtering || machines.length > 0);
    if (cards.length === 0) {
      return html`<div class="empty"><ix-typography>${localizeDir(MSG.filterBar.noMatch)}</ix-typography></div>`;
    }
    return html`<div class="grid">${cards.map(({ a, machines }) => this.renderCard(a, machines))}</div>`;
  }

  private renderCard(a: Atelier, machines: MachineDef[]): TemplateResult {
    return html`
      <ix-card class="card" title=${localize(MSG.overview.openView3d)} @click=${() => this.open(a)}>
        <ix-card-content>
          <div class="card-title">${a.name}</div>
          ${this.renderMinimap(a, machines)}
          <div class="stats">
            <span class="count">${machines.length} ${localizeDir(MSG.overview.machineCount)}</span>
            <span class="spacer"></span>
            ${this.renderStateChips(a, machines)}
          </div>
        </ix-card-content>
      </ix-card>
    `;
  }

  private renderStateChips(a: Atelier, machines: MachineDef[]): TemplateResult {
    const counts = new Map<MachineState, number>();
    for (const m of machines) counts.set(m.state, (counts.get(m.state) ?? 0) + 1);
    // One chip per state of the atelier's mappings that has machines, in their display order.
    return html`
      ${atelierStates(a.mappings).filter((s) => counts.get(s.key)).map(
        (s) => html`<span class="chip" style="--c:${s.color}" title=${s.label} aria-label=${`${s.label} : ${counts.get(s.key)}`}>${counts.get(s.key)}</span>`
      )}
    `;
  }

  private renderMinimap(a: Atelier, machines: MachineDef[]): TemplateResult {
    const { length, width } = a.building;
    // `meet` fits the footprint into the fixed-height minimap, so the scale is
    // 110px / width (height-limited for any aspect < ~2). Expressing the radius
    // in viewBox units as P·width/110 therefore renders a CONSTANT P px dot,
    // identical across ateliers, without changing the framing.
    const r = (MINIMAP_DOT_RADIUS_PX * width) / MINIMAP_HEIGHT_PX;
    const colors = new Map(atelierStates(a.mappings).map((s) => [s.key, s.color]));
    return html`
      <svg class="minimap" viewBox="0 0 ${length} ${width}" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width=${length} height=${width} class="minimap-bg"></rect>
        ${machines.map(
          (m) =>
            svg`<circle
              cx=${m.x + length / 2}
              cy=${m.z + width / 2}
              r=${r}
              fill=${colors.get(m.state) ?? UNKNOWN_STATE_COLOR}
            ></circle>`
        )}
      </svg>
    `;
  }

  private open(a: Atelier): void {
    this.dispatchEvent(
      new CustomEvent('wui:open', { detail: { id: a.id }, bubbles: true, composed: true })
    );
  }

  private create(): void {
    this.createTemplate = '';
    this.createDefaultName = `${localize(MSG.overview.defaultAtelierName)} ${this.ateliers.length + 1}`;
    this.createOpen = true;
  }

  private importDemo(): void {
    this.createTemplate = 'demo';
    this.createDefaultName = localize(MSG.overview.demoAtelierName);
    this.createOpen = true;
  }

  private onCreateSubmit(e: CustomEvent<{ name: string; id: string; seed: string }>): void {
    this.createOpen = false;
    this.dispatchEvent(
      new CustomEvent('wui:create', { detail: e.detail, bubbles: true, composed: true })
    );
  }

  private readonly analyze = (): void => {
    this.dispatchEvent(new CustomEvent('wui:analyze', { bubbles: true, composed: true }));
  };

  private readonly analyzeKpi = (): void => {
    this.dispatchEvent(new CustomEvent('wui:kpi', { bubbles: true, composed: true }));
  };

  private readonly manageClosures = (): void => {
    this.dispatchEvent(new CustomEvent('wui:closures', { bubbles: true, composed: true }));
  };
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function overviewStyles() {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      padding: 1rem;
      box-sizing: border-box;
      color: var(--theme-color-std-text);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
    .spacer {
      flex: 1;
    }
    .filters {
      margin-bottom: 1rem;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 1rem;
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-warning) 18%, transparent);
      border: 1px solid var(--theme-color-warning);
    }
    .empty {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
      padding: 2rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
      gap: 1.25rem;
      align-items: start;
    }
    .card {
      display: block;
      width: 100%;
      box-sizing: border-box;
      cursor: pointer;
    }
    .card:hover {
      outline: 1px solid var(--theme-color-primary);
      outline-offset: 2px;
    }
    .card-title {
      font-weight: 600;
      font-size: 1rem;
      line-height: 1.3;
      height: 2.6em;
      margin-bottom: 0.5rem;
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }
    .minimap {
      width: 100%;
      height: 110px;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
    }
    .minimap-bg {
      fill: color-mix(in srgb, var(--theme-color-primary) 6%, transparent);
    }
    .stats {
      display: flex;
      align-items: center;
      gap: 0.35rem;
      margin: 0.5rem 0;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .chip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.4rem;
      height: 1.4rem;
      padding: 0 0.35rem;
      border-radius: 0.7rem;
      font-size: 0.75rem;
      font-weight: 600;
      color: #fff;
      background: var(--c, var(--theme-color-primary));
    }
  `;
}
