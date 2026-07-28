// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CodeMirror-6 script editor: JavaScript syntax highlighting (one-dark
 * palette over the dashboard theme tokens), line numbers, bracket matching,
 * history, Tab indentation — plus the live parse-only syntax probe
 * (types.ts `scriptSyntaxError`; the script is never executed here).
 *
 * Controlled component: the parent owns the text (`script` prop) and receives
 * `wui:scriptchange` on every edit; an external prop change replaces the
 * document only when it differs from the current one (no update loop).
 * The tab bodies unmount on tab switches, so the CodeMirror view is created
 * on every (re)connect and destroyed on disconnect.
 */
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { Compartment, EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { property, query } from 'lit/decorators.js';
import { MSG, localizeDir } from './i18n.js';
import { scriptSyntaxError } from './types.js';

/** Editor chrome aligned on the dashboard theme (layered after oneDark). */
const dashboardTheme = EditorView.theme(
  {
    '&': {
      height: '100%',
      fontSize: '0.8125rem',
      backgroundColor: 'var(--theme-color-1)'
    },
    '&.cm-focused': { outline: 'none' },
    '.cm-content': { fontFamily: 'monospace' },
    '.cm-gutters': {
      backgroundColor: 'var(--theme-color-2)',
      color: 'var(--theme-color-soft-text)',
      border: 'none',
      borderRight: '1px solid var(--theme-color-soft-bdr)'
    },
    '.cm-scroller': { overflow: 'auto' }
  },
  { dark: true }
);

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
        flex-direction: column;
        border: 1px solid var(--theme-color-soft-bdr);
        border-radius: var(--theme-default-border-radius);
        overflow: hidden;
        background: var(--theme-color-1);
      }
      .frame > .cm-editor {
        flex: 1;
        min-height: 0;
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
  /** Read-only rendering (no edit role / model script shown on an instance). */
  @property({ type: Boolean }) readonly = false;

  @query('.frame') private frame?: HTMLElement;

  private view?: EditorView;
  private readonly readonlyCompartment = new Compartment();

  override render(): TemplateResult {
    const syntax = scriptSyntaxError(this.script);
    return html`
      <div class="hint">${localizeDir(MSG.editor.scriptHint)}</div>
      <div class="frame"></div>
      ${syntax == null
        ? html`<div class="syntax ok">✓ ${localizeDir(MSG.editor.syntaxOk)}</div>`
        : html`<div class="syntax ko">✗ ${localizeDir(MSG.editor.syntaxError)} — ${syntax}</div>`}
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Tab switches unmount/remount this element: rebuild the view on reconnect
    // (initial mount goes through firstUpdated — the frame does not exist yet).
    if (this.hasUpdated) {
      void this.updateComplete.then(() => this.createView());
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.view?.destroy();
    this.view = undefined;
  }

  protected override firstUpdated(): void {
    this.createView();
  }

  protected override updated(changed: PropertyValues<this>): void {
    const view = this.view;
    if (view == null) {
      return;
    }
    if (changed.has('script') && view.state.doc.toString() !== this.script) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: this.script } });
    }
    if (changed.has('readonly')) {
      view.dispatch({ effects: this.readonlyCompartment.reconfigure(this.readonlyExtensions()) });
    }
  }

  private createView(): void {
    if (this.frame == null || !this.isConnected) {
      return;
    }
    this.view?.destroy();
    this.view = new EditorView({
      parent: this.frame,
      state: EditorState.create({
        doc: this.script,
        extensions: [
          minimalSetup,
          lineNumbers(),
          keymap.of([indentWithTab]),
          javascript(),
          oneDark,
          dashboardTheme,
          this.readonlyCompartment.of(this.readonlyExtensions()),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              this.dispatchEvent(
                new CustomEvent('wui:scriptchange', {
                  detail: update.state.doc.toString(),
                  bubbles: true,
                  composed: true
                })
              );
            }
          })
        ]
      })
    });
  }

  private readonlyExtensions() {
    return [EditorState.readOnly.of(this.readonly), EditorView.editable.of(!this.readonly)];
  }
}

if (!customElements.get('wui-ms-script-editor')) {
  customElements.define('wui-ms-script-editor', WuiMsScriptEditor);
}
