// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Diagnosis page - Standalone version
 *
 * This file is built as a separate entry point and loaded at runtime
 * via dynamic import. Dependencies (lit, etc.) are resolved via import maps.
 *
 * Uses wui-context-generator with array/group contexts to emit
 * full series arrays for wui-widget-kpi-list.
 * Uses translate context for internationalized labels.
 * Supports status-based coloring via custom attribute resultSelector functions.
 */
import '@wincc-oa/wui-ix-wrappers/wui-content-header/wui-content-header.js';
import '@wincc-oa/wui-oarxjs-context/components/wui-context-generator/wui-context-generator.js';
import '@wincc-oa/wui-widgets/wui-widget-kpi-list/wui-widget-kpi-list.js';
import '@wincc-oa/wui-widgets/wui-widget-pie/wui-widget-pie.js';
import { LitElement, css, html, type TemplateResult } from 'lit';
import { customElement } from 'lit/decorators.js';

/** Status-to-color mapping */
const STATUS_COLORS: Record<string, string | undefined> = {
  ok: 'var(--theme-color-success)',
  warn: 'var(--theme-color-warning)',
  alert: 'var(--theme-color-alarm)',
  '': undefined
};

/** Height multiplier in rem for KPI list items */
const KPI_ITEM_HEIGHT_REM = 3;

const BYTES_PER_KIBIBYTE = 1024;
const ONE_DECIMAL_FACTOR = 10;

/** Convert bytes to GiB, rounded to one decimal place */
function bytesToGiB(bytes: number): number {
  return (
    Math.round(
      (bytes / BYTES_PER_KIBIBYTE / BYTES_PER_KIBIBYTE) * ONE_DECIMAL_FACTOR
    ) / ONE_DECIMAL_FACTOR
  );
}

/** Context configuration types */
interface ContextConfig {
  context: string;
  config: string | object;
}

interface SeriesItemConfig {
  name: ContextConfig;
  value: ContextConfig;
  color?: ContextConfig;
}

type SeriesItem = [
  translationKey: string,
  contextType: string,
  contextParam: string | object,
  hasStatus?: boolean
];

@customElement('wui-diagnosis')
export class WuiDiagnosis extends LitElement {
  static override readonly styles = css`
    :host {
      display: block;
    }
    ix-layout-grid {
      padding: 0 !important;
    }
    ix-col {
      display: flex;
    }
    ix-card {
      width: 100%;
    }
    ix-card-content {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .card-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 1rem;
      flex-shrink: 0;
    }
    .card-info {
      margin-left: auto;
    }
    .chart-header {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin-bottom: 0.5rem;
      justify-content: center;
    }
    wui-widget-pie {
      display: block;
      width: 100%;
      min-height: 18rem;
      height: 18rem;
      max-width: 25rem;
      margin: 0 auto;
    }
    .kpi-container {
      flex: 1;
      width: 100%;
    }
    .kpi-container wui-context-generator,
    ix-card-content > wui-context-generator {
      display: block;
      width: 100%;
    }
    wui-widget-kpi-list {
      display: block !important;
      width: 100% !important;
    }
  `;

