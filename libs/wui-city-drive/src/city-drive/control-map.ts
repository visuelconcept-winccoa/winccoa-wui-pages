// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The big map of the control room (#96): the city seen from above, as the game's minimap
 * (+Z up, +X to the left) but at screen size — roads, buildings, the plant's halls in the
 * colour of their machine's state, the fuel station; every player online as an arrow in its
 * neon colour with its nickname, a pulsing red ring around the wanted ones.
 */
import { ROAD_WIDTH, type City } from './city.js';
import type { MachineState } from './bindings.js';
import { mix, type NeonPalette } from './palette.js';

export interface MapPlayer {
  x: number;
  z: number;
  /** Radians, 0 = +Z. */
  heading: number;
  color: number;
  label: string;
  wanted: boolean;
  /** On foot: a dot, not an arrow. */
  onFoot: boolean;
}

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The canvas rotation of an arrow (drawn pointing up) for a heading (radians, 0 = +Z, forward =
 * (sin h, cos h)). On the map +Z is up and +X is to the left, so forward is (-sin h, -cos h)
 * on screen; rotating "up" (0, -1) by a gives (sin a, -cos a): a = -h.
 */
export const arrowAngle = (heading: number): number => -heading;

export function drawCityMap(
  canvas: HTMLCanvasElement,
  city: City,
  p: NeonPalette,
  machines: ReadonlyMap<string, MachineState>,
  players: readonly MapPlayer[],
  /** Seconds, for the pulse of the wanted rings. */
  t: number
): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  const pad = 24;
  const k = Math.min(w - 2 * pad, h - 2 * pad) / (city.size + ROAD_WIDTH);
  const ox = (w - (city.size + ROAD_WIDTH) * k) / 2;
  const oy = (h - (city.size + ROAD_WIDTH) * k) / 2;
  const mx = (x: number): number => w - ox - (x + ROAD_WIDTH / 2) * k;
  const mz = (z: number): number => h - oy - (z + ROAD_WIDTH / 2) * k;
  g.clearRect(0, 0, w, h);
  g.fillStyle = css(mix(p.night, 0x000000, 0.35));
  g.fillRect(0, 0, w, h);

  // buildings (plant halls in their machine's colour)
  for (const b of city.buildings) {
    const machine = b.machine ? (machines.get(b.id) ?? 'unknown') : null;
    const color = machine === 'run' ? p.success : machine === 'fault' ? p.alarm : machine === 'stop' ? p.neutral : machine ? p.info : mix(p.surface, p.night, 0.3);
    g.fillStyle = css(machine ? mix(color, p.night, 0.45) : color);
    g.fillRect(mx(b.x1), mz(b.z1), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    if (machine) {
      g.strokeStyle = css(color);
      g.lineWidth = 2;
      g.strokeRect(mx(b.x1), mz(b.z1), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
    }
  }
  // roads
  g.strokeStyle = css(mix(p.primary, p.night, 0.6));
  g.lineWidth = Math.max(2, ROAD_WIDTH * k * 0.75);
  g.beginPath();
  for (let i = 0; i <= city.blocks; i++) {
    const c = i * (city.size / city.blocks);
    g.moveTo(mx(c), mz(-ROAD_WIDTH / 2));
    g.lineTo(mx(c), mz(city.size + ROAD_WIDTH / 2));
    g.moveTo(mx(-ROAD_WIDTH / 2), mz(c));
    g.lineTo(mx(city.size + ROAD_WIDTH / 2), mz(c));
  }
  g.stroke();
  // the fuel station
  const s = city.station;
  g.strokeStyle = css(p.warning);
  g.lineWidth = 2;
  g.strokeRect(mx(s.x1), mz(s.z1), (s.x1 - s.x0) * k, (s.z1 - s.z0) * k);

  // the players
  const pulse = 0.5 + 0.5 * Math.sin(t * 6);
  g.font = '600 13px sans-serif';
  g.textAlign = 'center';
  for (const pl of players) {
    const x = mx(pl.x);
    const y = mz(pl.z);
    if (pl.wanted) {
      g.strokeStyle = css(p.alarm);
      g.globalAlpha = 0.35 + 0.65 * pulse;
      g.lineWidth = 3;
      g.beginPath();
      g.arc(x, y, 14 + 8 * pulse, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = 1;
    }
    g.fillStyle = css(pl.color);
    g.shadowColor = css(pl.color);
    g.shadowBlur = 10;
    if (pl.onFoot) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    } else {
      // an arrow along the heading (+Z up, +X left on the map)
      const a = arrowAngle(pl.heading);
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.beginPath();
      g.moveTo(0, -11);
      g.lineTo(7, 8);
      g.lineTo(0, 4);
      g.lineTo(-7, 8);
      g.closePath();
      g.fill();
      g.restore();
    }
    g.shadowBlur = 0;
    g.fillStyle = css(mix(pl.color, 0xffffff, 0.5));
    g.fillText(pl.label, x, y - 16);
  }
}
