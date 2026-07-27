// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sandbox dry-run panel: runs the CURRENT task draft through
 * `POST /api/middleware-script/test` (webserver bridge → MiddlewareScript MSA
 * service on the middlewareScript manager). Nothing is written to any output
 * datapoint — the sandbox collects `output()` calls and returns them, with the
 * script logs and duration. Input values are editable, JSON-encoded per line
 * (e.g. `42`, `true`, `"text"`), and can be pre-filled from live values.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { property, state } from 'lit/decorators.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import { MSG, localize, localizeDir, testFailedMsg, testUnavailableMsg } from './i18n.js';
import type { MsTask, MsTestResult } from './types.js';

const TEST_URL = '/api/middleware-script/test';

export class WuiMsTestPanel extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.75rem;
        min-height: 0;
        overflow: auto;
      }
      .hint {
        font-size: 0.75rem;
        color: var(--theme-color-soft-text);
      }
      .head {
        font-weight: 600;
        font-size: 0.8125rem;
      }
      .input-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .input-row .alias {
        flex: 0 0 10rem;
        font-family: monospace;
        font-size: 0.8125rem;
      }
      .input-row .dpe {
        flex: 0 0 16rem;
        font-size: 0.75rem;
        color: var(--theme-color-soft-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .input-row ix-input {
        flex: 1;
        min-width: 8rem;
      }
      .actions {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .result {
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
        padding: 0.75rem;
        background: var(--theme-color-2);
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
      }
      .kv {
        display: flex;
        gap: 0.5rem;
        font-family: monospace;
        font-size: 0.8125rem;
      }
      .kv .k {
        color: var(--theme-color-soft-text);
        flex: 0 0 10rem;
      }
      .logs {
        font-family: monospace;
        font-size: 0.75rem;
        white-space: pre-wrap;
        color: var(--theme-color-soft-text);
        margin: 0;
      }
      .error {
        color: var(--theme-color-alarm);
        font-size: 0.8125rem;
        white-space: pre-wrap;
      }
      .duration {
        font-size: 0.75rem;
        color: var(--theme-color-soft-text);
      }
      .norole {
        color: var(--theme-color-warning, #d9822b);
        font-size: 0.8125rem;
      }
    `
  ];

  /** Current task draft (tested as-is, including unsaved changes). */
  @property({ attribute: false }) task: MsTask | null = null;
  /** Application-Security grant for the test role. */
  @property({ type: Boolean }) canTest = true;

  /** Draft input values, JSON-encoded strings keyed by alias. */
  @state() private values = new Map<string, string>();
  @state() private busy = false;
  @state() private result: MsTestResult | null = null;
  @state() private error = '';

  private readonly api = this.resolveApi();

  override render(): TemplateResult {
    if (this.task == null) {
      return html``;
    }
    return html`
      <div class="head">${localizeDir(MSG.test.head)}</div>
      <div class="hint">${localizeDir(MSG.test.hint)}</div>
      ${this.canTest ? nothing : html`<div class="norole">${localizeDir(MSG.test.noRole)}</div>`}
      ${this.renderInputs()}
      <div class="actions">
        <ix-button outline icon="refresh" ?disabled=${this.busy || this.api == null} @click=${this.loadLive}>
          ${localizeDir(MSG.test.loadLive)}
        </ix-button>
        <ix-button variant="primary" icon="play" ?disabled=${this.busy || !this.canTest} .loading=${this.busy} @click=${this.run}>
          ${localizeDir(MSG.test.run)}
        </ix-button>
      </div>
      ${this.error === '' ? nothing : html`<div class="error">${this.error}</div>`}
      ${this.renderResult()}
    `;
  }

  private renderInputs(): TemplateResult {
    const task = this.task as MsTask;
    if (task.inputs.length === 0) {
      return html`<div class="hint">${localizeDir(MSG.test.noInputs)}</div>`;
    }
    return html`
      <div class="head">${localizeDir(MSG.test.inputValues)}</div>
      ${task.inputs.map(
        (input) => html`
          <div class="input-row">
            <span class="alias">${input.alias}</span>
            <span class="dpe" title=${input.dpe}>${input.dpe}</span>
            <ix-input
              .value=${this.values.get(input.alias) ?? ''}
              placeholder='42 · true · "texte"'
              @valueChange=${(e: Event) => this.setValue(input.alias, (e.target as HTMLInputElement).value)}
            ></ix-input>
          </div>
        `
      )}
    `;
  }

  private renderResult(): TemplateResult {
    if (this.result == null) {
      return html``;
    }
    const outputs = Object.entries(this.result.outputs ?? {});
    const logs = this.result.logs ?? [];
    return html`
      <div class="result">
        <div class="head">${localizeDir(MSG.test.outputs)}</div>
        ${outputs.length === 0
          ? html`<div class="hint">${localizeDir(MSG.test.noOutput)}</div>`
          : outputs.map(
              ([alias, value]) => html`<div class="kv"><span class="k">${alias}</span><span>${JSON.stringify(value)}</span></div>`
            )}
        ${logs.length > 0
          ? html`<div class="head">${localizeDir(MSG.test.logs)}</div>
              <pre class="logs">${logs.join('\n')}</pre>`
          : nothing}
        <div class="duration">${localize(MSG.test.duration)}: ${this.result.durationMs ?? 0} ms</div>
      </div>
    `;
  }

  private setValue(alias: string, value: string): void {
    const next = new Map(this.values);
    next.set(alias, value);
    this.values = next;
  }

  /** Pre-fill the input values from the live DPEs (dpGet, best-effort). */
  private async loadLive(): Promise<void> {
    const task = this.task;
    const api = this.api;
    if (task == null || api == null || task.inputs.length === 0) {
      return;
    }
    const next = new Map(this.values);
    for (const input of task.inputs) {
      try {
        const raw = await firstValueFrom(api.dpGet(input.dpe));
        const value = Array.isArray(raw) ? raw[0] : raw;
        next.set(input.alias, JSON.stringify(value ?? null));
      } catch {
        // Unreadable DPE: leave the drafted value untouched.
      }
    }
    this.values = next;
  }

  private async run(): Promise<void> {
    const task = this.task;
    if (task == null || this.busy) {
      return;
    }
    this.busy = true;
    this.error = '';
    this.result = null;
    try {
      const inputValues: Record<string, unknown> = {};
      for (const input of task.inputs) {
        inputValues[input.alias] = this.parseValue(this.values.get(input.alias) ?? '');
      }
      const response = await fetch(TEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task, inputValues })
      });
      const data = (await response.json().catch(() => null)) as MsTestResult | null;
      if (!response.ok || data == null) {
        this.error = (data as { error?: string } | null)?.error ?? testUnavailableMsg(response.status);
        return;
      }
      this.result = data;
      if (!data.ok && data.error != null) {
        this.error = data.error;
      }
    } catch (error) {
      this.error = testFailedMsg(String(error));
    } finally {
      this.busy = false;
    }
  }

  /** Lenient value parsing: JSON first, then bare string fallback. */
  private parseValue(text: string): unknown {
    const trimmed = text.trim();
    if (trimmed === '') {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}

if (!customElements.get('wui-ms-test-panel')) {
  customElements.define('wui-ms-test-panel', WuiMsTestPanel);
}
