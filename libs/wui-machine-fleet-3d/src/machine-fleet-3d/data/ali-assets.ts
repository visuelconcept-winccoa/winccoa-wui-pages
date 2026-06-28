// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Read-only access to the Asset Lifecycle Intelligence (ALI) inventory.
 *
 * A fleet machine can be linked to one ALI asset (see `MachineDef.aliAssetId`)
 * to surface that asset's composite obsolescence/risk score in the 3D bubble and
 * the detail popup. ALI persists one datapoint per asset (type
 * `AssetLifecycle_Asset`, a Struct with String elements `name` + `json`); we
 * read those datapoints directly — this page is a *consumer*, never the owner,
 * so it never creates the type. When ALI is not installed (type absent) or the
 * backend is unreachable, {@link AliAssetReader.list} resolves to an empty list.
 *
 * The composite score is recomputed here with the SAME weighted model as the ALI
 * page (`wui-asset-lifecycle-intelligence/.../risk.ts`). Kept self-contained on
 * purpose: this page vendors its own kit and must not depend on the ALI page
 * bundle. If the ALI scoring model changes, mirror it here.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';

/** DP type + name prefix ALI uses for its per-asset datapoints. */
const ASSET_TYPE = 'AssetLifecycle_Asset';
const ASSET_PREFIX = 'AssetLifecycle_';
const SCORE_MAX = 100;

/** Resolved composite risk of one asset (mirror of ALI's RiskResult, trimmed). */
export interface AliRisk {
  /** Composite score, rounded, in [0,100]. */
  score: number;
  /** French risk level label ("Faible" / "Modéré" / "Élevé" / "Critique"). */
  label: string;
  /** Colour for the risk band (`#RRGGBB`). */
  color: string;
}

/** A selectable ALI asset (identity + resolved composite risk). */
export interface AliAssetInfo {
  /** Asset id (DP name minus the `AssetLifecycle_` prefix). */
  id: string;
  name: string;
  mlfb: string;
  area: string;
  risk: AliRisk;
}

/** Risk-input subset of the ALI `Asset` shape needed to score it. */
interface AssetRiskInputs {
  phase?: string;
  firmware?: string;
  criticality?: string;
  supply?: string;
  vuln?: string;
  operatingHours?: number;
  mtbfHours?: number;
}

/** Composite-model component weights (sum = 1.0) — mirror of ALI's WEIGHTS. */
const WEIGHTS = { obsolescence: 0.25, firmware: 0.2, criticality: 0.2, supply: 0.15, vuln: 0.1, age: 0.1 };

const OBSOLESCENCE_SCORES: Record<string, number> = { PM300: 10, PM400: 40, PM410: 70, PM490: 90, PM500: 100 };
/** Legacy phase codes map (by meaning) onto the current phases — as ALI does. */
const LEGACY_PHASES: Record<string, string> = { PM100: 'PM300', PM200: 'PM300' };
const FIRMWARE_SCORES: Record<string, number> = { upToDate: 0, minorBehind: 30, majorOrCve: 80 };
const CRITICALITY_SCORES: Record<string, number> = { low: 10, medium: 40, high: 70, critical: 100 };
const SUPPLY_SCORES: Record<string, number> = { inStock: 0, lead4to12: 40, over12OrOos: 90 };
const VULN_SCORES: Record<string, number> = { none: 0, low: 30, medium: 60, high: 100 };

/** Risk bands (level → French label + colour) — mirror of ALI's RISK_BANDS. */
const RISK_BANDS: { max: number; label: string; color: string }[] = [
  { max: 25, label: 'Faible', color: '#10b981' },
  { max: 50, label: 'Modéré', color: '#f59e0b' },
  { max: 75, label: 'Élevé', color: '#f97316' },
  { max: SCORE_MAX, label: 'Critique', color: '#ef4444' }
];

