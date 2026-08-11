// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live datapoint layer of the GIS page: the values shown on the markers and the
 * alarm colour that highlights them.
 *
 * Two rules shape this file.
 *
 * **One subscription per datapoint element.** `dpConnect` fails the WHOLE
 * subscription as soon as any name in its array is invalid (see the oa-rx-js-api
 * README), and a map is precisely where unresolvable names collect: a site is
 * authored before its datapoints exist, a demo binds to `ExampleDP_*` that a
 * production project lacks, an operator mistypes one binding out of eighty. Batched,
 * a single bad name would freeze every value on the map. Isolated, a bad binding is
 * the only thing that stays blank.
 *
 * **The alarm state comes from WinCC OA, not from a threshold in this page.** The
 * marker colour is the DP's own `_alert_hdl.._act_state_color`, so the map agrees
 * with the alarm list and with every other client by construction. A datapoint with
 * no alert config simply errors on that one subscription and stays un-highlighted.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { Subscription } from 'rxjs';
import { container } from 'tsyringe';
import { bareDp } from '../drill.js';
import type { Site } from '../types.js';

/** A live datapoint emission as oa-rx-js-api delivers it. */
interface DpEmission {
  dp: string[];
  value: unknown[];
}

/** What {@link LiveBindings} exposes to the view, rebuilt on every emission. */
export interface LiveState {
  /** Latest value of each bound element, keyed by {@link normDp}. */
  values: ReadonlyMap<string, number | string>;
  /** Active alert colour (CSS) of each bound datapoint, keyed by {@link normDp}. */
  alarmColors: ReadonlyMap<string, string>;
}

/**
 * Normalise a datapoint element name so a live emission matches the bound name:
 * drop a leading `System:` prefix and any trailing config/attribute part
 * (`:_online…`), then lower-case it. WinCC OA echoes names back in a different
 * shape than they were subscribed in, so comparing raw strings misses.
 */
export function normDp(dp: string): string {
  let name = dp.trim();
  const firstColon = name.indexOf(':');
  // A leading `System1:` — but not the `:_config` separator, which follows a dot.
  if (firstColon > 0 && !name.slice(0, firstColon).includes('.'))
    name = name.slice(firstColon + 1);
  const configColon = name.indexOf(':');
  if (configColon !== -1) name = name.slice(0, configColon);
  return name.toLowerCase();
}

/** Subscribable DPE name: a bare datapoint (no element part) needs a trailing dot. */
export function dpeName(dp: string): string {
  const name = dp.trim();
  return name.includes('.') ? name : `${name}.`;
}

/**
 * Coerce a live emission into something displayable: unwrap a `{value}` envelope
 * and map booleans (and the `'true'`/`'false'` strings a bool DPE is sometimes
 * serialised as) to 1/0, so a digital state formats like a number.
 */
export function liveValue(raw: unknown): number | string {
  const unwrapped =
    raw && typeof raw === 'object' && 'value' in raw
      ? (raw as { value: unknown }).value
      : raw;
  if (typeof unwrapped === 'boolean') return unwrapped ? 1 : 0;
  if (typeof unwrapped === 'string') {
    const text = unwrapped.trim().toLowerCase();
    if (text === 'true') return 1;
    if (text === 'false') return 0;
    return unwrapped;
  }
  return typeof unwrapped === 'number' ? unwrapped : Number(unwrapped);
}

/**
 * Map a WinCC OA colour value (`_act_state_color`) to CSS. `{r,g,b}` / `{r,g,b,a}`
 * tuples and `#hex` pass through. A named colour-DB entry cannot be resolved in the
 * browser, so it falls back to the theme's alarm colour — being visibly in alarm in
 * the wrong shade beats not being highlighted at all. Empty ⇒ no alarm.
 */
export function oaColorToCss(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const match = /^\{(\d+),(\d+),(\d+)(?:,(\d+))?\}$/.exec(value);
  if (match) {
    const [, red, green, blue, alpha] = match;
    // WinCC OA expresses the alpha channel 0..255, CSS wants 0..1.
    const OPAQUE = 255;
    return alpha === undefined
      ? `rgb(${red},${green},${blue})`
      : `rgba(${red},${green},${blue},${Number(alpha) / OPAQUE})`;
  }
  if (/^#[\da-f]{3,8}$/i.test(value)) return value;
  return 'var(--theme-color-alarm, #ff2640)';
}

/** Format a reading for display: numbers to their configured precision, else raw. */
export function formatValue(
  value: number | string | undefined,
  decimals: number
): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value)) return '—';
  const MAX_DECIMALS = 6;
  return value.toFixed(Math.min(Math.max(decimals, 0), MAX_DECIMALS));
}

/**
 * Follows everything a site binds to, and tells the view when something changed.
 *
 * `sync(site)` is idempotent: it diffs the set of names against what is already
 * subscribed and only tears the subscriptions down when that set actually changed,
 * so it is safe to call from `updated()` on every render.
 */
export class LiveBindings {
  private readonly api = this.resolveApi();
  private readonly values = new Map<string, number | string>();
  private readonly alarmColors = new Map<string, string>();
  private subscription = new Subscription();
  /** The set of subscribed names, joined — the cheap "did anything change" key. */
  private subscribedKey = '';
  /** Pending coalesced notification (`0` = none scheduled). */
  private frame = 0;

