// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * GIS AI assistant — a proposal-only chat for configuring a site quickly.
 *
 * It reuses the AI plumbing of `@visuelconcept/wui-ai-kit` (the `askAi` bridge, the
 * markdown renderer, the config dialog) but is scoped to geographic modelling and runs
 * `mcpMode: 'read-only'`: it gets the project's configured MCP servers with every mutating
 * tool filtered out in the manager, so it can *look up* real datapoints — and geocode, if
 * such a server is configured — and still cannot touch the project.
 *
 * A proposal is a **patch** (a ```json block of operations against the open site's ids),
 * so an answer completes the site instead of replacing it. This component previews the
 * merge to show the resulting **diff** — added / modified / removed, per object — because
 * an apply button that says "3 ajouts, 1 modification" is reviewable in a way that
 * "appliquer (remplace le contenu)" never was. Applying emits `wui:applysite` with the
 * patch, not with a finished site: the page re-merges at that moment, against the site as
 * it stands then. The user always validates.
 *
 * Rendered only when the AI assistant is enabled at deploy time
 * (`dashboard-features.json`), like every other assistant in this dashboard.
 */
import { isAiAssistantEnabled } from '@visuelconcept/wui-ai-kit/data/ai-feature.js';
import {
  askAi,
  type ToolCall
} from '@visuelconcept/wui-ai-kit/data/ai-store.js';
import {
  newProgressId,
  subscribeAiProgress,
  type AiProgressEvent
} from '@visuelconcept/wui-ai-kit/data/ai-progress.js';
import { renderMarkdown } from '@visuelconcept/wui-ai-kit/data/markdown.js';
import { AI_MSG } from '@visuelconcept/wui-ai-kit/i18n.js';
import '@visuelconcept/wui-ai-kit/ui/mf-ai-config-dialog.js';
import '@visuelconcept/wui-ai-kit/ui/mf-ai-progress.js';
import '@visuelconcept/wui-ai-kit/ui/mf-ai-tool-trace.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import {
  LitElement,
  css,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult
} from 'lit';
import { property, query, state } from 'lit/decorators.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import {
  AREA_PALETTE,
  buildSystemPrompt,
  extractSitePatches,
  siteContextJson
} from '../ai-context.js';
import {
  applySitePatch,
  diffSites,
  isEmptyDiff,
  type SiteDiff,
  type SitePatch
} from '../data/site-patch.js';
import type { Site } from '../types.js';
import { MSG, diffSummaryMsg, localize, localizeDir } from '../i18n.js';

const PROMPT_ROWS = 3;

interface ChatMessage {
  role: 'user' | 'assistant' | 'error';
  text: string;
  /** Patches proposed in this answer (apply-to-map). */
  patches?: SitePatch[];
  /** The MCP tools this answer used, with their arguments and results. */
  tools?: ToolCall[];
}

export class WuiGisAiAssistant extends LitElement {
  static override readonly styles = [IXCoreStyles, assistantStyles()];

  /**
   * The open site, or `null` on the overview. It is BOTH what the model receives as
   * context and what a patch is previewed against, so the two can never disagree.
   */
  @property({ attribute: false }) site: Site | null = null;

  /** Names of the existing sites — context for a proposal that creates a new one. */
  @property({ attribute: false }) siteNames: readonly string[] = [];

  @state() private open = false;
  @state() private prompt = '';
  @state() private messages: ChatMessage[] = [];
  @state() private busy = false;
  @state() private configOpen = false;
  /** Deploy-time feature flag — the assistant renders nothing until enabled. */
  @state() private aiEnabled = false;
  /**
   * Whether the last answer had MCP tools available. Only affects the wording of the
   * waiting state: the bridge is a single unary call, so there is no way to know
   * *which* tool is running while it runs.
   */
  @state() private hasTools = false;
  /** Live steps of the prompt in flight (see `ai-progress.ts`). */
  @state() private progress: readonly AiProgressEvent[] = [];

  @query('.conv') private convEl?: HTMLElement;

  override connectedCallback(): void {
    super.connectedCallback();
    void isAiAssistantEnabled().then((on) => (this.aiEnabled = on));
  }

  override render(): TemplateResult | typeof nothing {
    if (!this.aiEnabled) return nothing;
    return html`
      <div class="anchor">
        <ix-icon-button
          class="toggle"
          icon="ai"
          variant=${this.open ? 'primary' : 'secondary'}
          title=${localize(MSG.ai.assistantTitle)}
          @click=${this.toggle}
        ></ix-icon-button>
        ${
          this.open
            ? html`<div class="backdrop" @click=${this.toggle}></div>
                ${this.renderPanel()}`
            : nothing
        }
        ${
          // Minimised with a thread going: the icon carries the message count, so the
          // conversation is visibly still there rather than seemingly lost.
          !this.open && this.messages.length > 0
            ? html`<span class="badge" aria-hidden="true"
                >${this.messages.length}</span
              >`
            : nothing
        }
      </div>
      ${
        this.configOpen
          ? html`<mf-ai-config-dialog
              @wui:close=${() => (this.configOpen = false)}
            ></mf-ai-config-dialog>`
          : nothing
      }
    `;
  }

  protected override updated(_changed: PropertyValues): void {
    if (this.open && this.convEl)
      this.convEl.scrollTop = this.convEl.scrollHeight;
  }

  private renderPanel(): TemplateResult {
    return html`
      <div class="panel">
        <div class="panel-head">
          <ix-icon name="ai"></ix-icon
          ><span>${localizeDir(MSG.ai.panelTitle)}</span>
          <span class="spacer"></span>
          ${
            this.messages.length > 0
              ? html`<ix-icon-button
                  ghost
                  size="16"
                  icon="trashcan"
                  title=${localize(MSG.ai.clear)}
                  @click=${this.clear}
                ></ix-icon-button>`
              : nothing
          }
          <ix-icon-button
            ghost
            size="16"
            icon="cogwheel"
            title=${localize(MSG.ai.configure)}
            @click=${() => (this.configOpen = true)}
          ></ix-icon-button>
          <ix-icon-button
            ghost
            size="16"
            icon="close"
            title=${localize(MSG.ai.close)}
            @click=${this.toggle}
          ></ix-icon-button>
        </div>
        <div class="conv">
          <div class="conv-inner">
            ${this.messages.length === 0 && !this.busy ? this.renderEmpty() : nothing}
            ${this.messages.map((message) => this.renderMsg(message))}
            ${
              this.busy
                ? html`<div class="msg msg--assistant working">
                    <div class="working-head">
                      <span class="dots"
                        ><span></span><span></span><span></span
                      ></span>
                      <span class="working-text"
                        >${localizeDir(this.hasTools ? AI_MSG.usingTools : MSG.ai.thinking)}</span
                      >
                    </div>
                    <mf-ai-progress .events=${this.progress}></mf-ai-progress>
                  </div>`
                : nothing
            }
          </div>
        </div>
        <div class="composer">
          <textarea
            class="ta"
            rows=${PROMPT_ROWS}
            placeholder=${localize(MSG.ai.composerPlaceholder)}
            .value=${this.prompt}
            ?disabled=${this.busy}
            @input=${(event: Event) => (this.prompt = (event.target as HTMLTextAreaElement).value)}
            @keydown=${this.onKey}
          ></textarea>
          <ix-icon-button
            class="send"
            icon="send-right"
            variant="primary"
            title=${localize(MSG.ai.send)}
            ?disabled=${this.busy || this.prompt.trim() === ''}
            @click=${() => void this.sendPrompt()}
          ></ix-icon-button>
        </div>
      </div>
    `;
  }

  private renderEmpty(): TemplateResult {
    const suggestions = [
      MSG.aiSuggestions.s1,
      MSG.aiSuggestions.s2,
      MSG.aiSuggestions.s3,
      MSG.aiSuggestions.s4
    ];
    return html`
      <div class="placeholder">${localizeDir(MSG.ai.placeholder)}</div>
      <div class="suggestions">
        ${suggestions.map((suggestion) => {
          const text = localize(suggestion);
          return html`<button
            class="suggestion"
            type="button"
            ?disabled=${this.busy}
            @click=${() => void this.sendPrompt(text)}
          >
            ${text}
          </button>`;
        })}
      </div>
    `;
  }

  private renderMsg(message: ChatMessage): TemplateResult {
    if (message.role !== 'assistant') {
      return html`<div class="msg msg--${message.role}">${message.text}</div>`;
    }
    return html`<div class="msg msg--assistant">
      <mf-ai-tool-trace .calls=${message.tools ?? []}></mf-ai-tool-trace>
      <div class="md">${unsafeHTML(renderMarkdown(message.text))}</div>
      ${(message.patches ?? []).map((patch) => this.renderProposal(patch))}
    </div>`;
  }

  /**
   * The apply affordance, labelled with the diff the merge actually produces: what is
   * added, what is modified, what would be removed. A `replace` proposal is not warned
   * about in the abstract any more — its removals are counted like any others.
   *
   * The preview is recomputed at render time, so it follows the site as the user edits it.
   */
  private renderProposal(patch: SitePatch): TemplateResult {
    const merged = applySitePatch(this.site, patch, AREA_PALETTE);
    const diff = diffSites(this.site, merged.site);
    const dropped = merged.report.droppedAssets + merged.report.droppedAreas;
    if (isEmptyDiff(diff)) {
      // A patch that changes nothing (already applied, or aimed at ids that do not
      // exist): saying so is more useful than a button that does nothing.
      return html`<div class="proposal">
        <ix-icon name="info" size="16"></ix-icon>
        <span class="proposal-label">${localizeDir(MSG.ai.noChange)}</span>
      </div>`;
    }
    return html`<div class="proposal">
      <ix-icon name="map" size="16"></ix-icon>
      <span class="proposal-label">
        ${this.renderDiff(diff)}
        <span class="warn">${localizeDir(MSG.ai.approxWarn)}</span>
        ${patch.mode === 'replace' ? html`<span class="warn">${localizeDir(MSG.ai.replaceWarn)}</span>` : nothing}
        ${dropped > 0 ? html`<span class="warn">${localizeDir(MSG.ai.droppedWarn)}</span>` : nothing}
      </span>
      <ix-button
        size="16"
        variant="primary"
        icon="upload"
        @click=${() => this.applyProposal(patch)}
      >
        ${localizeDir(this.site ? MSG.ai.applyToSite : MSG.ai.applyAsNew)}
      </ix-button>
    </div>`;
  }

  /** The diff as three counted chips, each listing the objects behind it on hover. */
  private renderDiff(diff: SiteDiff): TemplateResult {
    const parts = [
      {
        kind: 'add',
        entries: [...diff.areas.added, ...diff.assets.added],
        msg: MSG.ai.diffAdded
      },
      {
        kind: 'mod',
        entries: [...diff.areas.updated, ...diff.assets.updated],
        msg: MSG.ai.diffUpdated
      },
      {
        kind: 'del',
        entries: [...diff.areas.removed, ...diff.assets.removed],
        msg: MSG.ai.diffRemoved
      }
    ].filter((part) => part.entries.length > 0);
    return html`<span class="diff">
      ${parts.map(
        (part) =>
          html`<span
            class="chip chip--${part.kind}"
            title=${part.entries.map((entry) => entry.name).join(', ')}
            >${diffSummaryMsg(part.msg, part.entries.length)}</span
          >`
      )}
      ${diff.view || diff.meta ? html`<span class="chip">${localizeDir(MSG.ai.diffView)}</span>` : nothing}
    </span>`;
  }

  private readonly toggle = (): void => {
    this.open = !this.open;
  };

  private readonly clear = (): void => {
    this.messages = [];
  };

  private readonly onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.sendPrompt();
    }
  };

  private applyProposal(patch: SitePatch): void {
    this.dispatchEvent(
      new CustomEvent('wui:applysite', {
        detail: patch,
        bubbles: true,
        composed: true
      })
    );
  }

  private readonly sendPrompt = async (preset?: string): Promise<void> => {
    const prompt = (preset ?? this.prompt).trim();
    if (!prompt || this.busy) return;
    this.messages = [...this.messages, { role: 'user', text: prompt }];
    this.prompt = '';
    this.busy = true;
    this.progress = [];
    // The answer cannot report progress (one request, one reply), so the manager
    // narrates into a datapoint and we follow it for exactly as long as this prompt
    // runs — `stop()` in `finally`, including when it throws.
    const progressId = newProgressId();
    const stop = subscribeAiProgress(progressId, (events) => (this.progress = events));
    try {
      // The project's configured MCP servers, in READ-ONLY mode: the manager drops
      // every mutating tool before the model hears of it, so the assistant can look
      // up real datapoints (and geocode, if such a server is configured) while
      // remaining unable to change anything. Proposal-only is now enforced by what
      // the tool list contains, not by the absence of a tool list.
      const answer = await askAi(prompt, {
        system: buildSystemPrompt(siteContextJson(this.site, this.siteNames)),
        mcpMode: 'read-only',
        progressId
      });
      const text = answer.text || localize(MSG.ai.emptyAnswer);
      // Remember whether tools were on offer, so the next wait can say "reading the
      // project through its tools" instead of the generic "thinking".
      this.hasTools = answer.mcpTools > 0;
      // A truncated answer ends mid-object, so its JSON block does not parse and no
      // patch is offered. `truncated` is what lets us say why instead of staying mute.
      this.messages = [
        ...this.messages,
        {
          role: 'assistant',
          text,
          tools: answer.toolCalls,
          patches: answer.truncated ? [] : extractSitePatches(text)
        }
      ];
    } catch (error) {
      this.messages = [
        ...this.messages,
        {
          role: 'error',
          text: error instanceof Error ? error.message : String(error)
        }
      ];
    } finally {
      stop();
      this.busy = false;
      this.progress = [];
    }
  };
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function assistantStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: contents;
    }
    .anchor {
      position: relative;
      display: inline-flex;
    }
    /*
     * A centred overlay rather than a dropdown anchored to the icon: this
     * conversation is a working surface (a JSON patch, a tool trace, a diff to read),
     * and it was cramped in a 30rem popover pinned to a toolbar corner. The backdrop
     * only dims — clicking it MINIMISES, it does not destroy: the element stays
     * mounted, so the thread, the proposals and the traces are all still there when
     * the AI icon is clicked again.
     */
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 30;
      background: rgb(0 0 0 / 35%);
    }
    .panel {
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      z-index: 31;
      display: flex;
      flex-direction: column;
      width: min(56rem, 94vw);
      height: min(46rem, 86vh);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      box-shadow: 0 12px 40px rgb(0 0 0 / 50%);
      overflow: hidden;
    }
    .conv-inner {
      width: min(52rem, 100%);
      margin: 0 auto;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .badge {
      position: absolute;
      top: -0.25rem;
      right: -0.25rem;
      min-width: 1rem;
      padding: 0 0.2rem;
      border-radius: 999px;
      background: var(--theme-color-primary);
      color: var(--theme-color-primary--contrast, #fff);
      font-size: 0.625rem;
      line-height: 1rem;
      text-align: center;
      pointer-events: none;
    }
    .panel-head {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.375rem 0.375rem 0.625rem;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
      font-weight: 600;
    }
    .panel-head .spacer {
      flex: 1;
    }
    .conv {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.625rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .placeholder {
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
    }
    .suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
    }
    .suggestion {
      padding: 0.25rem 0.5rem;
      border-radius: 999px;
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-soft-text);
      font: inherit;
      font-size: 0.75rem;
      text-align: left;
      cursor: pointer;
    }
    .suggestion:hover:not(:disabled) {
      border-color: var(--theme-color-primary);
      color: var(--theme-color-std-text);
    }
    .msg {
      padding: 0.375rem 0.5rem;
      border-radius: var(--theme-default-border-radius);
      font-size: 0.8125rem;
      white-space: pre-wrap;
    }
    .msg--user {
      align-self: flex-end;
      max-width: 85%;
      background: var(--theme-color-primary);
      color: var(--theme-color-inv-text, #fff);
      white-space: pre-wrap;
    }
    .msg--assistant {
      background: var(--theme-color-1);
      border: 1px solid var(--theme-color-soft-bdr);
    }
    .msg--error {
      background: color-mix(in srgb, var(--theme-color-alarm) 16%, transparent);
      border: 1px solid var(--theme-color-alarm);
      color: var(--theme-color-alarm);
    }
    .md {
      white-space: normal;
    }
    .md :first-child {
      margin-top: 0;
    }
    .md :last-child {
      margin-bottom: 0;
    }
    .md pre {
      overflow-x: auto;
      padding: 0.375rem;
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      font-size: 0.75rem;
    }
    .working {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 0.25rem;
      color: var(--theme-color-soft-text);
    }
    .working-head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    .dots {
      display: inline-flex;
      gap: 0.1875rem;
    }
    .dots span {
      width: 0.3125rem;
      height: 0.3125rem;
      border-radius: 50%;
      background: var(--theme-color-primary);
      animation: blink 1.2s infinite ease-in-out;
    }
    .dots span:nth-child(2) {
      animation-delay: 0.2s;
    }
    .dots span:nth-child(3) {
      animation-delay: 0.4s;
    }
    @keyframes blink {
      0%,
      80%,
      100% {
        opacity: 0.25;
      }
      40% {
        opacity: 1;
      }
    }
    .proposal {
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
      margin-top: 0.5rem;
      padding: 0.5rem;
      border: 1px solid var(--theme-color-primary);
      border-radius: var(--theme-default-border-radius);
      background: color-mix(
        in srgb,
        var(--theme-color-primary) 10%,
        transparent
      );
    }
    .proposal-label {
      flex: 1;
      font-size: 0.75rem;
      line-height: 1.35;
    }
    .diff {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-right: 0.25rem;
    }
    .chip {
      padding: 0 0.35rem;
      border-radius: 0.75rem;
      font-weight: 600;
      white-space: nowrap;
      background: var(--theme-color-ghost--hover);
      cursor: default;
    }
    .chip--add {
      background: color-mix(
        in srgb,
        var(--theme-color-success, #2d9d4f) 24%,
        transparent
      );
    }
    .chip--mod {
      background: color-mix(
        in srgb,
        var(--theme-color-warning, #e8a33d) 24%,
        transparent
      );
    }
    .chip--del {
      background: color-mix(
        in srgb,
        var(--theme-color-alarm, #ef4444) 24%,
        transparent
      );
    }
    .proposal .warn {
      display: block;
      margin-top: 0.125rem;
      color: var(--theme-color-warning);
    }
    .composer {
      display: flex;
      gap: 0.375rem;
      padding: 0.5rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
      align-items: flex-end;
    }
    .ta {
      flex: 1;
      resize: vertical;
      padding: 0.375rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
      font-size: 0.8125rem;
    }
  `;
}

if (!customElements.get('wui-gis-ai-assistant')) {
  customElements.define('wui-gis-ai-assistant', WuiGisAiAssistant);
}
