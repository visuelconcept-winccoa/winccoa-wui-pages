// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Power plants — Standalone page (WinCC OA WebUI Runtime). Route: `/gis-plants`.
 *
 * Lays out the operating parameters of every plant the GIS network simulator drives — the
 * `GisSim_<assetId>_<element>` datapoints of the `production-electrique` family: output,
 * available capacity, load factor, voltage, frequency, state and fault — one card per plant.
 *
 * **Order is the point of the page.** The highest output first, recomputed on every change:
 * a plant that trips drops, the plants that pick up its load climb. A card that moves slides
 * to its new place so the eye can follow it (no motion under `prefers-reduced-motion`). Ties
 * at the displayed megawatt keep their previous order, so a stable fleet stays still.
 *
 * Alarms are out of this first version — values only.
 *
 * Read-only. Values come from one isolated `dpConnect` per element
 * (`./gis-plants/data/plant-feed.ts`), the names from the `GIS_Site` datapoints. A card opens
 * its site on `/gis/:siteid`.
 */
import {
  hasRole$,
  registerModuleRoles,
  type AppModuleRoles
} from '@visuelconcept-winccoa/wui-kit/data/app-security.js';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { styleMap } from 'lit/directives/style-map.js';
import { Subscription } from 'rxjs';
import appSecurityRoles from './app-security.roles.json';
import { PlantFeed, type FeedStatus } from './gis-plants/data/plant-feed.js';
import {
  STATE_FAULT,
  STATE_MAINTENANCE,
  STATE_OFF,
  STATE_RUN,
  rankPlants,
  summarize,
  type Plant
} from './gis-plants/data/plants.js';
import {
  MSG,
  localize,
  localizeDir,
  stateLabel,
  waitingMsg
} from './gis-plants/i18n.js';
import { pageStyles } from './gis-plants/ui/styles.js';

const MODULE_ID = 'gis-plants';

/** Page header config — the shell renders the title from it. */
const HEADER_CONFIG = {
  headerTitle: { context: 'translate', config: MSG.page.title },
  headerSubtitle: { context: 'translate', config: MSG.page.subtitle }
} as const;

/** How long a card takes to slide to its new rank. */
const REORDER_MS = 350;
const PERCENT = 100;

/** Decimals of each value, as the simulator's catalogue declares them. */
const DECIMALS = { power: 0, load: 0, voltage: 1, frequency: 2 } as const;

/** iX pill variant of each plant state. */
const STATE_VARIANT: Record<number, string> = {
  [STATE_OFF]: 'neutral',
  [STATE_RUN]: 'success',
  [STATE_FAULT]: 'alarm',
  [STATE_MAINTENANCE]: 'warning'
};

function formatNumber(value: number | undefined, decimals: number): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function reducedMotion(): boolean {
  return (
    globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );
}

