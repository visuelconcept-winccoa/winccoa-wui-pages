// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA navigation panel - datapoint-type tree.
 *
 * Renders a lazy tree backed by WuiDpeService:
 *   Level 0: datapoint types        (listTypes)
 *   Level 1: datapoints of a type   (listDatapoints, lazy on expand)
 *   Level 2+: element branches      (getDatapointTypes nested structure)
 *
 * Emits `wui:select` with the chosen datapoint / element path and `wui:dpaction`
 * for datapoint create/rename/delete. (Datapoint *type* creation lives in the
 * "Modèle" tab's wui-para-type-editor, not here.)
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription, catchError, forkJoin, map, of } from 'rxjs';
import { container } from 'tsyringe';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { MSG, localize, localizeDir, navCouldNotLoadTypeMsg, navCouldNotLoadTypesMsg, navExportSelectedMsg } from './i18n.js';

/** Default datapoint-type search pattern. */
const DEFAULT_PATTERN = '*';

/** Left padding (rem) of a tree row at level 0. */
const BASE_INDENT_REM = 0.5;

/** Tree level at which a datapoint's element branches start. */
const ELEMENT_BASE_LEVEL = 2;

/**
 * Configs badged on an element when present (`:_<config>.._type` > 0). The
 * `_type` attribute is the standard existence/kind probe for a config.
 */
const CONFIG_BADGES: { config: string; label: string; title: MultiLangString }[] = [
  { config: '_alert_hdl', label: 'alert', title: MSG.nav.cfgAlertHdl },
  { config: '_archive', label: 'arch', title: MSG.nav.cfgArchive },
  { config: '_address', label: 'addr', title: MSG.nav.cfgAddress },
  { config: '_pv_range', label: 'range', title: MSG.nav.cfgPvRange },
  { config: '_smooth', label: 'smooth', title: MSG.nav.cfgSmooth },
  { config: '_dp_fct', label: 'fct', title: MSG.nav.cfgDpFct },
  { config: '_msg_conv', label: 'conv', title: MSG.nav.cfgMsgConv }
];

/** Nested datapoint-type structure: a scalar type name, or a struct of children. */
type DpStruct = string | { [element: string]: DpStruct };

/** A single tree row. */
interface TreeNode {
  id: string;
  label: string;
  level: number;
  kind: 'type' | 'dp' | 'element';
  expandable: boolean;
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  children: TreeNode[];
  /** Selectable datapoint / element path (dp and element nodes only). */
  dp?: string;
  /** Scalar element type (leaf element nodes only). */
  dataType?: string;
  /** Owning datapoint type (type and dp nodes). */
  typeName?: string;
  /** Cached element structure (type nodes only). */
  struct?: DpStruct;
  /** Labels of configs present on this element (`:_<config>.._type` > 0). */
  configs?: { label: string; title: MultiLangString }[];
  /** Whether config badges of this node's child leaves have been requested. */
  childConfigsLoaded?: boolean;
}

