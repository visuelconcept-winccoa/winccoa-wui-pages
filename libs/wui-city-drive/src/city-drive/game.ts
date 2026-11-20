// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The game loop of City Drive (#79, #83): input, car physics, collisions, traffic, missions or
 * logo hunt, on foot, fuel, score — for 1 or 2 local players, each driven by its own device
 * (the keyboard or a USB gamepad) and seen in its own view; plus the timed match. Draws through
 * {@link CityWorld} and reports a {@link GameHud} to the page a few times per second.
 * Datapoints never reach this file: the page feeds the machine states and the forced lights in,
 * and reads each player's telemetry out (dp-link.ts).
 */
import type { MachineState } from './bindings.js';
import { CELL, ROAD_WIDTH, generateCity, rng, type City } from './city.js';
import { LogoHunt, newHunter, type Hunter, type Pickup } from './collectibles.js';
import { JOIN_BUTTONS, LEAVE_BUTTON, Match, padDevice, padIndexOf, standings, type DeviceId, type MatchPhase, type Standing } from './local-play.js';
import { cancelIfRepaired, newDelivery, newIntervention, stepMission, type Mission } from './missions.js';
import { themePalette, type NeonPalette, type ThemeId } from './palette.js';
import { collide, collideCars, forwardSpeed, newCar, stepCar, type CarInput, type CarState } from './physics.js';
import { DEFAULT_SETTINGS, actionOf, padDirection, readPad, type Action, type NavDir, type PadLike, type PadState, type Settings } from './settings.js';
import {
  CAUGHT_M,
  CAUGHT_S,
  CHASE_FROM_LEVEL,
  CHASER_SPEC,
  ESCAPE_M,
  ESCAPE_S,
  LEVEL_HEAT,
  SIGHT_M,
  Heat,
  applyImpact,
  chaserInput,
  chasersFor,
  damagedSpec,
  fineOf,
  flashedBy,
  placeCameras,
  ranRedLight,
  spawnChaser,
  type Chaser,
  type Offence,
  type SpeedCamera
} from './tension.js';
import { carPose, spawnTraffic, stepTraffic, type LightOverrides, type TrafficCar } from './traffic.js';
import type { GameAudio } from './audio.js';
import { CLEAR, demoWeather, easeWeather, gripFactor, type Weather } from './weather.js';
import { DEFAULT_PROFILE, paintById, vehicleById, wheelById, type Profile, type Vehicle } from './vehicles.js';
import { canEnter, leaveCar, stepWalker, type WalkerState } from './walker.js';
import { THROW_DURATION, THROW_RELEASE_AT, gaitPose, throwPose, type Pose } from './figure.js';
import { BLAST_M, canThrow, stepCube, stick, throwByHand, throwFromCar, type ThrownCube } from './cubes.js';
import { CAMERA_MODES, CityWorld, type CameraMode, type RemoteCar } from './world.js';

export type GameEvent =
  | 'collision'
  | 'pickup'
  | 'mission-done'
  | 'mission-failed'
  | 'refuel'
  | 'empty'
  | 'wave-done'
  | 'on-foot'
  | 'in-car'
  | 'too-far'
  | 'red-light'
  | 'speed-camera'
  | 'ram-security'
  | 'chase'
  | 'escaped'
  | 'caught'
  | 'respray'
  | 'repaired'
  | 'acknowledged'
  | 'smash';

export interface HudState {
  /** km/h. */
  speed: number;
  /** 0..1 */
  fuel: number;
  score: number;
  mission: Mission | null;
  paused: boolean;
  camera: CameraMode;
  lastEvent: GameEvent | null;
  /** The player walks (out of the car). */
  onFoot: boolean;
  /** Logo hunt: tokens left in the wave, wave number, this player's logos and running combo; null in missions mode. */
  hunt: { left: number; wave: number; collected: number; combo: number } | null;
  /** Alert level 0..5 (#85). */
  alert: number;
  /** Damage 0..1. */
  damage: number;
  /** Security cars chasing this player. */
  chasers: number;
  /** 0..1: how close the security cars are to catching the player. */
  caught: number;
}

/** What the page shows: one HUD per local player, and the match. */
export interface GameHud {
  players: HudState[];
  paused: boolean;
  match: { phase: MatchPhase; remaining: number } | null;
}

export interface Telemetry {
  x: number;
  z: number;
  /** Degrees, 0 = +Z (north on the minimap). */
  heading: number;
  /** km/h */
  speed: number;
  fuel: number;
  score: number;
  mission: string;
  event: string;
  nickname: string;
  vehicle: string;
  color: string;
  /** Alert level 0..5, and whether the player is wanted (level ≥ 2: carries the WinCC OA alert). */
  alert: number;
  wanted: boolean;
  /** Damage in %. */
  damage: number;
  /** Last speed camera ticket, and the number of tickets. */
  ticket: string;
  fines: number;
}

/** A speed camera flash: camera, speed and fine — for the page (flash, ticket). */
export interface Flash {
  camera: SpeedCamera;
  kmh: number;
  fine: number;
}

/** One local player: its device, its car (or itself on foot), its score. */
export interface LocalPlayer {
  index: number;
  /** null: any device (a lone player outside the lobby). */
  device: DeviceId | null;
  profile: Profile;
  vehicle: Vehicle;
  car: CarState;
  walker: WalkerState | null;
  score: number;
  mission: Mission | null;
  missionCount: number;
  camera: CameraMode;
  lastEvent: GameEvent | null;
  hunter: Hunter;
  pad: PadState;
  padPrevious: boolean[];
  wasEmpty: boolean;
  /** Tension (#85). */
  heat: Heat;
  damage: number;
  lastPos: { x: number; z: number };
  lastFlash: Map<number, number>;
  ticket: string;
  fines: number;
  /** Seconds with every chaser out of reach (escape), and pinned by a chaser (caught). */
  escapeFor: number;
  caughtFor: number;
  inStation: boolean;
  /** Metres slid since the last skid mark (#95). */
  skidFor: number;
  /** The last throw (game time, s): on foot its wind-up, until the cube leaves the hand. */
  throwAt: number | null;
  /** On foot: the cube of the throw under way has left the hand. */
  released: boolean;
}

