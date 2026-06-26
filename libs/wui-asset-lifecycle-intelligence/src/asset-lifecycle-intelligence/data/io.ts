/**
 * Import / export helpers for the asset inventory.
 *
 * - JSON export/import round-trips the full {@link Asset} list (the canonical
 *   format — re-importing an export updates matching ids).
 * - CSV export adds the *computed* risk score and level columns, for hand-off to
 *   BI / CMMS / spreadsheets (the deck's "open to the ecosystem" angle). CSV is
 *   export-only; a UTF-8 BOM is prepended so Excel renders accents correctly.
 */
import { localize } from '../i18n.js';
import { computeRisk, bandForLevel } from '../risk.js';
import { SOURCE_LABELS, blankAsset, normalizePhase, type Asset } from '../types.js';
import { CSV_BOM, JSON_INDENT, csvCell, download, timestampSlug } from '@visuelconcept/wui-kit/data/io.js';

/** Columns emitted in the CSV export, in order. */
const CSV_COLUMNS: { key: string; label: string }[] = [
  { key: 'name', label: 'Désignation' },
  { key: 'mlfb', label: 'MLFB' },
  { key: 'station', label: 'Station' },
  { key: 'ip', label: 'IP' },
  { key: 'area', label: 'Atelier' },
  { key: 'source', label: 'Source' },
  { key: 'phase', label: 'Phase' },
  { key: 'firmwareField', label: 'Firmware terrain' },
  { key: 'firmwareAvail', label: 'Firmware dispo' },
  { key: 'successor', label: 'Successeur' },
  { key: 'criticality', label: 'Criticité' },
  { key: 'supply', label: 'Appro.' },
  { key: 'vuln', label: 'Vulnérabilités' },
  { key: 'operatingHours', label: 'Heures' },
  { key: 'mtbfHours', label: 'MTBF' },
  { key: 'score', label: 'Score' },
  { key: 'level', label: 'Niveau' },
  { key: 'notes', label: 'Notes' }
];

/** Download the full inventory as a JSON file. */
export function exportJson(assets: Asset[]): void {
  const payload = { kind: 'asset-lifecycle-inventory', version: 1, assets };
  download(
    `assets-${timestampSlug()}.json`,
    JSON.stringify(payload, null, JSON_INDENT),
    'application/json'
  );
}

/** Download the inventory as a CSV file (with computed score + level). */
export function exportCsv(assets: Asset[]): void {
  const rows = [CSV_COLUMNS.map((c) => c.label).join(',')];
  for (const asset of assets) {
    const risk = computeRisk(asset);
    const enriched: Record<string, unknown> = {
      ...asset,
      source: localize(SOURCE_LABELS[asset.source], 'fr.utf8'),
      score: risk.score,
      level: localize(bandForLevel(risk.level).label, 'fr.utf8')
    };
    rows.push(CSV_COLUMNS.map((c) => csvCell(enriched[c.key])).join(','));
  }
  download(`assets-${timestampSlug()}.csv`, CSV_BOM + rows.join('\r\n'), 'text/csv;charset=utf-8');
}

/**
 * Parse imported JSON into a normalized asset list. Accepts either a bare array
 * of assets or an export envelope (`{ assets: [...] }`). Every field is coerced
 * against {@link blankAsset} defaults so partial/foreign records stay valid.
 * Throws when the payload is not parseable JSON or holds no asset array.
 */
export function parseAssets(text: string): Asset[] {
  const raw: unknown = JSON.parse(text);
  const list = Array.isArray(raw)
    ? raw
    : (raw as { assets?: unknown }).assets;
  if (!Array.isArray(list)) {
    throw new TypeError('Format invalide : tableau « assets » introuvable.');
  }
  return list.map((item) => normalize(item as Partial<Asset>));
}

/** Merge a raw record onto blank defaults, keeping only known keys. */
function normalize(item: Partial<Asset>): Asset {
  const base = blankAsset();
  const out: Asset = { ...base };
  for (const key of Object.keys(base) as (keyof Asset)[]) {
    if (item[key] !== undefined && item[key] !== null) {
      (out as unknown as Record<string, unknown>)[key] = item[key];
    }
  }
  out.operatingHours = Number(out.operatingHours) || 0;
  out.mtbfHours = Number(out.mtbfHours) || 0;
  out.phase = normalizePhase(out.phase);
  // Records arriving without an explicit provenance are tagged as a file import.
  if (item.source === undefined) out.source = 'csv';
  return out;
}
