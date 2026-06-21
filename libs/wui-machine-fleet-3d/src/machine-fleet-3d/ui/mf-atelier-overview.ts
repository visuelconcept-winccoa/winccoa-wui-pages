/**
 * Overview grid of ateliers (workshops). One card per atelier showing its name
 * (two reserved lines for uniform card height), machine count, a per-state
 * breakdown and a lightweight 2D top-down minimap. Clicking a card opens its 3D
 * view. Rename / delete actions live inside the atelier view, not on the card.
 * A "new atelier" action and (when empty) an "import demo" action are offered.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, svg, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import type { FleetStore } from '../data/fleet-store.js';
import { canEditFleet, canEditFleet$ } from '../data/permissions.js';
import { STATE_COLORS, type Atelier, type MachineState } from '../types.js';
import './mf-ai-prompt.js';
import './mf-atelier-create-dialog.js';
import './mf-graphics-catalog.js';

const STATES: MachineState[] = ['ok', 'warn', 'stop', 'maint'];
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

  @state() private createOpen = false;
  @state() private createTemplate = '';
  @state() private createDefaultName = '';
  @state() private resourcesOpen = false;
  /** Edit permission (canPublish); when false the overview is view-only. */
  @state() private canEdit = canEditFleet();

  private permSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.permSub = canEditFleet$().subscribe((allowed) => (this.canEdit = allowed));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.permSub.unsubscribe();
  }

  override render(): TemplateResult {
    return html`
      <div class="head">
        <span class="spacer"></span>
        <ix-button variant="secondary" @click=${() => (this.resourcesOpen = true)}>
          <ix-icon name="box-open" slot="icon"></ix-icon>Catalogue graphiques
        </ix-button>
        <ix-button variant="secondary" @click=${this.manageClosures}>
          <ix-icon name="calendar" slot="icon"></ix-icon>Jours non travaillés
        </ix-button>
        <ix-button variant="secondary" @click=${this.analyze}>
          <ix-icon name="analysis" slot="icon"></ix-icon>Analyse des causes d'arrêts
        </ix-button>
        <ix-button variant="secondary" @click=${this.analyzeKpi}>
          <ix-icon name="barchart" slot="icon"></ix-icon>Analyse des KPI
        </ix-button>
        ${this.canEdit
          ? html`<ix-button @click=${this.create}>
              <ix-icon name="plus" slot="icon"></ix-icon>Nouveau…
            </ix-button>`
          : ''}
        <mf-ai-prompt></mf-ai-prompt>
      </div>
      ${this.offline
        ? html`<div class="notice">
            <ix-icon name="info"></ix-icon>Mode hors-ligne : modifications non persistées dans les
            datapoints (backend indisponible ou droits d'écriture manquants).
          </div>`
        : ''}
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
        <ix-typography>Aucun atelier configuré.</ix-typography>
        ${this.canEdit
          ? html`<ix-button variant="secondary" @click=${this.importDemo}>
              <ix-icon name="add" slot="icon"></ix-icon>Importer l'atelier de démonstration
            </ix-button>`
          : ''}
      </div>
    `;
  }

  private renderGrid(): TemplateResult {
    return html`<div class="grid">${this.ateliers.map((a) => this.renderCard(a))}</div>`;
  }

  private renderCard(a: Atelier): TemplateResult {
    return html`
      <ix-card class="card" title="Ouvrir la vue 3D" @click=${() => this.open(a)}>
        <ix-card-content>
          <div class="card-title">${a.name}</div>
          ${this.renderMinimap(a)}
          <div class="stats">
            <span class="count">${a.machines.length} machine(s)</span>
            <span class="spacer"></span>
            ${this.renderStateChips(a)}
          </div>
        </ix-card-content>
      </ix-card>
    `;
  }

  private renderStateChips(a: Atelier): TemplateResult {
    const counts = new Map<MachineState, number>();
    for (const m of a.machines) counts.set(m.state, (counts.get(m.state) ?? 0) + 1);
    return html`
      ${STATES.filter((s) => counts.get(s)).map(
        (s) => html`<span class="chip" style="--c:${STATE_COLORS[s]}">${counts.get(s)}</span>`
      )}
    `;
  }

  private renderMinimap(a: Atelier): TemplateResult {
    const { length, width } = a.building;
    // `meet` fits the footprint into the fixed-height minimap, so the scale is
    // 110px / width (height-limited for any aspect < ~2). Expressing the radius
    // in viewBox units as P·width/110 therefore renders a CONSTANT P px dot,
    // identical across ateliers, without changing the framing.
    const r = (MINIMAP_DOT_RADIUS_PX * width) / MINIMAP_HEIGHT_PX;
    return html`
      <svg class="minimap" viewBox="0 0 ${length} ${width}" preserveAspectRatio="xMidYMid meet">
        <rect x="0" y="0" width=${length} height=${width} class="minimap-bg"></rect>
        ${a.machines.map(
          (m) =>
            svg`<circle
              cx=${m.x + length / 2}
              cy=${m.z + width / 2}
              r=${r}
              fill=${STATE_COLORS[m.state]}
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
    this.createDefaultName = `Atelier ${this.ateliers.length + 1}`;
    this.createOpen = true;
  }

  private importDemo(): void {
    this.createTemplate = 'demo';
    this.createDefaultName = 'Atelier de démonstration';
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
