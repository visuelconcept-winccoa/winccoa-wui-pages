// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Snippet library — ready-made circuit fragments (a few pre-wired symbols)
 * inserted in one click from the toolbox, then edited like any drawn content.
 *
 * A snippet is a mini-network *template*: nodes at positions relative to the
 * fragment's top-left corner, wired by edges that reference the template-local
 * node ids. {@link instantiateSnippet} stamps a template at a drop point: it
 * clones every element with fresh unique ids (so a snippet can be inserted any
 * number of times), offsets the positions, snaps them to the grid, and localizes
 * the labels to the active UI language — exactly like the demo generators.
 *
 * The toolbox arms a snippet as a placement tool (`snippet:<id>` — see
 * {@link snippetTool}); the canvas emits `wui:place-snippet` on click and the
 * page inserts + selects the new elements so they can be moved immediately.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { ml } from '../i18n.js';
import { snap, type Edge, type Node, type Point } from '../types.js';
import type { SymbolId } from '../symbols/catalog.js';

/** Stable identifier of a snippet template. */
export type SnippetId =
  | 'feeder-protected'
  | 'motor-feeder'
  | 'transformer-incomer'
  | 'busbar-three-feeders'
  | 'changeover'
  | 'traction-substation'
  | 'catenary-sectioned'
  | 'powered-track'
  | 'at-cell';

/** Snippet family shown as a toolbox group. */
export type SnippetCategory = 'distribution' | 'railway';

/** One symbol of a template (positions relative to the fragment origin). */
interface SnippetNode {
  id: string;
  symbol: SymbolId;
  label?: MultiLangString;
  x: number;
  y: number;
}

/** One wire of a template (template-local node ids). */
interface SnippetEdge {
  from: { nodeId: string; port: string };
  to: { nodeId: string; port: string };
}

/** A ready-made circuit fragment. */
export interface SnippetDef {
  id: SnippetId;
  category: SnippetCategory;
  label: MultiLangString;
  /** Bounding size of the fragment, in canvas units (placement centering + preview). */
  w: number;
  h: number;
  nodes: SnippetNode[];
  edges: SnippetEdge[];
}

