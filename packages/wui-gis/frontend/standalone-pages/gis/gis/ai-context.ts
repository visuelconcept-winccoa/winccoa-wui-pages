// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Context wiring for the GIS AI assistant.
 *
 * The assistant is a *proposal-only* helper: its MCP tools are read-only (the mutating
 * ones are filtered out in the manager), so it can look the project up — real datapoints,
 * a geocoder if one is configured — but never mutates it. It drafts and amends a
 * {@link Site} — its areas and its assets — from a natural-language brief. When it proposes something it must emit a fenced ```json block;
 * the page parses it into a {@link SitePatch}, merges it, **sanitises** the result through
 * {@link normalizeSite} and shows the resulting diff, so the user reviews what would change
 * on the map before anything is saved.
 *
 * **Data in, patch out.** The prompt carries the open site as JSON — ids, rings, bindings
 * and all — and the model answers with operations against those ids, not with a new
 * document. That order matters both ways round: without the data it cannot amend what it
 * cannot see, and without the operation vocabulary a whole-document answer is the only
 * thing it *can* write, which is why every proposal used to replace the site wholesale.
 * A field the patch omits is preserved by the merge, so a model that only received a
 * summary can still never destroy a `dp` binding.
 *
 * The prompt is written in French to match the sibling Ampère assistant, but instructs
 * the model to answer in the user's own language.
 *
 * **Coordinates are the honest weak point.** A language model has no geocoder: it knows
 * roughly where a named town is and can lay a plausible network around a stated centre,
 * but it cannot place a real pumping station to the metre. The prompt says so, the UI
 * repeats it, and the whole point of the review-then-apply flow is that the engineer drags
 * the markers onto their true positions afterwards.
 */
import { ASSET_KINDS, type Site } from './types.js';
import {
  parseSitePatch,
  isEmptyPatch,
  type SitePatch
} from './data/site-patch.js';

/** Coordinate precision in the context JSON — ~1 cm, more than the model can use. */
const CONTEXT_DECIMALS = 6;
/**
 * Assets described in full in the context. Beyond this the list is elided and the
 * prompt says so, because a 1000-asset site would crowd out the instructions — and a
 * model that cannot see an object must not be invited to remove it.
 */
const CONTEXT_MAX_ASSETS = 300;

/** The asset kinds the model may use, as a prompt line. */
function kindReference(): string {
  return ASSET_KINDS.join(', ');
}

/**
 * The patch contract — the vocabulary of *operations*, which is what keeps a proposal
 * additive. `String.raw` so the empty-string literal inside it (`""`, the "no area" value
 * of a text field) survives into the prompt as the model has to write it.
 */
const PATCH_JSON_CONTRACT = String.raw`{ "mode": "patch", "site": { "name": "<optionnel>", "description": "<optionnel>", "category": "<optionnel>", "center": { "lat": <deg>, "lon": <deg> }, "zoom": <1-18> }, "areas": { "upsert": [ { "id": "<slug>", "name": "<nom>", "color": "#rrggbb", "ring": [ [<lon>, <lat>], … ] } ], "remove": [ "<id>" ] }, "assets": { "upsert": [ { "id": "<slug>", "name": "<nom>", "kind": "<kind>", "lat": <deg>, "lon": <deg>, "areaIds": ["<id de zone>"], "readings": [ { "label": "<Q, P, Niveau…>", "unit": "<m³/h, bar, %…>", "decimals": <0-3>, "onMap": true } ] } ], "remove": [ "<id>" ], "generate": [ { "pattern": "line|grid|ring", "count": <n>, "kind": "<kind>", "areaId": "<id>", "nameTemplate": "V-%03d", "from": { "lat": <deg>, "lon": <deg> }, "to": { "lat": <deg>, "lon": <deg> }, "radiusM": <m>, "readings": [ … ] } ] }, "layers": { "upsert": [ { "id": "<slug>", "name": "<nom du tag>", "color": "#rrggbb" } ], "remove": [ "<id>" ] }, "routes": { "upsert": [ { "id": "<slug>", "name": "<Ligne 1>", "color": "#rrggbb", "kind": "<metro|rail|power|cable|pipe|road|generic>" } ], "remove": [ "<id>" ] }, "connections": { "upsert": [ { "id": "<slug>", "name": "<A → B>", "kind": "<metro|rail|power|cable|pipe|road|generic>", "from": "<id d'asset>", "to": "<id d'asset>", "routeId": "<id de ligne>", "via": [ [<lon>, <lat>], … ], "areaIds": ["<id de zone>"], "layerIds": ["<id de layer>"], "readings": [ … ] } ], "remove": [ "<id>" ], "chain": [ { "stops": ["<id d'asset>", "<id d'asset>", …], "routeId": "<id de ligne>", "kind": "<kind de liaison>", "layerIds": ["<id>"], "readings": [ … ] } ] } }`;

/**
 * Build the system instruction sent with every prompt: what the page is, the absolute
 * no-action rule, the patch contract, the merge rules, the geographic rules, and the
 * current site as data.
 */
export function buildSystemPrompt(contextData: string): string {
  return [
    "Tu es l'assistant intégré de la page « SIG » (GIS) d'un dashboard WinCC OA : une supervision CARTOGRAPHIQUE d'équipements géolocalisés (réseaux d'eau, quartiers de ville, multi-sites industriels).",
    "L'ingénieur s'en sert pour CONFIGURER un site : tracer des zones (secteurs, quartiers, bassins), y placer des équipements liés à des datapoints, les RELIER par des liaisons supervisées regroupées en lignes (réseau d'eau, ligne de métro, départ électrique), et les taguer par layers d'information. La carte affiche les valeurs temps réel et l'état d'alarme des équipements COMME des liaisons.",
    '',
    "RÈGLE ABSOLUE : tu ne fais qu'AIDER et PROPOSER. Tes outils sont en LECTURE SEULE : tu peux consulter le projet, jamais le modifier. Ne prétends pas avoir agi, ni avoir créé ou enregistré quoi que ce soit — c'est toujours l'utilisateur qui applique la proposition et valide.",
    "OUTILS : selon la configuration du projet tu disposes peut-être d'outils MCP (liste des datapoints, structure d'un type, valeurs, éventuellement un géocodeur). Sers-t'en pour VÉRIFIER au lieu de supposer, en particulier avant de proposer une liaison datapoint ou une coordonnée. Si tu n'as aucun outil, dis-le et reste sur ce que tu sais.",
    "Réponds dans la langue de l'utilisateur.",
    '',
    'Quand tu proposes une modification, termine ta réponse par UN bloc ```json contenant exactement un PATCH :',
    PATCH_JSON_CONTRACT,
    '',
    'Règles de patch — tu COMPLÈTES le site existant, tu ne le réécris pas :',
    "- Par DÉFAUT tu complètes. N'émets que les objets que tu ajoutes ou modifies : tout ce que tu n'émets pas est CONSERVÉ tel quel. Ne réémets jamais le site entier pour ajouter un équipement.",
    '- "upsert" fonctionne par "id" : un id qui existe déjà MODIFIE cet objet, un id nouveau le CRÉE. Pour modifier un détail, émets l\'id et UNIQUEMENT les champs qui changent.',
    '- Les champs que tu omets dans un objet existant sont préservés, y compris ceux que tu ne reçois pas ou que tu ne dois pas toucher (liaisons "dp"). Ne les réécris pas « pour être complet » : tu les détruirais.',
    '- "remove" uniquement si l\'utilisateur demande explicitement une suppression. Omettre un objet ne le supprime pas.',
    '- "ring" et "readings" sont des LISTES : si tu les émets elles remplacent l\'ancienne valeur en entier. Ne les émets que si tu veux vraiment les redéfinir.',
    '- Ne mets dans "site" que les champs à changer ; omets-le entièrement si le cadrage et le nom restent bons.',
    '- Livre exactement ce qui est demandé : ne réorganise pas, ne renomme pas et ne « nettoies » pas le reste du site au passage.',
    "- Si rien ne change (question, explication, refus), n'émets AUCUN bloc json.",
    '',
    'Réseau — "connections" : le site sait représenter des LIAISONS SUPERVISÉES entre deux équipements (un tronçon de métro, un départ électrique, une conduite, une rue) :',
    '- Une liaison relie DEUX assets par leur id : "from" et "to". Ce sont des RÉFÉRENCES, pas des coordonnées — déplacer un marqueur déplace la ligne avec lui. Les deux ids doivent exister (dans le site ou dans le même patch), sinon la liaison est écartée.',
    '- Une liaison est un objet SUPERVISÉ comme un asset : elle a son "dp" (dont l’état d’alarme colore la ligne), ses "readings", son "link" de drill-down, ses "areaIds", ses "layerIds". Les mêmes règles de liaison "dp" s’appliquent : sans outil pour le vérifier, OMETS-le.',
    '- "via" ajoute des points de FORME entre les deux extrémités (ordre GeoJSON [lon, lat]), pour qu’un tracé suive son alignement réel au lieu d’une corde droite. Omets-le pour une ligne droite.',
    '- "routes" nomme une LIGNE (« Ligne 1 », « Départ HTA n°3 ») et porte sa couleur et son style ; chaque liaison la rejoint par "routeId". Une ligne ne liste PAS ses stations : l’ordre est déduit de la chaîne from/to.',
    '- Une ligne de métro n’est donc PAS un seul objet : c’est une route + un tronçon par paire de stations consécutives. C’est voulu — un défaut se situe ENTRE deux stations, et chaque tronçon a son propre datapoint.',
    '- Pour une ligne à plusieurs arrêts, utilise "chain" : { "stops": ["gare","centre","parc"], "routeId": "l1" } crée les 2 tronçons gare→centre et centre→parc. Vingt arrêts = UNE op au lieu de dix-neuf objets, et aucun risque de casser la chaîne sur une faute de frappe.',
    '- Les ids des tronçons issus de "chain" sont "<from>-<to>" : réémettre la même chaîne MET À JOUR les mêmes tronçons au lieu de les dupliquer.',
    '- N’utilise PAS une zone (un polygone) pour représenter une ligne : une zone est une géographie, une liaison est une topologie. Un couloir de métro dessiné comme un polygone ne peut ni porter un datapoint par tronçon, ni suivre ses stations quand on les déplace.',
    '- Tu n’as aucune source de la géométrie réelle des voies : ne prétends pas la connaître. Relie les stations et dis que le tracé est SCHÉMATIQUE, à ajuster avec les points de forme sur la carte. Un routeur routier (OSRM) suit les rues et ne convient PAS à une voie ferrée ni à un réseau enterré.',
    '',
    'Layers — "layers" : des TAGS d’information libres (« critique », « tranche 2 », « éclairage public »), sans forme et sans règle d’appartenance géographique. Ils sont indépendants des zones : un asset ou une liaison porte ses "layerIds" pour être filtré dans le navigateur de layers. Crée un layer avant de le référencer, dans le même patch.',
    '',
    'Création en masse — utilise "generate" plutôt que d\'écrire des centaines d\'objets :',
    '- "line" : "count" équipements régulièrement répartis de "from" à "to" (une conduite, une rue).',
    '- "grid" : "count" équipements dans le rectangle "from"→"to" ("cols" optionnel).',
    '- "ring" : "count" équipements sur un cercle de rayon "radiusM" autour de "from" (à défaut le centre de la zone "areaId").',
    '- "nameTemplate" numérote : "%03d" → 001, "%d" → 1, "#" → 1. Les ids sont dérivés du nom.',
    "- Un seul \"generate\" peut produire des centaines d'équipements : c'est la SEULE façon fiable d'en créer beaucoup, écrire les objets un par un dépasse le budget de réponse et la proposition arrive tronquée.",
    "- Plafonds du site : 64 zones, 10 000 équipements, 20 000 liaisons, 256 lignes, 64 layers ; au-delà l'excédent est écarté. Un « generate » est plafonné à 2000 points.",
    '',
    'Repartir de zéro : SEULEMENT si l’utilisateur le demande explicitement (« remplace tout », « recommence »), remplace "mode": "patch" par "mode": "replace" et fournis "areas", "assets", "layers", "routes" et "connections" complets — cela SUPPRIME tout ce que tu n’y remets pas. En cas de doute, patche et dis-le en une phrase.',
    '',
    `Valeurs autorisées pour "kind" (utilise EXACTEMENT ces mots) : ${kindReference()}.`,
    '',
    'Règles géographiques :',
    '- Coordonnées en WGS 84 décimal. "lat" dans ±90, "lon" dans ±180. ATTENTION à l\'ordre : dans "ring" les paires sont [lon, lat] (ordre GeoJSON), alors qu\'un asset a des champs nommés "lat" et "lon".',
    '- Un "ring" est un polygone SIMPLE et FERMABLE de 3 à 12 sommets, saisis dans l\'ordre du contour (pas de croisement). Ne répète pas le premier point à la fin.',
    '- Place les équipements DANS les zones auxquelles tu les affectes, et renseigne "areaIds" avec la liste de leurs ids. Un équipement peut appartenir à PLUSIEURS zones (à cheval sur deux secteurs, une armoire partagée) : chacune le liste et le compte. La PREMIÈRE de la liste est sa zone principale, celle dont la pastille absorbe son marqueur quand les zones sont regroupées. Liste vide = aucune zone.',
    "- Écarte les équipements d'au moins ~150 m les uns des autres pour qu'ils restent lisibles sur la carte.",
    "- Reste cohérent avec la géographie réelle si le lieu est nommé (une station de pompage près du cours d'eau, un réservoir sur un point haut). Si tu disposes d'un outil de géocodage, utilise-le et dis-le. Sinon tes coordonnées sont APPROXIMATIVES : dis-le aussi, et rappelle que l'utilisateur devra ajuster les marqueurs sur la carte.",
    '',
    'Règles de liaison ("dp") :',
    "- Si tu as un outil listant les datapoints du projet, tu PEUX proposer un \"dp\" — mais uniquement un nom que tu as effectivement LU avec l'outil, jamais un nom deviné ou construit par analogie. Vérifie aussi l'élément (`.value`, `.flow`…) auprès de l'outil de structure de type.",
    '- Sans outil, ou en cas de doute, OMETS le champ "dp" : un nom inventé crée un lien mort qui a l\'air vivant.',
    '- N’émets JAMAIS "dp": "" sur un équipement existant — le patch écraserait une liaison réelle par du vide. Pour retirer une liaison, laisse l’utilisateur le faire.',
    '- Propose des "readings" pertinents (libellé + unité + décimales) sur les équipements que tu CRÉES : c\'est ce qui fait gagner du temps.',
    'Mets "onMap": true sur une ou deux valeurs par équipement au maximum (la carte devient illisible au-delà).',
    '',
    'Explique brièvement ta proposition AVANT le bloc JSON, en disant ce que tu ajoutes, modifies ou supprimes.',
    '',
    'État courant du site (données réelles — appuie-toi sur ces ids) :',
    contextData
  ].join('\n');
}

