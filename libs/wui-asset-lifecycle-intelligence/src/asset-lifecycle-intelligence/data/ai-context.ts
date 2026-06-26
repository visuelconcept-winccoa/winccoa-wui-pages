/**
 * AI assistant scoping for the Asset Lifecycle Intelligence page.
 *
 * Builds the `system` instruction sent with every chat prompt so the assistant
 * answers ONLY about the assets managed by this page: it states the domain and
 * guard-rails, explains the composite risk model, and injects a compact snapshot
 * of the current inventory (designation, MLFB, computed risk, and the fields
 * that drive it). Also exposes the preset prompts shown in the chat panel.
 */
import { getLanguage } from '@wincc-oa/wui-i18n-shared/localize-base.js';
import { localize, ml } from '../i18n.js';
import { bandForLevel, computeRisk } from '../risk.js';
import {
  CRITICALITY_LABELS,
  FIRMWARE_LABELS,
  PHASE_LABELS,
  SUPPLY_LABELS,
  VULN_LABELS,
  type Asset
} from '../types.js';

/** Resolve a tri-lingual label to the active UI language (for the localized AI prompt). */
const tr = (m: import('@wincc-oa/wui-models/interfaces/multi-lang-string.js').MultiLangString): string => localize(m);

/** Siemens site language segment for the active UI language (fallback English). */
function siemensLangSeg(): string {
  const lang = getLanguage();
  return ['en', 'fr', 'de', 'es', 'it', 'zh', 'pt'].includes(lang) ? lang : 'en';
}

/** Hard cap on injected assets to keep the context bounded for very large parks. */
const MAX_ASSETS_IN_CONTEXT = 200;

/** Preset prompts offered as clickable chips when the chat is empty (tri-lingual). */
const ASSET_AI_SUGGESTIONS_ML = [
  ml(
    'Which assets carry the highest risk, and why?',
    'Quels actifs présentent le risque le plus élevé, et pourquoi ?',
    'Welche Anlagen tragen das höchste Risiko, und warum?'
  ),
  ml(
    'Which assets are obsolete or end-of-life and should be replaced first?',
    'Quels actifs sont obsolètes ou en fin de vie à remplacer en priorité ?',
    'Welche Anlagen sind obsolet oder am Lebensende und sollten zuerst ersetzt werden?'
  ),
  ml(
    'Which critical assets have a long or out-of-stock supply lead time?',
    'Quels actifs critiques ont un approvisionnement long ou en rupture ?',
    'Welche kritischen Anlagen haben lange oder nicht verfügbare Lieferzeiten?'
  ),
  ml(
    'Which assets have a firmware gap or a vulnerability to address?',
    'Quels actifs ont un écart de firmware ou une vulnérabilité à traiter ?',
    'Welche Anlagen haben eine Firmware-Abweichung oder eine zu behebende Schwachstelle?'
  ),
  ml(
    'Propose a prioritized maintenance action plan for the fleet.',
    'Propose un plan d’action de maintenance priorisé pour le parc.',
    'Schlage einen priorisierten Wartungsplan für den Bestand vor.'
  )
];

/** The preset AI prompts, resolved to the active UI language. */
export function assetAiSuggestions(): string[] {
  return ASSET_AI_SUGGESTIONS_ML.map((m) => localize(m));
}

/** One inventory line: designation, MLFB, computed risk, and the risk drivers. */
function assetLine(asset: Asset): string {
  const risk = computeRisk(asset);
  const band = bandForLevel(risk.level);
  const parts = [
    `« ${asset.name} »`,
    `MLFB ${asset.mlfb || '—'}`,
    `risk ${risk.score} (${tr(band.label)})`,
    `phase ${tr(PHASE_LABELS[asset.phase])}`,
    `criticality ${tr(CRITICALITY_LABELS[asset.criticality])}`,
    `supply ${tr(SUPPLY_LABELS[asset.supply])}`,
    `vuln ${tr(VULN_LABELS[asset.vuln])}`,
    `firmware ${tr(FIRMWARE_LABELS[asset.firmware])}`
  ];
  if (asset.area) parts.push(`workshop ${asset.area}`);
  if (asset.station) parts.push(`station ${asset.station}`);
  if (asset.successor) parts.push(`successor ${asset.successor}`);
  return `- ${parts.join(' | ')}`;
}

