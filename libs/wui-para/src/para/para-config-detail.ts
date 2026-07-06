// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA config-attribute panel for a single datapoint element.
 *
 * For an element `name`, reads the detail attributes of every WinCC OA config
 * (see para-configs.ts) via dpGet and renders one card per config that applies.
 * Editable attributes (number/bool/string/dyn) can be written back through the
 * webserver.js PARA extension (`POST /api/para/dp/set`, dpeName
 * `<name>:<config>..<attr>`); reads stay on the WebSocket dpGet.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { hasRole$ } from '@visuelconcept/wui-kit/data/app-security.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { type Observable, Subscription, catchError, forkJoin, map, of } from 'rxjs';
import { container } from 'tsyringe';
import {
  CONFIG_SPECS,
  INFO_BITS,
  STATUS_BIT_COUNT,
  USER_BIT_COUNT,
  type AttrSpec,
  type ConfigSpec,
  decodeBits
} from './para-configs.js';
import { convertDynList, convertItem, formatDynItem, formatStime } from './para-value.js';
import {
  CONFIG_LABEL,
  MSG,
  attrLabel,
  infoBitTitleMsg,
  invalidAttrValueMsg,
  localize,
  localizeDir,
  writeAttrRejectedMsg,
  writeFailedMsg,
  wroteAttrMsg
} from './i18n.js';

/** webserver.js PARA extension endpoint that writes DPE values/configs. */
const DP_SET_URL = '/api/para/dp/set';

/** One resolved attribute of a config (read value + its spec). */
interface ResolvedAttr {
  spec: AttrSpec;
  raw: unknown;
}

/** A config and the attributes that resolved for the current element. */
interface ConfigSnapshot {
  config: string;
  label: string;
  entries: ResolvedAttr[];
  available: boolean;
}