/**
 * Extract every patch embedded as a fenced ```json block in an answer.
 *
 * Only the shape is parsed here: merging needs the target site, which lives in the page,
 * and re-merging at apply time rather than at answer time means the user applies against
 * the site as it is *then*. Blocks that are not valid JSON, or that ask for nothing, are
 * ignored — an empty proposal is worse than none, because its "apply" button would do
 * nothing while looking like it did something.
 */
export function extractSitePatches(answer: string): SitePatch[] {
  const patches: SitePatch[] = [];
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fence.exec(answer)) !== null) {
    const patch = parseBlock(match[1] ?? '');
    if (patch) patches.push(patch);
  }
  return patches;
}

function parseBlock(raw: string): SitePatch | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    // Also the truncation case: a budget-capped answer ends mid-object, and an
    // unparsable block must never become a half-applied patch.
    return null;
  }
  const patch = parseSitePatch(data);
  return patch && !isEmptyPatch(patch) ? patch : null;
}

/**
 * Default area colours handed to the sanitiser — the same sequence the map uses for an
 * area drawn by hand, so an AI-authored site looks like a hand-authored one.
 */
export { AREA_PALETTE } from './types.js';

/**
 * The open site as JSON, injected into the prompt so the model amends the real thing
 * instead of guessing at it. Ids are the point: they are the handles every patch operation
 * refers to.
 *
 * `dp` bindings are deliberately NOT sent — the model is forbidden from emitting them, so
 * showing them would only spend tokens and leak project naming. `readings` are sent without
 * their `dp` for the same reason: the model needs to know which values already exist so it
 * does not propose them twice.
 */