  constructor(
    /**
     * Called when something changed, at most once per animation frame. A site can
     * bind two hundred datapoint elements, and a plant that has just been switched
     * on emits an initial value for every one of them within a few milliseconds —
     * notifying per emission would mean two hundred repaints of the whole map.
     */
    private readonly onChange: () => void
  ) {}

  /** True when there is no backend to read from (the page then shows dashes). */
  get connected(): boolean {
    return this.api !== null;
  }

  /**
   * A snapshot of everything read so far.
   *
   * Copies both maps, and that is the point: the internal maps are mutated in
   * place, so a Lit property bound to them would never see a changed identity and
   * would never repaint. A copy per animation frame over a few hundred entries is
   * far cheaper than the alternatives.
   */
  snapshot(): LiveState {
    return {
      values: new Map(this.values),
      alarmColors: new Map(this.alarmColors)
    };
  }

  /** The latest value of a bound element (`undefined` while nothing has arrived). */
  value(dp: string): number | string | undefined {
    return this.values.get(normDp(dp));
  }

  /**
   * The active alert colour of an asset's primary datapoint (`''` = no alarm).
   * Widened from element to datapoint exactly like {@link alarmDps} keyed it — the
   * alert config lives on the DP, not on the element the asset happens to display.
   */
  alarmColor(dp: string): string {
    if (!dp.trim()) return '';
    return this.alarmColors.get(normDp(bareDp(dp.trim()))) ?? '';
  }

  /**
   * (Re)subscribe to exactly what the page currently needs. Cheap when nothing moved.
   *
   * Values and alarms are asked for separately because the two views need different
   * amounts: a site's map needs every value it displays, while the overview needs
   * only the alarm state of every site — enough for its "in alarm" count, without
   * subscribing to every reading of every site in the project.
   */
  sync(scope: { values: readonly Site[]; alarms: readonly Site[] }): void {
    const values = valueDps(scope.values);
    const alarms = alarmDps(scope.alarms);
    const key = [...values, ...alarms.map((dp) => `!${dp}`)].sort().join('|');
    if (key === this.subscribedKey) return;
    this.subscribedKey = key;
    this.stop();
    if (!this.api) return;
    for (const dp of values) {
      this.subscribeOne(dpeName(dp), (raw) => {
        this.values.set(normDp(dp), liveValue(raw));
      });
    }
    for (const dp of alarms) {
      // `_alert_hdl.._act_state_color` is the alarm framing WinCC OA itself
      // computes. A datapoint without the config just errors here, in isolation.
      this.subscribeOne(
        `${dpeName(dp)}:_alert_hdl.._act_state_color`,
        (raw) => {
          this.alarmColors.set(normDp(dp), oaColorToCss(raw));
        }
      );
    }
  }

  /** Drop every subscription and every value read through them. */
  stop(): void {
    this.subscription.unsubscribe();
    this.subscription = new Subscription();
    this.values.clear();
    this.alarmColors.clear();
  }

  /** Drop the subscriptions for good (the host is being disconnected). */
  dispose(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.stop();
    this.subscribedKey = '';
  }

  /** Coalesce a burst of emissions into a single notification. */
  private notify(): void {
    if (this.frame !== 0) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.onChange();
    });
  }

  /** One isolated dpConnect — a bad name must never break the other bindings. */
  private subscribeOne(dpe: string, apply: (raw: unknown) => void): void {
    if (!this.api) return;
    try {
      this.subscription.add(
        this.api.dpConnect(dpe, true).subscribe({
          next: (emission: DpEmission) => {
            apply(emission.value?.[0]);
            this.notify();
          },
          error: () => {
            // Unknown datapoint, no read right, or no alert config on it: this one
            // binding stays inert and every other one stays live.
          }
        })
      );
    } catch {
      // dpConnect rejected the name outright — same contract as an error emission.
    }
  }

  private resolveApi(): OaRxJsApi | null {
    try {
      return container.resolve<OaRxJsApi>(OaRxJsApi);
    } catch {
      // No backend in the container (embedded host, demo, unit test).
      return null;
    }
  }
}

/** Every datapoint element whose VALUE these sites display, de-duplicated. */
export function valueDps(sites: readonly Site[]): string[] {
  const names = new Set<string>();
  for (const site of sites) {
    for (const asset of site.assets) {
      if (asset.dp.trim()) names.add(asset.dp.trim());
      for (const reading of asset.readings) {
        if (reading.dp.trim()) names.add(reading.dp.trim());
      }
    }
  }
  return [...names];
}

/**
 * Every datapoint whose ALARM STATE these sites display: the assets' primary
 * bindings, widened from element to datapoint — the alert config lives on the DP,
 * so following `Pump01.flow:_alert_hdl` would miss the alarm raised on `Pump01`.
 */
export function alarmDps(sites: readonly Site[]): string[] {
  const names = new Set<string>();
  for (const site of sites) {
    for (const asset of site.assets) {
      const dp = asset.dp.trim();
      if (dp) names.add(bareDp(dp));
    }
  }
  return [...names];
}
