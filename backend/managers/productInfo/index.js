'use strict';

/**
 * Product Information — WinCC OA JavaScript Manager hosting an MSA (Manager
 * Service API) vRPC service that proxies lookups to the Siemens Product
 * Information Hub (obsolescence + delivery by MLFB / product number).
 *
 * Architecture (mirrors the aiAssistant manager):
 *   WebUI (browser) ──HTTP /api/product-info/...──▶ customer-webserver (vRPC stub)
 *                                                       │  MSA vRPC
 *                                                       ▼
 *                                   this manager: service "ProductInfo"
 *                                                       │  fetch()
 *                                                       ▼
 *                       https://product-information-hub.siemens.cloud
 *
 * The browser cannot speak vRPC and the API key must stay server-side, so the
 * webserver bridges HTTP→vRPC and this manager holds the key. The key, base URL
 * and API version live in the `ProductInfo_Config` datapoint (seeded on first
 * start), so they can be changed without editing this file.
 *
 * Register in config/progs, e.g.:
 *   node | always | 30 | 3 | 5 |productInfo/index.js
 *
 * The service exposes one unary method:
 *   Lookup(Variant<string JSON {productNumber, withDelivery?}>)
 *      -> Variant<string JSON {obsolescence, delivery, errors}>
 *
 * After editing this file, restart the productInfo manager.
 */
const { WinccoaManager, WinccoaDpTypeNode, Vrpc } = require('winccoa-manager');

const winccoa = new WinccoaManager();

const SERVICE_NAME = 'ProductInfo';
const CONFIG_TYPE = 'ProductInfo_Config';
const CONFIG_DP = 'ProductInfo_Config';
const SYS = 'System1:';
const ELEM = { Struct: 1, String: 25 };
const HTTP_OK = 200;
const HTTP_UNAUTHORIZED = 401;
const ERR_PREVIEW = 300;

