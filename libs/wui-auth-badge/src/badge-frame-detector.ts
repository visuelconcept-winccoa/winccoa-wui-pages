// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Discrimination de la trame d'un lecteur de badge RFID en émulation clavier
 * (SL-BDG-06).
 *
 * Une trame valide est une rafale de caractères terminée par la touche de fin
 * (`endKey`, Entrée par défaut), reçue en moins de `maxFrameMs` entre le premier
 * caractère et la touche de fin (H-17), commençant
 * par le préfixe configuré sur le lecteur (H-18) et portant au moins
 * `minUidLength` caractères après ce préfixe. Toute autre frappe est ignorée :
 * un numéro tapé au clavier, même exact, ne produit jamais de trame.
 */

export interface BadgeFrameOptions {
  /** Préfixe émis par le lecteur devant le numéro (H-18) ; vide si aucun. */
  prefix: string;
  /** Durée maximale entre le premier caractère et la touche de fin, en ms (H-17). */
  maxFrameMs: number;
  /** Longueur minimale du numéro, préfixe exclu. */
  minUidLength: number;
  /** Touche émise par le lecteur après le numéro (`KeyboardEvent.key`). */
  endKey: 'Enter' | 'Tab';
}

export const DEFAULT_BADGE_FRAME_OPTIONS: BadgeFrameOptions = {
  prefix: '',
  maxFrameMs: 150,
  minUidLength: 4,
  endKey: 'Enter'
};

export class BadgeFrameDetector {
  private buffer = '';
  private startedAt?: number;

  constructor(
    private readonly options: BadgeFrameOptions = DEFAULT_BADGE_FRAME_OPTIONS
  ) {}

  /**
   * Fournit une touche (`KeyboardEvent.key`) et son horodatage en ms.
   * Renvoie le numéro de badge quand une trame valide se termine.
   */
  push(key: string, at: number): string | undefined {
    if (key === this.options.endKey) {
      const uid = this.completeFrame(at);
      this.reset();
      return uid;
    }

    // Touches de contrôle (Shift émis par certains lecteurs, flèches…) : sans effet.
    if (key.length !== 1) return undefined;

    if (
      this.startedAt === undefined ||
      at - this.startedAt > this.options.maxFrameMs
    ) {
      this.buffer = '';
      this.startedAt = at;
    }
    this.buffer += key;
    return undefined;
  }

  reset(): void {
    this.buffer = '';
    this.startedAt = undefined;
  }

  private completeFrame(at: number): string | undefined {
    if (this.startedAt === undefined) return undefined;
    if (at - this.startedAt > this.options.maxFrameMs) return undefined;

    const { prefix, minUidLength } = this.options;
    if (!this.buffer.startsWith(prefix)) return undefined;

    const uid = this.buffer.slice(prefix.length).trim();
    return uid.length >= minUidLength ? uid : undefined;
  }
}
