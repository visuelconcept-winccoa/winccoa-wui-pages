// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live read model of the AGV fleet — one WinCC OA datapoint of type
 * `AGV_Vehicle` per vehicle. Supervision is read-only: the store never writes.
 *
 * The startup sequence is deliberately three-legged, because `dpConnect` is
 * all-or-nothing: per the oa-rx-js-api README, *"invalid names fail the whole
 * subscription — if any name in the array does not exist on the backend, the
 * entire observable errors immediately"*. A fleet-wide subscription therefore
 * has a single point of failure over 8 vehicles × 14 elements = 112 names.
 *
 *   1. discover()  — enumerate the `AGV_Vehicle` datapoints.
 *   2. seed()      — one-shot `dpGet` per element. This both fills the initial
 *                    values AND filters the list down to the elements the
 *                    backend actually serves, so step 3 cannot be rejected by a
 *                    stale element name.
 *   3. connect()   — `dpConnect` per vehicle, never one call for the whole
 *                    fleet: the webserver's CTRL bridge cannot take a name list
 *                    that long (see {@link AgvStore.connect}).
 *
 * Because step 2 already produced real values, a failure in step 3 degrades to
 * `seeded` / `partial` (real data, no live refresh) rather than to blank rows.
 * Every degradation is reported through {@link status} with a reason and logged
 * to the console — this store must never fail silently, which is precisely how
 * the first version hid a rejected subscription behind eight empty rows.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import {
  BehaviorSubject,
  Subscription,
  firstValueFrom,
  type Observable
} from 'rxjs';
import { container } from 'tsyringe';
import {
  AGV_DP_TYPE,
  AGV_ELEMENTS,
  blankAgv,
  decodeState,
  type Agv,
  type AgvElement
} from '../types.js';
import { DEMO_FLEET, DEMO_TICK_MS, driftDemoFleet } from './demo-fleet.js';

/** Shape of a `dpConnect` emission — `dp` / `value` are positionally aligned. */
interface DpEmission {
  dp: string[];
  value: unknown[];
}

/**
 * What the fleet on screen actually is:
 * - `loading` — startup in flight, nothing published yet.
 * - `live` — real datapoints, refreshed by active `dpConnect` subscriptions.
 * - `partial` — live, but some elements are not refreshing.
 * - `seeded` — real datapoint values read once, but live updates are NOT arriving.
 * - `demo` — no datapoints reachable; the in-browser simulation is showing.
 */
export type StoreMode = 'loading' | 'live' | 'partial' | 'seeded' | 'demo';

export interface StoreStatus {
  mode: StoreMode;
  /** Why the store degraded — empty while `mode === 'live'`. */
  detail: string;
}

/** Log prefix, so a degraded page is greppable in the browser console. */
const LOG_TAG = '[agv-fleet]';

/** Elements carrying a numeric value — everything else is read as text. */
const NUMERIC_ELEMENTS = new Set<AgvElement>([
  'state',
  'battery',
  'speed',
  'posX',
  'posY',
  'heading',
  'odometer',
  'missionsToday'
]);

/**
 * Canonical `<dp>.<element>` of a datapoint name or DPE — no system prefix, no
 * config/attribute suffix, no trailing dot.
 *
 * `dpConnect` echoes the name the **webserver** normalised, not the one we asked
 * for: system prefix, `:_original.._value` suffix and possibly a trailing dot
 * (same three steps as `po-kpi-bar`'s `fieldOf` and machine-fleet-3d's
 * `normDp`). The config part must be cut FIRST, because ':' also introduces the
 * config: cutting at the first colon turns an unprefixed
 * `AGV_01.battery:_original.._value` into `_original`, and then every value is
 * routed to a vehicle that does not exist. A system prefix is a leading
 * colon-terminated segment containing no dot.
 */
function normDpe(name: string): string {
  const prefix = name.indexOf(':');
  const bare =
    prefix > 0 && !name.slice(0, prefix).includes('.')
      ? name.slice(prefix + 1)
      : name;
  const config = bare.indexOf(':');
  return (config === -1 ? bare : bare.slice(0, config)).replace(/\.$/, '');
}

/** Split a DPE into bare datapoint and element (`AGV_01.battery` → `['AGV_01', 'battery']`). */
function splitDpe(dpe: string): [dp: string, element: string] {
  const bare = normDpe(dpe);
  const dot = bare.indexOf('.');
  return dot === -1 ? [bare, ''] : [bare.slice(0, dot), bare.slice(dot + 1)];
}

/** Datapoint values arrive raw, array-wrapped or `{ value }`-wrapped — dig out the scalar. */
function scalar(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw.length > 0 ? scalar(raw[0]) : undefined;
  if (raw !== null && typeof raw === 'object' && 'value' in raw) {
    return scalar((raw as { value: unknown }).value);
  }
  return raw;
}

function toNumber(raw: unknown): number {
  const n = Number(scalar(raw));
  return Number.isFinite(n) ? n : 0;
}

function toText(raw: unknown): string {
  const value = scalar(raw);
  return value == null ? '' : String(value);
}

