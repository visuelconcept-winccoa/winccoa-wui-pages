// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * CodeMirror-6 script editor: JavaScript syntax highlighting, line numbers,
 * bracket matching, history, Tab indentation — plus the live parse-only
 * syntax probe (types.ts `scriptSyntaxError`; the script is never executed
 * here).
 *
 * THEME-AWARE: the editor chrome (background, gutter, borders) is built on
 * the dashboard's `--theme-*` tokens, so it follows the active iX theme by
 * itself; only the syntax TOKEN palette must be swapped — one-dark in dark
 * themes, CodeMirror's default (light) style otherwise. The active mode is
 * detected from the iX theme class (`theme-*-dark` / `theme-*-light` on
 * html/body) and re-evaluated live through a MutationObserver, so a theme
 * switch restyles open editors without a reload.
 *
 * Controlled component: the parent owns the text (`script` prop) and receives
 * `wui:scriptchange` on every edit; an external prop change replaces the
 * document only when it differs from the current one (no update loop).
 * The tab bodies unmount on tab switches, so the CodeMirror view is created
 * on every (re)connect and destroyed on disconnect.
 */
import { indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDarkHighlightStyle } from '@codemirror/theme-one-dark';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { minimalSetup } from 'codemirror';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { property, query } from 'lit/decorators.js';
import { MSG, localizeDir } from './i18n.js';
import { scriptSyntaxError } from './types.js';

/** Editor chrome on the dashboard theme tokens (valid for light AND dark). */
const CHROME_SPEC = {
  '&': {
    height: '100%',
    fontSize: '0.8125rem',
    backgroundColor: 'var(--theme-color-1)',
    color: 'var(--theme-color-std-text)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-content': { fontFamily: 'monospace', caretColor: 'var(--theme-color-std-text)' },
  '.cm-gutters': {
    backgroundColor: 'var(--theme-color-2)',
    color: 'var(--theme-color-soft-text)',
    border: 'none',
    borderRight: '1px solid var(--theme-color-soft-bdr)'
  },
  '.cm-scroller': { overflow: 'auto' }
} as const;

/** iX marks the active theme with a `theme-<name>-dark|light` class. */
function isDarkTheme(): boolean {
  const classes = `${document.documentElement.className} ${document.body?.className ?? ''}`;
  if (/theme-[\w-]*-light/i.test(classes)) return false;
  if (/theme-[\w-]*-dark/i.test(classes)) return true;
  // No iX theme class (bare host page): follow the OS preference, defaulting
  // to dark like the shipped dashboards.
  return window.matchMedia?.('(prefers-color-scheme: light)').matches !== true;
}

/** Chrome + token palette for one mode (swapped through a Compartment). */
function themeExtensions(dark: boolean): Extension {
  return [
    EditorView.theme(CHROME_SPEC, { dark }),
    syntaxHighlighting(dark ? oneDarkHighlightStyle : defaultHighlightStyle)
  ];
}

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
  private readonly themeCompartment = new Compartment();
  private dark = true;
  private themeObserver?: MutationObserver;

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
    this.watchTheme();
    // Tab switches unmount/remount this element: rebuild the view on reconnect
    // (initial mount goes through firstUpdated — the frame does not exist yet).
    if (this.hasUpdated) {
      void this.updateComplete.then(() => this.createView());
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
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

  /** Re-evaluate the iX theme class live (theme switch without reload). */
  private watchTheme(): void {
    this.dark = isDarkTheme();
    this.themeObserver = new MutationObserver(() => {
      const dark = isDarkTheme();
      if (dark !== this.dark) {
        this.dark = dark;
        this.view?.dispatch({ effects: this.themeCompartment.reconfigure(themeExtensions(dark)) });
      }
    });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    if (document.body) {
      this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ['class'] });
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
          this.themeCompartment.of(themeExtensions(this.dark)),
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

  private readonlyExtensions(): Extension {
    return [EditorState.readOnly.of(this.readonly), EditorView.editable.of(!this.readonly)];
  }
}

if (!customElements.get('wui-ms-script-editor')) {
  customElements.define('wui-ms-script-editor', WuiMsScriptEditor);
}
