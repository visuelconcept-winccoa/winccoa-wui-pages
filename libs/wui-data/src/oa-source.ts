// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WinCC OA as a data source: dpNames and dpConnect of the OaRxJsApi the shell
 * (or `wui dev`'s harness, mock or live) registers. The default source.
 */
import { OaRxJsApi, type DpConnectData } from '@etm-professional-control/oa-rx-js-api';
import { map, of, type Observable } from 'rxjs';
import type { DataSample, DataSource } from './source.js';

export class OaDataSource implements DataSource {
  readonly kind = 'oa';

  constructor(private readonly api: OaRxJsApi) {}

  names(pattern: string): Observable<string[]> {
    return this.api.dpNames(pattern, '');
  }

  watch(tags: string[]): Observable<DataSample[]> {
    if (tags.length === 0) return of([]);
    return this.api.dpConnect(tags, true).pipe(map((data: DpConnectData) => data.value.map((value) => ({ value }))));
  }
}
