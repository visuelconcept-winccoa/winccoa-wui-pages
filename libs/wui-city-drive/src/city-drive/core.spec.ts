import { describe, expect, it } from 'vitest';
import { machineState, lightForced, parseConfig, boundDpes } from './bindings.js';
import { CELL, ROAD_WIDTH, generateCity, nearestRoadPoint, onRoad } from './city.js';
import { cancelIfRepaired, newDelivery, newIntervention, stepMission } from './missions.js';
import { CLASSIC_DARK, mix, parseCssColor } from './palette.js';
import { CAR, collide, forwardSpeed, newCar, stepCar } from './physics.js';
import { TelemetryThrottle } from './telemetry.js';
import { addResults, leaderboard, validEmail, type GameResult } from './results.js';
import { carPose, lightAt, spawnTraffic, stepTraffic } from './traffic.js';

const GO = { throttle: 1, steer: 0, handbrake: false };
const IDLE = { throttle: 0, steer: 0, handbrake: false };

function drive(input = GO, seconds = 1, car = newCar(0, 0, 0)) {
  let c = car;
  for (let k = 0; k < seconds * 60; k++) c = stepCar(c, input, 1 / 60);
  return c;
}

describe('city (#79)', () => {
  it('is deterministic for a seed and holds a plant of four machines and a station', () => {
    const a = generateCity(7);
    expect(generateCity(7)).toEqual(a);
    expect(a.buildings.filter((b) => b.machine).map((b) => b.id)).toEqual(['machine-1', 'machine-2', 'machine-3', 'machine-4']);
    expect(a.blockList.filter((b) => b.kind === 'station')).toHaveLength(1);
    expect(a.size).toBe(6 * CELL);
  });

  it('keeps every building off the roads', () => {
    const city = generateCity(3);
    for (const b of city.buildings) {
      expect(onRoad(city, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)).toBe(false);
      expect(onRoad(city, b.x0, b.z0)).toBe(false);
    }
    expect(onRoad(city, CELL, 37)).toBe(true);
    expect(nearestRoadPoint(city, CELL + 5, CELL + 30)).toEqual({ x: CELL, z: CELL + 30 });
  });
});

describe('physics (#79)', () => {
  it('accelerates forward, tops out, and burns fuel', () => {
    const c = drive(GO, 1);
    expect(forwardSpeed(c)).toBeGreaterThan(10);
    expect(c.z).toBeGreaterThan(4);
    expect(Math.abs(c.x)).toBeLessThan(1e-9);
    expect(forwardSpeed(drive(GO, 30))).toBeLessThanOrEqual(CAR.maxSpeed);
    expect(c.fuel).toBeLessThan(1);
  });

  it('turns right with a positive steer: facing +Z, towards -X', () => {
    const c = drive({ throttle: 1, steer: 1, handbrake: false }, 1.5);
    expect(c.heading).toBeLessThan(0);
    expect(c.x).toBeLessThan(0);
  });

  it('coasts to a stop without reversing', () => {
    const c = drive(IDLE, 40, drive(GO, 1));
    expect(forwardSpeed(c)).toBe(0);
  });

  it('crawls on an empty tank', () => {
    const c = drive(GO, 10, { ...newCar(0, 0), fuel: 0 });
    expect(forwardSpeed(c)).toBeLessThanOrEqual(CAR.emptySpeed);
  });

  it('is pushed out of a building and reports the impact', () => {
    const car = { ...newCar(0, -1.5, 0), vz: 20 };
    const { car: out, impact } = collide(car, [{ x0: -5, z0: 0, x1: 5, z1: 10 }], { x0: -100, z0: -100, x1: 100, z1: 100 });
    expect(out.z).toBeCloseTo(-CAR.radius, 5);
    expect(out.vz).toBeLessThan(0);
    expect(impact).toBeCloseTo(20, 5);
  });
});

