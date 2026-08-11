// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The side panel of a selected **area** — the middle step of the map → area → asset
 * drill-down.
 *
 * An area is a different object from an asset (a zone that groups, rather than a
 * thing that reads a datapoint), so it gets its own panel rather than a mode of the
 * asset inspector. What it shows is the roll-up an operator wants at that level: the
 * assets it contains, which of them are in alarm, and where the area itself drills
 * down to.
 *
 * Emits `wui:patch` (`{ area }`), `wui:delete`, `wui:open` (`{ route }`),
 * `wui:zoomarea` and `wui:close`.
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatValue, normDp, type LiveState } from '../data/live.js';
import { bareDp, isValidRoute } from '../drill.js';
import { MSG, assetKindLabel, localize, localizeDir } from '../i18n.js';
import { assetIcon } from '../map/glyphs.js';
import {
  AUTO_GROUP_ZOOM,
  clamp,
  type Area,
  type Asset,
  type Site
} from '../types.js';

import { MIN_RING } from '../map/style.js';
import { panelCore } from './panel-styles.js';

/** MapLibre's zoom ceiling — the highest a collapse threshold can be set to. */
const ZOOM_MAX = 22;

interface IxValueEvent {
  detail: string;
}

@customElement('gis-area-panel')
export class GisAreaPanel extends LitElement {
  static override readonly styles = [IXCoreStyles, areaPanelStyles()];

  /** The site the area belongs to — its assets are what the panel rolls up. */
  @property({ attribute: false }) site: Site | null = null;

  @property({ attribute: false }) area: Area | null = null;

  @property({ attribute: false }) live: LiveState = {
    values: new Map(),
    alarmColors: new Map()
  };

  /** Fields are editable only in edit mode (which already requires the grant). */
  @property({ type: Boolean }) editable = false;

  /** True while this area's outline is the one being reshaped on the map. */
  @property({ type: Boolean }) editingRing = false;

  override render(): TemplateResult {
    const area = this.area;
    if (!area)
      return html`<div class="none">${localizeDir(MSG.inspector.none)}</div>`;
    const assets = this.assetsOf(area);
    return html`
      <div class="head">
        <span class="badge" style=${`--badge: ${area.color}`}
          ><ix-icon name="map" size="16"></ix-icon
        ></span>
        <div class="titles">
          <div class="title">${area.name}</div>
          <div class="sub">${localizeDir(MSG.inspector.areaTitle)}</div>
        </div>
        <ix-icon-button
          ghost
          icon="close"
          @click=${() => this.emit('wui:close')}
        ></ix-icon-button>
      </div>
      <div class="body">
        ${this.editable ? this.renderFields(area) : nothing}
        ${this.renderOutline(area)} ${this.renderActions(area)}
        ${this.renderAssets(assets)}
        ${
          this.editable
            ? html`<ix-button
                variant="secondary"
                outline
                @click=${() => this.emit('wui:delete')}
              >
                <ix-icon name="trashcan" slot="icon"></ix-icon
                >${localizeDir(MSG.inspector.removeArea)}
              </ix-button>`
            : nothing
        }
      </div>
    `;
  }

  private renderFields(area: Area): TemplateResult {
    return html`
      <ix-input
        label=${localize(MSG.inspector.name)}
        .value=${area.name}
        @valueChange=${(event: IxValueEvent) => this.patch({ name: event.detail })}
      ></ix-input>
      <ix-input
        label=${localize(MSG.inspector.color)}
        .value=${area.color}
        @valueChange=${(event: IxValueEvent) => this.patch({ color: event.detail })}
      ></ix-input>
      <ix-input
        label=${localize(MSG.inspector.drillRoute)}
        .value=${area.link}
        @valueChange=${(event: IxValueEvent) => this.patch({ link: event.detail })}
      ></ix-input>
      <ix-number-input
        label=${localize(MSG.inspector.groupZoom)}
        helper-text=${localize(MSG.inspector.groupZoomHint)}
        min=${AUTO_GROUP_ZOOM}
        max=${ZOOM_MAX}
        .value=${area.groupZoom}
        @valueChange=${(event: { detail: number }) =>
          this.patch({
            groupZoom: clamp(
              Math.round(event.detail),
              AUTO_GROUP_ZOOM,
              ZOOM_MAX
            )
          })}
      ></ix-number-input>
    `;
  }

  /**
   * The outline controls. Reshaping is only offered in edit mode, and the wording splits
   * on whether there IS an outline: an area with none groups its assets without drawing
   * anything, and what it needs is to have one drawn, not reshaped.
   */
  private renderOutline(area: Area): TemplateResult | typeof nothing {
    const hasRing = area.ring.length >= MIN_RING;
    if (!this.editable) {
      return hasRing
        ? nothing
        : html`<div class="muted">${localizeDir(MSG.ring.noRing)}</div>`;
    }
    return html`
      <div class="actions">
        ${
          hasRing
            ? html`<ix-button
                  variant=${this.editingRing ? 'primary' : 'secondary'}
                  @click=${() => this.emit('wui:editring')}
                >
                  <ix-icon name="pen" slot="icon"></ix-icon
                  >${localizeDir(this.editingRing ? MSG.ring.done : MSG.ring.edit)}
                </ix-button>
                <span class="muted"
                  >${area.ring.length} ${localizeDir(MSG.ring.points)}</span
                >`
            : html`<ix-button
                variant="secondary"
                @click=${() => this.emit('wui:drawring')}
              >
                <ix-icon name="map" slot="icon"></ix-icon
                >${localizeDir(MSG.ring.draw)}
              </ix-button>`
        }
      </div>
    `;
  }

