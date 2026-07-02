// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Context wiring for the Ampère AI assistant.
 *
 * The assistant is a *proposal-only* helper (called with no MCP tools): it never
 * mutates the project, it drafts single-line network models from a natural-
 * language prompt. When it proposes one it must emit a fenced ```json block
 * holding a {@link Network}; the page parses/sanitises it (via
 * {@link normalizeNetwork}) and offers an "apply to editor" action so the user
 * reviews it before saving.
 */
import { SYMBOLS, type SymbolId } from './symbols/catalog.js';
import { normalizeNetwork } from './data/io.js';
import { CANVAS_H, CANVAS_W, GRID, type Network } from './types.js';

/** Human-readable list of every symbol id + its ports, injected into the prompt. */
function symbolReference(): string {
  return (Object.keys(SYMBOLS) as SymbolId[])
    .map((id) => {
      const def = SYMBOLS[id];
      const ports = Object.keys(def.ports).join(', ') || '(none)';
      return `- "${id}" (${def.role}; ports: ${ports})`;
    })
    .join('\n');
}

/**
 * Build the system instruction sent with every prompt. It scopes the assistant
 * to single-line electrical modelling, forbids any mutating action, fixes the
 * JSON contract, and injects a short summary of the current diagram.
 */
export function buildSystemPrompt(contextSummary: string): string {
  return [
    "Tu es l'assistant intégré de la page « Ampère » d'un dashboard WinCC OA : un éditeur de schémas électriques UNIFILAIRES (mono-filaires) de réseaux de distribution (postes/TGBT, arrivées, jeux de barres, disjoncteurs, sectionneurs, transformateurs, départs, charges…).",
    "L'ingénieur s'en sert pour DESSINER un réseau : placer des symboles, les câbler par des fils, lier chaque appareil à un datapoint d'état, et voir l'animation (les fils sous tension) calculée par propagation depuis les sources à travers l'appareillage fermé.",
    '',
    "RÈGLE ABSOLUE : tu ne fais qu'AIDER et PROPOSER. Tu n'exécutes JAMAIS d'action (aucun outil) : ne prétends pas avoir agi. C'est toujours l'utilisateur qui applique la proposition dans l'éditeur et valide.",
    '',
    'Quand tu proposes un réseau, termine ta réponse par UN bloc ```json contenant exactement un objet Network :',
    '{ "name": "<nom>", "description": "<courte description>", "nodes": [ { "id": "<id unique>", "symbol": "<symbolId>", "label": "<repère ex Q1>", "x": <int>, "y": <int>, "rotation": 0, "dp": "", "closedValue": 1, "source": false } ], "edges": [ { "id": "<id>", "from": { "nodeId": "<id>", "port": "<port>" }, "to": { "nodeId": "<id>", "port": "<port>" } } ], "measurements": [] }',
    '',
    'Symboles disponibles (utilise EXACTEMENT ces id et ces ports) :',
    symbolReference(),
    '',
    `Règles de géométrie : la zone fait ${CANVAS_W}×${CANVAS_H} unités, origine en haut à gauche, y vers le bas. Aligne tout sur une grille de ${GRID} unités. Un symbole vertical à 2 bornes a le port "a" en haut et "b" en bas ; câble typiquement du bas (b) vers le haut (a) du symbole suivant. Le jeu de barres "busbar" est horizontal avec les ports p1..p6 répartis de gauche à droite. Empile les niveaux verticalement (source en haut → jeu de barres → départs en bas) et écarte les départs horizontalement (~120 unités).`,
    'Mets "source": true (ou utilise "grid-source"/"generator"/"feeder-in") uniquement pour les points d\'alimentation. Laisse "dp" vide : l\'utilisateur liera les datapoints ensuite. Chaque "edge.from/to.port" DOIT exister sur le symbole ciblé.',
    'Explique brièvement ta proposition AVANT le bloc JSON. N\'émets le bloc JSON QUE lorsque tu proposes un réseau concret.',
    '',
    'Contexte courant du schéma :',
    contextSummary || '(schéma vide)'
  ].join('\n');
}

/**
 * Extract every network model embedded as a fenced ```json block in an answer.
 * Blocks that are not valid JSON or hold no node are ignored. Each survivor is
 * run through {@link normalizeNetwork} so unknown symbols/ports are dropped.
 */
export function extractNetworkProposals(answer: string): Network[] {
  const proposals: Network[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(answer)) !== null) {
    const proposal = parseProposal(match[1]);
    if (proposal) proposals.push(proposal);
  }
  return proposals;
}

function parseProposal(raw: string): Network | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (data == null || typeof data !== 'object') return null;
  // Tolerate either a bare Network or a { network: {...} } wrapper.
  const obj = data as Record<string, unknown>;
  const candidate = (obj['network'] && typeof obj['network'] === 'object' ? obj['network'] : obj) as Record<string, unknown>;
  if (!Array.isArray(candidate['nodes'])) return null;
  const network = normalizeNetwork(candidate);
  return network.nodes.length > 0 ? network : null;
}
