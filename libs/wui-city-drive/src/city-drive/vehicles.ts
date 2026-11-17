// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The vehicles the player can choose (#79), their performance and their silhouette, and the
 * player's profile (nickname, vehicle, neon colour). Pure.
 */
import { CAR, type CarSpec } from './physics.js';

export type VehicleId = 'coupe' | 'limousine' | 'pickup' | 'van';
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
  label: string;
  spec: CarSpec;
  body: Body;
  /** 1..5 bars shown in the choice. */
  rating: { speed: number; handling: number; range: number };
}

export const VEHICLES: readonly Vehicle[] = [
  {
    id: 'coupe',
    label: 'Coupé de Ville',
    spec: { ...CAR, radius: 2.5, wheelBase: 3.2, engine: 16, maxSpeed: 52, grip: 10, fuelPerSecond: 1 / 240 },
    body: { w: 2.05, h: 0.62, l: 5.4, cabinL: 1.9, cabinH: 0.52, cabinZ: -0.35, fins: true },
    rating: { speed: 5, handling: 4, range: 2 }
  },
  {
    id: 'limousine',
    label: 'Limousine',
    spec: { ...CAR, radius: 3.3, wheelBase: 4.6, engine: 11, maxSpeed: 44, maxSteer: 0.62, grip: 8.5, driftGrip: 2, fuelPerSecond: 1 / 280 },
    body: { w: 2.1, h: 0.64, l: 7.8, cabinL: 4.3, cabinH: 0.55, cabinZ: -0.45, fins: true },
    rating: { speed: 3, handling: 2, range: 3 }
  },
  {
    id: 'pickup',
    label: 'Pickup',
    spec: { ...CAR, radius: 2.5, wheelBase: 3.1, engine: 12, maxSpeed: 42, grip: 8, driftGrip: 2.2, fuelPerSecond: 1 / 320 },
    body: { w: 2.15, h: 0.82, l: 5.5, cabinL: 1.7, cabinH: 0.68, cabinZ: 0.95, bed: 2.3 },
    rating: { speed: 3, handling: 3, range: 4 }
  },
  {
    id: 'van',
    label: 'Maintenance van',
    spec: { ...CAR, radius: 2.7, wheelBase: 3.3, engine: 10, maxSpeed: 36, maxSteer: 0.55, grip: 7, driftGrip: 2.6, fuelPerSecond: 1 / 420 },
    body: { w: 2.2, h: 1.75, l: 5.4, cabinL: 0, cabinH: 0, cabinZ: 0 },
    rating: { speed: 2, handling: 2, range: 5 }
  }
];

export const NEON_COLORS: readonly NeonColor[] = ['primary', 'dynamic', 'info', 'success', 'warning', 'alarm', 'critical'];

export interface Profile {
  nickname: string;
  vehicle: VehicleId;
  color: NeonColor;
  /** Night (the neon city) or day. */
  time: 'night' | 'day';
  /** Game mode: deliveries and interventions, or the logo hunt. */
  mode: 'missions' | 'logos';
}

export const DEFAULT_PROFILE: Profile = { nickname: '', vehicle: 'coupe', color: 'primary', time: 'night', mode: 'logos' };
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
  return { nickname: typeof o.nickname === 'string' ? cleanNickname(o.nickname) : '', vehicle, color, time, mode };
}
