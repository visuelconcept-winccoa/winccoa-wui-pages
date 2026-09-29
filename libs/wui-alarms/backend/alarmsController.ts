// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// -----------------------------------------------------------------------------
// AlarmsController
// -----------------------------------------------------------------------------
// Acknowledging alarms ON BEHALF OF the session user.
//
//   POST /ack  body { dpes: ["System1:Press01.temp", …] } -> { ok, ackUser, attributed }
//   GET  /health
//
// Why this route exists at all. Acknowledging is a write to
// `<dpe>:_alert_hdl.._ack`, and there are only two ways to make it:
//
//   • from the BROWSER (`dpSet` over the operator's own session) — WinCC OA then
//     records the right user, but many projects do not grant WebUI users write
//     permission, and the write is refused with "User is not permitted to use
//     dpSet";
//   • from the WEBSERVER — which works regardless, but the acknowledgement is
//     then attributed to the webserver's own WinCC OA user, so the alarm list
//     shows the server instead of the operator who took the alarm over. For a
//     traceable acknowledgement that is not acceptable.
//
// So the webserver performs the write while IMPERSONATING the session user:
// `setUserId()` (the CTRL function of the same name) switches the manager's user
// context, the `dpSetWait` is attributed to that user, and the previous context
// is restored. The user id comes from the OA `_Users` directory via the session
// identity — never from the request body.
// -----------------------------------------------------------------------------

import { Request, Response } from 'ultimate-express';

import { WsjServerGlobal } from '@winccoa/backend';

import { identityOf } from './appSecurityGuard';

/** WinCC OA acknowledge command written to the alarm-handling attribute. */
const ACK_COMMAND = 2;
/** The attribute an acknowledgement writes to. Composed HERE, never sent by the client. */
const ACK_SUFFIX = ':_alert_hdl.._ack';
/** Upper bound on one request — a page of alarms, not the whole plant. */
const MAX_DPES = 500;

/**
 * `setUserId()` mutates the SHARED manager, so two impersonated writes must never
 * overlap: user A's acknowledgement could otherwise land while the context is set
 * to user B. Every ack goes through this one-at-a-time queue; the critical
 * section is a single `dpSetWait`, so the serialisation costs nothing in practice.
 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {
    // A failed acknowledgement must not block the ones queued behind it.
  });
  return run;
}

/**
 * `<dpe>` → `<dpe>:_alert_hdl.._ack`, or null when the name is not a plain
 * datapoint element.
 *
 * The suffix is added server-side and a name that already carries a CONFIG path
 * is rejected: this endpoint writes with the webserver's rights, so it must be
 * able to write ONE thing — an acknowledgement — and nothing else.
 *
 * The test is the COLON COUNT, not the `:_` substring. A datapoint element holds
 * at most one colon, the system separator; a config path adds a second one
 * (`<dpe>:_alert_hdl..`). Matching `:_` also rejected every WinCC OA INTERNAL
 * datapoint — they all begin with an underscore, so the system separator is
 * followed by one — and `System1:_Event.License.RemainingTime` could not be
 * acknowledged at all.
 */
function ackDpeOf(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const dpe = raw.trim();
  if (dpe === '') return null;
  if ((dpe.match(/:/g) ?? []).length > 1) return null;
  return `${dpe}${ACK_SUFFIX}`;
}

interface AckOutcome {
  ok: boolean;
  /** True when the write was recorded under the operator's own OA user. */
  attributed: boolean;
}

export class AlarmsController {
  /** GET /health */
  public health = (_req: Request, res: Response): void => {
    res.status(200).json({ ok: true, service: 'alarms' });
  };

  /** POST /ack — acknowledge the given alarms as the session user. */
  public ack = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as { dpes?: unknown[] };
    const names = (Array.isArray(body.dpes) ? body.dpes : []).map((dpe) => ackDpeOf(dpe)).filter((dpe): dpe is string => dpe !== null);

    if (names.length === 0) {
      // Say WHAT arrived: a rejection that does not name its input turns a
      // one-line fix into a guessing game (it already did once, over internal
      // datapoints).
      const received = Array.isArray(body.dpes)
        ? `${body.dpes.length} entr${body.dpes.length === 1 ? 'y' : 'ies'}, first ${JSON.stringify(body.dpes[0] ?? null)}`
        : `dpes is ${typeof body.dpes}`;
      res.status(400).json({
        ok: false,
        error: `no acknowledgeable datapoint element — expected { dpes: ["<system>:<dp>.<element>", …] }, got ${received}`
      });
      return;
    }
    if (names.length > MAX_DPES) {
      res.status(400).json({ ok: false, error: `too many datapoint elements (${names.length} > ${MAX_DPES})` });
      return;
    }

    try {
      const who = await identityOf(req);
      const outcome = await serialize(() => this.writeAck(names, who.userId));
      res.status(outcome.ok ? 200 : 500).json({
        ok: outcome.ok,
        // The name the acknowledgement is recorded under — null when the server
        // could not impersonate, so the UI can say so instead of implying the
        // operator's name is on it.
        ackUser: outcome.attributed ? who.username : null,
        attributed: outcome.attributed,
        count: names.length
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: (error as Error).message });
    }
  };

  /**
   * The impersonated write. Runs inside {@link serialize}.
   *
   * A failed impersonation does NOT cancel the acknowledgement: an alarm left
   * unacknowledged because the operator is missing from the `_Users` directory
   * (or because the webserver does not run as root) is an operational risk, while
   * an acknowledgement recorded under the server's identity is a reported one —
   * the answer carries `attributed: false` and the page says it in clear.
   */
  private async writeAck(names: string[], userId: number): Promise<AckOutcome> {
    const winccoa = WsjServerGlobal.winccoa;
    const values = names.map(() => ACK_COMMAND);
    let previous = -1;
    let attributed = false;

    if (userId >= 0) {
      try {
        previous = Number(winccoa.getUserId());
        attributed = winccoa.setUserId(userId) === true;
      } catch (error) {
        console.warn(`alarms/ack: cannot acknowledge as user ${userId}:`, (error as Error)?.message ?? error);
        attributed = false;
      }
    }

    try {
      const ok = names.length === 1 ? await winccoa.dpSetWait(names[0], values[0]) : await winccoa.dpSetWait(names, values);
      return { ok: Boolean(ok), attributed };
    } finally {
      if (attributed && previous >= 0) {
        try {
          winccoa.setUserId(previous);
        } catch (error) {
          console.error('alarms/ack: FAILED to restore the manager user context:', (error as Error)?.message ?? error);
        }
      }
    }
  }
}
