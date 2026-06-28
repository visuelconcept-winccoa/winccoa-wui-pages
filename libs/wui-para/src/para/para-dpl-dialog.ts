// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA "Export DPL options" dialog.
 *
 * Lets the user pick which record kinds the WCCOAasciiSQLite export should
 * include — a subset of its TDACOPH `-filter` letters. Emits `wui:export` with
 * the assembled filter string (canonical TDACOPH order) or `wui:cancel`.
 *
 * The export object selection (which DPs / DP-types) is decided by the
 * checkboxes in wui-para-nav; this dialog only chooses the content categories.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { MSG, localize, localizeDir } from './i18n.js';

/** Selectable export categories, in canonical TDACOPH order. */
const DPL_FILTERS: { letter: string; label: MultiLangString; hint: MultiLangString }[] = [
  { letter: 'T', label: MSG.dplDialog.fT, hint: MSG.dplDialog.fTHint },
  { letter: 'D', label: MSG.dplDialog.fD, hint: MSG.dplDialog.fDHint },
  { letter: 'P', label: MSG.dplDialog.fP, hint: MSG.dplDialog.fPHint },
  { letter: 'O', label: MSG.dplDialog.fO, hint: MSG.dplDialog.fOHint },
  { letter: 'A', label: MSG.dplDialog.fA, hint: MSG.dplDialog.fAHint },
  { letter: 'C', label: MSG.dplDialog.fC, hint: MSG.dplDialog.fCHint },
  { letter: 'H', label: MSG.dplDialog.fH, hint: MSG.dplDialog.fHHint }
];

export class WuiParaDplDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  /** Number of DP-types selected for export (shown as a summary). */
  @property({ type: Number }) typeCount = 0;
  /** Number of datapoints selected for export (shown as a summary). */
  @property({ type: Number }) dpCount = 0;

  /** Checked category letters (default: full export). */
  @state() private checked = new Set(DPL_FILTERS.map((f) => f.letter));

  override render(): TemplateResult {
    const filter = this.buildFilter();
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="header">
            <ix-icon name="download" size="24"></ix-icon>
            <span class="title">${localizeDir(MSG.dplDialog.title)}</span>
            <ix-icon-button icon="close" ghost @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="body">
            <div class="summary">
              ${localizeDir(MSG.dplDialog.summaryPre)} ${this.typeCount} ${localizeDir(MSG.dplDialog.summaryTypes)}, ${this.dpCount} ${localizeDir(MSG.dplDialog.summaryDps)}.
            </div>
            <div class="filters">
              ${DPL_FILTERS.map((f) => this.renderRow(f))}
            </div>
            ${filter === ''
              ? html`<div class="warn">${localizeDir(MSG.dplDialog.pickOne)}</div>`
              : nothing}
          </div>
          <div class="footer">
            <ix-button outline @click=${this.cancel}>${localizeDir(MSG.dplDialog.cancel)}</ix-button>
            <ix-button variant="primary" icon="download" ?disabled=${filter === ''} @click=${this.confirm}>
              ${localizeDir(MSG.dplDialog.export)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderRow(f: { letter: string; label: MultiLangString; hint: MultiLangString }): TemplateResult {
    return html`
      <label class="filter-row" title=${localize(f.hint)}>
        <input
          type="checkbox"
          .checked=${this.checked.has(f.letter)}
          @change=${() => this.toggle(f.letter)}
        />
        <span class="filter-label">${localizeDir(f.label)}</span>
        <span class="filter-hint">${localizeDir(f.hint)}</span>
      </label>
    `;
  }

  private toggle(letter: string): void {
    const next = new Set(this.checked);
    if (next.has(letter)) {
      next.delete(letter);
    } else {
      next.add(letter);
    }
    this.checked = next;
  }

  /** Letters in canonical TDACOPH order. */
  private buildFilter(): string {
    return DPL_FILTERS.filter((f) => this.checked.has(f.letter)).map((f) => f.letter).join('');
  }

  private cancel(): void {
    this.dispatchEvent(new CustomEvent('wui:cancel', { bubbles: true, composed: true }));
  }

  private confirm(): void {
    const filter = this.buildFilter();
    if (filter === '') {
      return;
    }
    this.dispatchEvent(new CustomEvent('wui:export', { detail: { filter }, bubbles: true, composed: true }));
  }
}

function dialogStyles(): ReturnType<typeof css> {
  return css`
    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 9999;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .panel {
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      width: 460px;
      max-width: 92vw;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }
    .header,
    .footer {
      padding: 0.75rem 1rem;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .header {
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .footer {
      border-top: 1px solid var(--theme-color-soft-bdr);
      justify-content: flex-end;
    }
    .body {
      padding: 1rem;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .title {
      font-weight: 600;
      flex: 1;
    }
    .summary {
      font-size: 0.8125rem;
      color: var(--theme-color-soft-text);
    }
    .filters {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    .filter-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      cursor: pointer;
    }
    .filter-row input {
      accent-color: var(--theme-color-primary);
      flex-shrink: 0;
    }
    .filter-label {
      font-size: 0.875rem;
      flex-shrink: 0;
    }
    .filter-hint {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .warn {
      color: var(--theme-color-warning, #d9822b);
      font-size: 0.8125rem;
    }
  `;
}

if (!customElements.get('wui-para-dpl-dialog')) {
  customElements.define('wui-para-dpl-dialog', WuiParaDplDialog);
}
