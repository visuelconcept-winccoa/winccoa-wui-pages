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
import { hasRole$, registerModuleRoles, type AppModuleRoles } from '@visuelconcept/wui-kit/data/app-security.js';
import appSecurityRoles from './app-security.roles.json';
import { AmpereStore } from './ampere/data/ampere-store.js';
import { demoNetworks } from './ampere/data/demo.js';
import { SNIPPETS, instantiateSnippet, type SnippetId } from './ampere/data/snippets.js';
import { exportJson, exportNetwork, parseNetworks } from './ampere/data/io.js';
import { autoLayout } from './ampere/layout.js';
import { computeEnergy, type EnergyState } from './ampere/topology.js';
import { SYMBOLS, isSwitchgear, type SymbolId } from './ampere/symbols/catalog.js';
import {
  CANVAS_H,
  CANVAS_W,
  blankMeasurement,
  blankNetwork,
  clamp,
  measurementPos,
  snap,
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
  if (cfg !== -1) s = s.slice(0, cfg);
  return s.toLowerCase();
}

/** Subscribable DPE name: a bare DP (no element part) needs a trailing dot. */
function dpeName(dp: string): string {
  const v = dp.trim();
  return v.includes('.') ? v : `${v}.`;
}

/**
 * Chromeless embedded mode (e.g. a Mosaic tile): the `embed=1` flag travels
 * INSIDE the hash, after the route (`…#/ampere/x?embed=1`) — same contract as
 * the app shell's own chrome hiding. Latched once at module load (the SPA
 * router may rewrite the URL later) with a live re-check as fallback.
 */
const EMBEDDED_AT_LOAD = /[?&]embed=1/.test(globalThis.location?.hash ?? '') || /[?&]embed=1/.test(globalThis.location?.search ?? '');
function isEmbedded(): boolean {
  return EMBEDDED_AT_LOAD || /[?&]embed=1/.test(globalThis.location?.hash ?? '');
}

/**
 * Coerce a live emission into a comparable/displayable primitive: unwrap a
 * `{value}` envelope, map booleans (and 'true'/'false' strings — e.g. a bool
 * DPE serialised as text) to 1/0 so `closedValue` comparisons keep working.
 */
function liveValue(raw: unknown): number | string {
  const v = raw && typeof raw === 'object' && 'value' in raw ? (raw as { value: unknown }).value : raw;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true') return 1;
    if (t === 'false') return 0;
    return v;
  }
  return typeof v === 'number' ? v : Number(v);
}

/**
 * Map a WinCC OA colour value (`_act_state_color`) to CSS: `{r,g,b}` /
 * `{r,g,b,a}` tuples and `#hex` pass through; a named colour-DB entry cannot be
 * resolved in the browser, so it falls back to the theme alarm colour. Empty ⇒
 * no alarm (returns '').
 */
