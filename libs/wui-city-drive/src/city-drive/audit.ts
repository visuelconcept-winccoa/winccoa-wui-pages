// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * City Drive's audit trail (#93): what happens on the game station, in the module's own
 * `_AuditTrail` datapoint `AuditTrail_CityDrive` — the GxP structure the Audit Trail page
 * shows (time · user · item · action · old → new · reason · host). The kit's
 * `AuditTrailWriter` creates the DP on first use (NGA-archived when an active archive group
 * exists) and never lets a failed write break the game.
 *
 * Actions:
 *   GAME_START          a match or a free drive starts (players, cars, duration, photo)
 *   GAME_END            a match ends (ranking: score and logos per player)
 *   REMATCH             "Play again" (same players)
 *   GAME_EXIT           back to the menu (after the podium, or a match left before its end)
 *   SEAT_JOIN / SEAT_LEAVE   a device takes / frees a seat in the lobby (two players)
 *   PHOTO_TAKEN / PHOTO_SKIPPED / PHOTO_FAILED   the photo booth
 *   PHOTO_PUBLISHED     the photo is online (Supabase object path, never the link)
 *   ALERT_ACKNOWLEDGED  the control room acknowledged a player's WinCC OA alert
 *   SETTINGS_UPDATE     the station's settings changed (old → new of the changed fields)
 *   RESULTS_EXPORT / RESULTS_RESET   the admin page exported (emails included) / emptied the results
 *
 * Personal data: no email ever goes into the audit (only whether one was given), nor the
 * photo's link (it would give the face to whoever reads the audit). Pure: the page writes the
 * records with the writer.
 */
import type { AuditRecord } from '@visuelconcept-winccoa/wui-kit/data/audit-trail.js';
import type { Standing } from './local-play.js';
import type { Settings } from './settings.js';

export const AUDIT_DP = 'AuditTrail_CityDrive';
export const AUDIT_ITEM_TYPE = 'CityDrive';

export type CityDriveAction =
  | 'GAME_START'
  | 'GAME_END'
  | 'REMATCH'
  | 'GAME_EXIT'
  | 'SEAT_JOIN'
  | 'SEAT_LEAVE'
  | 'PHOTO_TAKEN'
  | 'PHOTO_SKIPPED'
  | 'PHOTO_FAILED'
  | 'PHOTO_PUBLISHED'
  | 'ALERT_ACKNOWLEDGED'
  | 'SETTINGS_UPDATE'
  | 'RESULTS_EXPORT'
  | 'RESULTS_RESET';

/** A player as the audit sees it. */
export interface AuditPlayer {
  nickname: string;
  vehicle: string;
  device: string;
  /** Whether an email was given (never the email itself). */
  email: boolean;
}

const nameOf = (p: { nickname: string }, k: number): string => p.nickname.trim() || `Player ${k + 1}`;
/** The item of a record about the players: their nicknames. */
const playersItem = (players: readonly { nickname: string }[]): string => players.map(nameOf).join(' · ') || 'City Drive';
const json = (v: unknown): string => JSON.stringify(v);

/** A match (duration > 0) or a free drive (0) starts. */
export function gameStart(players: readonly AuditPlayer[], duration: number, mode: string, photo: 'taken' | 'skipped' | 'failed' | 'off'): AuditRecord {
  return {
    action: 'GAME_START',
    item: playersItem(players),
    newval: json({ match: duration > 0 ? `${duration} s` : 'free drive', mode, photo, players: players.map((p, k) => ({ nickname: nameOf(p, k), vehicle: p.vehicle, device: p.device, email: p.email })) }),
    reason: duration > 0 ? `Match of ${duration / 60} min` : 'Free drive'
  };
}

/** A match ends: the ranking. */
export function gameEnd(players: readonly { nickname: string }[], standings: readonly Standing[], duration: number): AuditRecord {
  return {
    action: 'GAME_END',
    item: playersItem(players),
    newval: json(standings.map((s) => ({ rank: s.rank, nickname: nameOf(players[s.player] ?? { nickname: '' }, s.player), score: s.score, logos: s.logos }))),
    reason: `Match of ${duration / 60} min over`
  };
}

export function rematch(players: readonly { nickname: string }[], duration: number): AuditRecord {
  return { action: 'REMATCH', item: playersItem(players), newval: json({ match: `${duration} s` }), reason: 'Play again' };
}

/** Back to the menu: after the podium, or leaving a match before its end. */
export function gameExit(players: readonly { nickname: string }[], state: 'after-podium' | 'abandoned' | 'free-drive'): AuditRecord {
  const reason = state === 'abandoned' ? 'Match left before its end' : state === 'free-drive' ? 'Free drive ended' : 'Back to the menu';
  return { action: 'GAME_EXIT', item: playersItem(players), newval: state, reason };
}

/** A device takes (join) or frees (leave) a seat in the lobby. */
export function seat(join: boolean, seatIndex: number, device: string): AuditRecord {
  return { action: join ? 'SEAT_JOIN' : 'SEAT_LEAVE', item: `Seat P${seatIndex + 1}`, oldval: join ? '' : device, newval: join ? device : '', reason: 'Lobby' };
}

/** The photo booth: taken (and saved for `saved` of the players), skipped, or failed. */
export function photo(outcome: 'taken' | 'skipped' | 'failed', players: readonly { nickname: string }[], detail = ''): AuditRecord {
  const action: CityDriveAction = outcome === 'taken' ? 'PHOTO_TAKEN' : outcome === 'skipped' ? 'PHOTO_SKIPPED' : 'PHOTO_FAILED';
  return { action, item: playersItem(players), newval: detail, reason: 'Photo booth' };
}

/** The photo is online: its object path in the bucket (not its link). */
export function photoPublished(players: readonly { nickname: string }[], objectPath: string): AuditRecord {
  return { action: 'PHOTO_PUBLISHED', item: playersItem(players), newval: objectPath, reason: 'Supabase Storage' };
}

/** The control room acknowledged the player's WinCC OA alert (its level is cleared). */
export function alertAcknowledged(nickname: string, playerDp: string): AuditRecord {
  return { action: 'ALERT_ACKNOWLEDGED', item: nickname || 'Player', itemType: 'CityDrivePlayer', newval: `${playerDp}.wanted`, reason: 'Alert acknowledged in the alarm list' };
}

/** The settings fields traced (old → new of the changed ones). */
const SETTINGS_FIELDS: readonly (keyof Settings)[] = ['keys', 'gamepad', 'steering', 'cameraDistance', 'cameraHeight', 'cubeSizeCm', 'quality', 'units', 'showMinimap', 'showPlayers', 'photoBooth'];

/** The settings changed between `before` and `after`, or null when nothing did. */
export function settingsUpdate(before: Settings, after: Settings): AuditRecord | null {
  const changed = SETTINGS_FIELDS.filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]));
  if (changed.length === 0) return null;
  const pick = (s: Settings): Record<string, unknown> => Object.fromEntries(changed.map((f) => [f, s[f]]));
  return { action: 'SETTINGS_UPDATE', item: 'Settings', oldval: json(pick(before)), newval: json(pick(after)), reason: changed.join(', ') };
}
