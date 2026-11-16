// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** The minimap of City Drive (#79): a 2D canvas, north (+Z) up, in the neon palette. */
import type { MachineState } from './bindings.js';
import { ROAD_WIDTH, roadAxis, type City } from './city.js';
import type { Point } from './missions.js';
import { mix, type NeonPalette } from './palette.js';
import { carPose, type TrafficCar } from './traffic.js';

const css = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export function drawMinimap(
  canvas: HTMLCanvasElement,
  city: City,
  p: NeonPalette,
  player: { x: number; z: number; heading: number },
  playerColor: number,
  traffic: readonly TrafficCar[],
  machines: ReadonlyMap<string, MachineState>,
  target: Point | null,
  targetColor: number,
  others: readonly { x: number; z: number; color: number }[] = []
): void {
  const g = canvas.getContext('2d');
  if (!g) return;
  const size = canvas.width;
  const pad = 10;
  const k = (size - 2 * pad) / (city.size + ROAD_WIDTH);
  // +Z up on the map, +X to the left (a map seen from above, as the driver sees it)
  const mx = (x: number): number => size - pad - (x + ROAD_WIDTH / 2) * k;
  const mz = (z: number): number => size - pad - (z + ROAD_WIDTH / 2) * k;
  g.clearRect(0, 0, size, size);
  g.fillStyle = css(mix(p.night, 0x000000, 0.3));
  g.globalAlpha = 0.88;
  g.fillRect(0, 0, size, size);
  g.globalAlpha = 1;
  // roads
  g.strokeStyle = css(mix(p.primary, p.night, 0.55));
  g.lineWidth = Math.max(1.5, ROAD_WIDTH * k * 0.7);
  g.beginPath();
  for (let n = 0; n <= city.blocks; n++) {
    const a = roadAxis(n);
    g.moveTo(mx(a), mz(0));
    g.lineTo(mx(a), mz(city.size));
    g.moveTo(mx(0), mz(a));
    g.lineTo(mx(city.size), mz(a));
  }
  g.stroke();
  // station and machines
  const box = (b: { x0: number; z0: number; x1: number; z1: number }, color: string): void => {
    g.fillStyle = color;
    g.fillRect(mx(b.x1), mz(b.z1), (b.x1 - b.x0) * k, (b.z1 - b.z0) * k);
  };
  box(city.station, css(mix(p.warning, p.night, 0.4)));
  for (const b of city.buildings) {
    if (!b.machine) continue;
    const st = machines.get(b.id) ?? 'unknown';
    box(b, css(st === 'run' ? p.success : st === 'fault' ? p.alarm : st === 'stop' ? p.neutral : p.info));
  }
  // traffic
  g.fillStyle = css(mix(p.dynamic, 0xffffff, 0.2));
  for (const c of traffic) {
    const q = carPose(c);
    g.fillRect(mx(q.x) - 1.5, mz(q.z) - 1.5, 3, 3);
  }
  // other players
  for (const o of others) {
    g.fillStyle = css(o.color);
    g.shadowColor = css(o.color);
    g.shadowBlur = 6;
    g.beginPath();
    g.arc(mx(o.x), mz(o.z), 3.5, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
  }
  // target
  if (target) {
    g.strokeStyle = css(targetColor);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(mx(target.x), mz(target.z), 6, 0, Math.PI * 2);
    g.stroke();
  }
  // player: an arrow along the heading (forward = (sin h, cos h) → map (-sin h, -cos h))
  const px = mx(player.x);
  const pz = mz(player.z);
  const fx = -Math.sin(player.heading);
  const fz = -Math.cos(player.heading);
  g.fillStyle = css(playerColor);
  g.shadowColor = css(playerColor);
  g.shadowBlur = 8;
  g.beginPath();
  g.moveTo(px + fx * 8, pz + fz * 8);
  g.lineTo(px - fx * 5 + fz * 5, pz - fz * 5 - fx * 5);
  g.lineTo(px - fx * 5 - fz * 5, pz - fz * 5 + fx * 5);
  g.closePath();
  g.fill();
  g.shadowBlur = 0;
}
