<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-city-drive

## 0.14.0 — 2026-11-18

- **Visuel Concept**: its symbol (official artwork) on the four sides of the plant's machine
  halls, lit; at the end of the match a light card "This game is brought to you by Visuel
  Concept" with the full logo turning, the pitch "Your plant. Live. Anywhere." and a QR code
  that opens a mail to contact@visuelconcept.com.
- **Control room: speed trend.** Click a player on the map or in the list: a chart of its speed
  over the last 2 minutes, read live from its DPE `CityDrive_Player_<…>.speed`, with the peak;
  the selected player is ringed on the map.
- **Fix: a player shown twice in the control room.** `dpConnect` gives back every DPE of a
  player when any of them changes, so a player of an old session looked live. A player is now
  online when its `pos.x` or `pos.z` really changed (their `_online.._stime`) within 30 s.

## 0.13.1 — 2026-11-18

- Control room: the players' arrows pointed the wrong way (rotation π − heading instead of
  −heading on a map with +Z up and +X to the left); checked against the players' actual
  movement.
- A station kept sending its telemetry heartbeat after the match (podium, menu), so its
  player stayed "online" in the control room and the players panel. The heartbeat now stops at
  the end of the match and at the menu, and starts again with "Play again" or a new game: the
  player goes offline 30 s later.

## 0.13.0 — 2026-11-18

- **Control room** `/city-drive/control` (menu "City Drive · Control room"), new role
  **`control`**, for a second screen of the stand: the live map of the city (every player
  online from its `CityDrive_Player_*` datapoint, the plant's halls in their machine colour,
  wanted players ringed in red); the **alerts** of the wanted players with **Acknowledge** —
  `dpSet <dp>.wanted:_alert_hdl.._ack = 2` on the operator's own session, as the alarm list
  does (shown only with the WinCC OA write permission) — after which the game clears the
  player's level; the players online (car, speed, score), the plant, the weather (its DPEs or
  the game's cycle), today's matches; a clock. It does not play: no player datapoint.
- **Fix: `/city-drive/admin` showed the game's start screen.** The shell's router reuses the
  same element between `/city-drive` and its sub-pages and pushes the route through
  `onBeforeEnter(location)`; the page read `location.pathname` once. The route is now the
  router's pushed state, and the game is stopped (renderer, datapoint links, sound, camera)
  when the element switches to the admin page or the control room, and started again when it
  comes back.

## 0.12.0 — 2026-11-18

- **Atmosphere** (lot 3, #95):
  - **Sound**, all WebAudio, no audio file: per player an engine (pitch with the speed, gear
    by gear; growl with the throttle), the tyre screech of a slide, the horn (**H**, held; pad:
    left stick click) — two players panned left / right; a crash thud, the logo chime, the
    speed camera's shutter, a two-tone siren while chased. Starts at the first click or key
    (browsers do not count a gamepad press as a gesture).
  - **Radio** (**M**; pad: **Back**): original stations from a small sequencer — *Neon FM*
    (synthwave), *Lo-Fi Plant* (slow chords) — and *WinCC OA Talk*, the plant's news read by
    the browser's speech synthesis (machines in fault, wanted players, weather), or off.
  - **Weather bound to datapoints**: `CityDrive_Config.json` → `"weather": { "rain": "<dpe>",
    "fog": "<dpe>", "rainMax": …, "fogMax": …, "fogInverse": true }` (booleans, 0..1, %
    or a value over its max; `fogInverse` for a visibility). Rain streaks around the players,
    thicker fog, wet glossy roads, **less grip** (down to 75 %). Without a binding, a shower
    every ~3 minutes and a light mist.
  - **Skid marks** laid by the rear wheels while sliding (the last 900).
  - **Pedestrians react**: a car faster than 18 km/h within 10 m, or a horn within 25 m, and
    they jump aside towards the shops, hop and run off, then calm down.
  - Settings: effects volume, music volume, radio station (kept in the browser).

- **Admin page** `/city-drive/admin` (menu "City Drive · Admin"), new role **`admin`**: the
  game's statistics — matches (duos), players, emails collected, WinCC OA logos (total,
  average, best), average score, photos kept / waiting for Supabase (with the last error) /
  published; charts of the matches per hour and per day and of the logos per result; the
  ranking's top 10. **Export CSV** (every result, emails included; `;`, UTF-8 BOM, no formula
  injection) and **Reset the ranking** (after a confirmation), both in the audit trail
  (`RESULTS_EXPORT`, `RESULTS_RESET`). Refreshes every 30 s. Backend `GET /api/city-drive/stats`
  (role `admin`).