export class AgvStore {
  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();
  private readonly fleet$ = new BehaviorSubject<Agv[]>([]);
  private readonly status$ = new BehaviorSubject<StoreStatus>({
    mode: 'loading',
    detail: ''
  });
  /** Vehicles by id — the mutable projection every datapoint update lands in. */
  private readonly byId = new Map<string, Agv>();
  /** Elements the backend refused to subscribe, after per-element retry. */
  private readonly failed = new Set<string>();
  /** Readable elements the live subscriptions were opened for. */
  private expected = 0;
  /** Emissions actually applied — 0 means live updates never started. */
  private emissions = 0;
  private subscription = new Subscription();
  private demoTimer = 0;

  /** True when serving the in-browser demo fleet instead of live datapoints. */
  get offline(): boolean {
    return this.status$.value.mode === 'demo';
  }

  /** The fleet, re-emitted on every datapoint change. */
  get fleet(): Observable<Agv[]> {
    return this.fleet$.asObservable();
  }

  /** What the fleet on screen is, and why if it is degraded. */
  get status(): Observable<StoreStatus> {
    return this.status$.asObservable();
  }

  /**
   * Discover the fleet, seed it, then follow it live. Resolves once values are
   * on screen; later changes arrive through {@link fleet}.
   */
  async start(): Promise<void> {
    const dps = await this.discover();
    if (dps.length === 0) {
      this.startDemo(
        this.api && this.dpe
          ? `no datapoint of type ${AGV_DP_TYPE} found on the backend`
          : 'WinCC OA services unavailable in this session'
      );
      return;
    }
    for (const dp of dps) this.byId.set(dp, { ...blankAgv(dp), dp });

    const requested = dps.flatMap((dp) =>
      AGV_ELEMENTS.map((element) => `${dp}.${element}`)
    );
    const readable = await this.seed(requested);
    this.publish();

    if (readable.length === 0) {
      this.startDemo(
        `none of the ${requested.length} datapoint elements could be read`
      );
      return;
    }
    if (readable.length < requested.length) {
      console.warn(
        `${LOG_TAG} ${requested.length - readable.length} of ${requested.length} elements are not readable — excluded from the live subscription`
      );
    }
    // Real values are already on screen; anything below only affects refresh.
    this.expected = readable.length;
    this.refreshStatus();
    this.connect(readable);
  }

  /** Release the live subscription / demo timer. */
  stop(): void {
    this.subscription.unsubscribe();
    this.subscription = new Subscription();
    if (this.demoTimer) {
      window.clearInterval(this.demoTimer);
      this.demoTimer = 0;
    }
  }

  /** Bare names of the `AGV_Vehicle` datapoints, sorted; empty when unavailable. */
  private async discover(): Promise<string[]> {
    const dpe = this.dpe;
    if (!dpe) {
      console.warn(
        `${LOG_TAG} WuiDpeService could not be resolved from the container`
      );
      return [];
    }
    try {
      // `listDatapoints(type)` → backend command `etm.model.type.listDps`, the
      // reliable way to enumerate the DPs of a type (unlike dpNames wildcards).
      const names = await firstValueFrom(dpe.listDatapoints(AGV_DP_TYPE));
      return names
        .map((name) => normDpe(name))
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    } catch (error) {
      console.warn(`${LOG_TAG} listDatapoints(${AGV_DP_TYPE}) failed:`, error);
      return [];
    }
  }

  /**
   * One-shot `dpGet` per element: applies the current value and returns the
   * elements the backend actually served. Filtering here is what keeps the
   * all-or-nothing `dpConnect` in {@link connect} from being rejected outright.
   */
  private async seed(dpes: string[]): Promise<string[]> {
    const api = this.api;
    if (!api) {
      console.warn(
        `${LOG_TAG} OaRxJsApi could not be resolved from the container`
      );
      return [];
    }
    const results = await Promise.allSettled(
      dpes.map((dpe) => firstValueFrom(api.dpGet(dpe)))
    );
    const readable: string[] = [];
    for (const [index, dpe] of dpes.entries()) {
      const result = results[index];
      if (result?.status !== 'fulfilled') continue;
      readable.push(dpe);
      const [dp, element] = splitDpe(dpe);
      const agv = this.byId.get(dp);
      if (agv) this.assign(agv, element, result.value);
    }
    return readable;
  }

  /**
   * Follow the readable elements live, ONE SUBSCRIPTION PER VEHICLE.
   *
   * Not one subscription for the whole fleet: the webserver's CTRL bridge builds
   * a `dpConnectUserData` argument list from the name array, and a fleet-wide
   * list overflows it — the backend answers *"Invalid argument in function …
   * WssRequestHandlerBase.ctc Line: 402, dpConnectUserData"* and, because
   * dpConnect is all-or-nothing, every vehicle goes dark at once. Per-vehicle
   * batches stay small (one per element group) and confine any rejection to a
   * single vehicle. Same reasoning as the ampere page, which subscribes per DP.
   */
  private connect(dpes: string[]): void {
    const api = this.api;
    if (!api) return;
    const byVehicle = new Map<string, string[]>();
    for (const dpe of dpes) {
      const [dp] = splitDpe(dpe);
      const group = byVehicle.get(dp);
      if (group) group.push(dpe);
      else byVehicle.set(dp, [dpe]);
    }
    for (const [dp, group] of byVehicle) this.subscribeBatch(api, group, dp);
  }

