// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The **layer browser**: every information layer of the site, what it is used by, and
 * whether it is currently shown.
 *
 * Two things are deliberately separate here:
 *
 * - **Visibility is a session thing.** The eye toggles what *this* operator is looking at
 *   and is never written to the datapoint — which is why a viewer without the `edit` grant
 *   can use it freely. See {@link Layer}.
 * - **The layers themselves are site data**, so creating, renaming, recolouring and deleting
 *   them needs edit mode, exactly like a zone.
 *
 * A layer can also be created straight from an asset (the inspector's tag field), so this
 * panel is the place to *manage* layers rather than the only place to make one — asking an
 * operator to come here first, before they can tag anything, would be the wrong order.
 *
 * Emits `wui:toggle` `{ id }`, `wui:patch` `{ layer }`, `wui:create`, `wui:delete` `{ id }`,
 * `wui:isolate` `{ id }` (show only this one) , `wui:showall` and `wui:close`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { MSG, layerUsageMsg, localize, localizeDir } from '../i18n.js';
import { layerUsage, type Layer, type Site } from '../types.js';
import { panelCore } from './panel-styles.js';

type IxValueEvent = CustomEvent<string>;

@customElement('gis-layer-panel')
export class GisLayerPanel extends LitElement {
  static override readonly styles = [IXCoreStyles, layerPanelStyles()];

  @property({ attribute: false }) site: Site | null = null;
  /** Ids currently switched OFF — held by the page, not by the site. */
  @property({ attribute: false }) hiddenLayers: ReadonlySet<string> = new Set();
  @property({ type: Boolean }) editable = false;

  override render(): TemplateResult {
    const layers = this.site?.layers ?? [];
    return html`
      <div class="head">
        <span class="badge"><ix-icon name="layers" size="16"></ix-icon></span>
        <div class="titles">
          <div class="title">${localizeDir(MSG.layer.title)}</div>
          <div class="sub">${layerUsageMsg(layers.length)}</div>
        </div>
        <ix-icon-button
          ghost
          icon="close"
          @click=${() => this.emit('wui:close')}
        ></ix-icon-button>
      </div>
      <div class="body">
        ${
          layers.length === 0
            ? html`<div class="none">${localizeDir(MSG.layer.empty)}</div>`
            : html`<div class="layers">
                ${layers.map((layer) => this.renderLayer(layer))}
              </div>`
        }
        ${
          this.hiddenLayers.size > 0
            ? html`<ix-button
                variant="secondary"
                ghost
                @click=${() => this.emit('wui:showall')}
              >
                <ix-icon name="eye" slot="icon"></ix-icon
                >${localizeDir(MSG.layer.showAll)}
              </ix-button>`
            : nothing
        }
        ${
          this.editable
            ? html`<ix-button
                variant="secondary"
                @click=${() => this.emit('wui:create')}
              >
                <ix-icon name="plus" slot="icon"></ix-icon
                >${localizeDir(MSG.layer.create)}
              </ix-button>`
            : nothing
        }
      </div>
    `;
  }

  private renderLayer(layer: Layer): TemplateResult {
    const site = this.site;
    const off = this.hiddenLayers.has(layer.id);
    const used = site ? layerUsage(site, layer.id) : 0;
    return html`
      <div class="layer ${off ? 'off' : ''}">
        <ix-icon-button
          ghost
          icon=${off ? 'eye-cancelled' : 'eye'}
          title=${localize(off ? MSG.layer.show : MSG.layer.hide)}
          @click=${() => this.emit('wui:toggle', { id: layer.id })}
        ></ix-icon-button>
        <span class="dot" style="--chip: ${layer.color}"></span>
        ${
          this.editable
            ? html`<ix-input
                class="grow"
                .value=${layer.name}
                @valueChange=${(event: IxValueEvent) => this.emit('wui:patch', { layer: { ...layer, name: event.detail } })}
              ></ix-input>`
            : html`<span class="grow name">${layer.name}</span>`
        }
        <span class="count">${used}</span>
        <ix-icon-button
          ghost
          icon="filter"
          title=${localize(MSG.layer.isolate)}
          @click=${() => this.emit('wui:isolate', { id: layer.id })}
        ></ix-icon-button>
        ${
          this.editable
            ? html`<ix-icon-button
                ghost
                icon="trashcan"
                title=${localize(MSG.layer.remove)}
                @click=${() => this.emit('wui:delete', { id: layer.id })}
              ></ix-icon-button>`
            : nothing
        }
      </div>
    `;
  }

  private emit(name: string, detail?: unknown): void {
    const init = { detail, bubbles: true, composed: true };
    // eslint-disable-next-line no-restricted-syntax -- `name` is a fixed internal `wui:*` event name; the rule only validates string literals.
    this.dispatchEvent(new CustomEvent(name, init));
  }
}

function layerPanelStyles(): ReturnType<typeof css> {
  return css`
    ${panelCore()}
    .layers {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .layer {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    /* A hidden layer stays legible but visibly inactive — it is a state, not a disabled row. */
    .layer.off .name,
    .layer.off .count {
      color: var(--theme-color-soft-text);
      text-decoration: line-through;
    }
    .layer.off .dot {
      opacity: 0.35;
    }
    .dot {
      flex: 0 0 auto;
      width: 0.625rem;
      height: 0.625rem;
      border-radius: 50%;
      background: var(--chip);
    }
    .grow {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .count {
      flex: 0 0 auto;
      min-width: 1.5rem;
      color: var(--theme-color-soft-text);
      font-size: 0.75rem;
      font-variant-numeric: tabular-nums;
      text-align: right;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'gis-layer-panel': GisLayerPanel;
  }
}
