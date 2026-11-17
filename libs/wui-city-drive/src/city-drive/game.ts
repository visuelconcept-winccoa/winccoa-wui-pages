// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The game loop of City Drive (#79): keyboard input, car physics, collisions, traffic,
 * missions or logo hunt, on foot (F), fuel, score; draws through {@link CityWorld} and reports a {@link HudState} to the
 * page a few times per second. Datapoints never reach this file: the page feeds the machine
 * states and the forced lights in, and reads the telemetry out (dp-link.ts).
 */
import type { MachineState } from './bindings.js';
import { CELL, ROAD_WIDTH, generateCity, rng, type City } from './city.js';
import { LogoHunt, type Pickup } from './collectibles.js';
import { cancelIfRepaired, newDelivery, newIntervention, stepMission, type Mission } from './missions.js';
import type { NeonPalette } from './palette.js';
import { collide, collideCars, forwardSpeed, newCar, stepCar, type CarInput, type CarState } from './physics.js';
import { carPose, spawnTraffic, stepTraffic, type LightOverrides, type TrafficCar } from './traffic.js';
import { DEFAULT_SETTINGS, actionOf, readPad, type Action, type PadState, type Settings } from './settings.js';
import { canEnter, leaveCar, stepWalker, type WalkerState } from './walker.js';
import { DEFAULT_PROFILE, vehicleById, type Profile, type Vehicle } from './vehicles.js';
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
  /** Logo hunt: tokens left in the wave, wave number, logos taken, running combo; null in missions mode. */
  hunt: { left: number; wave: number; collected: number; combo: number } | null;
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

const TRAFFIC = 26;
const MAX_DT = 1 / 20;
const HUD_HZ = 8;
const NO_PAD: PadState = { throttle: 0, brake: 0, steer: 0, move: 0, handbrake: false, pressed: [] };

export class CityGame {
  readonly city: City;
  readonly world: CityWorld;
  car: CarState;
  traffic: TrafficCar[];
  mission: Mission | null = null;
  score = 0;
  paused = false;
  machineStates = new Map<string, MachineState>();
  overrides: LightOverrides = { allRed: new Set() };
  /** The other players, from their datapoints. */
  remotes: RemoteCar[] = [];
  onHud: (hud: HudState) => void = () => {};
  onEvent: (event: GameEvent) => void = () => {};
  onProfile: (profile: Profile) => void = () => {};
  /** A logo token was blown up (logo hunt). */
  onLogo: (pickup: Pickup) => void = () => {};
  /** Logo hunt (mode `logos`), or null in missions mode. */
  hunt: LogoHunt | null = null;
  /** The player on foot, or null when driving. */
  walker: WalkerState | null = null;
  /** Key bindings, gamepad and the other settings (settings.ts). */
  settings: Settings = DEFAULT_SETTINGS;
  /** Name of the gamepad in use, or '' when none is connected. */
  padName = '';
  private pad: PadState = NO_PAD;
  private readonly padPrevious: boolean[] = [];

  private readonly keys = new Set<string>();
  private readonly rand = rng(97);
  private t = 0;
  private hudClock = 0;
  private raf = 0;
  private last = 0;
  private camera: CameraMode = 'chase';
  private lastEvent: GameEvent | null = null;
  private missionCount = 0;
  private wasEmpty = false;
  private readonly resizeObserver: ResizeObserver;
  private profile: Profile = DEFAULT_PROFILE;
  private vehicle: Vehicle = vehicleById(DEFAULT_PROFILE.vehicle);

  constructor(
    private readonly host: HTMLElement,
    private readonly palette: NeonPalette,
    seed = 7
  ) {
    this.city = generateCity(seed);
    this.world = new CityWorld(host, this.city, palette);
    this.car = newCar(CELL * 2, CELL * 2 + CELL / 2, 0);
    this.car.x -= ROAD_WIDTH / 4; // right-hand lane, facing +Z
    this.traffic = spawnTraffic(TRAFFIC, this.city.blocks);
    host.tabIndex = 0;
    host.addEventListener('keydown', this.onKeyDown);
    host.addEventListener('keyup', this.onKeyUp);
    host.addEventListener('blur', () => this.keys.clear());
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
    this.world.dispose();
  }

