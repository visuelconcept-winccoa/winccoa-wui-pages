/**
 * Context wiring for the PARA AI assistant.
 *
 * The assistant is a *proposal-only* helper: it never mutates the project (it
 * is called with no MCP tools), it suggests datapoint-type models and explains
 * configs. When it proposes a type it must emit a fenced ```json block holding a
 * {@link TypeProposal}; the page parses it and offers an "apply to editor"
 * action so the user reviews and saves the model themselves.
 */
import { ELEMENT_TYPE_NAMES, isKnownElementType, type ParaStructureNode } from './para-element-types.js';

/** A datapoint-type model proposed by the assistant, ready to load in the editor. */
export interface TypeProposal {
  typeName: string;
  structure: ParaStructureNode;
}

/** Clickable starter prompts shown when the chat is empty. */
export const PARA_SUGGESTIONS: string[] = [
  'Propose un type pour un moteur : vitesse (Float), état (Bool), consigne (Float) et une sous-structure alarmes.',
  'Ajoute une sous-structure « maintenance » (dernier entretien Time, heures Float) au type sélectionné.',
  'À quoi servent les configs _pv_range, _alert_hdl et _archive sur un élément ?',
  'Comment bien modéliser une station de pompage en DP-Types WinCC OA ?'
];

/**
 * Build the system instruction sent with every prompt. It scopes the assistant
 * to PARA modeling, forbids any mutating action, fixes the JSON proposal
 * contract, and injects a short summary of what the user is currently looking
 * at so suggestions stay relevant.
 */
export function buildSystemPrompt(contextSummary: string): string {
  return [
    "Tu es l'assistant intégré de la page « Parametrization (PARA) » d'un dashboard WinCC OA.",
    "L'ingénieur s'en sert pour MODÉLISER des Datapoint Types (structures d'éléments) puis pour créer des instances (datapoints) et consulter leurs configs et valeurs.",
    '',
    'RÈGLE ABSOLUE : tu ne fais qu\'AIDER et PROPOSER. Tu n\'exécutes JAMAIS d\'action de modification (pas de création/édition/suppression de type, de datapoint ou de valeur). Tu n\'as aucun outil : ne prétends pas avoir agi. C\'est toujours l\'utilisateur qui valide et applique dans l\'éditeur.',
    '',
    "Quand tu proposes (ou modifies) un Datapoint Type, termine ta réponse par UN bloc de code ```json contenant exactement :",
    '{ "typeName": "<NomDuType>", "structure": { "name": "<NomDuType>", "type": "Struct", "children": [ { "name": "<element>", "type": "<Type>", "refName": "<TypeRéférencé si Typeref>", "children": [ … si Struct ] } ] } }',
    '',
    `Types d'éléments valides (utilise EXACTEMENT ces noms) : ${ELEMENT_TYPE_NAMES.join(', ')}.`,
    'Règles de structure : la racine est toujours de type "Struct" et son "name" est égal à "typeName"; une sous-structure a type "Struct" et un tableau "children"; un "Typeref" doit fournir "refName"; les types de liste commencent par "Dyn" (DynFloat, DynString, …).',
    'Explique brièvement ta proposition AVANT le bloc JSON. N\'émets le bloc JSON QUE lorsque tu proposes une structure de type concrète.',
    '',
    'Contexte courant de la page :',
    contextSummary || '(aucune sélection)'
  ].join('\n');
}

/**
 * Extract every datapoint-type proposal embedded as a fenced ```json block in
 * an assistant answer. Blocks that are not valid JSON or do not match the
 * {@link TypeProposal} shape are ignored.
 */
export function extractTypeProposals(answer: string): TypeProposal[] {
  const proposals: TypeProposal[] = [];
  // Match ```json … ``` (and tolerate a bare ``` fence with JSON inside).
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(answer)) !== null) {
    const proposal = parseProposal(match[1]);
    if (proposal) {
      proposals.push(proposal);
    }
  }
  return proposals;
}

function parseProposal(raw: string): TypeProposal | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (data == null || typeof data !== 'object') {
    return null;
  }
  const { typeName, structure } = data as { typeName?: unknown; structure?: unknown };
  if (typeof typeName !== 'string' || typeName.trim() === '') {
    return null;
  }
  const normalized = normalizeNode(structure);
  if (normalized == null) {
    return null;
  }
  // Force the root name to the type name, matching the backend contract.
  normalized.name = typeName.trim();
  if (normalized.type !== 'Struct') {
    normalized.type = 'Struct';
  }
  return { typeName: typeName.trim(), structure: normalized };
}

/** Validate/normalize one proposed node; drop unknown types and bad shapes. */
function normalizeNode(value: unknown): ParaStructureNode | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const node = value as Record<string, unknown>;
  const rawName = node['name'];
  const rawType = node['type'];
  const rawRef = node['refName'];
  const rawChildren = node['children'];
  const name = typeof rawName === 'string' ? rawName : '';
  const type = typeof rawType === 'string' && isKnownElementType(rawType) ? rawType : 'String';
  const result: ParaStructureNode = { name, type };
  if (typeof rawRef === 'string' && rawRef !== '') {
    result.refName = rawRef;
  }
  if (Array.isArray(rawChildren)) {
    const children = rawChildren.map((child) => normalizeNode(child)).filter((c): c is ParaStructureNode => c != null);
    if (children.length > 0) {
      result.children = children;
    }
  }
  return result;
}
