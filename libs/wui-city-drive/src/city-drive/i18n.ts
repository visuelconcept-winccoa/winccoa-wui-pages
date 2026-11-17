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
    keys: 'W/Z ↑ throttle · S ↓ brake · A/Q ← D → steer · Space handbrake · C camera · T day / night · R reset · N mission · Esc pause',
    day: 'Day',
    night: 'Night',
    time: 'Time of day',
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
    empty: 'Out of fuel: the fuel station is in the north-east corner of the map'
  },
  machine: {
    run: 'running',
    stop: 'stopped',
    fault: 'fault',
    unknown: 'not bound'
  }
} as const;

