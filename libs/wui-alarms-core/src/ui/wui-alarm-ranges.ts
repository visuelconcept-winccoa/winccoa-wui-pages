// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `<wui-alarm-ranges>` — the priority-range editor of the alarms module.
 *
 * One row per range: its abbreviation, its colour, and the WinCC OA alert-class
 * priority it starts at. The list is what the alarm view groups, filters, colours
 * and orders by, and it is stored in the module's configuration datapoint, so the
 * decision is the PROJECT's — the defaults shipped with the module are a seed for
 * a project nobody has configured yet, not a rule about how alert classes are
 * numbered.
 *
 * Editing is gated by the caller (`can-edit`, driven by the Application-Security
 * role): without it the dialog still opens, read-only, because seeing how the
 * ranges are set explains the list even to someone who may not change them.
 *
 * Emits `wui:close` when dismissed and `wui:save` once the datapoint is written.
 */
import { dialogCore } from '@visuelconcept/wui-kit/ui/dialog-styles.js';
import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { AlarmConfigStore } from '../data/alarm-config-store.js';
import { DEFAULT_RANGES, normaliseRanges, type AlarmRange } from '../types.js';
import { severityTokens } from './alarm-tokens.js';
import { rangeStyles } from './wui-alarm-ranges.styles.js';

/** Colour given to a freshly added range, until the operator picks one. */
const NEW_RANGE_COLOR = '#8B939C';
const ID_RADIX = 36;

export class WuiAlarmRanges extends LitElement {
  static override readonly styles = [severityTokens(), dialogCore(), rangeStyles()];

  /** Read-only when false (the `configure` role is not granted). */
  @property({ type: Boolean, attribute: 'can-edit' }) canEdit = false;

  @state() private rows: AlarmRange[] = [];
  @state() private busy = false;
  @state() private offline = false;
  @state() private notice = '';

  private readonly store = new AlarmConfigStore();

  override render(): TemplateResult {
    return html`
      <div class="overlay" @click=${this.close}>
        <div class="panel" @click=${(event: Event) => event.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h4">${localizeDir(MSG.ranges.title)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="hint">${localizeDir(MSG.ranges.intro)}</div>
            ${this.offline ? html`<div class="notice">${localizeDir(MSG.ranges.offline)}</div>` : nothing}
            ${this.notice === '' ? nothing : html`<div class="notice">${this.notice}</div>`}
            ${this.renderTable()}
          </div>
          <div class="panel-foot">
            ${this.canEdit
              ? html`<ix-button variant="secondary" ?disabled=${this.busy} @click=${this.reset}>
                  ${localizeDir(MSG.ranges.reset)}
                </ix-button>`
              : nothing}
            <span class="spacer"></span>
            <ix-button variant="secondary" @click=${this.close}>${localizeDir(MSG.ranges.cancel)}</ix-button>
            ${this.canEdit
              ? html`<ix-button ?disabled=${this.busy} @click=${() => void this.save()}>
                  ${localizeDir(MSG.ranges.save)}
                </ix-button>`
              : nothing}
          </div>
        </div>
      </div>
    `;
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.load();
  }

  private renderTable(): TemplateResult {
    return html`
      <table class="ranges">
        <thead>
          <tr>
            <th>${localizeDir(MSG.ranges.colAbbr)}</th>
            <th>${localizeDir(MSG.ranges.colColor)}</th>
            <th>${localizeDir(MSG.ranges.colMinPrior)}</th>
            <th>${localizeDir(MSG.ranges.colPreview)}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${this.rows.map((range, index) => this.renderRow(range, index))}
        </tbody>
      </table>
      ${this.rows.length === 0 ? html`<div class="hint">${localizeDir(MSG.ranges.empty)}</div>` : nothing}
      ${this.canEdit
        ? html`<ix-button variant="secondary" class="add" @click=${this.add}>
            <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.ranges.add)}
          </ix-button>`
        : nothing}
    `;
  }

  private renderRow(range: AlarmRange, index: number): TemplateResult {
    return html`
      <tr>
        <td>
          <input
            class="abbr"
            .value=${range.abbr}
            ?disabled=${!this.canEdit}
            @input=${(event: Event) => this.patch(index, { abbr: (event.target as HTMLInputElement).value })}
          />
        </td>
        <td>
          <input
            type="color"
            .value=${range.color}
            ?disabled=${!this.canEdit}
            @input=${(event: Event) => this.patch(index, { color: (event.target as HTMLInputElement).value })}
          />
        </td>
        <td>
          <input
            class="prior"
            type="number"
            .value=${String(range.minPrior)}
            ?disabled=${!this.canEdit}
            @input=${(event: Event) => this.patch(index, { minPrior: Number((event.target as HTMLInputElement).value) })}
          />
        </td>
        <td><span class="pill" style=${`background:${range.color}`}>${range.abbr || '—'}</span></td>
        <td>
          ${this.canEdit
            ? html`<ix-icon-button
                ghost
                size="16"
                icon="trashcan"
                title=${localize(MSG.ranges.remove)}
                @click=${() => this.removeRange(index)}
              ></ix-icon-button>`
            : nothing}
        </td>
      </tr>
    `;
  }

  private async load(): Promise<void> {
    const config = await this.store.load();
    this.rows = structuredClone(config.ranges);
    this.offline = this.store.offline;
  }

  private patch(index: number, change: Partial<AlarmRange>): void {
    this.rows = this.rows.map((range, position) => (position === index ? { ...range, ...change } : range));
  }

  private readonly add = (): void => {
    const lowest = this.rows.at(-1)?.minPrior ?? 0;
    const id = `r${Date.now().toString(ID_RADIX)}`;
    this.rows = [...this.rows, { id, abbr: '', color: NEW_RANGE_COLOR, minPrior: Math.max(0, lowest - 1) }];
  };

  private removeRange(index: number): void {
    this.rows = this.rows.filter((_range, position) => position !== index);
  }

  private readonly reset = (): void => {
    this.rows = structuredClone(DEFAULT_RANGES) as AlarmRange[];
  };

  /**
   * Persist, then close.
   *
   * The rows are normalised first (sorted worst-first, empty abbreviations filled
   * from the id) so what is stored is what the view will read back — an editor
   * that saves one order and displays another is how a range silently changes
   * meaning.
   */
  private async save(): Promise<void> {
    this.busy = true;
    this.notice = '';
    try {
      const ranges = normaliseRanges(this.rows);
      await this.store.save({ ranges });
      if (this.store.offline) {
        this.offline = true;
        this.notice = localize(MSG.ranges.saveFailed);
        return;
      }
      this.dispatchEvent(new CustomEvent('wui:save', { detail: ranges, bubbles: true, composed: true }));
      this.close();
    } catch {
      this.notice = localize(MSG.ranges.saveFailed);
    } finally {
      this.busy = false;
    }
  }

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };
}

// Guarded registration: the kit is vendored into several self-contained page
// bundles that share one CustomElementRegistry per SPA session.
if (!customElements.get('wui-alarm-ranges')) {
  customElements.define('wui-alarm-ranges', WuiAlarmRanges);
}
