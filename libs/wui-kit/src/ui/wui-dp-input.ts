// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Datapoint input with live autocomplete + browse button (shared kit component).
 *
 * Wraps `ix-input`; same use as ever (`value`, `label`, `placeholder`, `wui:change` with the value),
 * easier to drive:
 *  - typing a name suggests the matching datapoints (`dpNames`); choosing one goes on with its elements,
 *    level by level, down to the wanted element ("Niveau supérieur" goes back up);
 *  - the browse button on an empty field lists the datapoint types, then the datapoints of the type
 *    chosen; a type chosen stays as a filter until cleared;
 *  - keyboard: ↑ ↓ move, Enter chooses, Escape closes; leaving the field closes the list;
 *  - each suggestion shows the typed part in bold, the datapoint's type, and for an element its
 *    description, current value and unit; a cut list says so;
 *  - a value naming no datapoint is flagged (not blocked).
 * Degrades to a plain input when no backend connection is available. Pure logic in dp-input-logic.ts.
 *
 * Moved out of the machine-fleet-3d page (was `mf-dp-input`) so report pages and
 * any other page can reuse it without reaching across page folders. Registered
 * under the shared tag `wui-dp-input` with a guard (safe in a shared chunk).
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { firstValueFrom, type Observable } from 'rxjs';
import { container } from 'tsyringe';
import { MSG, localize, localizeDir, truncatedMsg } from '../i18n.js';
import {
  MAX_SUGGESTIONS,
  childElements,
  existenceName,
  formatValue,
  highlight,
  parentOf,
  parseQuery,
  usefulDescription,
  withoutSystem
} from './dp-input-logic.js';

interface IxValueEvent {
  detail: string;
}

/** A line of the suggestion list. */
type Row =
  | { kind: 'up'; value: string; atDp: boolean }
  | { kind: 'type'; type: string }
  | { kind: 'dp'; name: string; type?: string }
  | { kind: 'element'; name: string; segment: string; hasChildren: boolean; detail?: string };

const DP_INPUT_TAG = 'wui-dp-input';
const DEBOUNCE_MS = 250;
const CHECK_MS = 400;
const BLUR_CLOSE_MS = 150;
/** Datapoint types listed at most by the browse button. */
const MAX_TYPES = 300;
/** How long the datapoint → type index is kept (ms), and how many types are read at once to build it. */
const TYPE_INDEX_TTL_MS = 300_000;
const TYPE_INDEX_BATCH = 8;

/**
 * A top-level DP (no element part) must end with a dot to be a valid DPE. Add it
 * when missing; leave element/already-dotted paths untouched.
 */
function ensureTrailingDot(dpe: string): string {
  const v = dpe.trim();
  if (v === '' || v.includes('.')) return v;
  return `${v}.`;
}

const first = <T>(obs: Observable<T>): Promise<T> => firstValueFrom(obs);

/** Datapoint name (without system) → its type, shared by every input of the page, rebuilt after a while. */
let typeIndex: { at: number; map: Promise<Map<string, string>> } | null = null;

function loadTypeIndex(dpe: WuiDpeService): Promise<Map<string, string>> {
  if (typeIndex && Date.now() - typeIndex.at < TYPE_INDEX_TTL_MS) return typeIndex.map;
  const map = (async (): Promise<Map<string, string>> => {
    const index = new Map<string, string>();
    const types = (await first(dpe.listTypes({ internal: false }))).filter((t) => !t.startsWith('_'));
    for (let i = 0; i < types.length; i += TYPE_INDEX_BATCH) {
      // eslint-disable-next-line no-await-in-loop -- a few types at a time keeps the backend load bounded
      await Promise.all(
        types.slice(i, i + TYPE_INDEX_BATCH).map((t) =>
          first(dpe.listDatapoints(t))
            .then((names) => names.forEach((n) => index.set(withoutSystem(n), t)))
            .catch(() => undefined)
        )
      );
    }
    return index;
  })().catch(() => new Map<string, string>());
  typeIndex = { at: Date.now(), map };
  return map;
}

export class WuiDpInput extends LitElement {
  static override readonly styles = [IXCoreStyles, dpInputStyles()];

  @property() value = '';
  @property() label = '';
  @property() placeholder = 'System1:Datapoint.value';

