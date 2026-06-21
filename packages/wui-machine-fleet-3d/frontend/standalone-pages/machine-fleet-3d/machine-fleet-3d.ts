/**
 * Machine Fleet 3D — Standalone page (WinCC OA WebUI Runtime).
 *
 * Shell + router for the multi-atelier 3D digital twin:
 *  - `/fleet-3d` → overview grid of ateliers (`mf-atelier-overview`)
 *  - `/fleet-3d/:atelier` → 3D view of one atelier (`mf-atelier-view`)
 *
 * Each atelier is persisted as one WinCC OA datapoint (auto-created DP type
 * `MachineFleet3D_Config`) via {@link FleetStore}. The route param `:atelier`
 * is delivered as the `atelier` attribute by the router (see
 * WebuiIXRoutesService.applyAttributes). Navigation uses RouterEvent so the
 * router recreates the element per route → clean WebGL lifecycle.
 *
 * Three.js is bundled into this page by `build:pages` (no CDN).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { templateSeed } from './machine-fleet-3d/data/atelier-templates.js';
import { normDp, toNumber } from './machine-fleet-3d/data/dp-utils.js';
import { FleetStore } from './_vendor/wui-fleet-core/data/fleet-store.js';
import { DEFAULT_STATE_MAPPINGS, resolveState, type Atelier } from './_vendor/wui-fleet-core/types.js';
import './machine-fleet-3d/ui/mf-atelier-overview.js';
import './machine-fleet-3d/ui/mf-atelier-view.js';

interface DpEmission {
  dp: string[];
  value: unknown[];
}

@customElement('wui-machine-fleet-3d')
export class WuiMachineFleet3d extends LitElement {
  static override readonly styles = [IXCoreStyles, shellStyles()];

  /** Route param `/fleet-3d/:atelier` → atelier id (overview when absent). */
  @property({ attribute: 'atelier' }) atelierId = '';

  @state() private ateliers: Atelier[] = [];
  @state() private active: Atelier | null = null;
  @state() private loading = true;
  @state() private offline = false;

  private readonly store = new FleetStore();
  private readonly api = this.resolveApi();
  private overviewSub = new Subscription();
  /** normalized stateDp → machines (across ateliers) it drives, for the overview. */
  private overviewTargets = new Map<string, { atelier: Atelier; machineIndex: number }[]>();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.overviewSub.unsubscribe();
  }

  override render(): TemplateResult {
    if (this.atelierId) return this.renderDetail();
    return this.renderOverview();
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
  }

  private renderOverview(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Machine Fleet 3D', 'fr.utf8': 'Parc machines 3D' }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>
        <mf-atelier-overview
          .ateliers=${this.ateliers}
          .store=${this.store}
          ?offline=${this.offline}
          @wui:open=${(e: CustomEvent<{ id: string }>) => this.navigate(e.detail.id)}
          @wui:create=${(e: CustomEvent<{ name: string; id?: string; seed?: string }>) => this.onCreate(e.detail)}
          @wui:analyze=${() => this.dispatchEvent(new RouterEvent('/fleet-stops'))}
          @wui:kpi=${() => this.dispatchEvent(new RouterEvent('/fleet-kpi'))}
          @wui:closures=${() => this.dispatchEvent(new RouterEvent('/fleet-closures'))}
        ></mf-atelier-overview>
      </div>
    `;
  }

  private renderDetail(): TemplateResult {
    if (this.loading) return html`<div class="loading"><ix-spinner></ix-spinner></div>`;
    if (!this.active) {
      return html`<div class="loading">
        <ix-typography>Atelier introuvable.</ix-typography>
        <ix-button @click=${() => this.back()}>Retour</ix-button>
      </div>`;
    }
    return html`
      <mf-atelier-view
        .atelier=${this.active}
        .store=${this.store}
        @wui:save=${(e: CustomEvent<Atelier>) => this.onSave(e.detail)}
        @wui:remove=${() => this.onRemoveActive()}
        @wui:back=${() => this.back()}
      ></mf-atelier-view>
    `;
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.ateliers = await this.store.listAteliers();
    this.offline = this.store.offline;
    if (this.atelierId) {
      this.active = this.ateliers.find((a) => a.id === this.atelierId) ?? null;
    } else {
      this.subscribeOverview();
    }
    this.loading = false;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  /** Live-bind every machine state datapoint across all ateliers (overview only). */
  private subscribeOverview(): void {
    this.overviewSub.unsubscribe();
    this.overviewSub = new Subscription();
    this.overviewTargets = new Map();

    const dps: string[] = [];
    for (const atelier of this.ateliers) {
      for (const [machineIndex, m] of atelier.machines.entries()) {
        if (!m.stateDp) continue;
        const key = normDp(m.stateDp);
        const list = this.overviewTargets.get(key) ?? [];
        list.push({ atelier, machineIndex });
        this.overviewTargets.set(key, list);
        dps.push(m.stateDp);
      }
    }
    const api = this.api;
    if (!api || dps.length === 0) return;
    try {
      this.overviewSub.add(
        api.dpConnect(dps, true).subscribe((data: DpEmission) => this.onOverviewDp(data))
      );
    } catch {
      // Backend not connected — keep persisted states.
    }
  }

  private onOverviewDp(data: DpEmission): void {
    let touched = false;
    for (const [i, dp] of data.dp.entries()) {
      const targets = this.overviewTargets.get(normDp(dp));
      if (!targets) continue;
      for (const t of targets) {
        const machine = t.atelier.machines[t.machineIndex];
        const mapping =
          t.atelier.mappings.find((mp) => mp.id === machine.stateMappingId) ??
          t.atelier.mappings[0] ??
          DEFAULT_STATE_MAPPINGS[0];
        // Cast float state datapoints to the nearest integer state code.
        machine.state = resolveState(mapping, Math.round(toNumber(data.value[i])));
        touched = true;
      }
    }
    if (touched) this.ateliers = [...this.ateliers];
  }

  private async onCreate(detail: { name: string; id?: string; seed?: string }): Promise<void> {
    const atelier = await this.store.createAtelier(
      detail.name,
      templateSeed(detail.seed),
      detail.id
    );
    this.ateliers = [...this.ateliers, atelier];
    this.navigate(atelier.id);
  }

  private async onRemoveActive(): Promise<void> {
    const active = this.active;
    if (!active) return;
    await this.store.deleteAtelier(active.id);
    this.ateliers = this.ateliers.filter((a) => a.id !== active.id);
    this.back();
  }

  private async onSave(atelier: Atelier): Promise<void> {
    await this.store.saveAtelier(atelier);
    this.ateliers = this.ateliers.map((a) => (a.id === atelier.id ? atelier : a));
  }

  private navigate(id: string): void {
    this.dispatchEvent(new RouterEvent(`/fleet-3d/${id}`));
  }

  private back(): void {
    this.dispatchEvent(new RouterEvent('/fleet-3d'));
  }
}

function shellStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      background: transparent;
    }
    .page {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .loading {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 1rem;
      height: 100%;
    }
  `;
}
