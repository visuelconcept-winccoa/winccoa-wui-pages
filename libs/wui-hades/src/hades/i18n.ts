// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only
/* eslint-disable sonarjs/no-duplicate-string -- a translation catalog repeats short field/column labels across UI areas by design */

/**
 * Internationalisation for the Hades page.
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against
 * the active WebUI language via `lit-translate` (shared singleton — same
 * instance as the app shell). Use {@link localizeDir} inside templates
 * (reactive) and {@link localize} for plain-string contexts. Locale keys use
 * the base `.utf8` form (`en_US.utf8` / `fr.utf8` / `de.utf8`) so any country
 * variant still resolves.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { STATE_FAULT, STATE_RUN, STATE_WARNING } from './types.js';
import type { EquipmentSide, LightingZone, OperatingMode, TubeDirection } from './types.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Static UI strings, grouped by area. */
export const MSG = {
  shell: {
    notFound: ml('Tunnel not found.', 'Tunnel introuvable.', 'Tunnel nicht gefunden.'),
    back: ml('Back', 'Retour', 'Zurück')
  },
  overview: {
    offlineNotice: ml(
      'Offline mode: changes not persisted to the datapoints (backend unavailable or write rights missing).',
      'Mode hors-ligne : modifications non persistées dans les datapoints (backend indisponible ou droits d’écriture manquants).',
      'Offline-Modus: Änderungen werden nicht in den Datapoints gespeichert (Backend nicht verfügbar oder fehlende Schreibrechte).'
    ),
    newTunnel: ml('New tunnel', 'Nouveau tunnel', 'Neuer Tunnel'),
    importDemo: ml(
      'Import the demonstration tunnel',
      'Importer le tunnel de démonstration',
      'Demo-Tunnel importieren'
    ),
    empty: ml('No tunnel configured.', 'Aucun tunnel configuré.', 'Kein Tunnel konfiguriert.'),
    tubes: ml('tube(s)', 'tube(s)', 'Röhre(n)'),
    equipmentCount: ml('equipment', 'équipements', 'Anlagen'),
    name: ml('Name', 'Nom', 'Name'),
    profile: ml('Regulatory profile', 'Référentiel réglementaire', 'Regelwerk'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    create: ml('Create', 'Créer', 'Erstellen'),
    importJson: ml('Import a tunnel (JSON)', 'Importer un tunnel (JSON)', 'Tunnel importieren (JSON)'),
    importFailed: ml(
      'Import failed — not a valid tunnel export',
      'Échec de l’import — fichier de tunnel invalide',
      'Import fehlgeschlagen — keine gültige Tunnel-Datei'
    ),
    duplicate: ml('Duplicate the tunnel', 'Dupliquer le tunnel', 'Tunnel duplizieren'),
    demoTitle: ml('Import a demo tunnel', 'Importer un tunnel de démonstration', 'Demo-Tunnel importieren'),
    copySuffix: ml('(copy)', '(copie)', '(Kopie)')
  },
  view: {
    back: ml('Back to the tunnels', 'Retour aux tunnels', 'Zurück zu den Tunneln'),
    tab3d: ml('3D twin', 'Jumeau 3D', '3D-Zwilling'),
    tabEditor: ml('Editor', 'Éditeur', 'Editor'),
    tabSynoptic: ml('Synoptic', 'Synoptique', 'Übersicht'),
    tabModes: ml('Operating modes', "Modes d'exploitation", 'Betriebsarten'),
    driveMode: ml('Drive through', 'Mode conduite', 'Durchfahrt'),
    orbitMode: ml('Free camera', 'Caméra libre', 'Freie Kamera'),
    resetView: ml('Reset the view', 'Réinitialiser la vue', 'Ansicht zurücksetzen'),
    deleteTunnel: ml('Delete the tunnel', 'Supprimer le tunnel', 'Tunnel löschen'),
    exportTunnel: ml('Export the tunnel (JSON)', 'Exporter le tunnel (JSON)', 'Tunnel exportieren (JSON)'),
    safetyReport: ml(
      'Generate the safety file (report)',
      'Générer le dossier de sécurité (rapport)',
      'Sicherheitsdossier erzeugen (Bericht)'
    ),
    tabLogbook: ml('Logbook', 'Main courante', 'Betriebstagebuch'),
    styleModern: ml('Modern rendering', 'Rendu moderne', 'Modernes Rendering'),
    styleSimple: ml('Simple rendering', 'Rendu simple', 'Einfaches Rendering'),
    toggleLabels: ml('Equipment labels', 'Étiquettes des équipements', 'Anlagenbeschriftungen'),
    tabExercise: ml('Exercise', 'Exercice', 'Übung'),
    shadowChip: ml('Observation', 'Observation', 'Beobachtung'),
    shadowHint: ml(
      'Observation (read-only) mode: live reading of the existing plant, no command is sent.',
      'Mode observation (lecture seule) : lecture temps réel de l’installation existante, aucune commande émise.',
      'Beobachtungsmodus (nur lesend): Echtzeitlesen der bestehenden Anlage, keine Befehle.'
    ),
    sceneHint: ml(
      'Left-drag: rotate · right-drag: pan · wheel: zoom · click an equipment to open it',
      'Glisser gauche : pivoter · glisser droit : déplacer · molette : zoom · cliquer un équipement pour l’ouvrir',
      'Ziehen links: drehen · Ziehen rechts: verschieben · Rad: Zoom · Anlage anklicken zum Öffnen'
    )
  },
  editor: {
    tunnelName: ml('Tunnel name', 'Nom du tunnel', 'Tunnelname'),
    profile: ml('Regulatory profile', 'Référentiel réglementaire', 'Regelwerk'),
    traffic: ml('Traffic (veh/day/lane)', 'Trafic (véh/j/voie)', 'Verkehr (Fz/Tag/Spur)'),
    tubeName: ml('Tube', 'Tube', 'Röhre'),
    direction: ml('Direction', 'Sens de circulation', 'Verkehrsführung'),
    lanes: ml('Lanes', 'Voies', 'Fahrstreifen'),
    removeTube: ml('Delete this tube', 'Supprimer ce tube', 'Diese Röhre löschen'),
    addTube: ml('Add a tube', 'Ajouter un tube', 'Röhre hinzufügen'),
    addSegment: ml('Add a segment', 'Ajouter un segment', 'Segment hinzufügen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    colSegment: ml('Segment', 'Segment', 'Segment'),
    colLength: ml('Length (m)', 'Longueur (m)', 'Länge (m)'),
    colGradient: ml('Gradient (%)', 'Pente (%)', 'Neigung (%)'),
    colRadius: ml('Curve radius (m, 0 = straight)', 'Rayon (m, 0 = droit)', 'Radius (m, 0 = gerade)'),
    colClearance: ml('Clearance (m)', 'Gabarit (m)', 'Lichtraum (m)'),
    colZone: ml('Lighting zone', "Zone d'éclairage", 'Beleuchtungszone'),
    equipmentTitle: ml('Equipment', 'Équipements', 'Anlagen'),
    addEquipment: ml('Add an equipment', 'Ajouter un équipement', 'Anlage hinzufügen'),
    advisorTitle: ml('Compliance advisor', 'Conseiller de conformité', 'Konformitätsberater'),
    noIssue: ml(
      'No deviation from the selected profile.',
      'Aucun écart par rapport au référentiel sélectionné.',
      'Keine Abweichung vom gewählten Regelwerk.'
    ),
    disclaimer: ml(
      'Simplified reading of the reference texts — a design aid, not a certification. The safety officer remains the authority.',
      'Lecture simplifiée des textes de référence — une aide à la conception, pas une certification. L’agent de sécurité reste l’autorité.',
      'Vereinfachte Auslegung der Referenztexte — eine Planungshilfe, keine Zertifizierung. Der Sicherheitsbeauftragte bleibt maßgebend.'
    ),
    shadowMode: ml(
      'Observation mode (read-only — retrofit over an existing control system)',
      'Mode observation (lecture seule — pose sur une GTC existante)',
      'Beobachtungsmodus (nur lesend — Aufsatz auf ein bestehendes Leitsystem)'
    ),
    shadowModeHint: ml(
      'Commands, mode engagement and archive switches are disabled; drills stay available.',
      'Commandes, engagement de modes et bascules d’archivage désactivés ; les exercices restent disponibles.',
      'Befehle, Betriebsarten und Archivierungsschalter deaktiviert; Übungen bleiben verfügbar.'
    ),
    fix: ml('Fix', 'Corriger', 'Beheben'),
    placeSeries: ml('Place a series…', 'Poser en série…', 'Serie platzieren…'),
    seriesTitle: ml('Place a series', 'Poser en série', 'Serie platzieren'),
    seriesStart: ml('First PK (m)', 'Premier PK (m)', 'Erster PK (m)'),
    seriesEnd: ml('Last PK (m)', 'Dernier PK (m)', 'Letzter PK (m)'),
    seriesEvery: ml('Interval (m)', 'Intervalle (m)', 'Abstand (m)'),
    seriesPrefix: ml('Name prefix (optional)', 'Préfixe de nom (optionnel)', 'Namenspräfix (optional)'),
    seriesAdd: ml('Add the series', 'Ajouter la série', 'Serie hinzufügen'),
    seriesCount: ml('unit(s) will be created', 'unité(s) seront créées', 'Einheit(en) werden erstellt'),
    newTubeName: ml('New tube', 'Nouveau tube', 'Neue Röhre'),
    newSegmentName: ml('New segment', 'Nouveau segment', 'Neues Segment'),
    newEquipmentName: ml('New equipment', 'Nouvel équipement', 'Neue Anlage')
  },
  synoptic: {
    lanes: ml('lane(s)', 'voie(s)', 'Fahrstreifen'),
    legendRun: ml('In service', 'En service', 'In Betrieb'),
    legendWarning: ml('Warning', 'Avertissement', 'Warnung'),
    legendFault: ml('Fault', 'Défaut', 'Störung'),
    legendOff: ml('Off / unbound', 'Arrêt / non lié', 'Aus / nicht verknüpft'),
    allKinds: ml('All types', 'Tous les types', 'Alle Typen'),
    showNames: ml('Show the names', 'Afficher les noms', 'Namen anzeigen')
  },
  modes: {
    empty: ml(
      'No operating mode configured (import the demo tunnel to see examples).',
      "Aucun mode d'exploitation configuré (importez le tunnel de démonstration pour voir des exemples).",
      'Keine Betriebsart konfiguriert (Demo-Tunnel importieren für Beispiele).'
    ),
    engage: ml('Engage', 'Engager', 'Aktivieren'),
    actionCount: ml('command(s) in the sequence', 'commande(s) dans la séquence', 'Befehl(e) in der Sequenz'),
    unbound: ml('(not bound)', '(non lié)', '(nicht verknüpft)'),
    failed: ml('(write failed)', "(échec d'écriture)", '(Schreibfehler)'),
    newMode: ml('New mode', 'Nouveau mode', 'Neue Betriebsart'),
    editMode: ml('Edit the mode', 'Éditer le mode', 'Betriebsart bearbeiten'),
    deleteMode: ml('Delete the mode', 'Supprimer le mode', 'Betriebsart löschen')
  },
  modeDialog: {
    title: ml('Operating mode', "Mode d'exploitation", 'Betriebsart'),
    name: ml('Name', 'Nom', 'Name'),
    severity: ml('Kind', 'Nature', 'Art'),
    description: ml('Description', 'Description', 'Beschreibung'),
    actions: ml('Reflex sequence', 'Séquence réflexe', 'Reflexsequenz'),
    addAction: ml('Add a command', 'Ajouter une commande', 'Befehl hinzufügen'),
    noCommandEquipment: ml(
      'No commandable equipment in this tunnel — place fans, barriers, VMS… first.',
      "Aucun équipement commandable dans ce tunnel — posez d'abord des accélérateurs, barrières, PMV….",
      'Keine steuerbare Anlage in diesem Tunnel — zuerst Ventilatoren, Schranken, WVZ… platzieren.'
    ),
    moveUp: ml('Move up', 'Monter', 'Nach oben'),
    moveDown: ml('Move down', 'Descendre', 'Nach unten'),
    removeAction: ml('Remove this command', 'Retirer cette commande', 'Diesen Befehl entfernen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern')
  },
  equipment: {
    identity: ml('Identity', 'Identité', 'Identität'),
    name: ml('Name', 'Nom', 'Name'),
    kind: ml('Type', 'Type', 'Typ'),
    tube: ml('Tube', 'Tube', 'Röhre'),
    pk: ml('PK (m)', 'PK (m)', 'PK (m)'),
    side: ml('Position', 'Position', 'Position'),
    live: ml('Live values', 'Valeurs temps réel', 'Echtzeitwerte'),
    state: ml('State', 'État', 'Zustand'),
    commands: ml('Commands', 'Commandes', 'Befehle'),
    bindings: ml('Datapoint bindings', 'Liaisons datapoints', 'Datapoint-Verknüpfungen'),
    archiving: ml('NGA archiving', 'Archivage NGA', 'NGA-Archivierung'),
    noArchiveGroup: ml(
      'No active archive group discovered (type _NGA_Group) — backend unavailable or NGA not configured.',
      "Aucun groupe d'archive actif découvert (type _NGA_Group) — backend indisponible ou NGA non configuré.",
      'Keine aktive Archivgruppe gefunden (Typ _NGA_Group) — Backend nicht verfügbar oder NGA nicht konfiguriert.'
    ),
    video: ml('Live video (RTSP)', 'Vidéo temps réel (RTSP)', 'Live-Video (RTSP)'),
    noStreams: ml(
      'No RTSP stream configured (camera-streams module absent or empty).',
      'Aucun flux RTSP configuré (module camera-streams absent ou vide).',
      'Kein RTSP-Stream konfiguriert (camera-streams-Modul fehlt oder ist leer).'
    ),
    noStream: ml('— no stream —', '— aucun flux —', '— kein Stream —'),
    aksHint: ml(
      'Indicative AKS-CH designation (Swiss ASTRA plant classification)',
      'Désignation AKS-CH indicative (classification des installations ASTRA/OFROU)',
      'Indikative AKS-CH-Bezeichnung (ASTRA-Anlagenkennzeichnung)'
    ),
    delete: ml('Delete', 'Supprimer', 'Löschen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    close: ml('Close', 'Fermer', 'Schließen')
  },
  logbook: {
    notePlaceholder: ml('Add an operator note…', 'Ajouter une note d’exploitation…', 'Betriebsnotiz hinzufügen…'),
    addNote: ml('Note', 'Noter', 'Notieren'),
    openIncident: ml('Open an incident', 'Ouvrir un incident', 'Ereignis eröffnen'),
    closeIncident: ml('Close the incident', 'Clore l’incident', 'Ereignis schließen'),
    incidentTitlePlaceholder: ml(
      'Incident title (e.g. « Stopped HGV PK 1+200 »)',
      'Titre de l’incident (ex. « PL arrêté PK 1+200 »)',
      'Ereignistitel (z. B. « LKW-Stillstand PK 1+200 »)'
    ),
    open: ml('Open', 'Ouvrir', 'Eröffnen'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    empty: ml('No entry yet.', 'Aucune entrée pour l’instant.', 'Noch keine Einträge.'),
    openedAt: ml('opened at', 'ouvert à', 'eröffnet um'),
    closedNote: ml('Incident closed.', 'Incident clos.', 'Ereignis geschlossen.'),
    drillTag: ml('Drill', 'Exercice', 'Übung'),
    filters: {
      all: ml('All', 'Tout', 'Alle'),
      alarm: ml('Alarms', 'Alarmes', 'Alarme'),
      command: ml('Commands', 'Commandes', 'Befehle'),
      mode: ml('Modes', 'Modes', 'Betriebsarten'),
      note: ml('Notes', 'Notes', 'Notizen'),
      incident: ml('Incidents', 'Incidents', 'Ereignisse'),
      exercise: ml('Drills', 'Exercices', 'Übungen')
    }
  },
  exercise: {
    title: ml('Safety drills', 'Exercices de sécurité', 'Sicherheitsübungen'),
    hint: ml(
      'Run a scenario on the digital twin: injected events drive the 3D and the synoptic, and EVERY command you send is intercepted and simulated — nothing reaches the field. Your reactions are timed and scored.',
      'Lancez un scénario sur le jumeau numérique : les événements injectés animent la 3D et le synoptique, et TOUTES vos commandes sont interceptées et simulées — rien ne part vers le terrain. Vos réactions sont chronométrées et notées.',
      'Starten Sie ein Szenario auf dem digitalen Zwilling: injizierte Ereignisse steuern 3D und Übersicht, und JEDER Befehl wird abgefangen und simuliert — nichts erreicht das Feld. Ihre Reaktionen werden gemessen und bewertet.'
    ),
    expectedCount: ml('expected action(s)', 'action(s) attendue(s)', 'erwartete Aktion(en)'),
    start: ml('Start the drill', 'Lancer l’exercice', 'Übung starten'),
    runningTag: ml('DRILL IN PROGRESS', 'EXERCICE EN COURS', 'ÜBUNG LÄUFT'),
    remaining: ml('remaining', 'restant', 'verbleibend'),
    finish: ml('End the drill', 'Terminer l’exercice', 'Übung beenden'),
    runningHint: ml(
      'Act from the 3D twin, the synoptic or the operating modes — commands are simulated and scored below.',
      'Agissez depuis le jumeau 3D, le synoptique ou les modes d’exploitation — les commandes sont simulées et notées ci-dessous.',
      'Handeln Sie über den 3D-Zwilling, die Übersicht oder die Betriebsarten — Befehle werden simuliert und unten bewertet.'
    ),
    reportTitle: ml('Drill report', 'Rapport d’exercice', 'Übungsbericht'),
    missed: ml('not done', 'non réalisée', 'nicht ausgeführt'),
    onTime: ml('on time', 'dans les temps', 'rechtzeitig'),
    late: ml('late', 'en retard', 'verspätet')
  },
  confirm: {
    commandHeading: ml('Send the command?', 'Envoyer la commande ?', 'Befehl senden?'),
    execute: ml('Execute', 'Exécuter', 'Ausführen'),
    modeHeading: ml('Engage the operating mode?', "Engager le mode d'exploitation ?", 'Betriebsart aktivieren?'),
    engage: ml('Engage', 'Engager', 'Aktivieren'),
    deleteTunnel: ml(
      'Permanently delete this tunnel and its datapoint?',
      'Supprimer définitivement ce tunnel et son datapoint ?',
      'Diesen Tunnel und seinen Datapoint endgültig löschen?'
    )
  }
} as const;

const SIDE_LABELS: Record<EquipmentSide, MultiLangString> = {
  left: ml('Left wall', 'Paroi gauche', 'Linke Wand'),
  right: ml('Right wall', 'Paroi droite', 'Rechte Wand'),
  ceiling: ml('Vault / ceiling', 'Voûte / plafond', 'Gewölbe / Decke'),
  roadway: ml('Roadway side', 'Bord de chaussée', 'Fahrbahnrand')
};

/** Localized label of an equipment cross-section position. */
export function sideLabel(side: EquipmentSide): string {
  return localize(SIDE_LABELS[side]);
}

const ZONE_LABELS: Record<LightingZone, MultiLangString> = {
  entrance: ml('Entrance', 'Entrée', 'Einfahrt'),
  transition: ml('Transition', 'Transition', 'Übergang'),
  interior: ml('Interior', 'Intérieure', 'Innenstrecke'),
  exit: ml('Exit', 'Sortie', 'Ausfahrt')
};

/** Localized label of a CIE 88 lighting zone. */
export function zoneLabel(zone: LightingZone): string {
  return localize(ZONE_LABELS[zone]);
}

const DIRECTION_LABELS: Record<TubeDirection, MultiLangString> = {
  unidirectional: ml('Unidirectional', 'Unidirectionnel', 'Richtungsverkehr'),
  bidirectional: ml('Bidirectional', 'Bidirectionnel', 'Gegenverkehr')
};

/** Localized label of a tube's traffic direction. */
export function dirLabel(direction: TubeDirection): string {
  return localize(DIRECTION_LABELS[direction]);
}

const SEVERITY_LABELS: Record<OperatingMode['severity'], MultiLangString> = {
  normal: ml('Normal operation', 'Exploitation normale', 'Normalbetrieb'),
  degraded: ml('Degraded', 'Dégradé', 'Eingeschränkt'),
  closure: ml('Closure', 'Fermeture', 'Sperrung'),
  fire: ml('Fire', 'Incendie', 'Brand')
};

/** Localized label of an operating-mode severity. */
export function severityLabel(severity: OperatingMode['severity']): string {
  return localize(SEVERITY_LABELS[severity]);
}

const INCIDENT_SEVERITY_LABELS: Record<'minor' | 'major' | 'critical', MultiLangString> = {
  minor: ml('Minor', 'Mineur', 'Gering'),
  major: ml('Major', 'Majeur', 'Erheblich'),
  critical: ml('Critical', 'Critique', 'Kritisch')
};

/** Localized label of an incident severity. */
export function incidentSeverityLabel(severity: 'minor' | 'major' | 'critical'): string {
  return localize(INCIDENT_SEVERITY_LABELS[severity]);
}

/** Logbook line for an equipment alarm transition. */
export function alarmTransitionMsg(name: string, next: number): string {
  if (next === STATE_FAULT) {
    return localize(ml(`${name}: FAULT`, `${name} : DÉFAUT`, `${name}: STÖRUNG`));
  }
  if (next === STATE_WARNING) {
    return localize(ml(`${name}: warning`, `${name} : avertissement`, `${name}: Warnung`));
  }
  if (next === STATE_RUN) {
    return localize(ml(`${name}: back in service`, `${name} : retour en service`, `${name}: wieder in Betrieb`));
  }
  return localize(ml(`${name}: state ${next}`, `${name} : état ${next}`, `${name}: Zustand ${next}`));
}

/** Logbook line for a mode engagement. */
export function modeEngagedMsg(name: string): string {
  return localize(
    ml(`Operating mode engaged: ${name}`, `Mode d'exploitation engagé : ${name}`, `Betriebsart aktiviert: ${name}`)
  );
}

/** Logbook line at drill start. */
export function exerciseStartMsg(name: string): string {
  return localize(ml(`Drill started: ${name}`, `Exercice lancé : ${name}`, `Übung gestartet: ${name}`));
}

/** Logbook line at drill end. */
export function exerciseEndMsg(score: number): string {
  return localize(
    ml(`Drill finished — score ${score}/100`, `Exercice terminé — score ${score}/100`, `Übung beendet — Ergebnis ${score}/100`)
  );
}

/** Toast/logbook line for an intercepted (simulated) drill command. */
export function simulatedCommandMsg(label: string): string {
  return localize(
    ml(`Simulated command: ${label}`, `Commande simulée : ${label}`, `Simulierter Befehl: ${label}`)
  );
}

/** Confirm-delete message for an operating mode (plain string). */
export function deleteModeMsg(name: string): string {
  return localize(
    ml(
      `Delete the operating mode « ${name} »?`,
      `Supprimer le mode d'exploitation « ${name} » ?`,
      `Betriebsart « ${name} » löschen?`
    )
  );
}

/** Confirmation message before engaging a mode's reflex sequence. */
export function engageModeMsg(name: string, actionCount: number): string {
  return localize(
    ml(
      `Engage « ${name} » — ${actionCount} field command(s) will be sent (confirmed writes, audited).`,
      `Engager « ${name} » — ${actionCount} commande(s) terrain seront envoyées (écritures confirmées, auditées).`,
      `« ${name} » aktivieren — ${actionCount} Feldbefehl(e) werden gesendet (bestätigte, auditierte Schreibvorgänge).`
    )
  );
}

/** Toast summary after a command batch. */
export function commandResultMsg(ok: number, failed: number): string {
  if (failed === 0) {
    return localize(
      ml(`${ok} command(s) sent.`, `${ok} commande(s) envoyée(s).`, `${ok} Befehl(e) gesendet.`)
    );
  }
  return localize(
    ml(
      `${ok} command(s) sent, ${failed} skipped or failed.`,
      `${ok} commande(s) envoyée(s), ${failed} ignorée(s) ou en échec.`,
      `${ok} Befehl(e) gesendet, ${failed} übersprungen oder fehlgeschlagen.`
    )
  );
}
