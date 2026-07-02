// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Operating modes — one card per mode (normal / degraded / closure / fire)
 * listing its reflex sequence. "Engage" emits `wui:engage`; the tunnel view
 * shows the confirmation dialog (with the full action list) and executes the
 * sequence through the audited {@link CommandRunner}, then hands the results
 * back via the `results`/`resultsModeId` properties so the operator sees which
 * commands were driven, skipped (unbound) or failed.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { CommandResult } from '../data/commands.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { OperatingMode, Tunnel } from '../types.js';

@customElement('hd-modes')
export class HdModes extends LitElement {
  static override readonly styles = [IXCoreStyles, modesStyles()];

  @property({ attribute: false }) tunnel: Tunnel | null = null;
  @property({ type: Boolean }) canOperate = false;
  /** Edit permission (create/edit/delete modes); operating is `canOperate`. */
  @property({ type: Boolean }) canEdit = false;
  /** Results of the last engaged mode (set by the tunnel view). */
  @property({ attribute: false }) results: CommandResult[] = [];
  @property() resultsModeId = '';

  override render(): TemplateResult | typeof nothing {
    const tunnel = this.tunnel;
    if (!tunnel) return nothing;
    return html`
      <div class="toolbar">
        <ix-button ?disabled=${!this.canEdit} @click=${() => this.create()}>
          <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(MSG.modes.newMode)}
        </ix-button>
      </div>
      ${tunnel.modes.length === 0
        ? html`<div class="empty">${localizeDir(MSG.modes.empty)}</div>`
        : html`<div class="grid">${tunnel.modes.map((mode) => this.renderMode(mode))}</div>`}
    `;
  }

  private renderMode(mode: OperatingMode): TemplateResult {
    const results = this.resultsModeId === mode.id ? this.results : [];
    return html`
      <div class="mode ${mode.severity}">
        <div class="mode-head">
          <ix-typography format="h4">${mode.name}</ix-typography>
          <div class="mode-buttons">
            <ix-icon-button
              icon="pen"
              variant="secondary"
              ghost
              ?disabled=${!this.canEdit}
              title=${localize(MSG.modes.editMode)}
              @click=${() => this.edit(mode)}
            ></ix-icon-button>
            <ix-icon-button
              icon="trashcan"
              variant="secondary"
              ghost
              ?disabled=${!this.canEdit}
              title=${localize(MSG.modes.deleteMode)}
              @click=${() => this.requestDelete(mode)}
            ></ix-icon-button>
            <ix-button ?disabled=${!this.canOperate} @click=${() => this.engage(mode)}>
              <ix-icon name="play" slot="icon"></ix-icon>${localizeDir(MSG.modes.engage)}
            </ix-button>
          </div>
        </div>
        <div class="description">${mode.description}</div>
        <div class="count">${mode.actions.length} ${localizeDir(MSG.modes.actionCount)}</div>
        <ul class="actions">
          ${mode.actions.map((action, i) => {
            const result = results[i];
            return html`<li class=${result ? (result.ok ? 'ok' : 'ko') : ''}>
              ${result ? html`<ix-icon name=${result.ok ? 'check' : 'warning'} size="16"></ix-icon>` : nothing}
              ${action.label}
              ${result && !result.ok
                ? html`<span class="why">
                    ${result.reason === 'unbound'
                      ? localizeDir(MSG.modes.unbound)
                      : localizeDir(MSG.modes.failed)}
                  </span>`
                : nothing}
            </li>`;
          })}
        </ul>
      </div>
    `;
  }

  private engage(mode: OperatingMode): void {
    this.dispatchEvent(new CustomEvent<OperatingMode>('wui:engage', { detail: mode }));
  }

  private create(): void {
    this.dispatchEvent(new CustomEvent('wui:create-mode'));
  }

  private edit(mode: OperatingMode): void {
    this.dispatchEvent(new CustomEvent<OperatingMode>('wui:edit-mode', { detail: mode }));
  }

  private requestDelete(mode: OperatingMode): void {
    this.dispatchEvent(new CustomEvent<OperatingMode>('wui:delete-mode', { detail: mode }));
  }
}

function modesStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .toolbar {
      display: flex;
      padding: 1rem 1rem 0;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
      gap: 1rem;
      padding: 1rem;
      align-items: start;
    }
    .mode-buttons {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .empty {
      padding: 2rem;
      color: var(--theme-color-soft-text);
    }
    .mode {
      border: 1px solid var(--theme-color-soft-bdr);
      border-left-width: 4px;
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      padding: 0.9rem;
    }
    .mode.normal {
      border-left-color: var(--theme-color-success);
    }
    .mode.degraded {
      border-left-color: var(--theme-color-warning);
    }
    .mode.closure {
      border-left-color: var(--theme-color-info);
    }
    .mode.fire {
      border-left-color: var(--theme-color-alarm);
    }
    .mode-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.6rem;
    }
    .description {
      color: var(--theme-color-soft-text);
      margin: 0.4rem 0;
    }
    .count {
      color: var(--theme-color-weak-text);
      font-size: 0.78rem;
      margin-bottom: 0.3rem;
    }
    ul.actions {
      margin: 0;
      padding-left: 1.1rem;
      max-height: 11rem;
      overflow: auto;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    ul.actions li {
      margin: 0.15rem 0;
    }
    ul.actions li.ok {
      color: var(--theme-color-success);
    }
    ul.actions li.ko {
      color: var(--theme-color-alarm);
    }
    .why {
      font-size: 0.75rem;
      margin-left: 0.3rem;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'hd-modes': HdModes;
  }
}
