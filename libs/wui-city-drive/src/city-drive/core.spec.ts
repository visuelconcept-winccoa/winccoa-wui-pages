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
  it('offers the vehicles with distinct performance', async () => {
    const { VEHICLES, vehicleById } = await import('./vehicles.js');
    expect(VEHICLES.map((v) => v.id)).toEqual(['coupe', 'roadster', 'muscle', 'limousine', 'estate', 'cab', 'pickup', 'van']);
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
    expect(parseProfile({ nickname: '  Aurel ', vehicle: 'limousine', color: 'alarm' })).toEqual({ nickname: 'Aurel', vehicle: 'limousine', color: 'alarm', paint: 'midnight', wheels: 'stock', driver: 'man', skin: 0, time: 'night', mode: 'logos' });
    expect(parseProfile({ vehicle: 'tank', color: 'pink' })).toEqual({ nickname: '', vehicle: 'coupe', color: 'primary', paint: 'midnight', wheels: 'stock', driver: 'man', skin: 0, time: 'night', mode: 'logos' });
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

describe('figure and thrown cubes (#89)', () => {
  it('walks with opposite legs and arms, runs with wider strides and bent elbows', async () => {
    const { gaitPose } = await import('./figure.js');
    const walk = gaitPose(0.05, 1.8); // the left heel strikes: left thigh forward, right one back
    expect(walk.hipL).toBeGreaterThan(0.3);
    expect(walk.hipR).toBeLessThan(0);
    expect(walk.shoulderL).toBeLessThan(0); // the left arm back while the left leg is forward
    expect(walk.shoulderR).toBeGreaterThan(0);
    expect(Math.abs(walk.shoulderL)).not.toBeCloseTo(Math.abs(walk.shoulderR), 2); // not mirror images
    const swing = gaitPose(Math.PI * 2 * 0.73, 1.8); // the left leg in mid-swing: its knee folds
    expect(swing.kneeL).toBeGreaterThan(0.8);
    expect(swing.kneeR).toBeLessThan(0.4);
    const run = gaitPose(0.05, 6);
    expect(run.hipL).toBeGreaterThan(walk.hipL * 1.6);
    expect(run.elbowL).toBeGreaterThan(1.2);
    expect(run.lean).toBeGreaterThan(walk.lean);
    const still = gaitPose(1, 0);
    expect(Math.abs(still.hipL) + Math.abs(still.kneeL)).toBeLessThan(0.01);
  });

  it('winds the arm back, then whips it forward to throw', async () => {
    const { gaitPose, throwPose, THROW_RELEASE_AT, THROW_DURATION } = await import('./figure.js');
    const base = gaitPose(0, 0);
    const back = throwPose(base, 0.15);
    expect(back.shoulderR).toBeGreaterThan(2);
    expect(back.elbowR).toBeGreaterThan(1.3);
    expect(throwPose(base, THROW_RELEASE_AT + 0.05).shoulderR).toBeLessThan(back.shoulderR);
    expect(throwPose(base, THROW_DURATION).shoulderR).toBeCloseTo(base.shoulderR, 2);
  });

  it('throws by hand or from the car, and a cube sticks to a wall then blows up', async () => {
    const { throwByHand, throwFromCar, stepCube, canThrow, CAR_SPEED, CAR_COOLDOWN_S } = await import('./cubes.js');
    const { THROW_DURATION } = await import('./figure.js');
    expect(canThrow(null, 5, true)).toBe(true);
    expect(canThrow(5, 5 + THROW_DURATION - 0.01, true)).toBe(false);
    expect(canThrow(5, 5 + CAR_COOLDOWN_S, false)).toBe(true);
    // from a car at 20 m/s along +Z: ahead of it, faster than it
    const fromCar = throwFromCar(0, 0, 0, 0, 20, 2, 0, 0.8);
    expect(fromCar.z).toBeCloseTo(2.4);
    expect(fromCar.vz).toBe(20 + CAR_SPEED);
    let b = throwByHand(0, 0, 0, 0, 0.8);
    const wall = { x0: -5, x1: 5, z0: 10, z1: 12 };
    let blew = -1;
    for (let k = 0; k < 200 && blew < 0; k++) {
      const s = stepCube(b, 0.02, [wall]);
      b = s.cube;
      if (s.blows) blew = k;
    }
    // it stuck on the wall face, stayed there ~1 s, then blew up
    expect(b.z).toBeLessThan(10.5);
    expect(b.z).toBeGreaterThan(8);
    expect(b.fuse).not.toBeNull();
    expect(blew * 0.02).toBeGreaterThan(1);
    expect(blew * 0.02).toBeLessThan(1.6);
  });

  it('dresses the city in the Sunset Neon theme, keeping the colours of the states', async () => {
    const { themePalette, themeSky, CLASSIC_DARK } = await import('./palette.js');
    const { parseSettings } = await import('./settings.js');
    expect(themePalette(CLASSIC_DARK, 'classic')).toBe(CLASSIC_DARK);
    const sunset = themePalette(CLASSIC_DARK, 'sunset');
    expect(sunset.primary).not.toBe(CLASSIC_DARK.primary);
    expect(sunset.night).not.toBe(CLASSIC_DARK.night);
    // a machine running stays green, in fault red
    expect(sunset.success).toBe(CLASSIC_DARK.success);
    expect(sunset.alarm).toBe(CLASSIC_DARK.alarm);
    expect(themeSky('classic', false)).toBeNull();
    expect(themeSky('sunset', false)?.stops.length).toBeGreaterThan(2);
    expect(parseSettings({}).theme).toBe('classic');
    expect(parseSettings({ theme: 'sunset' }).theme).toBe('sunset');
    expect(parseSettings({ theme: 'other' }).theme).toBe('classic');
  });

  it('keeps the cube size setting within bounds, in whole cm', async () => {
    const { parseSettings, CUBE_CM_MIN, CUBE_CM_MAX } = await import('./settings.js');
    expect(parseSettings({}).cubeSizeCm).toBe(80);
    expect(parseSettings({ cubeSizeCm: 999 }).cubeSizeCm).toBe(CUBE_CM_MAX);
    expect(parseSettings({ cubeSizeCm: 1 }).cubeSizeCm).toBe(CUBE_CM_MIN);
    expect(parseSettings({ cubeSizeCm: 42.6 }).cubeSizeCm).toBe(43);
  });
});

describe('garage', () => {
  it('has eight models with distinct names, and repairs an old or bad profile', async () => {
    const { VEHICLES, parseProfile, cycle, WHEELS } = await import('./vehicles.js');
    expect(VEHICLES).toHaveLength(8);
    expect(new Set(VEHICLES.map((v) => v.label)).size).toBe(8);
    // a 0.7 profile: no paint, wheels, skin
    expect(parseProfile({ nickname: 'A', vehicle: 'van', color: 'alarm' })).toMatchObject({ vehicle: 'van', paint: 'midnight', wheels: 'stock', skin: 0 });
    expect(parseProfile({ vehicle: 'roadster', paint: 'ruby', wheels: 'monster', skin: 9 })).toMatchObject({ vehicle: 'roadster', paint: 'ruby', wheels: 'monster', skin: 0 });
    // the driver: a man or a woman, a man by default
    expect(parseProfile({ driver: 'woman' }).driver).toBe('woman');
    expect(parseProfile({ driver: 'robot' }).driver).toBe('man');
    expect(cycle(['a', 'b', 'c'], 'a', -1)).toBe('c');
    expect(WHEELS.map((w) => w.scale)).toEqual([0.85, 1, 1.2, 1.5]);
  });

  it('reads a pad direction from the D-pad or the stick', async () => {
    const { padDirection } = await import('./settings.js');
    const pad = (axes: number[], pressed: number[] = []) => ({ axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: 0 })) });
    expect(padDirection(pad([0, 0], [15]))).toBe('right');
    expect(padDirection(pad([0, -0.9]))).toBe('up');
    expect(padDirection(pad([0.3, 0.2]))).toBeNull();
  });
});

