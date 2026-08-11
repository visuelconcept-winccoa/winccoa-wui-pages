// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Modal dialog for a site's own settings: its name, description and category, where
 * its map opens, and — the part that decides whether the page works at all on a
 * given system — which basemap it draws.
 *
 * The basemap choice is deliberately prominent. The default public OpenStreetMap
 * tiles cost nothing but are rate-limited by the OSMF usage policy, and plenty of
 * industrial networks cannot reach them at all; a deployment is expected to point at
 * its own tile server, or to switch the basemap off and keep just the overlays. The
 * dialog says so instead of leaving it to be discovered in production.
 *
 * Emits `wui:save` with the updated {@link Site} and `wui:cancel` on dismiss.
 */
import { dialogCore } from '@visuelconcept/wui-kit/ui/dialog-styles.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import {
  LitElement,
  css,
  html,
  nothing,
  type PropertyValues,
  type TemplateResult
} from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { BASEMAP_LABELS, MSG, localize, localizeDir } from '../i18n.js';
import {
  AUTO_GROUP_ZOOM,
  BASEMAP_KINDS,
  OSM_MAX_ZOOM,
  blankSite,
  clamp,
  isValidLatLon,
  type Basemap,
  type BasemapKind,
  type Site
} from '../types.js';

interface IxValueEvent {
  detail: string;
}

/** `ix-select` reports `string | string[]`; a single-select still needs one value. */
function selectedValue(detail: string | string[]): string {
  return Array.isArray(detail) ? (detail[0] ?? '') : detail;
}

/** MapLibre's own zoom range. */
const ZOOM_MIN = 0;
const ZOOM_MAX = 22;
/** A raster source below this is pointless; above it, no public service serves. */
const TILE_ZOOM_MIN = 1;
const TILE_ZOOM_MAX = 24;

@customElement('gis-site-dialog')
export class GisSiteDialog extends LitElement {
  static override readonly styles = [IXCoreStyles, dialogStyles()];

  /** Site to edit; `null` creates a new one. */
  @property({ attribute: false }) site: Site | null = null;

  @state() private working: Site = blankSite();

