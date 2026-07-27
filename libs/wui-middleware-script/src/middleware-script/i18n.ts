// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Middleware-Script page (tri-lingual EN/FR/DE
 * MultiLangStrings, same conventions as the other wui-* pages: `localizeDir`
 * in templates, `localize` for plain strings).
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

export const MSG = {
  page: {
    newTask: ml('New task', 'Nouvelle tâche', 'Neue Aufgabe'),
    noTasks: ml(
      'No task yet. Create one to implement logic between datapoints.',
      'Aucune tâche. Créez-en une pour implémenter une logique entre datapoints.',
      'Noch keine Aufgabe. Erstellen Sie eine, um Logik zwischen Datenpunkten zu implementieren.'
    ),
    selectTask: ml(
      'Select a task on the left, or create a new one.',
      'Sélectionnez une tâche à gauche, ou créez-en une nouvelle.',
      'Wählen Sie links eine Aufgabe aus oder erstellen Sie eine neue.'
    ),
    offline: ml(
      'Backend unreachable — tasks are edited in memory only.',
      'Backend injoignable — les tâches ne sont éditées qu’en mémoire.',
      'Backend nicht erreichbar — Aufgaben werden nur im Speicher bearbeitet.'
    ),
    defaultTaskName: ml('New task', 'Nouvelle tâche', 'Neue Aufgabe')
  },
  list: {
    filter: ml('Filter tasks…', 'Filtrer les tâches…', 'Aufgaben filtern…'),
    reload: ml('Reload', 'Recharger', 'Neu laden'),
    enabled: ml('Enabled', 'Activée', 'Aktiviert'),
    disabled: ml('Disabled', 'Désactivée', 'Deaktiviert'),
    stateIdle: ml('Idle', 'En attente', 'Bereit'),
    stateRunning: ml('Running', 'En cours', 'Läuft'),
    stateError: ml('Error', 'Erreur', 'Fehler'),
    stateDisabled: ml('Disabled', 'Désactivée', 'Deaktiviert'),
    stateUnknown: ml('No status (manager stopped?)', 'Pas de statut (manager arrêté ?)', 'Kein Status (Manager gestoppt?)'),
    triggerDpe: ml('on DP change', 'sur changement de DP', 'bei DP-Änderung'),
    triggerCyclic: ml('cyclic', 'cyclique', 'zyklisch')
  },
  editor: {
    tabScript: ml('Script', 'Script', 'Skript'),
    tabIo: ml('Inputs / outputs & trigger', 'Entrées / sorties & déclencheur', 'Ein-/Ausgänge & Auslöser'),
    tabTest: ml('Test', 'Test', 'Test'),
    name: ml('Task name', 'Nom de la tâche', 'Aufgabenname'),
    description: ml('Description', 'Description', 'Beschreibung'),
    enable: ml('Task enabled (runs on the manager)', 'Tâche activée (exécutée par le manager)', 'Aufgabe aktiviert (läuft auf dem Manager)'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    delete: ml('Delete the task', 'Supprimer la tâche', 'Aufgabe löschen'),
    deleteConfirm: ml(
      'Delete this task? This cannot be undone.',
      'Supprimer cette tâche ? Cette action est irréversible.',
      'Diese Aufgabe löschen? Dies kann nicht rückgängig gemacht werden.'
    ),
    saved: ml('Task saved.', 'Tâche enregistrée.', 'Aufgabe gespeichert.'),
    deleted: ml('Task deleted.', 'Tâche supprimée.', 'Aufgabe gelöscht.'),
    unsaved: ml('Unsaved changes', 'Modifications non enregistrées', 'Ungespeicherte Änderungen'),
    // --- IO & trigger tab ---
    triggerHead: ml('Trigger', 'Déclencheur', 'Auslöser'),
    triggerDpe: ml('On declared-input change', 'Sur changement d’une entrée déclarée', 'Bei Änderung eines deklarierten Eingangs'),
    triggerCyclic: ml('Cyclic', 'Cyclique', 'Zyklisch'),
    debounce: ml('Debounce (ms)', 'Anti-rebond (ms)', 'Entprellung (ms)'),
    interval: ml('Period (s)', 'Période (s)', 'Periode (s)'),
    timeout: ml('Script timeout (ms)', 'Timeout du script (ms)', 'Skript-Timeout (ms)'),
    inputsHead: ml('Inputs (read)', 'Entrées (lecture)', 'Eingänge (lesen)'),
    outputsHead: ml('Outputs (write)', 'Sorties (écriture)', 'Ausgänge (schreiben)'),
    alias: ml('Alias', 'Alias', 'Alias'),
    dpe: ml('Datapoint element', 'Élément de datapoint', 'Datenpunkt-Element'),
    dpePlaceholder: ml('System1:Dp1.element', 'System1:Dp1.element', 'System1:Dp1.element'),
    addInput: ml('Add an input', 'Ajouter une entrée', 'Eingang hinzufügen'),
    addOutput: ml('Add an output', 'Ajouter une sortie', 'Ausgang hinzufügen'),
    removeRow: ml('Remove', 'Retirer', 'Entfernen'),
    probe: ml('Check that the DPE exists', 'Vérifier que le DPE existe', 'Prüfen, ob das DPE existiert'),
    probeOk: ml('DPE found', 'DPE trouvé', 'DPE gefunden'),
    probeKo: ml('DPE not readable', 'DPE illisible', 'DPE nicht lesbar'),
    ioHint: ml(
      'The script reads `inputs.<alias>` and writes ONLY via `output(alias, value)` on declared outputs.',
      'Le script lit `inputs.<alias>` et écrit UNIQUEMENT via `output(alias, valeur)` sur les sorties déclarées.',
      'Das Skript liest `inputs.<alias>` und schreibt NUR über `output(alias, wert)` auf deklarierte Ausgänge.'
    ),
    // --- script tab ---
    scriptHint: ml(
      'Synchronous JavaScript body. Available: inputs.<alias>, output(alias, value), log(…), Math, JSON. No require/network/DP access.',
      'Corps JavaScript synchrone. Disponible : inputs.<alias>, output(alias, valeur), log(…), Math, JSON. Pas de require/réseau/accès DP.',
      'Synchroner JavaScript-Rumpf. Verfügbar: inputs.<alias>, output(alias, wert), log(…), Math, JSON. Kein require/Netzwerk/DP-Zugriff.'
    ),
    syntaxOk: ml('Syntax OK', 'Syntaxe OK', 'Syntax OK'),
    syntaxError: ml('Syntax error', 'Erreur de syntaxe', 'Syntaxfehler')
  },
  test: {
    head: ml('Sandbox dry-run', 'Test à blanc (sandbox)', 'Testlauf (Sandbox)'),
    hint: ml(
      'Runs the CURRENT draft in the server sandbox with the values below. No output datapoint is written.',
      'Exécute le brouillon COURANT dans la sandbox serveur avec les valeurs ci-dessous. Aucun datapoint de sortie n’est écrit.',
      'Führt den AKTUELLEN Entwurf mit den Werten unten in der Server-Sandbox aus. Kein Ausgangs-Datenpunkt wird geschrieben.'
    ),
    inputValues: ml('Input values', 'Valeurs d’entrée', 'Eingangswerte'),
    loadLive: ml('Load live values', 'Charger les valeurs live', 'Live-Werte laden'),
    run: ml('Run the test', 'Lancer le test', 'Test ausführen'),
    noInputs: ml('This task declares no input.', 'Cette tâche ne déclare aucune entrée.', 'Diese Aufgabe deklariert keinen Eingang.'),
    outputs: ml('Computed outputs', 'Sorties calculées', 'Berechnete Ausgänge'),
    noOutput: ml('(no output was written)', '(aucune sortie n’a été écrite)', '(keine Ausgabe wurde geschrieben)'),
    logs: ml('Logs', 'Logs', 'Logs'),
    duration: ml('Duration', 'Durée', 'Dauer'),
    noRole: ml(
      'The "test" role is required to run a dry-run.',
      'Le rôle « test » est requis pour lancer un test.',
      'Für einen Testlauf ist die Rolle „test“ erforderlich.'
    )
  }
} as const;

// ----- Dynamic plain-string helpers ------------------------------------------

/** Task-list load failure (plain string). */
export function loadFailedMsg(detail: string): string {
  return localize(
    ml(`Could not load tasks: ${detail}`, `Impossible de charger les tâches : ${detail}`, `Aufgaben konnten nicht geladen werden: ${detail}`)
  );
}

/** Save failure (plain string). */
export function saveFailedMsg(detail: string): string {
  return localize(
    ml(`Save failed: ${detail}`, `Échec de l’enregistrement : ${detail}`, `Speichern fehlgeschlagen: ${detail}`)
  );
}

/** Test-request failure (plain string). */
export function testFailedMsg(detail: string): string {
  return localize(ml(`Test failed: ${detail}`, `Test échoué : ${detail}`, `Test fehlgeschlagen: ${detail}`));
}

/** Test bridge unreachable / manager down (plain string). */
export function testUnavailableMsg(status: number): string {
  return localize(
    ml(
      `Test service unavailable (HTTP ${status}) — is the middlewareScript manager running?`,
      `Service de test indisponible (HTTP ${status}) — le manager middlewareScript est-il démarré ?`,
      `Testdienst nicht verfügbar (HTTP ${status}) — läuft der middlewareScript-Manager?`
    )
  );
}

/** Validation error keys (types.ts validateTask) → localized message. */
export function validationMsg(key: string): string {
  const table: Record<string, MultiLangString> = {
    nameRequired: ml('The task name is required.', 'Le nom de la tâche est requis.', 'Der Aufgabenname ist erforderlich.'),
    scriptRequired: ml('The script is empty.', 'Le script est vide.', 'Das Skript ist leer.'),
    intervalRequired: ml(
      'A cyclic task needs a period > 0 s.',
      'Une tâche cyclique requiert une période > 0 s.',
      'Eine zyklische Aufgabe benötigt eine Periode > 0 s.'
    ),
    dpeTriggerNeedsInput: ml(
      'A DP-change trigger needs at least one input.',
      'Un déclencheur sur changement de DP requiert au moins une entrée.',
      'Ein DP-Änderungs-Auslöser benötigt mindestens einen Eingang.'
    ),
    badAlias: ml(
      'Aliases must be JS identifiers (letters, digits, _).',
      'Les alias doivent être des identifiants JS (lettres, chiffres, _).',
      'Aliase müssen JS-Bezeichner sein (Buchstaben, Ziffern, _).'
    ),
    dpeRequired: ml('Each row needs a DPE.', 'Chaque ligne requiert un DPE.', 'Jede Zeile benötigt ein DPE.'),
    duplicateAlias: ml('Duplicate alias.', 'Alias en double.', 'Doppelter Alias.'),
    syntax: ml('The script has a syntax error.', 'Le script a une erreur de syntaxe.', 'Das Skript hat einen Syntaxfehler.')
  };
  const found = table[key];
  return found ? localize(found) : key;
}
