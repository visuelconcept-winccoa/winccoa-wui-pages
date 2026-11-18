// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** Strings of City Drive. The game is in English only (#79). */

export const MSG = {
  title: 'City Drive',
  banner: {
    kicker: 'WINCC OA',
    title: 'Multiplayer City Game',
    tagline: 'City Drive · every car, every machine, live on its datapoint'
  },
  hud: {
    speed: 'km/h',
    fuel: 'Fuel',
    score: 'Score',
    noMission: 'No mission',
    newMission: 'New mission',
    pause: 'Pause',
    resume: 'Resume',
    camera: 'Camera',
    reset: 'Back on the road',
    paused: 'Paused',
    clickToPlay: 'Click the city to drive',
    keys: 'W/Z ↑ throttle · S ↓ brake · A/Q ← D → steer · Space handbrake · E throw a cube · F get out / in (Shift: run) · C camera · T day / night · R reset · N mission · Esc pause',
    day: 'Day',
    night: 'Night',
    time: 'Time of day',
    mode: 'Game mode',
    logos: 'Logo hunt',
    missions: 'Missions',
    logosHint: 'Drive through the WinCC OA logos floating over the roads: each one blows up and scores — or throw a cube at them (E, pad X). Chain them for a combo.',
    throwHint: 'E · pad X: throw',
    missionsHint: 'Deliver parcels against the clock, and rush to the plant when a machine breaks down.',
    logosLeft: 'logos left',
    wave: 'Wave',
    exitCar: 'Get out',
    enterCar: 'Get in',
    telemetry: 'Telemetry',
    noTelemetry: 'Telemetry off',
    roleForbidden: 'Your groups do not hold the “Play” role of this page.'
  },
  mission: {
    delivery: 'Delivery',
    intervention: 'Intervention',
    pickup: 'Pick up the parcel',
    drop: 'Deliver the parcel',
    reach: 'Reach the machine in fault',
    done: 'Mission complete',
    failed: 'Mission failed'
  },
  event: {
    collision: 'Crash!',
    pickup: 'Parcel on board',
    'mission-done': 'Mission complete',
    'mission-failed': 'Mission failed',
    refuel: 'Tank full',
    empty: 'Out of fuel: the fuel station is in the north-east corner of the map',
    'wave-done': 'Wave cleared! Bonus',
    'on-foot': 'On foot: F to get back in',
    'in-car': 'Back behind the wheel',
    'too-far': 'Walk back to your car to get in',
    'red-light': 'Red light! Alert level up',
    'speed-camera': 'Flashed by a speed camera',
    'ram-security': 'You rammed a security car!',
    chase: 'Security is on your tail: lose them, or get a respray at the station',
    escaped: 'You lost them',
    caught: 'Stopped by security: −20 % score',
    respray: 'Fresh respray: alert cleared',
    repaired: 'Car repaired',
    acknowledged: 'The control room acknowledged your alert: level cleared',
    smash: 'Smash! Alert level up'
  },
  tension: {
    alert: 'Alert level',
    damage: 'Damage',
    pullOver: 'Pull over!',
    fine: 'Fine'
  },
  machine: {
    run: 'running',
    stop: 'stopped',
    fault: 'fault',
    unknown: 'not bound'
  }
} as const;

