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
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { LitElement, css, html, svg, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { firstValueFrom, type Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { normDp, toNumber } from '../data/dp-utils.js';
import type { FleetStore } from '../data/fleet-store.js';
import { hasRole$ } from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { MSG, localize, localizeDir, ml } from '../i18n.js';
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
import {
  DEFAULT_STATE_MAPPINGS,
  UNKNOWN_STATE_COLOR,
  atelierStates,
  resolveState,
  type Atelier,
  type MachineDef,
  type MachineState
} from '../types.js';
import './mf-ai-prompt.js';
import './mf-atelier-create-dialog.js';
import './mf-filter-bar.js';
import './mf-graphics-catalog.js';
import { loadSettingsPages, type FleetSettingsPage } from '../settings-pages.js';

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

  @state() private createOpen = false;
  @state() private createTemplate = '';
  @state() private createDefaultName = '';
  @state() private resourcesOpen = false;
  /** Settings pages the site adds to the fleet (menu entries marked `fleetSettings`). */
  @state() private settingsPages: FleetSettingsPage[] = [];
  /** Paths of the settings pages the user may open (one of their roles granted, or none asked). */
  @state() private grantedPages: string[] = [];
  /** The "Paramètres" menu (settings pages of the site) is open. */
  @state() private settingsMenuOpen = false;
  private pageRoleSubs: Subscription[] = [];
  /** Remembered machine filter (the user's settings, shared with the atelier views). */
  @state() private filter: FleetFilter = loadFleetFilter();
  private settingsSub: Subscription | null = null;
  /** Live value of each machine's state datapoint (normalised name → raw value), for the cards' dots and counts. */
  @state() private liveStates = new Map<string, unknown>();
  /** The state datapoints followed (sorted, joined): a new list of ateliers re-subscribes only when it changes. */
  private liveKey = '';
  private liveSub: Subscription | null = null;

  override connectedCallback(): void {
    super.connectedCallback();
    this.settingsSub = settingsCache.watch(['fleet-filter'], () => (this.filter = loadFleetFilter()));
    void loadSettingsPages().then((pages) => this.watchPageRoles(pages));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.settingsSub?.unsubscribe();
    this.settingsSub = null;
    this.pageRoleSubs.forEach((s) => s.unsubscribe());
    this.pageRoleSubs = [];
    this.liveSub?.unsubscribe();
    this.liveSub = null;
    this.liveKey = '';
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('ateliers')) this.watchStates();
  }

  /**
   * Follow the state datapoint of every machine of the ateliers, so that the cards' dots and counts show the
   * state the machines are in now, as the atelier view does, and not the state stored with each machine.
   */
  private watchStates(): void {
    const dps = [...new Set(this.ateliers.flatMap((a) => a.machines.map((m) => m.stateDp ?? '')).filter(Boolean))].sort();
    const key = dps.join('|');
    if (key === this.liveKey) return;
    this.liveKey = key;
    this.liveSub?.unsubscribe();
    this.liveSub = null;
    if (dps.length === 0) return;
    let api: OaRxJsApi;
    try {
      api = container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return; // No WinCC OA runtime (standalone / demo host): the stored states stay.
    }
    void this.connectStates(api, dps, key);
  }

  /** A one-shot read keeps the datapoints that exist (one missing would fail the whole block), then one dpConnect. */
  private async connectStates(api: OaRxJsApi, dps: string[], key: string): Promise<void> {
    const results = await Promise.allSettled(dps.map((dp) => firstValueFrom(api.dpGet(dp))));
    if (key !== this.liveKey) return;
    const live = new Map(this.liveStates);
    const valid: string[] = [];
    for (const [i, dp] of dps.entries()) {
      const result = results[i];
      if (result.status !== 'fulfilled') continue;
      valid.push(dp);
      live.set(normDp(dp), result.value);
    }
    this.liveStates = live;
    if (valid.length === 0) return;
    try {
      this.liveSub = api.dpConnect(valid, true).subscribe({
        next: (data: { dp: string[]; value: unknown[] }) => {
          if (key !== this.liveKey) return;
          const next = new Map(this.liveStates);
          for (const [i, dp] of data.dp.entries()) next.set(normDp(dp), data.value[i]);
          this.liveStates = next;
        },
        error: () => {
          // Live channel dropped: keep the last values.
        }
      });
    } catch {
      // Backend not connected: keep the values read.
    }
  }

  /** A machine's state now: its state datapoint read through its mapping, else the state stored with it. */
  private stateOf(a: Atelier, m: MachineDef): MachineState {
    const raw = m.stateDp ? this.liveStates.get(normDp(m.stateDp)) : undefined;
    if (raw === undefined) return m.state;
    const mapping = a.mappings.find((mp) => mp.id === m.stateMappingId) ?? a.mappings[0] ?? DEFAULT_STATE_MAPPINGS[0];
    return resolveState(mapping, Math.round(toNumber(raw)));
  }

  /** Follow the grants of each settings page: listed when one of its roles is granted, or none asked. */
  private watchPageRoles(pages: FleetSettingsPage[]): void {
    this.settingsPages = pages;
    const granted = new Map<string, Set<string>>();
    const update = (): void => {
      this.grantedPages = pages
        .filter((p) => p.roles.length === 0 || (granted.get(p.path)?.size ?? 0) > 0)
        .map((p) => p.path);
    };
    for (const p of pages) {
      for (const r of p.roles) {
        const key = `${r.module}/${r.role}`;
        this.pageRoleSubs.push(
          hasRole$(r.module, r.role).subscribe((on) => {
            const set = granted.get(p.path) ?? new Set<string>();
            if (on) set.add(key);
            else set.delete(key);
            granted.set(p.path, set);
            update();
          })
        );
      }
    }
    update();
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
        ${this.renderSettingsButton()}
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
      ${this.resourcesOpen
        ? html`<mf-graphics-catalog
            .store=${this.store}
            .canEdit=${this.canEdit}
            @wui:close=${() => (this.resourcesOpen = false)}
          ></mf-graphics-catalog>`
        : ''}
    `;
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
    for (const m of machines) {
      const s = this.stateOf(a, m);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
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
              fill=${colors.get(this.stateOf(a, m)) ?? UNKNOWN_STATE_COLOR}
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

  /** A settings page of the site (`wui:page`, the host routes to it). */
  /**
   * One "Paramètres" button: the module's own settings (its opening view) and the settings pages of the
   * site the user may open. With no such page, it opens the module's settings directly.
   */
  /**
   * "Paramètres": the settings pages of the site the user may open — none: no button; one: the button opens
   * it; several: a menu. (The default opening view of every atelier is no longer offered here.)
   */
  private renderSettingsButton(): TemplateResult {
    const pages = this.settingsPages.filter((p) => this.grantedPages.includes(p.path));
    if (pages.length === 0) return html``;
    if (pages.length === 1) {
      const [only] = pages;
      return html`<ix-button variant="secondary" @click=${() => this.openPage(only.path)}>
        <ix-icon name="cogwheel" slot="icon"></ix-icon>${localizeDir(MSG.overview.settings)}
      </ix-button>`;
    }
    return html`<span class="settings-wrap">
      <ix-button variant="secondary" aria-haspopup="menu" aria-expanded=${this.settingsMenuOpen ? 'true' : 'false'}
        @click=${() => (this.settingsMenuOpen = !this.settingsMenuOpen)}>
        <ix-icon name="cogwheel" slot="icon"></ix-icon>${localizeDir(MSG.overview.settings)}
      </ix-button>
      ${this.settingsMenuOpen
        ? html`<div class="menu-backdrop" @click=${() => (this.settingsMenuOpen = false)}></div>
            <div class="settings-menu" role="menu">
              ${pages.map(
                (p) => html`<button type="button" role="menuitem" @click=${() => {
                  this.settingsMenuOpen = false;
                  this.openPage(p.path);
                }}>
                  <ix-icon name=${p.icon} size="16"></ix-icon>${localize(ml(p.title.en, p.title.fr, p.title.de))}
                </button>`
              )}
            </div>`
        : ''}
    </span>`;
  }

  private openPage(path: string): void {
    this.dispatchEvent(new CustomEvent('wui:page', { detail: { path }, bubbles: true, composed: true }));
  }

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
    .settings-wrap {
      position: relative;
    }
    .menu-backdrop {
      position: fixed;
      inset: 0;
      z-index: 20;
    }
    .settings-menu {
      position: absolute;
      top: calc(100% + 0.25rem);
      right: 0;
      z-index: 21;
      display: flex;
      flex-direction: column;
      min-width: 14rem;
      padding: 0.25rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    }
    .settings-menu button {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.6rem;
      border: 0;
      border-radius: 0.2rem;
      background: transparent;
      color: var(--theme-color-std-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .settings-menu button:hover {
      background: var(--theme-color-ghost--hover);
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
