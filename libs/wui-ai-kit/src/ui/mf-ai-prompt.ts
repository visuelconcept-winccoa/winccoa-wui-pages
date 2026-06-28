// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * AI prompt bar shown at the top of the Machine Fleet pages.
 *
 * A compact button with the Copilot/AI icon (`ai`, two stars) sits at the far
 * right of the toolbar and opens a chat-style overlay: a single continuous
 * conversation (the prompts AND their answers, interleaved) that scrolls, with
 * the prompt input at the bottom and a "thinking…" animation while a request is
 * in flight. Each prompt is sent to `POST /api/ai/chat` (→ MSA vRPC →
 * AiAssistant manager → LLM provider, with local MCP tools) via {@link askAi}.
 * A configuration gear inside the panel header (canPublish) opens
 * {@link MfAiConfigDialog}.
 *
 * Note: each prompt is independent (the conversation is shown for context but
 * not yet replayed to the model).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { Subscription } from 'rxjs';
import { askAi, type ToolCall } from '../data/ai-store.js';
import { isAiAssistantEnabled } from '../data/ai-feature.js';
import { canEditFleet, canEditFleet$ } from '@visuelconcept/wui-kit/data/permissions.js';
import { renderMarkdown } from '../data/markdown.js';
import { AI_MSG, localize, localizeDir } from '../i18n.js';
import './mf-ai-config-dialog.js';

const PROMPT_ROWS = 3;

/** One conversation entry. */
interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
  /** Tools the AI invoked to produce an assistant answer. */
  tools?: ToolCall[];
}

export class MfAiPrompt extends LitElement {
  static override readonly styles = [IXCoreStyles, promptStyles()];

  /**
   * Optional system instruction sent with every prompt — used to scope the
   * assistant to a page's context and domain (e.g. the asset inventory). Empty
   * by default, so the generic fleet usage is unchanged.
   */
  @property({ attribute: false }) system = '';

  /** Optional preset prompts shown as clickable chips when the chat is empty. */
  @property({ attribute: false }) suggestions: string[] = [];

  @state() private open = false;
  @state() private prompt = '';
  @state() private messages: ChatMessage[] = [];
  @state() private busy = false;
  @state() private configOpen = false;
  /** canPublish — gates the configuration gear. */
  @state() private canEdit = canEditFleet();
  /** Deploy-time feature flag — the assistant renders nothing until enabled. */
  @state() private aiEnabled = false;

  @query('.conv') private convEl?: HTMLElement;

  private permSub = new Subscription();

