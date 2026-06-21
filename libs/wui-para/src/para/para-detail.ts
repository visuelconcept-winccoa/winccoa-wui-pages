/**
 * PARA detail / edit panel.
 *
 * For the selected datapoint it discovers all value-bearing elements
 * (OaRxJsApi.dpNames + dpElementType), shows their live values (dpConnect),
 * units and descriptions, and lets the user write new values back (dpSet).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { type Observable, Subscription, catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { container } from 'tsyringe';
import './para-config-detail.js';
import { NUMERIC_TYPES, convertDynList, convertItem, formatDynItem, formatStime, isEditableType } from './para-value.js';

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

/** Safety bound on how deep the element tree is walked level by level. */
const MAX_TREE_DEPTH = 12;

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

/** Shape returned by dpElementType/dpGetUnit/dpGetDescription per element. */
interface ElementMetaResult {
  names: string[];
  types: unknown;
  units: unknown;
  descriptions: unknown;
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

  @state() private elements: ElementMeta[] = [];
  @state() private loading = false;
  @state() private error = '';
  @state() private status = '';
  @state() private statusOk = false;
  @state() private truncated = false;
  /** Live value per element value-path. */
  @state() private liveValues = new Map<string, unknown>();
  /** Pending edits per element value-path (string-encoded). */
  @state() private drafts = new Map<string, string>();
  /** Element names whose config-attribute detail panel is expanded. */
  @state() private expanded = new Set<string>();

  private readonly api = container.resolve<OaRxJsApi>(OaRxJsApi);
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
    if (changed.has('dp') || changed.has('dpType')) {
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

    const candidates$ = this.dpType != null && this.dpType !== ''
      ? this.typeCandidates(this.dpType)
      : this.dpCandidates(this.dp);
    if (candidates$ == null) {
      return;
    }
    this.loading = true;
    this.detailSubs.add(
      candidates$.pipe(switchMap((names) => this.fetchMeta(this.prepareNames(names)))).subscribe({
        next: (result) => this.buildElements(result),
        error: (err: unknown) => {
          this.error = `Could not load values: ${String(err)}`;
          this.loading = false;
        }
      })
    );
  }

  /** Candidate element names for a single datapoint / element path. */
  private dpCandidates(dp: string | null): Observable<string[]> | null {
    if (dp == null || dp === '') {
      return null;
    }
    this.displayBase = this.stripSystem(dp);
    return this.descendantNames(dp);
  }

  /** Value-element names under a datapoint / element, with the scalar fallback. */
  private descendantNames(dp: string): Observable<string[]> {
    const base = dp.endsWith('.') ? dp : `${dp}.`;
    return this.collectDescendants(base, 0).pipe(
      map((names) => {
        const list = [...new Set(names)].filter((name) => name !== '');
        if (list.length > 0) {
          return list;
        }
        // No descendants: the node is itself a value element. A DP root without
        // an element part must be addressed with a trailing dot (e.g. `Counter.`).
        return [this.stripSystem(dp).includes('.') ? dp : base];
      })
    );
  }

  /**
   * Recursively list every element below `prefix` (which ends with '.').
   * `dpNames(<prefix>*)` returns one element level; we recurse into each child
   * until the leaves, so full depth is reached without relying on '**'. If a
   * single query already returns deeper paths, it is taken as-is.
   */
  private collectDescendants(prefix: string, depth: number): Observable<string[]> {
    if (depth > MAX_TREE_DEPTH) {
      return of([]);
    }
    return this.api.dpNames(`${prefix}*`, '').pipe(
      catchError(() => of([])),
      switchMap((names) => {
        const children = (names as string[]).filter((name) => name !== '' && name.startsWith(prefix) && name !== prefix);
        if (children.length === 0) {
          return of([] as string[]);
        }
        // If the query already returned deeper paths, '*' matched the whole subtree.
        if (children.some((child) => child.slice(prefix.length).includes('.'))) {
          return of(children);
        }
        return forkJoin(children.map((child) => this.collectDescendants(`${child}.`, depth + 1))).pipe(
          map((sub) => [...children, ...sub.flat()])
        );
      })
    );
  }

  /**
   * Candidate element names across every datapoint of a type: each DP root and
   * all of its descendant elements (flat view of the whole type).
   */
  private typeCandidates(typeName: string): Observable<string[]> {
    this.displayBase = '';
    return this.api.dpNames('*', typeName).pipe(
      catchError(() => of([])),
      switchMap((names) => {
        // Keep DP roots only (no element part), then expand each one fully.
        const roots = (names as string[]).filter((name) => name !== '' && !this.stripSystem(name).includes('.'));
        if (roots.length === 0) {
          return of([] as string[]);
        }
        return forkJoin(roots.map((root) => this.descendantNames(root)));
      }),
      map((perRoot) => (perRoot as string[][]).flat())
    );
  }

  /** De-duplicate, sort and cap the candidate names. */
  private prepareNames(names: string[]): string[] {
    const unique = [...new Set(names.filter((name) => name !== ''))].sort((a, b) => a.localeCompare(b));
    if (unique.length > MAX_VALUE_ELEMENTS) {
      this.truncated = true;
      return unique.slice(0, MAX_VALUE_ELEMENTS);
    }
    return unique;
  }

  private fetchMeta(names: string[]) {
    return forkJoin({
      types: this.api.dpElementType(names).pipe(catchError(() => of([]))),
      units: this.api.dpGetUnit(names).pipe(catchError(() => of([]))),
      descriptions: this.api.dpGetDescription(names, DESCRIPTION_MODE).pipe(catchError(() => of([])))
    }).pipe(switchMap((meta) => of({ names, ...meta } satisfies ElementMetaResult)));
  }

  private buildElements(result: ElementMetaResult): void {
    const types = toArray(result.types);
    const units = toArray(result.units);
    const descriptions = toArray(result.descriptions);

    const elements: ElementMeta[] = [];
    for (const [index, name] of result.names.entries()) {
      const type = String(types[index] ?? '');
      if (type === '') {
        continue; // structural node without a scalar type
      }
      const isDyn = type.startsWith('dyn_');
      const baseType = isDyn ? type.slice('dyn_'.length) : type;
      const numeric = NUMERIC_TYPES.has(baseType);
      const isBool = baseType === 'bool';
      const editable = isEditableType(baseType);
      elements.push({
        name,
        display: this.displayName(name),
        valuePath: `${name}${VALUE_ATTR}`,
        stimePath: `${name}${STIME_ATTR}`,
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
    // Connect both the value and the source-time of every element.
    const paths = [...elements.map((el) => el.valuePath), ...elements.map((el) => el.stimePath)];
    this.detailSubs.add(
      this.api.dpConnect(paths, true).subscribe({
        next: (data) => {
          const next = new Map(this.liveValues);
          for (const [index, path] of data.dp.entries()) {
            next.set(path, data.value[index]);
          }
          this.liveValues = next;
        },
        error: (err: unknown) => {
          this.error = `Live connection failed: ${String(err)}`;
        }
      })
    );
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
