// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Step 3 — review the generated plan and tune it: DPType name prefix, the hybrid
 * typeref policy, and a per-type keep/flatten override for shared nested types.
 * Shows the datapoint types, datapoints and (online) address configs that will
 * be created, plus a dry-run summary. Emits `wui:prefix`, `wui:hybrid`,
 * `wui:typeoverride` ({ id, keep }), `wui:dryrun` and `wui:apply`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import type { TypeDecision } from '../core/generate.js';
import type { ApplyItemResult, ApplyResult, ImportPlan } from '../core/plan.js';
import { summarize } from '../core/plan.js';
import { MSG, localize, localizeDir } from '../i18n.js';

const ADDRESS_PREVIEW_LIMIT = 200;

export class TiReview extends LitElement {
  static override readonly styles = [IXCoreStyles, reviewStyles()];

  @property({ attribute: false }) plan: ImportPlan | null = null;
  @property({ attribute: false }) decisions: TypeDecision[] = [];
  @property({ type: String }) typePrefix = '';
  @property({ type: Boolean }) hybrid = true;
  /** A connection is chosen, so addresses can be written (enables the bind toggle). */
  @property({ type: Boolean }) hasConnection = false;
  /** Whether to write OPC UA address configs for the created datapoints. */
  @property({ type: Boolean }) bindAddresses = true;
  @property({ type: Boolean }) busy = false;
  /** Whether the operator may run the dry-run / apply (Application Security 'create'). */
  @property({ type: Boolean }) canApply = true;
  @property({ attribute: false }) dryRun: ApplyResult | null = null;

  override render(): TemplateResult {
    const plan = this.plan;
    if (!plan) return html`<div class="empty">${localizeDir(MSG.review.empty)}</div>`;
    const s = summarize(plan);
    return html`
      ${this.renderOptionsRow()}
      ${this.renderSummary(s.typesNew, s.typesExisting, s.dpsNew, s.dpsExisting, s.addresses, s.warnings)}
      ${plan.warnings.length > 0 ? this.renderWarnings(plan.warnings) : nothing}
      <div class="tables">
        ${this.renderTypes(plan)}
        ${this.renderDps(plan)}
        ${plan.addresses.length > 0 ? this.renderAddresses(plan) : nothing}
      </div>
      ${this.dryRun ? this.renderDryRun(this.dryRun) : nothing}
      ${this.canApply ? nothing : html`<div class="forbidden">${localizeDir(MSG.common.forbidden)}</div>`}
      <div class="actions">
        <ix-button
          variant="secondary"
          ?disabled=${this.busy || !this.canApply}
          @click=${() => this.fire(new CustomEvent('wui:dryrun', { bubbles: true, composed: true }))}
        >
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
    const chip = (n: number, label: typeof MSG.summary.typesNew, tone: string): TemplateResult =>
      html`<span class="chip ${tone}">${n} ${localizeDir(label)}</span>`;
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

  private renderTypes(plan: ImportPlan): TemplateResult {
    const candidates = this.decisions.filter((d) => d.referenced && !d.instantiated);
    return html`<section>
      <h3>${localizeDir(MSG.review.types)} <span class="count">${plan.types.length}</span></h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>${localizeDir(MSG.review.colName)}</th>
              <th>${localizeDir(MSG.review.colType)}</th>
            </tr>
          </thead>
          <tbody>
            ${plan.types.map(
              (t) => html`<tr>
                <td>${t.typeName}</td>
                <td class="muted">${t.displayName}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
      ${candidates.length > 0
        ? html`<div class="overrides">
            ${candidates.map(
              (d) => html`<label class="check" title=${d.displayName}>
                <input
                  type="checkbox"
                  .checked=${d.kept}
                  @change=${(e: Event) =>
                    this.fire(
                      new CustomEvent('wui:typeoverride', {
                        detail: { id: d.id, keep: (e.target as HTMLInputElement).checked },
                        bubbles: true,
                        composed: true
                      })
                    )}
                />
                <span>${d.displayName}</span>
                <span class="pill">${d.kept ? localizeDir(MSG.review.keepRef) : localizeDir(MSG.review.flatten)}</span>
                ${d.sharedCount > 1 ? html`<span class="pill shared">×${d.sharedCount}</span>` : nothing}
              </label>`
            )}
          </div>`
        : nothing}
    </section>`;
  }

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
                <td>${d.dpName}</td>
                <td class="muted">${d.dpType}</td>
              </tr>`
            )}
          </tbody>
        </table>
      </div>
    </section>`;
  }

  private renderAddresses(plan: ImportPlan): TemplateResult {
    const shown = plan.addresses.slice(0, ADDRESS_PREVIEW_LIMIT);
    return html`<section>
      <h3>${localizeDir(MSG.review.addresses)} <span class="count">${plan.addresses.length}</span></h3>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>${localizeDir(MSG.review.colDpe)}</th>
              <th>${localizeDir(MSG.review.colNode)}</th>
            </tr>
          </thead>
          <tbody>
            ${shown.map(
              (a) => html`<tr>
                <td>${a.dpe}</td>
                <td class="muted">${a.nodeId}</td>
              </tr>`
            )}
          </tbody>
        </table>
        ${plan.addresses.length > shown.length ? html`<div class="more">… +${plan.addresses.length - shown.length}</div>` : nothing}
      </div>
    </section>`;
  }

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
    .tables {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      align-items: flex-start;
    }
    section {
      flex: 1 1 280px;
      min-width: 0;
    }
    h3 {
      font-size: 0.95rem;
      margin: 0.5rem 0;
    }
    h3 .count {
      opacity: 0.6;
      font-weight: 400;
    }
    .scroll {
      max-height: 20rem;
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
    .overrides {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-top: 0.5rem;
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