const TRAFFIC = 26;
const MAX_DT = 1 / 20;
const HUD_HZ = 8;
const NO_PAD: PadState = { throttle: 0, brake: 0, steer: 0, move: 0, handbrake: false, horn: false, pressed: [] };
const ONE_SHOT: readonly Action[] = ['pause', 'camera', 'time', 'reset', 'foot', 'mission', 'throw', 'radio'];
/** Largest cube shown in a hand (m); the thrown cube has the size of the setting. */
const HELD_MAX_M = 0.45;
/** A skid mark every this many metres of slide. */
const SKID_STEP_M = 0.55;
type Pad = PadLike & { index: number; id: string };


/**
 * Start of player k: the right-hand lane facing +Z, the second player on the next avenue (one
 * behind the other on the same street, the first player's camera sat in the second car's
 * headlights: a washed-out view).
 */
function startCar(k: number): CarState {
  return newCar(CELL * (2 + k) - ROAD_WIDTH / 4, CELL * 2 + CELL / 2, 0);
}

export class CityGame {
  readonly city: City;
  readonly world: CityWorld;
  traffic: TrafficCar[];
  players: LocalPlayer[] = [];
  paused = false;
  machineStates = new Map<string, MachineState>();
  overrides: LightOverrides = { allRed: new Set() };
  /** The other players, from their datapoints. */
  remotes: RemoteCar[] = [];
  /** Logo hunt (mode `logos`), shared by the local players, or null in missions mode. */
  hunt: LogoHunt | null = null;
  /** The timed match, or null for free play. */
  match: Match | null = null;
  /** Key bindings, gamepad and the other settings (settings.ts). */
  settings: Settings = DEFAULT_SETTINGS;
  /** Name of each connected gamepad, by index. */
  padNames: string[] = [];
  /** Lobby: device presses are reported (join / leave), nothing moves. */
  lobby = false;
  /** Speed cameras of the city, and the security cars giving chase (#85). */
  readonly cameras: SpeedCamera[];
  chasers: Chaser[] = [];
  /** Sound (#95), set by the page once the browser allows it. */
  audio: GameAudio | null = null;
  /** Rain and fog from their DPEs, or null: the demo weather turns on its own (#95). */
  weatherBound: Weather | null = null;
  /** The weather shown (eased towards its target). */
  weather: Weather = CLEAR;
  /** The thrown cubes, flying or stuck (#89). */
  cubes: ThrownCube[] = [];

  onHud: (hud: GameHud) => void = () => {};
  onEvent: (event: GameEvent, player: number) => void = () => {};
  /** The time of day changed in game (T): shared by every player. */
  onTime: (time: Profile['time']) => void = () => {};
  /** A logo token was blown up (logo hunt). */
  onLogo: (pickup: Pickup, player: number) => void = () => {};
  /** A device with no player pressed join (A / Start, Enter / Space) or leave (B, Escape). */
  onDevice: (device: DeviceId, press: 'join' | 'leave') => void = () => {};
  /** A gamepad in use was unplugged. */
  onDeviceLost: (device: DeviceId) => void = () => {};
  onMatchEnd: (results: Standing[]) => void = () => {};
  /** Lobby (#garage): a pad moved through player i's garage (D-pad or left stick). */
  onNav: (i: number, dir: NavDir) => void = () => {};
  private readonly navPrevious = new Map<number, NavDir | null>();
  /** The radio button / key (the page changes the station). */
  onRadio: () => void = () => {};
  /** Player i was flashed by a speed camera. */
  onFlash: (flash: Flash, player: number) => void = () => {};

