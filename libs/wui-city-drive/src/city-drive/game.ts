// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The game loop of City Drive (#79): keyboard input, car physics, collisions, traffic,
 * missions, fuel, score; draws through {@link CityWorld} and reports a {@link HudState} to the
 * page a few times per second. Datapoints never reach this file: the page feeds the machine
 * states and the forced lights in, and reads the telemetry out (dp-link.ts).
 */
import type { MachineState } from './bindings.js';
import { CELL, ROAD_WIDTH, generateCity, rng, type City } from './city.js';
import { cancelIfRepaired, newDelivery, newIntervention, stepMission, type Mission } from './missions.js';
import type { NeonPalette } from './palette.js';
import { collide, collideCars, forwardSpeed, newCar, stepCar, type CarInput, type CarState } from './physics.js';
import { carPose, spawnTraffic, stepTraffic, type LightOverrides, type TrafficCar } from './traffic.js';
import { DEFAULT_PROFILE, vehicleById, type Profile, type Vehicle } from './vehicles.js';
import { CAMERA_MODES, CityWorld, type CameraMode, type RemoteCar } from './world.js';

export type GameEvent = 'collision' | 'pickup' | 'mission-done' | 'mission-failed' | 'refuel' | 'empty';

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
const KEYS = {
  up: ['KeyW', 'KeyZ', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'KeyQ', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  brake: ['Space']
};

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

  /** The player's nickname, vehicle and neon colour. */
  setProfile(profile: Profile): void {
    this.profile = profile;
    this.vehicle = vehicleById(profile.vehicle);
    this.world.setPlayerVehicle(this.vehicle.body, this.palette[profile.color]);
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.keys.clear();
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
      newDelivery(this.city, this.car, this.missionCount, 1000 + this.missionCount * 31);
    this.emitHud();
  }

  telemetry(): Telemetry {
    return {
      x: Math.round(this.car.x * 10) / 10,
      z: Math.round(this.car.z * 10) / 10,
      heading: Math.round((((this.car.heading * 180) / Math.PI) % 360 + 360) % 360),
      speed: Math.round(Math.abs(forwardSpeed(this.car)) * 3.6),
      fuel: Math.round(this.car.fuel * 1000) / 10,
      score: this.score,
      mission: this.mission ? `${this.mission.kind}:${this.mission.stage}` : '',
      event: this.lastEvent ?? '',
      nickname: this.profile.nickname,
      vehicle: this.profile.vehicle,
      color: this.profile.color
    };
  }

  private input(): CarInput {
    const on = (names: string[]): boolean => names.some((n) => this.keys.has(n));
    return {
      throttle: (on(KEYS.up) ? 1 : 0) - (on(KEYS.down) ? 1 : 0),
      steer: (on(KEYS.right) ? 1 : 0) - (on(KEYS.left) ? 1 : 0),
      handbrake: on(KEYS.brake)
    };
  }

  private tick(dt: number): void {
    if (!this.paused) this.step(dt);
    this.world.setPlayer(this.car);
    this.world.setTraffic(this.traffic.map((c) => ({ ...carPose(c), color: c.color })));
    this.world.setMachineStates(this.machineStates);
    this.world.setRemotePlayers(this.remotes);
    this.world.setLights(this.t, this.overrides);
    this.world.setMarker(this.mission && ['pickup', 'drop', 'reach'].includes(this.mission.stage) ? this.mission.target : null, this.mission?.kind ?? null, this.mission?.stage ?? null);
    this.world.render(this.paused ? 0 : dt, forwardSpeed(this.car));
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
    stepTraffic(this.traffic, this.city.blocks, this.t, dt, this.car, this.rand, this.overrides);
    this.stepMissions(dt);
  }

  private stepMissions(dt: number): void {
    if (!this.mission) return;
    const faulted = new Set([...this.machineStates].filter(([, st]) => st === 'fault').map(([id]) => id));
    const m = cancelIfRepaired(this.mission, faulted);
    const step = stepMission(m, this.car, dt);
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
      speed: Math.round(Math.abs(forwardSpeed(this.car)) * 3.6),
      fuel: this.car.fuel,
      score: this.score,
      mission: this.mission,
      paused: this.paused,
      camera: this.camera,
      lastEvent: this.lastEvent
    });
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code === 'Escape' || e.code === 'KeyP') this.setPaused(!this.paused);
    else if (e.code === 'KeyC') this.toggleCamera();
    else if (e.code === 'KeyR') this.resetCar();
    else if (e.code === 'KeyN' && (!this.mission || this.mission.stage === 'done' || this.mission.stage === 'failed')) this.newMission();
    else this.keys.add(e.code);
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
  };
}
