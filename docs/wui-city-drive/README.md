# wui-city-drive — City Drive

An original 3D driving game in a neon city at night, with Japanese-style streets, whose plant
is a simplified twin of the factory: the game reads datapoints and writes its own. Route
`/city-drive`, element `wui-city-drive`. Issue #79 (version 1).

The game is in English only.

## Play

- **Start screen, two steps** (no scrolling; all with a gamepad): **1 · Players** — number of
  players, match length, each player's seat (device), nickname, optional email; **A / Enter**
  → **2 · Garage** — each player's car and garage lines; **A / Enter** starts (photo booth
  first when set), **B / Esc** goes back.

- **1 or 2 players on one computer** (split screen). With two players, each one joins with
  its device on the start screen: A or Start on a USB gamepad, Enter on the keyboard (the
  keyboard serves one player at most); B or Escape to leave. Then **Start the match**.
- **Match** (logo hunt, timed): 1 minute by default, or 2, 3, 5; the logos are shared, first
  come first served; the highest score wins (logos break a tie). Alone, *Free drive* keeps the
  missions.
- **Email (optional)** for each player: saved with the results in `CityDrive_Results`, never
  shown; cleared when going back to the menu.
- **Ranking** at the end of each match: the WinCC OA logos taken, one row per person (email,
  else nickname) with their best match; top 10, plus the players of the match with their place
  ("9th of 12") and the number of players. Nicknames only.

- Start screen: nickname, vehicle, neon colour, game mode (Logo hunt or Missions) and time of
  day (neon night or day); **Settings** (also in game): keys, gamepad, steering, camera,
  graphics, units, minimap / players panel. (the iX theme colours), kept in the browser
  (`localStorage`) and written to the player's datapoint.
