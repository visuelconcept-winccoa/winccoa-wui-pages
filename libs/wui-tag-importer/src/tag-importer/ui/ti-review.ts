// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Step — review the generated plan and tune it. Sections are stacked vertically:
 * options, summary, datapoint TYPES (with per-type "create new / map to an
 * existing type + extend" and, for shared nested types, keep/flatten override),
 * DATAPOINTS, and ADDRESS CONFIGS (filter + per-row direction IN vs IN/OUT,
 * default IN/OUT, with bulk direction for the checked rows). Emits `wui:prefix`,
 * `wui:hybrid`, `wui:bind`, `wui:typeoverride` ({id,keep}), `wui:typemapping`
 * ({id,target?,extend}), `wui:setdirection` ({dpes,direction}), `wui:dryrun`,
 * `wui:apply`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { TypeDecision } from '../core/generate.js';
import type { ApplyItemResult, ApplyResult, ImportPlan, PlanAddress } from '../core/plan.js';
import { summarize } from '../core/plan.js';
import { DpAddressDirection } from '../core/opcua-mapping.js';
import { MSG, localize, localizeDir } from '../i18n.js';

const DIR_IN = DpAddressDirection.INPUT_POLL;
const DIR_IO = DpAddressDirection.IO_POLL;
const ADDRESS_PREVIEW_LIMIT = 500;
const SHARED_MIN = 2;

export class TiReview extends LitElement {
  static override readonly styles = [IXCoreStyles, reviewStyles()];

  @property({ attribute: false }) plan: ImportPlan | null = null;
  @property({ attribute: false }) decisions: TypeDecision[] = [];
  @property({ attribute: false }) existingTypes: string[] = [];
  @property({ attribute: false }) typeMapping: Record<string, { target?: string; extend: boolean }> = {};
  @property({ type: String }) typePrefix = '';
  @property({ type: Boolean }) hybrid = true;
  @property({ type: Boolean }) hasConnection = false;
  @property({ type: Boolean }) bindAddresses = true;
  @property({ type: Boolean }) busy = false;
  @property({ type: Boolean }) canApply = true;
  @property({ attribute: false }) dryRun: ApplyResult | null = null;

  @state() private addrFilter = '';
  @state() private checked = new Set<string>();

  override render(): TemplateResult {
    const plan = this.plan;
    if (!plan) return html`<div class="empty">${localizeDir(MSG.review.empty)}</div>`;
    const s = summarize(plan);
    return html`
      ${this.renderOptionsRow()}
      ${this.renderSummary(s.typesNew, s.typesExisting, s.dpsNew, s.dpsExisting, s.addresses, s.warnings)}
      ${plan.warnings.length > 0 ? this.renderWarnings(plan.warnings) : nothing}
      <div class="sections">
        ${this.renderTypes(plan)}
        ${this.renderDps(plan)}
        ${plan.addresses.length > 0 ? this.renderAddresses(plan) : nothing}
      </div>
      ${this.dryRun ? this.renderDryRun(this.dryRun) : nothing}
      ${this.canApply ? nothing : html`<div class="forbidden">${localizeDir(MSG.common.forbidden)}</div>`}
      <div class="actions">
        <ix-button variant="secondary" ?disabled=${this.busy || !this.canApply} @click=${() => this.fire(new CustomEvent('wui:dryrun', { bubbles: true, composed: true }))}>
          ${localizeDir(MSG.actions.dryRun)}
        </ix-button>
        <ix-button
          variant="primary"
          ?disabled=${this.busy || !this.canApply || plan.types.length + plan.dps.length === 0}
          @click=${() => this.fire(new CustomEvent('wui:apply', { bubbles: true, composed: true }))}
        >
          ${this.busy ? localizeDir(MSG.actions.applying) : localizeDir(MSG.actions.apply)}
        </ix-button>
      </div>
    `;
  }

  private fire(event: CustomEvent): void {
    this.dispatchEvent(event);
  }

  private renderOptionsRow(): TemplateResult {
    return html`<div class="options">
      <label>
        <span>${localizeDir(MSG.options.prefix)}</span>
        <input
          type="text"
          .value=${this.typePrefix}
          placeholder="Opc_"
          @change=${(e: Event) => this.fire(new CustomEvent('wui:prefix', { detail: (e.target as HTMLInputElement).value, bubbles: true, composed: true }))}
        />
      </label>
      <label class="check" title=${localize(MSG.options.hybridHint)}>
        <input
          type="checkbox"
          .checked=${this.hybrid}
          @change=${(e: Event) => this.fire(new CustomEvent('wui:hybrid', { detail: (e.target as HTMLInputElement).checked, bubbles: true, composed: true }))}
        />
        <span>${localizeDir(MSG.options.hybrid)}</span>
      </label>
      ${this.hasConnection
        ? html`<label class="check">
            <input
              type="checkbox"
              .checked=${this.bindAddresses}
              @change=${(e: Event) => this.fire(new CustomEvent('wui:bind', { detail: (e.target as HTMLInputElement).checked, bubbles: true, composed: true }))}
            />
            <span>${localizeDir(MSG.bind.label)}</span>
          </label>`
        : nothing}
    </div>`;
  }

  private renderSummary(tn: number, te: number, dn: number, de: number, addr: number, warn: number): TemplateResult {
    const chip = (n: number, label: typeof MSG.summary.typesNew, tone: string): TemplateResult => html`<span class="chip ${tone}">${n} ${localizeDir(label)}</span>`;
    return html`<div class="summary">
      ${chip(tn, MSG.summary.typesNew, 'new')}${te > 0 ? chip(te, MSG.summary.typesExisting, 'skip') : nothing}
      ${chip(dn, MSG.summary.dpsNew, 'new')}${de > 0 ? chip(de, MSG.summary.dpsExisting, 'skip') : nothing}
      ${addr > 0 ? chip(addr, MSG.summary.addresses, 'addr') : nothing}
      ${warn > 0 ? chip(warn, MSG.summary.warnings, 'warn') : nothing}
    </div>`;
  }

  private renderWarnings(warnings: string[]): TemplateResult {
    return html`<details class="warnings">
      <summary>${warnings.length} ${localizeDir(MSG.summary.warnings)}</summary>
      <ul>
        ${warnings.map((w) => html`<li>${w}</li>`)}
      </ul>
    </details>`;
  }

  // --- Types ------------------------------------------------------------------

  private renderTypes(plan: ImportPlan): TemplateResult {
    const instantiated = this.decisions.filter((d) => d.instantiated);
    const candidates = this.decisions.filter((d) => d.referenced && !d.instantiated);
    return html`<section>
      <h3>${localizeDir(MSG.review.types)} <span class="count">${plan.types.length}</span></h3>
      ${instantiated.length > 0 ? html`<div class="maprows">${instantiated.map((d) => this.renderMapRow(d))}</div>` : nothing}
      ${candidates.length > 0 ? html`<div class="overrides">${candidates.map((d) => this.renderOverride(d))}</div>` : nothing}
    </section>`;
  }

  private renderMapRow(d: TypeDecision): TemplateResult {
    const mapping = this.typeMapping[d.id];
    const target = mapping?.target ?? '';
    return html`<div class="maprow">
      <span class="mp-name" title=${d.displayName}>${d.displayName}</span>
      <select
        .value=${target}
        @change=${(e: Event) => this.onMapping(d.id, (e.target as HTMLSelectElement).value, mapping?.extend ?? true)}
      >
        <option value="" ?selected=${target === ''}>${localize(MSG.review.createNew)} · ${d.proposedName}</option>
        ${this.existingTypes.map((t) => html`<option value=${t} ?selected=${t === target}>${localize(MSG.review.mapTo)}: ${t}</option>`)}
      </select>
      ${target
        ? html`<label class="check" title=${localize(MSG.review.extendType)}>
            <input type="checkbox" .checked=${mapping?.extend ?? true} @change=${(e: Event) => this.onMapping(d.id, target, (e.target as HTMLInputElement).checked)} />
            <span>${localizeDir(MSG.review.extendType)}</span>
          </label>`
        : nothing}
    </div>`;
  }

  private renderOverride(d: TypeDecision): TemplateResult {
    return html`<label class="check" title=${d.displayName}>
      <input
        type="checkbox"
        .checked=${d.kept}
        @change=${(e: Event) =>
          this.fire(new CustomEvent('wui:typeoverride', { detail: { id: d.id, keep: (e.target as HTMLInputElement).checked }, bubbles: true, composed: true }))}
      />
      <span>${d.displayName}</span>
      <span class="pill">${d.kept ? localizeDir(MSG.review.keepRef) : localizeDir(MSG.review.flatten)}</span>
      ${d.sharedCount >= SHARED_MIN ? html`<span class="pill shared">×${d.sharedCount}</span>` : nothing}
    </label>`;
  }

  private onMapping(id: string, target: string, extend: boolean): void {
    this.fire(new CustomEvent('wui:typemapping', { detail: { id, target: target || undefined, extend }, bubbles: true, composed: true }));
  }

  // --- Datapoints -------------------------------------------------------------

  private renderDps(plan: ImportPlan): TemplateResult {
    return html`<section>
      <h3>${localizeDir(MSG.review.dps)} <span class="count">${plan.dps.length}</span></h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>${localizeDir(MSG.review.colName)}</th>
              <th>${localizeDir(MSG.review.colType)}</th>
            </tr>
          </thead>
          <tbody>
            ${plan.dps.map(
              (d) => html`<tr>
                <td>
                  <input
                    class="dpname"
                    type="text"
                    .value=${d.dpName}
                    @change=${(e: Event) =>
                      this.fire(new CustomEvent('wui:dpname', { detail: { key: d.key, name: (e.target as HTMLInputElement).value }, bubbles: true, composed: true }))}
                  />
                </td>
                <td class="muted">${d.dpType}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    </section>`;
  }

  // --- Address configs --------------------------------------------------------

  private filteredAddresses(plan: ImportPlan): PlanAddress[] {
    const f = this.addrFilter.trim().toLowerCase();
    if (!f) return plan.addresses;
    return plan.addresses.filter((a) => a.dpe.toLowerCase().includes(f) || a.nodeId.toLowerCase().includes(f));
  }

  private renderAddresses(plan: ImportPlan): TemplateResult {
    const rows = this.filteredAddresses(plan);
    const shown = rows.slice(0, ADDRESS_PREVIEW_LIMIT);
    return html`<section>
      <h3>${localizeDir(MSG.review.addresses)} <span class="count">${plan.addresses.length}</span></h3>
      <div class="addr-toolbar">
        <input type="search" placeholder=${localize(MSG.review.filter)} .value=${this.addrFilter} @input=${(e: Event) => (this.addrFilter = (e.target as HTMLInputElement).value)} />
        <ix-button variant="secondary" outline @click=${() => this.checkFiltered(rows)}>${localizeDir(MSG.review.checkFiltered)}</ix-button>
        <ix-button variant="secondary" outline ?disabled=${this.checked.size === 0} @click=${() => (this.checked = new Set())}>${localizeDir(MSG.review.uncheckAll)}</ix-button>
        <div class="grow"></div>
        <ix-button variant="secondary" ?disabled=${this.checked.size === 0} @click=${() => this.setChecked(DIR_IN)}>${localizeDir(MSG.review.setIn)}</ix-button>
        <ix-button variant="secondary" ?disabled=${this.checked.size === 0} @click=${() => this.setChecked(DIR_IO)}>${localizeDir(MSG.review.setIo)}</ix-button>
      </div>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th class="tick"></th>
              <th>${localizeDir(MSG.review.colDpe)}</th>
              <th>${localizeDir(MSG.review.colNode)}</th>
              <th>${localizeDir(MSG.review.colDir)}</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map((a) => this.renderAddrRow(a))}
          </tbody>
        </table>
        ${rows.length > shown.length ? html`<div class="more">… +${rows.length - shown.length}</div>` : nothing}
      </div>
    </section>`;
  }

  private renderAddrRow(a: PlanAddress): TemplateResult {
    return html`<tr>
      <td class="tick">
        <input type="checkbox" .checked=${this.checked.has(a.dpe)} @change=${() => this.toggleCheck(a.dpe)} />
      </td>
      <td>${a.dpe}</td>
      <td class="muted">${a.nodeId}</td>
      <td>
        <select .value=${String(a.direction)} @change=${(e: Event) => this.setOne(a.dpe, Number((e.target as HTMLSelectElement).value))}>
          <option value=${DIR_IO} ?selected=${a.direction === DIR_IO}>${localize(MSG.review.dirIo)}</option>
          <option value=${DIR_IN} ?selected=${a.direction === DIR_IN}>${localize(MSG.review.dirIn)}</option>
        </select>
      </td>
    </tr>`;
  }

  private toggleCheck(dpe: string): void {
    const next = new Set(this.checked);
    if (next.has(dpe)) next.delete(dpe);
    else next.add(dpe);
    this.checked = next;
  }

  private checkFiltered(rows: PlanAddress[]): void {
    const next = new Set(this.checked);
    for (const a of rows) next.add(a.dpe);
    this.checked = next;
  }

  private setOne(dpe: string, direction: number): void {
    this.fire(new CustomEvent('wui:setdirection', { detail: { dpes: [dpe], direction }, bubbles: true, composed: true }));
  }

  private setChecked(direction: number): void {
    this.fire(new CustomEvent('wui:setdirection', { detail: { dpes: [...this.checked], direction }, bubbles: true, composed: true }));
  }

  // --- Dry-run ----------------------------------------------------------------

  private renderDryRun(result: ApplyResult): TemplateResult {
    const failed = result.results.filter((r) => r.status === 'failed');
    return html`<div class="dryrun">
      <strong>${localizeDir(MSG.actions.dryRun)}</strong>:
      ${result.results.filter((r) => r.status === 'created').length} ${localizeDir(MSG.review.willCreate)},
      ${result.results.filter((r) => r.status === 'skipped').length} ${localizeDir(MSG.review.exists)}
      ${failed.length > 0 ? this.renderFailedList(failed) : nothing}
    </div>`;
  }

  private renderFailedList(failed: ApplyItemResult[]): TemplateResult {
    return html`<ul class="fail">
      ${failed.map((r) => html`<li>${r.kind} ${r.name}: ${r.error}</li>`)}
    </ul>`;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function reviewStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .empty {
      opacity: 0.7;
      padding: 2rem;
      text-align: center;
    }
    .options {
      display: flex;
      gap: 1.5rem;
      align-items: center;
      flex-wrap: wrap;
      padding-bottom: 0.75rem;
    }
    .options label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.85rem;
    }
    .options input[type='text'] {
      padding: 0.35rem;
      background: var(--theme-color-1);
      color: var(--theme-color-text);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
    }
    label.check {
      flex-direction: row !important;
      align-items: center;
      gap: 0.4rem;
    }
    .summary {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding-bottom: 0.5rem;
    }
    .chip {
      font-size: 0.78rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      border: 1px solid var(--theme-color-soft-bdr);
    }
    .chip.new {
      border-color: var(--theme-color-primary);
      color: var(--theme-color-primary);
    }
    .chip.warn {
      color: var(--theme-color-warning, #c60);
      border-color: var(--theme-color-warning, #c60);
    }
    .warnings {
      font-size: 0.82rem;
      margin-bottom: 0.5rem;
    }
    .warnings ul {
      margin: 0.3rem 0;
      padding-left: 1.2rem;
    }
    .sections {
      display: flex;
      flex-direction: column;
      gap: 1.25rem;
    }
    section {
      min-width: 0;
    }
    h3 {
      font-size: 0.95rem;
      margin: 0.25rem 0 0.5rem;
    }
    h3 .count {
      opacity: 0.6;
      font-weight: 400;
    }
    .scroll {
      max-height: 22rem;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    th,
    td {
      text-align: left;
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      white-space: nowrap;
    }
    td.muted {
      opacity: 0.7;
    }
    th.tick,
    td.tick {
      width: 1.5rem;
      text-align: center;
    }
    .maprows {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      margin-bottom: 0.6rem;
    }
    .maprow {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      font-size: 0.82rem;
    }
    .mp-name {
      min-width: 8rem;
      font-weight: 600;
    }
    .maprow select,
    .addr-toolbar input,
    td select,
    td input.dpname {
      padding: 0.25rem;
      background: var(--theme-color-1);
      color: var(--theme-color-text);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
    }
    td input.dpname {
      min-width: 12rem;
    }
    .overrides {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      font-size: 0.8rem;
    }
    .pill {
      font-size: 0.7rem;
      padding: 0.05rem 0.4rem;
      border-radius: 999px;
      background: var(--theme-color-2);
    }
    .pill.shared {
      background: var(--theme-color-primary);
      color: var(--theme-color-primary-contrast, #fff);
    }
    .addr-toolbar {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      flex-wrap: wrap;
      padding-bottom: 0.5rem;
    }
    .addr-toolbar .grow {
      flex: 1;
    }
    .more {
      padding: 0.3rem 0.5rem;
      opacity: 0.6;
      font-size: 0.8rem;
    }
    .dryrun {
      margin-top: 0.75rem;
      padding: 0.5rem 0.75rem;
      border-left: 3px solid var(--theme-color-primary);
      background: var(--theme-color-2);
      font-size: 0.85rem;
    }
    .dryrun .fail {
      color: var(--theme-color-alarm, #c00);
      margin: 0.3rem 0 0;
      padding-left: 1.2rem;
    }
    .forbidden {
      font-size: 0.82rem;
      color: var(--theme-color-warning, #c60);
      text-align: right;
      padding-top: 0.5rem;
    }
    .actions {
      display: flex;
      gap: 0.6rem;
      justify-content: flex-end;
      padding-top: 1rem;
    }
  `;
}

if (!customElements.get('ti-review')) {
  customElements.define('ti-review', TiReview);
}
