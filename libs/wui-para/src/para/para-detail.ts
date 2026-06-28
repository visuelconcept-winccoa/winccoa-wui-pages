// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA detail / edit panel.
 *
 * For the selected datapoint it discovers all value-bearing elements
 * (OaRxJsApi.dpNames + dpElementType), shows their live values (dpConnect),
 * units and descriptions, and lets the user write new values back (dpSet).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { Subscription, catchError, forkJoin, map, of } from 'rxjs';
import { container } from 'tsyringe';
import './para-config-detail.js';
import { NUMERIC_TYPES, convertDynList, convertItem, formatDynItem, formatStime, isEditableType } from './para-value.js';

/** A datapoint-type structure: a scalar type name, or a struct of children. */
type DpStruct = string | { [element: string]: DpStruct };

/** One value element to display: its full DPE name + its WinCC OA scalar type. */
interface ValueEntry {
  name: string;
  type: string;
}

/** Config attribute that holds the online value of a datapoint element. */
const VALUE_ATTR = ':_original.._value';

/** Config attribute that holds the source time (last modification) of an element. */
const STIME_ATTR = ':_original.._stime';

/** webserver.js PARA extension endpoint that writes DPE values/configs (same origin). */
const DP_SET_URL = '/api/para/dp/set';

/** dpGetDescription mode: full element description. */
const DESCRIPTION_MODE = 2;

/** Upper bound on value rows rendered/subscribed at once (esp. type view). */
const MAX_VALUE_ELEMENTS = 500;

/**
 * dpConnect is issued in chunks of this many DPEs. A single dpConnect over the
 * hundreds of DPEs of a whole-type view (many instances × elements) is rejected
 * by the webserver ("Invalid argument in dpConnectUserData"), and one bad DPE
 * would otherwise fail the entire batch. Chunking keeps the table usable.
 */
const LIVE_CONNECT_CHUNK = 80;

