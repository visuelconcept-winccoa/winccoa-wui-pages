# @visuelconcept/wui-gis-plants — Power plants (Tier 1)

The **`/gis-plants`** page lays out the operating parameters of every power plant the
GIS network simulator drives. There is one card per plant, **ranked live by output**
(highest first) and re-ranked on every change. A card that changes rank slides to its
new place so the eye can follow it (no motion under `prefers-reduced-motion`).

It is frontend only and read-only: no backend route and no manager of its own.
**Alarms are not shown in this first version**, only the operating values.

## What it reads

**The plants are the ones the GIS sites declare.** The page reads every `GIS_Site`
datapoint (`WuiDpeService.listDatapoints` + `dpGet` of `.json`, re-read every minute).
A plant is an asset with both a `puissance` and a `capacite` **reading**, which the
[`gisSim`](../wui-gis/README.md#the-network-simulator-gissim) `production-electrique`
family gives every power station it binds.

| Reading     | Card           | Unit |
| ----------- | -------------- | ---- |
| `puissance` | Output (large) | MW   |
| `capacite`  | Capacity       | MW   |
| `charge`    | Load factor    | %    |
| `tension`   | Voltage        | kV   |
| `frequence` | Frequency      | Hz   |
| `etat`      | State pill     | —    |

- **Values:** each reading is followed through the datapoint the site binds it to, one
  isolated `dpConnect` per element, the same path as the GIS markers.
  - A site stores a bare datapoint (`System1:GisSim_belleville_puissance`).
  - A datapoint addressed without an element must end with a `.`, so the page adds it.
- **State:** `etat` is not a map reading. It is derived beside the fault the asset is
  bound to (`…_defaut` → `…_etat`).
- **Duplicates:** a plant drawn on two sites is shown once, by the first site read.
- **Earlier approaches:** two versions guessed the `GisSim_*` names instead, first with
  `dpQueryConnect`, then with `dpNames`. Both left the page empty on the WebUI
  connection.
- **Why not the GIS page's store:** listing through it can create the `GIS_Site` type via
  `/api/para`, a write a read-only page must not make.

**Ranking and refresh:**

- Ties at the displayed megawatt keep their previous order.
- The view repaints at most four times a second, while the simulator writes every value
  each second.

So a stable fleet stays still.

**Two empty states:**

- _No site declares a plant_: no asset has both readings.
- _N plant(s) found, waiting for their values_: the plants exist but no output has
  arrived.

## Navigation

A card opens its site on `/gis/:siteid`.

## Security

The module has one role, `gis-plants` / `view` (`src/app-security.roles.json`). The page
has no write action, so there is nothing else to restrict.

## Prerequisites

`wui-gis` must be deployed with a site whose power stations carry those readings, and
`gisSim` must be running to drive them (e.g. the ready-to-import
`backend/managers/gisSim/examples/gis-france-nucleaire.json`).
Without it the page shows its empty state.

## Contents

```
libs/wui-gis-plants/
  menu.fragment.jsonc               1 entry, /gis-plants (permission: connected)
  src/gis-plants.ts                 page entry (wui-gis-plants)
  src/gis-plants/data/plants.ts     plant detection, ranking (pure, unit-tested)
  src/gis-plants/data/plant-feed.ts discovery + live values + names
  src/gis-plants/i18n.ts            EN / FR / DE strings
  src/gis-plants/ui/styles.ts       summary strip + card grid
  src/app-security.roles.json       roles fragment
```