- **Garage** on a **turntable**: the car turns in its paint and neon colour. Lines Car, Wheels,
  Paint, Neon, Driver: ▲ ▼ picks a line, ◀ ▶ changes it — arrow keys (keyboard player), D-pad or
  left stick (each gamepad on its own player's card), or the mouse.
- Cars: **Neon Specter** (finned coupé), **Kitsune GT** (roadster, the most agile), **Thunder
  Ronin** (muscle car, the strongest pull), **Grand Duchess** (limousine), **Night Courier**
  (estate), **Shinjuku Cab** (taxi), **Iron Mule** (pickup), **Hard Hat** (maintenance van, best
  range). Each has its own physics (speed, grip, steering, fuel, size).
- Keys: W/Z ↑ throttle · S ↓ brake / reverse · A/Q ← D → steer · Space handbrake (drift) ·
  C camera (chase, street level, bonnet, drone, street-corner cameras, map view) · T day / night ·
  R back on the road · N new mission · Esc pause. Click the city first
  so it gets the keyboard.
- **Logo hunt**: WinCC OA tokens over the roads; drive or walk through them: each blows up
  (sparks, shards, shockwave) and scores 100 × combo (within 6 s, up to ×5); a cleared wave
  of 24 adds a bonus and lays a new one.
- **On foot**: F to get out of the car (once stopped) and back in when within 4.5 m of it;
  Shift to run. A jointed figure walks and runs with a real stride.
- **Weapons on foot**: WebUI hammer, star sword, cube crossbow (WinCC OA logo cubes that stick
  where they land and blow up 1 s later, 4 m blast). E strikes
  or shoots, X changes weapon (pad: X, D-pad). They break logos (scored) and cars (alert level
  up); never the pedestrians.
- **USB gamepad** (standard mapping): RT / LT throttle and brake, left stick, A handbrake /
  run, B get out / in, Y camera, X mission, LB day / night, RB reset, Start pause.
- Missions: **delivery** (pick up, then drop, before the timer) and **intervention** (a machine
  in fault: drive to its hall; offered as soon as a machine fails, replaces a delivery).
- Fuel: refill at the station (north-east corner of the minimap: the orange square); on an
  empty tank the car still crawls to it.

### Tension (0.5.0)

- **Alert level** (five chevrons under the score): running a red light, crashing into the
  traffic, a speed camera, ramming a security car each add heat. It cools down after 10 s
  without an offence, but not while a security car sees you (140 m).
- **Security cars** from level 2 (one per level above 1, four at most): dark saloons with a
  red / blue light bar. They cut you off (they aim where you will be) and back up when stuck.
  Lose them (all farther than 220 m for 6 s) and the level falls to 1; stay nearly still with
  one within 6 m for 2.5 s and you are **stopped**: −20 % score, level cleared. The screen
  edges flash red / blue while you are chased.
- **Speed cameras**: eight posts on the kerbs with their limit (50, 70 or 90 km/h). Drive past
  faster: a white flash, a ticket (speed, limit, fine) and the fine off your score.
- **Damage**: hard hits damage the car (top speed down to 65 %, less pull); from 30 % it smokes,
  from 60 % it sags and a headlight flickers, near 100 % it burns.
- **The station's garage**: driving in repairs the car and resprays it (alert level cleared).
- **The control room**: from level 2 the player is *wanted*, a real WinCC OA alert (see
  below). An operator who acknowledges it in the alarm list clears the player's alert level.

## Photo booth (≥ 0.10.0)

Settings → **Photo booth**: Off (default), *This PC's webcam*, or a camera of the
**Camera Streams** module (optional dependency): a USB camera of this PC (the browser opens
it, on the device chosen for it in Camera Streams) or an IP camera (one JPEG frame from
`GET /api/rtsp/snapshot/<id>`, Camera Streams ≥ 0.3.0 with its rtspProxy manager running).

When a match starts: 3-2-1 over the live image (USB / webcam; none for an IP camera), a flash,
the photo shown for a moment, then the game. The photo is posted to City Drive's backend once
per player and saved on the WinCC OA server:

```
<project>/data/city-drive/photos/          (or $CITY_DRIVE_PHOTOS)
  aurel@example.com_20261118-093012.jpg    email given
  no-email_lea_20261118-093455.jpg         email left empty: the nickname
```

- The date keeps a second match of the same person from overwriting the first photo; two
  players with the same email in the same second get `_2`.
- `POST /api/city-drive/photo` `{ email, nickname, image }` (role `city-drive/play`): a JPEG
  (base64 or data URL) of 8 MB at most; names are sanitised (letters, digits, `@ . _ -`), so a
  request can never write outside the folder.
- **Personal data**: a face linked to an email. The start screen says a photo will be taken
  when the booth is on; the folder is never served back by the module. Delete the photos when
  the event is over.
- The webcam needs HTTPS (or localhost) and the browser's camera permission.

### Photo on Supabase and QR code

The match photo is also published to Supabase Storage by the backend, and the podium shows a
QR code of its link. Setup, config section `[cityDriveSupabase]`, public / private bucket,
after-event scripts: [supabase/README.md](supabase/README.md).

## Datapoints

| Datapoint | Direction | Content |
| --- | --- | --- |
| `CityDrive_Player_<user>_<id>` (type `CityDrive_Player`, created through PARA; `<id>` identifies the browser, so each session has its own) | written | `pos.x`, `pos.z`, `heading` (°), `speed` (km/h), `fuel` (%), `score`, `mission`, `event`, `nickname`, `vehicle` (`foot` when walking), `color`, and since 0.5.0 `alert` (0..5), `wanted` (bool, carries the alert), `damage` (%), `ticket` (last speed camera ticket), `fines` (count) — at most 2 writes/s, dead bands, a heartbeat every 10 s; a change of the alert is written at once |
| `CityDrive_Player_<…>.wanted:_alert_hdl` | configured once, then read (`_act_state`) | binary alert, class `alert.`, alarm on TRUE: it comes while the player is wanted; its acknowledgement (`_act_state` 1 → 2) clears the alert level |
| `CityDrive_Player_*` of the other players | read (`dpConnect`) | multiplayer: their cars (or pedestrians) in the city, the **Players online** panel (online = a real change within 30 s) |
| `CityDrive_Config` (`.json`, created on first load) | read | the bindings below |
| `CityDrive_Results` (`.json`, created on first match) | read, appended | the results of the matches: `[{ id, nickname, email, logos, score, at, duration }]`, 1000 at most. **Personal data**: the emails are readable by whoever can read this datapoint (PARA); to start a new ranking (a new event), set `.json` to `[]` in PARA |
| the bound DPEs | read (`dpConnect`) | machine states, forced crossroads |

`CityDrive_Config.json` (edited in PARA in V1):

```json
{
  "machines": [{ "building": "machine-1", "dpe": "Line1.Oven.State", "run": [1], "fault": [2, 3] }],
  "lights": [{ "crossroads": "3-3", "dpe": "Plant.EmergencyStop" }]
}
```

- Machines `machine-1` … `machine-4` are the four halls of the plant block (centre of the city).
  A value is matched against `fault`, then `run`, then `stop`; without lists: true / 1 / "run" →
  running, false / 0 / "stop" → stopped, ≥ 2 / "fault" → fault.
- A crossroads `i-j` (grid indices 0..6) is forced red while its DPE is true.
- The game writes nothing but its own `CityDrive_Player_<user>`: never a process datapoint.

**Upgrading from 0.4**: the existing `CityDrive_Player` type lacks the 0.5.0 elements. The first
player who opens the page with the `para:edit-types` role changes the type in place
(`/api/para/dptype/change`: existing datapoints keep their values and get the new elements).
Until then, the new elements are not written and the alert is not configured; the rest of the
telemetry and the game play the same. The other players are read on the elements of 0.4.

## Admin page

`/city-drive/admin` (menu **City Drive · Admin**, role **`admin`**): the statistics of the game
for the event's organisers — matches, players, emails collected, logos, best / average, photos
kept / waiting for Supabase / published; matches per hour and per day, logos per result; the
top 10. **Export CSV** gives every result **with the emails** (hence the role); **Reset the
ranking** empties `CityDrive_Results` for a new event. Both are written to the audit trail. The
3D game does not start on this page.

## Audit trail

The game station's actions go to the module's own `_AuditTrail` datapoint
**`AuditTrail_CityDrive`** (item type `CityDrive`), created on first use and NGA-archived when an
active archive group exists — see it in the **Audit Trail** page (select that datapoint).

| Action | Item | Old → new |
| --- | --- | --- |
| `GAME_START` | the players' nicknames | match length or free drive, mode, photo (taken / skipped / failed / off), each player's car, device, email given (yes / no) |
| `GAME_END` | players | ranking: rank, nickname, score, logos |
| `REMATCH` | players | match length ("Play again") |
| `GAME_EXIT` | players | `after-podium`, `abandoned` (left before the end) or `free-drive` |
| `SEAT_JOIN` / `SEAT_LEAVE` | `Seat P1` / `P2` | the device (`keyboard`, `pad:0`…) |
| `PHOTO_TAKEN` / `PHOTO_SKIPPED` / `PHOTO_FAILED` | players | how many players it was saved for / — / the error |
| `PHOTO_PUBLISHED` | players | the object path in the bucket (`<date>/<uuid>.jpg`), never its link |
| `ALERT_ACKNOWLEDGED` | the player (item type `CityDrivePlayer`) | its `….wanted` DPE: the control room acknowledged its alert |
| `SETTINGS_UPDATE` | `Settings` | the changed settings, old → new |
| `RESULTS_EXPORT` / `RESULTS_RESET` | `CityDrive_Results` | admin page: results exported (emails included) / ranking emptied (how many results) |

Personal data stays out: never an email (only whether one was given), never a photo link. The
user of each row is the WinCC OA user logged on at the game station.

## Roles (Application Security)

- `play`: the page (and one's own telemetry). Without it, a notice replaces the game.
- `configure`: declared for `CityDrive_Config` (edited in PARA in V1).
- `admin`: the admin page — statistics, CSV export with the players' emails, ranking reset.
- The photo booth saves with `play` (`POST /api/city-drive/photo`); an IP camera's snapshot
  also needs `camera-streams/view`.
- The alert of a wanted player is acknowledged in the alarm list, with the operators' own
  rights; the game adds no role for it.

## Demo mode

Without a backend (`npx wui dev`): the machines change state on their own (machine-2 breaks down
regularly), three simulated players drive around, nothing is written.

## Rendering

Three.js, bundled into the page. Bloom; neon in the iX theme colours read from the page's
`--theme-color-*` tokens; procedural textures (facades, asphalt, pavement, signs): no image file.
Moonlight shadows around the player, real spot lights for the player's headlights. The Visuel
Concept logo is drawn from its colours (signs on the roofs and at the top of the facades).
Every car carries an Austrian number plate of Eisenstadt (district `E`), the cradle of WinCC OA;
the player's reads `E · WINCCOA 1`.

Needs a GPU: on a machine without one (software WebGL), the game runs but slowly.

## Upgrading from 0.1 / 0.2

Player datapoints are now one per session (`CityDrive_Player_<user>_<id>`). The old
`CityDrive_Player_<user>` datapoints are no longer written and show as offline: they can be
deleted in PARA.

## Not in V1

Bindings editor UI, writing to process datapoints (future `drive-process` role with a
server-side check).