  override connectedCallback(): void {
    super.connectedCallback();
    this.permSub = canEditFleet$().subscribe((allowed) => (this.canEdit = allowed));
    void isAiAssistantEnabled().then((on) => (this.aiEnabled = on));
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.permSub.unsubscribe();
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.aiEnabled) return nothing; // hidden unless enabled at deploy time
    return html`
      <div class="anchor">
        <ix-icon-button
          class="toggle"
          icon="ai"
          variant=${this.open ? 'primary' : 'secondary'}
          title=${localize(AI_MSG.title)}
          @click=${this.toggle}
        ></ix-icon-button>
        ${this.open ? this.renderPanel() : ''}
      </div>
      ${this.configOpen
        ? html`<mf-ai-config-dialog @wui:close=${() => (this.configOpen = false)}></mf-ai-config-dialog>`
        : ''}
    `;
  }

  protected override updated(_changed: PropertyValues): void {
    // Keep the conversation pinned to the latest message.
    if (this.open && this.convEl) this.convEl.scrollTop = this.convEl.scrollHeight;
  }

  // eslint-disable-next-line max-lines-per-function -- single panel template
  private renderPanel(): TemplateResult {
    return html`
      <div class="panel">
        <div class="panel-head">
          <ix-icon name="ai"></ix-icon><span>${localizeDir(AI_MSG.title)}</span>
          <span class="spacer"></span>
          ${this.messages.length > 0
            ? html`<ix-icon-button ghost size="16" icon="trashcan" title=${localize(AI_MSG.clear)} @click=${this.clear}></ix-icon-button>`
            : ''}
          ${this.canEdit
            ? html`<ix-icon-button
                ghost
                size="16"
                icon="cogwheel"
                title=${localize(AI_MSG.configure)}
                @click=${() => (this.configOpen = true)}
              ></ix-icon-button>`
            : ''}
          <ix-icon-button ghost size="16" icon="close" title=${localize(AI_MSG.close)} @click=${this.toggle}></ix-icon-button>
        </div>

        <div class="conv">
          ${this.messages.length === 0 && !this.busy ? this.renderEmpty() : ''}
          ${this.messages.map((m) => this.renderMsg(m))}
          ${this.busy
            ? html`<div class="msg msg--assistant working">
                <span class="dots"><span></span><span></span><span></span></span>
                <span class="working-text">${localizeDir(AI_MSG.thinking)}</span>
              </div>`
            : ''}
        </div>

        <div class="composer">
          <textarea
            class="ta"
            rows=${PROMPT_ROWS}
            placeholder=${localize(AI_MSG.composerPlaceholder)}
            .value=${this.prompt}
            ?disabled=${this.busy}
            @input=${(e: Event) => (this.prompt = (e.target as HTMLTextAreaElement).value)}
            @keydown=${this.onKey}
          ></textarea>
          <ix-icon-button
            class="send"
            icon="send-right"
            variant="primary"
            title=${localize(AI_MSG.send)}
            ?disabled=${this.busy || this.prompt.trim() === ''}
            @click=${() => void this.sendPrompt()}
          ></ix-icon-button>
        </div>
      </div>
    `;
  }

  private renderEmpty(): TemplateResult {
    return html`
      <div class="placeholder">${localizeDir(AI_MSG.ask)}</div>
      ${this.suggestions.length > 0
        ? html`<div class="suggestions">
            ${this.suggestions.map(
              (s) => html`<button
                class="suggestion"
                type="button"
                ?disabled=${this.busy}
                @click=${() => void this.sendPrompt(s)}
              >
                ${s}
              </button>`
            )}
          </div>`
        : ''}
    `;
  }

  private renderMsg(m: ChatMessage): TemplateResult {
    if (m.role !== 'assistant') {
      return html`<div class="msg msg--${m.role}">${m.text}</div>`;
    }
    return html`<div class="msg msg--assistant">
      ${m.tools && m.tools.length > 0
        ? html`<div class="tools">
            <span class="tools-label">${localizeDir(AI_MSG.tools)}</span>
            ${m.tools.map(
              (t) => html`<span class="tool ${t.ok ? '' : 'tool--err'}" title=${t.ok ? localize(AI_MSG.success) : localize(AI_MSG.failure)}>${t.name}</span>`
            )}
          </div>`
        : ''}
      <div class="md">${unsafeHTML(renderMarkdown(m.text))}</div>
    </div>`;
  }

  private readonly toggle = (): void => {
    this.open = !this.open;
  };

  private readonly clear = (): void => {
    this.messages = [];
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void this.sendPrompt();
    }
  };

  private readonly sendPrompt = async (preset?: string): Promise<void> => {
    const prompt = (preset ?? this.prompt).trim();
    if (!prompt || this.busy) return;
    this.messages = [...this.messages, { role: 'user', text: prompt }];
    this.prompt = '';
    this.busy = true;
    try {
      const answer = await askAi(prompt, { system: this.system });
      this.messages = [
        ...this.messages,
        { role: 'assistant', text: answer.text || localize(AI_MSG.emptyAnswer), tools: answer.toolCalls }
      ];
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      this.messages = [...this.messages, { role: 'error', text }];
    } finally {
      this.busy = false;
    }
  };
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function promptStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: inline-flex;
    }
    .anchor {
      position: relative;
      display: inline-flex;
    }
    .spacer {
      flex: 1;
    }
    .panel {
      position: absolute;
      right: 0;
      top: calc(100% + 0.4rem);
      width: min(460px, 92vw);
      max-height: 80vh;
      z-index: 50;
      display: flex;
      flex-direction: column;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      text-align: left;
    }
    .panel-head {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      padding: 0.5rem 0.6rem;
      font-weight: 600;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .conv {
      flex: 1;
      min-height: 9rem;
      max-height: 52vh;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.6rem;
    }
    .placeholder {
      margin: auto auto 0;
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .suggestions {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin: 0.6rem auto auto;
      width: 100%;
    }
    .suggestion {
      text-align: left;
      padding: 0.45rem 0.6rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
    }
    .suggestion:hover:not(:disabled) {
      border-color: var(--theme-color-primary);
      background: color-mix(in srgb, var(--theme-color-primary) 12%, transparent);
    }
    .suggestion:disabled {
      opacity: 0.5;
      cursor: default;
    }
    .msg {
      max-width: 88%;
      padding: 0.45rem 0.6rem;
      border-radius: 0.6rem;
      white-space: pre-wrap;
      word-break: break-word;
      line-height: 1.35;
    }
    .msg--user {
      align-self: flex-end;
      background: color-mix(in srgb, var(--theme-color-primary) 22%, transparent);
    }
    .msg--assistant {
      align-self: flex-start;
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
    }
    .msg--error {
      align-self: flex-start;
      background: color-mix(in srgb, var(--theme-color-alarm, #ef4444) 18%, transparent);
      border: 1px solid var(--theme-color-alarm, #ef4444);
    }
    .tools {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.25rem;
      margin-bottom: 0.35rem;
    }
    .tools-label {
      font-size: 0.7rem;
      color: var(--theme-color-soft-text);
    }
    .tool {
      font-size: 0.7rem;
      padding: 0.05rem 0.4rem;
      border-radius: 0.7rem;
      background: color-mix(in srgb, var(--theme-color-primary) 22%, transparent);
    }
    .tool--err {
      background: color-mix(in srgb, var(--theme-color-alarm, #ef4444) 22%, transparent);
    }
    .md {
      overflow-wrap: anywhere;
    }
    .md > :first-child {
      margin-top: 0;
    }
    .md > :last-child {
      margin-bottom: 0;
    }
    .md p {
      margin: 0.3rem 0;
    }
    .md h1,
    .md h2,
    .md h3,
    .md h4,
    .md h5,
    .md h6 {
      margin: 0.4rem 0 0.2rem;
      font-size: 1em;
      font-weight: 600;
    }
    .md ul,
    .md ol {
      margin: 0.3rem 0;
      padding-left: 1.2rem;
    }
    .md a {
      color: var(--theme-color-primary);
    }
    .md code {
      background: color-mix(in srgb, var(--theme-color-std-text) 12%, transparent);
      padding: 0.05rem 0.25rem;
      border-radius: 0.25rem;
      font-family: monospace;
      font-size: 0.9em;
    }
    .md pre {
      background: color-mix(in srgb, var(--theme-color-std-text) 10%, transparent);
      padding: 0.5rem;
      border-radius: var(--theme-default-border-radius);
      overflow: auto;
      margin: 0.3rem 0;
    }
    .md pre code {
      background: none;
      padding: 0;
    }
    .working {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .working-text {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .dots {
      display: inline-flex;
      gap: 0.25rem;
    }
    .dots span {
      width: 0.4rem;
      height: 0.4rem;
      border-radius: 50%;
      background: var(--theme-color-primary);
      animation: mf-ai-blink 1.2s infinite ease-in-out both;
    }
    .dots span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .dots span:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes mf-ai-blink {
      0%,
      80%,
      100% {
        opacity: 0.25;
        transform: translateY(0);
      }
      40% {
        opacity: 1;
        transform: translateY(-0.2rem);
      }
    }
    .composer {
      display: flex;
      align-items: flex-end;
      gap: 0.4rem;
      padding: 0.5rem 0.6rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
    .ta {
      flex: 1;
      box-sizing: border-box;
      resize: vertical;
      padding: 0.45rem 0.5rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
    }
    .send {
      flex: 0 0 auto;
    }
  `;
}

// Guarded registration: vendored into several self-contained page bundles that
// share one CustomElementRegistry per SPA session — an unguarded `define` would
// throw on the second AI page that loads.
if (!customElements.get('mf-ai-prompt')) {
  customElements.define('mf-ai-prompt', MfAiPrompt);
}
