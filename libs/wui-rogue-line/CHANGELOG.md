<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-rogue-line

## 0.1.0 — 2026-11-22

- First version: an original retro first-person maintenance game, route `/rogue-line`. No
  weapons, nothing to fight: a technician repairs a plant that is down. Its own raycaster on a
  canvas (320 × 200, hard pixels): sliding doors, floors and ceilings, an open yard under a smoky
  dusk sky, lamps lighting their room, red beacons flickering, coolant glowing, distance fog.
  Textures, sprites and sounds are generated at start-up: no asset file.
- Machines: 6-axis robots, CNC lathes, CNC machining centres, a hydraulic press, a conveyor, with
  their stack lights. Each fault takes its tool, held on the machine for a few seconds: wrench
  and a spare part (mechanical), multimeter (electrical), WinCC OA laptop (software). The exit
  opens once the line runs again.
- Three levels with key cards and doors, AGVs shuttling along their lanes (a bump costs points),
  coolant that slows down, a minimap and a full map.
- Robot cells fenced all round: see-through safety fences (the raycaster keeps a depth per
  pixel), entered through a gate that slides open.
- Industrial decor: stacks of pallets, yellow safety lines
  along the walls, hazard borders around the machines, storage outlines under the pallets.
- The plant: the machines follow datapoints (`RogueLine_Config`); demo plant without a backend.
- WinCC OA in the plant: an alarm list as WinCC OA shows it (CAME / WENT rows with the time of
  day, open alarms, a gong), live WinCC OA screens on the walls with the machines' states and the
  line's trend, the WinCC OA title bar on the computer banks, the logo painted on the floor.
- WinCC OA and Visuel Concept logos on the plant's walls, the Visuel Concept plate on the
  machines, the WinCC OA cube in the status bar; the end card "You just played on WinCC OA."
- Ranking by nickname (`RogueLine_Results`), difficulty, pause settings (mouse, turn speed,
  volume), keyboard, mouse (pointer lock), USB gamepad and touch screens (a joystick that walks
  and turns, REPAIR / USE / tool / map / pause buttons, in their own strips beside or below the
  view). Roles `play` and `configure`.
