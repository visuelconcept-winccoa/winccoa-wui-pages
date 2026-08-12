// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The panel for a selected **connection** — a supervised link between two assets.
 *
 * It is the asset inspector's counterpart, and deliberately shorter: a connection has no
 * position to edit, because its geometry *is* its two ends. Everything else an asset has, it
 * has — a primary datapoint whose alert state paints it, live readings, a drill-down route,
 * a name, a kind, notes.
 *
 * The two ends are shown but **not editable**. Changing them would mean re-picking assets on
 * the map, which is what the line tool already does well; a pair of dropdowns listing every
 * asset in the site would be a worse version of the same gesture and would let the operator
 * build a line they cannot see.
 *
 * Emits `wui:patch` `{ connection }`, `wui:delete`, `wui:open` `{ route }`, `wui:close`, and
 * `wui:straighten` (drop the shaping points).
 */
import '@visuelconcept/wui-kit/ui/wui-dp-input.js';
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { formatValue, normDp, type LiveState } from '../data/live.js';
import { alarmsRoute, bareDp, isValidRoute } from '../drill.js';
import {
  MSG,
  connectionKindLabel,
  localize,
  localizeDir,
  shapePointsMsg
} from '../i18n.js';
import {
  CONNECTION_KINDS,
  connectionColor,
  routeById,
  type Connection,
  type ConnectionKind,
  type Site
} from '../types.js';
import { panelCore } from './panel-styles.js';

/** `<wui-dp-input>` reports the chosen datapoint name wrapped in a `{ value }`. */
type DpChangeEvent = CustomEvent<{ value: string }>;
type IxValueEvent = CustomEvent<string>;

/** An `ix-select` in single mode still reports its value as a one-item list sometimes. */
function selectedValue(detail: string | string[]): string {
  return Array.isArray(detail) ? (detail[0] ?? '') : detail;
}

@customElement('gis-link-panel')
export class GisLinkPanel extends LitElement {
  static override readonly styles = [IXCoreStyles, linkPanelStyles()];

  @property({ attribute: false }) site: Site | null = null;
  @property({ attribute: false }) connection: Connection | null = null;
  @property({ attribute: false }) live: LiveState = {
    values: new Map(),
    alarmColors: new Map()
  };
  @property({ type: Boolean }) editable = false;

  override render(): TemplateResult {
    const connection = this.connection;
    if (!connection)
      return html`<div class="none">${localizeDir(MSG.link.title)}</div>`;
    const site = this.site;
    const alarmColor = this.live.alarmColors.get(normDp(bareDp(connection.dp)));
    const route = site ? routeById(site, connection.routeId) : null;
    const color = site ? connectionColor(site, connection) : '';
    return html`
      <div class="head">
        <span class="swatch" style="--swatch: ${alarmColor || color}"></span>
        <div class="titles">
          <div class="title">
            ${connection.name || localizeDir(MSG.link.title)}
          </div>
          <div class="sub">
            ${route ? `${route.name} · ` : ''}${connectionKindLabel(
              connection.kind
            )}
          </div>
        </div>
        <ix-icon-button
          ghost
          icon="close"
          @click=${() => this.emit('wui:close')}
        ></ix-icon-button>
      </div>
      ${
        alarmColor
          ? html`<div class="alarm-banner" style="--swatch: ${alarmColor}">
              <ix-icon name="alarm-bell" size="16"></ix-icon
              >${localizeDir(MSG.inspector.inAlarm)}
            </div>`
          : nothing
      }
      <div class="body">
        ${this.renderEnds(connection)}
        ${this.editable ? this.renderFields(connection) : nothing}
        ${this.renderReadings(connection)} ${this.renderDrill(connection)}
        ${
          connection.notes && !this.editable
            ? html`<div class="notes">${connection.notes}</div>`
            : nothing
        }
        ${
          this.editable
            ? html`<ix-button
                variant="secondary"
                outline
                @click=${() => this.emit('wui:delete')}
              >
                <ix-icon name="trashcan" slot="icon"></ix-icon
                >${localizeDir(MSG.link.delete)}
              </ix-button>`
            : nothing
        }
      </div>
    `;
  }

  /** The two ends, by name, plus how many shaping points the path carries. */
  private renderEnds(connection: Connection): TemplateResult {
    const site = this.site;
    const name = (id: string): string =>
      site?.assets.find((asset) => asset.id === id)?.name ?? id;
    return html`
      <dl class="readings">
        <dt>${localizeDir(MSG.link.ends)}</dt>
        <dd>${name(connection.from)} → ${name(connection.to)}</dd>
      </dl>
      <div class="hint">${localizeDir(MSG.link.endsHint)}</div>
      ${
        connection.via.length > 0
          ? html`<div class="row two">
              <span class="shape"
                >${shapePointsMsg(connection.via.length)}</span
              >
              ${
                this.editable
                  ? html`<ix-button
                      variant="secondary"
                      ghost
                      @click=${() => this.emit('wui:straighten')}
                      >${localizeDir(MSG.link.straighten)}</ix-button
                    >`
                  : nothing
              }
            </div>`
          : nothing
      }
    `;
  }