describe('traffic (#79)', () => {
  it('alternates the two axes of a crossroads, and a forced crossroads is red', () => {
    for (let t = 0; t < 18; t += 0.5) {
      expect(lightAt(2, 3, 0, t) === 'green' && lightAt(2, 3, 1, t) === 'green').toBe(false);
    }
    expect(lightAt(2, 3, 0, 1, { allRed: new Set(['2-3']) })).toBe('red');
  });

  it('drives in the right-hand lane', () => {
    // towards +Z from node (1, 1): right of the driver is -X
    expect(carPose({ id: 0, i: 1, j: 1, dir: 0, s: 10, speed: 0, color: 0 })).toMatchObject({ x: CELL - ROAD_WIDTH / 4, z: CELL + 10 });
  });

  it('stops before a red light and stays in the city', () => {
    const cars = spawnTraffic(1, 6);
    Object.assign(cars[0], { i: 2, j: 2, dir: 0, s: 30, speed: 11 });
    const allRed = { allRed: new Set(['2-3']) };
    let rand = 0;
    for (let k = 0; k < 600; k++) stepTraffic(cars, 6, k / 60, 1 / 60, null, () => (rand = (rand + 0.37) % 1), allRed);
    expect(cars[0]).toMatchObject({ i: 2, j: 2 });
    expect(cars[0].s).toBeLessThan(CELL - 9);
    expect(cars[0].speed).toBeLessThan(0.5);
  });
});

describe('missions (#79)', () => {
  const city = generateCity(7);
  it('delivery: pick-up then drop, points with a time bonus', () => {
    const m = newDelivery(city, { x: 0, z: 0 }, 1, 5);
    const a = stepMission(m, m.target, 1);
    expect(a.event).toBe('pickup');
    expect(a.mission.stage).toBe('drop');
    const b = stepMission(a.mission, m.drop!, 1);
    expect(b.event).toBe('done');
    expect(b.gained).toBeGreaterThan(m.reward);
  });

  it('fails when the time runs out', () => {
    const m = newDelivery(city, { x: 0, z: 0 }, 1, 5);
    expect(stepMission(m, { x: -999, z: -999 }, m.timeLeft + 1).event).toBe('failed');
  });

  it('intervention: reach the faulted machine; cancelled once repaired', () => {
    const m = newIntervention(city, 'machine-2', 2)!;
    expect(m.timeLeft).toBe(Infinity);
    expect(stepMission(m, m.target, 1).event).toBe('done');
    expect(cancelIfRepaired(m, new Set()).stage).toBe('failed');
    expect(cancelIfRepaired(m, new Set(['machine-2']))).toBe(m);
    expect(newIntervention(city, 'nope', 3)).toBeNull();
  });
});

describe('bindings (#79)', () => {
  it('parses the config and drops malformed entries', () => {
    const cfg = parseConfig(
      JSON.stringify({
        machines: [{ building: 'machine-1', dpe: 'Oven.State', fault: [3] }, { building: '', dpe: 'x' }],
        lights: [{ crossroads: '3-3', dpe: 'Plant.Stop' }, { crossroads: 'a', dpe: 'y' }]
      })
    );
    expect(cfg.machines).toEqual([{ building: 'machine-1', dpe: 'Oven.State', fault: [3] }]);
    expect(cfg.lights).toHaveLength(1);
    expect(boundDpes(cfg)).toEqual(['Oven.State', 'Plant.Stop']);
    expect(parseConfig('not json')).toEqual({ machines: [], lights: [] });
  });

  it('maps values to machine states, with defaults and explicit lists', () => {
    expect(machineState(true)).toBe('run');
    expect(machineState(0)).toBe('stop');
    expect(machineState(2)).toBe('fault');
    expect(machineState('Défaut')).toBe('fault');
    expect(machineState(null)).toBe('unknown');
    expect(machineState(5, { run: [5], fault: [9] })).toBe('run');
    expect(machineState('9', { run: [5], fault: [9] })).toBe('fault');
    expect(machineState(7, { run: [5] })).toBe('unknown');
    expect(lightForced(true)).toBe(true);
    expect(lightForced('0')).toBe(false);
  });
});

