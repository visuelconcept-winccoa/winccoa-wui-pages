// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The side panel of a selected **asset**: what it is, what it currently reads, and
 * where the map drills down to from it. An area gets its own `<gis-area-panel>`.
 *
 * One component serves both roles an asset needs — reading and authoring — because
 * they describe the same object and splitting them would duplicate every field.
 * Outside edit mode it is a read-only status card; with the Application-Security
 * `edit` grant and edit mode on, the same fields become inputs.
 *
 * The datapoint fields use the shared `<wui-dp-input>` from `@visuelconcept/wui-kit`,
 * so binding an asset autocompletes against the project's real datapoint names
 * instead of asking an operator to type them exactly.
 *
 * Emits `wui:patch` (`{ asset }`), `wui:delete`, `wui:open` (`{ route }`) and
 * `wui:close`.
 */
import '@visuelconcept/wui-kit/ui/wui-dp-input.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { formatValue, normDp, type LiveState } from '../data/live.js';
import {
  DRILL_PRESETS,
  alarmsRoute,
  isValidRoute,
  presetOf
} from '../drill.js';
import {
  ASSET_KIND_LABELS,
  MSG,
  assetKindLabel,
  localize,
  localizeDir
} from '../i18n.js';
import { assetIcon } from '../map/glyphs.js';
import {
  ASSET_KINDS,
  blankReading,
  clamp,
  type Asset,
  type AssetKind,
  primaryArea,
  type Reading,
  type Site
} from '../types.js';
import { panelCore } from './panel-styles.js';

interface IxValueEvent {
  detail: string;
}

/** `<wui-dp-input>` reports the chosen datapoint name wrapped in a `{ value }`. */
interface DpChangeEvent {
  detail: { value: string };
}

/** `ix-select` reports `string | string[]`; a single-select still needs one value. */
function selectedValue(detail: string | string[]): string {
  return Array.isArray(detail) ? (detail[0] ?? '') : detail;
}

/**
 * The same event, read as the list a multi-select means. Empty strings are dropped: an
 * asset in no area has an EMPTY list, never a list holding `''`.
 */
function asList(detail: string | string[]): string[] {
  const values = Array.isArray(detail) ? detail : [detail];
  return values.filter((value) => value !== '');
}

const DECIMALS_MIN = 0;
const DECIMALS_MAX = 6;
/** Base-36 keeps a clock-derived reading id short. */
const ID_RADIX = 36;

@customElement('gis-inspector')
export class GisInspector extends LitElement {
  static override readonly styles = [IXCoreStyles, inspectorStyles()];

  /** The site the selection belongs to (needed for the area list). */
  @property({ attribute: false }) site: Site | null = null;

  /** The selected asset; `null` shows the "select something" placeholder. */
  @property({ attribute: false }) asset: Asset | null = null;

  @property({ attribute: false }) live: LiveState = {
    values: new Map(),
    alarmColors: new Map()
  };

  /** Fields are editable only in edit mode (which already requires the grant). */
  @property({ type: Boolean }) editable = false;

  /** Which drill-down preset the route field is being edited against. */
  @state() private presetId = '';

  override render(): TemplateResult {
    if (this.asset) return this.renderAsset(this.asset);
    return html`<div class="none">${localizeDir(MSG.inspector.none)}</div>`;
  }

  // --- asset -----------------------------------------------------------------