function oaColorToCss(raw: string): string {
  const v = raw.trim();
  if (!v) return '';
  const rgb = /^\{(\d+),(\d+),(\d+)(?:,(\d+))?\}$/.exec(v);
  if (rgb) {
    return rgb[4] === undefined
      ? `rgb(${rgb[1]},${rgb[2]},${rgb[3]})`
      : `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${Number(rgb[4]) / 255})`;
  }
  if (/^#[\da-f]{3,8}$/i.test(v)) return v;
  return 'var(--theme-color-alarm, #ff2640)';
}

/** Group-move commit payload from the canvas (grid-snapped delta + moved ids). */
interface MoveMulti {
  dx: number;
  dy: number;
  nodes: string[];
  measurements: string[];
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
  @state() private selection: Selection[] = [];
  @state() private editingNetwork: Network | null | undefined = undefined;
  @state() private deletingId: string | null = null;
  @state() private importError = '';

  /** Live DP values keyed by normalised name. */
  @state() private live: Map<string, number | string> = new Map();

  /** Live alert-state colours (`_alert_hdl.._act_state_color`) keyed by normalised DP. */
  @state() private alertColors: Map<string, string> = new Map();

  /** Application-Security grant for the 'edit' role (open until assigned). */
  @state() private canEdit = true;

  private readonly store = new AmpereStore();
  private readonly api = this.resolveApi();
  private dpSub = new Subscription();
  private roleSub = new Subscription();
  private subscribedKey = '';
  /** Network state captured when entering edit mode — audit baseline for the "Done" trace. */
  private auditBaseline: Network | null = null;

  override render(): TemplateResult {
    if (isEmbedded()) return this.renderEmbedded();
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

  override connectedCallback(): void {
    super.connectedCallback();
    registerModuleRoles(appSecurityRoles as AppModuleRoles);
    this.roleSub = hasRole$('ampere', 'edit').subscribe((granted) => {
      this.canEdit = granted;
      if (!granted && this.editing) this.setEditing(false);
    });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.dpSub.unsubscribe();
    this.roleSub.unsubscribe();
  }

  protected override firstUpdated(): void {
    void this.refresh();
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('networkId') && !this.networkId) {
      this.editing = false;
      this.selection = [];
    }
  }

  protected override updated(): void {
    this.syncSubscription();
  }

  // --- body ------------------------------------------------------------------

  /**
   * Chromeless embedded rendering (Mosaic tile): no header, no toolbar, no
   * notices — just the live diagram stretched to the host box (display mode).
   */
  private renderEmbedded(): TemplateResult {
    if (this.loading) return html`<div class="center"><ix-spinner></ix-spinner></div>`;
    const network = this.selectedNetwork();
    if (!network) return html`<div class="center empty"><ix-typography>${localizeDir(MSG.page.missing)}</ix-typography></div>`;
    return html`
      <am-canvas
        class="embedded"
        fit
        .network=${network}
        .energy=${computeEnergy(network, this.closedMap(network))}
        .closed=${this.closedMap(network)}
        .readout=${this.readoutMap(network)}
        .alarm=${this.alarmMap(network)}
      ></am-canvas>
    `;
  }

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
              <ix-button variant="secondary" title=${localize(MSG.toolbar.autoArrangeHint)} @click=${() => void this.persist(autoLayout(network))}>
                <ix-icon name="hierarchy" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.autoArrange)}
              </ix-button>
            `
          : nothing}
        ${this.editing
          ? html`<div class="zoom">
              <ix-icon-button ghost size="16" icon="minus" title=${localize(MSG.toolbar.zoomOut)} @click=${() => this.setZoom(this.zoom - ZOOM_STEP)}></ix-icon-button>
              <button class="zoom-val" type="button" title=${localize(MSG.toolbar.zoomReset)} @click=${() => this.setZoom(1)}>${Math.round(this.zoom * 100)}%</button>
              <ix-icon-button ghost size="16" icon="plus" title=${localize(MSG.toolbar.zoomIn)} @click=${() => this.setZoom(this.zoom + ZOOM_STEP)}></ix-icon-button>
            </div>`
          : nothing}
        <wui-ampere-ai-assistant
          .contextSummary=${this.contextSummary(network)}
          @wui:applynetwork=${(e: CustomEvent<Network>) => this.onApplyNetwork(network, e.detail)}
        ></wui-ampere-ai-assistant>
        ${this.editing
          ? html`<ix-button @click=${() => this.setEditing(false)}><ix-icon name="check" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.done)}</ix-button>`
          : (this.canEdit
              ? html`<ix-button variant="secondary" @click=${() => this.setEditing(true)}><ix-icon name="pen" slot="icon"></ix-icon>${localizeDir(MSG.toolbar.edit)}</ix-button>`
              : nothing)}
      </div>
      <div class="workspace ${this.editing ? 'editing' : ''}">
        ${this.editing ? html`<am-toolbox .tool=${this.tool} @wui:tool=${(e: CustomEvent<{ tool: Tool }>) => (this.tool = e.detail.tool)}></am-toolbox>` : nothing}
        <am-canvas
          class="canvas"
          .network=${network}
          ?editing=${this.editing}
          ?fit=${!this.editing}
          .tool=${this.tool}
          .zoom=${this.zoom}
          .energy=${energy}
          .closed=${closed}
          .readout=${readout}
          .alarm=${this.alarmMap(network)}
          .selection=${this.selection}
          @wui:place=${(e: CustomEvent<{ symbol: SymbolId; x: number; y: number }>) => this.onPlace(network, e.detail)}
          @wui:place-snippet=${(e: CustomEvent<{ snippet: SnippetId; x: number; y: number }>) => this.onPlaceSnippet(network, e.detail)}
          @wui:move-multi=${(e: CustomEvent<MoveMulti>) => this.onMoveMulti(network, e.detail)}
          @wui:move-label=${(e: CustomEvent<{ id: string; dx: number; dy: number }>) => this.onMoveLabel(network, e.detail)}
          @wui:connect=${(e: CustomEvent<{ from: PortRef; to: PortRef }>) => this.onConnect(network, e.detail)}
          @wui:select=${(e: CustomEvent<Selection[]>) => (this.selection = e.detail ?? [])}
          @wui:delete=${(e: CustomEvent<Selection[]>) => this.onDelete(network, e.detail)}
        ></am-canvas>
        ${this.editing
          ? html`<am-inspector
              .network=${network}
              .selection=${this.selection}
              @wui:update-node=${(e: CustomEvent<{ id: string; patch: Partial<Node> }>) => this.onUpdateNode(network, e.detail)}
              @wui:update-meas=${(e: CustomEvent<{ id: string; patch: Partial<Measurement> }>) => this.onUpdateMeas(network, e.detail)}
              @wui:rotate=${(e: CustomEvent<{ id: string }>) => this.onRotate(network, e.detail.id)}
              @wui:delete=${(e: CustomEvent<Selection[]>) => this.onDelete(network, e.detail)}
            ></am-inspector>`
          : nothing}
      </div>
    `;
  }

  // --- live data -------------------------------------------------------------

  /** Whether a node binds a live state DP: switchgear position, or a source's supply state. */
  private bindsStateDp(n: Node): boolean {
    return (isSwitchgear(n.symbol) || SYMBOLS[n.symbol].role === 'source' || n.source) && n.dp.trim() !== '';
  }

  /** DP elements the current network needs live (switchgear/source states + measurements). */
  private liveDps(network: Network | undefined): string[] {
    if (!network) return [];
    const set = new Set<string>();
    for (const n of network.nodes) if (this.bindsStateDp(n)) set.add(n.dp.trim());
    for (const m of network.measurements) if (m.dp.trim()) set.add(m.dp.trim());
    return [...set];
  }

  /**
   * (Re)subscribe when the set of needed DPs changes — with ONE subscription
   * PER DP. `dpConnect` fails the whole subscription as soon as ANY name in the
   * array is invalid (see the oa-rx-js-api README), so batching all bindings
   * together froze the entire animation on the first typo'd, not-yet-created or
   * demo DP. Isolated subscriptions confine the failure to its own device
   * (which then falls back to "closed") while every other binding stays live.
   */
  private syncSubscription(): void {
    const dps = this.liveDps(this.selectedNetwork());
    const key = [...dps].sort().join('|');
    if (key === this.subscribedKey) return;
    this.subscribedKey = key;
    this.dpSub.unsubscribe();
    this.dpSub = new Subscription();
    this.live = new Map();
    this.alertColors = new Map();
    if (!this.api || dps.length === 0) return;
    for (const dp of dps) {
      this.subscribeOne(dpeName(dp), (raw) => this.onLive(dp, raw));
      // Alarm framing: the bound DPE may carry an _alert_hdl config — follow its
      // active state colour. DPs without the config just error (isolated, ignored).
      this.subscribeOne(`${dpeName(dp)}:_alert_hdl.._act_state_color`, (raw) => this.onAlert(dp, raw));
    }
  }

  /** One isolated dpConnect (a bad name/config must never break the other bindings). */
  private subscribeOne(dpe: string, next: (raw: unknown) => void): void {
    if (!this.api) return;
    try {
      this.dpSub.add(
        this.api.dpConnect(dpe, true).subscribe({
          next: (e: { dp: string[]; value: unknown[] }) => next(e.value?.[0]),
          error: () => {
            // Unknown/unreadable DP or missing config — this binding stays inert; the others stay live.
          }
        })
      );
    } catch {
      // Same as above — never let one bad binding break the rest.
    }
  }

  /** Record one live emission, keyed by the BOUND name (immune to emission-name variants). */
  private onLive(boundDp: string, raw: unknown): void {
    const next = new Map(this.live);
    next.set(normDp(boundDp), liveValue(raw));
    this.live = next;
  }

  /** Record one alert-colour emission (empty colour = alarm gone). */
  private onAlert(boundDp: string, raw: unknown): void {
    const v = liveValue(raw);
    const css = oaColorToCss(typeof v === 'string' ? v : '');
    const next = new Map(this.alertColors);
    if (css) next.set(normDp(boundDp), css);
    else next.delete(normDp(boundDp));
    this.alertColors = next;
  }

  /**
   * Map of node id → closed/powered (absent when unbound / no live value yet):
   * switchgear conduction state, and for sources whether they energise the
   * network (both compare the live value to `closedValue`).
   */
  private closedMap(network: Network): Map<string, boolean> {
    const map = new Map<string, boolean>();
    for (const n of network.nodes) {
      if (!this.bindsStateDp(n)) continue;
      const v = this.live.get(normDp(n.dp));
      if (v !== undefined) map.set(n.id, Number(v) === n.closedValue);
    }
    return map;
  }

  /** Map of node id → alarm frame colour (only nodes whose bound DP is in alarm). */
  private alarmMap(network: Network): Map<string, string> {
    const map = new Map<string, string>();
    for (const n of network.nodes) {
      if (!n.dp.trim()) continue;
      const color = this.alertColors.get(normDp(n.dp));
      if (color) map.set(n.id, color);
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

  /**
   * Enter/leave edit mode. Every in-session persist is audit-SILENT; the whole
   * editing session is traced as ONE audit-trail UPDATE when the user clicks
   * "Done" (diff between the state at edit start and the final state — no
   * change ⇒ no row).
   */
  private setEditing(on: boolean): void {
    this.editing = on;
    if (on) {
      this.auditBaseline = structuredClone(this.selectedNetwork() ?? null);
      return;
    }
    this.selection = [];
    this.tool = 'select';
    const current = this.selectedNetwork();
    const baseline = this.auditBaseline;
    this.auditBaseline = null;
    if (current && baseline && baseline.id === current.id) {
      void this.store.saveNetwork(current, { auditBaseline: baseline });
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
      labelDx: 0,
      labelDy: 0,
      x: detail.x,
      y: detail.y,
      rotation: 0,
      dp: '',
      closedValue: 1,
      source: false
    };
    // Placing arms the select tool again and opens the new symbol's property
    // sheet — so binding/labelling follows immediately, without a manual re-click.
    this.tool = 'select';
    this.selection = [{ kind: 'node', id: node.id }];
    void this.persist({ ...network, nodes: [...network.nodes, node] });
  }

  /** Drop a snippet: insert its cloned nodes/edges and select them for editing. */
  private onPlaceSnippet(network: Network, detail: { snippet: SnippetId; x: number; y: number }): void {
    const def = SNIPPETS[detail.snippet];
    const { nodes, edges } = instantiateSnippet(def, { x: detail.x, y: detail.y });
    this.tool = 'select';
    this.selection = nodes.map((n) => ({ kind: 'node' as const, id: n.id }));
    void this.persist({ ...network, nodes: [...network.nodes, ...nodes], edges: [...network.edges, ...edges] });
  }

  /** Commit a group drag: apply the snapped delta to every moved node/measurement. */
  private onMoveMulti(network: Network, d: MoveMulti): void {
    const nodeIds = new Set(d.nodes);
    const measIds = new Set(d.measurements);
    const nodes = network.nodes.map((n) =>
      nodeIds.has(n.id)
        ? { ...n, x: clamp(snap(n.x + d.dx), 0, CANVAS_W), y: clamp(snap(n.y + d.dy), 0, CANVAS_H) }
        : n
    );
    // A measurement's x/y is absolute when free and node-relative when anchored —
    // a delta is correct for both (the canvas already excludes anchored labels
    // whose node moves too).
    const measurements = network.measurements.map((m) => (measIds.has(m.id) ? { ...m, x: m.x + d.dx, y: m.y + d.dy } : m));
    void this.persist({ ...network, nodes, measurements });
  }

  /** Commit a label drag (offset from the label's default spot under the symbol). */
  private onMoveLabel(network: Network, d: { id: string; dx: number; dy: number }): void {
    const nodes = network.nodes.map((n) => (n.id === d.id ? { ...n, labelDx: d.dx, labelDy: d.dy } : n));
    void this.persist({ ...network, nodes });
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
    this.selection = [{ kind: 'measurement', id: meas.id }];
    void this.persist({ ...network, measurements: [...network.measurements, meas] });
  }

  /** Delete every selected object (nodes cascade their wires; anchored labels detach). */
  private onDelete(network: Network, sels: Selection[]): void {
    if (!sels || sels.length === 0) return;
    const nodeIds = new Set(sels.filter((s) => s.kind === 'node').map((s) => s.id));
    const edgeIds = new Set(sels.filter((s) => s.kind === 'edge').map((s) => s.id));
    const measIds = new Set(sels.filter((s) => s.kind === 'measurement').map((s) => s.id));
    const byId = new Map(network.nodes.map((n) => [n.id, n]));
    // Detach surviving measurements anchored to a deleted node (keep them at their world spot).
    const measurements = network.measurements
      .filter((m) => !measIds.has(m.id))
      .map((m) => {
        if (!m.nodeId || !nodeIds.has(m.nodeId)) return m;
        const pos = measurementPos(m, byId);
        return { ...m, nodeId: '', x: pos.x, y: pos.y };
      });
    const next: Network = {
      ...network,
      nodes: network.nodes.filter((n) => !nodeIds.has(n.id)),
      edges: network.edges.filter((e) => !edgeIds.has(e.id) && !nodeIds.has(e.from.nodeId) && !nodeIds.has(e.to.nodeId)),
      measurements
    };
    this.selection = [];
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
    if (!this.editing) this.setEditing(true); // captures the audit baseline before the apply
    this.selection = [];
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
    // In-session edits save silently; the audit row is written once on "Done"
    // (see setEditing). Out-of-session saves (rename, import) audit normally.
    await this.store.saveNetwork(stamped, this.editing ? { audit: false } : {});
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
    const created = await this.store.importDemo(demoNetworks());
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
    am-canvas.embedded {
      display: block;
      /* Embedded tile (iframe): 100vh = the tile's viewport, regardless of the
         shell outlet's own height chain — the diagram always fills the tile. */
      height: 100vh;
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