describe('telemetry throttle (#79)', () => {
  const sample = { x: 0, z: 0, heading: 0, speed: 0, fuel: 100, score: 0, mission: '', event: '', nickname: 'Aurel', vehicle: 'coupe', color: 'primary', alert: 0, wanted: false, damage: 0, ticket: '', fines: 0 };
  it('sends the first sample whole, then only moved fields, at most maxHz', () => {
    const th = new TelemetryThrottle();
    expect(th.offer(sample, 0)).toEqual(sample);
    expect(th.offer({ ...sample, x: 30 }, 0.1)).toBeNull(); // too soon
    expect(th.offer({ ...sample, x: 30, speed: 1 }, 0.6)).toEqual({ x: 30 }); // speed in its dead band
    expect(th.offer({ ...sample, x: 30.5 }, 1.2)).toBeNull();
  });

  it('sends an event at once, and a heartbeat when nothing moves', () => {
    const th = new TelemetryThrottle();
    th.offer(sample, 0);
    expect(th.offer({ ...sample, event: 'collision' }, 0.05)).toEqual({ event: 'collision' });
    expect(th.offer({ ...sample, event: 'collision' }, 40)).toEqual({ ...sample, event: 'collision' });
  });
});

describe('palette (#79)', () => {
  it('reads iX token values', () => {
    expect(parseCssColor('#00bde3')).toBe(CLASSIC_DARK.primary);
    expect(parseCssColor(' rgba(255, 36, 83, 0.9)')).toBe(CLASSIC_DARK.alarm);
    expect(parseCssColor('#fff')).toBe(0xffffff);
    expect(parseCssColor('var(--x)')).toBeNull();
    expect(mix(0x000000, 0xffffff, 0.5)).toBe(0x808080);
  });
});

describe('vehicles and profile (#79)', () => {
  it('offers four vehicles with distinct performance', async () => {
    const { VEHICLES, vehicleById } = await import('./vehicles.js');
    expect(VEHICLES.map((v) => v.id)).toEqual(['coupe', 'limousine', 'pickup', 'van']);
    expect(vehicleById('limousine').spec.radius).toBeGreaterThan(vehicleById('coupe').spec.radius);
    expect(vehicleById('nope').id).toBe('coupe');
    const fast = drive(GO, 20, newCar(0, 0));
    expect(forwardSpeed(fast)).toBeGreaterThan(0);
    let van = newCar(0, 0);
    for (let k = 0; k < 20 * 60; k++) van = stepCar(van, GO, 1 / 60, vehicleById('van').spec);
    expect(forwardSpeed(van)).toBeLessThanOrEqual(vehicleById('van').spec.maxSpeed);
  });

  it('repairs a stored profile and cleans the nickname', async () => {
    const { parseProfile, cleanNickname, NICKNAME_MAX } = await import('./vehicles.js');
    expect(parseProfile({ nickname: '  Aurel ', vehicle: 'limousine', color: 'alarm' })).toEqual({ nickname: 'Aurel', vehicle: 'limousine', color: 'alarm', time: 'night', mode: 'logos' });
    expect(parseProfile({ vehicle: 'tank', color: 'pink' })).toEqual({ nickname: '', vehicle: 'coupe', color: 'primary', time: 'night', mode: 'logos' });
    expect(parseProfile({ mode: 'missions' }).mode).toBe('missions');
    expect(parseProfile({ time: 'day' }).time).toBe('day');
    expect(parseProfile(null).vehicle).toBe('coupe');
    expect(cleanNickname('a\u0000b'.padEnd(40, 'x'))).toHaveLength(NICKNAME_MAX);
  });
});

describe('dp link helpers (#79)', () => {
  it('names the player datapoint and maps telemetry to its elements', async () => {
    const { playerDp, normDpe, telemetryWrite } = await import('./dp-link.js');
    expect(playerDp('Jean Dupont')).toBe('CityDrive_Player_Jean_Dupont');
    expect(playerDp('  ')).toBe('CityDrive_Player_guest');
    expect(normDpe('System1:Line1.State.')).toBe('Line1.State');
    expect(normDpe('System1:A.b:_original.._value')).toBe('A.b');
    // dpConnect hands the names back with the config attribute: the cause of the empty player list
    expect(normDpe('System1:CityDrive_Player_a_x1.pos.x:_online.._value')).toBe('CityDrive_Player_a_x1.pos.x');
    expect(normDpe('CityDrive_Player_a.score:_online.._value')).toBe('CityDrive_Player_a.score');
    // one datapoint per session: two windows of one user never share it
    expect(playerDp('root', 'k3f9a')).toBe('CityDrive_Player_root_k3f9a');
    expect(playerDp('root', 'b2')).not.toBe(playerDp('root', 'k3f9a'));
    expect(telemetryWrite('P', { x: 1, speed: 50, nickname: 'Aurel' })).toEqual({ dpeNames: ['P.pos.x', 'P.speed', 'P.nickname'], values: [1, 50, 'Aurel'] });
  });
});

