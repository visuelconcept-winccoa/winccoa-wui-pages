// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The weather of City Drive (#95), driven by datapoints: `CityDrive_Config.json` may bind the
 * rain and the fog to DPEs of the plant (a weather station, a simulator…):
 *
 *   { "weather": { "rain": "Meteo.RainRate", "fog": "Meteo.Visibility", "rainMax": 10, "fogInverse": true } }
 *
 * A value becomes a level 0..1: a boolean is 0 / 1; a number is divided by its max (`rainMax` /
 * `fogMax`, default 1 — or 100 when the value is above 1, taken as a percentage), clamped;
 * `fogInverse` reads a visibility (high = clear). Without a binding (demo) the weather turns
 * on its own: a shower every few minutes, mist at dawn. Pure.
 */

export interface WeatherBinding {
  rain?: string;
  fog?: string;
  rainMax?: number;
  fogMax?: number;
  /** The fog DPE is a visibility: 1 - level. */
  fogInverse?: boolean;
}

export interface Weather {
  /** 0 dry … 1 downpour. */
  rain: number;
  /** 0 clear … 1 thick fog. */
  fog: number;
}

export const CLEAR: Weather = { rain: 0, fog: 0 };

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** A DPE value as a level 0..1. */
export function weatherLevel(value: unknown, max?: number, inverse = false): number {
  let v: number;
  if (typeof value === 'boolean') v = value ? 1 : 0;
  else if (typeof value === 'number') v = value;
  else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) v = Number(value);
  else return inverse ? 0 : 0;
  const scale = max && max > 0 ? max : v > 1 ? 100 : 1;
  const level = clamp01(v / scale);
  return inverse ? 1 - level : level;
}

/** The binding of the config's `weather` object, or null. */
export function parseWeatherBinding(raw: unknown): WeatherBinding | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const n = (v: unknown): number | undefined => (typeof v === 'number' && v > 0 ? v : undefined);
  const b: WeatherBinding = { rain: s(o.rain) || undefined, fog: s(o.fog) || undefined, rainMax: n(o.rainMax), fogMax: n(o.fogMax), fogInverse: o.fogInverse === true };
  return b.rain || b.fog ? b : null;
}

/** The demo's own weather at time t (s): a shower about every 3 min (40 s of rain), a light mist that comes and goes. */
export function demoWeather(t: number): Weather {
  const cycle = t % 180;
  const rain = cycle < 120 ? 0 : clamp01(Math.sin(((cycle - 120) / 60) * Math.PI) * 1.3);
  const fog = clamp01(0.15 + 0.15 * Math.sin(t / 47));
  return { rain, fog };
}

/** Wet roads: the grip falls with the rain, down to 75 %. */
export const gripFactor = (w: Weather): number => 1 - 0.25 * clamp01(w.rain);

/** Moves the shown weather towards the target (it never jumps): ~4 s to turn around. */
export function easeWeather(now: Weather, target: Weather, dt: number): Weather {
  const k = Math.min(1, dt * 0.25);
  return { rain: now.rain + (target.rain - now.rain) * k, fog: now.fog + (target.fog - now.fog) * k };
}
