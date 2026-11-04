// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Strings of the Machine Sim status page (English / French / German), through
 * the shared kit's `ml` / `localize` / `localizeDir`.
 */
import { ml } from '@visuelconcept-winccoa/wui-kit/i18n.js';

export { localize, localizeDir } from '@visuelconcept-winccoa/wui-kit/i18n.js';

export const MSG = {
  title: ml('Machine simulator', 'Simulateur machines', 'Maschinensimulator'),
  warning: ml(
    'Simulator for demos, training and commissioning: it creates MachineSim_* datapoints and writes their values continuously. Never run it on a production system.',
    'Simulateur pour les démonstrations, la formation et la mise en service : il crée des datapoints MachineSim_* et en écrit les valeurs en continu. Ne jamais le démarrer sur un système de production.',
    'Simulator für Vorführungen, Schulung und Inbetriebnahme: er legt MachineSim_*-Datenpunkte an und schreibt fortlaufend ihre Werte. Niemals auf einem Produktivsystem starten.'
  ),
  autoMap: ml(
    'AUTO_MAP is off by default: the manager never rewrites an atelier. Bind a machine to its MachineSim_<machine> elements in the Machine Fleet 3D machine dialog, or add --auto-map to the machineSim line of config/progs to wire every machine that has no state binding yet.',
    'AUTO_MAP est désactivé par défaut : le manager ne réécrit jamais un atelier. Liez une machine à ses éléments MachineSim_<machine> dans la fenêtre machine de Machine Fleet 3D, ou ajoutez --auto-map à la ligne machineSim de config/progs pour lier toutes les machines qui n’ont pas encore de liaison d’état.',
    'AUTO_MAP ist standardmäßig aus: der Manager schreibt nie ein Werkstatt-Layout um. Binden Sie eine Maschine im Maschinendialog von Machine Fleet 3D an ihre MachineSim_<Maschine>-Elemente, oder ergänzen Sie die machineSim-Zeile in config/progs um --auto-map, um jede Maschine ohne Zustandsbindung zu verknüpfen.'
  ),
  datapoint: ml('Simulated datapoint', 'Datapoint simulé', 'Simulierter Datenpunkt'),
  state: ml('State', 'État', 'Zustand'),
  comm: ml('Communication', 'Communication', 'Kommunikation'),
  count: ml('simulated machine(s)', 'machine(s) simulée(s)', 'simulierte Maschine(n)'),
  none: ml(
    'No MachineSim datapoint: the machineSim manager has not run on this project yet. Start it in the WinCC OA console (it is registered as manual).',
    'Aucun datapoint MachineSim : le manager machineSim n’a pas encore tourné sur ce projet. Démarrez-le dans la console WinCC OA (il est enregistré en manuel).',
    'Kein MachineSim-Datenpunkt: der Manager machineSim ist in diesem Projekt noch nicht gelaufen. Starten Sie ihn in der WinCC OA-Konsole (er ist als manuell eingetragen).'
  ),
  unavailable: ml(
    'The datapoints could not be read.',
    'Les datapoints n’ont pas pu être lus.',
    'Die Datenpunkte konnten nicht gelesen werden.'
  ),
  roleForbidden: ml(
    'Your groups do not hold the "view" role of this page.',
    'Vos groupes ne détiennent pas le rôle « Consulter » de cette page.',
    'Ihre Gruppen besitzen die Rolle „Ansehen“ dieser Seite nicht.'
  ),
  states: {
    0: ml('Stopped', 'Arrêt', 'Gestoppt'),
    1: ml('Running', 'En marche', 'In Betrieb'),
    2: ml('Fault', 'Défaut', 'Störung'),
    3: ml('Maintenance', 'Maintenance', 'Wartung')
  } as Record<number, ReturnType<typeof ml>>,
  commOk: ml('OK', 'OK', 'OK'),
  commLost: ml('Lost', 'Perdue', 'Verloren')
};