export class WuiGisPlants extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  /** The plants in their displayed order. */
  @state() private plants: Plant[] = [];
  @state() private status: FeedStatus = 'live';
  /** Nothing has arrived yet (distinguishes "loading" from "no plant"). */
  @state() private loaded = false;
  /** Plants found by the discovery, values arrived or not — tells the two empty states apart. */
  @state() private discovered = 0;
  /** Application-Security grant for the 'view' role (open until assigned). */
  @state() private roleView = true;

  private readonly feed = new PlantFeed(this.onFeedChange.bind(this));
  private roleSub = new Subscription();
  /** Card positions captured just before a re-render, keyed by stem (FLIP "first"). */
  private positions = new Map<string, DOMRect>();

  override connectedCallback(): void {
    super.connectedCallback();
    // Application Security: declare this module's roles (docs/wui-app-security/INTEGRATION.md).
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$(MODULE_ID, 'view').subscribe(
      (granted) => (this.roleView = granted)
    );
    this.feed.start();
    this.status = this.feed.status;
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.feed.stop();
    this.roleSub.unsubscribe();
  }

  override render(): TemplateResult {
    if (!this.roleView)
      return html`<div class="page">
        <div class="center">${localizeDir(MSG.page.forbidden)}</div>
      </div>`;
    return html`
      <div class="page">
        <wui-context-generator .config=${HEADER_CONFIG}>
          <wui-content-header></wui-content-header>
        </wui-context-generator>
        <div class="body">${this.renderBody()}</div>
      </div>
    `;
  }

  protected override willUpdate(): void {
    this.positions = this.cardRects();
  }

  protected override updated(): void {
    this.slideMovedCards();
  }

  private renderBody(): TemplateResult {
    if (this.status === 'offline') return this.renderNotice(MSG.page.offline);
    if (this.status === 'failed') return this.renderNotice(MSG.page.failed);
    if (this.plants.length === 0) return this.renderEmpty();
    return html`
      ${this.renderSummary()}
      <div class="grid">
        ${repeat(
          this.plants,
          (plant) => plant.stem,
          (plant, index) => this.renderCard(plant, index)
        )}
      </div>
    `;
  }

  private renderEmpty(): TemplateResult {
    if (!this.loaded)
      return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const message =
      this.discovered > 0 ? waitingMsg(this.discovered) : MSG.page.empty;
    return html`<div class="center">${localizeDir(message)}</div>`;
  }

  private renderNotice(message: typeof MSG.page.offline): TemplateResult {
    return html`<div class="notice">
      <ix-icon name="warning" size="16"></ix-icon>${localizeDir(message)}
    </div>`;
  }

  private renderSummary(): TemplateResult {
    const summary = summarize(this.plants);
    const load =
      summary.capacity > 0
        ? (summary.output / summary.capacity) * PERCENT
        : undefined;
    return html`
      <div class="summary">
        ${this.renderKpi(MSG.summary.plants, String(summary.plants))}
        ${this.renderKpi(MSG.summary.running, String(summary.running))}
        ${this.renderKpi(MSG.summary.output, formatNumber(summary.output, DECIMALS.power), 'MW')}
        ${this.renderKpi(MSG.summary.capacity, formatNumber(summary.capacity, DECIMALS.power), 'MW')}
        ${this.renderKpi(MSG.summary.load, formatNumber(load, DECIMALS.load), '%')}
      </div>
    `;
  }

  private renderKpi(
    label: typeof MSG.summary.plants,
    value: string,
    unit = ''
  ): TemplateResult {
    return html`<div class="kpi">
      <span class="label">${localizeDir(label)}</span>
      <span class="value"
        >${value}${unit ? html`<span class="unit">${unit}</span>` : nothing}</span
      >
    </div>`;
  }

  private renderCard(plant: Plant, index: number): TemplateResult {
    const linked = plant.siteId !== '';
    const { values } = plant;
    const load = Math.min(Math.max(values.charge ?? 0, 0), PERCENT);
    const classes = linked ? 'card linked' : 'card';
    return html`
      <article
        class=${classes}
        data-stem=${plant.stem}
        tabindex=${linked ? '0' : '-1'}
        title=${linked ? localize(MSG.card.openMap) : ''}
        @click=${() => this.openSite(plant)}
        @keydown=${(event: KeyboardEvent) => this.onCardKey(event, plant)}
      >
        ${this.renderCardHead(plant, index)}
        <div class="output">
          <span class="big"
            >${formatNumber(values.puissance, DECIMALS.power)}</span
          >
          <span class="of"
            >/ ${formatNumber(values.capacite, DECIMALS.power)} MW</span
          >
        </div>
        <div class="bar" title=${localize(MSG.card.load)}>
          <span style=${styleMap({ width: `${load}%` })}></span>
        </div>
        <dl class="params">
          ${this.renderParam(MSG.card.load, formatNumber(values.charge, DECIMALS.load), '%')}
          ${this.renderParam(MSG.card.voltage, formatNumber(values.tension, DECIMALS.voltage), 'kV')}
          ${this.renderParam(MSG.card.frequency, formatNumber(values.frequence, DECIMALS.frequency), 'Hz')}
        </dl>
      </article>
    `;
  }

  private renderCardHead(plant: Plant, index: number): TemplateResult {
    const { etat } = plant.values;
    return html`<div class="head">
      <span class="rank">${index + 1}</span>
      <div class="title">
        <div class="name">${plant.name}</div>
        <div class="site">${plant.siteName}</div>
      </div>
      <ix-pill variant=${STATE_VARIANT[etat ?? -1] ?? 'neutral'} outline
        >${localizeDir(stateLabel(etat))}</ix-pill
      >
    </div>`;
  }

  private renderParam(
    label: typeof MSG.card.load,
    value: string,
    unit: string
  ): TemplateResult {
    return html`<div>
      <dt>${localizeDir(label)}</dt>
      <dd>${value} ${unit}</dd>
    </div>`;
  }

  private onFeedChange(): void {
    this.status = this.feed.status;
    this.loaded = true;
    this.discovered = this.feed.discovered;
    this.plants = rankPlants(
      this.feed.plants(),
      this.plants.map((plant) => plant.stem)
    );
  }

  private openSite(plant: Plant): void {
    if (plant.siteId)
      this.dispatchEvent(new RouterEvent(`/gis/${plant.siteId}`));
  }

  private onCardKey(event: KeyboardEvent, plant: Plant): void {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    this.openSite(plant);
  }

  private cardRects(): Map<string, DOMRect> {
    const rects = new Map<string, DOMRect>();
    for (const card of this.renderRoot.querySelectorAll<HTMLElement>('.card'))
      rects.set(card.dataset['stem'] ?? '', card.getBoundingClientRect());
    return rects;
  }

  /**
   * FLIP: every card that changed place is drawn back at its old position, then released
   * towards the new one. Measured against the rect captured in `willUpdate`, which already
   * includes a motion still running — so a reorder arriving mid-slide continues from where
   * the card actually is instead of jumping.
   */
  private slideMovedCards(): void {
    if (this.positions.size === 0 || reducedMotion()) return;
    for (const card of this.renderRoot.querySelectorAll<HTMLElement>('.card')) {
      const before = this.positions.get(card.dataset['stem'] ?? '');
      if (!before) continue;
      // Measure the layout slot itself, not the slot plus a slide still in progress.
      for (const running of card.getAnimations()) running.cancel();
      const after = card.getBoundingClientRect();
      const deltaX = before.left - after.left;
      const deltaY = before.top - after.top;
      if (Math.abs(deltaX) < 1 && Math.abs(deltaY) < 1) continue;
      card.animate(
        [
          { transform: `translate(${deltaX}px, ${deltaY}px)` },
          { transform: 'none' }
        ],
        { duration: REORDER_MS, easing: 'ease-out' }
      );
    }
  }
}

// Guarded registration: the page module may be imported more than once in a
// shared-chunk layout, and a duplicate `define` would throw.
if (!customElements.get('wui-gis-plants')) {
  customElements.define('wui-gis-plants', WuiGisPlants);
}
