// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Edit-mode symbol toolbox: the pointer-tool switcher (Select/move) plus the
 * IEC 60617 symbol palette, grouped by family. Picking a symbol arms the "place"
 * tool (click the canvas to drop it); picking "Select" returns to move/select.
 * Every entry previews the real glyph so the palette reads like the diagram.
 * Emits `wui:tool` with the chosen {@link Tool}.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, svg, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { CATEGORY_ORDER, symbolsOf, type SymbolDef } from '../symbols/catalog.js';
import type { Tool } from './am-canvas.js';
import { MSG, localize, localizeDir } from '../i18n.js';

@customElement('am-toolbox')
export class AmToolbox extends LitElement {
  static override readonly styles = [IXCoreStyles, toolboxStyles()];

  @property({ attribute: false }) tool: Tool = 'select';

  override render(): TemplateResult {
    return html`
      <div class="head">
        <ix-icon name="tool" size="16"></ix-icon>
        <span class="title">${localizeDir(MSG.toolbox.title)}</span>
      </div>
      <button
        class="select ${this.tool === 'select' ? 'active' : ''}"
        type="button"
        title=${localize(MSG.toolbox.select)}
        @click=${() => this.pick('select')}
      >
        <ix-icon name="cursor" size="16"></ix-icon>
        <span>${localizeDir(MSG.toolbox.select)}</span>
      </button>
      ${CATEGORY_ORDER.map((cat) => this.renderCategory(cat))}
    `;
  }

  private renderCategory(cat: (typeof CATEGORY_ORDER)[number]): TemplateResult {
    return html`
      <div class="group">
        <div class="group-title">${localizeDir(MSG.category[cat])}</div>
        <div class="grid">${symbolsOf(cat).map((def) => this.renderSymbol(def))}</div>
      </div>
    `;
  }

  private renderSymbol(def: SymbolDef): TemplateResult {
    const active = this.tool === def.id;
    return html`
      <button
        class="cell ${active ? 'active' : ''}"
        type="button"
        title=${localize(def.label)}
        @click=${() => this.pick(def.id)}
      >
        <svg viewBox="-4 -4 ${def.w + 8} ${def.h + 8}" preserveAspectRatio="xMidYMid meet">
          ${svg`<g>${def.render({ closed: true })}</g>`}
        </svg>
        <span class="cap">${localize(def.label)}</span>
      </button>
    `;
  }

  private pick(tool: Tool): void {
    this.dispatchEvent(new CustomEvent('wui:tool', { detail: { tool }, bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function toolboxStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
      height: 100%;
      overflow-y: auto;
      padding: 0.6rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-sizing: border-box;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-weight: 600;
    }
    .select {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.4rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
    }
    .group-title {
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--theme-color-soft-text);
      margin-bottom: 0.3rem;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.4rem;
    }
    .cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.2rem;
      padding: 0.35rem 0.2rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
      cursor: pointer;
    }
    .cell svg {
      width: 100%;
      height: 44px;
    }
    .cap {
      font-size: 0.68rem;
      line-height: 1.1;
      text-align: center;
      color: var(--theme-color-soft-text);
    }
    .select:hover,
    .cell:hover {
      border-color: var(--theme-color-primary, #0ea5e9);
    }
    .select.active,
    .cell.active {
      border-color: var(--theme-color-primary, #0ea5e9);
      background: color-mix(in srgb, var(--theme-color-primary, #0ea5e9) 14%, transparent);
    }
  `;
}
