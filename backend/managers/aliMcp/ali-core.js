/**
 * ALI core — data access + risk scoring + aggregations for the Asset Lifecycle
 * Intelligence MCP server. This is a server-side JS port of the page's
 * `risk.ts` and `asset-tree.ts` so the MCP tools compute exactly the same scores
 * as the UI, reading the `AssetLifecycle_Asset` datapoints directly.
 */
const ASSET_TYPE = 'AssetLifecycle_Asset';
const PREFIX = 'AssetLifecycle_';
const SYS = 'System1:';
const SCORE_MAX = 100;

// ---- risk model (mirror of risk.ts) ----------------------------------------
const WEIGHTS = { obsolescence: 0.25, firmware: 0.2, criticality: 0.2, supply: 0.15, vuln: 0.1, age: 0.1 };
const OBSOLESCENCE_SCORES = { PM300: 10, PM400: 40, PM410: 70, PM490: 90, PM500: 100 };
const FIRMWARE_SCORES = { upToDate: 0, minorBehind: 30, majorOrCve: 80 };
const CRITICALITY_SCORES = { low: 10, medium: 40, high: 70, critical: 100 };
const SUPPLY_SCORES = { inStock: 0, lead4to12: 40, over12OrOos: 90 };
const VULN_SCORES = { none: 0, low: 30, medium: 60, high: 100 };

const RISK_BANDS = [
  { level: 'low', min: 0, max: 25 },
  { level: 'moderate', min: 26, max: 50 },
  { level: 'high', min: 51, max: 75 },
  { level: 'critical', min: 76, max: 100 }
];
const LEVEL_RANK = { low: 0, moderate: 1, high: 2, critical: 3 };
const PHASES = ['PM300', 'PM400', 'PM410', 'PM490', 'PM500'];
const LEGACY_PHASES = { PM100: 'PM300', PM200: 'PM300' };

function riskLevel(score) {
  const band = RISK_BANDS.find((b) => score >= b.min && score <= b.max);
  return band ? band.level : 'critical';
}

function ageScore(operatingHours, mtbfHours) {
  if (!mtbfHours || mtbfHours <= 0) return 0;
  return Math.min(SCORE_MAX, Math.round((operatingHours / mtbfHours) * SCORE_MAX));
}

/** Composite 0–100 risk score + level + per-component breakdown. */
function computeRisk(asset) {
  const components = [
    { key: 'obsolescence', weight: WEIGHTS.obsolescence, score: OBSOLESCENCE_SCORES[asset.phase] ?? 10 },
    { key: 'firmware', weight: WEIGHTS.firmware, score: FIRMWARE_SCORES[asset.firmware] ?? 0 },
    { key: 'criticality', weight: WEIGHTS.criticality, score: CRITICALITY_SCORES[asset.criticality] ?? 40 },
    { key: 'supply', weight: WEIGHTS.supply, score: SUPPLY_SCORES[asset.supply] ?? 0 },
    { key: 'vuln', weight: WEIGHTS.vuln, score: VULN_SCORES[asset.vuln] ?? 0 },
    { key: 'age', weight: WEIGHTS.age, score: ageScore(asset.operatingHours, asset.mtbfHours) }
  ];
  const weighted = components.reduce((sum, c) => sum + c.score * c.weight, 0);
  const score = Math.round(weighted);
  return { score, level: riskLevel(score), components };
}

/** The component contributing the most weighted points to the score. */
function dominantDriver(asset) {
  const { components } = computeRisk(asset);
  let best = components[0];
  for (const c of components) if (c.score * c.weight > best.score * best.weight) best = c;
  return best.key;
}

function normalizePhase(value) {
  const code = String(value ?? '');
  if (PHASES.includes(code)) return code;
  return LEGACY_PHASES[code] ?? 'PM300';
}

