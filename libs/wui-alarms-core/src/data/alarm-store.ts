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
 * element (`<dpe>:_alert_hdl.._ack`), the documented WinCC OA mechanism — but
 * through the webserver, NOT through the browser's own connection. See
 * {@link AlarmStore.acknowledge}.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { AlertService } from '@wincc-oa/wui-alert-data/alert-service.js';
import type { Alert } from '@wincc-oa/wui-models/interfaces/wui-alert/alert.js';
import { firstValueFrom, map, type Observable } from 'rxjs';
import { container } from 'tsyringe';
import { ackDpe, mergeAlerts } from '../mapping.js';
import type { Range } from '../period.js';
import { DEFAULT_RANGES, canAcknowledge, type Alarm, type AlarmRange } from '../types.js';

/** Rows the archive query asks for at most — the backend's own default is 1000. */
export const DEFAULT_MAX_RESULTS = 5000;
/** WinCC OA acknowledge command value written to `_alert_hdl.._ack`. */
const ACK_COMMAND = 2;
/** The module's own endpoint: a server-side write, attributed to the session user. */
const ACK_URL = '/api/alarms/ack';
const HTTP_NOT_FOUND = 404;

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

/** What an acknowledgement did — and, above all, WHO it was recorded under. */
export interface AckResult {
  ok: boolean;
  /** The operator's name when the server could attribute the write; null otherwise. */
  ackUser: string | null;
  /**
   * False when WinCC OA recorded the acknowledgement under the WEBSERVER's user
   * instead of the operator's. The page says so rather than letting a wrong name
   * sit in the alarm list.
   */
  attributed: boolean;
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
    return this.alertService.connect().pipe(map((alerts: Alert[]) => mergeAlerts(alerts, this.ranges)));
  }

  /** The archived alarms of a period. */
  async history(range: Range, maxResults: number = DEFAULT_MAX_RESULTS): Promise<HistoryResult> {
    const answer = await firstValueFrom(
      this.alertService.getAlertArchive(new Date(range.start), new Date(range.end), undefined, maxResults)
    );
    const alerts: Alert[] = Object.values(answer?.alerts ?? {});
    return { alarms: mergeAlerts(alerts, this.ranges), truncated: alerts.length >= maxResults };
  }

  /**
   * Acknowledge the given alarms, recorded under the OPERATOR's name.
   *
   * Two ways exist to write `_alert_hdl.._ack`, and each fails at something:
   *
   *  - the browser's own `dpSet` carries the operator's WinCC OA session, so the
   *    right user is recorded — but a project that does not grant WebUI users
   *    write permission refuses it ("User is not permitted to use dpSet");
   *  - a plain server-side write always goes through — but WinCC OA then
   *    attributes the acknowledgement to the WEBSERVER's user, which is worse
   *    than a refusal: the alarm list shows a name that did not take the alarm
   *    over.
   *
   * So the module's own `POST /api/alarms/ack` does the server-side write while
   * IMPERSONATING the session user (`setUserId`), and answers who it was recorded
   * under. Only the datapoint elements travel: the `:_alert_hdl.._ack` suffix is
   * composed server-side, and the route is role-gated there.
   *
   * The fallback is the BROWSER's write, used when the module's backend is not
   * deployed — it too records the operator, it simply needs the WinCC OA right.
   *
   * One request for the whole selection, so the operator's action is atomic
   * server-side instead of half-applied across N round-trips. A selection with
   * nothing acknowledgeable in it returns `ok: false`: reporting success for a
   * write that never happened is the one outcome an operator cannot detect — the
   * alarm simply stays unacknowledged while everybody assumes it was taken over.
   */
  async acknowledge(alarms: readonly Alarm[]): Promise<AckResult> {
    const targets = alarms.filter((alarm) => canAcknowledge(alarm));
    const dpes = [...new Set(targets.map((alarm) => alarm.dpe))];
    if (dpes.length === 0) return { ok: false, ackUser: null, attributed: false };

    const response = await fetch(ACK_URL, jsonPost({ dpes }));
    if (response.status === HTTP_NOT_FOUND) return this.acknowledgeFromBrowser(targets);

    const answer = (await response.json().catch(() => null)) as
      | { ok?: boolean; error?: string; ackUser?: string | null; attributed?: boolean }
      | null;
    if (!response.ok || answer?.ok !== true) {
      throw new Error(answer?.error ?? `${ACK_URL} → ${response.status}`);
    }
    return { ok: true, ackUser: answer.ackUser ?? null, attributed: answer.attributed === true };
  }

  /** The fallback write, on the operator's own session (needs the OA write right). */
  private async acknowledgeFromBrowser(alarms: readonly Alarm[]): Promise<AckResult> {
    const dpes = [...new Set(alarms.map((alarm) => ackDpe(alarm)))];
    const values = dpes.map(() => ACK_COMMAND);
    const ok = await firstValueFrom(this.api.dpSet(dpes, values));
    // The browser writes AS the logged-in user, so the acknowledgement is
    // attributed even though this side does not know the name.
    return { ok, ackUser: null, attributed: ok };
  }
}
