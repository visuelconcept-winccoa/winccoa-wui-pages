// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Ampère — Standalone page (WinCC OA WebUI Runtime).
 *
 * Draw and animate single-line (mono-filaire) electrical distribution networks:
 * `/ampere` lists the saved networks, `/ampere/:networkid` opens one. In display
 * mode the diagram is live — wires and symbols light up green by an energisation
 * graph traversal from the sources through the *closed* switchgear (each device's
 * open/closed position bound freely to a datapoint), and measurement labels show
 * live values. In edit mode a symbol **toolbox** (IEC 60617), free drag on a
 * magnetic grid, click-to-wire ports and a **properties inspector** compose the
 * network; an embedded **AI assistant** drafts whole networks from a prompt.
 *
 * Each network is one datapoint of type `Ampere_Network`; the store falls back to
 * an in-memory demo when the backend is unreachable. Live values come from
 * `OaRxJsApi.dpConnect`; the energisation is derived, never stored.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { RouterEvent } from '@wincc-oa/wui-models/events/router-event.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { AmpereStore } from './ampere/data/ampere-store.js';
import { DEMO_NETWORKS } from './ampere/data/demo.js';
import { exportJson, exportNetwork, parseNetworks } from './ampere/data/io.js';
import { computeEnergy, type EnergyState } from './ampere/topology.js';
import { isSwitchgear, type SymbolId } from './ampere/symbols/catalog.js';
import {
  blankMeasurement,
  blankNetwork,
  measurementPos,
  type Measurement,
  type Network,
  type Node,
  type PortRef,
  type Rotation
} from './ampere/types.js';
import { MSG, confirmDeleteMsg, localize, localizeDir, networkCountMsg } from './ampere/i18n.js';
import type { Selection, Tool } from './ampere/ui/am-canvas.js';
import '@visuelconcept/wui-kit/ui/wui-confirm-dialog.js';
import './ampere/ui/am-canvas.js';
import './ampere/ui/am-toolbox.js';
import './ampere/ui/am-inspector.js';
import './ampere/ui/am-network-table.js';
import './ampere/ui/am-network-dialog.js';
import './ampere/ui/am-ai-assistant.js';

const ID_RADIX = 36;
const PAD_LEN = 2;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.2;
const PLACE_OFFSET = 300;

function pad(n: number): string {
  return String(n).padStart(PAD_LEN, '0');
}

