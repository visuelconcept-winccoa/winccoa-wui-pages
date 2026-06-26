/**
 * AI Assistant configuration dialog (canPublish-gated, opened from the AI
 * prompt bar). Edits the provider, model, API token and the list of MCP servers
 * (default: the WinCC OA MCP server) and persists them to the
 * `AI_Assistant_Config` datapoint via {@link saveAiConfig}.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { state } from 'lit/decorators.js';
import {
  AI_PROVIDERS,
  DEFAULT_MCP_SERVER,
  loadAiConfig,
  saveAiConfig,
  type AiConfig,
  type McpServer
} from '../data/ai-store.js';
import { AI_MSG, localize, localizeDir } from '../i18n.js';

export class MfAiConfigDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  @state() private cfg: AiConfig = { provider: 'anthropic', model: '', token: '', mcpServers: [] };
  @state() private saving = false;
  @state() private error = '';

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
  }

  // eslint-disable-next-line max-lines-per-function -- single dialog template
  override render(): TemplateResult {
    const models = AI_PROVIDERS[this.cfg.provider]?.models ?? [];
    return html`
      <div class="backdrop" @click=${this.close}></div>
      <div class="dialog" role="dialog" aria-modal="true">
        <div class="head">
          <ix-icon name="ai"></ix-icon><span>${localizeDir(AI_MSG.cfgTitle)}</span>
          <span class="spacer"></span>
          <ix-icon-button ghost icon="close" title=${localize(AI_MSG.close)} @click=${this.close}></ix-icon-button>
        </div>
        <div class="body">
          <label class="field">
            <span class="lbl">${localizeDir(AI_MSG.provider)}</span>
            <ix-select
              .value=${this.cfg.provider}
              @valueChange=${(e: CustomEvent<string | string[]>) => this.onProvider(e.detail)}
            >
              ${Object.entries(AI_PROVIDERS).map(
                ([key, p]) => html`<ix-select-item value=${key} label=${p.label}></ix-select-item>`
              )}
            </ix-select>
          </label>
          <label class="field">
            <span class="lbl">${localizeDir(AI_MSG.model)}</span>
            <ix-select
              editable
              .value=${this.cfg.model}
              @valueChange=${(e: CustomEvent<string | string[]>) =>
                (this.cfg = { ...this.cfg, model: toStr(e.detail) })}
            >
              ${models.map((m) => html`<ix-select-item value=${m} label=${m}></ix-select-item>`)}
            </ix-select>
          </label>
          <label class="field">
            <span class="lbl">${localizeDir(AI_MSG.token)}</span>
            <input
              class="in"
              type="password"
              autocomplete="off"
              .value=${this.cfg.token}
              @input=${(e: Event) => (this.cfg = { ...this.cfg, token: (e.target as HTMLInputElement).value })}
            />
          </label>

          <div class="mcp">
            <div class="mcp-head">
              <span class="lbl">${localizeDir(AI_MSG.mcpServers)}</span>
              <span class="spacer"></span>
              <ix-button variant="secondary" @click=${this.addMcp}>
                <ix-icon name="plus" slot="icon"></ix-icon>${localizeDir(AI_MSG.add)}
              </ix-button>
            </div>
            ${this.cfg.mcpServers.length === 0
              ? html`<div class="muted">${localizeDir(AI_MSG.noMcp)}</div>`
              : this.cfg.mcpServers.map((s, i) => this.renderMcpRow(s, i))}
            <div class="hint">${localizeDir(AI_MSG.mcpHint)}</div>
          </div>

          ${this.error ? html`<div class="err">${this.error}</div>` : ''}
        </div>
        <div class="foot">
          <ix-button variant="secondary" outline @click=${this.close}>${localizeDir(AI_MSG.cancel)}</ix-button>
          <ix-button @click=${this.save} ?disabled=${this.saving}>
            <ix-icon name="check" slot="icon"></ix-icon>${localizeDir(AI_MSG.save)}
          </ix-button>
        </div>
      </div>
    `;
  }

  private renderMcpRow(s: McpServer, i: number): TemplateResult {
    return html`
      <div class="mcp-card">
        <div class="mcp-card-head">
          <span class="mcp-card-title">${localize(AI_MSG.mcpServer)} ${i + 1}</span>
          <span class="spacer"></span>
          <ix-icon-button ghost size="16" icon="trashcan" title=${localize(AI_MSG.removeServer)}
            @click=${() => this.removeMcp(i)}></ix-icon-button>
        </div>
        <label class="field">
          <span class="lbl">${localizeDir(AI_MSG.nameLbl)} <em>${localizeDir(AI_MSG.nameHint)}</em></span>
          <input class="in" placeholder="winccoa" .value=${s.name}
            @input=${(e: Event) => this.patchMcp(i, { name: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">
          <span class="lbl">URL <em>${localizeDir(AI_MSG.urlHint)}</em></span>
          <input class="in" placeholder="http://127.0.0.1:3000/mcp" .value=${s.url}
            @input=${(e: Event) => this.patchMcp(i, { url: (e.target as HTMLInputElement).value })} />
        </label>
        <label class="field">
          <span class="lbl">${localizeDir(AI_MSG.token)} <em>${localizeDir(AI_MSG.tokenHint)}</em></span>
          <input class="in" type="password" autocomplete="off" placeholder=${localize(AI_MSG.tokenPlaceholder)} .value=${s.token ?? ''}
            @input=${(e: Event) => this.patchMcp(i, { token: (e.target as HTMLInputElement).value })} />
        </label>
      </div>
    `;
  }

  private async load(): Promise<void> {
    this.cfg = await loadAiConfig();
  }

  private onProvider(value: string | string[]): void {
    const provider = toStr(value);
    const model = AI_PROVIDERS[provider]?.models[0] ?? this.cfg.model;
    this.cfg = { ...this.cfg, provider, model };
  }

  private addMcp(): void {
    const next = this.cfg.mcpServers.length === 0 ? { ...DEFAULT_MCP_SERVER } : { name: '', url: '', token: '' };
    this.cfg = { ...this.cfg, mcpServers: [...this.cfg.mcpServers, next] };
  }

  private removeMcp(i: number): void {
    this.cfg = { ...this.cfg, mcpServers: this.cfg.mcpServers.filter((_, idx) => idx !== i) };
  }

  private patchMcp(i: number, patch: Partial<McpServer>): void {
    this.cfg = {
      ...this.cfg,
      mcpServers: this.cfg.mcpServers.map((s, idx) => (idx === i ? { ...s, ...patch } : s))
    };
  }

  private readonly close = (): void => {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  };

  private readonly save = async (): Promise<void> => {
    this.saving = true;
    this.error = '';
    try {
      await saveAiConfig(this.cfg);
      this.close();
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      this.saving = false;
    }
  };
}

function toStr(v: string | string[]): string {
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function dialogStyles(): ReturnType<typeof css> {
  return css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
    }
    .dialog {
      position: relative;
      width: 560px;
      max-width: 92vw;
      max-height: 88vh;
      display: flex;
      flex-direction: column;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
      color: var(--theme-color-std-text);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      font-weight: 600;
      border-bottom: 1px solid var(--theme-color-soft-bdr);
    }
    .body {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      overflow: auto;
    }
    .spacer {
      flex: 1;
    }
    .field {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .lbl {
      font-size: 0.8rem;
      color: var(--theme-color-soft-text);
    }
    .lbl em {
      font-style: normal;
      font-weight: 400;
      opacity: 0.85;
    }
    .in {
      width: 100%;
      box-sizing: border-box;
      padding: 0.4rem 0.5rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-soft-bdr);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      font: inherit;
    }
    .mcp {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
    }
    .mcp-head {
      display: flex;
      align-items: center;
    }
    .mcp-card {
      display: flex;
      flex-direction: column;
      gap: 0.4rem;
      padding: 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
    }
    .mcp-card-head {
      display: flex;
      align-items: center;
    }
    .mcp-card-title {
      font-size: 0.8rem;
      font-weight: 600;
    }
    .grow {
      flex: 1;
    }
    .hint,
    .muted {
      font-size: 0.75rem;
      color: var(--theme-color-soft-text);
    }
    .err {
      padding: 0.4rem 0.6rem;
      border-radius: var(--theme-default-border-radius);
      background: color-mix(in srgb, var(--theme-color-alarm, #ef4444) 18%, transparent);
      border: 1px solid var(--theme-color-alarm, #ef4444);
    }
    .foot {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      border-top: 1px solid var(--theme-color-soft-bdr);
    }
  `;
}

// Guarded registration: this component is vendored into several self-contained
// page bundles (para, machine-fleet-3d, …). They share ONE CustomElementRegistry
// per SPA session, so an unguarded `define` throws on the second page that loads.
if (!customElements.get('mf-ai-config-dialog')) {
  customElements.define('mf-ai-config-dialog', MfAiConfigDialog);
}
