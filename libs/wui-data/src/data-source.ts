// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The page's data source — chosen by the HOST, never by the page:
 *
 *   globalThis.wuiData = { source: 'socket', url: './wui-data' }
 *
 * set before the pages load (an Industrial Edge app packed by wui-toolkit sets it)
 * selects the socket source; without it, WinCC OA (OaRxJsApi) — the WebUI shell,
 * `wui dev` and its mock run the pages as before. A host may also register its own
 * source in the container under DATA_SOURCE.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { container, type InjectionToken } from 'tsyringe';
import { OaDataSource } from './oa-source.js';
import { SocketDataSource, socketUrl } from './socket-source.js';
import type { DataSource } from './source.js';

export const DATA_SOURCE: InjectionToken<DataSource> = 'wui-data:DataSource';

/** What the host sets before the pages load. */
export interface DataSourceConfig {
  source?: 'oa' | 'socket';
  /** socket: the WebSocket's path or URL, relative to the page (default ./wui-data). */
  url?: string;
}

/** The source a configuration names. */
export function createDataSource(config: DataSourceConfig | undefined): DataSource {
  if (config?.source === 'socket') return new SocketDataSource(socketUrl(config.url ?? './wui-data'));
  return new OaDataSource(container.resolve(OaRxJsApi));
}

/** The page's data source: the one registered, else the one `globalThis.wuiData` names — one per page. */
export function dataSource(): DataSource {
  if (!container.isRegistered(DATA_SOURCE, true)) {
    container.register(DATA_SOURCE, { useValue: createDataSource((globalThis as { wuiData?: DataSourceConfig }).wuiData) });
  }
  return container.resolve(DATA_SOURCE);
}