/** Metadata describing one editable/displayable datapoint element. */
interface ElementMeta {
  /** Element name, e.g. `System1:Pump1.state`. */
  name: string;
  /** Name shown in the table (relative to the selection / without system prefix). */
  display: string;
  /** Config-attribute path used for read/write, e.g. `…state:_original.._value`. */
  valuePath: string;
  /** Source-time config-attribute path, e.g. `…state:_original.._stime`. */
  stimePath: string;
  /** WinCC OA element type. */
  type: string;
  unit: string;
  description: string;
  /** True for `dyn_*` types - edited as a multi-line list (one item per line). */
  isDyn: boolean;
  /** Scalar type of each item: the type itself, or `dyn_*` stripped of `dyn_`. */
  baseType: string;
  numeric: boolean;
  isBool: boolean;
  editable: boolean;
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

export class WuiParaDetail extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }
      .header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
        flex-shrink: 0;
      }
      .header .dp-name {
        font-weight: 600;
        word-break: break-all;
      }
      .scroll {
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th,
      td {
        text-align: left;
        padding: 0.375rem 0.5rem;
        border-bottom: 1px solid var(--theme-color-soft-bdr);
        vertical-align: top;
        font-size: 0.875rem;
      }
      th {
        position: sticky;
        top: 0;
        background: var(--theme-color-2);
        z-index: 1;
      }
      td.element {
        font-family: monospace;
        word-break: break-all;
      }
      td.type {
        color: var(--theme-color-soft-text);
        white-space: nowrap;
      }
      td.stime {
        color: var(--theme-color-soft-text);
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
      td.value-cell {
        min-width: 14rem;
      }
      .value-edit {
        display: flex;
        gap: 0.25rem;
        align-items: center;
      }
      .value-edit ix-input,
      .value-edit ix-number-input,
      .value-edit ix-textarea {
        flex: 1;
      }
      .value-edit.dyn {
        align-items: flex-start;
      }
      .readonly-value {
        white-space: pre-wrap;
        font-family: monospace;
        word-break: break-all;
      }
      .message {
        padding: 1rem;
        color: var(--theme-color-soft-text);
      }
      .status {
        padding: 0.375rem 0.75rem;
        font-size: 0.8125rem;
        flex-shrink: 0;
      }
      .status.ok {
        color: var(--theme-color-success);
      }
      .status.error {
        color: var(--theme-color-alarm);
      }
      .element-cell {
        display: flex;
        align-items: flex-start;
        gap: 0.25rem;
      }
      .expander {
        border: none;
        background: transparent;
        color: var(--theme-color-soft-text);
        cursor: pointer;
        padding: 0;
        display: inline-flex;
        align-items: center;
        flex-shrink: 0;
      }
      .expander:hover {
        color: var(--theme-color-std-text);
      }
      tr.detail-row > td {
        background: var(--theme-color-1);
        padding: 0.5rem 0.75rem 0.75rem 2rem;
      }
    `
  ];

  /** Selected datapoint / element path, set by the parent page. */
  @property({ type: String }) dp: string | null = null;
  /** Selected datapoint type (flat view of every value of every DP of the type). */
  @property({ type: String }) dpType: string | null = null;
  /** Owning DP-type of `dp` — required to enumerate its elements from the structure. */
  @property({ type: String }) ownerType: string | null = null;

  @state() private elements: ElementMeta[] = [];
  @state() private loading = false;
  @state() private error = '';
  @state() private status = '';
  @state() private statusOk = false;
  @state() private truncated = false;
  /** Non-fatal notice when some live values couldn't be connected (table still shown). */
  @state() private liveWarning = '';
  /** Live value per element value-path. */
  @state() private liveValues = new Map<string, unknown>();
  /** Pending edits per element value-path (string-encoded). */
  @state() private drafts = new Map<string, string>();
  /** Element names whose config-attribute detail panel is expanded. */
  @state() private expanded = new Set<string>();

  private readonly api = container.resolve<OaRxJsApi>(OaRxJsApi);
  private readonly dpeService = container.resolve<WuiDpeService>(WuiDpeService);
  private detailSubs = new Subscription();
  /** Path prefix stripped from element names for display ('' in type view). */
  private displayBase = '';

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.detailSubs.unsubscribe();
    this.detailSubs = new Subscription();
  }

  override render(): TemplateResult {
    if (this.dp == null && this.dpType == null) {
      return html`<div class="message">Select a datapoint type, datapoint, or element to view and edit its values.</div>`;
    }
    const isType = this.dpType != null;
    return html`
      <div class="header">
        <ix-icon name="${isType ? 'tree' : 'hierarchy'}" size="24"></ix-icon>
        <span class="dp-name">${isType ? `Type: ${this.dpType}` : this.dp}</span>
      </div>
      ${this.renderBody()}
      ${this.status === '' ? nothing : html`<div class="status ${this.statusOk ? 'ok' : 'error'}">${this.status}</div>`}
    `;
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('dp') || changed.has('dpType') || changed.has('ownerType')) {
      this.loadSelection();
    }
  }

  private renderBody(): TemplateResult {
    if (this.loading) {
      return html`<div class="message">Loading values…</div>`;
    }
    if (this.error !== '') {
      return html`<div class="message status error">${this.error}</div>`;
    }
    if (this.elements.length === 0) {
      return html`<div class="message">No value-bearing elements found for this selection.</div>`;
    }
    return html`
      ${this.truncated
        ? html`<div class="status error">Showing the first ${MAX_VALUE_ELEMENTS} values; narrow the selection to see more.</div>`
        : nothing}
      ${this.liveWarning === '' ? nothing : html`<div class="status error">${this.liveWarning}</div>`}
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>Element</th>
              <th>Type</th>
              <th>Source time</th>
              <th>Value</th>
              <th>Unit</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            ${this.elements.map((el) => this.renderRow(el))}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderRow(el: ElementMeta): TemplateResult {
    const isExpanded = this.expanded.has(el.name);
    return html`
      <tr>
        <td class="element" title="${el.name}">
          <div class="element-cell">
            <button
              class="expander"
              aria-label="${isExpanded ? 'Hide config attributes' : 'Show config attributes'}"
              title="Show _original / _online config attributes"
              @click=${() => this.toggleDetails(el)}
            >
              <ix-icon name="${isExpanded ? 'chevron-down-small' : 'chevron-right-small'}" size="16"></ix-icon>
            </button>
            <span>${el.display}</span>
          </div>
        </td>
        <td class="type">${el.type}</td>
        <td class="stime">${formatStime(this.liveValues.get(el.stimePath))}</td>
        <td class="value-cell">${this.renderValue(el)}</td>
        <td>${el.unit}</td>
        <td>${el.description}</td>
      </tr>
      ${isExpanded ? this.renderDetailRow(el) : nothing}
    `;
  }

  private renderDetailRow(el: ElementMeta): TemplateResult {
    return html`
      <tr class="detail-row">
        <td colspan="6">
          <wui-para-config-detail .name=${el.name}></wui-para-config-detail>
        </td>
      </tr>
    `;
  }

  private renderValue(el: ElementMeta): TemplateResult {
    if (!el.editable) {
      return html`<span class="readonly-value">${this.displayValue(el)}</span>`;
    }
    if (el.isDyn) {
      return this.renderDynEditor(el);
    }
    if (el.isBool) {
      return this.renderBoolEditor(el);
    }
    return this.renderTextEditor(el);
  }

  /** Multi-line editor for `dyn_*` arrays: one item per line. */
  private renderDynEditor(el: ElementMeta): TemplateResult {
    const value = this.editorValue(el);
    return html`
      <div class="value-edit dyn">
        <ix-textarea
          .value=${value}
          rows="4"
          placeholder="one ${el.baseType} item per line"
          @valueChange=${(e: CustomEvent<string>) => this.onDraft(el, e.detail)}
        ></ix-textarea>
        ${this.renderSetButton(el)}
      </div>
    `;
  }

  private renderBoolEditor(el: ElementMeta): TemplateResult {
    const draft = this.drafts.get(el.valuePath);
    const checked = draft === undefined ? Boolean(this.liveValues.get(el.valuePath)) : draft === 'true';
    return html`
      <div class="value-edit">
        <ix-toggle
          .checked=${checked}
          @checkedChange=${(e: Event) => this.onDraft(el, String((e.target as HTMLInputElement).checked))}
        ></ix-toggle>
        ${this.renderSetButton(el)}
      </div>
    `;
  }

  private renderTextEditor(el: ElementMeta): TemplateResult {
    const value = this.editorValue(el);
    const field = el.numeric
      ? html`<ix-number-input
          .value=${value}
          @valueChange=${(e: Event) => this.onDraft(el, (e.target as HTMLInputElement).value)}
        ></ix-number-input>`
      : html`<ix-input
          .value=${value}
          @valueChange=${(e: Event) => this.onDraft(el, (e.target as HTMLInputElement).value)}
        ></ix-input>`;
    return html`<div class="value-edit">${field}${this.renderSetButton(el)}</div>`;
  }

  private renderSetButton(el: ElementMeta): TemplateResult {
    const dirty = this.drafts.has(el.valuePath);
    return html`
      <ix-icon-button
        icon="upload"
        size="16"
        variant=${dirty ? 'primary' : 'secondary'}
        ?disabled=${!dirty}
        title="Write value to datapoint"
        @click=${() => this.writeValue(el)}
      ></ix-icon-button>
    `;
  }

  private editorValue(el: ElementMeta): string {
    const draft = this.drafts.get(el.valuePath);
    if (draft !== undefined) {
      return draft;
    }
    return this.displayValue(el);
  }

  private displayValue(el: ElementMeta): string {
    const value = this.liveValues.get(el.valuePath);
    if (value == null) {
      return '';
    }
    if (el.isDyn && Array.isArray(value)) {
      return value.map((item) => formatDynItem(item)).join('\n');
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  }

  private stripSystem(name: string): string {
    return name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  }

  /** Name shown in the table: relative to the selected DP, or full path in type view. */
  private displayName(name: string): string {
    const local = this.stripSystem(name);
    if (this.displayBase === '') {
      return local; // type view - show the full datapoint.element path
    }
    if (local === this.displayBase || local === `${this.displayBase}.`) {
      const segments = this.displayBase.split('.');
      return segments.at(-1) || this.displayBase;
    }
    if (local.startsWith(`${this.displayBase}.`)) {
      return local.slice(this.displayBase.length + 1);
    }
    return local;
  }

  private onDraft(el: ElementMeta, value: string): void {
    this.drafts.set(el.valuePath, value);
    this.requestUpdate();
  }

  private loadSelection(): void {
    this.detailSubs.unsubscribe();
    this.detailSubs = new Subscription();
    this.elements = [];
    this.liveValues = new Map();
    this.drafts = new Map();
    this.expanded = new Set();
    this.status = '';
    this.error = '';
    this.truncated = false;
    this.liveWarning = '';

    if (this.dpType != null && this.dpType !== '') {
      this.loadTypeView(this.dpType);
    } else if (this.dp != null && this.dp !== '') {
      this.loadDpView(this.dp, this.ownerType);
    }
  }

  /**
   * Values of every datapoint of a type. Leaf elements are enumerated from the
   * type STRUCTURE (reliable for nested structs — unlike walking `dpNames('*')`,
   * which missed struct branches and produced invalid config paths), then every
   * DP instance is crossed with every leaf.
   */
  private loadTypeView(typeName: string): void {
    this.displayBase = '';
    this.loading = true;
    this.detailSubs.add(
      forkJoin({
        struct: this.dpeService.getDatapointTypes(typeName).pipe(catchError(() => of('' as DpStruct))),
        dps: this.dpeService.listDatapoints(typeName).pipe(catchError(() => of([] as string[])))
      })
        .pipe(
          map(({ struct, dps }) => {
            const leaves = this.collectLeaves(struct as DpStruct, '');
            const entries: ValueEntry[] = [];
            for (const root of dps as string[]) {
              for (const leaf of leaves) {
                entries.push({ name: this.makeName(root, leaf.relPath), type: leaf.type });
              }
            }
            return entries;
          })
        )
        .subscribe({
          next: (entries) => this.fetchAndBuild(entries),
          error: (err: unknown) => this.failLoad(err)
        })
    );
  }

  /**
   * Values of one datapoint (or one of its sub-element branches). The owning
   * type yields the structure; we keep the leaves under the selected sub-path.
   */
  private loadDpView(dp: string, ownerType: string | null): void {
    if (ownerType == null || ownerType === '') {
      this.error = "Type du datapoint inconnu — re-sélectionnez l'élément dans l'arbre.";
      return;
    }
    const { root, relPath } = this.splitDpPath(dp);
    this.displayBase = this.stripSystem(dp);
    this.loading = true;
    this.detailSubs.add(
      this.dpeService
        .getDatapointTypes(ownerType)
        .pipe(
          map((struct) =>
            this.leavesUnder(struct as DpStruct, relPath).map((leaf) => ({
              name: this.makeName(root, leaf.relPath),
              type: leaf.type
            }))
          )
        )
        .subscribe({
          next: (entries) => this.fetchAndBuild(entries),
          error: (err: unknown) => this.failLoad(err)
        })
    );
  }

  private failLoad(err: unknown): void {
    this.error = `Could not load values: ${String(err)}`;
    this.loading = false;
  }

  /** Full DPE name for a leaf: scalar root -> `<dp>.`, else `<dp>.<relPath>`. */
  private makeName(root: string, relPath: string): string {
    return relPath === '' ? `${root}.` : `${root}.${relPath}`;
  }

  /** Split a selection path into DP root + element sub-path (a DP name has no '.'). */
  private splitDpPath(dp: string): { root: string; relPath: string } {
    const dot = dp.indexOf('.');
    return dot === -1 ? { root: dp, relPath: '' } : { root: dp.slice(0, dot), relPath: dp.slice(dot + 1) };
  }

  /** Flatten a type structure to its scalar leaves (relative path + WinCC OA type). */
  private collectLeaves(struct: DpStruct, base: string): { relPath: string; type: string }[] {
    if (typeof struct === 'string') {
      return struct === '' ? [] : [{ relPath: base, type: struct }];
    }
    const out: { relPath: string; type: string }[] = [];
    for (const [key, value] of Object.entries(struct)) {
      const rel = base === '' ? key : `${base}.${key}`;
      if (typeof value === 'string') {
        out.push({ relPath: rel, type: value });
      } else {
        out.push(...this.collectLeaves(value, rel));
      }
    }
    return out;
  }

  /** Leaves under a relative sub-path (relPath '' -> all leaves). */
  private leavesUnder(struct: DpStruct, relPath: string): { relPath: string; type: string }[] {
    const all = this.collectLeaves(struct, '');
    if (relPath === '') {
      return all;
    }
    return all.filter((leaf) => leaf.relPath === relPath || leaf.relPath.startsWith(`${relPath}.`));
  }

  /** De-dup + cap entries, read units/descriptions, then build the rows. */
  private fetchAndBuild(entries: ValueEntry[]): void {
    const seen = new Set<string>();
    const unique: ValueEntry[] = [];
    for (const entry of entries) {
      if (entry.name === '' || seen.has(entry.name)) {
        continue;
      }
      seen.add(entry.name);
      unique.push(entry);
    }
    unique.sort((a, b) => a.name.localeCompare(b.name));
    let list = unique;
    if (list.length > MAX_VALUE_ELEMENTS) {
      this.truncated = true;
      list = list.slice(0, MAX_VALUE_ELEMENTS);
    }
    if (list.length === 0) {
      this.elements = [];
      this.loading = false;
      return;
    }
    const names = list.map((entry) => entry.name);
    this.detailSubs.add(
      forkJoin({
        units: this.api.dpGetUnit(names).pipe(catchError(() => of([]))),
        descriptions: this.api.dpGetDescription(names, DESCRIPTION_MODE).pipe(catchError(() => of([])))
      }).subscribe({
        next: (meta) => this.buildElements(list, toArray(meta.units), toArray(meta.descriptions)),
        error: (err: unknown) => this.failLoad(err)
      })
    );
  }

  private buildElements(list: ValueEntry[], units: unknown[], descriptions: unknown[]): void {
    const elements: ElementMeta[] = [];
    for (const [index, entry] of list.entries()) {
      const type = entry.type;
      if (type === '' || type === 'struct') {
        continue; // structural node without a scalar type
      }
      const isDyn = type.startsWith('dyn_');
      const baseType = isDyn ? type.slice('dyn_'.length) : type;
      const numeric = NUMERIC_TYPES.has(baseType);
      const isBool = baseType === 'bool';
      const editable = isEditableType(baseType);
      elements.push({
        name: entry.name,
        display: this.displayName(entry.name),
        valuePath: `${entry.name}${VALUE_ATTR}`,
        stimePath: `${entry.name}${STIME_ATTR}`,
        type,
        unit: String(units[index] ?? ''),
        description: String(descriptions[index] ?? ''),
        isDyn,
        baseType,
        numeric,
        isBool,
        editable
      });
    }
    this.elements = elements;
    this.loading = false;
    this.connectLive(elements);
  }

  private connectLive(elements: ElementMeta[]): void {
    if (elements.length === 0) {
      return;
    }
    // Connect both the value and the source-time of every element, in chunks
    // (see LIVE_CONNECT_CHUNK). A chunk failure is non-fatal: the table stays
    // visible and the other chunks still stream their values.
    const paths = [...elements.map((el) => el.valuePath), ...elements.map((el) => el.stimePath)];
    for (let start = 0; start < paths.length; start += LIVE_CONNECT_CHUNK) {
      const chunk = paths.slice(start, start + LIVE_CONNECT_CHUNK);
      this.detailSubs.add(
        this.api.dpConnect(chunk, true).subscribe({
          next: (data) => {
            const next = new Map(this.liveValues);
            for (const [index, path] of data.dp.entries()) {
              next.set(path, data.value[index]);
            }
            this.liveValues = next;
          },
          error: () => {
            this.liveWarning = 'Certaines valeurs en direct sont indisponibles.';
          }
        })
      );
    }
  }

  private async writeValue(el: ElementMeta): Promise<void> {
    const draft = this.drafts.get(el.valuePath);
    if (draft === undefined) {
      return;
    }
    const converted = this.convert(el, draft);
    if (converted === undefined) {
      const what = el.isDyn ? `${el.baseType} list` : 'value';
      this.setStatus(`Invalid ${what} for ${el.name}`, false);
      return;
    }
    try {
      const response = await fetch(DP_SET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dpeName: el.name, value: converted })
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        this.drafts.delete(el.valuePath);
        this.setStatus(`Wrote ${el.name}`, true);
      } else {
        this.setStatus(result.error ?? `Write rejected for ${el.name} (HTTP ${response.status})`, false);
      }
    } catch (error) {
      this.setStatus(`Write failed: ${String(error)}`, false);
    }
  }

  private convert(el: ElementMeta, draft: string): unknown {
    return el.isDyn ? convertDynList(el.baseType, draft) : convertItem(el.baseType, draft);
  }

  private toggleDetails(el: ElementMeta): void {
    const next = new Set(this.expanded);
    if (next.has(el.name)) {
      next.delete(el.name);
    } else {
      next.add(el.name);
    }
    this.expanded = next;
  }

  private setStatus(message: string, ok: boolean): void {
    this.status = message;
    this.statusOk = ok;
    this.requestUpdate();
  }
}

if (!customElements.get('wui-para-detail')) {
  customElements.define('wui-para-detail', WuiParaDetail);
}