  @state() private rows: Row[] = [];
  @state() private open = false;
  @state() private active = -1;
  @state() private loading = false;
  @state() private truncated = false;
  /** The part of the text the suggestions match (shown in bold). */
  @state() private typed = '';
  /** Datapoint type chosen from the browse list: the datapoint suggestions keep to it until cleared. */
  @state() private typeFilter = '';
  /** The value names no datapoint (flag only). */
  @state() private missing = false;

  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();
  private debounce = 0;
  private checkTimer = 0;
  /** Bumped by every query: an older answer arriving late is dropped. */
  private gen = 0;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    clearTimeout(this.debounce);
    clearTimeout(this.checkTimer);
    this.gen++;
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has('value')) this.scheduleCheck();
    if (changed.has('active') && this.active >= 0) {
      this.renderRoot.querySelector('.item.active')?.scrollIntoView({ block: 'nearest' });
    }
  }

  override render(): TemplateResult {
    return html`
      <div class="wrap" @keydown=${this.onKey}>
        <ix-input
          class="field"
          label=${this.label}
          placeholder=${this.placeholder}
          .value=${this.value}
          @valueChange=${(e: IxValueEvent) => this.onInput(e.detail)}
          @ixBlur=${this.onBlur}
        ></ix-input>
        ${this.missing
          ? html`<ix-icon class="missing" name="warning" size="16" title=${localize(MSG.dpInput.notFound)}></ix-icon>`
          : nothing}
        <ix-icon-button
          class="browse"
          ghost
          icon="search"
          title=${localize(MSG.dpInput.browse)}
          @click=${this.browse}
        ></ix-icon-button>
        ${this.open ? this.renderList() : nothing}
      </div>
    `;
  }

  private renderList(): TemplateResult {
    const empty = this.rows.filter((r) => r.kind !== 'up').length === 0;
    return html`
      <div class="suggestions" role="listbox">
        ${this.typeFilter
          ? html`<div class="filter">
              <span class="chip">${this.typeFilter}</span>
              <button type="button" class="clear" @pointerdown=${this.clearType}>${localizeDir(MSG.dpInput.allTypes)}</button>
            </div>`
          : nothing}
        ${this.rows[0]?.kind === 'type' ? html`<div class="note head">${localizeDir(MSG.dpInput.types)}</div>` : nothing}
        ${this.rows.map((r, i) => this.renderRow(r, i))}
        ${empty ? html`<div class="note">${localizeDir(this.loading ? MSG.dpInput.loading : MSG.dpInput.none)}</div>` : nothing}
        ${this.truncated ? html`<div class="note">${localizeDir(truncatedMsg(MAX_SUGGESTIONS))}</div>` : nothing}
      </div>
    `;
  }

  private renderRow(r: Row, i: number): TemplateResult {
    const cls = `item ${i === this.active ? 'active' : ''}`;
    const pick = (e: Event): void => {
      e.preventDefault(); // keep the focus in the field
      void this.choose(r);
    };
    if (r.kind === 'up') {
      return html`<div class="${cls} up" role="option" @pointerdown=${pick}>‹ ${localizeDir(MSG.dpInput.up)}</div>`;
    }
    if (r.kind === 'type') {
      return html`<div class=${cls} role="option" @pointerdown=${pick}>
        <span class="line"><span class="name">${this.bold(r.type)}</span><span class="more">›</span></span>
      </div>`;
    }
    if (r.kind === 'dp') {
      return html`<div class=${cls} role="option" @pointerdown=${pick}>
        <span class="line">
          <span class="name">${this.bold(withoutSystem(r.name))}</span>
          ${r.type && !this.typeFilter ? html`<span class="kind">${r.type}</span>` : nothing}
          <span class="more">›</span>
        </span>
      </div>`;
    }
    return html`<div class=${cls} role="option" @pointerdown=${pick}>
      <span class="line">
        <span class="name">${this.bold(r.segment)}</span>
        ${r.hasChildren ? html`<span class="more">›</span>` : nothing}
      </span>
      ${r.detail ? html`<span class="detail">${r.detail}</span>` : nothing}
    </div>`;
  }

  /** A label with the typed part in bold. */
  private bold(label: string): TemplateResult {
    const h = highlight(label, this.typed);
    return h.match ? html`${h.before}<b>${h.match}</b>${h.after}` : html`${label}`;
  }

  // --- typing, keyboard, focus ---------------------------------------------------

  private onInput(value: string): void {
    this.value = value;
    this.emit(value);
    clearTimeout(this.debounce);
    this.debounce = window.setTimeout(() => void this.query(value), DEBOUNCE_MS);
  }

  private browse(): void {
    void this.query(this.value);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.open) {
        void this.query(this.value);
        return;
      }
      this.active = Math.min(this.rows.length - 1, this.active + 1);
    } else if (e.key === 'ArrowUp' && this.open) {
      e.preventDefault();
      this.active = Math.max(0, this.active - 1);
    } else if (e.key === 'Enter' && this.open && this.active >= 0 && this.rows[this.active]) {
      e.preventDefault();
      void this.choose(this.rows[this.active]);
    } else if (e.key === 'Escape' && this.open) {
      // Close the list only, not the dialog the field sits in.
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  };

  private readonly onBlur = (): void => {
    window.setTimeout(() => {
      if (this.matches(':focus-within')) return;
      this.close();
      const fixed = ensureTrailingDot(this.value);
      if (fixed !== this.value) this.commit(fixed);
    }, BLUR_CLOSE_MS);
  };

  private close(): void {
    this.open = false;
    this.active = -1;
    this.gen++;
  }

  // --- suggestions ------------------------------------------------------------------

  private async query(text: string): Promise<void> {
    if (!this.api) return;
    const gen = ++this.gen;
    const q = parseQuery(text);
    this.open = true;
    this.loading = true;
    this.active = -1;
    try {
      if (q.kind === 'types' && !this.typeFilter) await this.listTypes(gen);
      else if (q.kind === 'types' || q.kind === 'dp') await this.listDps(gen, q.kind === 'dp' ? q.pattern : '*', q.kind === 'dp' ? q.typed : '');
      else await this.listElements(gen, q.base, q.partial);
    } catch {
      if (gen === this.gen) this.rows = [];
    } finally {
      if (gen === this.gen) this.loading = false;
    }
  }

  private async listTypes(gen: number): Promise<void> {
    if (!this.dpe) {
      await this.listDps(gen, '*', '');
      return;
    }
    const types = (await first(this.dpe.listTypes({ internal: false })))
      .filter((t) => !t.startsWith('_'))
      .sort((a, b) => a.localeCompare(b));
    if (gen !== this.gen) return;
    this.typed = '';
    this.truncated = types.length > MAX_TYPES;
    this.rows = types.slice(0, MAX_TYPES).map((type) => ({ kind: 'type', type }));
  }

  private async listDps(gen: number, pattern: string, typed: string): Promise<void> {
    const api = this.api;
    if (!api) return;
    const names = ((await first(api.dpNames(pattern, this.typeFilter))) as string[]) ?? [];
    if (gen !== this.gen) return;
    // System datapoints (`_…`) only when asked for by name.
    const shown = typed.startsWith('_') ? names : names.filter((n) => !withoutSystem(n).startsWith('_'));
    this.typed = typed;
    this.truncated = shown.length > MAX_SUGGESTIONS;
    this.rows = shown.slice(0, MAX_SUGGESTIONS).map((name) => ({ kind: 'dp', name }));
    if (this.typeFilter || !this.dpe) return;
    // The type of each datapoint, once the index of the page is ready.
    const index = await loadTypeIndex(this.dpe);
    if (gen !== this.gen) return;
    this.rows = this.rows.map((r) => (r.kind === 'dp' ? { ...r, type: index.get(withoutSystem(r.name)) } : r));
  }

  private async listElements(gen: number, base: string, partial: string): Promise<void> {
    const api = this.api;
    if (!api) return;
    const [children, grand] = await Promise.all([
      first(api.dpNames(`${base}.*`, '')).catch(() => [] as string[]),
      first(api.dpNames(`${base}.*.*`, '')).catch(() => [] as string[])
    ]);
    if (gen !== this.gen) return;
    const all = childElements(base, children as string[], grand as string[], partial);
    this.typed = partial;
    this.truncated = all.length > MAX_SUGGESTIONS;
    const parent = parentOf(base);
    const elements: Row[] = all
      .slice(0, MAX_SUGGESTIONS)
      .map((c) => ({ kind: 'element', name: c.name, segment: c.segment, hasChildren: c.hasChildren }));
    this.rows = [{ kind: 'up', value: parent.value, atDp: parent.atDp }, ...elements];
    await this.addDetails(gen);
  }

  /** Description, current value and unit of the elements without elements under them. */
  private async addDetails(gen: number): Promise<void> {
    const api = this.api;
    const leaves = this.rows.filter((r): r is Extract<Row, { kind: 'element' }> => r.kind === 'element' && !r.hasChildren);
    if (!api || leaves.length === 0) return;
    const names = leaves.map((l) => l.name);
    const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
    const [descriptions, units, values] = await Promise.all([
      first(api.dpGetDescription(names)).then(asList).catch(() => [] as unknown[]),
      first(api.dpGetUnit(names)).then(asList).catch(() => [] as unknown[]),
      first(api.dpGet(names)).then(asList).catch(() => [] as unknown[])
    ]);
    if (gen !== this.gen) return;
    const detail = new Map<string, string>();
    names.forEach((name, i) => {
      const description = usefulDescription(descriptions[i], name);
      const unit = typeof units[i] === 'string' ? String(units[i]).trim() : '';
      const value = values.length > i ? `${formatValue(values[i])}${unit ? ` ${unit}` : ''}` : unit;
      const text = [description, value].filter((s) => s !== '').join(' · ');
      if (text) detail.set(name, text);
    });
    this.rows = this.rows.map((r) => (r.kind === 'element' && detail.has(r.name) ? { ...r, detail: detail.get(r.name) } : r));
  }

  private async choose(r: Row): Promise<void> {
    if (r.kind === 'type') {
      this.typeFilter = r.type;
      this.commit('');
      await this.query('');
    } else if (r.kind === 'up') {
      this.commit(r.value);
      await this.query(r.value);
    } else if (r.kind === 'dp' || r.hasChildren) {
      const next = `${r.name}.`;
      this.commit(next);
      await this.query(next);
    } else {
      this.commit(r.name);
      this.close();
    }
  }

  private readonly clearType = (e: Event): void => {
    e.preventDefault();
    this.typeFilter = '';
    void this.query(this.value);
  };

  // --- value -------------------------------------------------------------------------

  private commit(value: string): void {
    this.value = value;
    this.emit(value);
  }

  private emit(value: string): void {
    this.dispatchEvent(
      new CustomEvent('wui:change', { detail: { value }, bubbles: true, composed: true })
    );
  }

  /** Flag a value naming no datapoint, a moment after it last changed. */
  private scheduleCheck(): void {
    clearTimeout(this.checkTimer);
    this.checkTimer = window.setTimeout(() => void this.checkExists(), CHECK_MS);
  }

  private async checkExists(): Promise<void> {
    const api = this.api;
    const name = existenceName(this.value);
    if (!api || name === '' || name.includes('*')) {
      this.missing = false;
      return;
    }
    const asked = this.value;
    try {
      const found = (await first(api.dpNames(name, ''))) as string[];
      if (asked === this.value) this.missing = !Array.isArray(found) || found.length === 0;
    } catch {
      if (asked === this.value) this.missing = false;
    }
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  private resolveDpe(): WuiDpeService | null {
    try {
      return container.resolve<WuiDpeService>(WuiDpeService);
    } catch {
      return null;
    }
  }
}

