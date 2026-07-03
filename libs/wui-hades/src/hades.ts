// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Hades — Standalone page (WinCC OA WebUI Runtime): integrated road-tunnel
 * management.
 *
 * Shell + router:
 *  - `/hades` → tunnel overview (`hd-overview`)
 *  - `/hades/:tunnel` → workspace of one tunnel (`hd-tunnel-view`: 3D digital
 *    twin, segment editor + compliance advisor, linear synoptic, operating
 *    modes with confirmed + audited field commands)
 *
 * Each tunnel persists as one WinCC OA datapoint (auto-created DP type
 * `Hades_Tunnel`) via {@link HadesStore}; create/update/delete are GxP-traced
 * into `AuditTrail_Hades`. The route param `:tunnel` arrives as the `tunnel`
 * attribute (WebuiIXRoutesService.applyAttributes); navigation dispatches
 * RouterEvent so the router recreates the element per route → clean WebGL
 * lifecycle. Three.js is bundled into this page by `build:pages` (no CDN).
 */
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { canEditFleet, canEditFleet$ } from '@visuelconcept/wui-kit/data/permissions.js';
import { demoCatalog } from './hades/data/demo-tunnel.js';
import { HadesStore } from './hades/data/hades-store.js';
import { duplicateTunnel } from './hades/data/io.js';
import { MSG, localize, localizeDir } from './hades/i18n.js';
import type { RegulatoryProfileId, Tunnel } from './hades/types.js';
import './hades/ui/hd-overview.js';
import './hades/ui/hd-tunnel-view.js';
import type { CreateTunnelDetail } from './hades/ui/hd-overview.js';

@customElement('wui-hades')
export class WuiHades extends LitElement {
  static override readonly styles = [IXCoreStyles, shellStyles()];

  /** Route param `/hades/:tunnel` → tunnel id (overview when absent). */
  @property({ attribute: 'tunnel' }) tunnelId = '';

  @state() private tunnels: Tunnel[] = [];
  @state() private loading = true;
  @state() private offline = false;
  @state() private canEdit = canEditFleet();

  private readonly store = new HadesStore();
  private permissionSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.permissionSub = new Subscription();
    this.permissionSub.add(canEditFleet$().subscribe((can) => (this.canEdit = can)));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.permissionSub.unsubscribe();
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.refresh();
  }

  override render(): TemplateResult {
    if (this.tunnelId) return this.renderDetail();
    return this.renderOverview();
  }

  private renderOverview(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: {
                'en_US.utf8': 'Hades — Tunnel management',
                'fr.utf8': 'Hadès — Gestion de tunnel',
                'de_AT.utf8': 'Hades — Tunnelmanagement'
              }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>
        ${this.loading
          ? html`<div class="loading"><ix-spinner></ix-spinner></div>`
          : html`<hd-overview
              .tunnels=${this.tunnels}
              ?offline=${this.offline}
              ?canEdit=${this.canEdit}
              @wui:open=${(e: CustomEvent<{ id: string }>) => this.navigate(e.detail.id)}
              @wui:create=${(e: CustomEvent<CreateTunnelDetail>) => this.onCreate(e.detail)}
              @wui:import-demo=${(e: CustomEvent<string>) => this.onImportDemo(e.detail)}
              @wui:import=${(e: CustomEvent<Tunnel>) => this.onImport(e.detail)}
              @wui:duplicate=${(e: CustomEvent<Tunnel>) => this.onDuplicate(e.detail)}
            ></hd-overview>`}
      </div>
    `;
  }

  private renderDetail(): TemplateResult {
    if (this.loading) return html`<div class="loading"><ix-spinner></ix-spinner></div>`;
    const active = this.tunnels.find((t) => t.id === this.tunnelId) ?? null;
    if (!active) {
      return html`<div class="loading">
        <ix-typography>${localizeDir(MSG.shell.notFound)}</ix-typography>
        <ix-button @click=${() => this.back()}>${localizeDir(MSG.shell.back)}</ix-button>
      </div>`;
    }
    return html`
      <hd-tunnel-view
        .tunnel=${active}
        ?canEdit=${this.canEdit}
        ?offline=${this.offline}
        @wui:save=${(e: CustomEvent<Tunnel>) => this.onSave(e.detail)}
        @wui:remove=${(e: CustomEvent<string>) => this.onRemove(e.detail)}
        @wui:back=${() => this.back()}
      ></hd-tunnel-view>
    `;
  }

  private async refresh(): Promise<void> {
    this.loading = true;
    this.tunnels = await this.store.listTunnels();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private async onCreate(detail: CreateTunnelDetail): Promise<void> {
    const tunnel = await this.store.createTunnel(blankTunnel(detail.name, detail.profile));
    this.tunnels = [...this.tunnels, tunnel];
    this.offline = this.store.offline;
    this.navigate(tunnel.id);
  }

  private async onImportDemo(demoId: string): Promise<void> {
    const preset = demoCatalog().find((d) => d.id === demoId);
    if (!preset) return;
    const tunnel = await this.store.createTunnel(preset.build());
    this.tunnels = [...this.tunnels, tunnel];
    this.offline = this.store.offline;
    this.navigate(tunnel.id);
  }

  /** Import a tunnel parsed from an exported JSON file (new DP, new id). */
  private async onImport(parsed: Tunnel): Promise<void> {
    const tunnel = await this.store.createTunnel(parsed);
    this.tunnels = [...this.tunnels, tunnel];
    this.offline = this.store.offline;
    this.navigate(tunnel.id);
  }

  private async onDuplicate(source: Tunnel): Promise<void> {
    const copy = duplicateTunnel(source, localize(MSG.overview.copySuffix));
    const tunnel = await this.store.createTunnel(copy);
    this.tunnels = [...this.tunnels, tunnel];
    this.offline = this.store.offline;
  }

  private async onSave(tunnel: Tunnel): Promise<void> {
    await this.store.saveTunnel(tunnel);
    this.tunnels = this.tunnels.map((t) => (t.id === tunnel.id ? tunnel : t));
    this.offline = this.store.offline;
  }

  private async onRemove(id: string): Promise<void> {
    await this.store.deleteTunnel(id);
    this.tunnels = this.tunnels.filter((t) => t.id !== id);
    this.offline = this.store.offline;
    this.back();
  }

  private navigate(id: string): void {
    this.dispatchEvent(new RouterEvent(`/hades/${id}`));
  }

  private back(): void {
    this.dispatchEvent(new RouterEvent('/hades'));
  }
}

/** Fresh single-tube tunnel used by the create dialog. */
function blankTunnel(name: string, profile: RegulatoryProfileId): Tunnel {
  return {
    id: '',
    name,
    profile,
    trafficPerLane: 2500,
    tubes: [
      {
        id: `tube-${Date.now().toString(36)}`,
        name: 'Tube 1',
        direction: 'unidirectional',
        lanes: 2,
        segments: [
          {
            id: `seg-${Date.now().toString(36)}`,
            name: 'S1',
            lengthM: 600,
            gradientPct: 0,
            curveRadiusM: 0,
            clearanceM: 4.5,
            lightingZone: 'entrance'
          }
        ]
      }
    ],
    equipment: [],
    modes: []
  };
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
    .page hd-overview {
      flex: 1;
      min-height: 0;
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
