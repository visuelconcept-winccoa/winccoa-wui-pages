// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The alarm data layer — the only place the kit talks to WinCC OA.
 *
 * Two snapshots, one shape ({@link Alarm}[]), which is what lets one component
 * serve both:
 *   • `live$()` — the standing alarms, from the runtime's `AlertService.connect()`.
 *     That subscription is shared by the service itself (`shareReplay` with
 *     ref-counting), so ten embedded panels on one page still open ONE server
 *     subscription. The kit therefore never passes a backend filter: it
 *     subscribes unfiltered and each view narrows client-side (see
 *     {@link ../scope.ts}) — the backend also rejects glob filters.
 *   • `history(range)` — the alarm archive over a period, from
 *     `getAlertArchive(start, end)`.
 *
 * Acknowledging writes `2` to the alarm-handling attribute of the datapoint
 * element (`<dpe>:_alert_hdl.._ack`), the documented WinCC OA mechanism; it needs
 * write permission and fails loudly rather than pretending it worked.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { AlertService } from '@wincc-oa/wui-alert-data/alert-service.js';
import type { Alert } from '@wincc-oa/wui-models/interfaces/wui-alert/alert.js';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { container } from 'tsyringe';
import { ackDpe, mergeAlerts } from '../mapping.js';
import type { Range } from '../period.js';
import { DEFAULT_PRIORITY_BANDS, type Alarm, type PriorityBand } from '../types.js';

/** Rows the archive query asks for at most — the backend's own default is 1000. */
export const DEFAULT_MAX_RESULTS = 5000;
/** WinCC OA acknowledge command value written to `_alert_hdl.._ack`. */
const ACK_COMMAND = 2;

export interface HistoryResult {
  alarms: Alarm[];
  /** True when the answer hit `maxResults` — the period is wider than the answer. */
  truncated: boolean;
}

/**
 * Reads alarms from WinCC OA and maps them into the kit's domain.
 *
 * Stateless on purpose: the priority bands are the only configuration, and the
 * caller owns the snapshot. Resolve it once per component.
 */
export class AlarmStore {
  private readonly alertService: AlertService;
  private readonly api: OaRxJsApi;
  private readonly bands: readonly PriorityBand[];

  constructor(bands: readonly PriorityBand[] = DEFAULT_PRIORITY_BANDS) {
    this.bands = bands;
    this.alertService = container.resolve(AlertService);
    this.api = container.resolve(OaRxJsApi);
  }

  /** The live alarm snapshot, re-emitted on every change. */
  live$(): Observable<Alarm[]> {
    return this.alertService.connect().pipe(map((alerts: Alert[]) => mergeAlerts(alerts, this.bands)));
  }

  /** The archived alarms of a period. */
  async history(range: Range, maxResults: number = DEFAULT_MAX_RESULTS): Promise<HistoryResult> {
    const answer = await firstValueFrom(
      this.alertService.getAlertArchive(new Date(range.start), new Date(range.end), undefined, maxResults)
    );
    const alerts: Alert[] = Object.values(answer?.alerts ?? {});
    return { alarms: mergeAlerts(alerts, this.bands), truncated: alerts.length >= maxResults };
  }

  /**
   * Acknowledge the given alarms.
   *
   * One `dpSet` for the whole selection: the runtime accepts a datapoint-element
   * list, and a single write keeps the operator's action atomic from the server's
   * point of view instead of half-applied across N round-trips.
   */
  async acknowledge(alarms: readonly Alarm[]): Promise<boolean> {
    const dpes = [...new Set(alarms.filter((alarm) => alarm.ackable).map((alarm) => ackDpe(alarm)))];
    if (dpes.length === 0) return true;
    const values = dpes.map(() => ACK_COMMAND);
    return firstValueFrom(this.api.dpSet(dpes, values));
  }
}