  /** Applies the settings: bindings and gamepad at once, camera distance and graphics in the world. */
  setSettings(settings: Settings): void {
    this.settings = settings;
    this.keys.clear();
    this.world.setCameraDistance(settings.cameraDistance);
    this.world.setQuality(settings.quality);
  }

  /** The player's nickname, vehicle and neon colour. */
  setProfile(profile: Profile): void {
    if (profile.mode !== this.profile.mode || (profile.mode === 'logos') !== (this.hunt !== null)) {
      this.hunt = profile.mode === 'logos' ? new LogoHunt(this.city) : null;
      this.world.setTokens(this.hunt?.tokens ?? []);
    }
    this.profile = profile;
    this.vehicle = vehicleById(profile.vehicle);
    this.world.setPlayerVehicle(this.vehicle.body, this.palette[profile.color]);
    this.world.setTimeOfDay(profile.time);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.keys.clear();
    this.emitHud();
  }

  /** Night ↔ day (T); the page keeps the choice in the profile through `onProfile`. */
  toggleTimeOfDay(): void {
    this.setProfile({ ...this.profile, time: this.profile.time === 'day' ? 'night' : 'day' });
    this.onProfile(this.profile);
    this.emitHud();
  }

  /** Next camera view (C). */
  toggleCamera(): void {
    this.camera = CAMERA_MODES[(CAMERA_MODES.indexOf(this.camera) + 1) % CAMERA_MODES.length];
    this.world.setCameraMode(this.camera);
    this.emitHud();
  }

  setCamera(mode: CameraMode): void {
    this.camera = mode;
    this.world.setCameraMode(mode);
    this.emitHud();
  }

  /** Out of the car, or back in when close enough to it (F). */
  toggleFoot(): void {
    if (!this.walker) {
      if (Math.abs(forwardSpeed(this.car)) > 3) return; // stop first
      this.walker = leaveCar(this.car, this.vehicle.body.w / 2);
      this.event('on-foot');
    } else if (canEnter(this.walker, this.car)) {
      this.walker = null;
      this.event('in-car');
    } else {
      this.event('too-far');
    }
    this.world.setWalker(this.walker, this.palette[this.profile.color]);
    this.emitHud();
  }

  /** Where the player is: on foot, or in the car. */
  get position(): { x: number; z: number; heading: number } {
    return this.walker ?? this.car;
  }

  /** Puts the car back on the nearest road, facing along it. */
  resetCar(): void {
    const kx = Math.round(this.car.x / CELL);
    const kz = Math.round(this.car.z / CELL);
    const dx = Math.abs(this.car.x - kx * CELL);
    const dz = Math.abs(this.car.z - kz * CELL);
    const fuel = this.car.fuel;
    this.car = dx < dz ? newCar(kx * CELL - ROAD_WIDTH / 4, this.car.z, 0) : newCar(this.car.x, kz * CELL + ROAD_WIDTH / 4, Math.PI / 2);
    this.car.fuel = fuel;
  }

  newMission(): void {
    this.missionCount++;
    const faulted = [...this.machineStates].filter(([, s]) => s === 'fault').map(([id]) => id);
    this.mission =
      (faulted.length > 0 ? newIntervention(this.city, faulted[0], this.missionCount) : null) ??
      (this.hunt ? null : newDelivery(this.city, this.position, this.missionCount, 1000 + this.missionCount * 31));
    this.emitHud();
  }

