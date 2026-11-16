<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-city-drive

## 0.1.0 — 2026-11-16

First version (#79): see `docs/wui-city-drive/README.md`.

- Neon night city (Three.js + bloom, iX theme colours), Japanese-style streets: shops, vertical
  signboards, lanterns, vending machines, utility poles and wires, street lights, pedestrians.
- Arcade physics, four vehicles, traffic with lights, delivery and intervention missions,
  fuel and station, minimap, chase / top camera.
- Datapoints: player telemetry (`CityDrive_Player_<user>`, 2 Hz), other players through their
  datapoints (multiplayer panel and cars), machine states and forced crossroads from
  `CityDrive_Config`. Demo mode without a backend.
- Roles `play` and `configure`.