  private renderAsset(asset: Asset): TemplateResult {
    const alarmColor =
      this.live.alarmColors.get(normDp(primaryDp(asset))) ?? '';
    return html`
      <div class="head">
        <span
          class="badge"
          style=${badgeStyle(alarmColor || 'var(--theme-color-primary)')}
        >
          <ix-icon name=${assetIcon(asset.kind)} size="16"></ix-icon>
        </span>
        <div class="titles">
          <div class="title">
            ${asset.name || localizeDir(MSG.inspector.title)}
          </div>
          <div class="sub">${assetKindLabel(asset.kind)}</div>
        </div>
        <ix-icon-button
          ghost
          icon="close"
          @click=${this.close}
        ></ix-icon-button>
      </div>
      ${
        alarmColor
          ? html`<div class="alarm-banner" style=${badgeStyle(alarmColor)}>
              <ix-icon name="alarm-bell" size="16"></ix-icon
              >${localizeDir(MSG.inspector.inAlarm)}
            </div>`
          : nothing
      }
      <div class="body">
        ${this.editable ? html`${this.renderIdentityFields(asset)}${this.renderPlacementFields(asset)}` : nothing}
        ${this.renderReadings(asset)}
        ${this.editable ? this.renderReadingEditor(asset) : nothing}
        ${this.renderDrill(asset)}
        ${asset.notes && !this.editable ? html`<div class="notes">${asset.notes}</div>` : nothing}
        ${
          this.editable
            ? html`<ix-button
                variant="secondary"
                outline
                @click=${() => this.emit('wui:delete')}
              >
                <ix-icon name="trashcan" slot="icon"></ix-icon
                >${localizeDir(MSG.inspector.remove)}
              </ix-button>`
            : nothing
        }
      </div>
    `;
  }

  /** What the asset *is*: its name, its kind, and the area it belongs to. */
  private renderIdentityFields(asset: Asset): TemplateResult {
    return html`
      <ix-input
        label=${localize(MSG.inspector.name)}
        .value=${asset.name}
        @valueChange=${(event: IxValueEvent) => this.patchAsset({ name: event.detail })}
      ></ix-input>
      <div class="row two">
        <ix-select
          label=${localize(MSG.inspector.kind)}
          .value=${asset.kind}
          @valueChange=${(event: { detail: string | string[] }) =>
            this.patchAsset({ kind: selectedValue(event.detail) as AssetKind })}
        >
          ${ASSET_KINDS.map(
            (kind) =>
              html`<ix-select-item
                value=${kind}
                label=${localize(ASSET_KIND_LABELS[kind])}
              ></ix-select-item>`
          )}
        </ix-select>
        <ix-select
          label=${localize(MSG.inspector.areas)}
          mode="multiple"
          helper-text=${localize(MSG.inspector.areasHint)}
          .value=${[...asset.areaIds]}
          @valueChange=${(event: { detail: string | string[] }) => this.patchAsset({ areaIds: asList(event.detail) })}
        >
          ${(this.site?.areas ?? []).map((area) => html`<ix-select-item value=${area.id} label=${area.name}></ix-select-item>`)}
        </ix-select>
      </div>
      ${
        asset.areaIds.length > 1
          ? html`<div class="hint">
              ${localizeDir(MSG.inspector.primaryAreaHint)}
              <strong>${this.areaName(primaryArea(asset))}</strong>
            </div>`
          : nothing
      }
    `;
  }

  /**
   * Where the asset is and what it is bound to. Coordinates stay editable as numbers
   * even though dragging the marker is the usual gesture — a surveyed position is
   * often supplied as figures, and typing them beats nudging a marker into place.
   */
  private renderPlacementFields(asset: Asset): TemplateResult {
    return html`
      <div class="row two">
        <ix-number-input
          label=${localize(MSG.inspector.latitude)}
          .value=${asset.lat}
          @valueChange=${(event: { detail: number }) => this.patchAsset({ lat: event.detail })}
        ></ix-number-input>
        <ix-number-input
          label=${localize(MSG.inspector.longitude)}
          .value=${asset.lon}
          @valueChange=${(event: { detail: number }) => this.patchAsset({ lon: event.detail })}
        ></ix-number-input>
      </div>
      <wui-dp-input
        label=${localize(MSG.inspector.primaryDp)}
        .value=${asset.dp}
        @wui:change=${(event: DpChangeEvent) => this.patchAsset({ dp: event.detail.value })}
      ></wui-dp-input>
      <div class="hint">${localizeDir(MSG.inspector.primaryDpHint)}</div>
      <ix-input
        label=${localize(MSG.inspector.notes)}
        .value=${asset.notes}
        @valueChange=${(event: IxValueEvent) => this.patchAsset({ notes: event.detail })}
      ></ix-input>
    `;
  }