/** dpGet of a single DPE may return the value directly or wrapped in an array. */
function singleValue(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

function isTruthy(raw: unknown): boolean {
  return raw === true || raw === 1 || raw === 'true' || raw === '1';
}

export class WuiParaConfigDetail extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: block;
      }
      .head {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        font-size: 0.8125rem;
        font-weight: 600;
        margin-bottom: 0.5rem;
      }
      .status {
        font-size: 0.8125rem;
      }
      .status.ok {
        color: var(--theme-color-success);
      }
      .status.error {
        color: var(--theme-color-alarm);
      }
      .msg {
        font-size: 0.8125rem;
        color: var(--theme-color-soft-text);
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(17rem, 1fr));
        gap: 0.5rem;
        align-items: start;
      }
      .card {
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
        padding: 0.5rem;
        background: var(--theme-color-2);
      }
      .config-name {
        font-weight: 600;
        font-size: 0.8125rem;
        margin-bottom: 0.375rem;
      }
      .config-name code {
        font-family: monospace;
        font-weight: 400;
        color: var(--theme-color-soft-text);
      }
      .attr {
        display: flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.125rem 0;
        font-size: 0.8125rem;
      }
      .attr-label {
        color: var(--theme-color-soft-text);
        white-space: nowrap;
        flex: 0 0 7.5rem;
      }
      .attr-value {
        font-family: monospace;
        word-break: break-all;
        flex: 1;
      }
      .attr .editor {
        flex: 1;
        min-width: 0;
      }
      .attr.dyn {
        align-items: flex-start;
      }
      .bits {
        margin-top: 0.375rem;
      }
      .bits-head {
        font-size: 0.75rem;
        font-weight: 600;
        margin-bottom: 0.25rem;
      }
      .bits-summary {
        font-weight: 400;
        color: var(--theme-color-soft-text);
      }
      .bit-grid {
        display: grid;
        grid-template-columns: repeat(16, 1fr);
        gap: 1px;
      }
      .bit {
        font-size: 0.625rem;
        line-height: 1;
        text-align: center;
        padding: 0.125rem 0;
        border: 1px solid var(--theme-color-soft-bdr);
        color: var(--theme-color-soft-text);
        background: var(--theme-color-1);
      }
      .bit.on {
        background: var(--theme-color-primary);
        color: var(--theme-color-primary--contrast);
        border-color: var(--theme-color-primary);
        font-weight: 600;
      }
      .flag-list {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem;
      }
      .flag {
        font-size: 0.6875rem;
        line-height: 1;
        padding: 0.1875rem 0.375rem;
        border-radius: var(--theme-default-border-radius);
        border: 1px solid var(--theme-color-soft-bdr);
        color: var(--theme-color-soft-text);
        background: var(--theme-color-1);
        font-family: monospace;
      }
      .flag.on {
        background: var(--theme-color-primary);
        color: var(--theme-color-primary--contrast);
        border-color: var(--theme-color-primary);
        font-weight: 600;
      }
    `
  ];

  /** Element whose config attributes are read, e.g. `System1:Pump1.speed`. */
  @property({ type: String }) name = '';

  @state() private snapshots: ConfigSnapshot[] | null = null;
  @state() private loading = false;
  @state() private status = '';
  @state() private statusOk = false;
  /** Pending edits per attribute path (string-encoded). */
  @state() private drafts = new Map<string, string>();
  /** Application-Security grant for config writes (open until groups are assigned). */
  @state() private canWrite = true;

  private readonly api = container.resolve<OaRxJsApi>(OaRxJsApi);
  private subs = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.subs.add(hasRole$('para', 'edit-values').subscribe((granted) => (this.canWrite = granted)));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.subs.unsubscribe();
    this.subs = new Subscription();
  }

  override render(): TemplateResult {
    return html`
      <div class="head">
        <span>${localizeDir(MSG.configDetail.head)}</span>
        <ix-icon-button icon="refresh" size="12" ghost title=${localize(MSG.configDetail.reload)} @click=${this.reload}></ix-icon-button>
      </div>
      ${this.status === '' ? nothing : html`<div class="status ${this.statusOk ? 'ok' : 'error'}">${this.status}</div>`}
      ${this.loading ? html`<div class="msg">${localizeDir(MSG.configDetail.reading)}</div>` : this.renderSnapshots()}
    `;
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has('name') && this.snapshots == null) {
      this.load();
    }
  }

  private renderSnapshots(): TemplateResult {
    const visible = (this.snapshots ?? []).filter((snapshot) => snapshot.available);
    if (visible.length === 0) {
      return html`<div class="msg">${localizeDir(MSG.configDetail.noConfigs)}</div>`;
    }
    return html`<div class="grid">${visible.map((snapshot) => this.renderCard(snapshot))}</div>`;
  }

  /** Localized config label (falls back to the spec-provided label). */
  private configLabel(snapshot: ConfigSnapshot): string {
    const ml = CONFIG_LABEL[snapshot.config];
    return ml ? localize(ml) : snapshot.label;
  }

  private renderCard(snapshot: ConfigSnapshot): TemplateResult {
    return html`
      <div class="card">
        <div class="config-name">${this.configLabel(snapshot)} <code>${snapshot.config}</code></div>
        ${snapshot.entries.map((entry) => this.renderEntry(snapshot.config, entry))}
      </div>
    `;
  }

  private renderEntry(config: string, entry: ResolvedAttr): TemplateResult {
    const path = `${this.name}:${config}..${entry.spec.attr}`;
    switch (entry.spec.kind) {
      case 'status': {
        return this.renderInfoBits(decodeBits(entry.raw, STATUS_BIT_COUNT), String(entry.raw));
      }
      case 'userbits': {
        return this.renderUserBits(decodeBits(entry.raw, USER_BIT_COUNT).map((bit) => bit + 1));
      }
      case 'time': {
        return this.renderReadonly(localize(attrLabel(entry.spec.label)), formatStime(entry.raw));
      }
      case 'readonly': {
        return this.renderReadonly(localize(attrLabel(entry.spec.label)), this.formatAttr(entry.raw));
      }
      default: {
        return this.renderEditable(path, entry);
      }
    }
  }

  private renderReadonly(label: string, value: string): TemplateResult {
    return html`
      <div class="attr">
        <span class="attr-label">${label}</span>
        <span class="attr-value">${value}</span>
      </div>
    `;
  }

  private renderEditable(path: string, entry: ResolvedAttr): TemplateResult {
    const dirty = this.drafts.has(path);
    const save = this.canWrite
      ? html`
          <ix-icon-button
            icon="upload"
            size="16"
            variant=${dirty ? 'primary' : 'secondary'}
            ?disabled=${!dirty}
            title=${`${localize(MSG.detail.writeValue)} · ${entry.spec.attr}`}
            @click=${() => this.write(path, entry.spec)}
          ></ix-icon-button>
        `
      : html``;
    return html`
      <div class="attr ${entry.spec.kind === 'dyn' ? 'dyn' : ''}">
        <span class="attr-label">${localizeDir(attrLabel(entry.spec.label))}</span>
        ${this.renderEditor(path, entry)}${save}
      </div>
    `;
  }

  private renderEditor(path: string, entry: ResolvedAttr): TemplateResult {
    const draft = this.drafts.get(path);
    if (entry.spec.kind === 'bool') {
      const checked = draft === undefined ? isTruthy(entry.raw) : draft === 'true';
      return html`<ix-toggle
        class="editor"
        .checked=${checked}
        @checkedChange=${(e: CustomEvent<boolean>) => this.onDraft(path, String(e.detail))}
      ></ix-toggle>`;
    }
    if (entry.spec.kind === 'dyn') {
      const value = draft ?? (Array.isArray(entry.raw) ? entry.raw.map((item) => formatDynItem(item)).join('\n') : '');
      return html`<ix-textarea
        class="editor"
        .value=${value}
        rows="3"
        placeholder=${localize(MSG.configDetail.onePerLine)}
        @valueChange=${(e: CustomEvent<string>) => this.onDraft(path, e.detail)}
      ></ix-textarea>`;
    }
    const value = draft ?? this.formatAttr(entry.raw);
    if (entry.spec.kind === 'number') {
      return html`<ix-number-input
        class="editor"
        .value=${value}
        @valueChange=${(e: CustomEvent<number>) => this.onDraft(path, String(e.detail))}
      ></ix-number-input>`;
    }
    return html`<ix-input
      class="editor"
      .value=${value}
      @valueChange=${(e: CustomEvent<string>) => this.onDraft(path, e.detail)}
    ></ix-input>`;
  }

  private renderInfoBits(setBits: number[], statusRaw: string): TemplateResult {
    const set = new Set(setBits);
    const setCount = INFO_BITS.filter((bit) => set.has(bit.position)).length;
    const flags = INFO_BITS.map((bit) => {
      const on = set.has(bit.position);
      return html`<span class="flag ${on ? 'on' : ''}" title=${infoBitTitleMsg(bit.position, bit.meaning)}>${bit.name}</span>`;
    });
    return html`
      <div class="bits">
        <div class="bits-head" title="_status64 = ${statusRaw}">${localizeDir(MSG.configDetail.infoBits)} <span class="bits-summary">(${setCount} ${localize(MSG.configDetail.set)})</span></div>
        <div class="flag-list">${flags}</div>
      </div>
    `;
  }

  private renderUserBits(setBits: number[]): TemplateResult {
    const set = new Set(setBits);
    const cells = Array.from({ length: USER_BIT_COUNT }, (_unused, index) => {
      const bit = index + 1;
      const on = set.has(bit);
      return html`<span class="bit ${on ? 'on' : ''}" title="${localize(MSG.configDetail.userBitPrefix)} ${bit}${on ? ` (${localize(MSG.configDetail.set)})` : ''}">${bit}</span>`;
    });
    const summary = setBits.length === 0 ? localize(MSG.configDetail.noneSet) : setBits.join(', ');
    return html`
      <div class="bits">
        <div class="bits-head">${localizeDir(MSG.configDetail.userBits)} <span class="bits-summary">(${summary})</span></div>
        <div class="bit-grid">${cells}</div>
      </div>
    `;
  }

  private onDraft(path: string, value: string): void {
    this.drafts = new Map(this.drafts).set(path, value);
  }

  private reload(): void {
    this.snapshots = null;
    this.drafts = new Map();
    this.load();
  }

  private load(): void {
    if (this.name === '') {
      return;
    }
    this.loading = true;
    this.subs.add(
      forkJoin(CONFIG_SPECS.map((spec) => this.fetchConfig(this.name, spec))).subscribe({
        next: (snapshots) => {
          this.snapshots = snapshots;
          this.loading = false;
        },
        error: () => {
          this.snapshots = [];
          this.loading = false;
        }
      })
    );
  }

  /** Read every attribute of one config; keep the ones that resolve. */
  private fetchConfig(name: string, spec: ConfigSpec): Observable<ConfigSnapshot> {
    const reads = spec.attrs.map((attrSpec) =>
      this.api.dpGet(`${name}:${spec.config}..${attrSpec.attr}`).pipe(
        map((data) => ({ spec: attrSpec, raw: singleValue(data) })),
        catchError(() => of({ spec: attrSpec, raw: null as unknown }))
      )
    );
    return forkJoin(reads).pipe(
      map((resolved) => {
        const entries = resolved.filter((entry) => entry.raw != null);
        return { config: spec.config, label: spec.label, entries, available: entries.length > 0 } satisfies ConfigSnapshot;
      })
    );
  }

  private async write(path: string, spec: AttrSpec): Promise<void> {
    const draft = this.drafts.get(path);
    if (draft === undefined) {
      return;
    }
    const value = this.convertDraft(spec, draft);
    if (value === undefined) {
      this.setStatus(invalidAttrValueMsg(spec.attr), false);
      return;
    }
    try {
      const response = await fetch(DP_SET_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dpeName: path, value })
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) {
        const next = new Map(this.drafts);
        next.delete(path);
        this.drafts = next;
        this.setStatus(wroteAttrMsg(spec.attr), true);
        this.load();
      } else {
        this.setStatus(result.error ?? writeAttrRejectedMsg(spec.attr, response.status), false);
      }
    } catch (error) {
      this.setStatus(writeFailedMsg(String(error)), false);
    }
  }

  private convertDraft(spec: AttrSpec, draft: string): unknown {
    if (spec.kind === 'bool') {
      return draft === 'true';
    }
    if (spec.kind === 'dyn') {
      return convertDynList('string', draft);
    }
    return convertItem(spec.kind === 'number' ? 'float' : 'string', draft);
  }

  private setStatus(message: string, ok: boolean): void {
    this.status = message;
    this.statusOk = ok;
  }

  private formatAttr(value: unknown): string {
    if (value == null) {
      return '—';
    }
    if (typeof value === 'boolean') {
      return value ? 'true' : 'false';
    }
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }
}

// Guard registration: the page bundle may be evaluated more than once by the
// runtime (re-navigation / service worker), which would otherwise throw.
if (!customElements.get('wui-para-config-detail')) {
  customElements.define('wui-para-config-detail', WuiParaConfigDetail);
}
