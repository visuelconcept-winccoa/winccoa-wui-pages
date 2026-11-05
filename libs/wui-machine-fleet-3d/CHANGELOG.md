<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-machine-fleet-3d

## 0.5.1 — 2026-11-05

- The opening view (#70) is framed again when the view is resized — the machine list or a
  panel opening beside it, full screen, a window or a dashboard tile resized — as long as the user
  has not moved the camera since it was framed (#72). Any move of theirs (drag, wheel, keys, pad
  buttons, presets, fly to a machine, a viewpoint, the 2D / 3D toggle) stops it; "Default view"
  frames it again. A saved viewpoint keeps its pose.

## 0.5.0 — 2026-11-05

**Upgrade.** New role **`configure`** (module settings, common to every atelier) — open until an
admin assigns groups in `/app-security`. Needs fleet-core 0.2.1 and fleet-closures 0.2.1 (the
server-side rule of the module settings).

- **Opening view of an atelier** (#70): an atelier opened without a default viewpoint is framed on
  its placed symbols ("à placer" and hidden ones excluded; the floor when there is none), in one of
  three modes — **A** plan (2D), **B** tilted plan in perspective (3D), **C** tilted plan without
  perspective (2D locked at the tilt: zoom and pan only). Tilt towards the back 5–60°, margin
  0–40 %, the building's front side (where the camera stands).
- **"Paramètres du module"** in the overview: the default opening view of every atelier (DP
  `MachineFleet3D_Settings`, role `configure`), with the three choices rendered live, a preview
  whose tilt is set by dragging, tried on the site's ateliers and on example layouts.
- **"Vue d'ouverture"** in an atelier's toolbar: its front side, and the module's view or a view
  of its own (`Atelier.opening`, role `edit`).
- Opening order (load and "Default view" button): the user's default viewpoint, the atelier's
  public one, the atelier's opening view, the module's. The 3D toggle opens a plan or C setting
  in perspective; the 2D toggle stays the plan straight down.

## 0.4.0 — 2026-11-04 (SDS 2.2)

**Upgrade.** Requires **fleet-closures** (`/api/fleet`, the Fleet's writes checked on the
server by role; deployed headless when not selected) — restart the webserver after
`wui build`. The bubble, filter and display choices a browser kept move to the user's WinCC OA
user settings on first load (`_usr_<id>_WUI_MF_*`, through `/api/ai/fleet/settings`).

### Atelier view
- Bubbles **above their machine**, one third larger, placed and resized by hand per machine,
  or shown **on hover only** per atelier (#55, #56, #59); they stay beside their machines when
  zoomed in and show on large buildings seen whole.
- The **"My bubbles" menu goes**: a bubble shows the atelier's configuration for everyone (#64).
- **Faults, stops and producing machines** counted beside the atelier's name (#65).
- The **2D view stays a plan**: wheel, drag, pad arrows and keys zoom and pan, never back to
  3D (#57).
- **Viewpoints**: public ones (role `edit`) and personal ones (user settings), a default page
  per user and one for everyone; a viewpoint keeps its 2D / 3D mode (#60).
- Filters on machine tags and on machine state; the user's filters, display toggles and
  selections follow them in their user settings.
- **No work-centre notion**: no "Îlot" / "Workcenter" filters, no group outlines (#66).

### Editing
- What an atelier places is a **symbol**; one **"Ajouter un symbole"** wizard — from the site's
  catalogue, from another atelier, from a JSON file, or a short form — replaces "Add a
  machine" and "Add a machine of the site"; a new symbol lands "à placer" (#67).
- **Placement markers** are screen-size location pins created from their own toolbar button,
  chosen in the machine editor; **guides** show only while editing / moving a machine (#58, #63).
- **Building settings**: seven clean floor finishes, perimeter columns and transparent outer
  walls can be hidden, column colour (#61, #62).
- Free tags on a machine; a machine shows its family's model until it has its own; more
  datapoints whose alarms are the machine's; a machine's links kept within the application.

### Machine dashboard
- Stop list, filters (state, stop cause, production context), durations of alarms and Gantt
  periods, alarms filtered by type, the alarm code while the machine does not produce, where
  each parameter value comes from, a parameter's own decimals (`Kpi.decimals`), a button to the
  page the machine belongs to.
- States of the atelier's mapping (five-state supervisions), off-opening states, minimum stop
  per machine; the stop Pareto counts each cause's own time, without cumulative curve.

### Fixes
- Dialogs no longer close when a text selection is released outside their panel (#54).

Earlier versions: see the git history (`libs/wui-machine-fleet-3d`).
