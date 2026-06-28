// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Builds the Workshop → Asset → Station → MLFB hierarchy for the tree view.
 *
 * Each MLFB item (one `Asset` record) is a leaf with its computed 0–100 risk
 * score. Grouping nodes (workshop / asset / station) aggregate their descendant
 * leaves: `sum` is the **sum** of leaf scores (total risk exposure, can exceed
 * 100), `worst` is the highest descendant risk level (used for a colour cue) and
 * `count` is the number of MLFBs underneath.
 */
import { computeRisk } from '../risk.js';
import type { Asset, RiskLevel } from '../types.js';

export interface TreeLeaf {
  kind: 'mlfb';
  /** The underlying MLFB item. */
  item: Asset;
  score: number;
  level: RiskLevel;
}

export type TreeNodeKind = 'workshop' | 'asset' | 'station';

export interface TreeNode {
  kind: TreeNodeKind;
  /** Raw label (area / assetGroup / station); empty string → component shows a placeholder. */
  label: string;
  /**
   * Headline risk score of the node = the **worst component** (max descendant
   * leaf score). This is what colours the node, on the SAME 0–100 bands as a
   * leaf, so colour and number always agree (an asset is as risky as its
   * weakest component).
   */
  score: number;
  /** Sum of descendant leaf scores — secondary "total exposure" metric (uncoloured). */
  sum: number;
  /** Risk level of {@link score} (worst component) — drives the colour. */
  worst: RiskLevel;
  /** Number of MLFB leaves underneath. */
  count: number;
  children: TreeChild[];
}

export type TreeChild = TreeNode | TreeLeaf;

const LEVEL_RANK: Record<RiskLevel, number> = { low: 0, moderate: 1, high: 2, critical: 3 };
const LEVEL_BY_RANK: RiskLevel[] = ['low', 'moderate', 'high', 'critical'];

function worstOf(levels: RiskLevel[]): RiskLevel {
  return LEVEL_BY_RANK[Math.max(0, ...levels.map((l) => LEVEL_RANK[l]))];
}

/** Group items by a key, preserving a stable map. */
function groupBy(items: Asset[], key: (a: Asset) => string): Map<string, Asset[]> {
  const map = new Map<string, Asset[]>();
  for (const item of items) {
    const k = key(item);
    const bucket = map.get(k);
    if (bucket) bucket.push(item);
    else map.set(k, [item]);
  }
  return map;
}

function leafOf(item: Asset): TreeLeaf {
  const risk = computeRisk(item);
  return { kind: 'mlfb', item, score: risk.score, level: risk.level };
}

/** Build one grouping node from its leaves; `score` = worst component (max), `sum` = total exposure. */
function nodeFrom(kind: TreeNodeKind, label: string, children: TreeChild[]): TreeNode {
  let sum = 0;
  let count = 0;
  let score = 0;
  const levels: RiskLevel[] = [];
  for (const c of children) {
    if (c.kind === 'mlfb') {
      sum += c.score;
      count += 1;
      score = Math.max(score, c.score);
      levels.push(c.level);
    } else {
      sum += c.sum;
      count += c.count;
      score = Math.max(score, c.score);
      levels.push(c.worst);
    }
  }
  return { kind, label, score, sum, worst: worstOf(levels.length > 0 ? levels : ['low']), count, children };
}

/** How the tree groups are ordered: by worst-component score (colour), by total exposure, or by name. */
export type TreeSort = 'score' | 'sum' | 'name';

function comparator(sort: TreeSort): (a: TreeNode, b: TreeNode) => number {
  if (sort === 'name') return (a, b) => (a.label || '').localeCompare(b.label || '');
  if (sort === 'sum') return (a, b) => b.sum - a.sum;
  return (a, b) => b.score - a.score;
}

/** Build the full Workshop → Asset → Station → MLFB tree, ordered by `sort` (default: worst-component score desc). */
export function buildAssetTree(assets: Asset[], sort: TreeSort = 'score'): TreeNode[] {
  const cmp = comparator(sort);
  const byArea = groupBy(assets, (a) => a.area ?? '');
  const workshops: TreeNode[] = [];
  for (const [area, areaItems] of byArea) {
    const byAsset = groupBy(areaItems, (a) => a.assetGroup ?? '');
    const assetNodes: TreeNode[] = [];
    for (const [group, groupItems] of byAsset) {
      const byStation = groupBy(groupItems, (a) => a.station ?? '');
      const stationNodes: TreeNode[] = [];
      for (const [station, stationItems] of byStation) {
        const leaves = stationItems.map((item) => leafOf(item)).sort((a, b) => b.score - a.score);
        stationNodes.push(nodeFrom('station', station, leaves));
      }
      stationNodes.sort(cmp);
      assetNodes.push(nodeFrom('asset', group, stationNodes));
    }
    assetNodes.sort(cmp);
    workshops.push(nodeFrom('workshop', area, assetNodes));
  }
  workshops.sort(cmp);
  return workshops;
}

/** All collapsible node paths in the tree (for expand/collapse-all). */
export function allNodePaths(nodes: TreeNode[]): string[] {
  const paths: string[] = [];
  const walk = (node: TreeNode, path: string): void => {
    paths.push(path);
    for (const child of node.children) {
      if (child.kind !== 'mlfb') walk(child, `${path}|${child.label}`);
    }
  };
  for (const node of nodes) walk(node, node.label);
  return paths;
}
