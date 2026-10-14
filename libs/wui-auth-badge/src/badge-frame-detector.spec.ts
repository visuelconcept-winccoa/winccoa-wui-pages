// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, expect, it } from 'vitest';
import { BadgeFrameDetector } from './badge-frame-detector.js';

/** Frappe une chaîne puis Entrée, un caractère tous les `stepMs`. */
function type(
  detector: BadgeFrameDetector,
  text: string,
  stepMs: number,
  start = 0
) {
  let at = start;
  for (const key of text) {
    detector.push(key, at);
    at += stepMs;
  }
  return detector.push('Enter', at);
}

describe('BadgeFrameDetector (SL-BDG-06)', () => {
  const options = { prefix: '#', maxFrameMs: 150, minUidLength: 4 };

  it('accepte une rafale du lecteur et retire le préfixe', () => {
    const detector = new BadgeFrameDetector(options);
    expect(type(detector, '#04A1B2C3D4', 5)).toBe('04A1B2C3D4');
  });

  it('ignore un numéro tapé au clavier, même exact', () => {
    const detector = new BadgeFrameDetector(options);
    expect(type(detector, '#04A1B2C3D4', 120)).toBeUndefined();
  });

  it('ignore une rafale sans le préfixe du lecteur (H-18)', () => {
    const detector = new BadgeFrameDetector(options);
    expect(type(detector, '04A1B2C3D4', 5)).toBeUndefined();
  });

  it('ignore une rafale trop courte', () => {
    const detector = new BadgeFrameDetector(options);
    expect(type(detector, '#12', 5)).toBeUndefined();
  });

  it('ignore Entrée seul et les touches de contrôle', () => {
    const detector = new BadgeFrameDetector(options);
    expect(detector.push('Enter', 0)).toBeUndefined();
    detector.push('Shift', 10);
    expect(type(detector, '#ABCD', 5, 11)).toBe('ABCD');
  });

  it('repart de zéro quand une frappe humaine précède la rafale', () => {
    const detector = new BadgeFrameDetector(options);
    for (const [key, at] of [
      ['1', 0],
      ['2', 400]
    ] as const)
      detector.push(key, at);
    expect(type(detector, '#04A1B2C3', 5, 1000)).toBe('04A1B2C3');
  });

  it('fonctionne sans préfixe configuré', () => {
    const detector = new BadgeFrameDetector({ ...options, prefix: '' });
    expect(type(detector, '04A1B2C3', 5)).toBe('04A1B2C3');
  });
});
