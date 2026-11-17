// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Logo hunt (game mode of City Drive): WinCC OA tokens float over the middle of the roads;
 * driving (or walking) through one blows it up and scores. Pure, no three.js.
 *
 * Scoring: 100 points per token, times the combo — the combo grows by one for each token taken
 * within {@link COMBO_WINDOW_S} seconds of the previous one (up to ×{@link COMBO_MAX}) and falls
 * back to ×1 otherwise. When every token of a wave is taken, a wave bonus is added and a new
 * wave is laid elsewhere.
 */
import { CELL, ROAD_WIDTH, rng, type City } from './city.js';

export const TOKENS_PER_WAVE = 24;
export const PICK_RADIUS = 3.4;
export const TOKEN_POINTS = 100;
export const COMBO_WINDOW_S = 6;
export const COMBO_MAX = 5;
export const WAVE_BONUS = 1000;
const MIN_SPACING = 30;

export interface Token {
  id: number;
  x: number;
  z: number;
  taken: boolean;
}

export interface Pickup {
  token: Token;
  points: number;
  combo: number;
}

export interface HuntStep {
  pickups: Pickup[];
  /** A wave was just completed (its bonus is in `points`). */
  waveDone: boolean;
  points: number;
}

/** `count` tokens on the road axes (not in a crossroads), at least 30 m apart. */
export function placeTokens(city: City, count: number, seed: number, idFrom = 0): Token[] {
  const rand = rng(seed);
  const out: Token[] = [];
  const crossroads = ROAD_WIDTH / 2 + 4;
  for (let tries = 0; out.length < count && tries < count * 60; tries++) {
    const k = Math.floor(rand() * (city.blocks + 1));
    const s = 6 + rand() * (city.size - 12);
    const along = s - Math.round(s / CELL) * CELL;
    if (Math.abs(along) < crossroads) continue;
    const onX = rand() < 0.5;
    const x = onX ? s : k * CELL;
    const z = onX ? k * CELL : s;
    if (out.some((t) => Math.hypot(t.x - x, t.z - z) < MIN_SPACING)) continue;
    out.push({ id: idFrom + out.length, x, z, taken: false });
  }
  return out;
}

export class LogoHunt {
  tokens: Token[];
  combo = 1;
  wave = 1;
  collected = 0;
  private lastPickAt = -Infinity;

  constructor(
    private readonly city: City,
    private readonly seed = 2026
  ) {
    this.tokens = placeTokens(city, TOKENS_PER_WAVE, seed);
  }

  /** Tokens left in the current wave. */
  get left(): number {
    return this.tokens.filter((t) => !t.taken).length;
  }

  /** Takes the tokens within reach of (x, z) at time `t` (s). */
  step(x: number, z: number, t: number): HuntStep {
    const pickups: Pickup[] = [];
    let points = 0;
    for (const token of this.tokens) {
      if (token.taken || Math.hypot(token.x - x, token.z - z) > PICK_RADIUS) continue;
      token.taken = true;
      this.combo = t - this.lastPickAt <= COMBO_WINDOW_S ? Math.min(COMBO_MAX, this.combo + 1) : 1;
      this.lastPickAt = t;
      this.collected++;
      const p = TOKEN_POINTS * this.combo;
      points += p;
      pickups.push({ token, points: p, combo: this.combo });
    }
    let waveDone = false;
    if (pickups.length > 0 && this.left === 0) {
      waveDone = true;
      points += WAVE_BONUS * this.wave;
      this.wave++;
      this.tokens = placeTokens(this.city, TOKENS_PER_WAVE, this.seed + this.wave * 101, this.wave * 1000);
    }
    return { pickups, waveDone, points };
  }

  /** The combo still running at time `t`, or 1 once its window is over. */
  comboAt(t: number): number {
    return t - this.lastPickAt <= COMBO_WINDOW_S ? this.combo : 1;
  }
}