/** Local-datetime string (`YYYY-MM-DDTHH:mm`) for "now". */
function nowLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Unique id with a short prefix. */
function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(ID_RADIX)}${Math.trunc(performance.now() % 1000)}`;
}

/**
 * Normalise a DP element name for matching live emissions against bound names:
 * drop a leading `System:` prefix and any trailing config/attribute (`:_online…`).
 */
function normDp(dp: string): string {
  let s = dp.trim();
  const first = s.indexOf(':');
  if (first > 0 && !s.slice(0, first).includes('.')) s = s.slice(first + 1);
  const cfg = s.indexOf(':');
  if (cfg >= 0) s = s.slice(0, cfg);
  return s.toLowerCase();
}

export class WuiAmpere extends LitElement {
  static override readonly styles = [IXCoreStyles, pageStyles()];

  /** Route param `/ampere/:networkid` → displayed network id (overview when absent). */
  @property({ attribute: 'networkid' }) networkId = '';

  @state() private networks: Network[] = [];
  @state() private loading = true;
  @state() private offline = false;
  @state() private editing = false;
  @state() private tool: Tool = 'select';
  @state() private zoom = 1;
  @state() private selection: Selection | null = null;
  @state() private editingNetwork: Network | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private importError = '';

  /** Live DP values keyed by normalised name. */
  @state() private live: Map<string, number | string> = new Map();

  private readonly store = new AmpereStore();
  private readonly api = this.resolveApi();
  private dpSub = new Subscription();
  private subscribedKey = '';

  override render(): TemplateResult {
    return html`
      <div class="page">
        <wui-context-generator
          .config=${{
            headerTitle: {
              context: 'translate',
              config: { 'en_US.utf8': 'Ampère', fr: 'Ampère', 'de_AT.utf8': 'Ampère' }
            }
          }}
        >
          <wui-content-header></wui-content-header>
        </wui-context-generator>
        <div class="body">
          ${this.importError ? html`<div class="notice error"><ix-icon name="warning"></ix-icon>${this.importError}</div>` : nothing}
          ${this.offline ? html`<div class="notice"><ix-icon name="info"></ix-icon>${localizeDir(MSG.page.offline)}</div>` : nothing}
          ${this.renderBody()}
        </div>
      </div>
      ${this.editingNetwork === undefined
        ? nothing
        : html`<am-network-dialog
            .network=${this.editingNetwork}
            @wui:save=${this.onNetworkSave}
            @wui:cancel=${() => (this.editingNetwork = undefined)}
          ></am-network-dialog>`}
      ${this.deletingId
        ? html`<wui-confirm-dialog
            message=${confirmDeleteMsg(this.networkName(this.deletingId))}
            @wui:confirm=${this.onDeleteConfirm}
            @wui:cancel=${() => (this.deletingId = null)}
          ></wui-confirm-dialog>`
        : nothing}
    `;
  }

  protected override firstUpdated(): void {
    void this.refresh();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('networkId') && !this.networkId) {
      this.editing = false;
      this.selection = null;
    }
  }

  protected override updated(): void {
    this.syncSubscription();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.dpSub.unsubscribe();
  }

  // --- body ------------------------------------------------------------------

  private renderBody(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const selected = this.selectedNetwork();
    if (this.networkId && selected) return this.renderEditor(selected);
    if (this.networkId && !selected) return this.renderMissing();
    return this.renderOverview();
  }

  private renderOverview(): TemplateResult {
    return html`
      <div class="toolbar">
        <span class="count">${networkCountMsg(this.networks.length)}</span>
        <span class="grow"></span>
        <ix-button variant="secondary" @click=${this.triggerImport}>
          <ix-icon name="upload" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.import)}
        </ix-button>
        <ix-button variant="secondary" ?disabled=${this.networks.length === 0} @click=${() => exportJson(this.networks)}>
          <ix-icon name="download" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.exportAll)}
        </ix-button>
        <ix-button @click=${() => (this.editingNetwork = null)}>
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.newNetwork)}
        </ix-button>
      </div>
      <input class="import-input" type="file" accept="application/json,.json" hidden @change=${this.onImportFile} />
      ${this.networks.length === 0
        ? html`<div class="center empty">
            <ix-typography>${localizeDir(MSG.page.emptyList)}</ix-typography>
            <ix-button variant="secondary" @click=${this.generateDemo}>
              <ix-icon name="add" slot="icon"></ix-icon>${localizeDir(MSG.page.generateDemo)}
            </ix-button>
          </div>`
        : html`<am-network-table
            .networks=${this.networks}
            @wui:open=${(e: CustomEvent<{ id: string }>) => this.navigate(e.detail.id)}
            @wui:edit=${(e: CustomEvent<{ id: string }>) => (this.editingNetwork = this.networks.find((n) => n.id === e.detail.id) ?? null)}
            @wui:export=${(e: CustomEvent<{ id: string }>) => this.onExportOne(e.detail.id)}
            @wui:delete=${(e: CustomEvent<{ id: string }>) => (this.deletingId = e.detail.id)}
          ></am-network-table>`}
    `;
  }

  private renderMissing(): TemplateResult {
    return html`<div class="center empty">
      <ix-typography>${localizeDir(MSG.page.missing)}</ix-typography>
      <ix-button variant="secondary" @click=${this.goToList}>${localizeDir(MSG.page.backToList)}</ix-button>
    </div>`;
  }

  // eslint-disable-next-line max-lines-per-function -- single toolbar + workspace template
  private renderEditor(network: Network): TemplateResult {
    const closed = this.closedMap(network);
    const energy: EnergyState = computeEnergy(network, closed);
    const readout = this.readoutMap(network);
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" @click=${this.goToList}>${localizeDir(MSG.toolbar.backToList)}</ix-button>
        <span class="title">${network.name}</span>
        <span class="grow"></span>
        ${this.editing
          ? html`
              <ix-button variant="secondary" @click=${() => this.addMeasurement(network)}>
                <ix-icon name="add-circle" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.addMeasurement)}
              </ix-button>
            `
          : nothing}
        <div class="zoom">
          <ix-icon-button ghost size="16" icon="minus" title=${localize(MSG.toolbar.zoomOut)} @click=${() => this.setZoom(this.zoom - ZOOM_STEP)}></ix-icon-button>
          <button class="zoom-val" type="button" title=${localize(MSG.toolbar.zoomReset)} @click=${() => this.setZoom(1)}>${Math.round(this.zoom * 100)}%</button>
          <ix-icon-button ghost size="16" icon="plus" title=${localize(MSG.toolbar.zoomIn)} @click=${() => this.setZoom(this.zoom + ZOOM_STEP)}></ix-icon-button>
        </div>
        <wui-ampere-ai-assistant
          .contextSummary=${this.contextSummary(network)}
          @wui:applynetwork=${(e: CustomEvent<Network>) => this.onApplyNetwork(network, e.detail)}
        ></wui-ampere-ai-assistant>
        ${this.editing
          ? html`<ix-button @click=${() => this.setEditing(false)}><ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.done)}</ix-button>`
          : html`<ix-button variant="secondary" @click=${() => this.setEditing(true)}><ix-icon name="pen" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.edit)}</ix-button>`}
      </div>
      <div class="workspace ${this.editing ? 'editing' : ''}">
        ${this.editing ? html`<am-toolbox .tool=${this.tool} @wui:tool=${(e: CustomEvent<{ tool: Tool }>) => (this.tool = e.detail.tool)}></am-toolbox>` : nothing}
        <am-canvas
          class="canvas"
          .network=${network}
          ?editing=${this.editing}
          .tool=${this.tool}
          .zoom=${this.zoom}
          .energy=${energy}
          .closed=${closed}
          .readout=${readout}
          .selection=${this.selection}
          @wui:place=${(e: CustomEvent<{ symbol: SymbolId; x: number; y: number }>) => this.onPlace(network, e.detail)}
          @wui:move=${(e: CustomEvent<{ id: string; x: number; y: number }>) => this.onMoveNode(network, e.detail)}
          @wui:move-meas=${(e: CustomEvent<{ id: string; x: number; y: number }>) => this.onMoveMeas(network, e.detail)}
          @wui:connect=${(e: CustomEvent<{ from: PortRef; to: PortRef }>) => this.onConnect(network, e.detail)}
          @wui:select=${(e: CustomEvent<Selection | null>) => (this.selection = e.detail)}
          @wui:delete=${(e: CustomEvent<Selection>) => this.onDelete(network, e.detail)}
        ></am-canvas>
        ${this.editing
          ? html`<am-inspector
              .network=${network}
              .selection=${this.selection}
              @wui:update-node=${(e: CustomEvent<{ id: string; patch: Partial<Node> }>) => this.onUpdateNode(network, e.detail)}
              @wui:update-meas=${(e: CustomEvent<{ id: string; patch: Partial<Measurement> }>) => this.onUpdateMeas(network, e.detail)}
              @wui:rotate=${(e: CustomEvent<{ id: string }>) => this.onRotate(network, e.detail.id)}
              @wui:delete=${(e: CustomEvent<Selection>) => this.onDelete(network, e.detail)}
            ></am-inspector>`
          : nothing}
      </div>
    `;
  }

  // --- live data -------------------------------------------------------------

  /** DP elements the current network needs live (switchgear states + measurements). */
  private liveDps(network: Network | undefined): string[] {
    if (!network) return [];
    const set = new Set<string>();
    for (const n of network.nodes) if (isSwitchgear(n.symbol) && n.dp.trim()) set.add(n.dp.trim());
    for (const m of network.measurements) if (m.dp.trim()) set.add(m.dp.trim());
    return [...set];
  }

  /** (Re)subscribe when the set of needed DPs changes. */
  private syncSubscription(): void {
    const dps = this.liveDps(this.selectedNetwork());
    const key = dps.slice().sort().join('|');
    if (key === this.subscribedKey) return;
    this.subscribedKey = key;
    this.dpSub.unsubscribe();
    this.dpSub = new Subscription();
    if (!this.api || dps.length === 0) {
      this.live = new Map();
      return;
    }
    try {
      this.dpSub = this.api.dpConnect(dps, true).subscribe({
        next: (e: { dp: string[]; value: unknown[] }) => this.onLive(e),
        error: () => undefined
      });
    } catch {
      // dpConnect failed (e.g. an unbound DP) — values stay at their last known.
    }
  }

  private onLive(e: { dp: string[]; value: unknown[] }): void {
    const next = new Map(this.live);
    e.dp.forEach((dp, i) => {
      const raw = e.value[i];
      const v = typeof raw === 'number' || typeof raw === 'string' ? raw : Number(raw);
      next.set(normDp(dp), v as number | string);
    });
    this.live = next;
  }

  /** Map of switchgear node id → closed (undefined when unbound / no live value). */
  private closedMap(network: Network): Map<string, boolean> {
    const map = new Map<string, boolean>();
    for (const n of network.nodes) {
      if (!isSwitchgear(n.symbol) || !n.dp.trim()) continue;
      const v = this.live.get(normDp(n.dp));
      if (v !== undefined) map.set(n.id, Number(v) === n.closedValue);
    }
    return map;
  }

  /** Map of measurement id → formatted live readout. */
  private readoutMap(network: Network): Map<string, string> {
    const map = new Map<string, string>();
    for (const m of network.measurements) {
      const v = m.dp.trim() ? this.live.get(normDp(m.dp)) : undefined;
      if (v === undefined) {
        map.set(m.id, '—');
        continue;
      }
      const n = Number(v);
      map.set(m.id, Number.isFinite(n) ? n.toFixed(m.decimals) : String(v));
    }
    return map;
  }

  // --- editing operations ----------------------------------------------------

  private setEditing(on: boolean): void {
    this.editing = on;
    if (!on) {
      this.selection = null;
      this.tool = 'select';
    }
  }

  private setZoom(z: number): void {
    this.zoom = Math.min(Math.max(Math.round(z * 100) / 100, ZOOM_MIN), ZOOM_MAX);
  }

  private onPlace(network: Network, detail: { symbol: SymbolId; x: number; y: number }): void {
    const node: Node = {
      id: uid('n'),
      symbol: detail.symbol,
      label: '',
      x: detail.x,
      y: detail.y,
      rotation: 0,
      dp: '',
      closedValue: 1,
      source: false
    };
    void this.persist({ ...network, nodes: [...network.nodes, node] });
  }

  private onMoveNode(network: Network, detail: { id: string; x: number; y: number }): void {
    const nodes = network.nodes.map((n) => (n.id === detail.id ? { ...n, x: detail.x, y: detail.y } : n));
    void this.persist({ ...network, nodes });
  }

  private onMoveMeas(network: Network, detail: { id: string; x: number; y: number }): void {
    const measurements = network.measurements.map((m) => (m.id === detail.id ? { ...m, x: detail.x, y: detail.y } : m));
    void this.persist({ ...network, measurements });
  }

  private onConnect(network: Network, detail: { from: PortRef; to: PortRef }): void {
    const exists = network.edges.some(
      (e) =>
        (samePort(e.from, detail.from) && samePort(e.to, detail.to)) ||
        (samePort(e.from, detail.to) && samePort(e.to, detail.from))
    );
    if (exists) return;
    const edge = { id: uid('e'), from: detail.from, to: detail.to };
    void this.persist({ ...network, edges: [...network.edges, edge] });
  }

  private onUpdateNode(network: Network, detail: { id: string; patch: Partial<Node> }): void {
    const nodes = network.nodes.map((n) => (n.id === detail.id ? { ...n, ...detail.patch } : n));
    void this.persist({ ...network, nodes });
  }

  private onUpdateMeas(network: Network, detail: { id: string; patch: Partial<Measurement> }): void {
    const measurements = network.measurements.map((m) => (m.id === detail.id ? { ...m, ...detail.patch } : m));
    void this.persist({ ...network, measurements });
  }

  private onRotate(network: Network, id: string): void {
    const nodes = network.nodes.map((n) => (n.id === id ? { ...n, rotation: ((n.rotation + 90) % 360) as Rotation } : n));
    void this.persist({ ...network, nodes });
  }

  private addMeasurement(network: Network): void {
    const meas: Measurement = { ...blankMeasurement(), id: uid('m'), x: PLACE_OFFSET, y: PLACE_OFFSET };
    this.selection = { kind: 'measurement', id: meas.id };
    void this.persist({ ...network, measurements: [...network.measurements, meas] });
  }

  private onDelete(network: Network, sel: Selection): void {
    let next = network;
    if (sel.kind === 'node') {
      const byId = new Map(network.nodes.map((n) => [n.id, n]));
      // Detach anchored measurements (keep them, at their last world position).
      const measurements = network.measurements.map((m) => {
        if (m.nodeId !== sel.id) return m;
        const pos = measurementPos(m, byId);
        return { ...m, nodeId: '', x: pos.x, y: pos.y };
      });
      next = {
        ...network,
        nodes: network.nodes.filter((n) => n.id !== sel.id),
        edges: network.edges.filter((e) => e.from.nodeId !== sel.id && e.to.nodeId !== sel.id),
        measurements
      };
    } else if (sel.kind === 'edge') {
      next = { ...network, edges: network.edges.filter((e) => e.id !== sel.id) };
    } else {
      next = { ...network, measurements: network.measurements.filter((m) => m.id !== sel.id) };
    }
    this.selection = null;
    void this.persist(next);
  }

  private onApplyNetwork(current: Network, proposal: Network): void {
    // Keep identity/name; replace the drawn content with the AI proposal.
    const merged: Network = {
      ...current,
      description: proposal.description || current.description,
      nodes: proposal.nodes,
      edges: proposal.edges,
      measurements: proposal.measurements
    };
    this.selection = null;
    this.editing = true;
    void this.persist(merged);
  }

  /** Short textual summary of the diagram, injected into the AI system prompt. */
  private contextSummary(network: Network): string {
    if (network.nodes.length === 0) return '';
    const parts = network.nodes.slice(0, 12).map((n) => `${n.symbol}${n.label ? `(${n.label})` : ''}`);
    return `${network.nodes.length} symboles, ${network.edges.length} fils. Contient : ${parts.join(', ')}.`;
  }

  // --- data flow -------------------------------------------------------------

  private async refresh(): Promise<void> {
    this.loading = true;
    this.networks = await this.store.listNetworks();
    this.offline = this.store.offline;
    this.loading = false;
  }

  private selectedNetwork(): Network | undefined {
    return this.networkId ? this.networks.find((n) => n.id === this.networkId) : undefined;
  }

  private navigate(id: string): void {
    this.dispatchEvent(new RouterEvent(`/ampere/${id}`));
  }

  private goToList(): void {
    this.dispatchEvent(new RouterEvent('/ampere'));
  }

  private async persist(network: Network): Promise<void> {
    const stamped: Network = { ...network, updatedAt: nowLocal() };
    this.networks = this.networks.map((n) => (n.id === stamped.id ? stamped : n));
    await this.store.saveNetwork(stamped);
    this.offline = this.store.offline;
  }

  private async onNetworkSave(event: CustomEvent<Network>): Promise<void> {
    const incoming = event.detail;
    if (this.editingNetwork) {
      const updated: Network = { ...this.editingNetwork, name: incoming.name, description: incoming.description };
      this.editingNetwork = undefined;
      await this.persist(updated);
    } else {
      const created = await this.store.createNetwork({ ...blankNetwork(), ...incoming, updatedAt: nowLocal() });
      this.networks = [...this.networks, created];
      this.offline = this.store.offline;
      this.editingNetwork = undefined;
      this.editing = true;
      this.navigate(created.id);
    }
  }

  private async onDeleteConfirm(): Promise<void> {
    const id = this.deletingId;
    if (!id) return;
    await this.store.deleteNetwork(id);
    this.networks = this.networks.filter((n) => n.id !== id);
    this.deletingId = null;
    this.offline = this.store.offline;
    if (this.networkId === id) this.goToList();
  }

  private async generateDemo(): Promise<void> {
    this.loading = true;
    const created = await this.store.importDemo(DEMO_NETWORKS);
    this.networks = this.offline ? await this.store.listNetworks() : [...this.networks, ...created];
    this.offline = this.store.offline;
    this.loading = false;
  }

  private onExportOne(id: string): void {
    const network = this.networks.find((n) => n.id === id);
    if (network) exportNetwork(network);
  }

  private triggerImport(): void {
    this.importError = '';
    const input = this.renderRoot.querySelector<HTMLInputElement>('.import-input');
    if (input) {
      input.value = '';
      input.click();
    }
  }

  private async onImportFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    let parsed: Network[];
    try {
      parsed = parseNetworks(await file.text());
    } catch (error) {
      this.importError = error instanceof Error ? error.message : localize(MSG.page.importFailed);
      return;
    }
    this.importError = '';
    const byId = new Map(this.networks.map((n) => [n.id, n]));
    for (const incoming of parsed) {
      if (incoming.id && byId.has(incoming.id)) {
        const updated: Network = { ...incoming, updatedAt: nowLocal() };
        await this.store.saveNetwork(updated);
        byId.set(updated.id, updated);
      } else {
        const created = await this.store.createNetwork({ ...incoming, updatedAt: nowLocal() });
        byId.set(created.id, created);
      }
    }
    this.networks = [...byId.values()];
    this.offline = this.store.offline;
  }

  private networkName(id: string): string {
    return this.networks.find((n) => n.id === id)?.name || id;
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

function samePort(a: PortRef, b: PortRef): boolean {
  return a.nodeId === b.nodeId && a.port === b.port;
}

if (!customElements.get('wui-ampere')) {
  customElements.define('wui-ampere', WuiAmpere);
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
      overflow: hidden;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0;
    }
    .toolbar .grow {
      flex: 1;
    }
    .toolbar .title {
      font-weight: 600;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.9rem;
    }
    .zoom {
      display: flex;
      align-items: center;
      gap: 0.2rem;
    }
    .zoom-val {
      min-width: 3.2rem;
      padding: 0.2rem 0.3rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
    }
    .workspace {
      flex: 1;
      min-height: 0;
      display: grid;
      grid-template-columns: 1fr;
    }
    .workspace.editing {
      grid-template-columns: 210px 1fr 260px;
      gap: 0.6rem;
    }
    am-network-table {
      flex: 1;
      min-height: 0;
    }
    .canvas {
      min-width: 0;
      min-height: 0;
    }
    .notice {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0.75rem;
      margin-bottom: 0.5rem;
      border: 1px solid var(--theme-color-warning);
      border-radius: var(--theme-default-border-radius);
      color: var(--theme-color-warning);
      background: color-mix(in srgb, var(--theme-color-warning) 12%, transparent);
    }
    .notice.error {
      border-color: var(--theme-color-alarm);
      color: var(--theme-color-alarm);
      background: color-mix(in srgb, var(--theme-color-alarm) 12%, transparent);
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
  `;
}