/** The snippet catalog, keyed by id. */
export const SNIPPETS: Record<SnippetId, SnippetDef> = {
  'feeder-protected': {
    id: 'feeder-protected',
    category: 'distribution',
    label: ml('Protected feeder', 'Départ protégé', 'Geschützter Abgang'),
    w: 40,
    h: 260,
    nodes: [
      { id: 'q', symbol: 'breaker', label: ml('Q', 'Q', 'Q'), x: 0, y: 0 },
      { id: 'f', symbol: 'feeder-out', label: ml('Feeder', 'Départ', 'Abgang'), x: 0, y: 120 }
    ],
    edges: [{ from: { nodeId: 'q', port: 'b' }, to: { nodeId: 'f', port: 'a' } }]
  },
  'motor-feeder': {
    id: 'motor-feeder',
    category: 'distribution',
    label: ml('Motor feeder', 'Départ moteur', 'Motorabgang'),
    w: 60,
    h: 290,
    nodes: [
      { id: 'q', symbol: 'breaker', label: ml('Q', 'Q', 'Q'), x: 10, y: 0 },
      { id: 'k', symbol: 'contactor', label: ml('K', 'K', 'K'), x: 10, y: 100 },
      { id: 'm', symbol: 'motor', label: ml('Motor', 'Moteur', 'Motor'), x: 0, y: 200 }
    ],
    edges: [
      { from: { nodeId: 'q', port: 'b' }, to: { nodeId: 'k', port: 'a' } },
      { from: { nodeId: 'k', port: 'b' }, to: { nodeId: 'm', port: 'a' } }
    ]
  },
  'transformer-incomer': {
    id: 'transformer-incomer',
    category: 'distribution',
    label: ml('Transformer incomer', 'Arrivée transformateur', 'Trafo-Einspeisung'),
    w: 60,
    h: 440,
    nodes: [
      { id: 'g', symbol: 'grid-source', label: ml('Grid', 'Réseau', 'Netz'), x: 0, y: 0 },
      { id: 'qs', symbol: 'disconnector', label: ml('QS', 'QS', 'QS'), x: 10, y: 110 },
      { id: 'q', symbol: 'breaker', label: ml('Q', 'Q', 'Q'), x: 10, y: 210 },
      { id: 't', symbol: 'transformer', label: ml('T', 'T', 'T'), x: 0, y: 310 }
    ],
    edges: [
      { from: { nodeId: 'g', port: 'b' }, to: { nodeId: 'qs', port: 'a' } },
      { from: { nodeId: 'qs', port: 'b' }, to: { nodeId: 'q', port: 'a' } },
      { from: { nodeId: 'q', port: 'b' }, to: { nodeId: 't', port: 'a' } }
    ]
  },
  'busbar-three-feeders': {
    id: 'busbar-three-feeders',
    category: 'distribution',
    label: ml('Busbar + 3 feeders', 'Jeu de barres + 3 départs', 'Sammelschiene + 3 Abgänge'),
    w: 240,
    h: 320,
    nodes: [
      { id: 'bb', symbol: 'busbar', label: ml('Busbar', 'Jeu de barres', 'Sammelschiene'), x: 0, y: 0 },
      { id: 'q1', symbol: 'breaker', label: ml('QD1', 'QD1', 'QD1'), x: 40, y: 60 },
      { id: 'q2', symbol: 'breaker', label: ml('QD2', 'QD2', 'QD2'), x: 120, y: 60 },
      { id: 'q3', symbol: 'breaker', label: ml('QD3', 'QD3', 'QD3'), x: 200, y: 60 },
      { id: 'l1', symbol: 'load', label: ml('Load', 'Charge', 'Last'), x: 40, y: 200 },
      { id: 'm1', symbol: 'motor', label: ml('Motor', 'Moteur', 'Motor'), x: 110, y: 200 },
      { id: 'f1', symbol: 'feeder-out', label: ml('Feeder', 'Départ', 'Abgang'), x: 200, y: 200 }
    ],
    edges: [
      { from: { nodeId: 'bb', port: 'p2' }, to: { nodeId: 'q1', port: 'a' } },
      { from: { nodeId: 'bb', port: 'p4' }, to: { nodeId: 'q2', port: 'a' } },
      { from: { nodeId: 'bb', port: 'p6' }, to: { nodeId: 'q3', port: 'a' } },
      { from: { nodeId: 'q1', port: 'b' }, to: { nodeId: 'l1', port: 'a' } },
      { from: { nodeId: 'q2', port: 'b' }, to: { nodeId: 'm1', port: 'a' } },
      { from: { nodeId: 'q3', port: 'b' }, to: { nodeId: 'f1', port: 'a' } }
    ]
  },
  changeover: {
    id: 'changeover',
    category: 'distribution',
    label: ml('Grid/generator changeover', 'Inverseur normal/secours', 'Netz/Ersatz-Umschaltung'),
    w: 360,
    h: 260,
    nodes: [
      { id: 'g', symbol: 'grid-source', label: ml('Grid', 'Réseau', 'Netz'), x: 0, y: 0 },
      { id: 'ge', symbol: 'generator', label: ml('Generator', 'Groupe', 'Aggregat'), x: 300, y: 0 },
      { id: 'kn', symbol: 'contactor', label: ml('KN', 'KN', 'KN'), x: 10, y: 120 },
      { id: 'ks', symbol: 'contactor', label: ml('KS', 'KS', 'KS'), x: 310, y: 120 },
      { id: 'bb', symbol: 'busbar', label: ml('Busbar', 'Jeu de barres', 'Sammelschiene'), x: 60, y: 240 }
    ],
    edges: [
      { from: { nodeId: 'g', port: 'b' }, to: { nodeId: 'kn', port: 'a' } },
      { from: { nodeId: 'ge', port: 'b' }, to: { nodeId: 'ks', port: 'a' } },
      { from: { nodeId: 'kn', port: 'b' }, to: { nodeId: 'bb', port: 'p1' } },
      { from: { nodeId: 'ks', port: 'b' }, to: { nodeId: 'bb', port: 'p6' } }
    ]
  },
  'traction-substation': {
    id: 'traction-substation',
    category: 'railway',
    label: ml('DC traction substation', 'Sous-station de traction DC', 'DC-Unterwerk'),
    w: 60,
    h: 330,
    nodes: [
      { id: 't', symbol: 'transformer', label: ml('Traction trafo', 'Transfo traction', 'Bahnstrom-Trafo'), x: 0, y: 0 },
      { id: 'r', symbol: 'rectifier', label: ml('Rectifier', 'Redresseur', 'Gleichrichter'), x: 8, y: 150 },
      { id: 'q', symbol: 'breaker', label: ml('Traction breaker', 'DJ traction', 'Bahnstromschalter'), x: 10, y: 250 }
    ],
    edges: [
      { from: { nodeId: 't', port: 'b' }, to: { nodeId: 'r', port: 'a' } },
      { from: { nodeId: 'r', port: 'b' }, to: { nodeId: 'q', port: 'a' } }
    ]
  },
  'catenary-sectioned': {
    id: 'catenary-sectioned',
    category: 'railway',
    label: ml('Sectioned catenary', 'Caténaire sectionnée', 'Fahrleitung mit Trenner'),
    w: 580,
    h: 40,
    nodes: [
      { id: 'c1', symbol: 'catenary', label: ml('Section 1', 'Section 1', 'Abschnitt 1'), x: 0, y: 0 },
      { id: 's', symbol: 'section-switch', label: ml('Sectioning', 'Sectionnement', 'Streckentrenner'), x: 250, y: 11 },
      { id: 'c2', symbol: 'catenary', label: ml('Section 2', 'Section 2', 'Abschnitt 2'), x: 340, y: 0 }
    ],
    edges: [
      { from: { nodeId: 'c1', port: 'p6' }, to: { nodeId: 's', port: 'a' } },
      { from: { nodeId: 's', port: 'b' }, to: { nodeId: 'c2', port: 'p1' } }
    ]
  },
  'powered-track': {
    id: 'powered-track',
    category: 'railway',
    label: ml('Powered track (train)', 'Voie alimentée (train)', 'Gespeistes Gleis (Zug)'),
    w: 240,
    h: 220,
    nodes: [
      { id: 'c', symbol: 'catenary', label: ml('Catenary', 'Caténaire', 'Fahrleitung'), x: 0, y: 0 },
      { id: 'tr', symbol: 'train', label: ml('Train', 'Train', 'Zug'), x: 100, y: 60 },
      { id: 'k', symbol: 'track', label: ml('Track', 'Rail', 'Gleis'), x: 0, y: 190 }
    ],
    edges: [
      { from: { nodeId: 'c', port: 'p4' }, to: { nodeId: 'tr', port: 'a' } },
      { from: { nodeId: 'tr', port: 'b' }, to: { nodeId: 'k', port: 'p4' } }
    ]
  },
  'at-cell': {
    id: 'at-cell',
    category: 'railway',
    label: ml('Autotransformer cell', 'Cellule autotransformateur', 'Autotrafo-Zelle'),
    w: 240,
    h: 220,
    nodes: [
      { id: 'c', symbol: 'catenary', label: ml('Catenary', 'Caténaire', 'Fahrleitung'), x: 0, y: 0 },
      { id: 'at', symbol: 'autotransformer', label: ml('AT', 'AT', 'AT'), x: 90, y: 50 },
      { id: 'k', symbol: 'track', label: ml('Track', 'Rail', 'Gleis'), x: 0, y: 190 }
    ],
    edges: [
      { from: { nodeId: 'c', port: 'p3' }, to: { nodeId: 'at', port: 'a' } },
      { from: { nodeId: 'at', port: 'b' }, to: { nodeId: 'k', port: 'p3' } }
    ]
  }
};

