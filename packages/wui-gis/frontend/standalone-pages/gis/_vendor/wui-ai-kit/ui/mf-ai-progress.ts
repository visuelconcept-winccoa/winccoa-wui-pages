// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * What the assistant is doing, right now.
 *
 * Replaces a spinner that said "thinking…" for what can be a minute of model calls
 * and tool round-trips. Shared by every assistant panel, because the steps are the
 * same everywhere: rounds of the agentic loop, the reasoning summary of each round,
 * and the tools as they are called.
 *
 * The reasoning is per ROUND, not per token — the provider call is non-streaming, so
 * a round's summary arrives with that round's response. On an agentic loop that
 * still unfolds visibly instead of leaving the user in front of a still spinner.
 */
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import type { AiProgressEvent } from '../data/ai-progress.js';
import { AI_MSG, localize, localizeDir } from '../i18n.js';

export class MfAiProgress extends LitElement {
  static override readonly styles = [progressStyles()];

  @property({ attribute: false }) events: readonly AiProgressEvent[] = [];

  override render(): TemplateResult | typeof nothing {
    if (this.events.length === 0) return nothing;
    // The reasoning of the round in progress is the one worth reading; the earlier
    // ones are already summarised by what the assistant went on to do.
    const thinking = [...this.events].reverse().find((event) => event.type === 'thinking');
    return html`
      <ol class="steps">
        ${this.events.map((event) => this.renderStep(event))}
      </ol>
      ${thinking?.text
        ? html`<div class="thinking">
            <span class="thinking-label">${localizeDir(AI_MSG.reasoning)}</span>
            <span class="thinking-text">${thinking.text}</span>
          </div>`
        : nothing}
    `;
  }

  private renderStep(event: AiProgressEvent): TemplateResult | typeof nothing {
    switch (event.type) {
      case 'mcp': {
        return html`<li>
          <ix-icon name="extension" size="12"></ix-icon>${localize(AI_MSG.stepTools).replace(
            '%n',
            String(event.count ?? 0)
          )}
        </li>`;
      }
      case 'model': {
        return html`<li>
          <ix-icon name="ai" size="12"></ix-icon>${localize(AI_MSG.stepModel).replace(
            '%n',
            String(event.round ?? 1)
          )}
        </li>`;
      }
      case 'tool-start': {
        // A tool that is still running: the same line is replaced by its outcome as
        // soon as it lands, so the list never grows a duplicate.
        return this.events.some((other) => other.type === 'tool' && other.name === event.name)
          ? nothing
          : html`<li class="running">
              <ix-icon name="cogwheel" size="12"></ix-icon>${event.name}
            </li>`;
      }
      case 'tool': {
        return html`<li class=${event.ok ? 'ok' : 'err'}>
          <ix-icon name=${event.ok ? 'single-check' : 'error'} size="12"></ix-icon>${event.name}
        </li>`;
      }
      case 'error': {
        return html`<li class="err"><ix-icon name="error" size="12"></ix-icon>${event.message}</li>`;
      }
      // `start` and `done` bracket the run; the panel's own busy state says as much.
      default: {
        return nothing;
      }
    }
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function progressStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: block;
      font-size: 0.7rem;
    }
    .steps {
      margin: 0;
      padding: 0;
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem 0.5rem;
      color: var(--theme-color-soft-text);
    }
    li {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
    }
    li.ok {
      color: var(--theme-color-std-text);
    }
    li.err {
      color: var(--theme-color-alarm, #ef4444);
    }
    li.running {
      color: var(--theme-color-primary);
    }
    /* The running tool is the only moving part — everything else is settled. */
    li.running ix-icon {
      animation: spin 1.4s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      li.running ix-icon {
        animation: none;
      }
    }
    .thinking {
      margin-top: 0.3rem;
      padding: 0.3rem 0.4rem;
      border-left: 2px solid var(--theme-color-soft-bdr);
      color: var(--theme-color-soft-text);
      font-style: italic;
      white-space: pre-wrap;
    }
    .thinking-label {
      font-style: normal;
      font-weight: 600;
      margin-right: 0.3rem;
    }
  `;
}

// Guarded registration: this component is vendored into several self-contained page
// bundles, which share ONE CustomElementRegistry per SPA session.
if (!customElements.get('mf-ai-progress')) {
  customElements.define('mf-ai-progress', MfAiProgress);
}
