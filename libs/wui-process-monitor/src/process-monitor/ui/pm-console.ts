// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Console panel: live pmon manager list with per-manager start/stop/restart and
 * a restart-all action. Presentational — it renders the `managers` passed by the
 * page and emits intent events (`pm:refresh`, `pm:restart-all`,
 * `pm:control {action,index,name}`); the page performs the API call + tracing.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { ManagerInfo } from '../types.js';

const STATE_COLORS: Record<number, string> = { 0: '#94a3b8', 1: '#f59e0b', 2: '#10b981', 3: '#ef4444' };

@customElement('pm-console')
export class PmConsole extends LitElement {
  static override readonly styles = [IXCoreStyles, consoleStyles()];

  @property({ attribute: false }) managers: ManagerInfo[] = [];
  @property({ type: Boolean }) canEdit = false;
  @property({ type: String }) lastUpdate = '';

  override render(): TemplateResult {
    return html`
      <div class="bar">
        <span class="title">${localizeDir(MSG.console.title)} (${this.managers.length})</span>
        <span class="grow"></span>
        ${this.lastUpdate
          ? html`<span class="muted">${localizeDir(MSG.console.lastUpdate)}: ${this.lastUpdate}</span>`
          : nothing}
        <ix-button
          variant="secondary"
          outline
          @click=${() => this.dispatchEvent(new CustomEvent('wui:refresh', { bubbles: true, composed: true }))}
        >
          <ix-icon name="refresh" slot="icon"></ix-icon>${localizeDir(MSG.console.refresh)}
        </ix-button>
        ${this.canEdit
          ? html`<ix-button
              variant="secondary"
              outline
              @click=${() => this.dispatchEvent(new CustomEvent('wui:restartall', { bubbles: true, composed: true }))}
            >
              <ix-icon name="refresh" slot="icon"></ix-icon>${localizeDir(MSG.console.restartAll)}
            </ix-button>`
          : nothing}
      </div>
      <table>
        <thead>
          <tr>
            <th>${localizeDir(MSG.console.colIndex)}</th>
            <th>${localizeDir(MSG.console.colName)}</th>
            <th>${localizeDir(MSG.console.colState)}</th>
            <th>${localizeDir(MSG.console.colPid)}</th>
            <th>${localizeDir(MSG.console.colOptions)}</th>
            <th class="actions-col"></th>
          </tr>
        </thead>
        <tbody>
          ${this.managers.map((m) => this.renderRow(m))}
        </tbody>
      </table>
    `;
  }

  private renderRow(m: ManagerInfo): TemplateResult {
    const running = m.state === 2;
    return html`
      <tr>
        <td class="mono">${m.index}</td>
        <td class="strong">${m.name}</td>
        <td>
          <span class="state" style="--c:${STATE_COLORS[m.state] ?? '#94a3b8'}">${m.stateLabel}</span>
        </td>
        <td class="mono">${m.pid > 0 ? m.pid : '—'}</td>
        <td class="mono opt" title=${m.options}>${m.options}</td>
        <td class="actions-col">
          ${this.canEdit
            ? html`
                <ix-icon-button
                  ghost
                  size="16"
                  icon="play"
                  title=${localize(MSG.console.start)}
                  ?disabled=${running}
                  @click=${() => this.control('start', m)}
                ></ix-icon-button>
                <ix-icon-button
                  ghost
                  size="16"
                  icon="stop"
                  title=${localize(MSG.console.stop)}
                  ?disabled=${!running}
                  @click=${() => this.control('stop', m)}
                ></ix-icon-button>
                <ix-icon-button
                  ghost
                  size="16"
                  icon="refresh"
                  title=${localize(MSG.console.restart)}
                  @click=${() => this.control('restart', m)}
                ></ix-icon-button>
              `
            : nothing}
        </td>
      </tr>
    `;
  }

  private control(action: 'start' | 'stop' | 'restart', m: ManagerInfo): void {
    this.dispatchEvent(
      new CustomEvent('wui:control', {
        detail: { action, index: m.index, name: m.name },
        bubbles: true,
        composed: true
      })
    );
  }

}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function consoleStyles(): ReturnType<typeof css> {
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
    .muted {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
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
      vertical-align: middle;
    }
    tbody tr:hover {
      background: var(--theme-color-2);
    }
    .strong {
      font-weight: 600;
    }
    .mono {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.82rem;
    }
    .opt {
      max-width: 22rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--theme-color-soft-text);
    }
    .state {
      display: inline-block;
      font-size: 0.78rem;
      font-weight: 600;
      color: #fff;
      background: var(--c);
      border-radius: 999px;
      padding: 0.05rem 0.5rem;
    }
    .actions-col {
      white-space: nowrap;
      width: 1%;
    }
  `;
}
