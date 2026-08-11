// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The overview: every site the project holds, which is also the multi-site view.
 *
 * The one column that is not stored data is **In alarm** — the number of assets on
 * each site whose primary datapoint currently carries an active alert state. It is
 * counted from the live layer, so the overview answers "which site needs me now"
 * without opening any of them.
 *
 * Sites are grouped by their free-text `category`, which is what makes a mixed
 * project (water sites next to city districts) legible.
 *
 * Emits `wui:open` / `wui:edit` / `wui:delete` (`{ id }`) and `wui:create`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localize, localizeDir, siteCountMsg } from '../i18n.js';
import type { LiveState } from '../data/live.js';
import { bareDp } from '../drill.js';
import { normDp } from '../data/live.js';
import type { Site } from '../types.js';

@customElement('gis-site-table')
export class GisSiteTable extends LitElement {
  static override readonly styles = [IXCoreStyles, tableStyles()];

  @property({ attribute: false }) sites: readonly Site[] = [];

  /** Live alarm colours, used for the "In alarm" count. */
  @property({ attribute: false }) live: LiveState = {
    values: new Map(),
    alarmColors: new Map()
  };

  /** Editing actions are hidden without the Application-Security `edit` grant. */
  @property({ type: Boolean }) canEdit = false;

  /** Offer to seed the demo sites (only sensible on an empty project). */
  @property({ type: Boolean }) canSeed = false;

  override render(): TemplateResult {
    if (this.sites.length === 0) return this.renderEmpty();
    return html`
      <div class="head">
        <span class="count">${siteCountMsg(this.sites.length)}</span>
        <span class="grow"></span>
        ${this.renderCreate()}
      </div>
      <div class="scroll">
        <table>
          <thead>
            <tr>
              <th>${localizeDir(MSG.overview.colName)}</th>
              <th>${localizeDir(MSG.overview.colCategory)}</th>
              <th class="num">${localizeDir(MSG.overview.colAreas)}</th>
              <th class="num">${localizeDir(MSG.overview.colAssets)}</th>
              <th class="num">${localizeDir(MSG.overview.colAlarms)}</th>
              <th>${localizeDir(MSG.overview.colUpdated)}</th>
              <th class="actions"></th>
            </tr>
          </thead>
          <tbody>
            ${this.sorted().map((site) => this.renderRow(site))}
          </tbody>
        </table>
      </div>
    `;
  }

  private renderEmpty(): TemplateResult {
    return html`
      <div class="empty">
        <ix-icon name="map" size="32"></ix-icon>
        <ix-typography format="h4"
          >${localizeDir(MSG.overview.empty)}</ix-typography
        >
        <span class="hint">${localizeDir(MSG.overview.emptyHint)}</span>
        <div class="empty-actions">${this.renderCreate()}</div>
      </div>
    `;
  }

  private renderCreate(): TemplateResult | typeof nothing {
    if (!this.canEdit) return nothing;
    return html`
      ${
        this.canSeed
          ? html`<ix-button
              variant="secondary"
              @click=${() => this.emit('wui:seed')}
            >
              <ix-icon name="download" slot="icon"></ix-icon
              >${localizeDir(MSG.overview.seedDemo)}
            </ix-button>`
          : nothing
      }
      <ix-button @click=${() => this.emit('wui:create')}>
        <ix-icon name="plus" slot="icon"></ix-icon
        >${localizeDir(MSG.overview.create)}
      </ix-button>
    `;
  }

