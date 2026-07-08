// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Step 4 — the import result report (created / skipped / failed per item).
 * Emits `wui:reset` to start a new import.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import type { ApplyItemResult, ApplyResult } from '../core/plan.js';
import { MSG, localizeDir } from '../i18n.js';

export class TiResult extends LitElement {
  static override readonly styles = [IXCoreStyles, resultStyles()];

  @property({ attribute: false }) result: ApplyResult | null = null;

  override render(): TemplateResult {
    const result = this.result;
    if (!result) return html``;
    const failed = result.results.filter((r) => r.status === 'failed');
    return html`
      <ix-message-bar type=${result.ok ? 'success' : 'alert'} .dismissible=${false}>
        ${localizeDir(result.ok ? MSG.result.allOk : MSG.result.someFailed)}
      </ix-message-bar>
      <div class="counts">
        <span class="chip ok">${this.count('created')} ${localizeDir(MSG.result.created)}</span>
        <span class="chip skip">${this.count('skipped')} ${localizeDir(MSG.result.skipped)}</span>
        ${failed.length > 0 ? html`<span class="chip fail">${failed.length} ${localizeDir(MSG.result.failed)}</span>` : nothing}
      </div>
      ${failed.length > 0
        ? html`<div class="scroll">
            <table>
              <tbody>
                ${failed.map(
                  (r) => html`<tr>
                    <td>${r.kind}</td>
                    <td>${r.name}</td>
                    <td class="err">${r.error}</td>
                  </tr>`
                )}
              </tbody>
            </table>
          </div>`
        : nothing}
      <div class="actions">
        <ix-button variant="primary" @click=${() => this.dispatchEvent(new CustomEvent('wui:reset', { bubbles: true, composed: true }))}>
          ${localizeDir(MSG.actions.reset)}
        </ix-button>
      </div>
    `;
  }

  private count(status: ApplyItemResult['status']): number {
    return this.result?.results.filter((r) => r.status === status).length ?? 0;
  }
}

function resultStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .counts {
      display: flex;
      gap: 0.5rem;
      padding: 0.75rem 0;
    }
    .chip {
      font-size: 0.82rem;
      padding: 0.15rem 0.6rem;
      border-radius: 999px;
      border: 1px solid var(--theme-color-soft-bdr);
    }
    .chip.ok {
      color: var(--theme-color-success, #2a2);
      border-color: var(--theme-color-success, #2a2);
    }
    .chip.fail {
      color: var(--theme-color-alarm, #c00);
      border-color: var(--theme-color-alarm, #c00);
    }
    .scroll {
      max-height: 18rem;
      overflow: auto;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    td {
      padding: 0.3rem 0.5rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      vertical-align: top;
    }
    td.err {
      color: var(--theme-color-alarm, #c00);
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      padding-top: 1rem;
    }
  `;
}

if (!customElements.get('ti-result')) {
  customElements.define('ti-result', TiResult);
}
