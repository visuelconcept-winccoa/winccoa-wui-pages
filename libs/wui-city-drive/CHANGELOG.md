<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-city-drive

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
