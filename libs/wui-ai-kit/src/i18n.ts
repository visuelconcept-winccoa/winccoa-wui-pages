// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the shared AI assistant UI (prompt bar + config
 * dialog). Strings follow the active WebUI language via the shared
 * `lit-translate` singleton. Use `localizeDir(...)` in templates (reactive) and
 * `localize(...)` for plain-string attributes (title/placeholder).
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** AI assistant UI strings. */
export const AI_MSG = {
  title: ml('AI assistant', 'Assistant IA', 'KI-Assistent'),
  clear: ml('Clear conversation', 'Effacer la conversation', 'Konversation löschen'),
  configure: ml(
    'Configure the AI (provider, model, token, MCP servers)',
    'Configurer l’IA (fournisseur, modèle, token, serveurs MCP)',
    'KI konfigurieren (Anbieter, Modell, Token, MCP-Server)'
  ),
  close: ml('Close', 'Fermer', 'Schließen'),
  thinking: ml('The assistant is thinking…', 'L’assistant réfléchit…', 'Der Assistent denkt nach…'),
  composerPlaceholder: ml(
    'Write your message… (Ctrl+Enter to send)',
    'Écrivez votre message… (Ctrl+Entrée pour envoyer)',
    'Nachricht schreiben… (Strg+Enter zum Senden)'
  ),
  send: ml('Send', 'Envoyer', 'Senden'),
  ask: ml('Ask the AI assistant a question…', 'Posez une question à l’assistant IA…', 'Stellen Sie dem KI-Assistenten eine Frage…'),
  tools: ml('Tools:', 'Outils :', 'Werkzeuge:'),
  toolShow: ml(
    'Show what this tool was asked and what it returned',
    'Voir ce qui a été demandé à cet outil et ce qu’il a répondu',
    'Anzeigen, was dieses Werkzeug gefragt wurde und was es geantwortet hat'
  ),
  toolArgs: ml('Request', 'Requête', 'Anfrage'),
  toolResult: ml('Result', 'Réponse', 'Antwort'),
  usingTools: ml(
    'Reading the project through its tools…',
    'Consultation du projet via ses outils…',
    'Projekt wird über die Werkzeuge gelesen…'
  ),
  // Live progress. `%n` is substituted with the count / round number.
  reasoning: ml('Reasoning:', 'Raisonnement :', 'Überlegung:'),
  stepTools: ml('%n tools available', '%n outils disponibles', '%n Werkzeuge verfügbar'),
  stepModel: ml('model, round %n', 'modèle, tour %n', 'Modell, Runde %n'),
  success: ml('Success', 'Succès', 'Erfolg'),
  failure: ml('Failure', 'Échec', 'Fehler'),
  emptyAnswer: ml('(empty response)', '(réponse vide)', '(leere Antwort)'),

  // config dialog
  cfgTitle: ml('AI assistant configuration', 'Configuration de l’assistant IA', 'Konfiguration des KI-Assistenten'),
  provider: ml('Provider', 'Fournisseur', 'Anbieter'),
  model: ml('Model', 'Modèle', 'Modell'),
  token: ml('API token', 'Token API', 'API-Token'),
  webSearch: ml('Web search', 'Recherche web', 'Web-Suche'),
  webSearchHint: ml(
    'Lets the model search the web itself for anything outside the project (standards, device documentation, error codes). Enabled by default; supported by Anthropic (Claude) and Google Gemini, ignored by OpenAI and Mistral. The search runs at the provider, never on the WinCC OA project.',
    'Permet au modèle de chercher lui-même sur le web ce qui n’est pas dans le projet (normes, documentation d’appareils, codes d’erreur). Activée par défaut ; prise en charge par Anthropic (Claude) et Google Gemini, ignorée par OpenAI et Mistral. La recherche s’exécute chez le fournisseur, jamais sur le projet WinCC OA.',
    'Erlaubt dem Modell, selbst im Web nach Dingen außerhalb des Projekts zu suchen (Normen, Gerätedokumentation, Fehlercodes). Standardmäßig aktiviert; unterstützt von Anthropic (Claude) und Google Gemini, von OpenAI und Mistral ignoriert. Die Suche läuft beim Anbieter, nie im WinCC OA-Projekt.'
  ),
  effort: ml('Effort', 'Effort', 'Aufwand'),
  effortHint: ml(
    'Latency lever: the lower the effort, the faster and cheaper the answer, at the cost of depth. Default “medium”. Honored by Anthropic (Claude) and the OpenAI reasoning models (o-series), ignored by Mistral and Gemini.',
    'Levier de latence : plus l’effort est bas, plus la réponse est rapide et économique, au prix de la profondeur. Défaut « medium ». Pris en compte par Anthropic (Claude) et les modèles de raisonnement OpenAI (série o), ignoré par Mistral et Gemini.',
    'Latenz-Regler: je niedriger der Aufwand, desto schneller und günstiger die Antwort — auf Kosten der Tiefe. Standard „medium“. Berücksichtigt von Anthropic (Claude) und den OpenAI-Reasoning-Modellen (o-Reihe), von Mistral und Gemini ignoriert.'
  ),
  maxTokens: ml('Output budget (tokens)', 'Budget de sortie (tokens)', 'Ausgabebudget (Tokens)'),
  maxTokensHint: ml(
    'Ceiling on one answer. Too low and a long answer — a JSON proposal in particular — is cut mid-object and becomes unusable; too high only costs latency on the answers that actually need it. Default 32768. On the Claude 5 family this budget covers reasoning AND text.',
    'Plafond d’une réponse. Trop bas, une réponse longue — en particulier une proposition JSON — est coupée en plein objet et devient inutilisable ; trop haut ne coûte que de la latence sur les réponses qui en ont besoin. Défaut 32768. Sur la famille Claude 5 ce budget couvre le raisonnement ET le texte.',
    'Obergrenze für eine Antwort. Zu niedrig, und eine lange Antwort — besonders ein JSON-Vorschlag — wird mitten im Objekt abgeschnitten und ist unbrauchbar; zu hoch kostet nur Latenz bei den Antworten, die es brauchen. Standard 32768. Bei der Claude-5-Familie deckt dieses Budget Denken UND Text ab.'
  ),
  effortLow: ml('low — fastest', 'low — le plus rapide', 'low — am schnellsten'),
  effortMedium: ml('medium — balanced (default)', 'medium — équilibré (défaut)', 'medium — ausgewogen (Standard)'),
  effortHigh: ml('high — thorough', 'high — approfondi', 'high — gründlich'),
  effortXhigh: ml('xhigh — very thorough', 'xhigh — très approfondi', 'xhigh — sehr gründlich'),
  effortMax: ml('max — slowest', 'max — le plus lent', 'max — am langsamsten'),
  mcpServers: ml('MCP servers', 'Serveurs MCP', 'MCP-Server'),
  add: ml('Add', 'Ajouter', 'Hinzufügen'),
  noMcp: ml('No MCP server', 'Aucun serveur MCP', 'Kein MCP-Server'),
  mcpHint: ml(
    'The manager connects LOCALLY to these MCP servers and runs the tools for the LLM (agentic loop) — no public exposure required; the WinCC OA MCP server on localhost works directly. Provide the token if the server requires it (WinCC OA: MCP_API_TOKEN).',
    'Le manager se connecte localement à ces serveurs MCP et exécute les outils pour le LLM (boucle agentique) — aucune exposition publique requise, le serveur MCP WinCC OA en localhost fonctionne directement. Renseignez le token si le serveur l’exige (WinCC OA : MCP_API_TOKEN).',
    'Der Manager verbindet sich LOKAL mit diesen MCP-Servern und führt die Werkzeuge für das LLM aus (agentische Schleife) — keine öffentliche Freigabe nötig; der WinCC OA MCP-Server auf localhost funktioniert direkt. Token angeben, falls der Server es verlangt (WinCC OA: MCP_API_TOKEN).'
  ),
  mcpServer: ml('MCP server', 'Serveur MCP', 'MCP-Server'),
  removeServer: ml('Remove this server', 'Retirer ce serveur', 'Diesen Server entfernen'),
  nameLbl: ml('Name', 'Nom', 'Name'),
  nameHint: ml(
    '— free server identifier (display only)',
    '— identifiant libre du serveur (affichage uniquement)',
    '— freier Server-Bezeichner (nur Anzeige)'
  ),
  urlHint: ml(
    '— MCP endpoint (Streamable-HTTP) the manager connects to',
    '— endpoint MCP (Streamable-HTTP) auquel le manager se connecte',
    '— MCP-Endpunkt (Streamable-HTTP), mit dem sich der Manager verbindet'
  ),
  tokenHint: ml(
    '— optional Bearer auth token (leave empty if not required)',
    '— jeton Bearer d’authentification, optionnel (laisser vide si non requis)',
    '— optionales Bearer-Authentifizierungstoken (leer lassen, wenn nicht erforderlich)'
  ),
  tokenPlaceholder: ml('(none by default)', '(aucun par défaut)', '(standardmäßig keiner)'),
  cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
  save: ml('Save', 'Enregistrer', 'Speichern'),
  saveLateFailed: ml(
    'Provider, model, token and MCP servers were saved, but these settings could not be: the AI_Assistant_Config datapoint type does not carry them yet. Restart the aiAssistant manager, or ask for the PARA “edit-types” role, then save again',
    'Le fournisseur, le modèle, le token et les serveurs MCP ont été enregistrés, mais pas ces réglages : le type de datapoint AI_Assistant_Config ne les contient pas encore. Redémarrez le manager aiAssistant, ou demandez le rôle PARA « edit-types », puis enregistrez de nouveau',
    'Anbieter, Modell, Token und MCP-Server wurden gespeichert, diese Einstellungen jedoch nicht: der Datenpunkttyp AI_Assistant_Config enthält sie noch nicht. Starten Sie den aiAssistant-Manager neu oder fordern Sie die PARA-Rolle „edit-types“ an, und speichern Sie erneut'
  )
};
