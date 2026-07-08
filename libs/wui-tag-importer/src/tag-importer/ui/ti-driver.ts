// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Step 0 — choose the driver/protocol to import from. Only OPC UA is available
 * today; the card layout is the extension point for future protocols (the same
 * abstraction as the source adapters). Emits `wui:driver` ({ 'opcua' }).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { MSG, localizeDir } from '../i18n.js';

export type DriverKind = 'opcua';

export class TiDriver extends LitElement {
  static override readonly styles = [IXCoreStyles, driverStyles()];

  @property({ type: String }) driver: DriverKind | '' = '';

  override render(): TemplateResult {
    return html`
      <div class="hint">${localizeDir(MSG.driver.choose)}</div>
      <div class="drivers">
        <button
          class="driver ${this.driver === 'opcua' ? 'active' : ''}"
          @click=${() => this.dispatchEvent(new CustomEvent('wui:driver', { detail: 'opcua', bubbles: true, composed: true }))}
        >
          <ix-icon name="connected" size="24"></ix-icon>
          <span class="driver-title">${localizeDir(MSG.driver.opcua)}</span>
          <span class="driver-hint">${localizeDir(MSG.driver.opcuaHint)}</span>
        </button>
        <div class="driver soon" aria-disabled="true">
          <ix-icon name="more-menu" size="24"></ix-icon>
          <span class="driver-hint">${localizeDir(MSG.driver.soon)}</span>
        </div>
      </div>
    `;
  }
}

function driverStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .hint {
      margin-bottom: 0.75rem;
      opacity: 0.85;
    }
    .drivers {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .driver {
      flex: 1 1 240px;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      align-items: flex-start;
      text-align: left;
      padding: 1rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 4px;
      background: var(--theme-color-1);
      color: var(--theme-color-text);
      cursor: pointer;
    }
    .driver.active {
      border-color: var(--theme-color-primary);
      box-shadow: inset 0 0 0 1px var(--theme-color-primary);
    }
    .driver.soon {
      opacity: 0.5;
      cursor: not-allowed;
      justify-content: center;
    }
    .driver-title {
      font-weight: 600;
    }
    .driver-hint {
      font-size: 0.8rem;
      opacity: 0.8;
    }
  `;
}

if (!customElements.get('ti-driver')) {
  customElements.define('ti-driver', TiDriver);
}