export class WuiParaNav extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        border-right: 1px solid var(--theme-color-soft-bdr);
        background: var(--theme-color-1);
      }
      .toolbar {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        padding: 0.5rem;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
        flex-shrink: 0;
      }
      .row-controls {
        display: flex;
        gap: 0.25rem;
        align-items: center;
      }
      .row-controls ix-input {
        flex: 1;
      }
      .options {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.5rem;
      }
      .internal-toggle {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        color: var(--theme-color-std-text);
      }
      .list {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      .node-row {
        display: flex;
        align-items: center;
        width: 100%;
      }
      .node-row:hover {
        background: var(--theme-color-2);
      }
      .node-row.selected {
        background: var(--theme-color-primary);
        color: var(--theme-color-primary--contrast);
      }
      .node {
        display: flex;
        align-items: center;
        gap: 0.25rem;
        flex: 1;
        min-width: 0;
        padding: 0.25rem 0.5rem;
        border: none;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
        white-space: nowrap;
      }
      .node-actions {
        display: none;
        align-items: center;
        gap: 0.125rem;
        padding-right: 0.375rem;
        flex-shrink: 0;
      }
      .node-row:hover .node-actions {
        display: flex;
      }
      .twisty {
        width: 1rem;
        flex-shrink: 0;
        display: inline-flex;
        justify-content: center;
        color: var(--theme-color-soft-text);
      }
      .label {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .type-name {
        font-weight: 600;
      }
      .badge {
        flex-shrink: 0;
        margin-left: 0.375rem;
        font-size: 0.625rem;
        line-height: 1;
        padding: 0.125rem 0.3125rem;
        border-radius: var(--theme-default-border-radius);
        font-family: monospace;
        white-space: nowrap;
      }
      .type-badge {
        color: var(--theme-color-std-text);
        background: var(--theme-color-3);
        border: 1px solid var(--theme-color-soft-bdr);
      }
      .config-badge {
        margin-left: 0.25rem;
        color: var(--theme-color-dynamic);
        background: var(--theme-color-component-1);
        border: 1px solid var(--theme-color-dynamic);
      }
      .message {
        padding: 0.5rem;
        color: var(--theme-color-soft-text);
      }
      .error {
        color: var(--theme-color-alarm);
      }
      .dpl-sel {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.375rem;
        font-size: 0.75rem;
        color: var(--theme-color-soft-text);
      }
      .export-cb {
        flex-shrink: 0;
        margin: 0 0.125rem 0 0;
        cursor: pointer;
        accent-color: var(--theme-color-primary);
      }
      .export-cb-spacer {
        display: inline-block;
        width: 0.95rem;
        flex-shrink: 0;
      }
    `
  ];

  /** Currently selected datapoint/element path, used to highlight the row. */
  @property({ type: String }) selected: string | null = null;
  /** Bump this (from the parent) to force a reload, e.g. after creating a type. */
  @property({ type: Number }) reloadToken = 0;
  /** Show the DPL export checkboxes/selection (instances tab); off for archive/alarm tabs. */
  @property({ type: Boolean }) showExport = true;

  @state() private pattern = DEFAULT_PATTERN;
  @state() private filter = '';
  @state() private showInternal = false;
  @state() private roots: TreeNode[] = [];
  @state() private loading = false;
  @state() private error = '';
  /** Keys (`type:<name>` / `dp:<name>`) checked for DPL export. */
  @state() private exportSel = new Set<string>();

  private readonly dpeService = container.resolve<WuiDpeService>(WuiDpeService);
  private readonly api = container.resolve<OaRxJsApi>(OaRxJsApi);
  private subs = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.loadTypes();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subs.unsubscribe();
    this.subs = new Subscription();
  }

  override render(): TemplateResult {
    return html`
      <div class="toolbar">
        <div class="row-controls">
          <ix-input
            .value=${this.pattern}
            placeholder="${DEFAULT_PATTERN}"
            @valueChange=${(e: Event) => (this.pattern = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => e.key === 'Enter' && this.loadTypes()}
          ></ix-input>
          <ix-icon-button icon="refresh" variant="secondary" title=${localize(MSG.nav.reload)} @click=${this.loadTypes}></ix-icon-button>
        </div>
        <ix-input
          .value=${this.filter}
          placeholder=${localize(MSG.nav.filterTypes)}
          @valueChange=${(e: Event) => (this.filter = (e.target as HTMLInputElement).value)}
        ></ix-input>
        <div class="options">
          <label class="internal-toggle">
            <ix-toggle
              .checked=${this.showInternal}
              @checkedChange=${this.onToggleInternal}
            ></ix-toggle>
            ${localizeDir(MSG.nav.showInternal)}
          </label>
        </div>
        ${this.showExport && this.exportSel.size > 0
          ? html`<div class="dpl-sel">
              <span>${navExportSelectedMsg(this.exportSel.size)}</span>
              <ix-icon-button ghost size="16" icon="close" title=${localize(MSG.nav.deselectAll)} @click=${this.clearExport}></ix-icon-button>
            </div>`
          : ''}
      </div>
      <div class="list">${this.renderTree()}</div>
    `;
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('reloadToken') && changed.get('reloadToken') !== undefined) {
      this.loadTypes();
    }
  }

  private renderTree(): TemplateResult {
    if (this.loading) {
      return html`<div class="message">${localizeDir(MSG.nav.loading)}</div>`;
    }
    if (this.error !== '') {
      return html`<div class="message error">${this.error}</div>`;
    }
    const visible = this.visibleRoots();
    if (visible.length === 0) {
      return html`<div class="message">${localizeDir(MSG.nav.noMatch)}</div>`;
    }
    return html`${visible.flatMap((node) => this.renderNode(node))}`;
  }

  private renderNode(node: TreeNode): TemplateResult[] {
    const rows: TemplateResult[] = [this.renderRow(node)];
    if (node.expanded) {
      for (const child of node.children) {
        rows.push(...this.renderNode(child));
      }
    }
    return rows;
  }

  private renderRow(node: TreeNode): TemplateResult {
    const isSelected = this.nodeKey(node) === this.selected;
    return html`
      <div class="node-row ${isSelected ? 'selected' : ''}" style="padding-left: ${BASE_INDENT_REM + node.level}rem">
        ${this.showExport && (node.kind === 'type' || node.kind === 'dp')
          ? html`<input
              type="checkbox"
              class="export-cb"
              .checked=${this.exportSel.has(this.exportKey(node))}
              title=${localize(MSG.nav.selectForExport)}
              @click=${(e: Event) => e.stopPropagation()}
              @change=${() => this.toggleExport(node)}
            />`
          : html`<span class="export-cb-spacer"></span>`}
        <button class="node" title="${node.dp ?? node.label}" @click=${() => this.onRowClick(node)}>
          <span class="twisty">${this.renderTwisty(node)}</span>
          <span class="label ${node.kind === 'type' ? 'type-name' : ''}">${node.label}</span>
          ${node.dataType
            ? html`<span class="badge type-badge" title="${localize(MSG.nav.dataType)}: ${node.dataType}">${node.dataType}</span>`
            : ''}
          ${(node.configs ?? []).map(
            (cfg) => html`<span class="badge config-badge" title=${localize(cfg.title)}>${cfg.label}</span>`
          )}
        </button>
        ${this.renderActions(node)}
      </div>
    `;
  }

  private renderActions(node: TreeNode): TemplateResult | string {
    if (node.kind === 'type') {
      return html`
        <span class="node-actions">
          <ix-icon-button
            icon="plus"
            size="16"
            ghost
            title=${localize(MSG.nav.createDp)}
            @click=${(e: Event) => this.requestDp(e, 'create', node)}
          ></ix-icon-button>
        </span>
      `;
    }
    if (node.kind === 'dp') {
      return html`
        <span class="node-actions">
          <ix-icon-button
            icon="pen"
            size="16"
            ghost
            title=${localize(MSG.nav.renameDp)}
            @click=${(e: Event) => this.requestDp(e, 'rename', node)}
          ></ix-icon-button>
          <ix-icon-button
            icon="trashcan"
            size="16"
            ghost
            title=${localize(MSG.nav.deleteDp)}
            @click=${(e: Event) => this.requestDp(e, 'delete', node)}
          ></ix-icon-button>
        </span>
      `;
    }
    return '';
  }

  private requestDp(event: Event, mode: 'create' | 'rename' | 'delete', node: TreeNode): void {
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('wui:dpaction', {
        detail: { mode, typeName: node.typeName ?? '', dp: node.dp ?? '' },
        bubbles: true,
        composed: true
      })
    );
  }

  private renderTwisty(node: TreeNode): TemplateResult | string {
    if (node.loading) {
      return html`<ix-spinner size="xs"></ix-spinner>`;
    }
    if (!node.expandable) {
      return '';
    }
    const icon = node.expanded ? 'chevron-down-small' : 'chevron-right-small';
    return html`<ix-icon name="${icon}" size="16"></ix-icon>`;
  }

  private visibleRoots(): TreeNode[] {
    const needle = this.filter.trim().toLowerCase();
    if (needle === '') {
      return this.roots;
    }
    return this.roots.filter((node) => node.label.toLowerCase().includes(needle));
  }

  private onToggleInternal(event: Event): void {
    this.showInternal = (event.target as HTMLInputElement).checked;
    this.loadTypes();
  }

  /** Export-selection key for a checkable node (`type:<name>` / `dp:<name>`). */
  private exportKey(node: TreeNode): string {
    return node.kind === 'type' ? `type:${node.typeName ?? ''}` : `dp:${node.dp ?? ''}`;
  }

  private toggleExport(node: TreeNode): void {
    const key = this.exportKey(node);
    const next = new Set(this.exportSel);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.exportSel = next;
    this.emitExportSelection();
  }

  private clearExport(): void {
    this.exportSel = new Set();
    this.emitExportSelection();
  }

  /** Report the export selection ({dpts, dps}) to the page — the DPL Import/Export buttons live in the header. */
  private emitExportSelection(): void {
    const dps: string[] = [];
    const dpts: string[] = [];
    for (const key of this.exportSel) {
      if (key.startsWith('type:')) {
        dpts.push(key.slice('type:'.length));
      } else if (key.startsWith('dp:')) {
        dps.push(key.slice('dp:'.length));
      }
    }
    this.dispatchEvent(
      new CustomEvent('wui:exportselection', { detail: { dpts, dps }, bubbles: true, composed: true })
    );
  }

  private loadTypes(): void {
    this.loading = true;
    this.error = '';
    const pattern = this.pattern.trim() === '' ? DEFAULT_PATTERN : this.pattern.trim();
    // excludeEmpty:false so DP-types with NO instance are listed too — needed to
    // create the first datapoint of a type from its "+" action. (WuiDpeService.listTypes
    // hardcodes excludeEmpty:true, which would hide instance-less types.)
    this.subs.add(
      this.api
        .customCommand<string[]>('etm.model.type.list', {
          pattern,
          internal: this.showInternal,
          typeMatchSubTree: false,
          excludeEmpty: false
        })
        .subscribe({
          next: (types) => {
            this.roots = [...(types ?? [])]
              .sort((a, b) => a.localeCompare(b))
              .map((name) => this.makeTypeNode(name));
            this.loading = false;
          },
          error: (err: unknown) => {
            this.error = navCouldNotLoadTypesMsg(String(err));
            this.roots = [];
            this.loading = false;
          }
        })
    );
  }

  private makeTypeNode(name: string): TreeNode {
    return {
      id: `type:${name}`,
      label: name,
      level: 0,
      kind: 'type',
      expandable: true,
      expanded: false,
      loading: false,
      loaded: false,
      children: [],
      typeName: name
    };
  }

  private onRowClick(node: TreeNode): void {
    const path = node.kind === 'type' ? node.typeName : node.dp;
    if (path != null) {
      this.dispatchEvent(
        new CustomEvent('wui:select', {
          detail: { kind: node.kind, path, type: node.typeName ?? '' },
          bubbles: true,
          composed: true
        })
      );
    }
    if (node.expandable) {
      this.toggle(node);
    }
  }

  private nodeKey(node: TreeNode): string {
    return node.kind === 'type' ? `type:${node.typeName}` : `path:${node.dp ?? ''}`;
  }

  private toggle(node: TreeNode): void {
    if (node.expanded) {
      node.expanded = false;
      this.requestUpdate();
      return;
    }
    node.expanded = true;
    if (node.loaded) {
      this.loadChildConfigBadges(node);
      this.requestUpdate();
      return;
    }
    if (node.kind === 'type') {
      this.loadTypeChildren(node);
    } else {
      this.requestUpdate();
    }
  }

  /**
   * On first expansion, probe `:_<config>.._type` for each leaf child and badge
   * the configs that exist. Deferred to expansion so the tree stays cheap.
   */
  private loadChildConfigBadges(node: TreeNode): void {
    if (node.childConfigsLoaded) {
      return;
    }
    node.childConfigsLoaded = true;
    // Value leaves (scalar DPs and leaf elements) have a path and no children;
    // struct branches are skipped - configs live on the leaf DPEs.
    const leaves = node.children.filter((child) => child.dp != null && child.children.length === 0);
    for (const leaf of leaves) {
      // A scalar DP root must be addressed with a trailing dot (e.g. `Counter.`);
      // leaf elements already carry their element part.
      const dpe = leaf.kind === 'dp' ? `${leaf.dp as string}.` : (leaf.dp as string);
      // Probe each config on its own: a dpGet over an array fails as a whole if
      // one config is absent, which would drop every badge for the element.
      const probes = CONFIG_BADGES.map((badge) =>
        this.api.dpGet(`${dpe}:${badge.config}.._type`).pipe(
          map((data) => Number(Array.isArray(data) ? data[0] : data) > 0),
          catchError(() => of(false))
        )
      );
      this.subs.add(
        forkJoin(probes).subscribe((present) => {
          leaf.configs = CONFIG_BADGES.filter((_badge, index) => present[index]).map((badge) => ({
            label: badge.label,
            title: badge.title
          }));
          this.requestUpdate();
        })
      );
    }
  }

  private loadTypeChildren(node: TreeNode): void {
    node.loading = true;
    this.requestUpdate();
    const typeName = node.typeName as string;
    this.subs.add(
      forkJoin({
        dps: this.dpeService.listDatapoints(typeName),
        struct: this.dpeService.getDatapointTypes(typeName)
      }).subscribe({
        next: ({ dps, struct }) => {
          node.struct = struct as DpStruct;
          node.children = this.makeDpNodes(dps, node);
          node.loaded = true;
          node.loading = false;
          this.loadChildConfigBadges(node);
          this.requestUpdate();
        },
        error: (err: unknown) => {
          node.loading = false;
          node.expanded = false;
          this.error = navCouldNotLoadTypeMsg(typeName, String(err));
          this.requestUpdate();
        }
      })
    );
  }

  private makeDpNodes(dps: string[], typeNode: TreeNode): TreeNode[] {
    const filtered = this.showInternal ? dps : dps.filter((dp) => !this.isInternal(dp));
    // A scalar type's struct is the type name string; a struct type is an object.
    const scalarType = typeof typeNode.struct === 'string' ? typeNode.struct : null;
    return [...filtered]
      .sort((a, b) => a.localeCompare(b))
      .map((dp) => {
        const elements = this.buildElementNodes(typeNode.struct, dp, ELEMENT_BASE_LEVEL, typeNode.typeName);
        return {
          id: `dp:${dp}`,
          label: this.shortName(dp),
          level: 1,
          kind: 'dp' as const,
          expandable: elements.length > 0,
          expanded: false,
          loading: false,
          loaded: true,
          children: elements,
          dp,
          typeName: typeNode.typeName,
          dataType: scalarType ?? 'struct'
        };
      });
  }

  private buildElementNodes(
    struct: DpStruct | undefined,
    parentPath: string,
    level: number,
    typeName: string | undefined
  ): TreeNode[] {
    if (struct == null || typeof struct === 'string') {
      return [];
    }
    return Object.entries(struct).map(([key, value]) => {
      const path = `${parentPath}.${key}`;
      const children = this.buildElementNodes(value, path, level + 1, typeName);
      const isLeaf = typeof value === 'string';
      return {
        id: `el:${path}`,
        label: key,
        level,
        kind: 'element' as const,
        expandable: children.length > 0,
        expanded: false,
        loading: false,
        loaded: true,
        children,
        dp: path,
        typeName,
        dataType: isLeaf ? value : 'struct'
      };
    });
  }

  private isInternal(name: string): boolean {
    const local = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
    return local.startsWith('_');
  }

  private shortName(dp: string): string {
    return dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
  }
}

if (!customElements.get('wui-para-nav')) {
  customElements.define('wui-para-nav', WuiParaNav);
}
