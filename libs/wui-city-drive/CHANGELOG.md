<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-city-drive

## 0.9.0 — 2026-11-18

- **Garage** on the start screen, one per player card: five lines under the turntable — **Car**,
  **Wheels**, **Paint**, **Neon**, **Driver** — each with ◀ ▶. ▲ ▼ picks the line, ◀ ▶ changes
  it: the arrow keys for the keyboard player (not while typing in a field), the D-pad or the
  left stick for each gamepad on its own player's card (alone: any pad).
- **Eight cars** with original "legend" names (no real make or model): Neon Specter (finned
  coupé), Kitsune GT (roadster), Thunder Ronin (muscle car), Grand Duchess (limousine), Night
  Courier (estate), Shinjuku Cab (city taxi), Iron Mule (pickup), Hard Hat (maintenance van);
  the four new ones with their own physics. Earlier profiles keep their car.
- **Wheels**: low-profile, stock, large, monster (the body is lifted to match; looks only).
- **Paint**: nine body colours (midnight teal, piano black, pearl white, liquid chrome, ruby,
  sapphire, emerald, champagne gold, sunset orange), apart from the neon colour.
- **Driver**: the skin tone of the character on foot (light by default).
- The other players still see your car in its model and neon colour; paint and wheels are not
  sent to them yet.
- **Crossbow cubes** no longer vanish: a cube sticks where it lands (a wall, the ground, a car,
  a logo), stops spinning and pulses for 1 second, then blows up in the logo explosion; the
  blast (4 m) takes the logos and hits the cars around it.

## 0.8.0 — 2026-11-18

- **Chase camera higher by default** (2.7 m instead of 1.6 m, a little further back, aiming
  further ahead): the road shows over the car, which hid most of the view. New setting
  **Chase camera height** (low = roof level … high = looking down on the car), beside the
  distance one.
- **People that look and move like people** (#89):
  - a body turned from anatomical profiles (thighs fuller at the top, calves, a waist and a
    chest, deltoids), a face (jaw, nose, ears, eyes, brows), hands with a thumb, shoes on a
    sole, a jacket in the player's colour; build, skin and hair vary from one person to another;
  - the human walking cycle: the knee gives a little at the heel strike and folds in the swing,
    the ankle rolls from heel to toe, the pelvis turns and drops, the chest counter-rotates, the
    body sways over the standing foot, the head stays level; the arms swing against the legs
    with a lag, across the body, and not as mirror images. Running: longer strides, the trunk
    leaning, the elbows pumping. A real stride length (~1.45 m walking, up to ~3.6 m running);
  - the other players on foot walk the same way;
  - the players' own characters have a light skin tone (a choice will come with the profile);
    the passers-by and the other players' characters keep varied tones.
- **Weapons on foot**: the **WebUI hammer** (an overhead blow), the **star sword** (a wide
  slash; an original eight-ray star on the guard, a glowing blade) and the **cube crossbow**
  (it shoots spinning WinCC OA logo cubes, ~40 m/s, that stop against the walls). E strikes /
  shoots, X changes weapon (pad: X strikes on foot, D-pad changes weapon); the weapon in hand is
  shown in the HUD.
- They break the logo tokens (scored as if driven through, combo included) and the cars: a hit
  on the traffic or a security car raises the alert level, with sparks. They never touch the
  pedestrians.

## 0.7.0 — 2026-11-18

- **Start screen: the car turns on a turntable** instead of the four vehicle cards: the chosen
  vehicle (the game's own model) in the player's neon colour, on a dark plate with a neon ring;
  ◀ ▶ to change vehicle, one dot per vehicle, name and ratings over it. One turntable per
  player card (split screen: two). Each has its own small WebGL view, drawn only while the
  card is on screen and released when the game starts.

## 0.6.0 — 2026-11-18

- **Matches of 1 minute by default** (1, 2, 3 or 5 minutes, or Free drive alone). The choice is
  kept under a new browser key: the 3-minute default of 0.4 is not carried over.
- **Optional email** per player on the start screen: saved with the results, never shown;
  kept in memory only and cleared when going back to the menu (the next person at a booth
  starts empty). A malformed address blocks the start until fixed or emptied.
- **Logo ranking** after each match: the WinCC OA logos taken, one row per person (the email
  when given, else the nickname) with their best match, the top 10 plus the players of the
  match, the number of players in the ranking and each player's place ("9th of 12").
  Nicknames only. The results are appended to the datapoint `CityDrive_Results` (created
  through PARA; in memory without a backend), 1000 results at most.
- Empty tank: the car crawls (up to ~20 km/h) to the station; it had no thrust at all and
  stayed stuck.
- Podium of two players: the logos and score cells no longer stack (a style of the players
  panel applied to them).

## 0.5.0 — 2026-11-17

- **Tension** (#85): an alert level (five chevrons) raised by red lights, crashes into the
  traffic, speed cameras and ramming security cars; it cools down when nobody sees you.
- **Security cars** from level 2 (dark saloons, red / blue light bar): they cut you off and
  back up when stuck; lose them (220 m, 6 s) or get stopped (−20 % score). Red / blue edges
  while chased.
- **Speed cameras**: eight posts with their limit sign; a white flash, a ticket, a fine.
- **Damage**: top speed and pull fall with it; smoke from 30 %, a sagging body and a flickering
  headlight from 60 %, flames near 100 %. The station's garage repairs and resprays (level
  cleared).
- **A real WinCC OA alert**: from level 2 the player's `.wanted` raises a binary alert (class
  `alert.`, configured by the game); an operator's acknowledgement in the alarm list clears the
  level. New elements `alert`, `wanted`, `damage`, `ticket`, `fines` (an older type is changed
  in place with `para:edit-types`; without it they are left out and the rest goes on).
- Two players: player 2 starts on the next avenue (behind player 1, the first player's camera
  sat in its headlights: a washed-out view); player 2's HUD is mirrored to the right edge
  (it was under the banner, the clock and the minimap).
- Two players, keyboard + gamepad: in the lobby, Enter seats the keyboard wherever the focus
  is (it was heard only by the 3D view: once the nickname field or a button had the focus,
  Enter pressed that button instead); a free seat also offers **Use the keyboard**.
- Icons: the gamepad of the player cards and the speed camera ticket showed iX's "missing
  icon" (no `controller` / `camera` in iX): a gamepad drawn in the page, `photo-camera`.

## 0.4.0 — 2026-11-17

- **Two players on one computer** (#83), split screen side by side: on the start screen,
  1 or 2 players; each player's card (nickname, vehicle, neon colour) shows its device —
  "press to join": A / Start on a USB gamepad, Enter on the keyboard (one keyboard player
  at most); B / Escape to leave. Two identical gamepads are told apart by their index.
  A gamepad unplugged during the game pauses it until a pad presses Start for that seat.
- **Timed match** (logo hunt): 2, 3 or 5 minutes, 3-2-1-GO, a clock (red in the last 10 s),
  the logos shared — first come, first served — and a combo per player; a podium at the end
  (score, then logos), Play again or Menu. Alone: a time attack; Free drive keeps the
  missions and the endless logo hunt.
- One view per player: its car, headlights, camera and bloom, drawn side by side; with two
  views the shadows are off and the resolution 1. The players' cars bump into each other;
  the traffic yields to both.
- Network kept: one datapoint per local player (P1 keeps its 0.3.0 name, P2 `…p2`); the local
  players of other computers still show as remote players.

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