describe('logo hunt (#79)', () => {
  it('lays the tokens on the roads, apart, out of the crossroads', async () => {
    const { placeTokens, TOKENS_PER_WAVE } = await import('./collectibles.js');
    const city = generateCity(7);
    const tokens = placeTokens(city, TOKENS_PER_WAVE, 3);
    expect(tokens).toHaveLength(TOKENS_PER_WAVE);
    for (const t of tokens) {
      expect(onRoad(city, t.x, t.z)).toBe(true);
      for (const o of tokens) if (o !== t) expect(Math.hypot(o.x - t.x, o.z - t.z)).toBeGreaterThanOrEqual(30);
    }
  });

  it('scores a token once, chains a combo within the window, resets it after', async () => {
    const { LogoHunt, TOKEN_POINTS } = await import('./collectibles.js');
    const hunt = new LogoHunt(generateCity(7));
    const [a, b, c] = hunt.tokens;
    expect(hunt.step(a.x, a.z, 10).points).toBe(TOKEN_POINTS);
    expect(hunt.step(a.x, a.z, 10.5).pickups).toHaveLength(0); // taken already
    const second = hunt.step(b.x, b.z, 13);
    expect(second.pickups[0].combo).toBe(2);
    expect(second.points).toBe(2 * TOKEN_POINTS);
    expect(hunt.step(c.x, c.z, 30).pickups[0].combo).toBe(1); // window over
    expect(hunt.comboAt(100)).toBe(1);
  });

  it('a cleared wave adds its bonus and lays a new wave', async () => {
    const { LogoHunt, TOKENS_PER_WAVE, WAVE_BONUS } = await import('./collectibles.js');
    const hunt = new LogoHunt(generateCity(7));
    let last = { waveDone: false, points: 0 };
    hunt.tokens.forEach((t, k) => (last = hunt.step(t.x, t.z, k * 100)));
    expect(last.waveDone).toBe(true);
    expect(last.points).toBeGreaterThanOrEqual(WAVE_BONUS);
    expect(hunt.wave).toBe(2);
    expect(hunt.left).toBe(TOKENS_PER_WAVE);
    expect(hunt.collected).toBe(TOKENS_PER_WAVE);
  });
});

describe('on foot (#79)', () => {
  it('steps out by the driver door, walks, runs, and gets back in only when close', async () => {
    const { leaveCar, stepWalker, canEnter, RUN_SPEED } = await import('./walker.js');
    const car = newCar(100, 100, 0);
    const w0 = leaveCar(car, 1);
    expect(w0.x).toBeGreaterThan(car.x); // facing +Z, the driver's left is +X
    const bounds = { x0: -1000, z0: -1000, x1: 1000, z1: 1000 };
    let w = w0;
    for (let k = 0; k < 120; k++) w = stepWalker(w, { move: 1, turn: 0, run: true }, 1 / 60, [], bounds);
    expect(w.speed).toBeCloseTo(RUN_SPEED, 1);
    expect(w.z).toBeGreaterThan(w0.z + 8);
    expect(canEnter(w, car)).toBe(false);
    expect(canEnter(w0, car)).toBe(true);
  });

  it('walls stop the walker', async () => {
    const { stepWalker, WALKER_RADIUS } = await import('./walker.js');
    let w = { x: 0, z: -2, heading: 0, speed: 0, phase: 0 };
    for (let k = 0; k < 300; k++) w = stepWalker(w, { move: 1, turn: 0, run: false }, 1 / 60, [{ x0: -5, z0: 0, x1: 5, z1: 10 }], { x0: -99, z0: -99, x1: 99, z1: 99 });
    expect(w.z).toBeLessThanOrEqual(-WALKER_RADIUS + 1e-6);
  });
});

