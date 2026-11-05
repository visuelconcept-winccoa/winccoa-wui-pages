// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Module settings — every atelier (#70), opened from the overview: the default opening view of
 * every atelier that has no setting of its own, tried live on the site's ateliers and on example
 * layouts. Read-only without the role `machine-fleet-3d/configure`. Emits `wui:apply` with
 * `{ settings }` (the page saves them in `MachineFleet3D_Settings`) and `wui:close`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { overlayClicked, overlayDown } from '@visuelconcept-winccoa/wui-fleet-core/ui/overlay-dismiss.js';
import { DEFAULT_OPENING_VIEW, type FleetModuleSettings, type OpeningViewSetting } from '@visuelconcept-winccoa/wui-fleet-core/opening-view.js';
import type { Atelier } from '../types.js';
import { EXAMPLE_ATELIERS, previewOf, type PreviewAtelier } from '../scene/opening-preview.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import { dialogStyles } from './dialog-styles.js';
import './mf-opening-editor.js';
import type { OpeningChange } from './mf-opening-editor.js';

/** The site's ateliers shown as previews, at most. */
const MAX_SITE_PREVIEWS = 4;

@customElement('mf-module-settings-dialog')
export class MfModuleSettingsDialog extends LitElement {
  static override readonly styles = [
    IXCoreStyles,
    dialogStyles(),
    css`
      .panel {
        width: 960px;
      }
      .lead {
        color: var(--theme-color-soft-text);
        margin: 0 0 0.8rem;
        line-height: 1.4;
      }
      .warn {
        color: var(--theme-color-warning-text, var(--theme-color-std-text));
        border-left: 3px solid var(--theme-color-warning);
        padding-left: 0.5rem;
        margin-bottom: 0.6rem;
      }
    `
  ];

  @property({ attribute: false }) settings: FleetModuleSettings = { openingView: { ...DEFAULT_OPENING_VIEW } };
  @property({ attribute: false }) ateliers: Atelier[] = [];
  @property({ type: Boolean }) canConfigure = false;
  /** The last save failed (shown above the buttons). */
  @property({ type: Boolean }) error = false;

  @state() private view: OpeningViewSetting = { ...DEFAULT_OPENING_VIEW };
  @state() private previews: PreviewAtelier[] = [];
  private seeded = false;

  protected override willUpdate(changed: PropertyValues): void {
    if (!this.seeded && changed.has('settings')) {
      this.view = { ...this.settings.openingView };
      this.seeded = true;
    }
    if (changed.has('ateliers')) {
      const t = MSG.opening;
      const examples = [t.sampleCluster, t.sampleLine, t.sampleFull];
      this.previews = [
        ...this.ateliers.slice(0, MAX_SITE_PREVIEWS).map((a) => ({ ...previewOf(a), note: `${a.machines.length} ${localize(t.symbols)}` })),
        ...EXAMPLE_ATELIERS.map((e, i) => ({ ...e, name: localize(examples[i]), note: `${e.symbols.length} ${localize(t.symbols)} · ${e.length} × ${e.width} m` }))
      ];
    }
  }

  override render(): TemplateResult {
    const t = MSG.opening;
    return html`
      <div class="overlay" @pointerdown=${overlayDown} @click=${(e: Event) => overlayClicked(e) && this.close()}>
        <div class="panel" @click=${(e: Event) => e.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">${localizeDir(t.moduleTitle)}</ix-typography>
            <ix-icon-button ghost icon="close" @click=${this.close}></ix-icon-button>
          </div>
          <div class="panel-body">
            <div class="subhead">${localizeDir(t.moduleDefault)}</div>
            <p class="lead">${localizeDir(t.moduleHint)} ${localizeDir(t.modeHint)}</p>
            ${this.canConfigure ? nothing : html`<div class="warn">${localizeDir(t.readOnly)}</div>`}
            <mf-opening-editor
              .view=${this.view}
              .previews=${this.previews}
              ?disabled=${!this.canConfigure}
              @wui:change=${(e: CustomEvent<OpeningChange>) => (this.view = e.detail.view)}
            ></mf-opening-editor>
          </div>
          <div class="panel-foot">
            ${this.error ? html`<span class="warn">${localizeDir(t.saveFailed)}</span>` : nothing}
            <ix-button variant="secondary" @click=${this.close}>${localizeDir(t.cancel)}</ix-button>
            ${this.canConfigure ? html`<ix-button @click=${this.apply}>${localizeDir(t.apply)}</ix-button>` : nothing}
          </div>
        </div>
      </div>
    `;
  }

  private apply(): void {
    const settings: FleetModuleSettings = { ...this.settings, openingView: this.view };
    this.dispatchEvent(new CustomEvent('wui:apply', { detail: { settings }, bubbles: true, composed: true }));
  }

  private close(): void {
    this.dispatchEvent(new CustomEvent('wui:close', { bubbles: true, composed: true }));
  }
}
