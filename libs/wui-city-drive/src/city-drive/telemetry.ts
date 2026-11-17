// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * When the player's telemetry is written to its datapoint (#79). Pure.
 *
 * The game runs at 60 frames per second; the event manager must not. A sample is sent at most
 * `maxHz` times per second, and only when a value moved past its dead band — or when the event
 * or mission changed (always sent), or `heartbeatS` elapsed (so the archive keeps a trace of a
 * parked car).
 */
import type { Telemetry } from './game.js';

export interface ThrottleOptions {
  maxHz: number;
  heartbeatS: number;
  /** Dead band per numeric field. */
  deadband: Partial<Record<keyof Telemetry, number>>;
}

export const DEFAULT_THROTTLE: ThrottleOptions = {
  maxHz: 2,
  heartbeatS: 10,
  deadband: { x: 1, z: 1, heading: 5, speed: 2, fuel: 0.5, score: 0 }
};

export class TelemetryThrottle {
  private last: Telemetry | null = null;
  private lastAt = -Infinity;

  constructor(private readonly opts: ThrottleOptions = DEFAULT_THROTTLE) {}

  /** The fields to write now (only the changed ones), or null. `now` in seconds. */
  offer(sample: Telemetry, now: number): Partial<Telemetry> | null {
    const prev = this.last;
    const discrete = !prev || prev.event !== sample.event || prev.mission !== sample.mission;
    if (!discrete && now - this.lastAt < 1 / this.opts.maxHz) return null;
    const changed: Partial<Telemetry> = {};
    for (const key of Object.keys(sample) as (keyof Telemetry)[]) {
      const a = sample[key];
      const b = prev?.[key];
      const band = this.opts.deadband[key] ?? 0;
      const moved = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) > band || (band === 0 && a !== b) : a !== b;
      if (!prev || moved) (changed as Record<string, unknown>)[key] = a;
    }
    const heartbeat = now - this.lastAt >= this.opts.heartbeatS;
    if (Object.keys(changed).length === 0 && !heartbeat) return null;
    this.last = sample;
    this.lastAt = now;
    return heartbeat && Object.keys(changed).length === 0 ? { ...sample } : changed;
  }
}
