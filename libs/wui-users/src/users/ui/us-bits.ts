// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The 32 permission levels of WinCC OA as a grid of checkboxes, each labelled with
 * its level and name. Emits `wui:bitschange` with the new 32 bits.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { normalizeBits, permissionLabel } from '../model.js';
import type { PermissionBits } from '../types.js';

@customElement('us-bits')
export class UsBits extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: block;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
        gap: 0.2rem 0.75rem;
      }
    `
  ];

  @property({ attribute: false }) bits: PermissionBits = [];
  @property({ attribute: false }) names: string[] = [];
  @property({ type: Boolean }) disabled = false;

  override render(): TemplateResult {
    const bits = normalizeBits(this.bits);
    return html`<div class="grid">
      ${bits.map(
        (on, i) => html`<ix-checkbox
          label=${permissionLabel(i + 1, this.names)}
          .checked=${on}
          ?disabled=${this.disabled}
          @checkedChange=${(e: CustomEvent<boolean>) => this.set(i, e.detail)}
        ></ix-checkbox>`
      )}
    </div>`;
  }

  private set(index: number, on: boolean): void {
    const bits = normalizeBits(this.bits);
    bits[index] = on;
    this.dispatchEvent(new CustomEvent('wui:bitschange', { detail: bits, bubbles: true, composed: true }));
  }
}
