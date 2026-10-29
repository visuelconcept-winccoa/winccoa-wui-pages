// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Compact list of the host instances (issue 39): state badge (checked over vRPC by the
 * aggregator, in the same `/managers` request), last seen (`.updated`), agent version, an
 * optional "invalid instances only" filter, and — with the `manage-instances` grant
 * (`canDelete`) — a "Delete instance" action, offered only for an instance whose agent does not
 * answer and never for the aggregator's own node. Presentational: it emits
 * `wui:deleteinstance` (detail: the `Instance`) and the page confirms, calls and traces.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { MSG, STATE_HINTS, STATE_LABELS, agoLabel, localize, localizeDir, serverLabel, shortDateLabel } from '../i18n.js';
import { canOfferDelete, countInvalid, filterInstances, instanceState, isLongUnseen, lastSeenAgeMs, stateTone } from '../instances.js';
import { formatUptime } from '../managers.js';
import type { Instance } from '../types.js';

@customElement('pm-instances')
export class PmInstances extends LitElement {
  static override readonly styles = [IXCoreStyles, instancesStyles()];

  @property({ attribute: false }) instances: Instance[] = [];
  /** Application-Security 'manage-instances' grant (and the fleet edit permission). */
  @property({ type: Boolean }) canDelete = false;
  @state() private invalidOnly = false;
  /** Collapsed by the user; null = automatic (open while an instance is invalid). */
  @state() private collapsed: boolean | null = null;

  override render(): TemplateResult {
    const invalid = countInvalid(this.instances);
    const open = this.collapsed === null ? invalid > 0 : !this.collapsed;
    const shown = filterInstances(this.instances, this.invalidOnly);
    const now = Date.now();
    return html`
      <div class="head">
        <button class="toggle" aria-expanded=${open ? 'true' : 'false'} @click=${() => (this.collapsed = open)}>
          <ix-icon name=${open ? 'chevron-down-small' : 'chevron-right-small'} size="16"></ix-icon>
          ${localizeDir(MSG.instances.title)} (${this.instances.length})
        </button>
        ${invalid > 0 ? html`<span class="badge tone-alarm">${invalid}</span>` : nothing}
        <span class="grow"></span>
        ${open
          ? html`<ix-checkbox
              label=${localize(MSG.instances.invalidOnly)}
              .checked=${this.invalidOnly}
              @checkedChange=${(e: CustomEvent<boolean>) => (this.invalidOnly = e.detail)}
            ></ix-checkbox>`
          : nothing}
      </div>
      ${open ? this.renderTable(shown, now) : nothing}
    `;
  }

  private renderTable(shown: Instance[], now: number): TemplateResult {
    if (shown.length === 0) return html`<div class="muted empty">${localizeDir(MSG.instances.none)}</div>`;
    return html`<table>
      <thead>
        <tr>
          <th>${localizeDir(MSG.instances.colHost)}</th>
          <th>${localizeDir(MSG.instances.colSystem)}</th>
          <th>${localizeDir(MSG.instances.colState)}</th>
          <th>${localizeDir(MSG.instances.colLastSeen)}</th>
          <th>${localizeDir(MSG.instances.colVersion)}</th>
          <th class="actions-col"></th>
        </tr>
      </thead>
      <tbody>
        ${shown.map((i) => this.renderRow(i, now))}
      </tbody>
    </table>`;
  }

  private renderRow(i: Instance, now: number): TemplateResult {
    const st = instanceState(i);
    const age = lastSeenAgeMs(i, now);
    const version = i.status?.version || (st === 'agent-too-old' ? localize(MSG.instances.olderAgent) : '—');
    return html`<tr>
      <td class="strong">${serverLabel(i)}${i.local ? html` <span class="muted">(${localizeDir(MSG.instances.local)})</span>` : nothing}</td>
      <td>${i.system.replace(/:$/, '') || '—'}</td>
      <td><span class="state tone-${stateTone(st)}" title=${stateTitle(i)}>${localizeDir(STATE_LABELS[st])}</span></td>
      <td class="nowrap">
        ${shortDateLabel(i.updated)}${age === null ? nothing : html` <span class="muted">· ${agoLabel(formatUptime(age, localize(MSG.console.dayUnit)))}</span>`}
        ${isLongUnseen(i, now)
          ? html`<ix-icon class="long-unseen" name="warning" size="12" title=${localize(MSG.instances.longUnseen)}></ix-icon>`
          : nothing}
      </td>
      <td class="mono">${version}</td>
      <td class="actions-col">
        ${canOfferDelete(i, this.canDelete)
          ? html`<ix-button
              variant="secondary"
              outline
              @click=${() => this.dispatchEvent(new CustomEvent<Instance>('wui:deleteinstance', { detail: i, bubbles: true, composed: true }))}
            >
              <ix-icon name="trashcan" slot="icon"></ix-icon>${localizeDir(MSG.instances.deleteInstance)}
            </ix-button>`
          : nothing}
      </td>
    </tr>`;
  }
}

/** Badge tooltip: what the state means, plus the error of the check when there is one. */
export function stateTitle(i: Instance): string {
  const hint = localize(STATE_HINTS[instanceState(i)]);
  return i.status?.error ? `${hint} (${i.status.error})` : hint;
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function instancesStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      margin-bottom: 0.6rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius, 4px);
      padding: 0.3rem 0.6rem;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .grow {
      flex: 1;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      border: none;
      background: none;
      color: var(--theme-color-std-text);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
      padding: 0.2rem 0;
    }
    .muted {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .empty {
      padding: 0.4rem 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
      margin-top: 0.3rem;
    }
    thead th {
      text-align: left;
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
    }
    tbody td {
      padding: 0.25rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: middle;
    }
    .strong {
      font-weight: 600;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.8rem;
    }
    .nowrap {
      white-space: nowrap;
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
    }
    .state,
    .badge {
      display: inline-block;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
      white-space: nowrap;
    }
    .tone-ok {
      background: var(--theme-color-success);
      color: var(--theme-color-success--contrast);
    }
    .tone-alarm {
      background: var(--theme-color-alarm);
      color: var(--theme-color-alarm--contrast);
    }
    .tone-warning {
      background: var(--theme-color-warning);
      color: var(--theme-color-warning--contrast);
    }
    .tone-neutral {
      background: var(--theme-color-neutral);
      color: var(--theme-color-neutral--contrast);
    }
    .long-unseen {
      margin-left: 0.3rem;
      color: var(--theme-color-warning);
      vertical-align: middle;
    }
  `;
}
