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
import type { NeonPalette } from './palette.js';
import { collide, collideCars, forwardSpeed, newCar, stepCar, type CarInput, type CarState } from './physics.js';
import { DEFAULT_SETTINGS, actionOf, readPad, type Action, type PadLike, type PadState, type Settings } from './settings.js';
import { carPose, spawnTraffic, stepTraffic, type LightOverrides, type TrafficCar } from './traffic.js';
import { DEFAULT_PROFILE, vehicleById, type Profile, type Vehicle } from './vehicles.js';
import { canEnter, leaveCar, stepWalker, type WalkerState } from './walker.js';
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
  | 'too-far';

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
}

const TRAFFIC = 26;
const MAX_DT = 1 / 20;
const HUD_HZ = 8;
const NO_PAD: PadState = { throttle: 0, brake: 0, steer: 0, move: 0, handbrake: false, pressed: [] };
const ONE_SHOT: readonly Action[] = ['pause', 'camera', 'time', 'reset', 'foot', 'mission'];
type Pad = PadLike & { index: number; id: string };

/** Start of player k: the right-hand lane facing +Z, the second player 14 m behind the first. */
function startCar(k: number): CarState {
  return newCar(CELL * 2 - ROAD_WIDTH / 4, CELL * 2 + CELL / 2 - k * 14, 0);
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
    seed = 7
  ) {
    this.city = generateCity(seed);
    this.world = new CityWorld(host, this.city, palette);
    this.traffic = spawnTraffic(TRAFFIC, this.city.blocks);
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
        pad: NO_PAD,
        padPrevious: [],
        wasEmpty: false
      });
    }
    for (let k = n; k < this.players.length; k++) this.world.setWalker(k, null, 0);
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
    this.world.setPlayerVehicle(p.index, p.vehicle.body, this.palette[p.profile.color]);
    this.world.setTimeOfDay(this.time);
    this.world.setCameraMode(p.index, p.camera);
  }

  /** Applies the settings: bindings and gamepad at once, camera distance and graphics in the world. */
  setSettings(settings: Settings): void {
    this.settings = settings;
    this.keys.clear();
    this.world.setCameraDistance(settings.cameraDistance);
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
      this.world.setWalker(k, null, 0);
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
      color: p?.profile.color ?? 'primary'
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
    // pads that drive nobody: join (A / Start) or leave (B) presses
    for (const g of pads) {
      const device = padDevice(g.index);
      if (this.players.some((p) => p.device === device || (p.device === null && this.players.length === 1 && !this.lobby))) continue;
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
    else if (action === 'mission' && !this.match && (!p.mission || p.mission.stage === 'done' || p.mission.stage === 'failed')) this.newMission(p.index);
  }

  // --- loop ------------------------------------------------------------------------------

  private tick(dt: number): void {
    this.pollPads();
    if (!this.paused && !this.lobby) this.step(dt);
    this.players.forEach((p, k) => {
      this.world.setPlayer(k, p.car);
      this.world.setSpeed(k, p.walker ? p.walker.speed : forwardSpeed(p.car));
      if (p.walker) this.world.setWalker(k, p.walker, this.palette[p.profile.color]);
    });
    this.world.setTraffic(this.traffic.map((c) => ({ ...carPose(c), color: c.color })));
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
    const spec = p.vehicle.spec;
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
    if (impact > 6) this.event(p, 'collision');
    const s = this.city.station;
    if (car.x > s.x0 && car.x < s.x1 && car.z > s.z0 && car.z < s.z1 && car.fuel < 1) {
      car = { ...car, fuel: Math.min(1, car.fuel + dt * 0.25) };
      if (car.fuel >= 1) this.event(p, 'refuel');
    }
    if (car.fuel === 0 && !p.wasEmpty) this.event(p, 'empty');
    p.wasEmpty = car.fuel === 0;
    p.car = car;
    if (p.walker) {
      const a = this.axes(p);
      p.walker = stepWalker(p.walker, { move: a.move, turn: a.steer, run: this.on(p, 'run') || p.pad.handbrake }, dt, this.city.buildings, bounds);
    }
  }

  private stepHunt(p: LocalPlayer): void {
    if (!this.hunt) return;
    const at = this.positionOf(p.index);
    const step = this.hunt.step(at.x, at.z, this.t, p.hunter);
    if (step.pickups.length === 0) return;
    p.score += step.points;
    for (const pk of step.pickups) {
      this.world.explodeToken(pk.token.x, pk.token.z);
      this.onLogo(pk, p.index);
    }
    if (step.waveDone) this.event(p, 'wave-done');
    this.world.setTokens(this.hunt.tokens);
    this.emitHud();
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
        hunt: this.hunt ? { left: this.hunt.left, wave: this.hunt.wave, collected: p.hunter.logos, combo: this.hunt.comboAt(this.t, p.hunter) } : null
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