describe('settings and gamepad (#79)', () => {
  it('repairs stored settings and rebinds a key, removing it from another action', async () => {
    const { parseSettings, rebind, actionOf, keyLabel, DEFAULT_SETTINGS } = await import('./settings.js');
    const st = parseSettings({ steering: 9, quality: 'low', keys: { up: ['KeyI', 42], brake: [] }, gamepad: { deadzone: -1 } });
    expect(st.steering).toBe(1.5);
    expect(st.quality).toBe('low');
    expect(st.keys.up).toEqual(['KeyI']);
    expect(st.keys.brake).toEqual(DEFAULT_SETTINGS.keys.brake);
    expect(st.gamepad.deadzone).toBe(0);
    const re = rebind(DEFAULT_SETTINGS, 'camera', 'KeyF');
    expect(actionOf(re, 'KeyF')).toBe('camera');
    expect(re.keys.foot).not.toContain('KeyF');
    expect(re.keys.foot.length).toBeGreaterThan(0);
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('ArrowUp')).toBe('↑');
  });

  it('reads a standard gamepad: triggers, stick with dead zone, button edges', async () => {
    const { readPad, DEFAULT_SETTINGS, deadzone } = await import('./settings.js');
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
    buttons[7] = { pressed: true, value: 0.8 }; // RT
    buttons[1] = { pressed: true, value: 1 }; // B
    const prev: boolean[] = [];
    const a = readPad({ axes: [0.1, -0.6], buttons }, DEFAULT_SETTINGS, prev);
    expect(a.throttle).toBe(0.8);
    expect(a.steer).toBe(0); // inside the dead zone
    expect(a.move).toBeCloseTo(-deadzone(-0.6, 0.15), 6);
    expect(a.pressed).toEqual(['foot']);
    expect(readPad({ axes: [1, 0], buttons }, DEFAULT_SETTINGS, prev).pressed).toEqual([]); // held: no new edge
    expect(readPad({ axes: [1, 0], buttons }, { ...DEFAULT_SETTINGS, gamepad: { ...DEFAULT_SETTINGS.gamepad, invertSteer: true } }, prev).steer).toBe(-1);
  });
});

describe('local multiplayer (#83)', () => {
  it('seats devices in order, once each, and frees them on leave or unplug', async () => {
    const { JoinSlots, padDevice } = await import('./local-play.js');
    const slots = new JoinSlots(2);
    expect(slots.ready).toBe(false);
    expect(slots.join(padDevice(1))).toBe(0);
    expect(slots.join(padDevice(1))).toBe(-1); // already seated
    expect(slots.join('keyboard')).toBe(1);
    expect(slots.ready).toBe(true);
    expect(slots.join(padDevice(0))).toBe(-1); // full
    expect(slots.drop(padDevice(1))).toBe(0);
    expect(slots.join(padDevice(0))).toBe(0); // the next pad takes the free seat
    expect(slots.resize(1).devices).toEqual([padDevice(0)]);
    expect(new JoinSlots(9).count).toBe(2); // capped
  });

  it('runs a match: countdown, clock, end; ranks by score then logos, ties share a rank', async () => {
    const { Match, standings, clock, COUNTDOWN_S } = await import('./local-play.js');
    const m = new Match(120);
    expect(m.live).toBe(false);
    expect(m.step(COUNTDOWN_S)).toBe('running');
    expect(m.remaining).toBe(120);
    expect(m.step(60)).toBeNull();
    expect(clock(m.remaining)).toBe('1:00');
    expect(m.step(61)).toBe('over');
    expect(m.step(1)).toBeNull();
    const r = standings([{ score: 300, logos: 3 }, { score: 500, logos: 4 }, { score: 300, logos: 3 }]);
    expect(r.map((x) => [x.player, x.rank])).toEqual([[1, 1], [0, 2], [2, 2]]);
  });

  it('shares the logos but keeps a combo per player', async () => {
    const { LogoHunt, newHunter, TOKEN_POINTS } = await import('./collectibles.js');
    const hunt = new LogoHunt(generateCity(7));
    const a = newHunter();
    const b = newHunter();
    const [t1, t2, t3] = hunt.tokens;
    hunt.step(t1.x, t1.z, 10, a);
    expect(hunt.step(t2.x, t2.z, 11, b).points).toBe(TOKEN_POINTS); // b starts its own combo
    expect(hunt.step(t3.x, t3.z, 12, a).points).toBe(2 * TOKEN_POINTS); // a chains
    expect(hunt.step(t1.x, t1.z, 12, b).pickups).toHaveLength(0); // taken by a
    expect([a.logos, b.logos]).toEqual([2, 1]);
    const firstIds = hunt.tokens.map((t) => t.id);
    hunt.reset(5);
    expect(hunt.tokens.some((t) => firstIds.includes(t.id))).toBe(false); // new ids after a reset
  });
});

