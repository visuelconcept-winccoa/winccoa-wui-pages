<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-machine-fleet-3d

## 0.6.0 — 2026-11-09 (SDS 2.2)

**Upgrade.** Requires wui-fleet-core and fleet-closures `^0.3.0`. New roles, open to all until
assigned in Application Security: **`views`** ("Gérer les vues publiques", e.g. for sysadmin) and
**`qualify`** ("Qualifier les arrêts").

- **Back from an atelier stays on the overview**: the welcome atelier opens on arriving at the fleet
  only, no longer again when coming back from an atelier (back arrow or browser back).
- **Settings pages of the site in the overview**: a button for each menu entry marked
  `"fleetSettings": true` (usually hidden from the menu), titled and iconned from its entry, opens it —
  a site adds its own fleet settings without a menu entry of their own.
- **Give a stop its cause by hand** (role `qualify`): a click on a finished stop of the Gantt, or
  the pen of the stop list, opens "Cause de l'arrêt" — a cause from the catalog and a mandatory
  reason. It fills a stop without a cause or replaces the machine's; the history is left as it
  is, the cause given lays over it in the Gantt, the Pareto, the stop list, the TRS and the stop
  analysis, and is traced in the audit trail.

- **Public views and "welcome atelier for everyone" need the `views` role** (no longer the
  atelier edit right); "My views" and "welcome atelier for me" stay with each user. The two
  checkboxes read "Atelier d'accueil : pour moi / pour tous".
- **A symbol's name is unique in its atelier** (case, accents and spaces ignored): the symbol
  window refuses a taken or empty name; a symbol added under a taken name gets " (2)", " (3)"…
- **Symbol scale**: "Échelle (×)" in the symbol window, from 0.1 to 10, on the 3D model whatever
  its kind (`symbolScale`, absent = 1).
- **Resizing a bubble** follows the handle both ways (right or down, whichever moves most) and
  scales the whole bubble, text included, keeping its proportions.
- **Gantt dates without hovering**: under the machine-state Gantt, the start, the end and the
  state changes are written (time, with the day past 24 h), a mark on each change; labels that
  would overlap are skipped.
- **Hidden symbol shown in the machine list**: a crossed eye on its row; in edit, a click shows it
  again.
- **Import / export icons the right way round**: import = arrow down, export = arrow up (atelier,
  symbol window, graphics catalogue).
- **Deleting an atelier asks for a reason** (mandatory), written with the deletion in the audit
  trail (`AuditTrail_Fleet`, `reason`); new `mf-reason-dialog`.
- **"Îlot" filter back** in the filter bar (wui-fleet-core 0.3.0), beside UAP, activity, tags and
  state; "Workcenter" stays out (#66).
- **"Affichage" tab**: at most **10 lines in the bubble and 10 in the popup**, counted per column
  ("Bulle n / 10", "Popup n / 10"); a line not shown yet cannot be ticked once 10 are, until
  another is unticked. Past 10 (defaults, older configurations), the last lines in display order
  are hidden.
- A machine carries **any number of parameters**: the "Paramètres" tab no longer stops at 10, so
  the site's catalogue can propose all of a slot's and the atelier picks what it shows.
- **Machine dashboard, "Paramètres Process"**: a context line on top (the `filterable`
  parameters such as article and contract, the fixed-value ones such as machine or workcenter,
  then the work order and the operation), always shown; under it, a card for each process
  parameter ticked in the new **"Tableau de bord"** column of the "Affichage" tab (**at most 10**,
  "Tableau de bord n / 10", in display order), then the TRS. Optional `inDashboard` on the
  `display` entries; absent, the first 10 process parameters in display order are shown.
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
