// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Local multiplayer of City Drive (#83): who plays with which device, and the timed match.
 * Pure, no DOM.
 *
 * Devices: the keyboard (one player at most) and the USB gamepads, told apart by the index the
 * browser gives each pad for the session — two identical pads are two devices. "Press to join":
 * a slot is taken by the first device that presses its join button (A / Start on a pad, Enter /
 * Space on the keyboard) and freed by B / Escape.
 *
 * Match: countdown 3-2-1, then the given duration; the players are ranked by score when time is
 * up (logos taken break a tie).
 */

export const MAX_LOCAL_PLAYERS = 2;

export type DeviceId = 'keyboard' | `pad:${number}`;

export const padDevice = (index: number): DeviceId => `pad:${index}`;
export const padIndexOf = (d: DeviceId): number | null => (d.startsWith('pad:') ? Number(d.slice(4)) : null);

/** Buttons of the standard gamepad mapping used to join / leave. */
export const JOIN_BUTTONS = [0, 9]; // A, Start
export const LEAVE_BUTTON = 1; // B

export class JoinSlots {
  /** The device of each slot, or null while free. */
  readonly devices: (DeviceId | null)[];

  constructor(count: number) {
    this.devices = Array.from({ length: Math.max(1, Math.min(MAX_LOCAL_PLAYERS, count)) }, () => null);
  }

  get count(): number {
    return this.devices.length;
  }

  /** Every slot has its device. */
  get ready(): boolean {
    return this.devices.every((d) => d !== null);
  }

  slotOf(device: DeviceId): number {
    return this.devices.indexOf(device);
  }

  /** The device takes the first free slot (once); returns the slot, or -1 when full or already in. */
  join(device: DeviceId): number {
    if (this.slotOf(device) !== -1) return -1;
    const free = this.devices.indexOf(null);
    if (free === -1) return -1;
    this.devices[free] = device;
    return free;
  }

  /** The device leaves its slot; returns the slot it had, or -1. */
  leave(device: DeviceId): number {
    const slot = this.slotOf(device);
    if (slot !== -1) this.devices[slot] = null;
    return slot;
  }

  /** A slot lost its device (pad unplugged): free it, so the next pad pressing Start takes it. */
  drop(device: DeviceId): number {
    return this.leave(device);
  }

  /** The number of players changed: keeps the devices that still have a slot. */
  resize(count: number): JoinSlots {
    const next = new JoinSlots(count);
    this.devices.slice(0, next.count).forEach((d, k) => (next.devices[k] = d));
    return next;
  }
}

// --- match ---------------------------------------------------------------------------------

export type MatchPhase = 'countdown' | 'running' | 'over';
export const COUNTDOWN_S = 3;
export const MATCH_DURATIONS = [60, 120, 180, 300] as const;
/** Default match: one minute (a booth: one player after the other). */
export const DEFAULT_MATCH = 60;

export interface Standing {
  player: number;
  score: number;
  logos: number;
  rank: number;
}

export class Match {
  phase: MatchPhase = 'countdown';
  /** Seconds since the countdown started. */
  t = 0;

  constructor(readonly duration: number) {}

  /** Seconds left in the countdown (3, 2, 1) or in the match. */
  get remaining(): number {
    if (this.phase === 'countdown') return Math.max(0, COUNTDOWN_S - this.t);
    if (this.phase === 'running') return Math.max(0, COUNTDOWN_S + this.duration - this.t);
    return 0;
  }

  /** The players may move. */
  get live(): boolean {
    return this.phase === 'running';
  }

  /** Advances by dt; returns the phase it entered at this step, or null. */
  step(dt: number): MatchPhase | null {
    if (this.phase === 'over') return null;
    this.t += dt;
    if (this.phase === 'countdown' && this.t >= COUNTDOWN_S) {
      this.phase = 'running';
      return 'running';
    }
    if (this.phase === 'running' && this.t >= COUNTDOWN_S + this.duration) {
      this.phase = 'over';
      return 'over';
    }
    return null;
  }
}

/** Ranks the players: score first, then logos taken; equal players share a rank. */
export function standings(players: readonly { score: number; logos: number }[]): Standing[] {
  const rows = players.map((p, k) => ({ player: k, score: p.score, logos: p.logos, rank: 0 }));
  const sorted = [...rows].sort((a, b) => b.score - a.score || b.logos - a.logos);
  sorted.forEach((r, k) => {
    const prev = sorted[k - 1];
    r.rank = prev && prev.score === r.score && prev.logos === r.logos ? prev.rank : k + 1;
  });
  return sorted;
}

/** `m:ss` of a number of seconds (rounded up, so the clock reads 0:00 only at the end). */
export function clock(seconds: number): string {
  const s = Math.ceil(Math.max(0, seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