/** Build the scoped system instruction from the current asset inventory (localized to the active UI language). */
// eslint-disable-next-line max-lines-per-function -- single localized prompt template
export function buildAssetAiSystemPrompt(assets: Asset[]): string {
  const seg = siemensLangSeg();
  const shown = assets.slice(0, MAX_ASSETS_IN_CONTEXT);
  const extra = assets.length - shown.length;
  const truncated = extra > 0 ? '\n' + tr(ml(`(… ${extra} more asset(s) not listed here.)`, `(… ${extra} actif(s) supplémentaire(s) non listé(s) ici.)`, `(… ${extra} weitere(s) Asset(s) hier nicht aufgeführt.)`)) : '';
  const inventory =
    shown.length > 0
      ? shown.map((a) => assetLine(a)).join('\n') + truncated
      : tr(ml('(No managed assets yet.)', '(Aucun actif géré pour l’instant.)', '(Noch keine verwalteten Assets.)'));

  return [
    tr(
      ml(
        'You are the specialized assistant of the "Asset Lifecycle Intelligence" page (industrial asset lifecycle management, WinCC OA supervision).',
        'Tu es l’assistant spécialisé de la page « Asset Lifecycle Intelligence » (gestion du cycle de vie des actifs industriels, supervision WinCC OA).',
        'Du bist der spezialisierte Assistent der Seite „Asset Lifecycle Intelligence" (Lebenszyklusmanagement industrieller Anlagen, WinCC OA-Überwachung).'
      )
    ),
    '',
    tr(
      ml(
        'STRICT SCOPE: you only handle the asset fleet managed by this page (inventory below) and the related topics: obsolescence and lifecycle (Siemens phases PM300 active → PM400 phase-out → PM410 cancellation → PM490 discontinuation → PM500 end of life), criticality, firmware, supply chain, cybersecurity vulnerabilities, composite risk score (0–100) and maintenance/replacement actions. If a question is out of scope, politely reply that you are limited to this page\'s assets and use no other source.',
        'PÉRIMÈTRE — STRICT : tu ne traites QUE le parc d’actifs géré par cette page (inventaire fourni ci-dessous) et les thèmes associés : obsolescence et cycle de vie (phases Siemens PM300 active → PM400 annonce d’arrêt → PM410 annulation → PM490 arrêt de commercialisation → PM500 fin de vie), criticité, firmware, approvisionnement (supply chain), vulnérabilités de cybersécurité, score de risque composite (0–100) et actions de maintenance ou de remplacement. Si une question sort de ce périmètre, réponds poliment que tu es limité aux actifs de cette page et n’utilise aucune autre source.',
        'STRIKTER UMFANG: Du behandelst NUR den von dieser Seite verwalteten Anlagenbestand (Inventar unten) und die zugehörigen Themen: Obsoleszenz und Lebenszyklus (Siemens-Phasen PM300 aktiv → PM400 Abkündigung → PM410 Stornierung → PM490 Auslauf → PM500 Lebensende), Kritikalität, Firmware, Lieferkette, Cybersicherheits-Schwachstellen, zusammengesetzter Risiko-Score (0–100) und Wartungs-/Austauschmaßnahmen. Bei Fragen außerhalb des Umfangs antworte höflich, dass du auf die Anlagen dieser Seite beschränkt bist, und nutze keine andere Quelle.'
      )
    ),
    '',
    tr(
      ml(
        'Rely only on the inventory below (already up to date). ALWAYS answer in the user\'s language, concisely and actionably; when you cite an asset, give its designation and MLFB.',
        'Appuie-toi uniquement sur l’inventaire ci-dessous (déjà à jour). Réponds TOUJOURS dans la langue de l’utilisateur, de façon concise et actionnable ; lorsque tu cites un actif, donne sa désignation et son MLFB.',
        'Stütze dich nur auf das Inventar unten (bereits aktuell). Antworte IMMER in der Sprache des Benutzers, prägnant und umsetzbar; wenn du eine Anlage zitierst, gib ihre Bezeichnung und MLFB an.'
      )
    ),
    '',
    tr(
      ml(
        'EXTERNAL REFERENCES — REQUIRED: whenever relevant (obsolescence, successor, firmware, documentation, vulnerability), end your answer with a short "References" section with clickable Markdown links `[text](url)` to official sources. Use these URL patterns (replace <MLFB> with the asset reference WITHOUT spaces, <term> with the searched topic):',
        'RÉFÉRENCES EXTERNES — OBLIGATOIRE : chaque fois que c’est pertinent (obsolescence, successeur, firmware, documentation, vulnérabilité), termine ta réponse par une courte section « Références » avec des liens cliquables au format Markdown `[texte](url)` vers des sources officielles. Utilise ces motifs d’URL (remplace <MLFB> par la référence de l’actif SANS espaces, <terme> par le sujet recherché) :',
        'EXTERNE REFERENZEN — ERFORDERLICH: Wann immer relevant (Obsoleszenz, Nachfolger, Firmware, Dokumentation, Schwachstelle), beende deine Antwort mit einem kurzen Abschnitt „Referenzen" mit anklickbaren Markdown-Links `[Text](url)` zu offiziellen Quellen. Verwende diese URL-Muster (ersetze <MLFB> durch die Anlagenreferenz OHNE Leerzeichen, <term> durch das gesuchte Thema):'
      )
    ),
    `- Siemens Industry Mall: https://mall.industry.siemens.com/mall/${seg}/WW/Catalog/Product/<MLFB>`,
    `- Siemens Industry Online Support: https://support.industry.siemens.com/cs/ww/${seg}/ps?search=<MLFB>`,
    '- Siemens ProductCERT: https://cert-portal.siemens.com/productcert/html/advisories.html',
    '- NVD CVE: https://nvd.nist.gov/vuln/search/results?query=<term>',
    tr(
      ml(
        'Never invent a deep URL or article id: if unsure of the exact page, give the official domain search link above. Use only official sources (Siemens, NVD/CERT).',
        'N’invente jamais d’URL profonde ni d’identifiant d’article : si tu n’es pas sûr de la page exacte, donne le lien de recherche du domaine officiel ci-dessus. N’utilise que des sources officielles (Siemens, NVD/CERT).',
        'Erfinde nie eine tiefe URL oder Artikel-ID: Wenn du dir der genauen Seite nicht sicher bist, gib den offiziellen Domain-Suchlink oben an. Nutze nur offizielle Quellen (Siemens, NVD/CERT).'
      )
    ),
    '',
    tr(
      ml(
        'Risk model (0–100) = obsolescence 25% + firmware 20% + criticality 20% + supply 15% + vulnerabilities 10% + wear (hours/MTBF) 10%. Levels: Low 0–25, Moderate 26–50, High 51–75, Critical 76–100.',
        'Modèle de risque (0–100) = obsolescence 25 % + firmware 20 % + criticité 20 % + approvisionnement 15 % + vulnérabilités 10 % + usure (heures/MTBF) 10 %. Niveaux : Faible 0–25, Modéré 26–50, Élevé 51–75, Critique 76–100.',
        'Risikomodell (0–100) = Obsoleszenz 25 % + Firmware 20 % + Kritikalität 20 % + Lieferkette 15 % + Schwachstellen 10 % + Verschleiß (Stunden/MTBF) 10 %. Stufen: Niedrig 0–25, Mäßig 26–50, Hoch 51–75, Kritisch 76–100.'
      )
    ),
    '',
    tr(ml(`INVENTORY (${assets.length} asset(s)):`, `INVENTAIRE (${assets.length} actif(s)) :`, `INVENTAR (${assets.length} Asset(s)):`)),
    inventory
  ].join('\n');
}
