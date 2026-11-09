// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The opening view of one atelier (#70): its building's front side, and either the module's view
 * (default) or a view of its own — the same illustrated choices, tried live on this atelier.
 * Read-only without the role `edit`. Emits `wui:apply` with `{ opening }` and `wui:close`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { overlayClicked, overlayDown } from '@visuelconcept-winccoa/wui-fleet-core/ui/overlay-dismiss.js';
import {
  DEFAULT_OPENING_VIEW,
  normalizeFront,
  normalizeOpeningView,
  type AtelierOpening,
  type FrontSide,
  type OpeningViewSetting
} from '@visuelconcept-winccoa/wui-fleet-core/opening-view.js';
import type { PreviewAtelier } from '../scene/opening-preview.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';
import './mf-opening-editor.js';
import type { OpeningChange } from './mf-opening-editor.js';

@customElement('mf-opening-dialog')
export class MfOpeningDialog extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    dialogStyles(),
    css`
      .panel {
        width: 900px;
      }
      .lead {
        color: var(--theme-color-soft-text);
        margin: 0 0 0.6rem;
        line-height: 1.4;
      }
      .source {
        display: grid;
        gap: 0.35rem;
        margin-bottom: 0.8rem;
      }
      .source label {
        display: flex;
        gap: 0.5rem;
        align-items: baseline;
        cursor: pointer;
      }
      .source em {
        font-style: normal;
        color: var(--theme-color-soft-text);
      }
      .source input {
        accent-color: var(--theme-color-primary);
      }
      .warn {
        color: var(--theme-color-warning-text, var(--theme-color-std-text));
        border-left: 3px solid var(--theme-color-warning);
        padding-left: 0.5rem;
        margin-bottom: 0.6rem;
      }
    `
  ];

  @property({ attribute: false }) opening: AtelierOpening = {};
  @property({ attribute: false }) moduleView: OpeningViewSetting = { ...DEFAULT_OPENING_VIEW };
  @property({ attribute: false }) preview: PreviewAtelier | null = null;
  @property({ type: Boolean }) canEdit = false;

  @state() private own = false;
  @state() private view: OpeningViewSetting = { ...DEFAULT_OPENING_VIEW };
  @state() private front: FrontSide = 0;
  private seeded = false;

  protected override willUpdate(changed: PropertyValues): void {
    if (!this.seeded && (changed.has('opening') || changed.has('moduleView'))) {
      this.own = Boolean(this.opening.view);
      this.view = this.opening.view ? normalizeOpeningView(this.opening.view) : { ...this.moduleView };
      this.front = normalizeFront(this.opening.front);
      this.seeded = true;
    }
  }

  override render(): TemplateResult {
    const t = MSG.opening;
    const modeLabel = { plan: t.plan, tilted: t.tilted, 'tilted-ortho': t.tiltedOrtho }[this.moduleView.mode];
    const moduleDesc = `${localize(modeLabel)}${this.moduleView.mode === 'plan' ? '' : `, ${this.moduleView.tilt}°`}`;
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.close()}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(t.atelierTitle)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <p class="lead">${localizeDir(t.modeHint)} ${localizeDir(t.priority)}</p>
            ${this.canEdit ? nothing : html`<div class="warn">${localizeDir(t.readOnly)}</div>`}
            <div class="source" role="radiogroup">
              <label>
                <input type="radio" name="source" .checked=${!this.own} ?disabled=${!this.canEdit} @change=${() => this.useModule()} />
                ${localizeDir(t.useModule)} <em>(${moduleDesc})</em>
              </label>
              <label>
                <input type="radio" name="source" .checked=${this.own} ?disabled=${!this.canEdit} @change=${() => (this.own = true)} />
                ${localizeDir(t.own)}
              </label>
            </div>
            <mf-opening-editor
              .view=${this.view}
              .front=${this.front}
              .previews=${this.preview ? [this.preview] : []}
              showFront
              ?disabled=${!this.canEdit}
              @wui:change=${(e: CustomEvent<OpeningChange>) => this.onChange(e.detail)}
            ></mf-opening-editor>
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.close}>${localizeDir(t.cancel)}</ix-button>
            ${this.canEdit ? html`<ix-button @click=${this.apply}>${localizeDir(t.apply)}</ix-button>` : nothing}
          </div>
        </div>
      </div>
    `;
  }

  private useModule(): void {
    this.own = false;
    this.view = { ...this.moduleView };
  }

  /** A change of the view makes it this atelier's own; a change of the front side does not. */
  private onChange(change: OpeningChange): void {
    if (JSON.stringify(change.view) !== JSON.stringify(this.view)) this.own = true;
    this.view = change.view;
    this.front = change.front;
  }

  private apply(): void {
    const opening: AtelierOpening = {
      ...(this.front !== 0 ? { front: this.front } : {}),
      ...(this.own ? { view: this.view } : {})
    };
    this.dispatchEvent(new CustomEvent('wui:apply', { detail: { opening }, bubbles: true, composed: true }));
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}