  telemetry(): Telemetry {
    const at = this.position;
    return {
      x: Math.round(at.x * 10) / 10,
      z: Math.round(at.z * 10) / 10,
      heading: Math.round((((at.heading * 180) / Math.PI) % 360 + 360) % 360),
      speed: this.speedKmh(),
      fuel: Math.round(this.car.fuel * 1000) / 10,
      score: this.score,
      mission: this.mission ? `${this.mission.kind}:${this.mission.stage}` : '',
      event: this.lastEvent ?? '',
      nickname: this.profile.nickname,
      // on foot, the others see a pedestrian
      vehicle: this.walker ? 'foot' : this.profile.vehicle,
      color: this.profile.color
    };
  }

  /** km/h of the player: walking or driving. */
  speedKmh(): number {
    return Math.round(Math.abs(this.walker ? this.walker.speed : forwardSpeed(this.car)) * 3.6);
  }

  /** A held action: one of its keys is down. */
  private on(action: Action): boolean {
    return this.settings.keys[action].some((code) => this.keys.has(code));
  }

  /** Keyboard and gamepad merged; the stronger of the two wins on each axis. */
  private axes(): { throttle: number; steer: number; move: number } {
    const kbThrottle = (this.on('up') ? 1 : 0) - (this.on('down') ? 1 : 0);
    const kbSteer = (this.on('right') ? 1 : 0) - (this.on('left') ? 1 : 0);
    const padThrottle = this.pad.throttle - this.pad.brake;
    const pick = (a: number, b: number): number => (Math.abs(a) >= Math.abs(b) ? a : b);
    const steer = Math.max(-1, Math.min(1, pick(kbSteer, this.pad.steer) * this.settings.steering));
    return { throttle: pick(kbThrottle, padThrottle), steer, move: pick(kbThrottle, this.pad.move) };
  }

  private input(): CarInput {
    if (this.walker) return { throttle: 0, steer: 0, handbrake: true }; // parked: the car rolls to a stop
    const a = this.axes();
    return { throttle: a.throttle, steer: a.steer, handbrake: this.on('brake') || this.pad.handbrake };
  }

  /** Reads the first connected gamepad and runs the buttons just pressed. */
  private pollPad(): void {
    if (!this.settings.gamepad.enabled || typeof navigator === 'undefined' || !navigator.getGamepads) {
      this.pad = NO_PAD;
      this.padName = '';
      return;
    }
    const pad = [...navigator.getGamepads()].find((g) => g && g.connected) ?? null;
    if (!pad) {
      this.pad = NO_PAD;
      this.padName = '';
      return;
    }
    this.padName = pad.id;
    this.pad = readPad(pad, this.settings, this.padPrevious);
    for (const action of this.pad.pressed) this.run(action);
  }

  /** A one-shot action (key or gamepad button). */
  private run(action: Action): void {
    if (action === 'pause') this.setPaused(!this.paused);
    else if (this.paused) return;
    else if (action === 'camera') this.toggleCamera();
    else if (action === 'time') this.toggleTimeOfDay();
    else if (action === 'reset') this.resetCar();
    else if (action === 'foot') this.toggleFoot();
    else if (action === 'mission' && (!this.mission || this.mission.stage === 'done' || this.mission.stage === 'failed')) this.newMission();
  }

  private tick(dt: number): void {
    this.pollPad();
    if (!this.paused) this.step(dt);
    this.world.setPlayer(this.car);
    if (this.walker) this.world.setWalker(this.walker, this.palette[this.profile.color]);
    this.world.setTraffic(this.traffic.map((c) => ({ ...carPose(c), color: c.color })));
    this.world.setMachineStates(this.machineStates);
    this.world.setRemotePlayers(this.remotes);
    this.world.setLights(this.t, this.overrides);
    this.world.setMarker(this.mission && ['pickup', 'drop', 'reach'].includes(this.mission.stage) ? this.mission.target : null, this.mission?.kind ?? null, this.mission?.stage ?? null);
    this.world.render(this.paused ? 0 : dt, this.walker ? this.walker.speed : forwardSpeed(this.car));
    this.hudClock += dt;
    if (this.hudClock >= 1 / HUD_HZ) {
      this.hudClock = 0;
      this.emitHud();
    }
  }