function lookup(table: Record<string, number>, key: string | undefined, fallback = 0): number {
  return key != null && key in table ? table[key] : fallback;
}

/** Operating-hours wear: hours / MTBF as a percentage, clamped to [0,100]. */
function ageScore(operatingHours: number, mtbfHours: number): number {
  if (mtbfHours <= 0) return 0;
  return Math.min(SCORE_MAX, Math.round((operatingHours / mtbfHours) * SCORE_MAX));
}

/** Compute the composite risk (score + band) for an asset's risk inputs. */
export function computeAliRisk(a: AssetRiskInputs): AliRisk {
  const phase = a.phase != null && a.phase in OBSOLESCENCE_SCORES ? a.phase : (LEGACY_PHASES[a.phase ?? ''] ?? 'PM300');
  const weighted =
    lookup(OBSOLESCENCE_SCORES, phase, OBSOLESCENCE_SCORES.PM300) * WEIGHTS.obsolescence +
    lookup(FIRMWARE_SCORES, a.firmware) * WEIGHTS.firmware +
    lookup(CRITICALITY_SCORES, a.criticality, CRITICALITY_SCORES.medium) * WEIGHTS.criticality +
    lookup(SUPPLY_SCORES, a.supply) * WEIGHTS.supply +
    lookup(VULN_SCORES, a.vuln) * WEIGHTS.vuln +
    ageScore(Number(a.operatingHours) || 0, Number(a.mtbfHours) || 0) * WEIGHTS.age;
  const score = Math.min(SCORE_MAX, Math.max(0, Math.round(weighted)));
  const band = RISK_BANDS.find((b) => score <= b.max);
  return { score, label: band?.label ?? 'Critique', color: band?.color ?? '#ef4444' };
}

export class AliAssetReader {
  private readonly api = this.resolveApi();
  private readonly dpe = this.resolveDpe();

  /** List the managed ALI assets (empty when ALI is absent / backend offline). */
  async list(): Promise<AliAssetInfo[]> {
    const api = this.api;
    const dpe = this.dpe;
    if (!api || !dpe) return [];
    let names: string[];
    try {
      // listDatapoints on a missing type yields an empty list / throws — either
      // way we surface no assets, and we never create the type (read-only).
      names = await firstValueFrom(dpe.listDatapoints(ASSET_TYPE));
    } catch {
      return [];
    }
    const out: AliAssetInfo[] = [];
    for (const dp of names) {
      // eslint-disable-next-line no-await-in-loop -- a modest inventory, sequential is fine
      const info = await this.read(dp);
      if (info) out.push(info);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  private async read(dp: string): Promise<AliAssetInfo | undefined> {
    const api = this.api;
    if (!api) return undefined;
    try {
      const raw = await firstValueFrom(api.dpGet(`${dp}.json`));
      const json = extractJsonString(raw);
      if (!json) return undefined;
      const asset = JSON.parse(json) as AssetRiskInputs & { name?: string; mlfb?: string; area?: string };
      const bare = dp.includes(':') ? dp.slice(dp.indexOf(':') + 1) : dp;
      const id = bare.startsWith(ASSET_PREFIX) ? bare.slice(ASSET_PREFIX.length) : bare;
      return {
        id,
        name: asset.name || bare,
        mlfb: asset.mlfb ?? '',
        area: asset.area ?? '',
        risk: computeAliRisk(asset)
      };
    } catch {
      return undefined;
    }
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

/** dpGet's shape varies (raw string, [string], or {value:[...]}); dig for a JSON object string. */
function extractJsonString(raw: unknown): string | undefined {
  if (typeof raw === 'string') {
    const s = raw.trim();
    return s.startsWith('{') ? s : undefined;
  }
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const found = extractJsonString(item);
      if (found) return found;
    }
    return undefined;
  }
  if (raw && typeof raw === 'object') {
    return extractJsonString((raw as { value?: unknown }).value);
  }
  return undefined;
}