## 0.11.0 — 2026-11-18

- **Audit trail** of the game station in the module's own `_AuditTrail` datapoint
  **`AuditTrail_CityDrive`** (created on first use through PARA, NGA-archived when an active
  archive group exists; shown by the Audit Trail page): `GAME_START` (players, cars, devices,
  duration, photo), `GAME_END` (ranking), `REMATCH`, `GAME_EXIT` (after the podium / match
  left / free drive), `SEAT_JOIN` / `SEAT_LEAVE`, `PHOTO_TAKEN` / `PHOTO_SKIPPED` /
  `PHOTO_FAILED` / `PHOTO_PUBLISHED` (object path only), `ALERT_ACKNOWLEDGED` (the control room
  acknowledged a player's alert), `SETTINGS_UPDATE` (old → new of the changed settings). No
  email nor photo link ever goes into it (only whether an email was given). A failed audit
  write never stops the game.

## 0.10.1 — 2026-11-18

- Fix the webserver build (`tsc`: "Buffer is not assignable to BodyInit" in
  `supabasePublish.ts`): the photo is sent as a `Uint8Array`, accepted by every version of the
  fetch types (TypeScript ≥ 5.7 with the DOM library refused a Node `Buffer`).

## 0.10.0 — 2026-11-18

**Upgrade.** City Drive now has a backend (`/api/city-drive`): rebuild the site
(`npx wui build prod`) and restart the webserver. For an IP camera, Camera Streams ≥ 0.3.0.

- **Photo booth**: when a match starts, a 3-2-1 countdown over the live camera, a flash, and
  a souvenir photo of the players, shown for a moment, then the game. Saved on the WinCC OA
  server in `<project>/data/city-drive/photos/` (or `$CITY_DRIVE_PHOTOS`), **one file per
  player named after their email**: `<email>_<YYYYMMDD-HHmmss>.jpg` (no email:
  `no-email_<nickname>_<date>.jpg`; the date keeps a second match from overwriting the first).
- **Settings → Photo booth**: Off (default), *This PC's webcam*, or any camera of the Camera
  Streams module: a USB camera of this PC (opened by the browser, on the device chosen in
  Camera Streams) or an IP camera (one frame from `/api/rtsp/snapshot`).
- The start screen says so when the booth is on (a face linked to an email is personal data).
- Backend: `POST /api/city-drive/photo` (role `city-drive/play`): JPEG only, 8 MB at most,
  names sanitised (never outside the folder), written aside then renamed.
- **Start screen in two steps**, nothing to scroll (checked down to 1280 × 720), everything
  with a gamepad: **1 · Players** (how many, the match, each player's seat, nickname and
  email side by side) → **2 · Garage** (each player's turning car and the garage lines, side
  by side for two players). **A / Enter**: next step, then start (photo booth first);
  **B / Esc** on the garage: back. The email's explanation moved into its placeholder.
- Lobby fix: a gamepad that already had a seat was ignored there, so its B ("leave") did
  nothing; every pad's A / Start / B now reaches the lobby.
- **Skip photo** in the booth (button, B on the pad, Esc): no picture, nothing saved, the game
  starts.
- **Souvenir photo on Supabase + QR code** (docs/wui-city-drive/supabase/README.md): City
  Drive's backend publishes the match photo (≤ 1600 px) to a Supabase Storage bucket as
  `<YYYY-MM-DD>/<uuid>.jpg`; the podium shows a large QR code of its link ("Scan to get your
  photo") with the upload state, until a new game. Offline: queued in `photos/pending/`,
  retried in the background (5 s … 60 s, survives a restart), said on screen. Credentials in
  the project's `config/config`, section `[cityDriveSupabase]` (`url`, `key`, `bucket`,
  `signedDays`): public bucket (publishable key, INSERT-only policy) or private bucket with
  signed links. Supabase's HTTP Storage API with Node's `fetch` (the webserver has no room for
  supabase-js); new dependency `qrcode` (page). After the event: `download-all.mjs` /
  `empty-bucket.mjs` (supabase-js, secret key, operator's computer).

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
