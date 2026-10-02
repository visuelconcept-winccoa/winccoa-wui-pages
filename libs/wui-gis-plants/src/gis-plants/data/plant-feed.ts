// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Live feed of the plants: which plants the sites declare, and every operating value they
 * are bound to. Alarms are out of this first version (see `plants.ts`).
 *
 * **The plants come from the `GIS_Site` datapoints**, read the way the GIS page's own store
 * reads them (`WuiDpeService.listDatapoints('GIS_Site')`, then `dpGet` of each `.json`). Each
 * asset carries its readings bound BY NAME to a datapoint, so the page follows exactly what
 * the site binds. Two earlier versions guessed the datapoints from the simulator's naming
 * rule instead — a `dpQueryConnect`, then a `dpNames` over `GisSim_*` — and both left the
 * page empty on the WebUI connection while the map beside it was live. The sites are
 * re-read every minute (the simulator's own pace), so a plant added on the map appears
 * without a reload.
 *
 * **Not through the GIS page's store**: listing through it can create the `GIS_Site` type via
 * `/api/para`, a write this read-only page has no business making.
 *
 * **One subscription per element, isolated** — the GIS markers' rule. `dpConnect` fails a
 * whole batch as soon as one name is invalid (see the oa-rx-js-api README), so each element
 * is its own subscription and a missing one leaves only its own cell blank.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { Subscription, firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import {
  PLANT_ELEMENTS,
  cellNumber,
  plantBindings,
  type Plant,
  type PlantBinding,
  type PlantElement
} from './plants.js';

/**
 * Minimum time between two notifications to the view. The simulator writes every value once
 * a second, and each element emits on its own: two hundred emissions a second, which is two
 * hundred re-sorts if the view followed each one. Four repaints a second keeps the cards live
 * and lets a reorder finish its motion before the next one starts.
 */
const NOTIFY_MS = 250;
/** How often the sites are re-read (the simulator's own site re-read period). */
const REFRESH_MS = 60_000;
/** DP type of the site records. */
const SITE_TYPE = 'GIS_Site';
/** Prefix of a site datapoint — the GIS store names its records `GIS_<siteId>`. */
const SITE_PREFIX = 'GIS_';

/** Why the feed has nothing to show, when it has nothing to show. */
export type FeedStatus = 'live' | 'offline' | 'failed';

/** A live datapoint emission as oa-rx-js-api delivers it. */
interface DpEmission {
  value?: unknown[];
}

interface Followed {
  binding: PlantBinding;
  values: Partial<Record<PlantElement, number>>;
}

export class PlantFeed {
  private readonly api = resolveApi();
  private readonly dpe = resolveDpe();
  /** Followed plants, keyed by their `puissance` element (one plant, one card). */
  private readonly followed = new Map<string, Followed>();
  private subscription = new Subscription();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  /** The sites could not be listed at all. */
  private sitesFailed = false;

  constructor(private readonly onChange: () => void) {}

  get status(): FeedStatus {
    if (!this.api || !this.dpe) return 'offline';
    return this.sitesFailed ? 'failed' : 'live';
  }

  /** Plants the sites declare, whether or not their values have arrived. */
  get discovered(): number {
    return this.followed.size;
  }

  /** Read the sites and subscribe. Idempotent: a second call restarts cleanly. */
  start(): void {
    this.stop();
    const { api, dpe } = this;
    if (!api || !dpe) return;
    void this.refresh(api, dpe);
    this.refreshTimer = setInterval(
      () => void this.refresh(api, dpe),
      REFRESH_MS
    );
  }

  stop(): void {
    this.subscription.unsubscribe();
    this.subscription = new Subscription();
    if (this.timer !== undefined) clearTimeout(this.timer);
    if (this.refreshTimer !== undefined) clearInterval(this.refreshTimer);
    this.timer = undefined;
    this.refreshTimer = undefined;
    this.followed.clear();
    this.sitesFailed = false;
  }

  /**
   * Every plant whose output has arrived, unordered (the view ranks them). One still waiting
   * for its output is held back rather than ranked as a 0 MW plant for a fraction of a second.
   */
  plants(): Plant[] {
    const out: Plant[] = [];
    for (const { binding, values } of this.followed.values()) {
      if (values.puissance === undefined) continue;
      out.push({
        stem: binding.key,
        name: binding.name,
        siteId: binding.siteId,
        siteName: binding.siteName,
        values: { ...values }
      });
    }
    return out;
  }

  /** Re-read every site and follow the plants not followed yet. */
  private async refresh(api: OaRxJsApi, dpe: WuiDpeService): Promise<void> {
    let sites: string[];
    try {
      const names = await firstValueFrom(dpe.listDatapoints(SITE_TYPE));
      sites = (names as unknown[]).map(String);
    } catch {
      this.sitesFailed = true;
      this.schedule();
      return;
    }
    this.sitesFailed = false;
    for (const site of sites) {
      // eslint-disable-next-line no-await-in-loop -- a handful of sites, one read each
      const raw = await readJson(api, bareDp(site));
      for (const binding of plantBindings(raw, siteIdFromDp(site))) {
        const key = binding.dps.puissance ?? binding.key;
        // The same plant drawn on two sites is one plant: the first site keeps it.
        if (!this.followed.has(key)) this.follow(api, key, binding);
      }
    }
    this.schedule();
  }

  private follow(api: OaRxJsApi, key: string, binding: PlantBinding): void {
    const values: Partial<Record<PlantElement, number>> = {};
    this.followed.set(key, { binding, values });
    for (const element of PLANT_ELEMENTS) {
      const dp = binding.dps[element];
      if (!dp) continue;
      this.subscribeOne(api, dp, (raw) => {
        const value = cellNumber(unwrap(raw));
        if (value === undefined) delete values[element];
        else values[element] = value;
      });
    }
  }

  /** One isolated dpConnect — a bad name must never break the other bindings. */
  private subscribeOne(
    api: OaRxJsApi,
    dpe: string,
    apply: (raw: unknown) => void
  ): void {
    try {
      this.subscription.add(
        api.dpConnect(dpe, true).subscribe({
          next: (emission: DpEmission) => {
            apply(emission.value?.[0]);
            this.schedule();
          },
          error: () => {
            // Unknown element or no read right: this cell stays blank.
          }
        })
      );
    } catch {
      // dpConnect rejected the name outright — same contract as an error emission.
    }
  }

  private schedule(): void {
    if (this.timer !== undefined) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onChange();
    }, NOTIFY_MS);
  }
}

