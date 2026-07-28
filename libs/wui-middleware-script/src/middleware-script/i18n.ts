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
    defaultTaskName: ml('New task', 'Nouvelle tâche', 'Neue Aufgabe'),
    newModel: ml('New model', 'Nouveau modèle', 'Neues Modell'),
    defaultModelName: ml('New model', 'Nouveau modèle', 'Neues Modell'),
    noModels: ml(
      'No reusable model yet. A model carries the script; each task instance only binds its DPEs and parameters.',
      'Aucun modèle réutilisable. Un modèle porte le script ; chaque tâche instance ne lie que ses DPEs et paramètres.',
      'Noch kein wiederverwendbares Modell. Ein Modell trägt das Skript; jede Aufgaben-Instanz bindet nur ihre DPEs und Parameter.'
    ),
    selectModel: ml(
      'Select a model on the left, or create a new one.',
      'Sélectionnez un modèle à gauche, ou créez-en un nouveau.',
      'Wählen Sie links ein Modell aus oder erstellen Sie ein neues.'
    )
  },
  list: {
    modeTasks: ml('Tasks', 'Tâches', 'Aufgaben'),
    modeModels: ml('Models', 'Modèles', 'Modelle'),
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
    tabJournal: ml('Journal', 'Journal', 'Journal'),
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
      'Synchronous JavaScript body. Available: inputs.<alias>, output(alias, value), log(…), params.<name>, Math, JSON. No require/network/DP access.',
      'Corps JavaScript synchrone. Disponible : inputs.<alias>, output(alias, valeur), log(…), params.<nom>, Math, JSON. Pas de require/réseau/accès DP.',
      'Synchroner JavaScript-Rumpf. Verfügbar: inputs.<alias>, output(alias, wert), log(…), params.<name>, Math, JSON. Kein require/Netzwerk/DP-Zugriff.'
    ),
    syntaxOk: ml('Syntax OK', 'Syntaxe OK', 'Syntax OK'),
    syntaxError: ml('Syntax error', 'Erreur de syntaxe', 'Syntaxfehler'),
    // --- reusable model instantiation ---
    scriptSource: ml('Script source', 'Source du script', 'Skriptquelle'),
    sourceInline: ml('Own script (this task)', 'Script propre (cette tâche)', 'Eigenes Skript (diese Aufgabe)'),
    modelReadonlyHint: ml(
      'This task instantiates a reusable model — the script is edited on the model (Models list), for every instance at once.',
      'Cette tâche instancie un modèle réutilisable — le script s’édite sur le modèle (liste Modèles), pour toutes les instances à la fois.',
      'Diese Aufgabe instanziiert ein wiederverwendbares Modell — das Skript wird am Modell bearbeitet (Modell-Liste), für alle Instanzen zugleich.'
    ),
    paramsHead: ml('Instance parameters', 'Paramètres de l’instance', 'Instanz-Parameter'),
    noParams: ml('This model declares no parameter.', 'Ce modèle ne déclare aucun paramètre.', 'Dieses Modell deklariert keine Parameter.')
  },
  journal: {
    hint: ml(
      'Live state of the LAST run on the manager — the `log(…)` lines of the script are captured (capped).',
      'État live de la DERNIÈRE exécution sur le manager — les lignes `log(…)` du script sont capturées (plafonnées).',
      'Live-Zustand des LETZTEN Laufs auf dem Manager — die `log(…)`-Zeilen des Skripts werden erfasst (begrenzt).'
    ),
    none: ml(
      'No status yet — the middlewareScript manager is stopped, or the task never ran.',
      'Aucun statut — le manager middlewareScript est arrêté, ou la tâche n’a jamais été exécutée.',
      'Noch kein Status — der middlewareScript-Manager ist gestoppt oder die Aufgabe lief nie.'
    ),
    state: ml('State', 'État', 'Zustand'),
    lastRun: ml('Last run', 'Dernière exécution', 'Letzter Lauf'),
    duration: ml('Duration', 'Durée', 'Dauer'),
    runs: ml('Run count', 'Nombre d’exécutions', 'Anzahl Läufe'),
    error: ml('Last error', 'Dernière erreur', 'Letzter Fehler'),
    logsHead: ml('Script logs (last run)', 'Logs du script (dernière exécution)', 'Skript-Logs (letzter Lauf)'),
    noLogs: ml(
      'No log line — add `log(…)` calls to the script.',
      'Aucune ligne de log — ajoutez des appels `log(…)` dans le script.',
      'Keine Log-Zeile — fügen Sie `log(…)`-Aufrufe in das Skript ein.'
    )
  },
  modelEditor: {
    name: ml('Model name', 'Nom du modèle', 'Modellname'),
    description: ml('Description', 'Description', 'Beschreibung'),
    inputsDecl: ml('Declared inputs (aliases)', 'Entrées déclarées (alias)', 'Deklarierte Eingänge (Aliase)'),
    outputsDecl: ml('Declared outputs (aliases)', 'Sorties déclarées (alias)', 'Deklarierte Ausgänge (Aliase)'),
    paramsDecl: ml('Declared parameters', 'Paramètres déclarés', 'Deklarierte Parameter'),
    alias: ml('Alias', 'Alias', 'Alias'),
    hint: ml('Hint', 'Indication', 'Hinweis'),
    paramName: ml('Name', 'Nom', 'Name'),
    paramDefault: ml('Default (JSON)', 'Défaut (JSON)', 'Standard (JSON)'),
    addParam: ml('Add a parameter', 'Ajouter un paramètre', 'Parameter hinzufügen'),
    declHint: ml(
      'A task instantiating this model binds each declared alias to its own DPE and overrides the parameters.',
      'Une tâche instanciant ce modèle lie chaque alias déclaré à son propre DPE et surcharge les paramètres.',
      'Eine Aufgabe, die dieses Modell instanziiert, bindet jeden deklarierten Alias an ihr eigenes DPE und überschreibt die Parameter.'
    ),
    testDefaultsHint: ml(
      'The dry-run below uses the declared parameter DEFAULTS.',
      'Le test ci-dessous utilise les valeurs PAR DÉFAUT des paramètres.',
      'Der Testlauf unten verwendet die STANDARD-Werte der Parameter.'
    ),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    delete: ml('Delete the model', 'Supprimer le modèle', 'Modell löschen'),
    deleteConfirm: ml(
      'Delete this model? This cannot be undone.',
      'Supprimer ce modèle ? Cette action est irréversible.',
      'Dieses Modell löschen? Dies kann nicht rückgängig gemacht werden.'
    ),
    saved: ml('Model saved — every instance follows.', 'Modèle enregistré — toutes les instances suivent.', 'Modell gespeichert — alle Instanzen folgen.')
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
    syntax: ml('The script has a syntax error.', 'Le script a une erreur de syntaxe.', 'Das Skript hat einen Syntaxfehler.'),
    modelMissing: ml(
      'The referenced model no longer exists.',
      'Le modèle référencé n’existe plus.',
      'Das referenzierte Modell existiert nicht mehr.'
    ),
    modelIoMismatch: ml(
      'The task bindings do not match the model’s declared aliases.',
      'Les liaisons de la tâche ne correspondent pas aux alias déclarés du modèle.',
      'Die Bindungen der Aufgabe entsprechen nicht den deklarierten Aliassen des Modells.'
    ),
    badParamName: ml(
      'Parameter names must be JS identifiers (letters, digits, _).',
      'Les noms de paramètres doivent être des identifiants JS (lettres, chiffres, _).',
      'Parameternamen müssen JS-Bezeichner sein (Buchstaben, Ziffern, _).'
    ),
    duplicateParam: ml('Duplicate parameter name.', 'Nom de paramètre en double.', 'Doppelter Parametername.'),
    modelInUse: ml(
      'This model is still instantiated by tasks — delete or detach them first.',
      'Ce modèle est encore instancié par des tâches — supprimez-les ou détachez-les d’abord.',
      'Dieses Modell wird noch von Aufgaben instanziiert — löschen oder lösen Sie diese zuerst.'
    )
  };
  const found = table[key];
  return found ? localize(found) : key;
}

/** Model usage badge: how many tasks instantiate it (plain string). */
export function modelUsedByMsg(count: number): string {
  return localize(ml(`${count} instance(s)`, `${count} instance(s)`, `${count} Instanz(en)`));
}

/** Task-list badge for a model-based task (plain string). */
export function taskModelBadgeMsg(name: string): string {
  return localize(ml(`model: ${name}`, `modèle : ${name}`, `Modell: ${name}`));
}