describe('photo booth', () => {
  it('picks its source from the setting and the cameras of Camera Streams', async () => {
    const { boothSource, parseBoothCamera } = await import('./photo-booth.js');
    const cams = [parseBoothCamera('desk', '{"name":"Desk","kind":"local","localResolution":"1280x720"}'), parseBoothCamera('gate', '{"name":"Gate","url":"rtsp://x"}')].filter((c) => c !== null);
    expect(boothSource('', cams)).toEqual({ kind: 'off' });
    expect(boothSource('webcam', cams)).toEqual({ kind: 'webcam' });
    expect(boothSource('desk', cams)).toEqual({ kind: 'local', id: 'desk', width: 1280, height: 720 });
    expect(boothSource('gate', cams)).toEqual({ kind: 'rtsp', id: 'gate' });
    expect(boothSource('gone', cams)).toEqual({ kind: 'off' }); // a camera deleted since
    expect(parseBoothCamera('x', 'not json')).toBeNull();
  });
});

describe('audit trail (#93)', () => {
  const players = [
    { nickname: 'Aurel', vehicle: 'Neon Specter', device: 'keyboard', email: true },
    { nickname: '', vehicle: 'Kitsune GT', device: 'pad:0', email: false }
  ];

  it('records a game start without any email', async () => {
    const a = await import('./audit.js');
    const r = a.gameStart(players, 60, 'logos', 'taken');
    expect(r).toMatchObject({ action: 'GAME_START', item: 'Aurel · Player 2', reason: 'Match of 1 min' });
    expect(r.newval).toContain('"email":true');
    expect(r.newval).not.toContain('@');
  });

  it('records the ranking at the end, and only the settings that changed', async () => {
    const a = await import('./audit.js');
    const { DEFAULT_SETTINGS } = await import('./settings.js');
    const end = a.gameEnd(players, [{ player: 1, score: 900, logos: 7, rank: 1 }, { player: 0, score: 500, logos: 4, rank: 2 }], 120);
    expect(JSON.parse(end.newval ?? '[]')[0]).toEqual({ rank: 1, nickname: 'Player 2', score: 900, logos: 7 });
    expect(a.settingsUpdate(DEFAULT_SETTINGS, DEFAULT_SETTINGS)).toBeNull();
    const ch = a.settingsUpdate(DEFAULT_SETTINGS, { ...DEFAULT_SETTINGS, photoBooth: 'webcam', cameraHeight: 1.5 });
    expect(ch).toMatchObject({ action: 'SETTINGS_UPDATE', reason: 'cameraHeight, photoBooth' });
    expect(JSON.parse(ch?.newval ?? '{}')).toEqual({ cameraHeight: 1.5, photoBooth: 'webcam' });
  });
});

