// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The datapoints of City Drive (#79): the only file that talks to WinCC OA.
 *
 * - out: the player's telemetry in `CityDrive_Player_<user>` (type `CityDrive_Player`, created
 *   through PARA when missing), written through `/api/para/dp/set` at most twice a second
 *   (telemetry.ts). The game writes nothing else: no process datapoint.
 * - alert (#85): `.wanted` carries a binary WinCC OA alert (class `alert.`, alarm on TRUE): it
 *   comes in the alarm list of the control room while the player is wanted. An operator who
 *   acknowledges it (`_alert_hdl.._act_state` 1 → 2) clears the player's alert level. The tension
 *   elements (alert, wanted, damage, ticket, fines) came with 0.5.0: an older type is changed in
 *   place (`dptype/change`, role `para:edit-types`); when that is refused they are not written,
 *   and the rest of the telemetry goes on as before.
 * - in: `CityDrive_Config.json` (bindings.ts) and a `dpConnect` on the bound DPEs, turned into
 *   machine states and forced crossroads.
 * - demo: without a backend (`npx wui dev`), the machines change state on their own and one of
 *   them breaks down from time to time.
 */
import { OaRxJsApi } from '@etm-professional-control/oa-rx-js-api';
import { WuiUserService } from '@wincc-oa/wui-iam-data/user-service.js';
import { DpSingleJsonStore } from '@visuelconcept-winccoa/wui-kit/data/dp-single-json-store.js';
import { Subscription, firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';
import { boundDpes, lightForced, machineState, parseConfig, type DriveConfig, type MachineState } from './bindings.js';
import type { Telemetry } from './game.js';
import { carPose, spawnTraffic, stepTraffic, type TrafficCar } from './traffic.js';
import { parseBoothCamera, type BoothCamera } from './photo-booth.js';
import { rng } from './city.js';

export const PLAYER_TYPE = 'CityDrive_Player';
export const CONFIG_DP = 'CityDrive_Config';

const TYPE_URL = '/api/para/dptype';
const CREATE_DP_URL = '/api/para/dp/create';
const DP_SET_URL = '/api/para/dp/set';
/** Verified `_alert_hdl` values (as wui-para's alarm tab): binary signal, `_act_state` came acknowledged. */
const ALERT_BINARY = 12; // DPCONFIG_ALERT_BINARYSIGNAL
const ACT_CAME_UNACK = 1;
const ACT_CAME_ACK = 2;
const DEMO_MACHINES = ['machine-1', 'machine-2', 'machine-3', 'machine-4'];
const DEMO_PERIOD_MS = 9000;
const PLAYERS_REFRESH_MS = 15000;
const DEMO_STEP_MS = 100;
/** A player is shown as connected while its datapoint moved within this delay. */
export const ONLINE_MS = 30000;

/** Another player, as read from its `CityDrive_Player_<user>` datapoint. */
export interface RemotePlayer {
  dp: string;
  nickname: string;
  vehicle: string;
  color: string;
  x: number;
  z: number;
  /** Degrees, 0 = +Z. */
  heading: number;
  speed: number;
  score: number;
  mission: string;
  /** Last change of any of its elements (ms, epoch). */
  updatedAt: number;
}

const DEMO_PLAYERS = [
  { user: 'lea.m', nickname: 'Léa', vehicle: 'coupe', color: 'warning' },
  { user: 'maint02', nickname: 'Maint-02', vehicle: 'van', color: 'success' },
  { user: 'op.nuit', nickname: 'OpNuit', vehicle: 'pickup', color: 'alarm' }
];

/** Telemetry field → element of the player datapoint. */
const ELEMENT: Record<keyof Telemetry, string> = {
  x: 'pos.x',
  z: 'pos.z',
  heading: 'heading',
  speed: 'speed',
  fuel: 'fuel',
  score: 'score',
  mission: 'mission',
  event: 'event',
  nickname: 'nickname',
  vehicle: 'vehicle',
  color: 'color',
  alert: 'alert',
  wanted: 'wanted',
  damage: 'damage',
  ticket: 'ticket',
  fines: 'fines'
};

/** Elements added by 0.5.0 (#85): written only once the deployed type has them. */
export const TENSION_FIELDS: readonly (keyof Telemetry)[] = ['alert', 'wanted', 'damage', 'ticket', 'fines'];
/** What is read of the other players: the elements every version of the type has. */
const REMOTE_FIELDS = (Object.keys(ELEMENT) as (keyof Telemetry)[]).filter((k) => !TENSION_FIELDS.includes(k));

const PLAYER_STRUCTURE = {
  name: PLAYER_TYPE,
  type: 'Struct',
  children: [
    { name: 'pos', type: 'Struct', children: [{ name: 'x', type: 'Float' }, { name: 'z', type: 'Float' }] },
    { name: 'heading', type: 'Float' },
    { name: 'speed', type: 'Float' },
    { name: 'fuel', type: 'Float' },
    { name: 'score', type: 'Int' },
    { name: 'mission', type: 'String' },
    { name: 'event', type: 'String' },
    { name: 'nickname', type: 'String' },
    { name: 'vehicle', type: 'String' },
    { name: 'color', type: 'String' },
    { name: 'alert', type: 'Int' },
    { name: 'wanted', type: 'Bool' },
    { name: 'damage', type: 'Int' },
    { name: 'ticket', type: 'String' },
    { name: 'fines', type: 'Int' }
  ]
};

interface DpEmission {
  dp: string[];
  value: unknown[];
}

/**
 * The player's datapoint: the WinCC OA user and a short id of this browser, so that two
 * sessions — two windows, or two people sharing an account — never share one datapoint (they
 * would each take the other for themselves and see nobody).
 */
export function playerDp(user: string, client = ''): string {
  const safe = user.trim().replaceAll(/[^\w]+/g, '_') || 'guest';
  const id = client.replaceAll(/[^\w]+/g, '');
  return id ? `${PLAYER_TYPE}_${safe}_${id}` : `${PLAYER_TYPE}_${safe}`;
}

const CLIENT_KEY = 'wui-city-drive.client';

/** A short id of this browser, kept in localStorage (a new one per visit when it is not available). */
export function clientId(): string {
  const fresh = Math.random().toString(36).slice(2, 7);
  try {
    const kept = localStorage.getItem(CLIENT_KEY);
    if (kept && /^\w{3,12}$/.test(kept)) return kept;
    localStorage.setItem(CLIENT_KEY, fresh);
  } catch {
    // private window: one id for this visit
  }
  return fresh;
}

/**
 * `System1:Line.State.:_online.._value` → `Line.State`: the system, the config attribute
 * (`dpConnect` hands the names back with `:_online.._value`) and a trailing dot dropped.
 */
export function normDpe(name: string): string {
  let s = name.replace(/^[^:.]+:(?!_)/, '');
  const cfg = s.indexOf(':');
  if (cfg !== -1) s = s.slice(0, cfg);
  return s.replace(/\.$/, '');
}

/** The fields that can be written: without the tension elements while the type lacks them. */
export function writableFields(fields: Partial<Telemetry>, tension: boolean): Partial<Telemetry> {
  if (tension) return fields;
  return Object.fromEntries(Object.entries(fields).filter(([k]) => !TENSION_FIELDS.includes(k as keyof Telemetry))) as Partial<Telemetry>;
}

/** The DPE names and values to write for a telemetry change. */
export function telemetryWrite(dp: string, fields: Partial<Telemetry>): { dpeNames: string[]; values: unknown[] } {
  const entries = Object.entries(fields) as [keyof Telemetry, unknown][];
  return { dpeNames: entries.map(([k]) => `${dp}.${ELEMENT[k]}`), values: entries.map(([, v]) => v) };
}

function post(url: string, body: object): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export interface LinkState {
  machines: Map<string, MachineState>;
  allRed: Set<string>;
}

export class DriveLink {
  /** True without a backend: simulated machines, nothing written. */
  demo = false;
  /** The datapoint of each local player ('' when it could not be created): P1 keeps the name of
   * 0.3.0 (`…_<user>_<id>`), P2 gets `…_<user>_<id>p2` (#83). */
  players: string[] = [];
  private user = '';
  private client = '';
  private readonly api = resolve(OaRxJsApi);
  private readonly configStore = new DpSingleJsonStore<DriveConfig>(CONFIG_DP, CONFIG_DP, () => ({ machines: [], lights: [] }));
  private sub = new Subscription();
  private playersSub = new Subscription();
  private playersTimer = 0;
  private demoBotsTimer = 0;
  /** Telemetry writes done per local player, and the time of the last one (ms) — players panel. */
  writes: number[] = [];
  lastWriteAt: number[] = [];
  private demoTimer = 0;
  private readonly writing: boolean[] = [];
  /** Fields changed while a write was running: sent right after it, merged, never dropped. */
  private readonly pending: Partial<Telemetry>[] = [];
  /** The deployed type has the tension elements (#85). */
  tension = false;
  private typeReady: Promise<void> | null = null;
  private alertSub = new Subscription();

  /** P1's datapoint (the 0.3.0 name). */
  get player(): string {
    return this.players[0] ?? '';
  }

  /** Prepares the player datapoint and reads the bindings; switches to demo without a backend. */
  async open(onState: (s: LinkState) => void): Promise<void> {
    const raw = await this.configStore.load();
    const config = parseConfig(raw);
    this.demo = !this.api || this.configStore.offline;
    if (this.demo) {
      this.startDemo(onState);
      return;
    }
    this.user = await userName();
    this.client = clientId();
    await this.setLocalPlayers(1);
    this.subscribe(config, onState);
  }

  /** One datapoint per local player, created when missing (P2 only once two play). */
  async setLocalPlayers(n: number): Promise<void> {
    if (this.demo) {
      this.players = Array.from({ length: n }, (_, k) => playerDp('demo', `${k + 1}`));
      return;
    }
    const names = Array.from({ length: n }, (_, k) => playerDp(this.user, k === 0 ? this.client : `${this.client}p${k + 1}`));
    for (const [k, dp] of names.entries()) {
      if (this.players[k] === dp) continue;
      // cannot create it: that player plays without telemetry
      this.players[k] = await this.ensurePlayerDp(dp).then(() => dp, () => '');
    }
    this.players.length = n;
  }

  close(): void {
    this.sub.unsubscribe();
    this.playersSub.unsubscribe();
    this.alertSub.unsubscribe();
    window.clearInterval(this.demoTimer);
    window.clearInterval(this.playersTimer);
    window.clearInterval(this.demoBotsTimer);
  }

  /**
   * The other players: every `CityDrive_Player_*` datapoint but one's own, followed by
   * `dpConnect` (the list is read again every 15 s). In demo, three simulated players drive.
   */
  watchPlayers(onPlayers: (players: RemotePlayer[]) => void, blocks: number): void {
    if (this.demo) {
      this.demoPlayers(onPlayers, blocks);
      return;
    }
    let current = '';
    const refresh = (): void => {
      if (!this.api) return;
      this.playersSub.add(
        this.api.dpNames(`${PLAYER_TYPE}_*`, PLAYER_TYPE).subscribe({
          next: (names) => {
            // the others: every player datapoint but this computer's own players
            const others = (names as string[]).map(normDpe).filter((n) => !this.players.includes(n)).sort();
            if (others.join('|') === current) return;
            current = others.join('|');
            this.followPlayers(others, onPlayers);
          },
          error: () => undefined
        })
      );
    };
    refresh();
    this.playersTimer = window.setInterval(refresh, PLAYERS_REFRESH_MS);
  }

  private followPlayers(dps: string[], onPlayers: (players: RemotePlayer[]) => void): void {
    this.playersSub.unsubscribe();
    this.playersSub = new Subscription();
    const players = new Map<string, RemotePlayer>(dps.map((dp) => [dp, emptyPlayer(dp)]));
    onPlayers([...players.values()]);
    if (dps.length === 0 || !this.api) return;
    const fields = REMOTE_FIELDS.map((k) => [k, ELEMENT[k]] as [keyof Telemetry, string]);
    let primed = false;
    const dpes = dps.flatMap((dp) => fields.map(([, el]) => `${dp}.${el}`));
    try {
      this.playersSub.add(
        this.api.dpConnect(dpes, true).subscribe((data: DpEmission) => {
          const now = Date.now();
          // the first emission is dpConnect's answer with the current values: it says
          // nothing about the player being here; only later changes (or heartbeats) do
          const live = primed;
          primed = true;
          data.dp.forEach((name, i) => {
            const dpe = normDpe(name);
            const dp = dps.find((d) => dpe.startsWith(`${d}.`));
            const field = fields.find(([, el]) => dp && dpe === `${dp}.${el}`)?.[0];
            if (!dp || !field) return;
            const p = players.get(dp) as RemotePlayer;
            (p as unknown as Record<string, unknown>)[field] = data.value[i];
            if (live) p.updatedAt = now;
          });
          onPlayers([...players.values()].map((p) => ({ ...p })));
        })
      );
    } catch {
      // a player datapoint deleted meanwhile: the next refresh drops it
    }
  }

  private demoPlayers(onPlayers: (players: RemotePlayer[]) => void, blocks: number): void {
    const cars: TrafficCar[] = spawnTraffic(DEMO_PLAYERS.length, blocks, 4242);
    const rand = rng(77);
    const scores = DEMO_PLAYERS.map((_, k) => 400 + k * 350);
    let t = 0;
    this.demoBotsTimer = window.setInterval(() => {
      t += DEMO_STEP_MS / 1000;
      stepTraffic(cars, blocks, t, DEMO_STEP_MS / 1000, null, rand);
      const now = Date.now();
      onPlayers(
        cars.map((c, k) => {
          if (rand() < 0.01) scores[k] += 150;
          const pose = carPose(c);
          const d = DEMO_PLAYERS[k];
          return {
            dp: playerDp(d.user),
            nickname: d.nickname,
            vehicle: d.vehicle,
            color: d.color,
            x: pose.x,
            z: pose.z,
            heading: (pose.heading * 180) / Math.PI,
            speed: Math.round(c.speed * 3.6 * 1.4),
            score: scores[k],
            mission: k === 1 ? 'intervention:reach' : 'delivery:drop',
            updatedAt: now
          };
        })
      );
    }, DEMO_STEP_MS);
  }

  /**
   * The cameras of the Camera Streams module (#91), for the photo booth setting: every
   * `RtspCamera_<id>` datapoint, its name and kind. Empty without a backend or without the module.
   */
  async listCameras(): Promise<BoothCamera[]> {
    if (this.demo || !this.api) return [];
    try {
      const names = (await firstValueFrom(this.api.dpNames('RtspCamera_*', 'RtspCamera_Stream'))) as string[];
      const dps = names.map(normDpe).filter((n) => /^RtspCamera_[\w-]+$/.test(n));
      if (dps.length === 0) return [];
      const raw = (await firstValueFrom(this.api.dpGet(dps.map((dp) => `${dp}.json`)))) as unknown;
      const values = Array.isArray(raw) ? raw : [raw];
      return dps
        .map((dp, k) => parseBoothCamera(dp.slice('RtspCamera_'.length), String((Array.isArray(values[k]) ? values[k][0] : values[k]) ?? '')))
        .filter((c): c is BoothCamera => c !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return [];
    }
  }

  /** Writes player i's changed telemetry fields; while a write runs, the next fields wait, merged. */
  async write(i: number, fields: Partial<Telemetry>): Promise<void> {
    const dp = this.players[i];
    if (this.demo || !dp) return;
    this.pending[i] = { ...(this.pending[i] ?? {}), ...writableFields(fields, this.tension) };
    if (this.writing[i]) return;
    this.writing[i] = true;
    try {
      while (Object.keys(this.pending[i] ?? {}).length > 0) {
        const batch = this.pending[i];
        this.pending[i] = {};
        try {
          const res = await post(DP_SET_URL, telemetryWrite(dp, batch));
          if (res.ok) {
            this.writes[i] = (this.writes[i] ?? 0) + 1;
            this.lastWriteAt[i] = Date.now();
          }
        } catch {
          // the next sample will try again
        }
      }
    } finally {
      this.writing[i] = false;
    }
  }

  /**
   * Player i's WinCC OA alert: follows `.wanted:_alert_hdl.._act_state` of each local player and
   * calls `onAck(i)` when an operator acknowledges it while it is still there (1 → 2).
   */
  watchAlerts(onAck: (i: number) => void): void {
    this.alertSub.unsubscribe();
    this.alertSub = new Subscription();
    if (this.demo || !this.api || !this.tension) return;
    const dpes = this.players.map((dp) => (dp ? `${dp}.wanted:_alert_hdl.._act_state` : '')).filter(Boolean);
    if (dpes.length === 0) return;
    const last = new Map<string, number>();
    try {
      this.alertSub.add(
        this.api.dpConnect(dpes, true).subscribe((data: DpEmission) => {
          data.dp.forEach((name, k) => {
            const dp = normDpe(name).replace(/\.wanted$/, '');
            const state = Number(data.value[k]);
            if (last.get(dp) === ACT_CAME_UNACK && state === ACT_CAME_ACK) {
              const i = this.players.indexOf(dp);
              if (i !== -1) onAck(i);
            }
            last.set(dp, state);
          });
        })
      );
    } catch {
      // no alert config: the alert level only falls on its own
    }
  }

  /** The player type, created, or changed in place when it predates the tension elements (once). */
  private ensureType(): Promise<void> {
    this.typeReady ??= (async () => {
      const url = `${TYPE_URL}/${encodeURIComponent(PLAYER_TYPE)}`;
      const type = await fetch(url);
      if (!type.ok) {
        const res = await post(`${TYPE_URL}/create`, { typeName: PLAYER_TYPE, structure: PLAYER_STRUCTURE });
        if (!res.ok && res.status !== 400) throw new Error(`type ${res.status}`);
        this.tension = res.ok;
        return;
      }
      if (JSON.stringify(await type.json().catch(() => ({}))).includes('"wanted"')) {
        this.tension = true;
        return;
      }
      // a 0.4 type: add the elements (refused without para:edit-types — then they are not written)
      const res = await post(`${TYPE_URL}/change`, { typeName: PLAYER_TYPE, structure: PLAYER_STRUCTURE }).catch(() => null);
      this.tension = !!res?.ok;
    })();
    return this.typeReady;
  }

  /** The binary alert on `.wanted` (best effort: without it, the game plays the same). */
  private async ensureAlert(dp: string): Promise<void> {
    if (!this.tension) return;
    const dpe = `${dp}.wanted`;
    await post(DP_SET_URL, {
      dpeNames: [`${dpe}:_alert_hdl.._type`, `${dpe}:_alert_hdl.._class`, `${dpe}:_alert_hdl.._ok_range`, `${dpe}:_alert_hdl.._active`],
      values: [ALERT_BINARY, 'alert.', false, true]
    }).catch(() => undefined);
  }

  private async ensurePlayerDp(dp: string): Promise<void> {
    await this.ensureType();
    const names = await new Promise<string[]>((ok) => {
      this.sub.add(this.api!.dpNames(dp, PLAYER_TYPE).subscribe({ next: (n) => ok(n as string[]), error: () => ok([]) }));
    });
    if (names.length === 0) {
      const res = await post(CREATE_DP_URL, { dpName: dp, dpType: PLAYER_TYPE });
      if (!res.ok) throw new Error(`dp ${res.status}`);
    }
    await this.ensureAlert(dp);
  }

  private subscribe(config: DriveConfig, onState: (s: LinkState) => void): void {
    const dpes = boundDpes(config);
    const state: LinkState = { machines: new Map(), allRed: new Set() };
    onState(state);
    if (dpes.length === 0 || !this.api) return;
    try {
      this.sub.add(
        this.api.dpConnect(dpes, true).subscribe((data: DpEmission) => {
          const values = new Map(data.dp.map((dp, i) => [normDpe(dp), data.value[i]]));
          for (const m of config.machines) {
            if (values.has(m.dpe)) state.machines.set(m.building, machineState(values.get(m.dpe), m));
          }
          for (const l of config.lights) {
            if (!values.has(l.dpe)) continue;
            if (lightForced(values.get(l.dpe))) state.allRed.add(l.crossroads);
            else state.allRed.delete(l.crossroads);
          }
          onState({ machines: new Map(state.machines), allRed: new Set(state.allRed) });
        })
      );
    } catch {
      // a DPE that does not exist: the city stays as it is
    }
  }

  private startDemo(onState: (s: LinkState) => void): void {
    const states: MachineState[] = ['run', 'run', 'stop', 'run'];
    let tick = 0;
    const emit = (): void => onState({ machines: new Map(DEMO_MACHINES.map((id, k) => [id, states[k]])), allRed: new Set() });
    emit();
    this.demoTimer = window.setInterval(() => {
      tick++;
      // machine-2 breaks down every fourth period and is repaired at the next one
      states[1] = tick % 4 === 1 ? 'fault' : 'run';
      states[2] = tick % 3 === 0 ? 'run' : 'stop';
      emit();
    }, DEMO_PERIOD_MS);
  }
}

function emptyPlayer(dp: string): RemotePlayer {
  return { dp, nickname: '', vehicle: 'coupe', color: 'info', x: 0, z: 0, heading: 0, speed: 0, score: 0, mission: '', updatedAt: 0 };
}

function resolve<T>(token: new (...args: never[]) => T): T | null {
  try {
    return container.resolve<T>(token);
  } catch {
    return null;
  }
}

async function userName(): Promise<string> {
  const svc = resolve(WuiUserService);
  if (svc?.name) return svc.name;
  try {
    const u = await new Promise<unknown>((ok) => {
      const s = svc?.getOaUser().subscribe({ next: ok, error: () => ok(null) });
      window.setTimeout(() => {
        s?.unsubscribe();
        ok(null);
      }, 4000);
    });
    return svc?.name ?? (typeof u === 'object' && u && 'name' in u ? String((u as { name: unknown }).name) : '');
  } catch {
    return '';
  }
}