function scalar(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

function withSys(dp) {
  return dp.includes(':') ? dp : SYS + dp;
}

function bareName(dp) {
  return dp.includes(':') ? dp.split(':')[1] : dp;
}

// ---- data access ------------------------------------------------------------

/** Read every managed asset (one `AssetLifecycle_Asset` DP each). */
async function readAssets(winccoa) {
  const names = winccoa.dpNames('*', ASSET_TYPE) || [];
  if (names.length === 0) return [];
  const raw = await winccoa.dpGet(names.map((n) => `${withSys(n)}.json`));
  const arr = Array.isArray(raw) ? raw : [raw];
  const out = [];
  for (let i = 0; i < names.length; i++) {
    let item;
    try {
      item = JSON.parse(scalar(arr[i]) || '{}');
    } catch {
      item = {};
    }
    if (!item || typeof item !== 'object') item = {};
    const bare = bareName(names[i]);
    item.dp = bare;
    item.id = item.id || (bare.startsWith(PREFIX) ? bare.slice(PREFIX.length) : bare);
    item.phase = normalizePhase(item.phase);
    out.push(item);
  }
  return out;
}

/** Asset enriched with its computed risk. */
function withRisk(asset) {
  const risk = computeRisk(asset);
  return {
    id: asset.id,
    name: asset.name,
    mlfb: asset.mlfb,
    station: asset.station,
    area: asset.area,
    assetGroup: asset.assetGroup ?? '',
    phase: asset.phase,
    criticality: asset.criticality,
    supply: asset.supply,
    vuln: asset.vuln,
    firmware: asset.firmware,
    successor: asset.successor ?? '',
    supportUrl: asset.supportUrl ?? '',
    source: asset.source,
    score: risk.score,
    level: risk.level,
    dominantDriver: dominantDriver(asset)
  };
}

// ---- aggregations -----------------------------------------------------------

function fleetSummary(assets) {
  const byLevel = { low: 0, moderate: 0, high: 0, critical: 0 };
  const byPhase = {};
  const byArea = {};
  const bySource = {};
  let total = 0;
  for (const a of assets) {
    const r = computeRisk(a);
    byLevel[r.level] += 1;
    total += r.score;
    byPhase[a.phase] = (byPhase[a.phase] || 0) + 1;
    const area = (a.area || '').trim() || '(none)';
    byArea[area] = (byArea[area] || 0) + 1;
    bySource[a.source || 'manual'] = (bySource[a.source || 'manual'] || 0) + 1;
  }
  return {
    totalAssets: assets.length,
    averageScore: assets.length ? Math.round(total / assets.length) : 0,
    byLevel,
    byPhase,
    byArea,
    bySource
  };
}

function topRisks(assets, limit = 10) {
  return assets
    .map(withRisk)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, limit));
}

/**
 * Aggregate by logical asset (assetGroup). `score` = the WORST component (max
 * leaf score) — the asset's headline risk, on the same 0–100 bands as a leaf;
 * `sum` is the secondary total-exposure metric. Ranked by `score` (worst-case).
 */
function groupScores(assets) {
  const groups = new Map();
  for (const a of assets) {
    const key = (a.assetGroup || '').trim() || '(ungrouped)';
    const r = computeRisk(a);
    let g = groups.get(key);
    if (!g) {
      g = { assetGroup: key, score: 0, sum: 0, count: 0, mlfbs: [] };
      groups.set(key, g);
    }
    g.score = Math.max(g.score, r.score);
    g.sum += r.score;
    g.count += 1;
    g.mlfbs.push(a.mlfb);
  }
  return [...groups.values()]
    .map((g) => ({ assetGroup: g.assetGroup, score: g.score, level: riskLevel(g.score), sum: g.sum, count: g.count, mlfbs: g.mlfbs }))
    .sort((a, b) => b.score - a.score);
}

/** Workshop → Asset(group) → Station → MLFB tree with summed scores. */
function buildTree(assets) {
  const rankLevel = ['low', 'moderate', 'high', 'critical'];
  const root = new Map();
  for (const a of assets) {
    const r = computeRisk(a);
    const area = (a.area || '').trim() || '(Ungrouped area)';
    const group = (a.assetGroup || '').trim() || '(Ungrouped)';
    const station = (a.station || '').trim() || '(No station)';
    if (!root.has(area)) root.set(area, new Map());
    const groups = root.get(area);
    if (!groups.has(group)) groups.set(group, new Map());
    const stations = groups.get(group);
    if (!stations.has(station)) stations.set(station, []);
    stations.get(station).push({ id: a.id, name: a.name, mlfb: a.mlfb, score: r.score, level: r.level });
  }
  const agg = (leaves) => {
    const sum = leaves.reduce((s, l) => s + l.score, 0);
    const score = leaves.reduce((m, l) => Math.max(m, l.score), 0);
    const worst = leaves.reduce((w, l) => Math.max(w, LEVEL_RANK[l.level]), 0);
    return { score, sum, count: leaves.length, worstLevel: rankLevel[worst] };
  };
  const tree = [];
  for (const [area, groups] of root) {
    const groupNodes = [];
    for (const [group, stations] of groups) {
      const stationNodes = [];
      for (const [station, leaves] of stations) {
        stationNodes.push({ type: 'station', name: station, ...agg(leaves), mlfbs: leaves });
      }
      const all = stationNodes.flatMap((s) => s.mlfbs);
      groupNodes.push({ type: 'asset', name: group, ...agg(all), stations: stationNodes });
    }
    const all = groupNodes.flatMap((g) => g.stations.flatMap((s) => s.mlfbs));
    tree.push({ type: 'workshop', name: area, ...agg(all), assets: groupNodes });
  }
  return tree.sort((a, b) => b.sum - a.sum);
}

