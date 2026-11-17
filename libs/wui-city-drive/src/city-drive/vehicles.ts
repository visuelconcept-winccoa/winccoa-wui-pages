// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The vehicles the player can choose (#79), their performance and their silhouette, the garage
 * (wheels, paint, the character's skin) and the player's profile. Pure.
 */
import { CAR, type CarSpec } from './physics.js';

export type VehicleId = 'coupe' | 'limousine' | 'pickup' | 'van' | 'roadster' | 'muscle' | 'estate' | 'cab';
/** The iX theme colour of the player's neon (palette.ts keys). */
export type NeonColor = 'primary' | 'dynamic' | 'info' | 'success' | 'warning' | 'alarm' | 'critical';

export interface Body {
  /** Width, height, length of the body (m). */
  w: number;
  h: number;
  l: number;
  /** Cabin: length, height (0 = none), position of its centre along the car (m, > 0 = front). */
  cabinL: number;
  cabinH: number;
  cabinZ: number;
  /** Cadillac-style tail fins. */
  fins?: boolean;
  /** Pickup bed length (m). */
  bed?: number;
}

export interface Vehicle {
  id: VehicleId;
  /** Its name in the game: an original "legend" name, no real make or model. */
  label: string;
  /** What kind of car it is. */
  kind: string;
  spec: CarSpec;
  body: Body;
  /** 1..5 bars shown in the choice. */
  rating: { speed: number; handling: number; range: number };
}

export const VEHICLES: readonly Vehicle[] = [
  {
    id: 'coupe',
    label: 'Neon Specter',
    kind: 'Finned coupé',
    spec: { ...CAR, radius: 2.5, wheelBase: 3.2, engine: 16, maxSpeed: 52, grip: 10, fuelPerSecond: 1 / 240 },
    body: { w: 2.05, h: 0.62, l: 5.4, cabinL: 1.9, cabinH: 0.52, cabinZ: -0.35, fins: true },
    rating: { speed: 5, handling: 4, range: 2 }
  },
  {
    id: 'roadster',
    label: 'Kitsune GT',
    kind: 'Roadster',
    spec: { ...CAR, radius: 2.2, wheelBase: 2.7, engine: 17, maxSpeed: 54, maxSteer: 0.75, grip: 11.5, driftGrip: 2.8, fuelPerSecond: 1 / 220 },
    body: { w: 1.95, h: 0.5, l: 4.4, cabinL: 1.3, cabinH: 0.42, cabinZ: -0.45 },
    rating: { speed: 5, handling: 5, range: 1 }
  },
  {
    id: 'muscle',
    label: 'Thunder Ronin',
    kind: 'Muscle car',
    spec: { ...CAR, radius: 2.5, wheelBase: 3.1, engine: 19, maxSpeed: 50, grip: 8.5, driftGrip: 1.8, fuelPerSecond: 1 / 200 },
    body: { w: 2.15, h: 0.7, l: 5.1, cabinL: 1.6, cabinH: 0.48, cabinZ: -0.65 },
    rating: { speed: 5, handling: 3, range: 1 }
  },
  {
    id: 'limousine',
    label: 'Grand Duchess',
    kind: 'Limousine',
    spec: { ...CAR, radius: 3.3, wheelBase: 4.6, engine: 11, maxSpeed: 44, maxSteer: 0.62, grip: 8.5, driftGrip: 2, fuelPerSecond: 1 / 280 },
    body: { w: 2.1, h: 0.64, l: 7.8, cabinL: 4.3, cabinH: 0.55, cabinZ: -0.45, fins: true },
    rating: { speed: 3, handling: 2, range: 3 }
  },
  {
    id: 'estate',
    label: 'Night Courier',
    kind: 'Estate',
    spec: { ...CAR, radius: 2.6, wheelBase: 3.3, engine: 13, maxSpeed: 45, grip: 9, fuelPerSecond: 1 / 330 },
    body: { w: 2.05, h: 0.64, l: 5.6, cabinL: 3.1, cabinH: 0.55, cabinZ: -0.55 },
    rating: { speed: 3, handling: 3, range: 4 }
  },
  {
    id: 'cab',
    label: 'Shinjuku Cab',
    kind: 'City taxi',
    spec: { ...CAR, radius: 2.4, wheelBase: 3.0, engine: 13, maxSpeed: 44, maxSteer: 0.72, grip: 10, fuelPerSecond: 1 / 360 },
    body: { w: 1.95, h: 0.66, l: 4.9, cabinL: 2.3, cabinH: 0.58, cabinZ: -0.1 },
    rating: { speed: 3, handling: 4, range: 4 }
  },
  {
    id: 'pickup',
    label: 'Iron Mule',
    kind: 'Pickup',
    spec: { ...CAR, radius: 2.5, wheelBase: 3.1, engine: 12, maxSpeed: 42, grip: 8, driftGrip: 2.2, fuelPerSecond: 1 / 320 },
    body: { w: 2.15, h: 0.82, l: 5.5, cabinL: 1.7, cabinH: 0.68, cabinZ: 0.95, bed: 2.3 },
    rating: { speed: 3, handling: 3, range: 4 }
  },
  {
    id: 'van',
    label: 'Hard Hat',
    kind: 'Maintenance van',
    spec: { ...CAR, radius: 2.7, wheelBase: 3.3, engine: 10, maxSpeed: 36, maxSteer: 0.55, grip: 7, driftGrip: 2.6, fuelPerSecond: 1 / 420 },
    body: { w: 2.2, h: 1.75, l: 5.4, cabinL: 0, cabinH: 0, cabinZ: 0 },
    rating: { speed: 2, handling: 2, range: 5 }
  }
];

// --- garage: wheels, paint, driver -----------------------------------------------------------

export type WheelId = 'small' | 'stock' | 'large' | 'monster';
/** Wheel sizes: their scale on the stock wheel (0.4 m radius). Looks only. */
export const WHEELS: readonly { id: WheelId; label: string; scale: number }[] = [
  { id: 'small', label: 'Low-profile', scale: 0.85 },
  { id: 'stock', label: 'Stock', scale: 1 },
  { id: 'large', label: 'Large', scale: 1.2 },
  { id: 'monster', label: 'Monster', scale: 1.5 }
];

export type PaintId = 'midnight' | 'black' | 'pearl' | 'chrome' | 'ruby' | 'sapphire' | 'emerald' | 'gold' | 'sunset';
/** Body paints (the neon colour is separate). */
export const PAINTS: readonly { id: PaintId; label: string; color: number }[] = [
  { id: 'midnight', label: 'Midnight teal', color: 0x14232a },
  { id: 'black', label: 'Piano black', color: 0x0a0b0d },
  { id: 'pearl', label: 'Pearl white', color: 0xd6dbde },
  { id: 'chrome', label: 'Liquid chrome', color: 0x8c959a },
  { id: 'ruby', label: 'Ruby red', color: 0x7a1020 },
  { id: 'sapphire', label: 'Sapphire blue', color: 0x15336f },
  { id: 'emerald', label: 'Emerald green', color: 0x0e5a3a },
  { id: 'gold', label: 'Champagne gold', color: 0x9c7c2c },
  { id: 'sunset', label: 'Sunset orange', color: 0xb5520f }
];

/** Skin tones of the player's character on foot (index into figure-model.ts' SKINS). */
export const SKIN_TONES = 5;

export const wheelById = (id: string): (typeof WHEELS)[number] => WHEELS.find((w) => w.id === id) ?? WHEELS[1];
export const paintById = (id: string): (typeof PAINTS)[number] => PAINTS.find((c) => c.id === id) ?? PAINTS[0];

export const NEON_COLORS: readonly NeonColor[] = ['primary', 'dynamic', 'info', 'success', 'warning', 'alarm', 'critical'];

export interface Profile {
  nickname: string;
  vehicle: VehicleId;
  color: NeonColor;
  /** Garage: body paint, wheel size, the character's skin tone (0 light … 4 dark). */
  paint: PaintId;
  wheels: WheelId;
  skin: number;
  /** Night (the neon city) or day. */
  time: 'night' | 'day';
  /** Game mode: deliveries and interventions, or the logo hunt. */
  mode: 'missions' | 'logos';
}

export const DEFAULT_PROFILE: Profile = { nickname: '', vehicle: 'coupe', color: 'primary', paint: 'midnight', wheels: 'stock', skin: 0, time: 'night', mode: 'logos' };
export const NICKNAME_MAX = 20;

export const vehicleById = (id: string): Vehicle => VEHICLES.find((v) => v.id === id) ?? VEHICLES[0];

/** A nickname: trimmed, printable, at most {@link NICKNAME_MAX} characters. */
export function cleanNickname(raw: string): string {
  return [...raw.replaceAll(/[\p{C}]/gu, '').trim()].slice(0, NICKNAME_MAX).join('');
}

/** A stored profile, repaired field by field. */
export function parseProfile(raw: unknown): Profile {
  const o = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const vehicle = VEHICLES.some((v) => v.id === o.vehicle) ? (o.vehicle as VehicleId) : DEFAULT_PROFILE.vehicle;
  const color = NEON_COLORS.includes(o.color as NeonColor) ? (o.color as NeonColor) : DEFAULT_PROFILE.color;
  const time = o.time === 'day' ? 'day' : 'night';
  const mode = o.mode === 'missions' ? 'missions' : 'logos';
  const paint = PAINTS.some((c) => c.id === o.paint) ? (o.paint as PaintId) : DEFAULT_PROFILE.paint;
  const wheels = WHEELS.some((w) => w.id === o.wheels) ? (o.wheels as WheelId) : DEFAULT_PROFILE.wheels;
  const skin = Number.isInteger(o.skin) && (o.skin as number) >= 0 && (o.skin as number) < SKIN_TONES ? (o.skin as number) : 0;
  return { nickname: typeof o.nickname === 'string' ? cleanNickname(o.nickname) : '', vehicle, color, paint, wheels, skin, time, mode };
}

/** One step through a list (wraps): the garage's ◀ ▶. */
export function cycle<T>(list: readonly T[], current: T, step: number): T {
  const i = Math.max(0, list.indexOf(current));
  return list[(i + step + list.length) % list.length];
}
