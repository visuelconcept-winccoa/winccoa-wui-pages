// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The mission book, and the operator command channel back to the simulator.
 *
 * The per-vehicle `AGV_Vehicle.mission` element only carries a one-line summary,
 * so the `agvSim` manager publishes the whole order book as JSON on
 * `AGV_MissionBook.json` and consumes operator actions from `AGV_Command.json`.
 * This store follows the former and writes the latter — the fleet datapoints
 * themselves stay read-only, exactly as the supervision view intends.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import {
  BehaviorSubject,
  Subscription,
  firstValueFrom,
  type Observable
} from 'rxjs';
import { container } from 'tsyringe';
import type { MissionRow } from '../types.js';

/** Datapoint the manager publishes the book on. */
const BOOK_DPE = 'AGV_MissionBook.json';
/** Datapoint the page appends operator commands to. */
const COMMAND_DPE = 'AGV_Command.json';

/** Actions the manager accepts (see backend/managers/agvSim/book.js). */
export type MissionAction =
  'cancel' | 'charge' | 'park' | 'dispatch' | 'recover' | 'fault';

interface DpEmission {
  dp: string[];
  value: unknown[];
}

/** Coerce a datapoint value (raw, array- or `{ value }`-wrapped) to text. */
function toText(raw: unknown): string {
  if (Array.isArray(raw)) return raw.length > 0 ? toText(raw[0]) : '';
  if (raw !== null && typeof raw === 'object' && 'value' in raw) {
    return toText((raw as { value: unknown }).value);
  }
  return raw == null ? '' : String(raw);
}

export class MissionStore {
  /** True when the book datapoint is missing — the simulator is not running. */
  private readonly available$ = new BehaviorSubject<boolean>(false);
  private readonly rows$ = new BehaviorSubject<MissionRow[]>([]);
  private readonly api = this.resolveApi();
  private subscription = new Subscription();

  /** The order book, re-emitted whenever the manager republishes it. */
  get rows(): Observable<MissionRow[]> {
    return this.rows$.asObservable();
  }

  /** False until a book has been received — the tab then explains why. */
  get available(): Observable<boolean> {
    return this.available$.asObservable();
  }

  /** Follow the book datapoint. Safe to call when the simulator is absent. */
  async start(): Promise<void> {
    const api = this.api;
    if (!api) return;
    try {
      // Prove the DPE exists before subscribing: dpConnect on a missing name
      // errors the whole observable, and this one is optional by design.
      const seed = await firstValueFrom(api.dpGet(BOOK_DPE));
      this.ingest(toText(seed));
    } catch {
      this.available$.next(false);
      return;
    }
    try {
      this.subscription.add(
        api.dpConnect(BOOK_DPE, true).subscribe({
          next: (data: DpEmission) => this.ingest(toText(data.value?.[0])),
          error: () => this.available$.next(false)
        })
      );
    } catch {
      this.available$.next(false);
    }
  }

  stop(): void {
    this.subscription.unsubscribe();
    this.subscription = new Subscription();
  }

  /**
   * Queue one operator command for the manager. Returns false when the channel
   * is unavailable or the write is refused (no write permission).
   */
  async send(action: MissionAction, vehicle: string): Promise<boolean> {
    const api = this.api;
    if (!api) return false;
    try {
      const payload = JSON.stringify({ commands: [{ action, vehicle }] });
      await firstValueFrom(api.dpSet(COMMAND_DPE, payload));
      return true;
    } catch {
      return false;
    }
  }

  private ingest(json: string): void {
    if (!json) return;
    try {
      const parsed = JSON.parse(json) as { missions?: MissionRow[] };
      if (!Array.isArray(parsed.missions)) return;
      this.rows$.next(parsed.missions);
      this.available$.next(true);
    } catch {
      // Malformed payload — keep the previous book rather than blanking the tab.
    }
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }
}
