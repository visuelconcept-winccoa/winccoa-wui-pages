// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Poseidon page (EN / FR / DE), following the
 * shared `lit-translate` singleton. `localizeDir(...)` in templates (reactive),
 * `localize(...)` for plain-string attributes.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { localize } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';
import { getLanguage } from '@wincc-oa/wui-i18n-shared/localize-base.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Format an ISO timestamp as a short date-time in the active UI language. */
export function dateLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLanguage());
}

export const MSG = {
  tabs: {
    synoptic: ml('Synoptic', 'Synoptique', 'Übersicht'),
    kpi: ml('KPI', 'KPI', 'KPI'),
    trends: ml('Trends', 'Tendances', 'Trends'),
    alarms: ml('Alarms', 'Alarmes', 'Alarme'),
    equipment: ml('Equipment', 'Équipements', 'Anlagen')
  },
  synoptic: {
    title: ml('Process overview', 'Vue du procédé', 'Prozessübersicht'),
    waterLine: ml('Water line', 'File eau', 'Wasserstraße'),
    sludgeLine: ml('Sludge line', 'File boues', 'Schlammstraße'),
    stageScreening: ml('Screening', 'Prétraitement', 'Rechen'),
    stageLift: ml('Lift station', 'Poste de relevage', 'Hebewerk'),
    stageBio: ml('Aeration', 'Bassin biologique', 'Belebung'),
    stageClarifier: ml('Clarifier', 'Clarificateur', 'Nachklärung'),
    stageUv: ml('UV disinfection', 'Désinfection UV', 'UV-Desinfektion'),
    stageOutfall: ml('Outfall', 'Rejet', 'Ablauf'),
    stageDewatering: ml('Dewatering', 'Déshydratation', 'Entwässerung'),
    running: ml('running', 'en marche', 'in Betrieb'),
    lastUpdate: ml('Last update', 'Dernière mise à jour', 'Letzte Aktualisierung')
  },
  kpi: {
    title: ml('Performance & compliance', 'Performance & conformité', 'Leistung & Konformität'),
    efficiency: ml('Removal efficiency', 'Rendement épuratoire', 'Reinigungsleistung'),
    conformity: ml('Discharge conformity', 'Conformité du rejet', 'Ablaufkonformität'),
    specificEnergy: ml('Specific energy', 'Énergie spécifique', 'Spezifische Energie'),
    compliant: ml('Compliant', 'Conforme', 'Konform'),
    nonCompliant: ml('Non-compliant', 'Non conforme', 'Nicht konform'),
    limit: ml('Limit', 'Seuil', 'Grenzwert'),
    value: ml('Value', 'Valeur', 'Wert'),
    parameter: ml('Parameter', 'Paramètre', 'Parameter')
  },
  trends: {
    title: ml('Historical trends', 'Tendances historiques', 'Historische Trends'),
    signal: ml('Signal', 'Signal', 'Signal'),
    period: ml('Period', 'Période', 'Zeitraum'),
    last1h: ml('Last hour', 'Dernière heure', 'Letzte Stunde'),
    last8h: ml('Last 8 hours', 'Dernières 8 heures', 'Letzte 8 Stunden'),
    last24h: ml('Last 24 hours', 'Dernières 24 heures', 'Letzte 24 Stunden'),
    last7d: ml('Last 7 days', 'Derniers 7 jours', 'Letzte 7 Tage'),
    noData: ml('No archived data for this period.', 'Aucune donnée archivée pour cette période.', 'Keine archivierten Daten für diesen Zeitraum.'),
    loading: ml('Loading…', 'Chargement…', 'Laden…')
  },
  alarms: {
    title: ml('Alarms & events', 'Alarmes & événements', 'Alarme & Ereignisse'),
    active: ml('Active alarms', 'Alarmes actives', 'Aktive Alarme'),
    none: ml('No active alarm.', 'Aucune alarme active.', 'Keine aktiven Alarme.'),
    colTime: ml('Since', 'Depuis', 'Seit'),
    colSource: ml('Source', 'Source', 'Quelle'),
    colMessage: ml('Message', 'Message', 'Meldung'),
    colValue: ml('Value', 'Valeur', 'Wert'),
    colSeverity: ml('Severity', 'Gravité', 'Priorität'),
    colAck: ml('Ack', 'Acq.', 'Quit.'),
    acknowledge: ml('Acknowledge', 'Acquitter', 'Quittieren'),
    acknowledged: ml('Acknowledged', 'Acquitté', 'Quittiert'),
    sevHigh: ml('High', 'Haute', 'Hoch'),
    sevWarn: ml('Warning', 'Alerte', 'Warnung'),
    thresholdMsg: ml('Threshold exceeded', 'Seuil dépassé', 'Grenzwert überschritten'),
    faultMsg: ml('Equipment fault', 'Défaut équipement', 'Anlagenstörung')
  },
  equipment: {
    title: ml('Equipment control', 'Commande des équipements', 'Anlagensteuerung'),
    waterLine: ml('Water line', 'File eau', 'Wasserstraße'),
    sludgeLine: ml('Sludge line', 'File boues', 'Schlammstraße'),
    state: ml('State', 'État', 'Status'),
    mode: ml('Mode', 'Mode', 'Modus'),
    load: ml('Load', 'Charge', 'Last'),
    current: ml('Current', 'Intensité', 'Strom'),
    hours: ml('Run hours', 'Heures de marche', 'Betriebsstunden'),
    stateRunning: ml('Running', 'En marche', 'In Betrieb'),
    stateStopped: ml('Stopped', 'Arrêté', 'Gestoppt'),
    stateFault: ml('Fault', 'Défaut', 'Störung'),
    modeAuto: ml('Auto', 'Auto', 'Auto'),
    modeManual: ml('Manual', 'Manuel', 'Manuell'),
    start: ml('Start', 'Démarrer', 'Starten'),
    stop: ml('Stop', 'Arrêter', 'Stoppen'),
    setAuto: ml('Set auto', 'Passer en auto', 'Auf Auto'),
    setManual: ml('Set manual', 'Passer en manuel', 'Auf Manuell'),
    viewOnly: ml('View only — you lack the control permission.', 'Lecture seule — permission de commande manquante.', 'Nur Ansicht — keine Steuerberechtigung.')
  },
  control: {
    confirmStart: ml('Start', 'Démarrer', 'Starten'),
    confirmStop: ml('Stop', 'Arrêter', 'Stoppen'),
    ok: ml('Command sent.', 'Commande envoyée.', 'Befehl gesendet.'),
    failed: ml('Command failed.', 'Échec de la commande.', 'Befehl fehlgeschlagen.')
  },
  common: {
    yes: ml('Yes', 'Oui', 'Ja'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    offline: ml('Live data unavailable (backend not connected).', 'Données live indisponibles (backend non connecté).', 'Live-Daten nicht verfügbar (Backend nicht verbunden).')
  }
} as const;

/** Confirm prompt for a start/stop action on one device. */
export function confirmControlMsg(action: 'start' | 'stop', name: string): string {
  if (action === 'start') {
    return localize(ml(`Start "${name}"?`, `Démarrer « ${name} » ?`, `„${name}" starten?`));
  }
  return localize(ml(`Stop "${name}"? This may affect the process.`, `Arrêter « ${name} » ? Cela peut affecter le procédé.`, `„${name}" stoppen? Dies kann den Prozess beeinträchtigen.`));
}
