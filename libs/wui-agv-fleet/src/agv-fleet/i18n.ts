// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the AGV Fleet page.
 *
 * All user-visible strings are {@link MultiLangString} maps resolved against the
 * active WebUI language via `lit-translate` (shared singleton — same instance as
 * the app shell, so the page reacts to the user's language). Use {@link localizeDir}
 * inside templates (reactive, re-renders on language change) and {@link localize}
 * for plain-string contexts (current language at call time).
 *
 * Locale keys use the base `.utf8` form (`en_US.utf8` / `fr.utf8` / `de.utf8`) so
 * any country variant (fr_FR, de_AT, de_CH, …) still resolves — the resolver
 * falls back to the language sub-tag.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import type { AgvState } from './types.js';

export {
  localize,
  localizeDir
} from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

/** Build a tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Label of each operating state. */
export const STATE_LABELS: Record<AgvState, MultiLangString> = {
  idle: ml('Idle', 'À l’arrêt', 'Bereit'),
  moving: ml('Moving', 'En déplacement', 'In Fahrt'),
  charging: ml('Charging', 'En charge', 'Lädt'),
  loading: ml('Load/unload', 'Chargement', 'Beladen'),
  error: ml('Fault', 'Défaut', 'Störung'),
  offline: ml('Offline', 'Hors ligne', 'Offline')
};

/** Static UI strings, grouped by area. */
export const MSG = {
  page: {
    headerTitle: ml('AGV Fleet', 'Flotte AGV', 'AGV-Flotte'),
    demo: ml(
      'Demo fleet: no AGV_Vehicle datapoint found (or backend unavailable) — values shown are simulated in the browser.',
      'Flotte de démonstration : aucun datapoint AGV_Vehicle trouvé (ou backend indisponible) — les valeurs affichées sont simulées dans le navigateur.',
      'Demo-Flotte: kein AGV_Vehicle-Datenpunkt gefunden (oder Backend nicht verfügbar) — die angezeigten Werte sind im Browser simuliert.'
    ),
    stale: ml(
      'Live updates unavailable — showing the values last read from the datapoints.',
      'Mise à jour temps réel indisponible — affichage des dernières valeurs lues dans les datapoints.',
      'Live-Aktualisierung nicht verfügbar — es werden die zuletzt gelesenen Datenpunktwerte angezeigt.'
    ),
    partial: ml(
      'Some values are not refreshing live.',
      'Certaines valeurs ne sont pas rafraîchies en temps réel.',
      'Einige Werte werden nicht live aktualisiert.'
    ),
    empty: ml(
      'No AGV in the fleet.',
      'Aucun AGV dans la flotte.',
      'Kein AGV in der Flotte.'
    ),
    filterAll: ml('All', 'Tous', 'Alle'),
    filterAttention: ml('Needs attention', 'À surveiller', 'Zu prüfen'),
    clearFilter: ml(
      'Clear filter',
      'Réinitialiser le filtre',
      'Filter zurücksetzen'
    )
  },
  tabs: {
    fleet: ml('Fleet', 'Flotte', 'Flotte'),
    missions: ml('Missions', 'Missions', 'Aufträge')
  },
  missions: {
    unavailable: ml(
      'No mission book published. Start the agvSim manager in the WinCC OA console — it publishes AGV_MissionBook.json and consumes AGV_Command.json.',
      'Aucun carnet de missions publié. Démarrez le manager agvSim dans la console WinCC OA — il publie AGV_MissionBook.json et consomme AGV_Command.json.',
      'Kein Auftragsbuch veröffentlicht. Starten Sie den agvSim-Manager in der WinCC OA-Konsole — er veröffentlicht AGV_MissionBook.json und liest AGV_Command.json.'
    ),
    active: ml('Active orders', 'Missions actives', 'Aktive Aufträge'),
    noOrder: ml(
      'no order assigned',
      'aucune mission affectée',
      'kein Auftrag zugewiesen'
    ),
    remaining: ml('Remaining', 'Restant', 'Reststrecke'),
    readOnly: ml(
      'Read-only — write permission required to command the fleet.',
      'Lecture seule — droit d’écriture requis pour commander la flotte.',
      'Nur Lesen — Schreibrecht erforderlich, um die Flotte zu steuern.'
    ),
    actDispatch: ml('New order', 'Nouvelle mission', 'Neuer Auftrag'),
    actCancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    actCharge: ml('Send to charge', 'Envoyer en charge', 'Zum Laden senden'),
    actPark: ml('Park', 'Garer', 'Parken'),
    actFault: ml('Force fault', 'Forcer un défaut', 'Störung erzwingen'),
    actRecover: ml(
      'Return to service',
      'Remettre en service',
      'Wieder in Betrieb'
    ),
    kinds: {
      putaway: ml('Putaway', 'Mise en stock', 'Einlagerung'),
      retrieval: ml('Retrieval', 'Prélèvement', 'Auslagerung'),
      replenish: ml('Replenishment', 'Réapprovisionnement', 'Nachschub'),
      charge: ml('Charging', 'Mise en charge', 'Laden'),
      park: ml('Parking', 'Garage', 'Parken')
    },
    legActions: {
      load: ml('load', 'charger', 'aufnehmen'),
      unload: ml('unload', 'décharger', 'abgeben'),
      handover: ml('handover', 'transfert', 'Übergabe'),
      charge: ml('charge', 'charge', 'laden'),
      park: ml('park', 'garer', 'parken')
    }
  },
  kpi: {
    fleetSize: ml('Fleet', 'Flotte', 'Flotte'),
    moving: ml('Moving', 'En déplacement', 'In Fahrt'),
    available: ml('Available', 'Disponibles', 'Verfügbar'),
    charging: ml('Charging', 'En charge', 'Lädt'),
    faulted: ml('Faults', 'Défauts', 'Störungen'),
    avgBattery: ml('Avg. battery', 'Batterie moy.', 'Ø Batterie'),
    missionsToday: ml('Missions today', 'Missions du jour', 'Aufträge heute'),
    utilization: ml('Utilization', 'Taux d’activité', 'Auslastung')
  },
  table: {
    vehicle: ml('Vehicle', 'Véhicule', 'Fahrzeug'),
    state: ml('State', 'État', 'Status'),
    battery: ml('Battery', 'Batterie', 'Batterie'),
    speed: ml('Speed', 'Vitesse', 'Geschwindigkeit'),
    zone: ml('Zone', 'Zone', 'Zone'),
    mission: ml('Mission', 'Mission', 'Auftrag'),
    missions: ml('Today', 'Aujourd’hui', 'Heute'),
    noMission: ml('— unassigned —', '— non affecté —', '— nicht zugewiesen —'),
    sortBy: ml(
      'Sort by this column',
      'Trier sur cette colonne',
      'Nach dieser Spalte sortieren'
    )
  },
  map: {
    title: ml('Floor plan', 'Plan de la halle', 'Hallenplan'),
    legend: ml('Legend', 'Légende', 'Legende'),
    charging: ml('Charging bay', 'Zone de charge', 'Ladebereich'),
    maintenance: ml('Maintenance', 'Maintenance', 'Wartung'),
    docks: ml('Docks', 'Quais', 'Rampen'),
    racks: ml('Racking', 'Rayonnages', 'Regale'),
    parking: ml('Parking', 'Parking', 'Parkplatz')
  },
  detail: {
    close: ml('Close', 'Fermer', 'Schließen'),
    model: ml('Model', 'Modèle', 'Modell'),
    datapoint: ml('Datapoint', 'Datapoint', 'Datenpunkt'),
    position: ml('Position', 'Position', 'Position'),
    heading: ml('Heading', 'Cap', 'Kurs'),
    payload: ml('Payload', 'Charge', 'Ladung'),
    noPayload: ml('running light', 'à vide', 'leer'),
    odometer: ml('Odometer', 'Compteur', 'Kilometerstand'),
    missionsToday: ml('Missions today', 'Missions du jour', 'Aufträge heute'),
    fault: ml('Fault', 'Défaut', 'Störung')
  }
} as const;

/** Localised state label (plain string — chips, tooltips, legend). */
export function stateLabel(state: AgvState): string {
  return localize(STATE_LABELS[state]);
}

/** "n / m vehicles" count shown in the toolbar (plain string). */
export function fleetCountMsg(shown: number, total: number): string {
  return shown === total
    ? localize(
        ml(
          `${total} vehicle(s)`,
          `${total} véhicule(s)`,
          `${total} Fahrzeug(e)`
        )
      )
    : localize(
        ml(
          `${shown} of ${total} vehicle(s)`,
          `${shown} sur ${total} véhicule(s)`,
          `${shown} von ${total} Fahrzeug(en)`
        )
      );
}

/** Tooltip of a map marker (plain string — SVG title). */
export function markerTitle(
  name: string,
  state: string,
  battery: number
): string {
  return `${name} · ${state} · ${battery.toFixed(0)} %`;
}