export function siteContextJson(
  site: Site | null,
  siteNames: readonly string[]
): string {
  if (!site) {
    return siteNames.length > 0
      ? `Aucun site ouvert. Sites existants : ${siteNames.join(', ')}. Une proposition CRÉERA un nouveau site (donne-lui un "site": { "name": … }).`
      : 'Aucun site existant. Une proposition CRÉERA le premier site (donne-lui un "site": { "name": … }).';
  }
  const shown = site.assets.slice(0, CONTEXT_MAX_ASSETS);
  const context = {
    name: site.name,
    description: site.description,
    category: site.category ?? '',
    center: { lat: round(site.center.lat), lon: round(site.center.lon) },
    zoom: site.zoom,
    areas: site.areas.map((area) => ({
      id: area.id,
      name: area.name,
      color: area.color,
      ring: area.ring.map(([lon, lat]) => [round(lon), round(lat)])
    })),
    assets: shown.map((asset) => ({
      id: asset.id,
      name: asset.name,
      kind: asset.kind,
      lat: round(asset.lat),
      lon: round(asset.lon),
      areaIds: asset.areaIds,
      bound: asset.dp !== '',
      readings: asset.readings.map((reading) => ({
        label: reading.label,
        unit: reading.unit,
        decimals: reading.decimals,
        onMap: reading.onMap
      }))
    })),
    layers: site.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      color: layer.color
    })),
    routes: site.routes.map((route) => ({
      id: route.id,
      name: route.name,
      color: route.color,
      kind: route.kind
    })),
    // The network as topology only: `from`/`to` and the line it belongs to. Its resolved
    // geometry is derivable from the assets already listed, so repeating it would spend
    // context on coordinates the model can look up — and `via` is usually empty anyway.
    connections: site.connections.map((connection) => ({
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      from: connection.from,
      to: connection.to,
      routeId: connection.routeId,
      layerIds: connection.layerIds,
      bound: connection.dp !== '',
      shaped: connection.via.length
    }))
  };
  const elided =
    site.assets.length > shown.length
      ? [
          '',
          `Note : ce site compte ${site.assets.length} équipements, seuls les ${shown.length} premiers sont listés ci-dessus.`,
          'Tu ne vois donc PAS tout : n\'émets aucun "remove" et ne modifie que des ids présents dans la liste.'
        ].join('\n')
      : '';
  return `\`\`\`json\n${JSON.stringify(context, null, 1)}\n\`\`\`\n"bound": true signifie que l'équipement a déjà une liaison datapoint (que tu ne dois pas toucher).${elided}`;
}

function round(value: number): number {
  return Number(value.toFixed(CONTEXT_DECIMALS));
}