describe('admin statistics (#94)', () => {
  const r = (id: string, at: string, nickname: string, logos: number, email = ''): GameResult => ({ id, nickname, email, logos, score: logos * 100, at, duration: 60 });
  const log = [
    r('1', '2026-11-18T09:05:00', 'Léa', 12, 'lea@x.io'),
    r('2', '2026-11-18T09:05:00', 'Max', 4),
    r('3', '2026-11-18T10:30:00', 'Léa', 15, 'LEA@x.io'),
    r('4', '2026-11-19T14:00:00', 'Tom', 22, 'tom@x.io')
  ];

  it('counts matches by their end time, people, emails, logos', async () => {
    const { gameStats } = await import('./stats.js');
    const s = gameStats(log);
    expect(s).toMatchObject({ matches: 3, duo: 1, players: 3, withEmail: 3, emails: 2, logos: 53, bestLogos: 22, avgLogos: 13.3 });
    expect(s.byHour[9]).toBe(1);
    expect(s.byDay).toEqual([
      { day: '2026-11-18', matches: 2 },
      { day: '2026-11-19', matches: 1 }
    ]);
    expect(s.logoBands.map((b) => b.count)).toEqual([1, 0, 1, 1, 1]); // 4 · 12 · 15 · 22
  });

  it('exports CSV with the emails, no formula injection', async () => {
    const { resultsCsv } = await import('./stats.js');
    const csv = resultsCsv([...log, r('5', '2026-11-19T15:00:00', '=HYPERLINK("x")', 1)]);
    expect(csv.split('\r\n')[0]).toBe('﻿date;nickname;email;logos;score;match_s');
    expect(csv).toContain('lea@x.io');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});

describe('atmosphere (#95)', () => {
  it('turns a DPE value into a weather level', async () => {
    const { weatherLevel, parseWeatherBinding, gripFactor, demoWeather } = await import('./weather.js');
    expect(weatherLevel(true)).toBe(1);
    expect(weatherLevel(0.4)).toBe(0.4);
    expect(weatherLevel(60)).toBe(0.6); // a percentage
    expect(weatherLevel(5, 10)).toBe(0.5); // mm/h with rainMax 10
    expect(weatherLevel(2000, 10000, true)).toBeCloseTo(0.8); // a visibility in m
    expect(weatherLevel('n/a')).toBe(0);
    expect(parseWeatherBinding({ rain: 'Meteo.Rain', rainMax: 10 })).toMatchObject({ rain: 'Meteo.Rain', rainMax: 10 });
    expect(parseWeatherBinding({})).toBeNull();
    expect(gripFactor({ rain: 1, fog: 0 })).toBe(0.75);
    expect(demoWeather(30).rain).toBe(0);
    expect(demoWeather(150).rain).toBeGreaterThan(0.9);
  });

  it('binds the weather in the config and follows its DPEs', async () => {
    const { parseConfig, boundDpes } = await import('./bindings.js');
    const cfg = parseConfig({ machines: [], lights: [], weather: { rain: 'Meteo.Rain', fog: 'Meteo.Vis', fogInverse: true } });
    expect(boundDpes(cfg)).toEqual(['Meteo.Rain', 'Meteo.Vis']);
  });

  it('pitches the engine with the speed, gear by gear, and screeches in a slide', async () => {
    const { enginePitch, screechLevel } = await import('./audio.js');
    expect(enginePitch(0, 0)).toBe(48);
    expect(enginePitch(12, 1)).toBeGreaterThan(enginePitch(12, 0));
    expect(enginePitch(13.5, 0)).toBeLessThan(enginePitch(12.9, 0)); // a gear change drops the revs
    expect(screechLevel(1)).toBe(0);
    expect(screechLevel(20)).toBe(1);
  });
});

describe('control room map (#96)', () => {
  it('points the arrow where the car goes', async () => {
    const { arrowAngle } = await import('./control-map.js');
    // canvas rotation of the "up" arrow (0, -1): (sin a, -cos a); the map has +Z up and +X to the left
    const screen = (h: number): [number, number] => [Math.sin(arrowAngle(h)), -Math.cos(arrowAngle(h))];
    const close = (a: [number, number], b: [number, number]): void => {
      expect(a[0]).toBeCloseTo(b[0]);
      expect(a[1]).toBeCloseTo(b[1]);
    };
    close(screen(0), [0, -1]); // heading +Z: up
    close(screen(Math.PI / 2), [-1, 0]); // heading +X: left on the map
    close(screen(Math.PI), [0, 1]); // heading -Z: down
    close(screen(-Math.PI / 2), [1, 0]); // heading -X: right
  });
});

describe('players online (#97)', () => {
  it('counts a player online from its own write times, not from other players emissions', async () => {
    const { DriveLink } = await import('./dp-link.js');
    const { Subject } = await import('rxjs');
    const feed = new Subject<{ dp: string[]; value: unknown[] }>();
    const link = new DriveLink() as unknown as { api: unknown; followPlayers: (dps: string[], cb: (p: { dp: string; updatedAt: number }[]) => void, t?: boolean) => void };
    link.api = { dpConnect: () => feed };
    let seen: { dp: string; updatedAt: number }[] = [];
    const live = 'CityDrive_Player_sps_5yc0qp2';
    const stale = 'CityDrive_Player_para_5yc0qp2';
    link.followPlayers([live, stale], (p) => (seen = p), false);
    const emit = (liveX: number, liveStamp: string, staleStamp: string): void =>
      feed.next({
        dp: [`System1:${live}.pos.x:_online.._value`, `System1:${stale}.pos.x:_online.._value`, `System1:${live}.pos.x:_online.._stime`, `System1:${stale}.pos.x:_online.._stime`],
        value: [liveX, 40, liveStamp, staleStamp]
      });
    emit(10, '2026-11-18T10:00:00Z', '2026-11-17T08:00:00Z'); // dpConnect's first answer
    emit(12, '2026-11-18T10:00:01Z', '2026-11-17T08:00:00Z'); // the live player moves; the stale one comes along
    const at = (dp: string): number => seen.find((p) => p.dp === dp)?.updatedAt ?? 0;
    expect(at(live)).toBeGreaterThan(0);
    expect(at(stale)).toBe(0);
  });
});
