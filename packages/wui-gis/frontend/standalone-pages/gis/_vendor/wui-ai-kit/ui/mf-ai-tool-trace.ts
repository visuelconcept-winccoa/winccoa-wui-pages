// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The tools an answer used, and what they returned.
 *
 * Shared by every assistant panel, because "which tools did it actually call, and what
 * did they say" is the same question on every page — and the only way for an operator to
 * tell a grounded answer from a plausible one. A chip alone (the previous display) says a
 * tool ran; it does not say the model read what you think it read.
 *
 * Each chip expands to the call's arguments and the head of its result. Collapsed by
 * default: the trace is for auditing, not for reading every time.
 *
 * The trace is necessarily *post hoc*: the chat bridge is one unary vRPC call, so the
 * manager runs the whole agentic loop and answers once. There is no channel on which a
 * call could be announced while it happens — the panel shows a "using its tools" state
 * during the wait and the full trace when the answer lands.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import type { ToolCall } from '../data/ai-store.js';
import { AI_MSG, localize, localizeDir } from '../i18n.js';

export class MfAiToolTrace extends LitElement {
  static override readonly styles = [traceStyles()];

  @property({ attribute: false }) calls: readonly ToolCall[] = [];

  /** Index of the expanded call, or -1. One at a time keeps the message compact. */
  @state() private openAt = -1;

  override render(): TemplateResult | typeof nothing {
    if (this.calls.length === 0) return nothing;
    return html`
      <div class="tools">
        <span class="tools-label">${localizeDir(AI_MSG.tools)}</span>
        ${this.calls.map((call, index) => this.renderChip(call, index))}
      </div>
      ${this.openAt >= 0 ? this.renderDetail(this.calls[this.openAt] as ToolCall) : nothing}
    `;
  }

  private renderChip(call: ToolCall, index: number): TemplateResult {
    const detailed = call.args !== undefined || call.result !== undefined;
    return html`<button
      type="button"
      class="tool ${call.ok ? '' : 'tool--err'} ${this.openAt === index ? 'tool--open' : ''}"
      title=${detailed ? localize(AI_MSG.toolShow) : localize(call.ok ? AI_MSG.success : AI_MSG.failure)}
      ?disabled=${!detailed}
      @click=${() => (this.openAt = this.openAt === index ? -1 : index)}
    >
      <ix-icon name=${call.ok ? 'single-check' : 'error'} size="12"></ix-icon>${call.name}
    </button>`;
  }

  private renderDetail(call: ToolCall): TemplateResult {
    return html`<div class="detail">
      <div class="detail-head">
        <strong>${call.name}</strong>
        ${call.server ? html`<span class="server">${call.server}</span>` : nothing}
      </div>
      ${call.args === undefined
        ? nothing
        : html`<div class="detail-label">${localizeDir(AI_MSG.toolArgs)}</div>
            <pre>${JSON.stringify(call.args, null, 1)}</pre>`}
      ${call.result === undefined
        ? nothing
        : html`<div class="detail-label">${localizeDir(AI_MSG.toolResult)}</div>
            <pre>${call.result}</pre>`}
    </div>`;
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function traceStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
    }
    .tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
      margin-bottom: 0.25rem;
      font-size: 0.7rem;
    }
    .tools-label {
      color: var(--theme-color-soft-text);
    }
    .tool {
      display: inline-flex;
      align-items: center;
      gap: 0.15rem;
      padding: 0.05rem 0.35rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: 0.75rem;
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
      cursor: pointer;
    }
    .tool[disabled] {
      cursor: default;
      opacity: 0.75;
    }
    .tool:hover:not([disabled]),
    .tool--open {
      border-color: var(--theme-color-primary);
    }
    .tool--err {
      border-color: var(--theme-color-alarm, #ef4444);
      color: var(--theme-color-alarm, #ef4444);
    }
    .detail {
      margin-bottom: 0.35rem;
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      font-size: 0.7rem;
    }
    .detail-head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-bottom: 0.2rem;
    }
    .server {
      color: var(--theme-color-soft-text);
    }
    .detail-label {
      margin-top: 0.3rem;
      color: var(--theme-color-soft-text);
    }
    pre {
      margin: 0.1rem 0 0;
      padding: 0.3rem 0.4rem;
      max-height: 14rem;
      overflow: auto;
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      white-space: pre-wrap;
      word-break: break-word;
      font-family: monospace;
      font-size: 0.68rem;
    }
  `;
}

// Guarded registration: this component is vendored into several self-contained page
// bundles, which share ONE CustomElementRegistry per SPA session.
if (!customElements.get('mf-ai-tool-trace')) {
  customElements.define('mf-ai-tool-trace', MfAiToolTrace);
}