  override render(): TemplateResult {
    const isNew = !this.site;
    const error = this.validate();
    return html`
      <div class="overlay" @click=${this.cancel}>
        <div class="panel" @click=${(event: Event) => event.stopPropagation()}>
          <div class="panel-head">
            <ix-typography format="h3">
              ${localizeDir(isNew ? MSG.site.createTitle : MSG.site.editTitle)}
            </ix-typography>
            <ix-icon-button
              ghost
              icon="close"
              @click=${this.cancel}
            ></ix-icon-button>
          </div>
          <div class="panel-body">
            ${this.renderIdentity()} ${this.renderView()}
            ${this.renderBasemap()}
            ${error ? html`<div class="error"><ix-icon name="warning" size="16"></ix-icon>${error}</div>` : nothing}
          </div>
          <div class="panel-foot">
            <ix-button variant="secondary" @click=${this.cancel}
              >${localizeDir(MSG.site.cancel)}</ix-button
            >
            <ix-button ?disabled=${error !== ''} @click=${this.save}>
              <ix-icon name="check" slot="icon"></ix-icon
              >${localizeDir(MSG.site.save)}
            </ix-button>
          </div>
        </div>
      </div>
    `;
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('site')) {
      this.working = this.site ? structuredClone(this.site) : blankSite();
    }
  }

  private renderIdentity(): TemplateResult {
    return html`
      <ix-input
        label=${localize(MSG.site.name)}
        .value=${this.working.name}
        @valueChange=${(event: IxValueEvent) => this.patch({ name: event.detail })}
      ></ix-input>
      <ix-input
        label=${localize(MSG.site.description)}
        .value=${this.working.description}
        @valueChange=${(event: IxValueEvent) => this.patch({ description: event.detail })}
      ></ix-input>
      <ix-input
        label=${localize(MSG.site.category)}
        helper-text=${localize(MSG.site.categoryHint)}
        .value=${this.working.category ?? ''}
        @valueChange=${(event: IxValueEvent) => this.patch({ category: event.detail })}
      ></ix-input>
    `;
  }

  private renderView(): TemplateResult {
    return html`
      <div class="group-title">${localizeDir(MSG.site.center)}</div>
      <div class="row three">
        <ix-number-input
          label=${localize(MSG.inspector.latitude)}
          .value=${this.working.center.lat}
          @valueChange=${(event: { detail: number }) => this.patchCenter({ lat: event.detail })}
        ></ix-number-input>
        <ix-number-input
          label=${localize(MSG.inspector.longitude)}
          .value=${this.working.center.lon}
          @valueChange=${(event: { detail: number }) => this.patchCenter({ lon: event.detail })}
        ></ix-number-input>
        <ix-number-input
          label=${localize(MSG.site.zoom)}
          min=${ZOOM_MIN}
          max=${ZOOM_MAX}
          .value=${this.working.zoom}
          @valueChange=${(event: { detail: number }) => this.patch({ zoom: clamp(event.detail, ZOOM_MIN, ZOOM_MAX) })}
        ></ix-number-input>
      </div>
      <ix-number-input
        label=${localize(MSG.site.groupZoom)}
        helper-text=${localize(MSG.site.groupZoomHint)}
        min=${AUTO_GROUP_ZOOM}
        max=${ZOOM_MAX}
        .value=${this.working.groupZoom}
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

  private renderBasemap(): TemplateResult {
    const basemap = this.working.basemap;
    return html`
      <div class="group-title">${localizeDir(MSG.site.basemap)}</div>
      <ix-select
        .value=${basemap.kind}
        @valueChange=${(event: { detail: string | string[] }) => this.patchKind(selectedValue(event.detail) as BasemapKind)}
      >
        ${BASEMAP_KINDS.map(
          (kind) =>
            html`<ix-select-item
              value=${kind}
              label=${localize(BASEMAP_LABELS[kind])}
            ></ix-select-item>`
        )}
      </ix-select>
      ${basemap.kind === 'osm' ? html`<div class="note">${localizeDir(MSG.site.osmPolicy)}</div>` : nothing}
      ${
        basemap.kind === 'raster'
          ? html`<ix-input
              label=${localize(MSG.site.tileUrl)}
              helper-text=${localize(MSG.site.tileUrlHint)}
              .value=${basemap.url}
              @valueChange=${(event: IxValueEvent) => this.patchBasemap({ url: event.detail })}
            ></ix-input>`
          : nothing
      }
      ${
        basemap.kind === 'style'
          ? html`<ix-input
              label=${localize(MSG.site.styleUrl)}
              .value=${basemap.styleUrl}
              @valueChange=${(event: IxValueEvent) => this.patchBasemap({ styleUrl: event.detail })}
            ></ix-input>`
          : nothing
      }
      ${
        basemap.kind === 'none'
          ? nothing
          : html`<div class="row two">
              <ix-input
                label=${localize(MSG.site.attribution)}
                helper-text=${localize(MSG.site.attributionHint)}
                .value=${basemap.attribution}
                @valueChange=${(event: IxValueEvent) => this.patchBasemap({ attribution: event.detail })}
              ></ix-input>
              <ix-number-input
                label=${localize(MSG.site.maxZoom)}
                min=${TILE_ZOOM_MIN}
                max=${TILE_ZOOM_MAX}
                .value=${basemap.maxZoom}
                @valueChange=${(event: { detail: number }) =>
                  this.patchBasemap({
                    maxZoom: clamp(event.detail, TILE_ZOOM_MIN, TILE_ZOOM_MAX)
                  })}
              ></ix-number-input>
            </div>`
      }
    `;
  }

  /** The first thing wrong with the form, `''` when it is saveable. */
  private validate(): string {
    if (this.working.name.trim() === '') return localize(MSG.site.nameRequired);
    if (!isValidLatLon(this.working.center.lat, this.working.center.lon))
      return localize(MSG.site.centerInvalid);
    const { kind, url, styleUrl } = this.working.basemap;
    if (kind === 'raster' && url.trim() === '')
      return localize(MSG.site.urlRequired);
    if (kind === 'style' && styleUrl.trim() === '')
      return localize(MSG.site.urlRequired);
    return '';
  }

  private patch(part: Partial<Site>): void {
    this.working = { ...this.working, ...part };
  }

  private patchCenter(part: Partial<Site['center']>): void {
    this.working = {
      ...this.working,
      center: { ...this.working.center, ...part }
    };
  }

  private patchBasemap(part: Partial<Basemap>): void {
    this.working = {
      ...this.working,
      basemap: { ...this.working.basemap, ...part }
    };
  }

  /**
   * Switching kind carries the attribution over — a site that moves from the public
   * OSM tiles to a self-hosted mirror of them still owes the same credit — but
   * seeds the OSM ceiling when arriving from a kind that had no meaningful one.
   */
  private patchKind(kind: BasemapKind): void {
    const current = this.working.basemap;
    this.patchBasemap({
      kind,
      maxZoom: current.maxZoom > 0 ? current.maxZoom : OSM_MAX_ZOOM
    });
  }

  private save(): void {
    if (this.validate() !== '') return;
    this.dispatchEvent(
      new CustomEvent('wui:save', {
        detail: this.working,
        bubbles: true,
        composed: true
      })
    );
  }

  private cancel(): void {
    this.dispatchEvent(
      new CustomEvent('wui:cancel', { bubbles: true, composed: true })
    );
  }
}

function dialogStyles(): ReturnType<typeof css> {
  return css`
    ${dialogCore()}
    .panel {
      width: 560px;
    }
    .group-title {
      margin-top: 0.25rem;
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .row {
      display: grid;
      gap: 0.75rem;
    }
    .row.two {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    }
    .row.three {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .note {
      padding: 0.5rem 0.625rem;
      border-radius: var(--theme-default-border-radius);
      border: 1px solid var(--theme-color-information);
      color: var(--theme-color-information);
      background: color-mix(
        in srgb,
        var(--theme-color-information) 12%,
        transparent
      );
      font-size: 0.8125rem;
    }
    .error {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--theme-color-alarm);
      font-size: 0.8125rem;
    }
    @media (max-width: 620px) {
      .row.two,
      .row.three {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;
}