/** Defaults seeded into the config DP on first start (server-side only). */
const DEFAULT_BASE_URL = 'https://product-information-hub.siemens.cloud';
const DEFAULT_API_VERSION = 'v2-earlyaccess';
const DEFAULT_API_KEY = process.env.PRODUCT_INFO_API_KEY || ''; // scrubbed for distribution — set via ProductInfo_Config DP or env

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[ProductInfo] ${msg}`);
}

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

function vrpcError(code, message) {
  return new Vrpc.Error(new Vrpc.Status(Vrpc.StatusCode[code], message));
}

// ---- config DP -------------------------------------------------------------

async function ensureConfig() {
  const root = new WinccoaDpTypeNode(CONFIG_TYPE, ELEM.Struct, '', [
    new WinccoaDpTypeNode('apiKey', ELEM.String),
    new WinccoaDpTypeNode('baseUrl', ELEM.String),
    new WinccoaDpTypeNode('apiVersion', ELEM.String)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
    log(`Type de données créé : ${CONFIG_TYPE}`);
  } catch {
    try {
      await winccoa.dpTypeChange(root);
    } catch {
      // ignore — type already matches
    }
  }
  if (!winccoa.dpExists(`${CONFIG_DP}.apiKey`)) {
    try {
      await winccoa.dpCreate(CONFIG_DP, CONFIG_TYPE);
    } catch (e) {
      log(`Échec création DP config : ${e}`);
    }
  }
  // Seed defaults for any EMPTY field (raw read — don't mask with defaults here),
  // so the key/url/version are visible & editable in the config DP.
  try {
    const raw = await winccoa.dpGet([
      `${SYS}${CONFIG_DP}.apiKey`,
      `${SYS}${CONFIG_DP}.baseUrl`,
      `${SYS}${CONFIG_DP}.apiVersion`
    ]);
    const arr = Array.isArray(raw) ? raw : [raw];
    if (!extractString(arr[0])) await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.apiKey`, DEFAULT_API_KEY);
    if (!extractString(arr[1])) await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.baseUrl`, DEFAULT_BASE_URL);
    if (!extractString(arr[2])) await winccoa.dpSetWait(`${SYS}${CONFIG_DP}.apiVersion`, DEFAULT_API_VERSION);
  } catch (e) {
    log(`Échec initialisation config : ${e}`);
  }
}

async function readConfig() {
  try {
    const raw = await winccoa.dpGet([
      `${SYS}${CONFIG_DP}.apiKey`,
      `${SYS}${CONFIG_DP}.baseUrl`,
      `${SYS}${CONFIG_DP}.apiVersion`
    ]);
    const arr = Array.isArray(raw) ? raw : [raw];
    return {
      apiKey: extractString(arr[0]) || DEFAULT_API_KEY,
      baseUrl: extractString(arr[1]) || DEFAULT_BASE_URL,
      apiVersion: extractString(arr[2]) || DEFAULT_API_VERSION
    };
  } catch {
    return { apiKey: DEFAULT_API_KEY, baseUrl: DEFAULT_BASE_URL, apiVersion: DEFAULT_API_VERSION };
  }
}

// ---- Siemens Product Information Hub (raw HTTP) ----------------------------

/**
 * GET one product resource. Returns { ok, status, data } — never throws on HTTP
 * status, so a 404/403 on one resource still lets the other one through.
 */
async function getResource(cfg, productNumber, resource) {
  const url = `${cfg.baseUrl}/api/products/${encodeURIComponent(productNumber)}/${resource}`;
  // NB: do NOT send an `Api-Version` header on the product routes — any value
  // makes the Siemens gateway return 404; omitting it uses the working default.
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: cfg.apiKey, Accept: 'application/json' }
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.status === HTTP_OK, status: res.status, data };
}

/** Human-readable error for a non-200 resource response. */
function resourceError(resource, result) {
  const msg = result.data?.message || result.data?.error || `HTTP ${result.status}`;
  return `${resource}: ${String(msg).slice(0, ERR_PREVIEW)}`;
}

// ---- MSA vRPC service ------------------------------------------------------

class ProductInfoService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('Lookup', (ctx, request) => this.lookup(ctx, request));
  }

  async lookup(serverContext, request) {
    serverContext.cancelSignal.throwIfAborted();
    if (!request.isString() || request.isNull()) {
      throw vrpcError('InvalidArgument', 'La requête doit être une chaîne JSON');
    }
    let req;
    try {
      req = JSON.parse(request.getString());
    } catch {
      throw vrpcError('InvalidArgument', 'JSON de requête invalide');
    }
    const productNumber = String(req.productNumber ?? '').trim();
    if (!productNumber) throw vrpcError('InvalidArgument', 'productNumber (MLFB) requis');
    const withDelivery = req.withDelivery !== false;

    const cfg = await readConfig();
    if (!cfg.apiKey) throw vrpcError('FailedPrecondition', 'Aucune clé API configurée (ProductInfo_Config.apiKey)');

    log(`Lookup ${productNumber} (delivery=${withDelivery})`);
    const out = { obsolescence: null, delivery: null, errors: {} };
    try {
      const obs = await getResource(cfg, productNumber, 'obsolescence');
      if (obs.status === HTTP_UNAUTHORIZED) {
        throw vrpcError('Unauthenticated', 'Clé API manquante/invalide (401)');
      }
      if (obs.ok) out.obsolescence = obs.data;
      else out.errors.obsolescence = resourceError('obsolescence', obs);
    } catch (e) {
      if (e instanceof Vrpc.Error) throw e;
      out.errors.obsolescence = `obsolescence: ${e.message}`;
    }
    if (withDelivery) {
      try {
        const del = await getResource(cfg, productNumber, 'delivery');
        if (del.ok) out.delivery = del.data;
        else out.errors.delivery = resourceError('delivery', del);
      } catch (e) {
        out.errors.delivery = `delivery: ${e.message}`;
      }
    }
    return Vrpc.Variant.createString(JSON.stringify(out));
  }
}

async function run() {
  log('Démarrage du service Product Information (MSA vRPC)…');
  await ensureConfig();
  const container = new Vrpc.ServiceContainer();
  container.registerService(new ProductInfoService(), new Vrpc.ServiceOptions());
  try {
    await container.startAllServices();
    log(`Service "${SERVICE_NAME}" démarré.`);
  } catch (e) {
    log(`Échec du démarrage du service : ${e}`);
  }
}

run().catch((e) => log(`Erreur fatale : ${e}`));