if (!customElements.get(DP_INPUT_TAG)) {
  customElements.define(DP_INPUT_TAG, WuiDpInput);
}

function dpInputStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .wrap {
      position: relative;
      display: flex;
      align-items: flex-end;
      gap: 0.25rem;
    }
    .field {
      flex: 1;
    }
    .missing {
      align-self: center;
      margin-top: 1rem;
      color: var(--theme-color-warning);
    }
    .suggestions {
      position: absolute;
      top: 100%;
      left: 0;
      right: 2rem;
      z-index: 20;
      max-height: 16rem;
      overflow-y: auto;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    }
    .item {
      display: flex;
      flex-direction: column;
      padding: 0.3rem 0.5rem;
      cursor: pointer;
      font-size: 0.8rem;
    }
    .item:hover,
    .item.active {
      background: var(--theme-color-2);
    }
    .item.active {
      outline: 1px solid var(--theme-color-primary);
      outline-offset: -1px;
    }
    .item.up {
      color: var(--theme-color-soft-text);
    }
    .line {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      min-width: 0;
    }
    .name {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .name b {
      font-weight: 700;
      color: var(--theme-color-primary);
    }
    .kind {
      flex-shrink: 0;
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
    }
    .more {
      flex-shrink: 0;
      color: var(--theme-color-soft-text);
    }
    .detail {
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .note.head {
      font-style: normal;
      font-weight: 600;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .note {
      padding: 0.35rem 0.5rem;
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
      font-style: italic;
    }
    .filter {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .chip {
      font-size: 0.72rem;
      padding: 0.05rem 0.45rem;
      border-radius: 0.7rem;
      border: 1px solid var(--theme-color-primary);
      color: var(--theme-color-primary);
    }
    .clear {
      border: 0;
      background: transparent;
      color: var(--theme-color-primary);
      font: inherit;
      font-size: 0.72rem;
      cursor: pointer;
    }
  `;
}
