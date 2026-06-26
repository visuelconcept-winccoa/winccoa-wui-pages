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
  success: ml('Success', 'Succès', 'Erfolg'),
  failure: ml('Failure', 'Échec', 'Fehler'),
  emptyAnswer: ml('(empty response)', '(réponse vide)', '(leere Antwort)'),

  // config dialog
  cfgTitle: ml('AI assistant configuration', 'Configuration de l’assistant IA', 'Konfiguration des KI-Assistenten'),
  provider: ml('Provider', 'Fournisseur', 'Anbieter'),
  model: ml('Model', 'Modèle', 'Modell'),
  token: ml('API token', 'Token API', 'API-Token'),
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
  save: ml('Save', 'Enregistrer', 'Speichern')
};