function resolveApi(): OaRxJsApi | null {
  try {
    return container.resolve<OaRxJsApi>(OaRxJsApi);
  } catch {
    return null;
  }
}

function resolveDpe(): WuiDpeService | null {
  try {
    return container.resolve<WuiDpeService>(WuiDpeService);
  } catch {
    return null;
  }
}

/** `System1:GIS_x.` → `System1:GIS_x` (the `.json` element is appended to it). */
function bareDp(dp: string): string {
  return dp.trim().replace(/\.$/, '');
}

/** Site id of a `GIS_Site` datapoint: its name without the system and the `GIS_` prefix. */
function siteIdFromDp(dp: string): string {
  const bare = bareDp(dp);
  const name = bare.includes(':') ? bare.slice(bare.indexOf(':') + 1) : bare;
  return name.startsWith(SITE_PREFIX) ? name.slice(SITE_PREFIX.length) : name;
}

/** The site's JSON, `''` when it cannot be read. */
async function readJson(api: OaRxJsApi, dp: string): Promise<string> {
  try {
    return jsonString(await firstValueFrom(api.dpGet(`${dp}.json`)));
  } catch {
    return '';
  }
}

/** Unwrap a `{value}` envelope, as some emissions carry one. */
function unwrap(raw: unknown): unknown {
  return raw && typeof raw === 'object' && 'value' in raw
    ? (raw as { value: unknown }).value
    : raw;
}

/** The first JSON object string inside a `dpGet` answer, whatever it is wrapped in. */
function jsonString(raw: unknown): string {
  if (typeof raw === 'string') return raw.trim().startsWith('{') ? raw : '';
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = jsonString(item);
      if (found) return found;
    }
    return '';
  }
  if (raw && typeof raw === 'object')
    return jsonString(Object.values(raw as Record<string, unknown>));
  return '';
}
