/**
 * AI assistant scoping for the Asset Lifecycle Intelligence page.
 *
 * Builds the `system` instruction sent with every chat prompt so the assistant
 * answers ONLY about the assets managed by this page: it states the domain and
 * guard-rails, explains the composite risk model, and injects a compact snapshot
 * of the current inventory (designation, MLFB, computed risk, and the fields
 * that drive it). Also exposes the preset prompts shown in the chat panel.
 */
import { bandForLevel, computeRisk } from '../risk.js';
import {
  CRITICALITY_LABELS,
  FIRMWARE_LABELS,
  PHASE_LABELS,
  SUPPLY_LABELS,
  VULN_LABELS,
  type Asset
} from '../types.js';

/** Hard cap on injected assets to keep the context bounded for very large parks. */
const MAX_ASSETS_IN_CONTEXT = 200;

/** Preset prompts offered as clickable chips when the chat is empty. */
export const ASSET_AI_SUGGESTIONS: string[] = [
  'Quels actifs présentent le risque le plus élevé, et pourquoi ?',
  'Quels actifs sont obsolètes ou en fin de vie à remplacer en priorité ?',
  'Quels actifs critiques ont un approvisionnement long ou en rupture ?',
  'Quels actifs ont un écart de firmware ou une vulnérabilité à traiter ?',
  'Propose un plan d’action de maintenance priorisé pour le parc.'
];

/** One inventory line: designation, MLFB, computed risk, and the risk drivers. */
function assetLine(asset: Asset): string {
  const risk = computeRisk(asset);
  const band = bandForLevel(risk.level);
  const parts = [
    `« ${asset.name} »`,
    `MLFB ${asset.mlfb || '—'}`,
    `risque ${risk.score} (${band.label})`,
    `phase ${PHASE_LABELS[asset.phase]}`,
    `criticité ${CRITICALITY_LABELS[asset.criticality]}`,
    `appro ${SUPPLY_LABELS[asset.supply]}`,
    `vuln ${VULN_LABELS[asset.vuln]}`,
    `firmware ${FIRMWARE_LABELS[asset.firmware]}`
  ];
  if (asset.area) parts.push(`atelier ${asset.area}`);
  if (asset.station) parts.push(`station ${asset.station}`);
  if (asset.successor) parts.push(`successeur ${asset.successor}`);
  return `- ${parts.join(' | ')}`;
}

/** Build the scoped system instruction from the current asset inventory. */
export function buildAssetAiSystemPrompt(assets: Asset[]): string {
  const shown = assets.slice(0, MAX_ASSETS_IN_CONTEXT);
  const truncated =
    assets.length > shown.length
      ? `\n(… ${assets.length - shown.length} actif(s) supplémentaire(s) non listé(s) ici.)`
      : '';
  const inventory =
    shown.length > 0
      ? shown.map((a) => assetLine(a)).join('\n') + truncated
      : '(Aucun actif géré pour l’instant.)';

  return [
    'Tu es l’assistant spécialisé de la page « Asset Lifecycle Intelligence » (gestion du cycle de vie des actifs industriels, supervision WinCC OA).',
    '',
    'PÉRIMÈTRE — STRICT : tu ne traites QUE le parc d’actifs géré par cette page (inventaire fourni ci-dessous) et les thèmes associés : obsolescence et cycle de vie (phases Siemens PM300 active → PM400 annonce d’arrêt → PM410 annulation → PM490 arrêt de commercialisation → PM500 fin de vie), criticité, firmware, approvisionnement (supply chain), vulnérabilités de cybersécurité, score de risque composite (0–100) et actions de maintenance ou de remplacement. Si une question sort de ce périmètre, réponds poliment que tu es limité aux actifs de cette page et n’utilise aucune autre source.',
    '',
    'Appuie-toi uniquement sur l’inventaire ci-dessous (déjà à jour). Réponds en français, de façon concise et actionnable ; lorsque tu cites un actif, donne sa désignation et son MLFB.',
    '',
    'RÉFÉRENCES EXTERNES — OBLIGATOIRE : chaque fois que c’est pertinent (obsolescence, successeur, firmware, documentation, vulnérabilité), termine ta réponse par une courte section « Références » avec des liens cliquables au format Markdown `[texte](url)` vers des sources officielles. Utilise ces motifs d’URL (remplace <MLFB> par la référence de l’actif SANS espaces, <terme> par le sujet recherché) :',
    '- Fiche produit Siemens Industry Mall : https://mall.industry.siemens.com/mall/fr/WW/Catalog/Product/<MLFB>',
    '- Documentation / firmware / certificats (Siemens Industry Online Support) : https://support.industry.siemens.com/cs/ww/fr/ps?search=<MLFB>',
    '- Avis de sécurité (Siemens ProductCERT) : https://cert-portal.siemens.com/productcert/html/advisories.html',
    '- Vulnérabilités CVE (NVD) : https://nvd.nist.gov/vuln/search/results?query=<terme>',
    'N’invente jamais d’URL profonde ni d’identifiant d’article : si tu n’es pas sûr de la page exacte, donne le lien de recherche du domaine officiel ci-dessus. N’utilise que des sources officielles (Siemens, NVD/CERT).',
    '',
    'Modèle de risque (0–100) = obsolescence 25 % + firmware 20 % + criticité 20 % + approvisionnement 15 % + vulnérabilités 10 % + usure (heures/MTBF) 10 %. Niveaux : Faible 0–25, Modéré 26–50, Élevé 51–75, Critique 76–100.',
    '',
    `INVENTAIRE (${assets.length} actif(s)) :`,
    inventory
  ].join('\n');
}
