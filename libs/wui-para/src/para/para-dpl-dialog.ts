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

/** Selectable export categories, in canonical TDACOPH order. */
const DPL_FILTERS: { letter: string; label: string; hint: string }[] = [
  { letter: 'T', label: 'Types (définitions)', hint: 'Définitions des DP-Types' },
  { letter: 'D', label: 'Datapoints (instances)', hint: 'La liste des datapoints' },
  { letter: 'P', label: 'Parametrization / configs', hint: 'Tous les configs (incl. _common, _pv_range, _alert_hdl…)' },
  { letter: 'O', label: 'Original values', hint: 'Valeurs courantes (_original.._value)' },
  { letter: 'A', label: 'Aliases & commentaires', hint: 'Alias et commentaires des DP/DPE' },
  { letter: 'C', label: 'CNS views', hint: 'Vues/arbres CNS' },
  { letter: 'H', label: 'Timestamps des configs', hint: 'Horodatages sur les configs (modifie P)' }
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
            <span class="title">Export DPL — contenu</span>
            <ix-icon-button icon="close" ghost @click=${this.cancel}></ix-icon-button>
          </div>
          <div class="body">
            <div class="summary">
              Sélection : ${this.typeCount} type(s), ${this.dpCount} datapoint(s).
            </div>
            <div class="filters">
              ${DPL_FILTERS.map((f) => this.renderRow(f))}
            </div>
            ${filter === ''
              ? html`<div class="warn">Cochez au moins une catégorie.</div>`
              : nothing}
          </div>
          <div class="footer">
            <ix-button outline @click=${this.cancel}>Annuler</ix-button>
            <ix-button variant="primary" icon="download" ?disabled=${filter === ''} @click=${this.confirm}>
              Exporter
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  private renderRow(f: { letter: string; label: string; hint: string }): TemplateResult {
    return html`
      <label class="filter-row" title=${f.hint}>
        <input
          type="checkbox"
          .checked=${this.checked.has(f.letter)}
          @change=${() => this.toggle(f.letter)}
        />
        <span class="filter-label">${f.label}</span>
        <span class="filter-hint">${f.hint}</span>
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
