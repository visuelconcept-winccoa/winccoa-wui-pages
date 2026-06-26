/**
 * History panel: the operations log (project imports / manager restarts) read
 * from the `ProcessMonitor_History` datapoint. Presentational — the page passes
 * `entries` and handles `pm:refresh-history`.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, dateLabel, localizeDir } from '../i18n.js';
import type { HistoryEntry } from '../types.js';

@customElement('pm-history')
export class PmHistory extends LitElement {
  static override readonly styles = [IXCoreStyles, historyStyles()];

  @property({ attribute: false }) entries: HistoryEntry[] = [];

  override render(): TemplateResult {
    return html`
      <div class="bar">
        <span class="title">${localizeDir(MSG.history.title)} (${this.entries.length})</span>
        <span class="grow"></span>
        <ix-button variant="secondary" outline @click=${() => this.dispatchEvent(new CustomEvent('wui:refreshhistory', { bubbles: true, composed: true }))}>
          <ix-icon name="refresh" slot="icon"></ix-icon>${localizeDir(MSG.history.refresh)}
        </ix-button>
      </div>
      ${this.entries.length === 0
        ? html`<div class="empty">${localizeDir(MSG.history.empty)}</div>`
        : html`<table>
            <thead>
              <tr>
                <th>${localizeDir(MSG.history.colTime)}</th>
                <th>${localizeDir(MSG.history.colAction)}</th>
                <th>${localizeDir(MSG.history.colDetail)}</th>
                <th>${localizeDir(MSG.history.colUser)}</th>
                <th>${localizeDir(MSG.history.colHost)}</th>
                <th>${localizeDir(MSG.history.colStatus)}</th>
              </tr>
            </thead>
            <tbody>
              ${this.entries.map(
                (e) => html`<tr>
                  <td class="mono">${dateLabel(e.time)}</td>
                  <td>${localizeDir(actionLabel(e.action))}</td>
                  <td>${e.detail}${e.system ? html`<span class="sys">@${e.system}</span>` : nothing}</td>
                  <td>${e.user || '—'}</td>
                  <td class="mono">${e.host || '—'}</td>
                  <td>
                    <span class="status ${e.status}">${localizeDir(e.status === 'success' ? MSG.common.success : MSG.common.failed)}</span>
                  </td>
                </tr>`
              )}
            </tbody>
          </table>`}
    `;
  }
}

function actionLabel(action: HistoryEntry['action']): MultiLangString {
  if (action === 'deploy') return MSG.history.actionDeploy;
  if (action === 'restart-all') return MSG.history.actionRestartAll;
  return MSG.history.actionManager;
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function historyStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      overflow: auto;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding-bottom: 0.5rem;
    }
    .bar .grow {
      flex: 1;
    }
    .title {
      font-weight: 600;
    }
    .empty {
      color: var(--theme-color-soft-text);
      padding: 1rem;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }
    thead th {
      text-align: left;
      padding: 0.4rem 0.6rem;
      border-bottom: 2px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-weight: 600;
      white-space: nowrap;
    }
    tbody td {
      padding: 0.35rem 0.6rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
    }
    .sys {
      margin-left: 0.4rem;
      padding: 0.05rem 0.4rem;
      border-radius: 999px;
      font-size: 0.72rem;
      font-weight: 600;
      color: var(--theme-color-soft-text);
      background: var(--theme-color-2);
    }
    .status {
      font-weight: 600;
    }
    .status.success {
      color: var(--theme-color-success, #10b981);
    }
    .status.failed {
      color: var(--theme-color-alarm, #ef4444);
    }
  `;
}