describe('tension (#85)', () => {
  it('heat raises the alert level, cools only when unseen and after a while, drops a level, clears', async () => {
    const { Heat, LEVEL_HEAT, COOL_AFTER_S } = await import('./tension.js');
    const h = new Heat();
    h.offence('red-light', 0);
    expect(h.level).toBe(1);
    h.offence('ram-security', 1);
    h.offence('crash', 1);
    expect(h.level).toBe(2);
    h.step(5, 5, false);
    expect(h.level).toBe(2); // too soon to cool
    h.step(50, 1 + COOL_AFTER_S + 1, true);
    expect(h.level).toBe(2); // seen: no cooling
    h.step(1, 1 + COOL_AFTER_S + 1, false);
    expect(h.heat).toBeLessThan(45);
    h.heat = LEVEL_HEAT[2] + 5;
    h.dropLevel();
    expect(h.level).toBe(2);
    h.clear();
    expect(h.level).toBe(0);
  });

  it('a car entering a crossroads on red ran the light; on green, or crawling, it did not', async () => {
    const { ranRedLight } = await import('./tension.js');
    // crossroads (2, 2) forced red: entering it along Z at speed
    const allRed = { allRed: new Set(['2-2']) };
    const prev = { x: 2 * CELL - 4, z: 2 * CELL - ROAD_WIDTH / 2 - 1 };
    const now = { ...newCar(2 * CELL - 4, 2 * CELL - ROAD_WIDTH / 2 + 1, 0), vz: 15 };
    expect(ranRedLight(prev, now, 0, 6, allRed)).toEqual({ i: 2, j: 2 });
    expect(ranRedLight(prev, { ...now, vz: 1 }, 0, 6, allRed)).toBeNull();
    expect(ranRedLight(now, now, 0, 6, allRed)).toBeNull(); // already inside
  });

  it('speed cameras flash over the limit, once per pass, and fine by the excess', async () => {
    const { placeCameras, flashedBy, fineOf } = await import('./tension.js');
    const cams = placeCameras(generateCity(7), 6);
    expect(cams.length).toBe(6);
    const c = cams[0];
    const last = new Map<number, number>();
    expect(flashedBy(cams, c.x, c.z, c.limit - 1, 0, last)).toBeNull();
    expect(flashedBy(cams, c.x, c.z, c.limit + 30, 0, last)?.id).toBe(c.id);
    expect(flashedBy(cams, c.x, c.z, c.limit + 30, 1, last)).toBeNull(); // same pass
    expect(fineOf(100, 70)).toBe(200);
  });

  it('damage grows with hard hits only and lowers the top speed', async () => {
    const { applyImpact, damagedSpec } = await import('./tension.js');
    expect(applyImpact(0, 2)).toBe(0);
    const d = applyImpact(0, 40);
    expect(d).toBeGreaterThan(0.4);
    expect(applyImpact(0.99, 80)).toBe(1);
    expect(damagedSpec(CAR, 1).maxSpeed).toBeCloseTo(CAR.maxSpeed * 0.65, 5);
    expect(damagedSpec(CAR, 0)).toBe(CAR);
  });

  it('a chaser steers towards a point ahead of its target, and backs up when stuck', async () => {
    const { chaserInput, chasersFor } = await import('./tension.js');
    const chaser = { car: newCar(0, 0, 0), target: 0, stuck: 0, reversing: 0 };
    // target ahead and to the right (-X when facing +Z): steer right (> 0)
    expect(chaserInput(chaser, { ...newCar(-30, 30, 0), vx: 0, vz: 0 }, 0.1).steer).toBeGreaterThan(0);
    expect(chaserInput(chaser, newCar(0, 50, 0), 0.1).throttle).toBe(1);
    for (let k = 0; k < 20; k++) chaserInput(chaser, newCar(0, 50, 0), 0.1);
    expect(chaserInput(chaser, newCar(0, 50, 0), 0.1).throttle).toBe(-1);
    expect([0, 1, 2, 3, 5, 9].map(chasersFor)).toEqual([0, 0, 1, 2, 4, 4]);
  });
});