  private renderActions(area: Area): TemplateResult {
    return html`
      <div class="actions">
        <ix-button
          variant="secondary"
          @click=${() => this.emit('wui:zoomarea')}
        >
          <ix-icon name="zoom-in" slot="icon"></ix-icon
          >${localizeDir(MSG.inspector.zoomToArea)}
        </ix-button>
        ${
          area.link && isValidRoute(area.link)
            ? html`<ix-button
                @click=${() => this.emit('wui:open', { route: area.link })}
              >
                <ix-icon name="open-external" slot="icon"></ix-icon
                >${localizeDir(MSG.inspector.openTarget)}
              </ix-button>`
            : nothing
        }
      </div>
    `;
  }

  /**
   * The area's assets, one card each, with what they currently read.
   *
   * This is the reason to select an area: the map shows *where* its equipment is, and this
   * column shows *what it says* — without having to click every marker in turn. Cards
   * rather than a list of names because a name alone answers nothing an operator asked.
   */
  private renderAssets(assets: readonly Asset[]): TemplateResult {
    return html`
      <div class="section">
        <span class="section-title"
          >${localizeDir(MSG.inspector.areaAssets)}</span
        >
        <span class="muted">${assets.length}</span>
      </div>
      ${
        assets.length === 0
          ? html`<div class="muted">${localizeDir(MSG.area.noAssets)}</div>`
          : html`<div class="cards">
              ${assets.map((asset) => this.renderAssetCard(asset))}
            </div>`
      }
    `;
  }

  /** One asset: its glyph, its name, its kind, and every value it is bound to. */
  private renderAssetCard(asset: Asset): TemplateResult {
    const alarmColor = this.alarmColor(asset);
    return html`
      <button
        class="card ${alarmColor ? 'in-alarm' : ''}"
        type="button"
        style=${`--card-alarm: ${alarmColor || 'transparent'}`}
        title=${localize(MSG.area.openAsset)}
        @click=${() => this.emit('wui:select', { kind: 'asset', id: asset.id })}
      >
        <span class="card-head">
          <span class="card-badge"
            ><ix-icon name=${assetIcon(asset.kind)} size="12"></ix-icon
          ></span>
          <span class="card-titles">
            <span class="card-name">${asset.name}</span>
            <span class="card-kind">${assetKindLabel(asset.kind)}</span>
          </span>
          ${
            alarmColor
              ? html`<ix-icon
                  class="card-alarm"
                  name="alarm-bell"
                  size="12"
                ></ix-icon>`
              : nothing
          }
        </span>
        ${
          asset.readings.length === 0
            ? html`<span class="muted card-empty"
                >${localizeDir(MSG.inspector.noReadings)}</span
              >`
            : html`<dl class="readings">
                ${asset.readings.map(
                  (reading) => html`
                    <dt>
                      ${reading.label || reading.dp || localizeDir(MSG.inspector.unbound)}
                    </dt>
                    <dd>
                      ${formatValue(this.live.values.get(normDp(reading.dp)), reading.decimals)}
                      ${reading.unit ? html`<span class="unit">${reading.unit}</span>` : nothing}
                    </dd>
                  `
                )}
              </dl>`
        }
      </button>
    `;
  }

  private assetsOf(area: Area): Asset[] {
    return (this.site?.assets ?? []).filter(
      (asset) => asset.areaId === area.id
    );
  }

  /** The asset's active alert colour, `''` when it is not in alarm. */
  private alarmColor(asset: Asset): string {
    const dp = asset.dp.trim();
    if (!dp) return '';
    return this.live.alarmColors.get(normDp(bareDp(dp))) ?? '';
  }

  private patch(part: Partial<Area>): void {
    if (this.area) this.emit('wui:patch', { area: { ...this.area, ...part } });
  }

  private emit(type: string, detail: unknown = {}): void {
    const init = { detail, bubbles: true, composed: true };
    // eslint-disable-next-line no-restricted-syntax -- `type` is a fixed internal `wui:*` event name; the rule only validates string literals.
    this.dispatchEvent(new CustomEvent(type, init));
  }
}

function areaPanelStyles(): ReturnType<typeof css> {
  return css`
    ${panelCore()}
    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    /* --- asset cards -------------------------------------------------------- */
    .cards {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
    }
    /* A button, because the whole card opens the asset — so it is focusable and
       keyboard-operable without any extra affordance. */
    .card {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      width: 100%;
      padding: 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-left: 3px solid var(--card-alarm, transparent);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      color: var(--theme-color-std-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .card:hover {
      border-color: var(--theme-color-primary);
      background: var(--theme-color-3);
    }
    .card:focus-visible {
      outline: 2px solid
        var(--theme-color-focus-bdr, var(--theme-color-primary));
      outline-offset: 1px;
    }
    /* In alarm: the left edge takes the colour WinCC OA computed for the alert state. */
    .card.in-alarm {
      border-left-color: var(--card-alarm);
      background: color-mix(
        in srgb,
        var(--card-alarm) 10%,
        var(--theme-color-2)
      );
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      min-width: 0;
    }
    .card-badge {
      display: grid;
      place-items: center;
      width: 1.25rem;
      height: 1.25rem;
      flex: none;
      border-radius: 50%;
      background: var(--theme-color-primary);
      color: var(--theme-color-inv-text, #fff);
    }
    .card.in-alarm .card-badge {
      background: var(--card-alarm);
    }
    .card-titles {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
    }
    .card-name {
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .card-kind {
      color: var(--theme-color-soft-text);
      font-size: 0.6875rem;
    }
    .card-alarm {
      flex: none;
      color: var(--card-alarm);
    }
    .card-empty {
      font-size: 0.75rem;
    }
  `;
}
