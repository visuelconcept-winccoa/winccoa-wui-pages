// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Dependency-free script editor: a monospace textarea with a synced
 * line-number gutter, Tab-inserts-indentation, and a live parse-only syntax
 * probe (types.ts `scriptSyntaxError` — the script is never executed here).
 * Emits `wui:scriptchange` with the new text on every edit.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { property, query } from 'lit/decorators.js';
import { MSG, localizeDir } from './i18n.js';
import { scriptSyntaxError } from './types.js';

const INDENT = '  ';

export class WuiMsScriptEditor extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        gap: 0.375rem;
        min-height: 0;
      }
      .hint {
        font-size: 0.75rem;
        color: var(--theme-color-soft-text);
      }
      .frame {
        flex: 1;
        min-height: 12rem;
        display: flex;
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
        overflow: hidden;
        background: var(--theme-color-1);
      }
      .gutter {
        padding: 0.5rem 0.375rem;
        text-align: right;
        font-family: monospace;
        font-size: 0.8125rem;
        line-height: 1.4;
        color: var(--theme-color-soft-text);
        background: var(--theme-color-2);
        border-right: 1px solid var(--theme-color-soft-bdr);
        user-select: none;
        overflow: hidden;
        white-space: pre;
        min-width: 2.25rem;
      }
      textarea {
        flex: 1;
        min-width: 0;
        border: none;
        outline: none;
        resize: none;
        padding: 0.5rem;
        font-family: monospace;
        font-size: 0.8125rem;
        line-height: 1.4;
        color: var(--theme-color-std-text);
        background: transparent;
        white-space: pre;
        overflow: auto;
        tab-size: 2;
      }
      .syntax {
        font-size: 0.75rem;
        font-family: monospace;
      }
      .syntax.ok {
        color: var(--theme-color-success);
      }
      .syntax.ko {
        color: var(--theme-color-alarm);
      }
    `
  ];

  /** Current script text (the parent owns the draft). */
  @property({ type: String }) script = '';
  /** Read-only rendering (no edit role). */
  @property({ type: Boolean }) readonly = false;

  @query('textarea') private textarea?: HTMLTextAreaElement;
  @query('.gutter') private gutter?: HTMLElement;

  override render(): TemplateResult {
    const syntax = scriptSyntaxError(this.script);
    const lineCount = Math.max(1, this.script.split('\n').length);
    const numbers = Array.from({ length: lineCount }, (_unused, i) => i + 1).join('\n');
    return html`
      <div class="hint">${localizeDir(MSG.editor.scriptHint)}</div>
      <div class="frame">
        <div class="gutter">${numbers}</div>
        <textarea
          .value=${this.script}
          spellcheck="false"
          ?readonly=${this.readonly}
          @input=${this.onInput}
          @keydown=${this.onKeydown}
          @scroll=${this.syncScroll}
        ></textarea>
      </div>
      ${syntax == null
        ? html`<div class="syntax ok">✓ ${localizeDir(MSG.editor.syntaxOk)}</div>`
        : html`<div class="syntax ko">✗ ${localizeDir(MSG.editor.syntaxError)} — ${syntax}</div>`}
    `;
  }

  private onInput(event: Event): void {
    const text = (event.target as HTMLTextAreaElement).value;
    this.dispatchEvent(new CustomEvent('wui:scriptchange', { detail: text, bubbles: true, composed: true }));
  }

  /** Tab inserts indentation instead of moving the focus. */
  private onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || this.readonly) {
      return;
    }
    event.preventDefault();
    const area = event.target as HTMLTextAreaElement;
    const { selectionStart, selectionEnd, value } = area;
    area.value = value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd);
    area.selectionStart = selectionStart + INDENT.length;
    area.selectionEnd = area.selectionStart;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private syncScroll(): void {
    if (this.gutter && this.textarea) {
      this.gutter.scrollTop = this.textarea.scrollTop;
    }
  }
}

if (!customElements.get('wui-ms-script-editor')) {
  customElements.define('wui-ms-script-editor', WuiMsScriptEditor);
}
