# wui-city-drive — City Drive

An original 3D driving game in a neon city at night, with Japanese-style streets, whose plant
is a simplified twin of the factory: the game reads datapoints and writes its own. Route
`/city-drive`, element `wui-city-drive`. Issue #79 (version 1).

The game is in English only.

## Play

- Start screen: nickname, vehicle and neon colour (the iX theme colours), kept in the browser
  (`localStorage`) and written to the player's datapoint.
- Vehicles: **Coupé de Ville** (fast), **Limousine** (long, heavy), **Pickup**, **Maintenance
  van** (best range). Each has its own physics (speed, grip, steering, fuel, size).
- Keys: W/Z ↑ throttle · S ↓ brake / reverse · A/Q ← D → steer · Space handbrake (drift) ·
  C camera (chase, street level, bonnet, drone, street-corner cameras, map view) · R back on the road · N new mission · Esc pause. Click the city first
  so it gets the keyboard.
- Missions: **delivery** (pick up, then drop, before the timer) and **intervention** (a machine
  in fault: drive to its hall; offered as soon as a machine fails, replaces a delivery).
- Fuel: refill at the station (north-east corner of the minimap).

## Datapoints

| Datapoint | Direction | Content |
| --- | --- | --- |
| `CityDrive_Player_<user>` (type `CityDrive_Player`, created through PARA) | written | `pos.x`, `pos.z`, `heading` (°), `speed` (km/h), `fuel` (%), `score`, `mission`, `event`, `nickname`, `vehicle`, `color` — at most 2 writes/s, dead bands, a heartbeat every 30 s |
| `CityDrive_Player_*` of the other players | read (`dpConnect`) | multiplayer: their cars in the city, the **Players online** panel (online = a change within 35 s) |
| `CityDrive_Config` (`.json`, created on first load) | read | the bindings below |
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

## Roles (Application Security)

- `play`: the page (and one's own telemetry). Without it, a notice replaces the game.
- `configure`: declared for `CityDrive_Config` (edited in PARA in V1).

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

## Not in V1

Bindings editor UI, walking, writing to process datapoints (future `drive-process` role with a
server-side check), collisions between players.