  /**
   * One isolated `dpConnect`. If a batch is rejected it retries element by
   * element, so a single unsubscribable element cannot freeze a whole vehicle —
   * and the console then names the exact offender.
   */
  private subscribeBatch(api: OaRxJsApi, dpes: string[], label: string): void {
    try {
      this.subscription.add(
        api.dpConnect(dpes, true).subscribe({
          next: (data: DpEmission) => this.apply(data),
          error: (error: unknown) => this.onBatchError(api, dpes, label, error)
        })
      );
    } catch (error) {
      this.onBatchError(api, dpes, label, error);
    }
  }

  /** A rejected batch splits into single-element subscriptions; a rejected element is recorded. */
  private onBatchError(
    api: OaRxJsApi,
    dpes: string[],
    label: string,
    error: unknown
  ): void {
    if (dpes.length > 1) {
      console.warn(
        `${LOG_TAG} batch subscription for ${label} rejected — retrying element by element:`,
        error
      );
      for (const dpe of dpes) this.subscribeBatch(api, [dpe], dpe);
      return;
    }
    console.warn(`${LOG_TAG} no live updates for ${label}:`, error);
    for (const dpe of dpes) this.failed.add(dpe);
    this.refreshStatus();
  }

  /** Fold one emission into the fleet projection and publish. */
  private apply(data: DpEmission): void {
    if (!Array.isArray(data?.dp) || !Array.isArray(data.value)) {
      console.warn(`${LOG_TAG} unexpected dpConnect emission shape:`, data);
      return;
    }
    let touched = false;
    for (const [index, dpe] of data.dp.entries()) {
      const [dp, element] = splitDpe(dpe);
      const agv = this.byId.get(dp);
      if (agv && this.assign(agv, element, data.value[index])) touched = true;
    }
    if (!touched) return;
    this.emissions += 1;
    this.refreshStatus();
    this.publish();
  }

  /** Write one element onto a vehicle. Returns false for an element we don't read. */
  private assign(agv: Agv, element: string, raw: unknown): boolean {
    if (!(AGV_ELEMENTS as readonly string[]).includes(element)) return false;
    const key = element as AgvElement;
    if (key === 'state') {
      agv.state = decodeState(toNumber(raw));
    } else if (NUMERIC_ELEMENTS.has(key)) {
      // Every element in NUMERIC_ELEMENTS is a `number` field on Agv.
      (agv as unknown as Record<string, number>)[key] = toNumber(raw);
    } else {
      (agv as unknown as Record<string, string>)[key] = toText(raw);
    }
    return true;
  }

  /** Emit fresh objects in a fresh array so Lit's dirty check sees the change. */
  private publish(): void {
    this.fleet$.next([...this.byId.values()].map((agv) => ({ ...agv })));
  }

  /**
   * Recompute what the fleet on screen is. Seeded values always stay visible, so
   * a live-subscription problem downgrades the mode and names itself rather than
   * blanking the page or silently falling back to the demo fleet.
   */
  private refreshStatus(): void {
    if (this.status$.value.mode === 'demo') return;
    this.setStatus(this.currentStatus());
  }

  private currentStatus(): StoreStatus {
    const failed = this.failed.size;
    if (this.emissions === 0) {
      return {
        mode: 'seeded',
        detail:
          failed > 0
            ? `the backend rejected all ${failed} of ${this.expected} live subscriptions`
            : 'waiting for the first live update'
      };
    }
    if (failed > 0) {
      return {
        mode: 'partial',
        detail: `${failed} of ${this.expected} elements are not receiving live updates`
      };
    }
    return { mode: 'live', detail: '' };
  }

  /** Publish only on a real change — `apply()` runs on every emission. */
  private setStatus(next: StoreStatus): void {
    const current = this.status$.value;
    if (current.mode === next.mode && current.detail === next.detail) return;
    this.status$.next(next);
  }

  /** Serve the demo fleet, drifted on a timer, and say why we fell back to it. */
  private startDemo(detail: string): void {
    console.warn(`${LOG_TAG} showing the demo fleet — ${detail}`);
    this.status$.next({ mode: 'demo', detail });
    let fleet = DEMO_FLEET.map((agv) => structuredClone(agv));
    this.fleet$.next(fleet);
    this.demoTimer = window.setInterval(() => {
      fleet = driftDemoFleet(fleet);
      this.fleet$.next(fleet);
    }, DEMO_TICK_MS);
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      return null;
    }
  }

  private resolveDpe(): WuiDpeService | null {
    try {
      return container.resolve<WuiDpeService>(WuiDpeService);
    } catch {
      return null;
    }
  }
}