  private step(dt: number): void {
    this.t += dt;
    const spec = this.vehicle.spec;
    let car = stepCar(this.car, this.input(), dt, spec);
    const bounds = { x0: -ROAD_WIDTH / 2, z0: -ROAD_WIDTH / 2, x1: this.city.size + ROAD_WIDTH / 2, z1: this.city.size + ROAD_WIDTH / 2 };
    const hit = collide(car, this.city.buildings, bounds, 0.25, spec.radius);
    car = hit.car;
    let impact = hit.impact;
    for (const c of this.traffic) {
      const p = carPose(c);
      const r = collideCars(car, p.x, p.z, 2.2, spec.radius);
      car = r.car;
      impact = Math.max(impact, r.impact);
    }
    if (impact > 6) this.event('collision');
    // fuel station
    const s = this.city.station;
    if (car.x > s.x0 && car.x < s.x1 && car.z > s.z0 && car.z < s.z1 && car.fuel < 1) {
      car = { ...car, fuel: Math.min(1, car.fuel + dt * 0.25) };
      if (car.fuel >= 1) this.event('refuel');
    }
    if (car.fuel === 0 && !this.wasEmpty) this.event('empty');
    this.wasEmpty = car.fuel === 0;
    this.car = car;
    if (this.walker) {
      const a = this.axes();
      this.walker = stepWalker(
        this.walker,
        { move: a.move, turn: a.steer, run: this.on('run') || this.pad.handbrake },
        dt,
        this.city.buildings,
        bounds
      );
    }
    stepTraffic(this.traffic, this.city.blocks, this.t, dt, this.position, this.rand, this.overrides);
    this.stepMissions(dt);
    this.stepHunt();
  }

  private stepHunt(): void {
    if (!this.hunt) return;
    const at = this.position;
    const step = this.hunt.step(at.x, at.z, this.t);
    if (step.pickups.length === 0) return;
    this.score += step.points;
    for (const p of step.pickups) {
      this.world.explodeToken(p.token.x, p.token.z);
      this.onLogo(p);
    }
    if (step.waveDone) this.event('wave-done');
    this.world.setTokens(this.hunt.tokens);
    this.emitHud();
  }

  private stepMissions(dt: number): void {
    if (!this.mission) return;
    const faulted = new Set([...this.machineStates].filter(([, st]) => st === 'fault').map(([id]) => id));
    const m = cancelIfRepaired(this.mission, faulted);
    const step = stepMission(m, this.position, dt);
    this.mission = step.mission;
    this.score += step.gained;
    if (step.event === 'pickup') this.event('pickup');
    if (step.event === 'done') this.event('mission-done');
    if (step.event === 'failed' || (m !== this.mission && m.stage === 'failed')) this.event('mission-failed');
  }

  private event(e: GameEvent): void {
    this.lastEvent = e;
    this.onEvent(e);
  }

  private emitHud(): void {
    this.onHud({
      speed: this.speedKmh(),
      fuel: this.car.fuel,
      score: this.score,
      mission: this.mission,
      paused: this.paused,
      camera: this.camera,
      lastEvent: this.lastEvent,
      onFoot: this.walker !== null,
      hunt: this.hunt ? { left: this.hunt.left, wave: this.hunt.wave, collected: this.hunt.collected, combo: this.hunt.comboAt(this.t) } : null
    });
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    const action = actionOf(this.settings, e.code);
    if (action && ['pause', 'camera', 'time', 'reset', 'foot', 'mission'].includes(action)) {
      if (!e.repeat) this.run(action);
    } else {
      this.keys.add(e.code);
    }
    if (action || e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
}