  /** The live values, as read. Shown in both modes — it is why the panel is open. */
  private renderReadings(asset: Asset): TemplateResult {
    return html`
      <div class="section">
        <span class="section-title"
          >${localizeDir(MSG.inspector.readings)}</span
        >
        ${
          !this.editable && asset.dp
            ? html`<span class="dp mono">${asset.dp}</span>`
            : nothing
        }
      </div>
      ${
        asset.readings.length === 0
          ? html`<div class="muted">
              ${localizeDir(MSG.inspector.noReadings)}
            </div>`
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
    `;
  }

  private renderReadingEditor(asset: Asset): TemplateResult {
    return html`
      <div class="readings-edit">
        ${asset.readings.map((reading, index) => this.renderReadingRow(asset, reading, index))}
      </div>
      <ix-button
        variant="secondary"
        outline
        @click=${() => this.addReading(asset)}
      >
        <ix-icon name="plus" slot="icon"></ix-icon
        >${localizeDir(MSG.inspector.addReading)}
      </ix-button>
    `;
  }

  private renderReadingRow(
    asset: Asset,
    reading: Reading,
    index: number
  ): TemplateResult {
    return html`
      <div class="reading-row">
        <wui-dp-input
          .value=${reading.dp}
          @wui:change=${(event: DpChangeEvent) => this.patchReading(asset, index, { dp: event.detail.value })}
        ></wui-dp-input>
        <div class="row four">
          <ix-input
            label=${localize(MSG.inspector.readingLabel)}
            .value=${reading.label}
            @valueChange=${(event: IxValueEvent) => this.patchReading(asset, index, { label: event.detail })}
          ></ix-input>
          <ix-input
            label=${localize(MSG.inspector.readingUnit)}
            .value=${reading.unit}
            @valueChange=${(event: IxValueEvent) => this.patchReading(asset, index, { unit: event.detail })}
          ></ix-input>
          <ix-number-input
            label=${localize(MSG.inspector.readingDecimals)}
            min=${DECIMALS_MIN}
            max=${DECIMALS_MAX}
            .value=${reading.decimals}
            @valueChange=${(event: { detail: number }) =>
              this.patchReading(asset, index, {
                decimals: clamp(event.detail, DECIMALS_MIN, DECIMALS_MAX)
              })}
          ></ix-number-input>
          <div class="on-map">
            <ix-checkbox
              ?checked=${reading.onMap}
              @checkedChange=${(event: { detail: boolean }) => this.patchReading(asset, index, { onMap: event.detail })}
            >
              ${localizeDir(MSG.inspector.readingOnMap)}
            </ix-checkbox>
            <ix-icon-button
              ghost
              icon="trashcan"
              size="16"
              @click=${() => this.removeReading(asset, index)}
            ></ix-icon-button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * The drill-down. Read-only, it is two buttons; in edit mode, a preset picker over
   * the route field — the preset only *seeds* the route, which stays free text so an
   * unforeseen target is never blocked.
   */
  private renderDrill(asset: Asset): TemplateResult {
    const routeValid = asset.link === '' || isValidRoute(asset.link);
    return html`
      <div class="section">
        <span class="section-title">${localizeDir(MSG.inspector.drill)}</span>
      </div>
      ${this.editable ? this.renderDrillEditor(asset, routeValid) : nothing}
      <div class="drill-actions">
        ${
          asset.link && routeValid
            ? html`<ix-button
                @click=${() => this.emit('wui:open', { route: asset.link })}
              >
                <ix-icon name="open-external" slot="icon"></ix-icon
                >${localizeDir(MSG.inspector.openTarget)}
              </ix-button>`
            : nothing
        }
        ${
          asset.dp
            ? html`<ix-button
                variant="secondary"
                @click=${() => this.emit('wui:open', { route: alarmsRoute(asset.dp) })}
              >
                <ix-icon name="alarm-bell" slot="icon"></ix-icon
                >${localizeDir(MSG.inspector.openAlarms)}
              </ix-button>`
            : nothing
        }
      </div>
    `;
  }

  private renderDrillEditor(asset: Asset, routeValid: boolean): TemplateResult {
    const preset = this.presetId || presetOf(asset.link).id;
    const hint = DRILL_PRESETS.find(
      (candidate) => candidate.id === preset
    )?.hint;
    return html`
      <ix-select
        label=${localize(MSG.inspector.drillTarget)}
        .value=${preset}
        @valueChange=${(event: { detail: string | string[] }) => this.applyPreset(asset, selectedValue(event.detail))}
      >
        ${DRILL_PRESETS.map(
          (candidate) =>
            html`<ix-select-item
              value=${candidate.id}
              label=${localize(candidate.label)}
            ></ix-select-item>`
        )}
      </ix-select>
      ${hint ? html`<div class="hint">${localizeDir(hint)}</div>` : nothing}
      <ix-input
        label=${localize(MSG.inspector.drillRoute)}
        .value=${asset.link}
        invalid-text=${localize(MSG.inspector.drillInvalid)}
        @valueChange=${(event: IxValueEvent) => this.patchAsset({ link: event.detail })}
      ></ix-input>
      ${routeValid ? nothing : html`<div class="error">${localizeDir(MSG.inspector.drillInvalid)}</div>`}
    `;
  }

  /** Seed the route from the chosen preset, leaving the `<id>` for the user to fill. */
  private applyPreset(asset: Asset, presetId: string): void {
    this.presetId = presetId;
    const preset = DRILL_PRESETS.find((candidate) => candidate.id === presetId);
    if (!preset || preset.template === '') return;
    if (asset.link.trim() === '' || presetOf(asset.link).id !== presetId) {
      this.patchAsset({ link: preset.template });
    }
  }

  // --- patching --------------------------------------------------------------

  /** An area name for the hint, falling back to its id when the area has gone. */
  private areaName(areaId: string): string {
    return this.site?.areas.find((area) => area.id === areaId)?.name ?? areaId;
  }

  private patchAsset(part: Partial<Asset>): void {
    if (!this.asset) return;
    this.emit('wui:patch', { asset: { ...this.asset, ...part } });
  }

  private patchReading(
    asset: Asset,
    index: number,
    part: Partial<Reading>
  ): void {
    const readings = asset.readings.map((reading, position) =>
      position === index ? { ...reading, ...part } : reading
    );
    this.patchAsset({ readings });
  }

  /**
   * Append an empty reading. The id only has to be unique within the asset, and
   * reusing a deleted row's index would collide — so it is taken from the clock.
   */
  private addReading(asset: Asset): void {
    const reading = {
      ...blankReading(),
      id: `r${Date.now().toString(ID_RADIX)}`
    };
    this.patchAsset({ readings: [...asset.readings, reading] });
  }

  private removeReading(asset: Asset, index: number): void {
    this.patchAsset({
      readings: asset.readings.filter((_, position) => position !== index)
    });
  }

  private close(): void {
    this.emit('wui:close');
  }

  private emit(type: string, detail: unknown = {}): void {
    const init = { detail, bubbles: true, composed: true };
    // eslint-disable-next-line no-restricted-syntax -- `type` is a fixed internal `wui:*` event name; the rule only validates string literals.
    this.dispatchEvent(new CustomEvent(type, init));
  }
}

/** The badge colour, handed to the panel styles as the custom property they read. */
function badgeStyle(color: string): string {
  return `--badge: ${color}`;
}

/** The datapoint an asset's alarm state is keyed by (element widened to DP). */
function primaryDp(asset: Asset): string {
  const dp = asset.dp.trim();
  if (!dp) return '';
  const dot = dp.indexOf('.');
  return dot === -1 ? dp : dp.slice(0, dot);
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function inspectorStyles(): ReturnType<typeof css> {
  return css`
    ${panelCore()}
    .row.four {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 5rem minmax(
          0,
          1.2fr
        );
    }
    /* In alarm: the banner takes the colour WinCC OA computed for the alert state. */
    .alarm-banner {
      display: flex;
      align-items: center;
      gap: 0.375rem;
      padding: 0.375rem 0.75rem;
      background: color-mix(in srgb, var(--badge) 22%, transparent);
      color: var(--badge);
      font-size: 0.8125rem;
      font-weight: 600;
    }
    .readings-edit {
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
    }
    .reading-row {
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      padding: 0.5rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
    }
    .on-map {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .notes {
      padding: 0.5rem;
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-2);
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
      white-space: pre-wrap;
    }
    .drill-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    @media (max-width: 520px) {
      .row.four {
        grid-template-columns: minmax(0, 1fr);
      }
    }
  `;
}