  private readonly keys = new Set<string>();
  private readonly rand = rng(97);
  private readonly joinPrevious = new Map<number, boolean[]>();
  private t = 0;
  private hudClock = 0;
  private raf = 0;
  private last = 0;
  private time: Profile['time'] = 'night';
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly host: HTMLElement,
    private readonly palette: NeonPalette,
    /** The colour theme of the city (#99); the players keep their neon colours from `palette`. */
    theme: ThemeId = 'classic',
    seed = 7
  ) {
    this.city = generateCity(seed);
    this.world = new CityWorld(host, this.city, themePalette(palette, theme), theme);
    this.traffic = spawnTraffic(TRAFFIC, this.city.blocks);
    this.cameras = placeCameras(this.city, 8);
    this.world.setCameras(this.cameras);
    this.setPlayerCount(1);
    host.tabIndex = 0;
    host.addEventListener('keydown', this.onKeyDown);
    host.addEventListener('keyup', this.onKeyUp);
    host.addEventListener('blur', () => this.keys.clear());
    window.addEventListener('gamepaddisconnected', this.onPadLost);
    this.resizeObserver = new ResizeObserver(() => this.world.resize());
    this.resizeObserver.observe(host);
  }

  start(): void {
    this.last = performance.now();
    const frame = (now: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(MAX_DT, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.host.removeEventListener('keydown', this.onKeyDown);
    this.host.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('gamepaddisconnected', this.onPadLost);
    this.world.dispose();
  }

  // --- players ---------------------------------------------------------------------------

  /** 1 or 2 local players: each its own view; the profiles keep what was chosen. */
  setPlayerCount(n: number): void {
    while (this.players.length < n) {
      const k = this.players.length;
      const vehicle = k === 0 ? 'coupe' : 'pickup';
      this.players.push({
        index: k,
        device: null,
        profile: { ...DEFAULT_PROFILE, color: k === 0 ? 'primary' : 'warning', vehicle },
        vehicle: vehicleById(vehicle),
        car: startCar(k),
        walker: null,
        score: 0,
        mission: null,
        missionCount: 0,
        camera: 'chase',
        lastEvent: null,
        hunter: newHunter(),
        throwAt: null,
        released: true,
        skidFor: 0,
        pad: NO_PAD,
        padPrevious: [],
        wasEmpty: false,
        heat: new Heat(),
        damage: 0,
        lastPos: { x: 0, z: 0 },
        lastFlash: new Map(),
        ticket: '',
        fines: 0,
        escapeFor: 0,
        caughtFor: 0,
        inStation: false
      });
      const p = this.players[k];
      p.lastPos = { x: p.car.x, z: p.car.z };
    }
    for (let k = n; k < this.players.length; k++) this.world.setWalker(k, null, 0);
    this.chasers = this.chasers.filter((c) => c.target < n);
    this.players.length = n;
    this.world.setPlayerCount(n);
    this.players.forEach((p) => this.applyProfile(p));
  }

  /** The device of player i (null: any device, for a lone player). */
  setDevice(i: number, device: DeviceId | null): void {
    const p = this.players[i];
    if (!p) return;
    p.device = device;
    p.pad = NO_PAD;
    p.padPrevious.length = 0;
  }

  /** Nickname, vehicle, colour of player i; player 1's mode and time apply to everyone. */
  setProfile(i: number, profile: Profile): void {
    const p = this.players[i];
    if (!p) return;
    p.profile = profile;
    if (i === 0) {
      this.time = profile.time;
      if ((profile.mode === 'logos') !== (this.hunt !== null)) {
        this.hunt = profile.mode === 'logos' ? new LogoHunt(this.city) : null;
        this.world.setTokens(this.hunt?.tokens ?? []);
      }
    }
    this.applyProfile(p);
  }

  private applyProfile(p: LocalPlayer): void {
    p.vehicle = vehicleById(p.profile.vehicle);
    this.world.setPlayerVehicle(p.index, p.vehicle.body, this.palette[p.profile.color], {
      paint: paintById(p.profile.paint).color,
      wheelScale: wheelById(p.profile.wheels).scale,
      skin: p.profile.skin,
      gender: p.profile.driver
    });
    this.world.setTimeOfDay(this.time);
    this.world.setCameraMode(p.index, p.camera);
  }

  /** Applies the settings: bindings and gamepad at once, camera distance and graphics in the world. */
  setSettings(settings: Settings): void {
    this.settings = settings;
    this.keys.clear();
    this.world.setCameraDistance(settings.cameraDistance);
    this.world.setCameraHeight(settings.cameraHeight);
    this.world.setQuality(settings.quality);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.keys.clear();
    this.emitHud();
  }

  /** Night ↔ day (T): one sky for everyone. */
  toggleTimeOfDay(): void {
    this.time = this.time === 'day' ? 'night' : 'day';
    this.world.setTimeOfDay(this.time);
    this.onTime(this.time);
    this.emitHud();
  }

  /** Next camera view of player i (C). */
  toggleCamera(i = 0): void {
    const p = this.players[i];
    if (!p) return;
    p.camera = CAMERA_MODES[(CAMERA_MODES.indexOf(p.camera) + 1) % CAMERA_MODES.length];
    this.world.setCameraMode(i, p.camera);
    this.emitHud();
  }

  setCamera(mode: CameraMode, i = 0): void {
    const p = this.players[i];
    if (!p) return;
    p.camera = mode;
    this.world.setCameraMode(i, mode);
    this.emitHud();
  }

  /** Player i out of the car, or back in when close enough to it (F). */
  toggleFoot(i = 0): void {
    const p = this.players[i];
    if (!p) return;
    if (!p.walker) {
      if (Math.abs(forwardSpeed(p.car)) > 3) return; // stop first
      p.walker = leaveCar(p.car, p.vehicle.body.w / 2);
      this.event(p, 'on-foot');
    } else if (canEnter(p.walker, p.car)) {
      p.walker = null;
      this.event(p, 'in-car');
    } else {
      this.event(p, 'too-far');
    }
    this.world.setWalker(i, p.walker, this.palette[p.profile.color]);
    this.emitHud();
  }

  /** Where player i is: on foot, or in the car. */
  positionOf(i = 0): { x: number; z: number; heading: number } {
    const p = this.players[i];
    return p ? (p.walker ?? p.car) : { x: 0, z: 0, heading: 0 };
  }

  /** Player i back on the nearest road, facing along it. */
  resetCar(i = 0): void {
    const p = this.players[i];
    if (!p) return;
    const kx = Math.round(p.car.x / CELL);
    const kz = Math.round(p.car.z / CELL);
    const dx = Math.abs(p.car.x - kx * CELL);
    const dz = Math.abs(p.car.z - kz * CELL);
    const fuel = p.car.fuel;
    p.car = dx < dz ? newCar(kx * CELL - ROAD_WIDTH / 4, p.car.z, 0) : newCar(p.car.x, kz * CELL + ROAD_WIDTH / 4, Math.PI / 2);
    p.car.fuel = fuel;
  }

  newMission(i = 0): void {
    const p = this.players[i];
    if (!p) return;
    p.missionCount++;
    const faulted = [...this.machineStates].filter(([, s]) => s === 'fault').map(([id]) => id);
    p.mission =
      (faulted.length > 0 ? newIntervention(this.city, faulted[0], p.missionCount) : null) ??
      (this.hunt ? null : newDelivery(this.city, this.positionOf(i), p.missionCount, 1000 + p.missionCount * 31 + i * 7));
    this.emitHud();
  }

  // --- match -----------------------------------------------------------------------------

  /** A timed match (logo hunt): scores, combos, positions and logos reset; 3-2-1 then go. */
  startMatch(duration: number): void {
    this.hunt ??= new LogoHunt(this.city);
    this.hunt.reset(2026 + Math.floor(Math.random() * 1000));
    this.world.setTokens(this.hunt.tokens);
    this.players.forEach((p, k) => {
      p.score = 0;
      p.hunter = newHunter();
      p.car = { ...startCar(k), fuel: 1 };
      p.walker = null;
      p.mission = null;
      p.lastEvent = null;
      p.heat.clear();
      p.damage = 0;
      p.lastPos = { x: p.car.x, z: p.car.z };
      this.world.setWalker(k, null, 0);
      this.world.setDamage(k, 0);
    });
    this.chasers = [];
    this.cubes = [];
    this.players.forEach((p) => {
      p.throwAt = null;
      p.released = true;
    });
    this.match = new Match(duration);
    this.setPaused(false);
  }

  /** Back to free play. */
  endMatch(): void {
    this.match = null;
    this.emitHud();
  }

  standings(): Standing[] {
    return standings(this.players.map((p) => ({ score: p.score, logos: p.hunter.logos })));
  }

  /** Player i's WinCC OA alert was acknowledged: the alert level is cleared (#85). */
  clearHeat(i: number): void {
    const p = this.players[i];
    if (!p || p.heat.level === 0) return;
    p.heat.clear();
    this.chasers = this.chasers.filter((c) => c.target !== i);
    this.event(p, 'acknowledged');
    this.emitHud();
  }

  // --- telemetry -------------------------------------------------------------------------

  telemetry(i = 0): Telemetry {
    const p = this.players[i];
    const at = this.positionOf(i);
    return {
      x: Math.round(at.x * 10) / 10,
      z: Math.round(at.z * 10) / 10,
      heading: Math.round((((at.heading * 180) / Math.PI) % 360 + 360) % 360),
      speed: this.speedKmh(i),
      fuel: Math.round((p?.car.fuel ?? 0) * 1000) / 10,
      score: p?.score ?? 0,
      mission: this.match ? `match:${this.match.phase}` : p?.mission ? `${p.mission.kind}:${p.mission.stage}` : '',
      event: p?.lastEvent ?? '',
      nickname: p?.profile.nickname ?? '',
      // on foot, the others see a pedestrian
      vehicle: p?.walker ? 'foot' : (p?.profile.vehicle ?? 'coupe'),
      color: p?.profile.color ?? 'primary',
      alert: p?.heat.level ?? 0,
      // the WinCC OA alert rises with the chase, not with every small offence
      wanted: (p?.heat.level ?? 0) >= CHASE_FROM_LEVEL,
      damage: Math.round((p?.damage ?? 0) * 100),
      ticket: p?.ticket ?? '',
      fines: p?.fines ?? 0
    };
  }

  /** km/h of player i: walking or driving. */
  speedKmh(i = 0): number {
    const p = this.players[i];
    if (!p) return 0;
    return Math.round(Math.abs(p.walker ? p.walker.speed : forwardSpeed(p.car)) * 3.6);
  }

  // --- input -----------------------------------------------------------------------------

  /** Does player p read the keyboard? (its device, or any device for a lone player) */
  private usesKeyboard(p: LocalPlayer): boolean {
    return p.device === 'keyboard' || (p.device === null && this.players.length === 1);
  }

  /** A held action on the keyboard, for player p. */
  private on(p: LocalPlayer, action: Action): boolean {
    return this.usesKeyboard(p) && this.settings.keys[action].some((code) => this.keys.has(code));
  }

  /** Keyboard and gamepad of player p merged; the stronger of the two wins on each axis. */
  private axes(p: LocalPlayer): { throttle: number; steer: number; move: number } {
    const kbThrottle = (this.on(p, 'up') ? 1 : 0) - (this.on(p, 'down') ? 1 : 0);
    const kbSteer = (this.on(p, 'right') ? 1 : 0) - (this.on(p, 'left') ? 1 : 0);
    const padThrottle = p.pad.throttle - p.pad.brake;
    const pick = (a: number, b: number): number => (Math.abs(a) >= Math.abs(b) ? a : b);
    const steer = Math.max(-1, Math.min(1, pick(kbSteer, p.pad.steer) * this.settings.steering));
    return { throttle: pick(kbThrottle, padThrottle), steer, move: pick(kbThrottle, p.pad.move) };
  }

  private input(p: LocalPlayer): CarInput {
    // parked (on foot) or held at the start line during the countdown: the car rolls to a stop
    if (p.walker || (this.match && !this.match.live)) return { throttle: 0, steer: 0, handbrake: true };
    const a = this.axes(p);
    return { throttle: a.throttle, steer: a.steer, handbrake: this.on(p, 'brake') || p.pad.handbrake };
  }

  /** Reads the gamepads: each player's own pad, and the join / leave presses of the others. */
  private pollPads(): void {
    const pads: Pad[] =
      this.settings.gamepad.enabled && typeof navigator !== 'undefined' && navigator.getGamepads
        ? ([...navigator.getGamepads()].filter((g) => g && g.connected) as unknown as Pad[])
        : [];
    this.padNames = [];
    for (const g of pads) this.padNames[g.index] = g.id;
    for (const p of this.players) {
      const pad = this.padFor(p, pads);
      if (!pad) {
        p.pad = NO_PAD;
        continue;
      }
      p.pad = readPad(pad, this.settings, p.padPrevious);
      for (const action of p.pad.pressed) this.run(p, action);
    }
    // the lobby: each pad moves through its own player's garage (alone: any pad)
    if (this.lobby) {
      for (const g of pads) {
        const k = this.players.length === 1 ? 0 : this.players.findIndex((p) => p.device === padDevice(g.index));
        const dir = padDirection(g);
        if (k !== -1 && dir && this.navPrevious.get(g.index) !== dir) this.onNav(k, dir);
        this.navPrevious.set(g.index, dir);
      }
    }
    // join (A / Start) and leave (B) presses: of the free pads in the game, of every pad in the lobby
    for (const g of pads) {
      const device = padDevice(g.index);
      // in the game, a pad that plays is read above; in the lobby every pad's A / Start / B is
      // reported (the page seats a free pad, launches for a seated one, frees it on B)
      if (!this.lobby && this.players.some((p) => p.device === device || (p.device === null && this.players.length === 1))) continue;
      const prev = this.joinPrevious.get(g.index) ?? [];
      const down = (b: number): boolean => g.buttons[b]?.pressed === true;
      if (JOIN_BUTTONS.some((b) => down(b) && !prev[b])) this.onDevice(device, 'join');
      if (down(LEAVE_BUTTON) && !prev[LEAVE_BUTTON]) this.onDevice(device, 'leave');
      for (const b of [...JOIN_BUTTONS, LEAVE_BUTTON]) prev[b] = down(b);
      this.joinPrevious.set(g.index, prev);
    }
  }

  /** Player p's pad: its own, or the first one for a lone player without a device. */
  private padFor(p: LocalPlayer, pads: readonly Pad[]): PadLike | null {
    const idx = p.device ? padIndexOf(p.device) : null;
    if (idx !== null) return pads.find((g) => g.index === idx) ?? null;
    if (p.device === null && this.players.length === 1 && !this.lobby) return pads[0] ?? null;
    return null;
  }

  /** A one-shot action (key or gamepad button) of player p. */
  private run(p: LocalPlayer, action: Action): void {
    if (this.lobby) return;
    if (action === 'pause') this.setPaused(!this.paused);
    else if (this.paused || (this.match && !this.match.live)) return;
    else if (action === 'camera') this.toggleCamera(p.index);
    else if (action === 'time') this.toggleTimeOfDay();
    else if (action === 'reset') this.resetCar(p.index);
    else if (action === 'foot') this.toggleFoot(p.index);
    else if (action === 'radio') this.onRadio();
    else if (action === 'throw') this.throwCube(p);
    else if (action === 'mission' && !p.walker && !this.match && (!p.mission || p.mission.stage === 'done' || p.mission.stage === 'failed')) this.newMission(p.index);
  }

  // --- loop ------------------------------------------------------------------------------

  private tick(dt: number): void {
    this.pollPads();
    if (!this.paused && !this.lobby) this.step(dt);
    this.players.forEach((p, k) => {
      this.world.setPlayer(k, p.car);
      this.world.setSpeed(k, p.walker ? p.walker.speed : forwardSpeed(p.car));
      if (p.walker) this.world.setWalker(k, p.walker, this.palette[p.profile.color], { pose: this.poseOf(p), holding: this.holding(p) });
    });
    this.world.setCubes(this.cubes);
    this.atmosphere(dt);
    this.world.setTraffic(this.traffic.map((c) => ({ ...carPose(c), color: c.color })));
    this.world.setChasers(this.chasers.map((c) => c.car));
    this.world.setMachineStates(this.machineStates);
    this.world.setRemotePlayers(this.remotes);
    this.world.setLights(this.t, this.overrides);
    const m = this.players[0]?.mission;
    this.world.setMarker(m && ['pickup', 'drop', 'reach'].includes(m.stage) ? m.target : null, m?.kind ?? null, m?.stage ?? null);
    this.world.render(this.paused || this.lobby ? 0 : dt);
    this.hudClock += dt;
    if (this.hudClock >= 1 / HUD_HZ) {
      this.hudClock = 0;
      this.emitHud();
    }
  }

  private step(dt: number): void {
    this.t += dt;
    if (this.match && this.match.step(dt) === 'over') {
      this.onMatchEnd(this.standings());
      this.emitHud();
    }
    const frozen = this.match?.phase === 'over';
    const bounds = { x0: -ROAD_WIDTH / 2, z0: -ROAD_WIDTH / 2, x1: this.city.size + ROAD_WIDTH / 2, z1: this.city.size + ROAD_WIDTH / 2 };
    if (!frozen) for (const p of this.players) this.stepPlayer(p, dt, bounds);
    this.bumpPlayers();
    stepTraffic(this.traffic, this.city.blocks, this.t, dt, this.players.map((_, k) => this.positionOf(k)), this.rand, this.overrides);
    if (frozen) return;
    if (!this.match || this.match.live) this.stepTension(dt, bounds);
    this.stepCubes(dt);
    for (const p of this.players) this.stepMissions(p, dt);
    if (!this.match || this.match.live) for (const p of this.players) this.stepHunt(p);
  }

  /** The players' cars bump into each other: separated, the speed shared out. */
  private bumpPlayers(): void {
    for (let a = 0; a < this.players.length; a++) {
      for (let b = a + 1; b < this.players.length; b++) {
        const pa = this.players[a];
        const pb = this.players[b];
        const before = pa.car;
        const r = collideCars(pa.car, pb.car.x, pb.car.z, pb.vehicle.spec.radius, pa.vehicle.spec.radius);
        if (r.impact === 0 && r.car === before) continue;
        pa.car = r.car;
        // what one car lost, the other gets (roughly)
        pb.car = { ...pb.car, vx: pb.car.vx + (before.vx - r.car.vx) * 0.5, vz: pb.car.vz + (before.vz - r.car.vz) * 0.5 };
        if (r.impact > 6) {
          this.event(pa, 'collision');
          this.event(pb, 'collision');
        }
      }
    }
  }

  private stepPlayer(p: LocalPlayer, dt: number, bounds: { x0: number; z0: number; x1: number; z1: number }): void {
    const hurt = damagedSpec(p.vehicle.spec, p.damage);
    // wet roads hold less (#95)
    const spec = this.weather.rain > 0.02 ? { ...hurt, grip: hurt.grip * gripFactor(this.weather) } : hurt;
    let car = stepCar(p.car, this.input(p), dt, spec);
    const hit = collide(car, this.city.buildings, bounds, 0.25, spec.radius);
    car = hit.car;
    let impact = hit.impact;
    for (const c of this.traffic) {
      const q = carPose(c);
      const r = collideCars(car, q.x, q.z, 2.2, spec.radius);
      car = r.car;
      impact = Math.max(impact, r.impact);
    }
    // hitting the traffic is an offence; any hard hit damages the car
    let trafficHit = 0;
    for (const c of this.traffic) {
      const q = carPose(c);
      if (Math.hypot(car.x - q.x, car.z - q.z) < spec.radius + 2.6) trafficHit = Math.max(trafficHit, impact);
    }
    if (impact > 6) this.event(p, 'collision');
    if (trafficHit > 6 && !p.walker) this.offence(p, 'crash');
    this.damageBy(p, impact);
    const s = this.city.station;
    const inStation = car.x > s.x0 && car.x < s.x1 && car.z > s.z0 && car.z < s.z1;
    if (inStation && car.fuel < 1) {
      car = { ...car, fuel: Math.min(1, car.fuel + dt * 0.25) };
      if (car.fuel >= 1) this.event(p, 'refuel');
    }
    if (inStation && !p.inStation) {
      // the garage of the station: a respray clears the heat, the mechanics fix the car
      if (p.heat.level > 0) {
        p.heat.clear();
        this.chasers = this.chasers.filter((c) => c.target !== p.index);
        this.event(p, 'respray');
      }
      if (p.damage > 0) {
        p.damage = 0;
        this.world.setDamage(p.index, 0);
        this.event(p, 'repaired');
      }
    }
    p.inStation = inStation;
    if (!p.walker) {
      if (ranRedLight(p.lastPos, car, this.t, this.city.blocks, this.overrides)) this.offence(p, 'red-light');
      const kmh = Math.abs(forwardSpeed(car)) * 3.6;
      const cam = flashedBy(this.cameras, car.x, car.z, kmh, this.t, p.lastFlash);
      if (cam) {
        const fine = fineOf(Math.round(kmh), cam.limit);
        p.score = Math.max(0, p.score - fine);
        p.fines++;
        p.ticket = `Camera ${cam.id + 1}: ${Math.round(kmh)} km/h (limit ${cam.limit})`;
        this.world.flashCamera(cam.id);
        this.onFlash({ camera: cam, kmh: Math.round(kmh), fine }, p.index);
        this.audio?.play('flash');
        this.offence(p, 'speed-camera');
      }
    }
    p.lastPos = { x: car.x, z: car.z };
    if (car.fuel === 0 && !p.wasEmpty) this.event(p, 'empty');
    p.wasEmpty = car.fuel === 0;
    p.car = car;
    if (p.walker) {
      const a = this.axes(p);
      p.walker = stepWalker(p.walker, { move: a.move, turn: a.steer, run: this.on(p, 'run') || p.pad.handbrake }, dt, this.city.buildings, bounds);
      if (!p.released && p.throwAt !== null && this.t - p.throwAt >= THROW_RELEASE_AT) this.release(p);
    }
  }

  // --- atmosphere (#95) -----------------------------------------------------------------------

  /** Per player: engine, screech, horn; skid marks while sliding; the siren; the weather. */
  private atmosphere(dt: number): void {
    const live = !this.paused && !this.lobby;
    this.players.forEach((p, k) => {
      const horn = live && (this.on(p, 'horn') || p.pad.horn);
      this.world.setHorn(k, horn);
      const c = p.car;
      const slip = Math.abs(c.vx * Math.cos(c.heading) - c.vz * Math.sin(c.heading));
      const speed = Math.hypot(c.vx, c.vz);
      this.audio?.voice(k, { speed: live ? speed : 0, throttle: live ? Math.max(0, this.input(p).throttle) : 0, slip: live ? slip : 0, horn, onFoot: p.walker !== null });
      if (!live || p.walker || slip < 3 || speed < 6) return;
      p.skidFor += speed * dt;
      if (p.skidFor < SKID_STEP_M) return;
      p.skidFor = 0;
      // the two rear wheels: back along the car, either side of it
      const back = -p.vehicle.body.l * 0.32;
      const side = p.vehicle.body.w * 0.38;
      const fx = Math.sin(c.heading);
      const fz = Math.cos(c.heading);
      for (const s of [-1, 1]) this.world.addSkid(c.x + fx * back + fz * side * s, c.z + fz * back - fx * side * s, c.heading);
    });
    this.audio?.setSiren(live && this.chasers.length > 0);
    this.weather = easeWeather(this.weather, this.weatherBound ?? demoWeather(this.t), dt);
    this.world.setWeather(this.weather);
  }

  // --- thrown cubes (#89) --------------------------------------------------------------------

  /** The pose of a person on foot: the stride, and the throw under way. */
  private poseOf(p: LocalPlayer): Pose {
    const w = p.walker as WalkerState;
    const base = gaitPose(w.phase, w.speed);
    const since = p.throwAt === null ? Infinity : this.t - p.throwAt;
    return since < THROW_DURATION ? throwPose(base, since) : base;
  }

  /**
   * The cube shows in the hand from the start of a throw to its release: its edge (m), at most
   * {@link HELD_MAX_M} so that a big cube does not hide the view behind the player.
   */
  private holding(p: LocalPlayer): number | null {
    return !p.released && p.throwAt !== null ? Math.min(this.cubeM(), HELD_MAX_M) : null;
  }

  /** Edge of a thrown cube (m), from the settings. */
  private cubeM(): number {
    return this.settings.cubeSizeCm / 100;
  }

  /**
   * Throw (E, pad X): on foot the arm winds up and the cube leaves the hand a moment later;
   * from the car it flies at once from above the windscreen, forward on top of the car's speed.
   * Not in the countdown nor once the match is over.
   */
  private throwCube(p: LocalPlayer): void {
    if ((this.match && !this.match.live) || !canThrow(p.throwAt, this.t, p.walker !== null)) return;
    p.throwAt = this.t;
    if (p.walker) {
      p.released = false;
      return;
    }
    const c = p.car;
    this.cubes.push(throwFromCar(c.x, c.z, c.heading, c.vx, c.vz, p.vehicle.body.l / 2, p.index, this.cubeM()));
    this.audio?.play('throw');
  }

  /** On foot: the cube leaves the hand. */
  private release(p: LocalPlayer): void {
    p.released = true;
    const w = p.walker;
    if (!w) return;
    this.cubes.push(throwByHand(w.x, w.z, w.heading, p.index, this.cubeM()));
    this.audio?.play('throw');
  }

  /**
   * The thrown cubes: in flight, a cube that reaches a logo or a car sticks to it; stuck cubes
   * (also on walls and the ground) wait their fuse, then blow up — the blast takes the logos and
   * hits the cars within {@link BLAST_M}.
   */
  private stepCubes(dt: number): void {
    const next: ThrownCube[] = [];
    for (const b of this.cubes) {
      let { cube, blows } = stepCube(b, dt, this.city.buildings);
      if (cube.fuse === null) {
        const onLogo = this.hunt?.tokens.some((t) => !t.taken && Math.hypot(t.x - cube.x, t.z - cube.z) < 1.2) && cube.y < 3.5;
        const onCar =
          this.traffic.some((c) => {
            const q = carPose(c);
            return Math.hypot(q.x - cube.x, q.z - cube.z) < 2.4;
          }) || this.chasers.some((c) => Math.hypot(c.car.x - cube.x, c.car.z - cube.z) < 2.4);
        if (onLogo || onCar) cube = stick(cube);
      }
      if (blows) {
        this.blowCube(cube);
        continue;
      }
      next.push(cube);
    }
    this.cubes = next;
  }

  private blowCube(b: ThrownCube): void {
    this.world.explodeCube(b.x, b.y, b.z, b.size);
    this.audio?.play('explosion');
    const p = this.players[b.owner];
    if (!p) return;
    this.takeLogos(p, b.x, b.z, BLAST_M);
    const carHit = this.traffic.some((c) => {
      const q = carPose(c);
      return Math.hypot(q.x - b.x, q.z - b.z) < BLAST_M;
    });
    const chaserHit = this.chasers.some((c) => Math.hypot(c.car.x - b.x, c.car.z - b.z) < BLAST_M);
    if (carHit || chaserHit) {
      this.offence(p, chaserHit ? 'ram-security' : 'crash');
      this.event(p, 'smash');
    }
  }

  private offence(p: LocalPlayer, kind: Offence): void {
    const before = p.heat.level;
    p.heat.offence(kind, this.t);
    if (kind !== 'crash') this.event(p, kind);
    if (p.heat.level >= 2 && before < 2) this.event(p, 'chase');
  }

  private damageBy(p: LocalPlayer, impact: number): void {
    const next = applyImpact(p.damage, impact);
    if (next === p.damage) return;
    p.damage = next;
    this.world.setDamage(p.index, next);
  }

  /** Security cars: spawn for the alert level, chase, catch or lose their target (#85). */
  private stepTension(dt: number, bounds: { x0: number; z0: number; x1: number; z1: number }): void {
    this.players.forEach((p, i) => {
      const mine = this.chasers.filter((c) => c.target === i);
      const want = chasersFor(p.heat.level);
      for (let k = mine.length; k < want; k++) this.chasers.push(spawnChaser(p.car, i, k));
      if (mine.length > want) {
        const drop = new Set(mine.slice(want));
        this.chasers = this.chasers.filter((c) => !drop.has(c));
      }
    });
    for (const c of this.chasers) {
      const p = this.players[c.target];
      if (!p) continue;
      const at = this.positionOf(c.target);
      const target = p.walker
        ? { ...p.car, x: at.x, z: at.z, vx: Math.sin(at.heading) * p.walker.speed, vz: Math.cos(at.heading) * p.walker.speed }
        : p.car;
      let car = stepCar(c.car, chaserInput(c, target, dt), dt, CHASER_SPEC);
      car = collide(car, this.city.buildings, bounds, 0.2, CHASER_SPEC.radius).car;
      c.car = car;
      // ramming a security car is an offence too; both cars bounce
      if (!p.walker) {
        const r = collideCars(p.car, car.x, car.z, CHASER_SPEC.radius, p.vehicle.spec.radius);
        if (r.impact > 0) {
          p.car = r.car;
          this.damageBy(p, r.impact);
          if (r.impact > 8) this.offence(p, 'ram-security');
        }
      }
    }
    this.players.forEach((p, i) => {
      const mine = this.chasers.filter((c) => c.target === i);
      const at = this.positionOf(i);
      const dists = mine.map((c) => Math.hypot(c.car.x - at.x, c.car.z - at.z));
      const seen = dists.some((d) => d < SIGHT_M);
      p.heat.step(dt, this.t, seen);
      if (mine.length === 0) {
        p.escapeFor = 0;
        p.caughtFor = 0;
        return;
      }
      // escape: every chaser far away for a while → they give up, the level falls to 1
      p.escapeFor = dists.every((d) => d > ESCAPE_M) ? p.escapeFor + dt : 0;
      if (p.escapeFor >= ESCAPE_S) {
        p.heat.heat = Math.min(p.heat.heat, LEVEL_HEAT[0]);
        this.chasers = this.chasers.filter((c) => c.target !== i);
        p.escapeFor = 0;
        this.event(p, 'escaped');
        return;
      }
      // caught: a chaser right there while the player crawls
      const slow = (p.walker ? Math.abs(p.walker.speed) : Math.abs(forwardSpeed(p.car))) < 2.2;
      p.caughtFor = slow && dists.some((d) => d < CAUGHT_M) ? p.caughtFor + dt : Math.max(0, p.caughtFor - dt);
      if (p.caughtFor >= CAUGHT_S) {
        p.score = Math.floor(p.score * 0.8);
        p.heat.clear();
        p.caughtFor = 0;
        this.chasers = this.chasers.filter((c) => c.target !== i);
        p.car = { ...p.car, vx: 0, vz: 0 };
        this.event(p, 'caught');
      }
    });
  }

  private stepHunt(p: LocalPlayer): void {
    const at = this.positionOf(p.index);
    this.takeLogos(p, at.x, at.z);
  }

  /** Logos within reach of (x, z) — by car, on foot or by a cube's blast — taken by player p; true when any. */
  private takeLogos(p: LocalPlayer, x: number, z: number, reach?: number): boolean {
    if (!this.hunt) return false;
    const step = this.hunt.step(x, z, this.t, p.hunter, reach);
    if (step.pickups.length === 0) return false;
    p.score += step.points;
    for (const pk of step.pickups) {
      this.world.explodeToken(pk.token.x, pk.token.z);
      this.onLogo(pk, p.index);
      this.audio?.play('logo');
    }
    if (step.waveDone) this.event(p, 'wave-done');
    this.world.setTokens(this.hunt.tokens);
    this.emitHud();
    return true;
  }

  private stepMissions(p: LocalPlayer, dt: number): void {
    if (!p.mission) return;
    const faulted = new Set([...this.machineStates].filter(([, st]) => st === 'fault').map(([id]) => id));
    const m = cancelIfRepaired(p.mission, faulted);
    const step = stepMission(m, this.positionOf(p.index), dt);
    p.mission = step.mission;
    p.score += step.gained;
    if (step.event === 'pickup') this.event(p, 'pickup');
    if (step.event === 'done') this.event(p, 'mission-done');
    if (step.event === 'failed' || (m !== p.mission && m.stage === 'failed')) this.event(p, 'mission-failed');
  }

  private event(p: LocalPlayer, e: GameEvent): void {
    p.lastEvent = e;
    if (e === 'collision' || e === 'smash') this.audio?.play('crash');
    this.onEvent(e, p.index);
  }

  private emitHud(): void {
    this.onHud({
      paused: this.paused,
      match: this.match ? { phase: this.match.phase, remaining: this.match.remaining } : null,
      players: this.players.map((p, k) => ({
        speed: this.speedKmh(k),
        fuel: p.car.fuel,
        score: p.score,
        mission: p.mission,
        paused: this.paused,
        camera: p.camera,
        lastEvent: p.lastEvent,
        onFoot: p.walker !== null,
        hunt: this.hunt ? { left: this.hunt.left, wave: this.hunt.wave, collected: p.hunter.logos, combo: this.hunt.comboAt(this.t, p.hunter) } : null,
        alert: p.heat.level,
        damage: p.damage,
        chasers: this.chasers.filter((c) => c.target === k).length,
        caught: Math.min(1, p.caughtFor / CAUGHT_S)
      }))
    });
  }

  // --- keyboard and pads -------------------------------------------------------------------

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const keyboardPlayer = this.players.find((p) => this.usesKeyboard(p));
    // lobby, or nobody on the keyboard: Enter / Space join, Escape leaves
    if (this.lobby || !keyboardPlayer) {
      if (!e.repeat && (e.code === 'Enter' || e.code === 'Space' || e.code === 'NumpadEnter')) this.onDevice('keyboard', 'join');
      if (!e.repeat && e.code === 'Escape' && this.lobby) this.onDevice('keyboard', 'leave');
      if (this.lobby) {
        e.preventDefault();
        return;
      }
    }
    const action = actionOf(this.settings, e.code);
    if (action && ONE_SHOT.includes(action)) {
      // pause works for everybody; the other actions belong to the keyboard player
      if (!e.repeat && (keyboardPlayer || action === 'pause')) this.run(keyboardPlayer ?? this.players[0], action);
    } else {
      this.keys.add(e.code);
    }
    if (action || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };

  private readonly onPadLost = (e: GamepadEvent): void => {
    const device = padDevice(e.gamepad.index);
    this.joinPrevious.delete(e.gamepad.index);
    if (this.players.some((p) => p.device === device)) this.onDeviceLost(device);
  };
}