describe('tension telemetry (#85)', () => {
  const base = { x: 0, z: 0, heading: 0, speed: 0, fuel: 100, score: 0, mission: '', event: '', nickname: 'A', vehicle: 'coupe', color: 'primary', alert: 0, wanted: false, damage: 0, ticket: '', fines: 0 };

  it('holds the tension elements back while the deployed type lacks them', async () => {
    const { TENSION_FIELDS, writableFields } = await import('./dp-link.js');
    expect(writableFields({ x: 3, wanted: true, fines: 2 }, false)).toEqual({ x: 3 });
    expect(writableFields({ x: 3, wanted: true }, true)).toEqual({ x: 3, wanted: true });
    expect(TENSION_FIELDS).toContain('wanted');
  });

  it('sends a change of the alert at once, between two samples', () => {
    const th = new TelemetryThrottle();
    th.offer(base, 0);
    expect(th.offer({ ...base, wanted: true, alert: 2 }, 0.05)).toEqual({ wanted: true, alert: 2 });
  });
});

describe('empty tank', () => {
  it('crawls to the station instead of staying stuck', () => {
    let car = { ...newCar(0, 0, 0), fuel: 0 };
    for (let k = 0; k < 200; k++) car = stepCar(car, { throttle: 1, steer: 0, handbrake: false }, 0.05);
    const v = forwardSpeed(car);
    expect(v).toBeGreaterThan(4);
    expect(v).toBeLessThanOrEqual(CAR.emptySpeed + 1e-9);
  });
});

describe('logo leaderboard', () => {
  const r = (id: string, nickname: string, logos: number, email = '', score = logos * 100): GameResult => ({ id, nickname, email, logos, score, at: `2026-11-18T09:${id.padStart(2, '0')}:00Z`, duration: 60 });

  it('ranks each person once, by their best logos, without the emails', () => {
    const log = [r('1', 'Léa', 8, 'lea@x.com'), r('2', 'Léa', 12, 'LEA@x.com'), r('3', 'Max', 12, '', 1300), r('4', 'Tom', 3)];
    const board = leaderboard(log);
    expect(board.map((b) => [b.rank, b.nickname, b.logos])).toEqual([
      [1, 'Max', 12],
      [2, 'Léa', 12],
      [3, 'Tom', 3]
    ]);
    expect(JSON.stringify(board)).not.toContain('@');
  });

  it('shows the players of the match even below the top', () => {
    const log = Array.from({ length: 12 }, (_, k) => r(String(k + 1), `P${k + 1}`, 20 - k));
    const board = leaderboard(log, new Set(['12']), 10);
    expect(board).toHaveLength(11);
    expect(board[10]).toMatchObject({ rank: 12, nickname: 'P12', mine: true });
  });

  it('keeps the log bounded and accepts an empty email', () => {
    expect(addResults([r('1', 'a', 1)], [r('2', 'b', 2), r('3', 'c', 3)], 2).map((x) => x.id)).toEqual(['2', '3']);
    expect(validEmail('')).toBe(true);
    expect(validEmail('aurel@visuel.fr')).toBe(true);
    expect(validEmail('aurel@')).toBe(false);
  });
});

describe('ranking size', () => {
  it('counts each person once and says 1st, 2nd, 3rd, 11th', async () => {
    const { playerCount, ordinal } = await import('./results.js');
    const r = (id: string, nickname: string, email = ''): GameResult => ({ id, nickname, email, logos: 1, score: 1, at: '', duration: 60 });
    expect(playerCount([r('1', 'Léa', 'l@x.io'), r('2', 'Lea', 'L@X.io'), r('3', 'Max'), r('4', 'max')])).toBe(2);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
  });
});