function obsolescenceReport(assets) {
  const byPhase = {};
  for (const p of PHASES) byPhase[p] = [];
  for (const a of assets) {
    byPhase[a.phase].push({ id: a.id, name: a.name, mlfb: a.mlfb, successor: a.successor ?? '', score: computeRisk(a).score });
  }
  const endOfLife = assets
    .filter((a) => a.phase === 'PM490' || a.phase === 'PM500')
    .map((a) => ({ id: a.id, name: a.name, mlfb: a.mlfb, phase: a.phase, successor: a.successor ?? '' }));
  return { byPhase, endOfLife, withSuccessor: assets.filter((a) => (a.successor ?? '') !== '').length };
}

function searchAssets(assets, query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return [];
  return assets
    .filter((a) =>
      [a.name, a.mlfb, a.station, a.area, a.assetGroup, a.notes].some((f) => String(f || '').toLowerCase().includes(q))
    )
    .map(withRisk);
}

// ---- writes (direct DP ops) -------------------------------------------------

function slug(label) {
  return (
    String(label || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'asset'
  );
}

async function ensureType(winccoa, WinccoaDpTypeNode) {
  const root = new WinccoaDpTypeNode(ASSET_TYPE, 1, '', [
    new WinccoaDpTypeNode('name', 25),
    new WinccoaDpTypeNode('json', 25)
  ]);
  try {
    await winccoa.dpTypeCreate(root);
  } catch {
    // type already exists
  }
}

const BLANK = {
  id: '', dp: '', name: '', mlfb: '', station: '', ip: '', area: '', firmwareField: '',
  firmwareAvail: '', successor: '', supportUrl: '', assetGroup: '', phase: 'PM300',
  firmware: 'upToDate', criticality: 'medium', supply: 'inStock', vuln: 'none',
  operatingHours: 0, mtbfHours: 0, source: 'manual', tiaProject: '', tiaKey: '', notes: ''
};

async function createAsset(winccoa, WinccoaDpTypeNode, fields, nowMs) {
  await ensureType(winccoa, WinccoaDpTypeNode);
  const id = `${slug(fields.name || fields.station)}-${nowMs.toString(36)}`;
  const dp = PREFIX + id;
  const item = { ...BLANK, ...fields, id, dp, phase: normalizePhase(fields.phase ?? 'PM300') };
  await winccoa.dpCreate(dp, ASSET_TYPE);
  await winccoa.dpSetWait(`${withSys(dp)}.name`, String(item.name || ''));
  await winccoa.dpSetWait(`${withSys(dp)}.json`, JSON.stringify(item));
  return withRisk(item);
}

async function updateAsset(winccoa, assets, id, patch) {
  const existing = assets.find((a) => a.id === id);
  if (!existing) throw new Error(`asset not found: ${id}`);
  const merged = { ...BLANK, ...existing, ...patch, id, dp: existing.dp || PREFIX + id };
  merged.phase = normalizePhase(merged.phase);
  await winccoa.dpSetWait(`${withSys(merged.dp)}.name`, String(merged.name || ''));
  await winccoa.dpSetWait(`${withSys(merged.dp)}.json`, JSON.stringify(merged));
  return withRisk(merged);
}

async function deleteAsset(winccoa, assets, id) {
  const existing = assets.find((a) => a.id === id);
  const dp = existing?.dp || PREFIX + id;
  await winccoa.dpDelete(dp);
  return { deleted: id, dp };
}

export {
  ASSET_TYPE,
  computeRisk,
  dominantDriver,
  readAssets,
  withRisk,
  fleetSummary,
  topRisks,
  groupScores,
  buildTree,
  obsolescenceReport,
  searchAssets,
  createAsset,
  updateAsset,
  deleteAsset
};