/** Toolbox display order of the snippet families. */
export const SNIPPET_CATEGORY_ORDER: SnippetCategory[] = ['distribution', 'railway'];

/** Snippets of one family, in declaration order. */
export function snippetsOf(category: SnippetCategory): SnippetDef[] {
  return Object.values(SNIPPETS).filter((s) => s.category === category);
}

/** Placement-tool token for a snippet (see {@link Tool} in am-canvas). */
export type SnippetTool = `snippet:${SnippetId}`;

/** Arm token for a snippet. */
export function snippetTool(id: SnippetId): SnippetTool {
  return `snippet:${id}`;
}

/** Whether a tool token designates a snippet. */
export function isSnippetTool(tool: string): tool is SnippetTool {
  return tool.startsWith('snippet:') && tool.slice('snippet:'.length) in SNIPPETS;
}

/** The snippet designated by a tool token. */
export function snippetOf(tool: SnippetTool): SnippetDef {
  return SNIPPETS[tool.slice('snippet:'.length) as SnippetId];
}

const ID_RADIX = 36;
let stampCounter = 0;

/**
 * Stamp a snippet at `origin` (top-left, canvas units): fresh unique ids,
 * grid-snapped offset positions, labels localized to the active UI language.
 */
export function instantiateSnippet(def: SnippetDef, origin: Point): { nodes: Node[]; edges: Edge[] } {
  stampCounter += 1;
  const base = `${Date.now().toString(ID_RADIX)}${stampCounter.toString(ID_RADIX)}`;
  const idMap = new Map(def.nodes.map((n, i) => [n.id, `n-${base}-${i}`]));
  const nodes: Node[] = def.nodes.map((n) => ({
    id: idMap.get(n.id)!,
    symbol: n.symbol,
    label: n.label ? localize(n.label) : '',
    x: snap(origin.x + n.x),
    y: snap(origin.y + n.y),
    rotation: 0,
    dp: '',
    closedValue: 1,
    source: false
  }));
  const edges: Edge[] = def.edges.map((e, i) => ({
    id: `e-${base}-${i}`,
    from: { nodeId: idMap.get(e.from.nodeId)!, port: e.from.port },
    to: { nodeId: idMap.get(e.to.nodeId)!, port: e.to.port }
  }));
  return { nodes, edges };
}