  private renderRow(site: Site): TemplateResult {
    const alarms = this.alarmCount(site);
    return html`
      <tr @dblclick=${() => this.emit('wui:open', site.id)}>
        <td>
          <button class="link" @click=${() => this.emit('wui:open', site.id)}>
            ${site.name}
          </button>
          ${site.description ? html`<div class="desc">${site.description}</div>` : nothing}
        </td>
        <td>
          ${site.category ? html`<span class="chip">${site.category}</span>` : nothing}
        </td>
        <td class="num">${site.areas.length}</td>
        <td class="num">${site.assets.length}</td>
        <td class="num">
          ${alarms > 0 ? html`<span class="alarm-count">${alarms}</span>` : html`<span class="zero">0</span>`}
        </td>
        <td class="stamp">${site.updatedAt || localize(MSG.overview.never)}</td>
        <td class="actions">
          <ix-icon-button
            ghost
            icon="open-external"
            title=${localize(MSG.overview.open)}
            @click=${() => this.emit('wui:open', site.id)}
          ></ix-icon-button>
          ${
            this.canEdit
              ? html`
                  <ix-icon-button
                    ghost
                    icon="cogwheel"
                    title=${localize(MSG.overview.rename)}
                    @click=${() => this.emit('wui:edit', site.id)}
                  ></ix-icon-button>
                  <ix-icon-button
                    ghost
                    icon="trashcan"
                    title=${localize(MSG.overview.remove)}
                    @click=${() => this.emit('wui:delete', site.id)}
                  ></ix-icon-button>
                `
              : nothing
          }
        </td>
      </tr>
    `;
  }

  /** Assets whose primary datapoint is in an active alert state. */
  private alarmCount(site: Site): number {
    let count = 0;
    for (const asset of site.assets) {
      const dp = asset.dp.trim();
      if (!dp) continue;
      if (this.live.alarmColors.get(normDp(bareDp(dp)))) count += 1;
    }
    return count;
  }

  /** Grouped by category, then by name — a stable order across workstations. */
  private sorted(): Site[] {
    return [...this.sites].sort((first, second) => {
      const byCategory = (first.category ?? '').localeCompare(
        second.category ?? '',
        undefined,
        { sensitivity: 'base' }
      );
      if (byCategory !== 0) return byCategory;
      return first.name.localeCompare(second.name, undefined, {
        numeric: true,
        sensitivity: 'base'
      });
    });
  }

  private emit(type: string, id?: string): void {
    const detail = id === undefined ? {} : { id };
    const init = { detail, bubbles: true, composed: true };
    // eslint-disable-next-line no-restricted-syntax -- `type` is a fixed internal `wui:*` event name; the rule only validates string literals.
    this.dispatchEvent(new CustomEvent(type, init));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function tableStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      gap: 0.5rem;
      color: var(--theme-color-std-text);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .head .grow {
      flex: 1;
    }
    .count {
      color: var(--theme-color-soft-text);
      font-size: 0.9rem;
    }
    .scroll {
      flex: 1;
      min-height: 0;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      text-align: left;
      padding: 0.5rem 0.75rem;
      background: var(--theme-color-2);
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
    }
    tbody td {
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid
        var(--theme-color-ghost-bdr, var(--theme-color-soft-bdr));
      vertical-align: top;
    }
    tbody tr:hover {
      background: var(--theme-color-3);
    }
    th.num,
    td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    th.actions,
    td.actions {
      text-align: right;
      white-space: nowrap;
      width: 1%;
    }
    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--theme-color-primary);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      text-align: left;
    }
    .link:hover {
      text-decoration: underline;
    }
    .desc {
      margin-top: 0.125rem;
      max-width: 46ch;
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
    }
    .chip {
      display: inline-block;
      padding: 0.0625rem 0.4375rem;
      border-radius: 999px;
      border: 1px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
      white-space: nowrap;
    }
    .stamp {
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
      white-space: nowrap;
    }
    .zero {
      color: var(--theme-color-soft-text);
    }
    .alarm-count {
      display: inline-block;
      min-width: 1.5rem;
      padding: 0.0625rem 0.375rem;
      border-radius: 999px;
      background: var(--theme-color-alarm);
      color: var(--theme-color-inv-text, #fff);
      font-weight: 700;
      text-align: center;
    }
    .empty {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      color: var(--theme-color-soft-text);
    }
    .empty-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }
  `;
}
