// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * PARA AI assistant — a proposal-only chat embedded in the page header.
 *
 * It reuses the AI plumbing of `@visuelconcept/wui-ai-kit` (askAi bridge,
 * markdown renderer, config dialog) but is scoped to PARA modeling and is
 * deliberately *toolless*: every prompt is sent with `mcpServers: []`, so the
 * model has no MCP tools and cannot mutate the project. When it proposes a
 * datapoint-type model (a ```json block), this component surfaces an "apply to
 * editor" action that emits `wui:applytype`; the page then loads the proposal
 * in the model editor for the user to review and save. The user always validates.
 */
import { askAi, type ToolCall } from '@visuelconcept/wui-ai-kit/data/ai-store.js';
import { isAiAssistantEnabled } from '@visuelconcept/wui-ai-kit/data/ai-feature.js';
import { renderMarkdown } from '@visuelconcept/wui-ai-kit/data/markdown.js';
import '@visuelconcept/wui-ai-kit/ui/mf-ai-config-dialog.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { PARA_SUGGESTIONS, buildSystemPrompt, extractTypeProposals, type TypeProposal } from './para-ai-context.js';

const PROMPT_ROWS = 3;

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
  tools?: ToolCall[];
  /** Type models the assistant proposed in this answer (apply-to-editor). */
  proposals?: TypeProposal[];
}

export class WuiParaAiAssistant extends LitElement {
  static override readonly styles = [IXCoreStyles, assistantStyles()];

  /** Short summary of the current page selection, injected into the system prompt. */
  @property({ attribute: false }) contextSummary = '';

  @state() private open = false;
  @state() private prompt = '';
  @state() private messages: ChatMessage[] = [];
  @state() private busy = false;
  @state() private configOpen = false;
  /** Deploy-time feature flag — the assistant renders nothing until enabled. */
  @state() private aiEnabled = false;

  @query('.conv') private convEl?: HTMLElement;

  override connectedCallback(): void {
    super.connectedCallback();
    void isAiAssistantEnabled().then((on) => (this.aiEnabled = on));
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.aiEnabled) return nothing; // hidden unless enabled at deploy time
    return html`
      <div class="anchor">
        <ix-icon-button
          class="toggle"
          icon="ai"
          variant=${this.open ? 'primary' : 'secondary'}
          title="Assistant IA — modélisation PARA"
          @click=${this.toggle}
        ></ix-icon-button>
        ${this.open ? this.renderPanel() : nothing}
      </div>
      ${this.configOpen
        ? html`<mf-ai-config-dialog @wui:close=${() => (this.configOpen = false)}></mf-ai-config-dialog>`
        : nothing}
    `;
  }

  protected override updated(_changed: PropertyValues): void {
    if (this.open && this.convEl) {
      this.convEl.scrollTop = this.convEl.scrollHeight;
    }
  }

  private renderPanel(): TemplateResult {
    return html`
      <div class="panel">
        <div class="panel-head">
          <ix-icon name="ai"></ix-icon><span>Assistant PARA</span>
          <span class="spacer"></span>
          ${this.messages.length > 0
            ? html`<ix-icon-button ghost size="16" icon="trashcan" title="Effacer la conversation" @click=${this.clear}></ix-icon-button>`
            : nothing}
          <ix-icon-button ghost size="16" icon="cogwheel" title="Configurer l'IA (fournisseur, modèle, token)" @click=${() => (this.configOpen = true)}></ix-icon-button>
          <ix-icon-button ghost size="16" icon="close" title="Fermer" @click=${this.toggle}></ix-icon-button>
        </div>
        <div class="conv">
          ${this.messages.length === 0 && !this.busy ? this.renderEmpty() : nothing}
          ${this.messages.map((m) => this.renderMsg(m))}
          ${this.busy
            ? html`<div class="msg msg--assistant working">
                <span class="dots"><span></span><span></span><span></span></span>
                <span class="working-text">L'assistant réfléchit…</span>
              </div>`
            : nothing}
        </div>
        <div class="composer">
          <textarea
            class="ta"
            rows=${PROMPT_ROWS}
            placeholder="Décrivez le modèle à créer… (Ctrl+Entrée pour envoyer)"
            .value=${this.prompt}
            ?disabled=${this.busy}
            @input=${(e: Event) => (this.prompt = (e.target as HTMLTextAreaElement).value)}
            @keydown=${this.onKey}
          ></textarea>
          <ix-icon-button
            class="send"
            icon="send-right"
            variant="primary"
            title="Envoyer"
            ?disabled=${this.busy || this.prompt.trim() === ''}
            @click=${() => void this.sendPrompt()}
          ></ix-icon-button>
        </div>
      </div>
    `;
  }

  private renderEmpty(): TemplateResult {
    return html`
      <div class="placeholder">Demandez à l'assistant de proposer ou d'ajuster un modèle de données. Il propose ; vous validez dans l'éditeur.</div>
      <div class="suggestions">
        ${PARA_SUGGESTIONS.map(
          (s) => html`<button class="suggestion" type="button" ?disabled=${this.busy} @click=${() => void this.sendPrompt(s)}>${s}</button>`
        )}
      </div>
    `;
  }

  private renderMsg(m: ChatMessage): TemplateResult {
    if (m.role !== 'assistant') {
      return html`<div class="msg msg--${m.role}">${m.text}</div>`;
    }
    return html`<div class="msg msg--assistant">
      <div class="md">${unsafeHTML(renderMarkdown(m.text))}</div>
      ${(m.proposals ?? []).map((p) => this.renderProposal(p))}
    </div>`;
  }

  private renderProposal(proposal: TypeProposal): TemplateResult {
    const count = (proposal.structure.children ?? []).length;
    return html`<div class="proposal">
      <ix-icon name="tree" size="16"></ix-icon>
      <span class="proposal-label">Modèle proposé : <strong>${proposal.typeName}</strong> (${count} élément${count > 1 ? 's' : ''})</span>
      <ix-button size="16" variant="primary" icon="upload" @click=${() => this.applyProposal(proposal)}>Appliquer dans l'éditeur</ix-button>
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

  private applyProposal(proposal: TypeProposal): void {
    this.dispatchEvent(new CustomEvent('wui:applytype', { detail: proposal, bubbles: true, composed: true }));
  }

  private readonly sendPrompt = async (preset?: string): Promise<void> => {
    const prompt = (preset ?? this.prompt).trim();
    if (!prompt || this.busy) {
      return;
    }
    this.messages = [...this.messages, { role: 'user', text: prompt }];
    this.prompt = '';
    this.busy = true;
    try {
      // mcpServers: [] -> the assistant runs with NO tools (proposal-only).
      const answer = await askAi(prompt, { system: buildSystemPrompt(this.contextSummary), mcpServers: [] });
      const text = answer.text || '(réponse vide)';
      this.messages = [...this.messages, { role: 'assistant', text, proposals: extractTypeProposals(text) }];
    } catch (error) {
      this.messages = [...this.messages, { role: 'error', text: error instanceof Error ? error.message : String(error) }];
    } finally {
      this.busy = false;
    }
  };
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function assistantStyles(): ReturnType<typeof css> {
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
      width: min(480px, 92vw);
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
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .suggestions {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      margin-top: 0.6rem;
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
      max-width: 92%;
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
      width: 92%;
    }
    .msg--error {
      align-self: flex-start;
      background: color-mix(in srgb, var(--theme-color-alarm, #ef4444) 18%, transparent);
      border: 1px solid var(--theme-color-alarm, #ef4444);
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
    .md ul,
    .md ol {
      margin: 0.3rem 0;
      padding-left: 1.2rem;
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
    .proposal {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      margin-top: 0.5rem;
      padding: 0.4rem 0.5rem;
      border: 1px solid var(--theme-color-primary);
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-primary) 10%, transparent);
    }
    .proposal-label {
      flex: 1;
      font-size: 0.8rem;
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
      animation: para-ai-blink 1.2s infinite ease-in-out both;
    }
    .dots span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .dots span:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes para-ai-blink {
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

if (!customElements.get('wui-para-ai-assistant')) {
  customElements.define('wui-para-ai-assistant', WuiParaAiAssistant);
}
