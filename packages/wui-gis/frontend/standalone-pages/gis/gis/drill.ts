// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Drill-down out of the map: map → area → asset → the view that explains it.
 *
 * There is no single "process view" page in this dashboard — a plant's process is
 * shown by whichever page models it (an Ampère single-line diagram, a Machine
 * Fleet 3D atelier, a Mosaic board, a widget dashboard). So the target is *config*,
 * not code: each {@link Asset}/{@link Area} carries a free `link` route, and the
 * editor offers {@link DRILL_PRESETS} as the shortcuts for the usual ones.
 *
 * The Alarms drill-down is the exception — it needs no configuration at all. Any
 * asset with a primary datapoint can be opened in the Alarms page scoped to it,
 * because `/alarms` reads a `dp` query parameter (see wui-alarms `scope()`).
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { ml } from './i18n.js';

/** A drill-down shortcut offered in the editor. */
export interface DrillPreset {
  /** Stable key, used as the select option value. */
  id: string;
  label: MultiLangString;
  /** Route with an `<id>` placeholder the user replaces with the target's id. */
  template: string;
  /** What the target page shows, so the choice is obvious without trying it. */
  hint: MultiLangString;
}

/**
 * The routes a geo-located asset is usually drilled into. Each is a page of this
 * dashboard; the `<id>` part is the target page's own entity id.
 */
export const DRILL_PRESETS: readonly DrillPreset[] = [
  {
    id: 'fleet-3d',
    label: ml(
      '3D view (Machine Fleet)',
      'Vue 3D (Parc machine)',
      '3D-Ansicht (Maschinenpark)'
    ),
    template: '/fleet-3d/<id>',
    hint: ml(
      'The 3D digital twin of one atelier — the atelier id.',
      'Le jumeau numérique 3D d’un atelier — l’identifiant de l’atelier.',
      'Der 3D-Zwilling einer Werkstatt — die Werkstatt-ID.'
    )
  },
  {
    id: 'ampere',
    label: ml(
      'Single-line diagram (Ampère)',
      'Schéma unifilaire (Ampère)',
      'Einpoliges Schema (Ampère)'
    ),
    template: '/ampere/<id>',
    hint: ml(
      'The electrical process view of one network — the network id.',
      'La vue process électrique d’un réseau — l’identifiant du réseau.',
      'Die elektrische Prozessansicht eines Netzes — die Netz-ID.'
    )
  },
  {
    id: 'mosaic',
    label: ml(
      'Display wall (Mosaic)',
      'Mur d’images (Mosaïque)',
      'Bildwand (Mosaic)'
    ),
    template: '/mosaic/<id>',
    hint: ml(
      'A board combining several views — the board id.',
      'Un tableau combinant plusieurs vues — l’identifiant du tableau.',
      'Eine Tafel mit mehreren Ansichten — die Tafel-ID.'
    )
  },
  {
    id: 'audit-trail',
    label: ml(
      'Value history (Audit Trail)',
      'Historique (Piste d’audit)',
      'Werteverlauf (Audit Trail)'
    ),
    template: '/audit-trail',
    hint: ml(
      'The archived history of a datapoint.',
      'L’historique archivé d’un datapoint.',
      'Der archivierte Verlauf eines Datenpunkts.'
    )
  },
  {
    id: 'custom',
    label: ml('Other route…', 'Autre route…', 'Andere Route…'),
    template: '',
    hint: ml(
      'Any in-app route, starting with a slash.',
      'N’importe quelle route de l’application, commençant par une barre oblique.',
      'Jede App-Route, beginnend mit einem Schrägstrich.'
    )
  }
];

/** The Alarms page route scoped to one datapoint (empty ⇒ the whole system). */
export function alarmsRoute(dp: string): string {
  const scope = dp.trim();
  if (!scope) return '/alarms';
  return `/alarms?dp=${encodeURIComponent(bareDp(scope))}`;
}

/**
 * The datapoint the Alarms page should be scoped to: alarms are configured on the
 * datapoint, so a bound *element* (`Pump01.flow`) is widened to its DP (`Pump01`)
 * — scoping the list to one element would hide the asset's other alarms.
 */
export function bareDp(dpe: string): string {
  const dot = dpe.indexOf('.');
  return dot === -1 ? dpe : dpe.slice(0, dot);
}

/**
 * The preset a stored `link` came from, so reopening the editor preselects it.
 * Falls back to `custom` for a hand-written route.
 */
export function presetOf(link: string): DrillPreset {
  const route = link.trim();
  const custom = DRILL_PRESETS.at(-1) as DrillPreset;
  if (!route) return custom;
  const match = DRILL_PRESETS.find((preset) => {
    const prefix = preset.template.replace('<id>', '');
    return prefix.length > 1 && route.startsWith(prefix);
  });
  return match ?? custom;
}

/** True for a route this dashboard can actually navigate to. */
export function isValidRoute(link: string): boolean {
  const route = link.trim();
  return route.startsWith('/') && !route.includes(' ');
}
