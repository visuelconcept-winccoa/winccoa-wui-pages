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
 * element (`<dpe>:_alert_hdl.._ack`), the documented WinCC OA mechanism, through
 * WinCC OA's own API from the browser — as the logged-in user. See
 * {@link AlarmStore.acknowledge}.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { AlertService } from '@wincc-oa/wui-alert-data/alert-service.js';
import type { Alert } from '@wincc-oa/wui-models/interfaces/wui-alert/alert.js';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { container } from 'tsyringe';
import { ackDpe, mergeAlerts } from '../mapping.js';
import type { Range } from '../period.js';
import {
  DEFAULT_RANGES,
  canAcknowledge,
  type Alarm,
  type AlarmRange
} from '../types.js';

/** Rows the archive query asks for at most — the backend's own default is 1000. */
export const DEFAULT_MAX_RESULTS = 5000;
/** WinCC OA acknowledge command value written to `_alert_hdl.._ack`. */
const ACK_COMMAND = 2;

/** What an acknowledgement did. The browser writes AS the operator, so a
 * successful write is attributed to them by WinCC OA itself. */
export interface AckResult {
  ok: boolean;
}

export interface HistoryResult {
  alarms: Alarm[];
  /** True when the answer hit `maxResults` — the period is wider than the answer. */
  truncated: boolean;
}

/**
 * Reads alarms from WinCC OA and maps them into the kit's domain.
 *
 * Stateless on purpose: the priority ranges are the only configuration, and the
 * caller owns the snapshot. Resolve it once per component.
 */
export class AlarmStore {
  private readonly alertService: AlertService;
  private readonly api: OaRxJsApi;
  private readonly ranges: readonly AlarmRange[];

  constructor(ranges: readonly AlarmRange[] = DEFAULT_RANGES) {
    this.ranges = ranges;
    this.alertService = container.resolve(AlertService);
    this.api = container.resolve(OaRxJsApi);
  }

  /** The live alarm snapshot, re-emitted on every change. */
  live$(): Observable<Alarm[]> {
    return this.alertService
      .connect()
      .pipe(map((alerts: Alert[]) => mergeAlerts(alerts, this.ranges)));
  }

  /** The archived alarms of a period. */
  async history(
    range: Range,
    maxResults: number = DEFAULT_MAX_RESULTS
  ): Promise<HistoryResult> {
    const answer = await firstValueFrom(
      this.alertService.getAlertArchive(
        new Date(range.start),
        new Date(range.end),
        undefined,
        maxResults
      )
    );
    const alerts: Alert[] = Object.values(answer?.alerts ?? {});
    return {
      alarms: mergeAlerts(alerts, this.ranges),
      truncated: alerts.length >= maxResults
    };
  }

  /**
   * Acknowledge the given alarms through WinCC OA's OWN API: the browser's
   * `dpSet` on `<dpe>:_alert_hdl.._ack = 2`, the documented mechanism, issued on
   * the operator's own session — so WinCC OA records the operator's name itself,
   * with no backend in between.
   *
   * That write needs the WebUI user's WinCC OA WRITE permission (the `canWrite`
   * flag of the login token); without it the runtime answers "User is not
   * permitted to use dpSet". The view therefore HIDES the acknowledge affordance
   * (checkboxes and button) when the permission is missing, see
   * `@visuelconcept/wui-kit/data/permissions.js` (`canWriteDatapoints$`).
   *
   * One `dpSet` for the whole selection (the API takes a list), so the operator's
   * action is atomic instead of half-applied across N round-trips. A selection
   * with nothing acknowledgeable in it returns `ok: false`: reporting success for
   * a write that never happened is the one outcome an operator cannot detect —
   * the alarm simply stays unacknowledged while everybody assumes it was taken
   * over.
   */
  async acknowledge(alarms: readonly Alarm[]): Promise<AckResult> {
    const targets = alarms.filter((alarm) => canAcknowledge(alarm));
    if (targets.length === 0) return { ok: false };
    const dpes = [...new Set(targets.map((alarm) => ackDpe(alarm)))];
    const values = dpes.map(() => ACK_COMMAND);
    const ok = await firstValueFrom(this.api.dpSet(dpes, values));
    return { ok: ok === true };
  }
}
