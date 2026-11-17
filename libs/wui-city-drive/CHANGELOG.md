<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-city-drive

## 0.3.0 — 2026-11-17

- **Logo hunt** (new default game mode; Missions stays): WinCC OA tokens float over the roads,
  each with a beam of light and a glow ring; driving or walking through one blows it up — 1000
  sparks and 140 tumbling shards in the logo colours, a shockwave, a flash, a camera shake —
  and scores 100 × combo (chain logos within 6 s, up to ×5). A cleared wave of 24 earns a
  bonus and lays a new wave. Tokens on the minimap, "+100 ×3" pop-ups.
- **On foot**: F (or the button, or B on a gamepad) to get out of the car and back in when
  close to it; walk, run with Shift; over-the-shoulder and first-person cameras. The other
  players see you as a pedestrian.
- **USB gamepad** (standard mapping): RT / LT throttle and brake, left stick steering and
  walking, A handbrake / run, B get out / in, Y camera, X mission, LB day / night, RB reset,
  Start pause.
- **Settings**: rebind every key, gamepad on / off with dead zone and inverted steering,
  steering sensitivity, chase camera distance, graphics quality (Low: no shadows), km/h or
  mph, minimap and players panel on / off. Kept in the browser.
- **Traffic signals** with real poles: on every approach, a galvanised pole on the corner, a
  mast arm with its brace over the lanes, and a horizontal Japanese-style head (green, amber,
  red from left to right) with backplate and visors; only the lamp of the phase is lit.
- **Multiplayer fixed**: the other players never showed up. `dpConnect` hands the element
  names back with `:_online.._value`, which the game did not strip, so no value of another
  player was ever recognised (the machine bindings had the same bug). Also: one player
  datapoint per session (`CityDrive_Player_<user>_<id>`), so two windows of one user, or
  people sharing an account, no longer clash; writes are queued, never dropped; a player is
  online from its first real change (heartbeat every 10 s), not from dpConnect's first answer.

## 0.2.0 — 2026-11-17

- **Day mode** next to the neon night: a sky, a warm sun casting the shadows, windows unlit, a
  light bloom, no light pools or headlight beams; the neon outlines, signs and logos stay.
  Chosen on the start screen (Night / Day), toggled in game with **T** or the sun / moon button,
  kept in the profile.
- Chase camera closer to the car (number plate readable, also at speed).

## 0.1.0 — 2026-11-16

First version (#79): see `docs/wui-city-drive/README.md`.

- Neon night city (Three.js + bloom, iX theme colours), Japanese-style streets: shops, vertical
  signboards, lanterns, vending machines, utility poles and wires, street lights, pedestrians.
- Arcade physics, four vehicles, traffic with lights, delivery and intervention missions,
  fuel and station, minimap, six camera views (chase, street level, bonnet, drone, street
  corners, map), Eisenstadt number plates, "WinCC OA Multiplayer City Game" banner.
- Datapoints: player telemetry (`CityDrive_Player_<user>`, 2 Hz), other players through their
  datapoints (multiplayer panel and cars), machine states and forced crossroads from
  `CityDrive_Config`. Demo mode without a backend.
- Roles `play` and `configure`.
