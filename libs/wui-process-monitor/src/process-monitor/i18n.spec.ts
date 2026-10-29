// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The Console confirmations (issue 34): `<wui-confirm-dialog>` defaults to a deletion
 * dialog, so each one must say what it does — a stop must never read "Delete".
 */
import { describe, expect, it } from 'vitest';
import { CONFIRM_TEXTS, type ConfirmIntent } from './i18n.js';

const DELETION = /delete|supprim|lösch/i;

describe('Console confirmation dialogs', () => {
  it('the stop confirmation says Stop / Arrêter / Stoppen, never Delete / Supprimer', () => {
    const stop = CONFIRM_TEXTS.stop;
    expect(stop.confirm).toEqual({ 'en_US.utf8': 'Stop', 'fr.utf8': 'Arrêter', 'de.utf8': 'Stoppen' });
    for (const text of [...Object.values(stop.heading), ...Object.values(stop.confirm)]) {
      expect(text).not.toMatch(DELETION);
    }
  });

  it('start, stop, restart and restart-all never word a deletion', () => {
    const intents: ConfirmIntent[] = ['start', 'stop', 'restart', 'restart-all'];
    for (const intent of intents) {
      const { heading, confirm } = CONFIRM_TEXTS[intent];
      for (const text of [...Object.values(heading), ...Object.values(confirm)]) expect(text).not.toMatch(DELETION);
    }
  });

  it('every intent has a heading and a button in en / fr / de', () => {
    const langs = ['de.utf8', 'en_US.utf8', 'fr.utf8'];
    for (const { heading, confirm } of Object.values(CONFIRM_TEXTS)) {
      expect(Object.keys(heading).sort()).toEqual(langs);
      expect(Object.keys(confirm).sort()).toEqual(langs);
      for (const text of [...Object.values(heading), ...Object.values(confirm)]) expect(text).toBeTruthy();
    }
  });

  it('the instance deletion says "Delete instance" in its heading and on its button (issue 39)', () => {
    const { heading, confirm } = CONFIRM_TEXTS['delete-instance'];
    expect(heading).toEqual(confirm);
    expect(confirm).toEqual({ 'en_US.utf8': 'Delete instance', 'fr.utf8': 'Supprimer l’instance', 'de.utf8': 'Instanz löschen' });
  });

  it('the manager deletion says "Delete manager" in its heading and on its button (issue 40)', () => {
    const { heading, confirm } = CONFIRM_TEXTS.remove;
    expect(heading).toEqual(confirm);
    expect(confirm).toEqual({ 'en_US.utf8': 'Delete manager', 'fr.utf8': 'Supprimer le manager', 'de.utf8': 'Manager löschen' });
  });
});