  // eslint-disable-next-line max-lines-per-function -- Render methods in Lit components are typically large
  override render(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          headerTitle: {
            context: 'translate',
            config: 'WUI_Settings.GeneralLabels.Diagnosis'
          }
        }}
      >
        <wui-content-header></wui-content-header>
      </wui-context-generator>

      <ix-layout-grid>
        <ix-row>
          <ix-col>
            ${this.renderCard(
              'WUI_Diagnosis.DiagnosisGroups.TimeGroup',
              'clock',
              [
                [
                  'WUI_Diagnosis.DiagnosisItems.GenerateTime',
                  'time',
                  'local',
                  true
                ],
                [
                  'WUI_Diagnosis.DiagnosisItems.BackendTime',
                  'time',
                  'server',
                  true
                ]
              ]
            )}
          </ix-col>
          <ix-col>
            ${this.renderCard(
              'WUI_Diagnosis.DiagnosisGroups.LicensesGroup',
              'license',
              [
                [
                  'WUI_Diagnosis.DiagnosisItems.AvailableLicenses.Desktop',
                  'licenses',
                  'desktop',
                  true
                ],
                [
                  'WUI_Diagnosis.DiagnosisItems.AvailableLicenses.Mobile',
                  'licenses',
                  'mobile',
                  true
                ]
              ]
            )}
          </ix-col>
          <ix-col size-md="12">
            ${this.renderCard(
              'WUI_Diagnosis.DiagnosisGroups.WinccOaGroup',
              'applications',
              [
                [
                  'WUI_Diagnosis.DiagnosisItems.WinccOaVersion',
                  'winccoa',
                  'version'
                ],
                [
                  'WUI_Diagnosis.DiagnosisItems.AvailableBackendLanguages',
                  'winccoa',
                  'languages'
                ]
              ]
            )}
          </ix-col>
        </ix-row>
        <ix-row>
          <ix-col>
            ${this.renderCard(
              'WUI_Diagnosis.DiagnosisGroups.ConnectionGroup',
              'connected',
              [
                ['WUI_Diagnosis.DiagnosisItems.ApiUrl', 'apiinfo', 'url'],
                [
                  'WUI_Diagnosis.DiagnosisItems.ConnectionState',
                  'apiinfo',
                  'statustext',
                  true
                ],
                [
                  'WUI_Diagnosis.DiagnosisItems.HeartbeatIndicator',
                  'apiinfo',
                  'heartbeat',
                  true
                ]
              ]
            )}
          </ix-col>
          <ix-col>
            ${this.renderCard(
              'WUI_Diagnosis.DiagnosisGroups.BrowserGroup',
              'earth',
              [
                [
                  'WUI_Diagnosis.DiagnosisItems.Browser',
                  'browserinfo',
                  'browser'
                ],
                ['WUI_Diagnosis.DiagnosisItems.OS', 'browserinfo', 'os']
              ]
            )}
          </ix-col>
          <ix-col>
            ${this.renderCard(
              'WUI_Diagnosis.DiagnosisGroups.ServiceWorkerGroup',
              'cogwheel',
              [
                [
                  'WUI_Diagnosis.DiagnosisItems.State',
                  'serviceworker',
                  'state',
                  true
                ],
                [
                  'WUI_Diagnosis.DiagnosisItems.Scope',
                  'serviceworker',
                  'scope'
                ],
                [
                  'WUI_Diagnosis.DiagnosisItems.Clients',
                  'serviceworker',
                  'clients'
                ],
                [
                  'WUI_Diagnosis.DiagnosisItems.LastCacheDate',
                  'serviceworker',
                  'lastCacheDate'
                ],
                [
                  'WUI_Diagnosis.DiagnosisItems.Proxy',
                  'serviceworker',
                  'proxy',
                  true
                ]
              ],
              'WUI_Diagnosis.DiagnosisItems.ServiceWorkerCardTooltip'
            )}
          </ix-col>
        </ix-row>
        ${this.renderChartsRow()}
      </ix-layout-grid>
    `;
  }

  /**
   * Creates a series config for the array context.
   * Each entry becomes { name: '...', value: '...', color?: '...' } in the output array.
   */
  private createSeriesConfig(
    items: SeriesItem[]
  ): { context: 'group'; config: SeriesItemConfig }[] {
    return items.map(
      ([translationKey, contextType, contextParam, hasStatus]) => {
        const config: SeriesItemConfig = {
          name: { context: 'translate', config: translationKey },
          value: { context: contextType, config: contextParam }
        };

        if (hasStatus) {
          // Add color property that uses the same context with status output
          config.color = {
            context: contextType,
            config: this.getStatusConfig(contextType, contextParam),
            attribute: {
              name: 'color',
              resultSelector: (result: string) =>
                STATUS_COLORS[result] || undefined
            }
          } as ContextConfig;
        }

        return { context: 'group' as const, config };
      }
    );
  }

  /**
   * Gets the config object for status output based on context type.
   */
  private getStatusConfig(
    contextType: string,
    contextParam: string | object
  ): object {
    // Map context types to their property name conventions
    const propertyKeys: Record<string, string> = {
      time: 'source',
      apiinfo: 'property',
      serviceworker: 'property',
      licenses: 'type'
    };

    const propertyKey = propertyKeys[contextType] || 'property';
    return typeof contextParam === 'string'
      ? { [propertyKey]: contextParam, output: 'status' }
      : { ...contextParam, output: 'status' };
  }

  /**
   * Renders a card with translated title and KPI list
   */
  // eslint-disable-next-line max-lines-per-function -- Render methods in Lit are typically verbose
  private renderCard(
    titleKey: string,
    icon: string,
    seriesItems: SeriesItem[],
    tooltipKey: string | null = null
  ): TemplateResult {
    const seriesConfig = this.createSeriesConfig(seriesItems);
    const kpiHeight = `${seriesItems.length * KPI_ITEM_HEIGHT_REM}rem`;

    return html`
      <ix-card>
        <ix-card-content>
          <div class="card-header">
            <ix-icon name="${icon}" size="32"></ix-icon>
            <wui-context-generator
              .config=${{
                innerText: { context: 'translate', config: titleKey }
              }}
            >
              <ix-typography format="h2"></ix-typography>
            </wui-context-generator>
            ${tooltipKey
              ? html`
                  <div class="card-info">
                    <ix-icon name="info" id="tooltip-${icon}"></ix-icon>
                    <ix-tooltip for="#tooltip-${icon}">
                      <wui-context-generator
                        .config=${{
                          innerText: {
                            context: 'translate',
                            config: tooltipKey
                          }
                        }}
                      >
                        <span></span>
                      </wui-context-generator>
                    </ix-tooltip>
                  </div>
                `
              : ''}
          </div>
          <div class="kpi-container">
            <wui-context-generator
              .config=${{
                series: {
                  context: 'array',
                  config: seriesConfig
                }
              }}
            >
              <wui-widget-kpi-list
                style="height: ${kpiHeight}"
              ></wui-widget-kpi-list>
            </wui-context-generator>
          </div>
        </ix-card-content>
      </ix-card>
    `;
  }

  /**
   * Renders a pie chart card for memory or disk space
   */
  // eslint-disable-next-line max-lines-per-function -- Render methods in Lit are typically verbose
  private renderPieChartCard(
    titleKey: string,
    icon: string,
    usedLabelKey: string,
    freeLabelKey: string,
    dpFreeKey: string,
    dpUsedKey: string
  ): TemplateResult {
    return html`
      <ix-card>
        <ix-card-content>
          <div class="chart-header">
            <ix-icon name="${icon}" size="32"></ix-icon>
            <wui-context-generator
              .config=${{
                innerText: { context: 'translate', config: titleKey }
              }}
            >
              <ix-typography format="h2"></ix-typography>
            </wui-context-generator>
          </div>
          <wui-context-generator
            .config=${{
              series: {
                context: 'array',
                config: [
                  {
                    context: 'group',
                    config: {
                      value: {
                        context: 'dpconnect',
                        config: dpFreeKey,
                        attribute: {
                          name: 'value',
                          resultSelector: (result: number) => bytesToGiB(result)
                        }
                      },
                      name: { context: 'translate', config: freeLabelKey },
                      unit: 'GiB'
                    }
                  },
                  {
                    context: 'group',
                    config: {
                      value: {
                        context: 'dpconnect',
                        config: dpUsedKey,
                        attribute: {
                          name: 'value',
                          resultSelector: (result: number) => bytesToGiB(result)
                        }
                      },
                      name: { context: 'translate', config: usedLabelKey },
                      unit: 'GiB'
                    }
                  }
                ]
              }
            }}
          >
            <wui-widget-pie
              renderer="svg"
              labelsShow
              labelsDetails="value"
              labelsPosition="outside"
              showLegend
              legendOrientation="horizontal"
              legendHorizontalPosition="center"
              legendVerticalPosition="bottom"
            ></wui-widget-pie>
          </wui-context-generator>
        </ix-card-content>
      </ix-card>
    `;
  }

  /**
   * Renders the charts row (only when user is logged in)
   */
  private renderChartsRow(): TemplateResult {
    return html`
      <wui-context-generator
        .config=${{
          style: {
            context: 'authentication',
            config: 'isLoggedIn',
            attribute: {
              name: 'style',
              resultSelector: (result: string) =>
                result === 'true' ? 'display: flex;' : 'display: none;'
            }
          }
        }}
      >
        <ix-row style="display: none;">
          <ix-col>
            ${this.renderPieChartCard(
              'WUI_Diagnosis.DiagnosisItems.Memory',
              'piechart',
              'WUI_Diagnosis.DiagnosisItems.MemoryUsed',
              'WUI_Diagnosis.DiagnosisItems.MemoryFree',
              '_MemoryCheck.FreeKB',
              '_MemoryCheck.UsedKB'
            )}
          </ix-col>
          <ix-col>
            ${this.renderPieChartCard(
              'WUI_Diagnosis.DiagnosisItems.DiskSpace',
              'piechart',
              'WUI_Diagnosis.DiagnosisItems.DiskSpaceUsed',
              'WUI_Diagnosis.DiagnosisItems.DiskSpaceFree',
              '_ArchivDisk.AvailKB',
              '_ArchivDisk.UsedKB'
            )}
          </ix-col>
        </ix-row>
      </wui-context-generator>
    `;
  }
}
