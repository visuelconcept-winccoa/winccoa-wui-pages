// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Product Information Hub connection config (the server-side `ProductInfo_Config`
 * datapoint: `baseUrl` / `apiKey` / `apiVersion`, held by the `productInfo`
 * MSA manager). Mirrors the AI-assistant config flow (`wui-ai-kit/data/ai-store`):
 * read via `OaRxJsApi.dpGet`, write via the PARA REST API (`/api/para/dp/set`,
 * OaRxJsApi being read-only here). The manager creates the DP/type on start; we
 * best-effort ensure it so the config UI works even before then.
 *
 * Security: unlike the AI token field, the **API key is write-only in the UI** —
 * we never read its value back into the browser (only whether one is set, via
 * {@link ProductInfoConfig.hasKey}), and we only overwrite it when the operator
 * types a new one. This keeps the documented "key stays server-side" contract.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';

const CONFIG_DP = 'ProductInfo_Config';
const CONFIG_TYPE = 'ProductInfo_Config';
const DP_SET_URL = '/api/para/dp/set';
const CREATE_TYPE_URL = '/api/para/dptype/create';
const CREATE_DP_URL = '/api/para/dp/create';

export const DEFAULT_BASE_URL = 'https://product-information-hub.siemens.cloud';
export const DEFAULT_API_VERSION = 'v2-earlyaccess';

/** Editable Product Information Hub connection settings. */
export interface ProductInfoConfig {
  baseUrl: string;
  apiVersion: string;
  /** Whether an API key is currently stored (the value itself is never read into the UI). */
  hasKey: boolean;
  /** Remaining-lookup credit meter (decremented server-side, 1 per lookup). */
  credit: number;
}

function resolveApi(): OaRxJsApi | null {
  try {
    return container.resolve<OaRxJsApi>(OaRxJsApi);
  } catch {
    return null;
  }
}

function scalar(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const s = scalar(item);
      if (s) return s;
    }
    return '';
  }
  if (raw && typeof raw === 'object' && 'value' in raw) return scalar((raw as { value: unknown }).value);
  return raw == null ? '' : String(raw);
}

function jsonPost(body: object): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

async function send(url: string, init: RequestInit): Promise<void> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status}`);
}

/** Read the Product Information Hub config (base URL + API version + whether a key is set). */
export async function loadProductInfoConfig(): Promise<ProductInfoConfig> {
  const fallback: ProductInfoConfig = {
    baseUrl: DEFAULT_BASE_URL,
    apiVersion: DEFAULT_API_VERSION,
    hasKey: false,
    credit: 0
  };
  const api = resolveApi();
  if (!api) return fallback;
  try {
    const raw = await firstValueFrom(
      api.dpGet([
        `${CONFIG_DP}.baseUrl`,
        `${CONFIG_DP}.apiVersion`,
        `${CONFIG_DP}.apiKey`,
        `${CONFIG_DP}.credit`
      ])
    );
    const arr = Array.isArray(raw) ? raw : [raw];
    const [baseUrlRaw, apiVersionRaw, apiKeyRaw, creditRaw] = arr;
    return {
      baseUrl: scalar(baseUrlRaw) || fallback.baseUrl,
      apiVersion: scalar(apiVersionRaw) || fallback.apiVersion,
      hasKey: scalar(apiKeyRaw).trim() !== '',
      credit: Number(scalar(creditRaw)) || 0
    };
  } catch {
    return fallback;
  }
}

/**
 * Persist the config to the datapoint (best-effort ensure type/dp first).
 * `apiKey` is written ONLY when `newApiKey` is a non-empty string — passing an
 * empty value leaves the stored key untouched.
 */
export async function saveProductInfoConfig(
  cfg: Pick<ProductInfoConfig, 'baseUrl' | 'apiVersion' | 'credit'>,
  newApiKey: string
): Promise<void> {
  try {
    await fetch(
      CREATE_TYPE_URL,
      jsonPost({
        typeName: CONFIG_TYPE,
        structure: {
          name: CONFIG_TYPE,
          type: 'Struct',
          children: [
            { name: 'apiKey', type: 'String', refName: '' },
            { name: 'baseUrl', type: 'String', refName: '' },
            { name: 'apiVersion', type: 'String', refName: '' },
            { name: 'credit', type: 'String', refName: '' }
          ]
        }
      })
    );
    await fetch(CREATE_DP_URL, jsonPost({ dpName: CONFIG_DP, dpType: CONFIG_TYPE }));
  } catch {
    // type/dp likely already exist (created by the manager) — proceed to set.
  }
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.baseUrl`, value: cfg.baseUrl }));
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.apiVersion`, value: cfg.apiVersion }));
  await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.credit`, value: String(Math.max(0, Math.trunc(cfg.credit))) }));
  const key = newApiKey.trim();
  if (key !== '') {
    await send(DP_SET_URL, jsonPost({ dpeName: `${CONFIG_DP}.apiKey`, value: key }));
  }
}