  private renderFields(connection: Connection): TemplateResult {
    return html`
      <ix-input
        label=${localize(MSG.link.name)}
        .value=${connection.name}
        @valueChange=${(event: IxValueEvent) => this.patch({ name: event.detail })}
      ></ix-input>
      <div class="row two">
        <ix-select
          label=${localize(MSG.link.kind)}
          .value=${connection.kind}
          @valueChange=${(event: { detail: string | string[] }) =>
            this.patch({
              kind: selectedValue(event.detail) as ConnectionKind
            })}
        >
          ${CONNECTION_KINDS.map(
            (kind) =>
              html`<ix-select-item
                value=${kind}
                label=${connectionKindLabel(kind)}
              ></ix-select-item>`
          )}
        </ix-select>
        <ix-select
          label=${localize(MSG.link.route)}
          .value=${connection.routeId}
          @valueChange=${(event: { detail: string | string[] }) => this.patch({ routeId: selectedValue(event.detail) })}
        >
          <ix-select-item
            value=""
            label=${localize(MSG.link.noRoute)}
          ></ix-select-item>
          ${(this.site?.routes ?? []).map(
            (route) =>
              html`<ix-select-item
                value=${route.id}
                label=${route.name}
              ></ix-select-item>`
          )}
        </ix-select>
      </div>
      <div class="hint">${localizeDir(MSG.link.routeHint)}</div>
      <wui-dp-input
        label=${localize(MSG.inspector.primaryDp)}
        .value=${connection.dp}
        @wui:change=${(event: DpChangeEvent) => this.patch({ dp: event.detail.value })}
      ></wui-dp-input>
      <div class="hint">${localizeDir(MSG.inspector.primaryDpHint)}</div>
      <ix-input
        label=${localize(MSG.inspector.notes)}
        .value=${connection.notes}
        @valueChange=${(event: IxValueEvent) => this.patch({ notes: event.detail })}
      ></ix-input>
    `;
  }

  /** What the connection currently reads — the same list shape the asset panel uses. */
  private renderReadings(
    connection: Connection
  ): TemplateResult | typeof nothing {
    if (connection.readings.length === 0) return nothing;
    return html`<dl class="readings">
      ${connection.readings.map(
        (reading) => html`
          <dt>${reading.label || reading.dp}</dt>
          <dd>
            ${formatValue(
              this.live.values.get(normDp(reading.dp)),
              reading.decimals
            )}${reading.unit}
          </dd>
        `
      )}
    </dl>`;
  }

  /**
   * The drill-down buttons: the configured route, and the Alarms page scoped to this
   * connection's own datapoint — which needs no configuration at all, exactly as for an
   * asset. A faulted feeder opens its alarms in one click.
   */
  private renderDrill(connection: Connection): TemplateResult | typeof nothing {
    const hasLink = connection.link !== '' && isValidRoute(connection.link);
    const dp = bareDp(connection.dp);
    if (!hasLink && !dp) return nothing;
    return html`<div class="drill">
      ${
        hasLink
          ? html`<ix-button
              variant="secondary"
              @click=${() => this.emit('wui:open', { route: connection.link })}
            >
              <ix-icon name="open-external" slot="icon"></ix-icon
              >${localizeDir(MSG.inspector.openTarget)}
            </ix-button>`
          : nothing
      }
      ${
        dp
          ? html`<ix-button
              variant="secondary"
              ghost
              @click=${() => this.emit('wui:open', { route: alarmsRoute(dp) })}
            >
              <ix-icon name="alarm-bell" slot="icon"></ix-icon
              >${localizeDir(MSG.inspector.openAlarms)}
            </ix-button>`
          : nothing
      }
    </div>`;
  }

  private patch(part: Partial<Connection>): void {
    if (!this.connection) return;
    this.emit('wui:patch', { connection: { ...this.connection, ...part } });
  }

  private emit(name: string, detail?: unknown): void {
    const init = { detail, bubbles: true, composed: true };
    // eslint-disable-next-line no-restricted-syntax -- `name` is a fixed internal `wui:*` event name; the rule only validates string literals.
    this.dispatchEvent(new CustomEvent(name, init));
  }
}

function linkPanelStyles(): ReturnType<typeof css> {
  return css`
    ${panelCore()}
    /* The line's colour, as a short stroke rather than a disc: it stands for a path. */
    .swatch {
      flex: 0 0 auto;
      width: 1.5rem;
      height: 0.25rem;
      border-radius: 999px;
      background: var(--swatch, var(--theme-color-component-1));
    }
    .alarm-banner {
      border-left: 3px solid var(--swatch);
    }
    .shape {
      align-self: center;
      color: var(--theme-color-soft-text);
      font-size: 0.8125rem;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'gis-link-panel': GisLinkPanel;
  }
}
