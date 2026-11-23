// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The module's own strings (the guide's buttons, the page's texts), in the WebUI's current
 * language through the shared lit-translate singleton. The tutorials' texts are the modules'.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';

/** A tri-lingual string (English / French / German). */
export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

export const MSG = {
  // The guide.
  step: ml('Step %n/%t', 'Étape %n/%t', 'Schritt %n/%t'),
  minimize: ml('Minimize', 'Réduire', 'Minimieren'),
  restore: ml('Back to the tutorial', 'Reprendre le tutoriel', 'Zurück zum Tutorial'),
  quit: ml('Quit the tutorial', 'Quitter le tutoriel', 'Tutorial beenden'),
  previous: ml('Previous', 'Précédent', 'Zurück'),
  next: ml('Next', 'Suivant', 'Weiter'),
  finish: ml('Finish', 'Terminer', 'Fertig'),
  skip: ml('Skip', 'Passer', 'Überspringen'),
  skipTitle: ml('Skip this step without doing it', 'Passer cette étape sans la faire', 'Diesen Schritt überspringen'),
  yourTurn: ml('Your turn!', 'À toi de jouer !', 'Du bist dran!'),
  wellDone: ml('Well done!', 'Bien joué !', 'Gut gemacht!'),
  finished: ml('Well done, you finished “%s”! Over to you now.', 'Bravo, tu as terminé « %s » ! À toi de t’en servir maintenant.', 'Bravo, du hast „%s“ abgeschlossen! Jetzt bist du dran.'),
  close: ml('Close', 'Fermer', 'Schließen'),
  more: ml('Other tutorials', 'Autres tutoriels', 'Weitere Tutorials'),
  guide: ml('Sigma, the tutorials’ guide', 'Sigma, le guide des tutoriels', 'Sigma, der Tutorial-Guide'),
  dialog: ml('Tutorial: %s', 'Tutoriel : %s', 'Tutorial: %s'),

  // The page.
  title: ml('Tutorials', 'Tutoriels', 'Tutorials'),
  subtitle: ml('Learn the application by using it', 'Apprendre l’application en la pratiquant', 'Die Anwendung durch Tun lernen'),
  badges: ml('%n / %t badges', '%n / %t badges', '%n / %t Abzeichen'),
  loading: ml('Gathering the tutorials…', 'Je rassemble les tutoriels…', 'Ich sammle die Tutorials…'),
  none: ml(
    'No tutorial yet: the modules of this site declare none (tutorial/<id>.json).',
    'Aucun tutoriel pour l’instant : les modules de ce site n’en déclarent pas (tutorial/<id>.json).',
    'Noch kein Tutorial: Die Module dieser Seite deklarieren keines (tutorial/<id>.json).'
  ),
  hello: ml(
    'Hello! I am Sigma. Pick a tutorial: I show you, you do it.',
    'Bonjour ! Je suis Sigma. Choisis un tutoriel : je te montre, tu fais.',
    'Hallo! Ich bin Sigma. Wähle ein Tutorial: Ich zeige es dir, du machst es.'
  ),
  welcomeBack: ml('Welcome back! %n badge(s) left to earn.', 'Content de te revoir ! Encore %n badge(s) à gagner.', 'Willkommen zurück! Noch %n Abzeichen zu verdienen.'),
  allEarned: ml(
    'Every badge is yours, well done! Do a tutorial again whenever you like.',
    'Tous les badges sont à toi, bravo ! Refais un tutoriel quand tu veux.',
    'Alle Abzeichen gehören dir, bravo! Wiederhole ein Tutorial, wann du willst.'
  ),
  steps: ml('%n steps', '%n étapes', '%n Schritte'),
  forRoles: ml('For: %s', 'Pour : %s', 'Für: %s'),
  forRolesTitle: ml(
    'The Application Security roles that do what this tutorial teaches',
    'Les rôles Application Security qui font ce que ce tutoriel enseigne',
    'Die Application-Security-Rollen, die tun, was dieses Tutorial lehrt'
  ),
  start: ml('Start', 'Commencer', 'Starten'),
  restart: ml('Restart', 'Recommencer', 'Neu starten'),
  again: ml('Do it again', 'Refaire', 'Wiederholen'),
  reset: ml('Clear my badges', 'Effacer mes badges', 'Meine Abzeichen löschen')
};

/** `%n`, `%t` and `%s` filled in a string already localized. */
export function fill(template: string, values: { n?: number; t?: number; s?: string }): string {
  return template
    .replaceAll('%n', String(values.n ?? ''))
    .replaceAll('%t', String(values.t ?? ''))
    .replaceAll('%s', values.s ?? '');
}
