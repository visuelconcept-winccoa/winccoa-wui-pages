// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Edit-mode properties panel for the current canvas selection.
 *
 * - **Symbol**: label, 90° rotation, and — for switchgear — the free-form state
 *   datapoint element (open/closed), the value meaning "closed", and a "source"
 *   toggle. Emits `wui:update-node` / `wui:rotate`.
 * - **Measurement**: the datapoint element read live, caption, unit, decimals.
 *   Emits `wui:update-meas`.
 * - **Wire**: read-only info.
 *
 * Any selection can be removed (`wui:delete`). Datapoint binding is deliberately
 * a free text field (per the "free DP selector per symbol" design), so it works
 * against any WinCC OA project without a naming convention.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { SYMBOLS, isSwitchgear } from '../symbols/catalog.js';
import type { Selection } from './am-canvas.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import type { Measurement, Network, Node } from '../types.js';

@customElement('am-inspector')
export class AmInspector extends LitElement {
  static override readonly styles = [IXCoreStyles, inspectorStyles()];

  @property({ attribute: false }) network: Network | null = null;
  @property({ attribute: false }) selection: Selection | null = null;

  override render(): TemplateResult {
    const sel = this.selection;
    const net = this.network;
    if (!sel || !net) return html`<div class="empty">${localizeDir(MSG.inspector.none)}</div>`;
    if (sel.kind === 'node') {
      const node = net.nodes.find((n) => n.id === sel.id);
      return node ? this.renderNode(node) : this.renderEmpty();
    }
    if (sel.kind === 'measurement') {
      const meas = net.measurements.find((m) => m.id === sel.id);
      return meas ? this.renderMeasurement(meas) : this.renderEmpty();
    }
    return this.renderEdge(sel.id);
  }

  private renderEmpty(): TemplateResult {
    return html`<div class="empty">${localizeDir(MSG.inspector.none)}</div>`;
  }

  private renderNode(node: Node): TemplateResult {
    const def = SYMBOLS[node.symbol];
    const sw = isSwitchgear(node.symbol);
    return html`
      <div class="head">
        <span class="kind">${localize(def.label)}</span>
        <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.inspector.delete)} @click=${() => this.del()}></ix-icon-button>
      </div>
      ${this.field(
        MSG.inspector.label,
        html`<input class="in" .value=${node.label} @input=${(e: Event) => this.patchNode(node.id, { label: value(e) })} />`
      )}
      ${this.field(
        MSG.inspector.rotation,
        html`<button class="btn" type="button" @click=${() => this.rotate(node.id)}>
          <ix-icon name="undo" size="14"></ix-icon>${localizeDir(MSG.inspector.rotate)} · ${node.rotation}°
        </button>`
      )}
      ${sw
        ? html`
            ${this.field(
              MSG.inspector.stateDp,
              html`<input
                  class="in"
                  placeholder="System1:Q1.state"
                  .value=${node.dp}
                  @input=${(e: Event) => this.patchNode(node.id, { dp: value(e) })}
                />
                <div class="hint">${localizeDir(MSG.inspector.stateDpHint)}</div>`
            )}
            ${this.field(
              MSG.inspector.closedValue,
              html`<input
                class="in short"
                type="number"
                .value=${String(node.closedValue)}
                @input=${(e: Event) => this.patchNode(node.id, { closedValue: Number(value(e)) || 0 })}
              />`
            )}
          `
        : nothing}
      ${def.role !== 'source'
        ? html`<label class="check">
            <input
              type="checkbox"
              ?checked=${node.source}
              @change=${(e: Event) => this.patchNode(node.id, { source: (e.target as HTMLInputElement).checked })}
            />
            <span>${localizeDir(MSG.inspector.isSource)}</span>
          </label>`
        : nothing}
    `;
  }

  private renderMeasurement(m: Measurement): TemplateResult {
    return html`
      <div class="head">
        <span class="kind"><ix-icon name="dashboard" size="16"></ix-icon> ${localizeDir(MSG.toolbar.addMeasurement)}</span>
        <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.inspector.delete)} @click=${() => this.del()}></ix-icon-button>
      </div>
      ${this.field(
        MSG.inspector.measDp,
        html`<input class="in" placeholder="System1:Feeder1.value" .value=${m.dp} @input=${(e: Event) => this.patchMeas(m.id, { dp: value(e) })} />`
      )}
      ${this.field(
        MSG.inspector.measLabel,
        html`<input class="in" .value=${m.label} @input=${(e: Event) => this.patchMeas(m.id, { label: value(e) })} />`
      )}
      <div class="row">
        ${this.field(
          MSG.inspector.measUnit,
          html`<input class="in short" .value=${m.unit} @input=${(e: Event) => this.patchMeas(m.id, { unit: value(e) })} />`
        )}
        ${this.field(
          MSG.inspector.measDecimals,
          html`<input
            class="in short"
            type="number"
            min="0"
            max="6"
            .value=${String(m.decimals)}
            @input=${(e: Event) => this.patchMeas(m.id, { decimals: clampDecimals(value(e)) })}
          />`
        )}
      </div>
      ${m.nodeId ? html`<div class="hint"><ix-icon name="link" size="12"></ix-icon> ${localizeDir(MSG.inspector.measAnchor)}</div>` : nothing}
    `;
  }

  private renderEdge(_id: string): TemplateResult {
    return html`
      <div class="head">
        <span class="kind">${localizeDir(MSG.inspector.wireInfo)}</span>
        <ix-icon-button ghost size="16" icon="trashcan" title=${localize(MSG.inspector.delete)} @click=${() => this.del()}></ix-icon-button>
      </div>
      <div class="hint">${localizeDir(MSG.canvas.wireHint)}</div>
    `;
  }

  private field(label: MultiLangString, control: TemplateResult): TemplateResult {
    return html`<label class="fld"><span class="lbl">${localizeDir(label)}</span>${control}</label>`;
  }

  private patchNode(id: string, patch: Partial<Node>): void {
    this.emit('wui:update-node', { id, patch });
  }

  private patchMeas(id: string, patch: Partial<Measurement>): void {
    this.emit('wui:update-meas', { id, patch });
  }

  private rotate(id: string): void {
    this.emit('wui:rotate', { id });
  }

  private del(): void {
    if (this.selection) this.emit('wui:delete', this.selection);
  }

  private emit(type: string, detail: unknown): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }
}

function value(e: Event): string {
  return (e.target as HTMLInputElement).value;
}

function clampDecimals(raw: string): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 0;
  return Math.min(Math.max(n, 0), 6);
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function inspectorStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      height: 100%;
      overflow-y: auto;
      padding: 0.6rem;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-sizing: border-box;
    }
    .empty {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.6rem;
    }
    .kind {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      font-weight: 600;
      flex: 1;
    }
    .fld {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin-bottom: 0.6rem;
    }
    .row {
      display: flex;
      gap: 0.6rem;
    }
    .row .fld {
      flex: 1;
    }
    .lbl {
      font-size: 0.76rem;
      color: var(--theme-color-soft-text);
    }
    .in {
      box-sizing: border-box;
      width: 100%;
      padding: 0.4rem 0.5rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
    }
    .in.short {
      width: 6rem;
    }
    .hint {
      font-size: 0.72rem;
      color: var(--theme-color-soft-text);
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.35rem 0.55rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
      font-size: 0.8rem;
      cursor: pointer;
      align-self: flex-start;
    }
    .check {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.82rem;
      cursor: pointer;
    }
  `;
}
