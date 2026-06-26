#!/usr/bin/env node
/**
 * Asset Lifecycle Intelligence — dedicated MCP server (WinCC OA JS manager).
 *
 * Exposes ALI-specific tools over Streamable-HTTP MCP, reading the
 * `AssetLifecycle_Asset` datapoints and computing the same composite risk scores
 * as the page (see `ali-core.js`). Read/analysis + Siemens lookup + write tools.
 *
 * Config via env (see .env.example):
 *   ALI_MCP_PORT   (default 3100)   ALI_MCP_HOST (default 0.0.0.0)
 *   ALI_MCP_TOKEN  (optional Bearer token; if unset, auth is disabled)
 *
 * Register in config/progs:  node | always | 30 | 2 | 2 |aliMcp/index.js
 * Deps (npm install in the deployed dir): @modelcontextprotocol/sdk, zod.
 * After editing, restart the aliMcp manager.
 */
import http from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { WinccoaManager, WinccoaDpTypeNode } from 'winccoa-manager';
import {
  readAssets,
  withRisk,
  computeRisk,
  fleetSummary,
  topRisks,
  groupScores,
  buildTree,
  obsolescenceReport,
  searchAssets,
  createAsset,
  updateAsset,
  deleteAsset
} from './ali-core.js';

const winccoa = new WinccoaManager();
const PORT = Number(process.env.ALI_MCP_PORT) || 3100;
const HOST = process.env.ALI_MCP_HOST || '0.0.0.0';
const TOKEN = process.env.ALI_MCP_TOKEN || '';
const HTTP_OK = 200;
const SIEMENS_DEFAULT_URL = 'https://product-information-hub.siemens.cloud';
const LEAD_IN_STOCK_MAX_DAYS = 14;
const LEAD_MEDIUM_MAX_DAYS = 84;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[aliMcp] ${msg}`);
}

function ok(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}
function fail(message) {
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

function scalar(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

// ---- Siemens Product Information Hub (reads the shared ProductInfo_Config) --
async function readPiConfig() {
  try {
    const raw = await winccoa.dpGet(['System1:ProductInfo_Config.apiKey', 'System1:ProductInfo_Config.baseUrl']);
    const a = Array.isArray(raw) ? raw : [raw];
    return { apiKey: scalar(a[0]), baseUrl: scalar(a[1]) || SIEMENS_DEFAULT_URL };
  } catch {
    return { apiKey: '', baseUrl: SIEMENS_DEFAULT_URL };
  }
}
async function siemensGet(cfg, mlfb, resource) {
  const url = `${cfg.baseUrl}/api/products/${encodeURIComponent(mlfb)}/${resource}`;
  const res = await fetch(url, { headers: { Authorization: cfg.apiKey, Accept: 'application/json' } });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: res.status === HTTP_OK, status: res.status, data };
}
async function lookupMlfb(mlfb, withDelivery) {
  const cfg = await readPiConfig();
  if (!cfg.apiKey) throw new Error('No API key configured (ProductInfo_Config.apiKey)');
  const out = { obsolescence: null, delivery: null, errors: {} };
  const obs = await siemensGet(cfg, mlfb, 'obsolescence');
  if (obs.ok) out.obsolescence = obs.data;
  else out.errors.obsolescence = obs.data?.message || obs.data?.error || `HTTP ${obs.status}`;
  if (withDelivery) {
    const del = await siemensGet(cfg, mlfb, 'delivery');
    if (del.ok) out.delivery = del.data;
    else out.errors.delivery = del.data?.message || del.data?.error || `HTTP ${del.status}`;
  }
  return out;
}
function isPast(iso) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return !Number.isNaN(t) && t <= Date.now();
}
function patchFromLookup(result) {
  const patch = {};
  const obs = result.obsolescence;
  if (obs) {
    if (isPast(obs.productDiscontinuation)) patch.phase = 'PM490';
    else if (isPast(obs.productCancellation)) patch.phase = 'PM410';
    else if (isPast(obs.phaseOutAnnouncement)) patch.phase = 'PM400';
    else if (obs.purchasabilityStatus === 'NOT_PURCHASABLE') patch.phase = 'PM490';
    else if (obs.purchasabilityStatus && obs.purchasabilityStatus !== 'PURCHASABLE') patch.phase = 'PM410';
    else patch.phase = 'PM300';
    const succ = obs.successor?.productNumber || obs.substitute?.productNumber;
    if (succ) patch.successor = succ;
    if (obs.supportUrl) patch.supportUrl = obs.supportUrl;
  }
  const days = result.delivery?.deliveryTimes?.newPart;
  if (result.delivery) {
    patch.supply = days == null ? 'over12OrOos' : days <= LEAD_IN_STOCK_MAX_DAYS ? 'inStock' : days <= LEAD_MEDIUM_MAX_DAYS ? 'lead4to12' : 'over12OrOos';
  }
  return patch;
}

// ---- MCP server + tools -----------------------------------------------------
function buildServer() {
  const server = new McpServer({ name: 'Asset Lifecycle Intelligence', version: '1.0.0' });

  server.tool(
    'ali_list_assets',
    'List managed ALI assets (one MLFB each) with their computed composite risk score and level. Optional filters narrow the result.',
    {
      area: z.string().optional(),
      assetGroup: z.string().optional(),
      phase: z.enum(['PM300', 'PM400', 'PM410', 'PM490', 'PM500']).optional(),
      level: z.enum(['low', 'moderate', 'high', 'critical']).optional(),
      source: z.enum(['tia', 'csv', 'manual']).optional(),
      minScore: z.number().min(0).max(100).optional()
    },
    async (f) => {
      try {
        let rows = (await readAssets(winccoa)).map(withRisk);
        if (f.area) rows = rows.filter((r) => (r.area || '').toLowerCase() === f.area.toLowerCase());
        if (f.assetGroup) rows = rows.filter((r) => (r.assetGroup || '').toLowerCase() === f.assetGroup.toLowerCase());
        if (f.phase) rows = rows.filter((r) => r.phase === f.phase);
        if (f.level) rows = rows.filter((r) => r.level === f.level);
        if (f.source) rows = rows.filter((r) => r.source === f.source);
        if (typeof f.minScore === 'number') rows = rows.filter((r) => r.score >= f.minScore);
        rows.sort((a, b) => b.score - a.score);
        return ok({ count: rows.length, assets: rows });
      } catch (e) {
        return fail(String(e.message || e));
      }
    }
  );

  server.tool('ali_get_asset', 'Get the full record and per-component risk breakdown of one asset by id.', { id: z.string() }, async ({ id }) => {
    try {
      const asset = (await readAssets(winccoa)).find((x) => x.id === id);
      if (!asset) return fail(`asset not found: ${id}`);
      return ok({ asset, risk: computeRisk(asset) });
    } catch (e) {
      return fail(String(e.message || e));
    }
  });

  server.tool('ali_fleet_summary', 'Fleet KPIs: total assets, average score, counts per risk level, lifecycle phase, workshop area and source.', {}, async () => {
    try {
      return ok(fleetSummary(await readAssets(winccoa)));
    } catch (e) {
      return fail(String(e.message || e));
    }
  });

  server.tool('ali_top_risks', 'Top-N assets by composite risk score (descending), each with its dominant risk driver.', { limit: z.number().min(1).max(100).optional() }, async ({ limit }) => {
    try {
      return ok({ top: topRisks(await readAssets(winccoa), limit ?? 10) });
    } catch (e) {
      return fail(String(e.message || e));
    }
  });

  server.tool('ali_asset_tree', 'Hierarchical Workshop → Asset(group) → Station → MLFB tree; each grouping node aggregates the SUM of underlying MLFB scores plus the worst descendant level.', {}, async () => {
    try {
      return ok({ tree: buildTree(await readAssets(winccoa)) });
    } catch (e) {
      return fail(String(e.message || e));
    }
  });

  server.tool('ali_group_scores', 'Per logical asset (assetGroup) aggregated score = SUM of its MLFB scores, with count and worst level, ranked descending.', {}, async () => {
    try {
      return ok({ groups: groupScores(await readAssets(winccoa)) });
    } catch (e) {
      return fail(String(e.message || e));
    }
  });

  server.tool('ali_obsolescence_report', 'Assets grouped by Siemens lifecycle phase (PM300→PM500), the end-of-life set (PM490/PM500) and how many have a successor recorded.', {}, async () => {
    try {
      return ok(obsolescenceReport(await readAssets(winccoa)));
    } catch (e) {
      return fail(String(e.message || e));
    }
  });

  server.tool('ali_search', 'Free-text search across name / MLFB / station / area / assetGroup / notes; returns matches with their risk.', { query: z.string() }, async ({ query }) => {
    try {
      return ok({ matches: searchAssets(await readAssets(winccoa), query) });
    } catch (e) {
      return fail(String(e.message || e));
    }
  });

  server.tool(
    'ali_lookup_mlfb',
    'Cross-reference one MLFB with the Siemens Product Information Hub (obsolescence + optional delivery). Reads the server-side API key from ProductInfo_Config.',
    { mlfb: z.string(), withDelivery: z.boolean().optional() },
    async ({ mlfb, withDelivery }) => {
      try {
        return ok(await lookupMlfb(mlfb, withDelivery !== false));
      } catch (e) {
        return fail(String(e.message || e));
      }
    }
  );

  server.tool(
    'ali_refresh_obsolescence',
    'Bulk cross-reference every UNIQUE MLFB with Siemens and compute the proposed field updates (phase/supply/successor/supportUrl) per asset. With apply=true, persists the updates; otherwise returns a dry-run proposal.',
    { apply: z.boolean().optional() },
    async ({ apply }) => {
      try {
        const assets = await readAssets(winccoa);
        const mlfbs = [...new Set(assets.map((a) => (a.mlfb || '').trim()).filter(Boolean))];
        const results = new Map();
        for (const mlfb of mlfbs) {
          try {
            results.set(mlfb, await lookupMlfb(mlfb, true));
          } catch (e) {
            results.set(mlfb, { obsolescence: null, delivery: null, errors: { obsolescence: String(e.message || e) } });
          }
        }
        const proposals = [];
        for (const asset of assets) {
          const key = (asset.mlfb || '').trim();
          const r = key ? results.get(key) : undefined;
          if (!r) continue;
          const patch = patchFromLookup(r);
          if (Object.keys(patch).length === 0) continue;
          proposals.push({ id: asset.id, name: asset.name, mlfb: asset.mlfb, patch });
        }
        let applied = 0;
        if (apply) {
          for (const p of proposals) {
            await updateAsset(winccoa, assets, p.id, p.patch);
            applied += 1;
          }
        }
        return ok({ uniqueMlfbs: mlfbs.length, proposals, applied, dryRun: !apply });
      } catch (e) {
        return fail(String(e.message || e));
      }
    }
  );

  server.tool(
    'ali_create_asset',
    'Create a managed asset (one MLFB). At least name and mlfb are recommended; risk inputs default to a low-risk baseline.',
    {
      name: z.string(),
      mlfb: z.string().optional(),
      station: z.string().optional(),
      ip: z.string().optional(),
      area: z.string().optional(),
      assetGroup: z.string().optional(),
      firmwareField: z.string().optional(),
      firmwareAvail: z.string().optional(),
      successor: z.string().optional(),
      phase: z.enum(['PM300', 'PM400', 'PM410', 'PM490', 'PM500']).optional(),
      firmware: z.enum(['upToDate', 'minorBehind', 'majorOrCve']).optional(),
      criticality: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      supply: z.enum(['inStock', 'lead4to12', 'over12OrOos']).optional(),
      vuln: z.enum(['none', 'low', 'medium', 'high']).optional(),
      operatingHours: z.number().optional(),
      mtbfHours: z.number().optional(),
      notes: z.string().optional()
    },
    async (fields) => {
      try {
        return ok({ created: await createAsset(winccoa, WinccoaDpTypeNode, { ...fields, source: 'manual' }, Date.now()) });
      } catch (e) {
        return fail(String(e.message || e));
      }
    }
  );

  server.tool(
    'ali_update_asset',
    'Patch fields of an existing asset by id (e.g. set assetGroup, phase, criticality, supply, vuln, notes). Only the provided fields change.',
    {
      id: z.string(),
      name: z.string().optional(),
      mlfb: z.string().optional(),
      station: z.string().optional(),
      ip: z.string().optional(),
      area: z.string().optional(),
      assetGroup: z.string().optional(),
      firmwareField: z.string().optional(),
      firmwareAvail: z.string().optional(),
      successor: z.string().optional(),
      phase: z.enum(['PM300', 'PM400', 'PM410', 'PM490', 'PM500']).optional(),
      firmware: z.enum(['upToDate', 'minorBehind', 'majorOrCve']).optional(),
      criticality: z.enum(['low', 'medium', 'high', 'critical']).optional(),
      supply: z.enum(['inStock', 'lead4to12', 'over12OrOos']).optional(),
      vuln: z.enum(['none', 'low', 'medium', 'high']).optional(),
      operatingHours: z.number().optional(),
      mtbfHours: z.number().optional(),
      notes: z.string().optional()
    },
    async ({ id, ...patch }) => {
      try {
        const assets = await readAssets(winccoa);
        return ok({ updated: await updateAsset(winccoa, assets, id, patch) });
      } catch (e) {
        return fail(String(e.message || e));
      }
    }
  );

  server.tool('ali_delete_asset', 'Delete a managed asset by id (removes its datapoint). Irreversible.', { id: z.string() }, async ({ id }) => {
    try {
      const assets = await readAssets(winccoa);
      return ok(await deleteAsset(winccoa, assets, id));
    } catch (e) {
      return fail(String(e.message || e));
    }
  });

  return server;
}

// ---- HTTP transport (raw node:http, no express) ----------------------------
function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });
}

function unauthorized(res) {
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }));
}

const httpServer = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url?.startsWith('/health')) {
    res.writeHead(HTTP_OK, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'ali-mcp', auth: TOKEN ? 'bearer' : 'none' }));
    return;
  }
  if (req.method !== 'POST' || !req.url?.startsWith('/mcp')) {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    return;
  }
  if (TOKEN) {
    const auth = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (token !== TOKEN) return unauthorized(res);
  }
  const body = await readBody(req);
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (error) {
    log(`request error: ${error}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null }));
    }
  }
});

httpServer.listen(PORT, HOST, () => {
  log(`Asset Lifecycle Intelligence MCP server on http://${HOST}:${PORT}/mcp (auth: ${TOKEN ? 'bearer' : 'disabled'})`);
});
