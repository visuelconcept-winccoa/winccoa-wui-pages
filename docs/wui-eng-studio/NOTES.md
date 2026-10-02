<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Engineering Studio — design notes, decoupling & verification status

Read this (with `README.md` + `INTEGRATION.md`) **before editing** the studio.

## The decoupling contract (why doc/screenshots/tests need no runtime)

Three seams keep the runtime out of everything that must be validated offline:

1. **Pure domain** — `@visuelconcept/wui-eng-core` imports **nothing** from
   `@wincc-oa/*` / `winccoa-manager`. All engineering logic (diff, plan, config
   builders, SimaticML parse, offsets, naming) is plain TypeScript, unit-tested
   with vitest in `node` (no DOM, no OA). The only runtime touch-point is the
   `EngPort` interface — the applier calls it; tests pass an in-memory fake.
2. **Page depends on `lit` only** — `wui-eng-studio` does **not** import any
   `@wincc-oa/*` package. It themes through `--theme-*` custom properties **with
   dark fallbacks** (`eng-theme.ts`), so it renders inside the shell AND
   standalone. All I/O goes through the injected **`EngGateway`**.
3. **Two gateways** — `HttpEngGateway` (`/api/eng`) for the shell;
   `DemoEngGateway` (in-memory, seeded by `demo-data.ts`) for docs, screenshots
   and the offline demo. The screenshot tool drives the demo build via
   `vite preview` + preinstalled Chromium — no login, no WebSocket, no backend.

Consequence: `npm test` (core) and `node tools/screenshot-eng-studio.mjs`
(page) both run in CI with **no WinCC OA**.

## Check-in / check-out semantics

- The **workspace** is the working copy (types + DPs + configs) plus a
  `baseline` = the fingerprint of each object at check-out time.
- **diff** (`diff.ts`) → `EngPlan`: workspace-only ⇒ *create*; both-but-different
  ⇒ *update*; **live-only AND in the baseline** (the user removed a checked-out
  object) ⇒ *delete*. A live object that was never checked out is **never**
  deleted implicitly (the PARA lesson). If the live object drifted from its
  baseline ⇒ the item is flagged **conflict**.
- **apply** (`apply.ts`) refuses conflicting items (reports `skipped`), is
  idempotent (create of an existing object ⇒ `skipped`, not an error), and writes
  each config family with the **atomic builders** (one `dpSetWait` each).
- `EngPlan` is the *single* serializable object: it is both the dry-run preview
  and the check-in request body — what you preview is what gets applied.

## Books are first-class — device↔book is many-to-many

An `AddressBook` has its own identity (`id`, `name`) and is NOT owned by a single
device. A `Device` (equipment) references books via `bookIds: string[]`. This one
relation covers both requested needs:

- **Aggregation** (N books on one device): an equipment groups several
  interfaces — e.g. two OPC UA servers of one machine — each a book.
- **Mutualisation** (one book on N devices): the same `bookId` appears in several
  equipments' `bookIds` → the catalog is reused, not copied.

A book optionally carries its **`interface`** (the concrete OPC UA/S7 connection
it binds through). A book with **no** interface is a pure **file catalog /
template** (a SimaticML/NodeSet export): it holds the signal structure but no
live binding, and is bound to each equipment at check-in through that equipment's
interface. The nuance "same catalog, different servers" is therefore modelled as
one catalog book referenced by several devices, each supplying its own binding —
and a future "clone catalog with a new interface" action can materialise a bound
copy when needed.

The pure domain does not depend on this wiring — `AddressBook` is a data record;
the many-to-many is resolved in the gateway/UI (`booksOfDevice`,
`otherDevicesSharing`) and persisted by `engStore` as a device registry plus one
file per book (deleting a device therefore never deletes a book).

## The device form — decisions

`devices.ts` (core) + `renderDeviceForm` (page) + `createDevice`/`saveDevice`
(backend). Four decisions worth the words:

**The form's SHAPE is data, in the core.** `PROTOCOL_PARAMS` declares, per
protocol, which connection parameters exist, which are required, how each is
entered and an example value; the page renders rows from it and only translates
the labels (`PARAM_LABEL`). Adding a protocol is then a core change plus a few
words — never a change to the template. `tools/check-eng-i18n.mjs` fails if a
declared parameter has no label, so a new one cannot ship as a raw key.

**Validation lives once, in the core, and runs twice.** `validateDevice` returns
`EngWarning`s (codes + params), so the form shows them as you type in the operator's
language and the backend re-runs the same function before writing — a client is not
a guard, and the two can no longer disagree. `blockingProblems()` separates the
refusals from the *advice*: a missing driver number outside OPC UA is a warning, not
a wall, because it is a legitimate "I'll fill it in later" state and only bites at
check-in.

**The id is derived once, then frozen.** `deviceIdFrom(name)` + a `-2`/`-3` suffix
while taken. Books and address configs reference a device by id, so re-deriving it
on a rename would silently re-parent catalogs. The form displays the id it will
assign (creation) or the one that is pinned (edit) rather than hiding the rule.

**Create and update are different routes, and the server owns the id.** `POST
/devices` creates, `POST /devices/:id` updates (404 if unknown), `PUT /devices`
replaces the registry for provisioning. Two reasons, both bugs avoided: an "empty
id" in the path (`/devices/`) matches the *collection* route under Express's
default non-strict routing — the creation would have quietly hit the
registry-replace handler; and a client-derived id would let two operators creating
the same name concurrently overwrite each other, where a server-derived one yields
`four1` and `four1-2`. A single-device upsert (rather than "save the whole list")
is the same concern at registry level: replacing a list loaded minutes ago
discards what another operator added since.

Deleting a device is deliberate (the button arms, then confirms) and narrow: the
**books survive** — they may be shared — and nothing already checked in is touched.
It is a registry deletion, not a project one.

**Declarative parameters, and the bug they exposed.** A Modbus **word order** and
**zero-based addressing** are configured on the WinCC OA side — in the project
`config` file / when the connection to the device is created — and never per
address; the `_address` attribute set has no byte-order attribute at all, which is
the same fact seen from the other end. The studio still records them
(`declarative: true` in the spec, their own card in the form) because they decide how
every register of the book is *interpreted*: a word swap turns a `REAL` into nonsense
and a one-register shift moves every measurement. Recorded next to the equipment they
can be compared with the driver's configuration; absent, they cost an afternoon of
"the values move on their own".

Adding them fixed a real defect: the demo's PAC3200 devices already carried
`wordOrder`/`zeroBased`, but the spec did not declare them — and `normalizeDevice`
keeps only declared keys, so **editing a Modbus device silently dropped both**. A
data-driven form is only as complete as its data.

They are **three-state**, not booleans: `false` ("checked, it is not zero-based") and
absent ("nobody said") are different claims, and a declarative field exists precisely
to record which one it is. Hence the `flag` kind rendering as a select with
*— not stated —*, and the `choice` kind validating its value server-side
(`device.param-invalid`) since an API client can send anything.

## Connection state: a LED, a word, and the driver's own code

`GET /api/eng/devices` returns the stored equipments **decorated with a live
connection state** — `engController.withLiveState`, mirrored by the offline demo
(`DemoEngGateway.withLiveState`) so both teach the same behaviour. Four decisions:

**The state is DERIVED at read time, never stored.** A JSON registry cannot know
whether a PLC answers, and a "connected" persisted from last week would be worse than
no lamp at all. `normalizeDevice` therefore still writes `state: 'unknown'`, and the
demo fixtures cannot even *carry* a state (`DeviceDeclaration = Omit<Device, 'state'>`).

**One element covers every protocol, and it is verified.** Every connection type of the
WinCC OA base data carries `Common.State.ConnState` — checked against the installed
`3.21/dbdfiles/version_3.21/dptypes.txt`: `_OPCUAServer`, `_S7_Conn`,
`_S7PlusConnection`, `_Mod_Plc`, plus 12 more (`_IecConnection`, `_BacnetDevice`,
`_EIPConn`, `_MqttConnection`, `_Dnp3Station`, `_IEC61850_IED`, …). So the probe is one
`dpGet`, not a per-driver special case. Its codes come from the shipped message
catalogue (`msg/*/opcua.cat`, keys `CommonConnState…`): `-1` undefined, `0` undefined by
the driver, `1` not connected, `3` inactive, `5` failure, `256`+ connected (`257…260`
naming which server/connection of a redundant pair answered).

**The three-state mapping is the vendor's own.** `deviceStateFromConnState` follows
`scripts/libs/opcuaDriver_plugin.ctl` → `setCommonConnStateShape`, which paints the para
lamp: **green from 256 up**, **red on `1` and `5`**, **yellow for everything else**. It
matters that this is copied rather than invented: an operator reads both screens, and a
studio that called `3` (*inactive* — somebody disabled the connection) a red
disconnection where para shows yellow would be teaching a state the project does not
have. The raw code travels with the state (`Device.stateCode`) and is shown beside the
LED whenever it says more than the lamp does, because `1`, `3` and `5` call for three
different actions: fix the link, re-enable the connection, look at the driver error.
`_OPCUAServer.State.ConnState` (`0`/`1`, its own scale) is read as a **fallback** when a
driver leaves the common element undefined — without it, a perfectly connected server
whose driver fills only its own element would show a grey lamp.

**A device is matched to its connection, or the state stays unknown.** OPC UA by
REFERENCE NAME (the `server` parameter, else the connection of one of its OPC UA
catalogs) — the same name its addresses are bound through, so the match is exact.
Otherwise by declared ADDRESS: `declaredAddressOf` (the `ip`, or the *host* of an
`endpoint`) searched in the connection type's own address element
(`_S7_Conn.Address`, `_S7PlusConnection.Config.Address`, `_Mod_Plc.HostsAndPorts`,
`_OPCUAServer.Config.ConnInfo`). **Several** matches are reported as
`ambiguous-connection` rather than resolved by picking the first: two stations behind one
address is exactly the case where a wrong LED sends an engineer to the wrong panel.
Nothing matched is `unknown-connection` (a declaration error, not a downtime), nothing to
match on is `unprobed`, and a failed read is `probe-failed` — all of them `unknown`,
never `disconnected`. The reason is what the badge's tooltip says; a lamp whose grey has
three possible causes is a riddle, not information.

**A never-written state is unknown, not a disconnection.** Measured on a live 3.21
project: a connected connection reads `Common.State.ConnState = 257` stamped *now*, while
an `_OPCUAServer` that has never connected reads `0` on BOTH elements stamped
`1970-01-01`. A plain `> 0` test would therefore announce a disconnection about a machine
nobody ever tried to reach — the same class of defect as `Number(null) === 0` reporting
"driver 0 is running". So each read carries its source time (`:_original.._stime`, the
path the PARA page already uses) and the verdict is taken by the pure
`connectionVerdict(common, own)` in the core, unit-tested against exactly those two
measured cases.

**The `server` parameter is a PICKER, and that was the actual bug.** A device in the test
project declared `server: "simu1"` where the project's connections are `Simulator1` and
`test`: the badge said "unknown" for a machine that was answering (`ConnState 257`), and
nothing had ever told the operator the name was wrong. A free-text field for a value that
must match a datapoint is the defect; the fix is to offer the project's own connections
(`eng-connection-select.ts`, same degradations as the driver picker) and to state the
mismatch inline when a name matches nothing. The backend also stopped giving up at a
failed name lookup: it falls through to the declared address (`ip`, or the host of an
`endpoint`), which is often enough to identify the connection — and reports
`ambiguous-connection` rather than picking one when several match.

**The device screen shows LINKS to its catalogs — the book content lives in the
Catalogues panel only.** Field request, after the model-DPs card landed: the device
screen still embedded the whole book detail (interface cards, the ad-hoc online
browse form, the full signal table). All of it existed in the Catalogues panel too —
literally the same table, passed there through the `signals` slot — so the device
side kept a second copy of a workflow whose home is elsewhere. The device detail is
now: state, model datapoints, and one **link per referenced catalog** (name,
protocol, count, `⇆` when shared); a click opens the Catalogues panel on that book
(`selectBook` + `panel = 'books'`). Two consequences worth naming: the **refresh
delta** now renders in the Catalogues panel (above the signal table — that is where
refresh and browse live), and the screenshot pipeline captures the book-content
shots (06–11, 14–15) there. `browseForDemo`/`refreshForDemo` and the browse state
stay on the page — the demo and the walk need them — only the device-side FORM went.

**The device detail shows the MODEL's datapoints bound to that equipment — only
those.** Field request: standing on an equipment, an operator wants the inverse of
the Model grid ("which DPs does the model tie to THIS machine?"). The cut is keyed
on `AddressConfig.deviceId` — the provenance every generated address records —
never on a DP-name convention, which the zone removal would have broken anyway. A
DP qualifies when ANY of its DPE address configs carries the device's id, and then
ALL its rows are shown: the datapoint is the unit an operator reasons about, and a
leaf without a config is information too. The card opens the detail but scrolls
inside its own frame, so the catalog links below stay reachable.

**OPC UA security: the vendor path, and where each piece lives.** The device form
gained a "Sécurité OPC UA" card (user, password, policy, message mode, client
certificate, and the certificate-relaxation checkboxes = `Config.Flags` bits
8–15). Decisions worth their words:

- **only what is declared is written** (`opcuaSecurityWrite` in the core, unit
  tested): an empty field never touches the live connection, and the Flags write
  is read-modify-write — a connection also managed through the standard panel
  keeps its tuning bits (0–7) and everything the studio does not claim;
- **the password is write-through** — a `secret` param kind: `normalizeDevice`
  strips it (no credential in a diffable store, ever), the backend extracts it
  from the raw draft, pushes it through the VENDOR encryption and forgets it. The
  form shows a live "password set" indicator (`Device.passwordSet`, decorated at
  read time from the blob — skipped on the 5 s poll);
- **the vendor encryption is executed, not imitated**: `secureEncode` (inside
  `drvsSecSetPassword`) is an undocumented CTRL internal shipped as a binary
  extension (`bin/windows-64/CtrlDrvSec.dll`), so the panel's own function is
  called from CTRL — by the studio's **resident CTRL manager**, which hosts the
  MSA vRPC service every project write of the page now goes through (see
  [CTRL-MANAGER.md](./CTRL-MANAGER.md)). Two earlier shapes are recorded there
  because their reasons still hold: a one-shot `WCCOActrl` **spawn** per save
  (with its two option traps — `-n` starts a CTRL manager with no Event-manager
  connection, `-config` demands a *registered* config file), and the backend
  **writing** the helper script itself (reverted: the webserver user must not
  need write access to `<proj>/scripts`). The payload carrying the secret is
  encrypted by the service (`MsaPayloadEncryptionMode::Mandatory`), which is
  what the vendor's own `OaAuthService` does for the same reason;
- **the panel's own refusal is kept**: no `_DriverSecurity.PublicKey` → the
  password is refused with a warning naming the fix (create the driver
  certificate in System Management), exactly what `drvsSecCheckCert` does;
- **success is what reads back**: `connectionSecurity.passwordSet` is the
  non-emptiness of `Config.Password` AFTER the run — not the exit code;
- policy/mode pairing is validated in the CORE (`device.security-mismatch`,
  blocking) because the standard panel's combos force the same pairing — and a
  half-declared pair would produce a connection the driver refuses far from its
  cause. A password without a user is an ADVISORY (`device.password-without-user`):
  anonymous login sends no password, but it is a legitimate intermediate state.

**An unknown server name is a REQUEST, and the save honours it.** The picker stays
`editable` precisely so a connection that does not exist yet can be named — and the
save now **creates it** (`provisionOpcUaConnection`): the `_OPCUAServer` datapoint,
written with the tag importer's PROVEN write set (`doCreateConnection`) under the
studio's defaults — `ConnInfo` from the equipment's declarative `endpoint` (empty
when not stated, and the warning says so), no security, no user — then registered
with `_OPCUA<n>` (`Config.Servers` + `Command.AddServer`), `n` being the device's
own `driverNumber` first, else the first running `OPCUAC` driver. Three boundaries,
each deliberate: it only covers **OPC UA** (the one protocol where the studio
references a connection by NAME; the `_S7_Conn`/`_Mod_Plc` config write sets are
not verified in this repo, and an invented one would mis-parameter every register);
a provisioning failure **never fails the device save** (the registry write already
went through — the outcome comes back as `connectionProvision.created: false` with
the reason); and "no driver yet" is a **warning**, not a refusal — an equipment is
legitimately declared before its driver is started. The demo gateway mirrors the
behaviour (the created connection appears in its picker, disconnected), so the
offline demo teaches what a live deployment does.

**The lamps are polled, and they say when they stop being trustworthy.** A read-once
state is a state that is wrong a minute later, so the page re-reads every 5 s through
`GET /devices/state` — the live fields only, merged by id (`withDeviceStates`), never the
registry: a poll landing on a form being filled would overwrite the operator's work. It is
a timer rather than a `dpConnect` subscription because this page's contract is to depend on
`lit` alone (see "the decoupling contract"), and a subscription through the suite's shared
libraries would break the offline demo and the screenshot pipeline. Two behaviours that
matter more than the cadence: the poll pauses while the tab is hidden and fires immediately
when it returns, and after THREE consecutive failures every lamp goes grey with
`probe-failed` (`statesUnreadable`) — a frozen green LED is the one outcome worse than no
LED, and 5 s of tolerance for a reload is not worth turning the screen grey.

What is deliberately NOT done: borrowing the **driver's** state. `_Connections.Driver.ManNums`
says a manager runs, which says nothing about a given station being reachable — dressing
one as the other would be the kind of plausible lie an operator would trust.

## Workspace housekeeping (`forgetInWorkspace`) — the missing half of "generate"

Reported from the field: *"l'onglet control est mal géré, je me retrouve avec des instances
qui attendent d'être créées alors que leurs modèles ont été supprimés. Je n'ai pas la
possibilité de faire le ménage."* Both halves were true, and they were two different bugs.

**The plan was silent about impossible items.** A datapoint staged for creation whose DP
type exists neither in the workspace nor in the project cannot be created — `dpCreate`
refuses it — but `diffWorkspace` emitted the item without a word. It now warns
(`diff.dp-type-missing`) with the names, above the table, because the fix is a click away
there. Deliberately a WARNING and not a check-in blocker: one orphan must not hold back the
rest of a plan, and the applier already reports per-item failures.

**The Control tab was read-only.** Every other panel could add to the workspace; nothing
could take anything out. `forgetInWorkspace(workspace, selection)` is the counterpart, and
its semantics are worth stating because two of the three are counter-intuitive:

| plan row | what "forget" means |
|---|---|
| create | drop the object from the working copy — nothing gets created |
| update | drop it — the live object is left exactly as it is |
| delete | drop its BASELINE key — the workspace stops claiming the object should go |

That third line is the trap. A plan says *delete* because the object is in the check-out
baseline and absent from the workspace, so removing an object from `types`/`dps`/`configs`
**without** its baseline key turns a pending creation into a pending DELETION in the live
project — the exact opposite of housekeeping. One test does nothing but pin that
(`drops the BASELINE with the object…`).

It CASCADES and says so: a type takes the workspace datapoints declared with it and their
configs, because leaving them is how the orphans above are created in the first place. The
counts come back in the notice (`1 type, 24 datapoints, 312 configs`) rather than being
discovered in the next diff. And it returns a NEW workspace: a save that fails must not
leave the page holding a half-cleaned copy.

No arming step, unlike the device deletion: nothing here reaches the project, and the bar
says that in as many words. What it discards is staged work, which regenerating restores.

## Signal roles: the rule engine and its calibration

`roles/` qualifies each book entry (measure / setpoint / command / state / alarm /
counter / parameter / unknown) and `roles/profiles.ts` turns a role into configs.
Design decisions worth keeping:

- **Roles live ON the book entry**, so a mutualised catalog (PAC3200, PackML) is
  qualified ONCE and every equipment referencing it inherits the work.
- **Rules are data** (`RoleRule`: id, priority, role, `when` predicate), so a
  project overrides or extends the shipped set without touching code. Ids are
  stable for precise replacement.
- **Three layers by priority** — structural (10-19) < path/prefix (20-29) <
  name & convention (30-49). Two subtleties that cost tests to find:
  - **physical-quantity names sit at 21, BELOW the path rules**: `Temperature`
    says *what* is measured, `Consignes.` says *what for* — a setpoint of a
    temperature is a setpoint. They stay above the structural rules so a
    `%MW`-located (hence writable) `Pression_Reseau` is still a measure;
  - **energy units qualify counters** (`kWh`, `kvarh`, `kVAh`) because vendor
    namings often carry no keyword (PAC3200 `Eact_import_T1`). Volume/time units
    (`m³`, `h`) are deliberately NOT in that rule — they may be a level or a
    duration measure.
- **Determinism + explainability**: priority desc then first match, ties resolved
  by array order; the matching rule's `note` is the UI tooltip. Trust requires a
  reason.
- **Manual always wins** and is preserved across a rule re-run (the gateway keeps
  the overrides and re-qualifies on top).
- **No silent default**: an entry no rule matches stays `unknown` and is surfaced
  as a "N à qualifier" chip + a filter.
- ⚠️ JavaScript has **no inline regex flags**: `(?i)` throws. Patterns are
  compiled case-insensitively and a leading `(?i)` is stripped for tolerance —
  a bad project pattern never matches and never throws.

### Models and INSTANCES: two trees, and one propagation

Field request: the Model tab's first level should be the **models** (authored by hand
or mirrored from a catalog), each node carrying its archiving/alarming; the Control
tab becomes **Instances**, level 1 the models and level 2 their instances, showing
which device each is applied to; and *"si on change des configurations au niveau du
modèle il faut que cela actualise les configurations au niveau des instances"*, with
a check-in/check-out status **global and per instance**.

> The Model side of that request has since been re-shaped by the next one (see *The
> Model tab as MASTER–DETAIL* below): the models are the **list on the left**, not the
> structure tree's own first level, and `eng-structure-tree` went back to being about
> one thing — the selected model's branches. The Instances tree is unchanged.

**An instance is DERIVED, never stored** (`instances.ts`, unit-tested). It is a
workspace datapoint whose DP type is the model's, plus the device its address
configs record (`AddressConfig.deviceId` — the provenance every generated address
already carries). A stored list would be a second truth to keep in step with the
workspace, and the first hand-edit would make the two disagree. What an operator
asks — "what did this model produce, and where?" — the workspace already answers.

**The STATUS comes from the check-in plan**, not from a second computation: an
instance is `synced` when no plan item mentions it, else it carries the strongest
verdict on it (conflict > create > delete > update). Two decisions inside:

- the **type item is NOT attributed to the instances**. The DP type belongs to the
  model, so letting it mark each instance "to update" would report N pending changes
  for one edit — exactly the noise the per-instance status exists to remove.
  `modelStatus()` reports it once, on the model row;
- **no plan means `synced`**, not "unknown-so-pending": with nothing to compare
  against, claiming a pending change would be an invention.

The global line counts INSTANCES, not plan items: "312 configs pending" and
"2 machines pending" are the same fact and only the second is actionable.

**Propagation is a re-generation, and it stops at the workspace.** Saving a model
re-applies its current structure, mappings and policy to every instance it already
produced (`instanceTargets` → `generateModelFromBook` per instance → `mergeProposal`),
and a per-model "Réappliquer" button does it on demand. Two things it deliberately
does NOT do: touch the live project (it is a workspace edit, so the tree then shows
the instances as "to update" — the truth until someone checks in), and hide the
repetition (the same generator warnings come back once per instance, so they are
de-duplicated by code+params before being shown).

The **diff table stayed**, below the tree: the flat list answered the wrong question
first ("312 configs to write" where the question is "is my model applied everywhere
and checked in?"), but it is the evidence of what a check-in would write. Summary
first, evidence underneath.

### The Model tab as MASTER–DETAIL, and a model reading SEVERAL catalogs

Field request: *"dans l'écran model, il faut pouvoir ajouter/supprimer/éditer un modèle
(liste à gauche des modèles) dans la partie droite voir/éditer le contenu du modèle […]
il faut pouvoir créer un modèle à partir d'un ou plusieurs catalogue en mirroring ou en
créant chaque branche du modèle et en le liant au(x) catalogue(s) puis en faisant le
mapping pour chaque branche."*

**The split follows what each action changes.** "New" and "delete" change *which models
exist*, so they live in the left list (as the head's `plus` / `trashcan`); the sources,
the structure, the mapping, the policy and "save" change *one model*, so they live in
the detail. The previous single column stacked all of it, and "which model" competed
with "what is in it" for the same width. The save button reads *"Mettre à jour le
modèle"* once a model is selected — the same click, but it stops looking like it would
create a second one.

The workspace grid that used to occupy the right half **moved to the Instances tab**:
it shows what the models *produced* (DPEs, addresses, configs, live values), which is
that tab's subject, not the authoring column's.

**One model, several catalogs.** The source is no longer one `ix-select` but a
check-list, because the field case is a machine described in more than one place: two
TIA DBs of the same PLC, or a TIA export beside the OPC UA browse of the same equipment.
The first one checked is the **primary** and the others are extras:

| | primary | extras |
|---|---|---|
| mirroring | mirrors THIS catalog | not mirrored |
| mapping | offers its signals unqualified | offers its signals as `bookId::path` |
| default mode/connection | answers for unqualified bindings | each leaf keeps ITS OWN catalog's interface |

The qualified binding (`bindingRef` / `parseBindingRef`, `BINDING_SEPARATOR = '::'`) is
what makes the multi-source case honest rather than convenient: two catalogs may hold
the *same* signal path, and the binding has to record which one was picked. And because
`Leaf.interface` travels with the leaf, an address is written through the driver and
connection of the source it came from — an S7+ branch and an OPC UA branch can therefore
coexist in one type, which is exactly why a single per-generation `mode` was not enough.
Three core tests pin it (per-leaf resolution, a binding whose catalog is absent → a named
warning rather than a silent skip, and both binding shapes parsing).

⚠️ Unchecking the primary **promotes an extra** instead of leaving the model without one:
mirroring and unqualified bindings both need a primary, and "no primary but three extras"
would be a state with no defined answer.

### Defining a model vs APPLYING one: the generator left the Model tab

Field request: *"il faut supprimer Generate the model from this book, remplacer les petits
boutons d'icônes par de vrais boutons Nouveau et Supprimer, dans la liste des modèles
visualiser les catalogues liés, pouvoir ajouter une description pour le modèle. A la
création d'un modèle il faut pouvoir donner le nom et la description. ensuite on choisit
les source catalogue et face à chaque catalogue on indique si on veut créer la structure
par mirroring"*.

Removing the generator forced the question the two tabs had been sharing: **defining** a
model and **applying** it are different acts, and generating produces *instances*. So the
form moved to the Instances tab, onto the model row it instantiates, and lost everything
the model itself answers — the type name, the structure mode, the catalog picker. What is
left is the two things an instance adds: the equipment names and the target device.

Two consequences worth stating:

- **instantiation reads the STORED model** (`onCreateInstance` → `modelSources` →
  `runGeneration`), not the editor's state. Generating twice therefore gives the same
  result, and a model whose primary catalog was deleted fails naming that catalog instead
  of producing a type with no addresses. The editor path survives only as the
  demo/screenshot hook (`generateForDemo`), which mirrors a catalog directly;
- **`genMode` is gone.** Mirroring was a generation *mode* — and a mirrored generation
  could not be saved as a model, which was a real hole (the shape you had just produced
  was the one thing you could not keep). It is now an **action that fills a model's
  structure**, so what is stored is always the same object whether it was typed or
  mirrored.

**Per-catalog mirroring** is the other half. Each source row carries two checkboxes that
answer different questions — *does the model read this catalog* (its signals join the
mapping) and *does it shape it* (its paths build the structure) — and the second is stored
on the model (`ModelSource.mirror`), because a mirrored branch has to be rebuildable when
that catalog is re-browsed and only the model knows which of its sources it mirrors.
`mirrorStructureFromBooks` (core, unit-tested) merges the marked catalogs: the prefix
shared by every mirrored signal of every source is stripped **once** (two DBs therefore
keep their own root branches instead of collapsing onto each other and colliding), the
catalogs are merged in order, and a branch two of them both claim is **reported, not
absorbed** — a type whose branch silently read another catalog's signal is the failure
worth refusing. Toggling a flag rebuilds immediately (a stale structure would contradict
what the model says it reads) while the deployment policy is kept, so a branch that comes
back keeps its alarm/archive decision.

**A model now carries a description**, and the list row shows it next to the catalogs the
model reads. Both were invisible before: a project with a dozen house standards showed a
column of type names, and nothing said which machine or which export each one was about.
Creation is a step of its own for the same reason it is stored empty and at once — name
and description first, then the catalogs and the mirroring, each saved against a record
that already exists rather than into a form that might be abandoned.

⚠️ `sourceBookId` is **kept** beside the new `sources[]` and stays authoritative for the
primary: models saved before this read as "one source, not mirrored" (`modelSources`)
instead of appearing to have no catalog at all.

**Three corrections after the first pass at this request** — the first version kept more
than the request allowed, and each of the three is worth recording as a rule:

1. **A relocated form is still the form.** "Generate the model from this book" had become a
   bordered panel with a title inside the Instances tree — the same object, one tab to the
   left. It is now a **row of the tree** (`renderInstanceDraftRow`): two fields and a
   check, in the place where instances are listed. Nothing about a datapoint on an
   equipment needs a panel of its own.
2. **Chrome counts as content.** The model's detail column carried, around the tree, a
   tree/text toggle, an auto-map button, a mapped counter, TWO explanatory paragraphs and
   a coverage sentence. What survives is one status line — the mapped count, "map
   automatically", "update the model" — and the tree. The outline *text view* went with
   the toggle; the outline remains the storage format (`formatStructureOutline`), so
   nothing is lost from the model store, only from the screen.
3. **One decision, one form.** Creating a model asked for the name and the description,
   then the sources and their mirror flags in a second place. All of it is asked at once
   now, and nothing is written until "Create" — the previous flow stored an empty model
   first, which put a half-defined record in the list the moment someone lost interest.
   `onNewModel` also RESETS the source selection: a new model was inheriting the catalogs
   of whichever model happened to be open, which is the kind of default that gets saved
   unnoticed.

Two smaller things the same pass fixed, both of which had made the screen contradict
itself: three messages still told the operator to "pick the target equipment then
generate" / "see the Control tab" (neither exists), and the Instances tree's
`max-height: 22rem` silently hid every model past the fourth — in the one tree whose first
level IS the list of models. Plus an icon name that does not exist in `@siemens/ix-icons`
(`single-check`, rendered as an empty box); the fix is `check`, and the same audit — every
`icon="…"` matched against `node_modules/@siemens/ix-icons/dist/ix-icons/svg/` — is worth
re-running whenever icons are added.

### Editing a model: an explicit mode, an action for mirroring, and lists for the references

Four field requests, all on the model editor, and each one removes a way to be wrong:

**1. Read-only until "Éditer", then Save / Cancel.** Saving a model **re-applies it to
every instance it already produced** (`onSaveModel` → `onReapplyModel`), so an
always-editable form puts the project's datapoints one keystroke away. The fields are
inert until `modelEditing`, every change lives in page state, and Cancel restores the
record by *re-reading it* (`onCancelModelEdit` → `onLoadModel`) rather than keeping a
second copy that could drift. Creating a model counts as editing (`editingModel()`), and
`onCreateModel` lands straight in edit mode — asking for "Edit" one click after "Create"
would be ceremony.

**2. Mirroring is an ACTION (⧉ per catalog), not a stored flag.** The flag made "this
model mirrors that catalog" look permanent, which it is not — the branches can be renamed,
re-mapped or deleted afterwards. `mirrorIntoStructure` (core, unit-tested) therefore
MERGES one catalog into the structure already there, brings each added leaf bound to its
signal (that is the automatic mapping, by construction), and **leaves every branch the
model already has untouched**, counting them in a warning. Pressing it again after a
re-browse adds what is new without undoing anyone's work. `ModelSource.mirror` is gone
with the checkbox.

**3. Every mapping is QUALIFIED — `catalogue::chemin`, the first catalog included.** It
used to be qualified only for the second and later sources, which made a binding's meaning
depend on *which source happened to be first*: promoting another catalog to primary
silently re-pointed every bare binding. Now nothing depends on the order.
`parseBindingRef` still resolves a bare path against the model's own book, so older records
keep working, and `onLoadModel` re-qualifies them on open — which is what stops them
reading "not mapped" against a signal list where every option names its catalog.

**4. The alarm class and the archive group are PICKED from the project.**
`GET /api/eng/config-options` returns the `_AlertClass` datapoints and the usable
`_NGA_Group` ones. Both are datapoint names the runtime resolves (`_alert_hdl.._class`
stores `<class>.`, `_archive.1._class` the group), so a value typed from memory produces a
config WinCC OA rejects — the studio now offers what exists. The two readings are the ones
already proven elsewhere in this repo rather than new guesses: `libs/wui-para`'s Alarming
tab for the classes, `libs/wui-fleet-core`'s store for the groups, including its two
exclusions (`active`, and `isAlert` — `_NGA_G_ALERT` archives alarms, not process values).
The control is an `<input list>`: the project's list **and** free entry in one field,
because a class created after the read must stay usable and an empty list means "could not
tell", never "nothing allowed".

⚠️ Two traps this pass hit, both worth remembering. The demo registers iX icons
**explicitly** (`demo/ix-bootstrap.ts`) so a missing one shows up in a screenshot — `copy`
and `close` were not registered, and rendered as empty boxes; that file is the checklist to
update when a new icon is named. And the webserver's own `tsc` is stricter than the page's:
`new Set(win().dpNames(...))` inferred `unknown[]` there while the page compiled clean, so
a deploy failed on code that typechecked locally — annotate the `dpNames` result.

### What a model says about ALARMING, and why applying a big catalog got fast

**A class is not enough to describe an alarm.** `LeafPolicy.alarm` therefore carries two
more things, and both are choices the model has to be able to state:

- **`goodRange`** (BOOL leaves) — which value is healthy, i.e. `_alert_hdl.._ok_range`. It
  used to be derived from the role profile's direction, and that is wrong on every
  active-low signal: a safety chain healthy at TRUE would have been armed inverted. The
  default is still `false` for the `alarm` role (a fault bit is healthy at FALSE), but it
  is now a stored decision rather than a consequence.
- **`thresholds` + `direction`** (numeric leaves) — N limits, N+1 ranges, which is what
  WinCC OA's analog alert handling models. `generateModelFromBook` switches a leaf to
  `kind: 'analog'` as soon as thresholds are pinned (never for a BOOL, which cannot be
  analog), sorts them, and passes the leaf's value range as the outer bounds. With no
  threshold the alert stays the binary one the role profile always produced, so the screen
  and the generation agree about what "no thresholds" means.

The alert CLASS and the archive GROUP are now picked, not typed (`/api/eng/config-options`),
with a **magnifier** beside each: a search over the project's datapoints
(`GET /api/eng/dps`, capped, truncation reported). The lists cannot be exhaustive — a class
created after the page loaded, one named outside the convention — so there has to be a way
past them, and it is not "type it from memory".

**Applying a 331-signal catalog was slow, and the cause was quadratic markup.** Three fixes,
in the order they mattered:

1. **the signal picker of every leaf carried the whole catalog.** 331 leaves × 331 options is
   110 000 `<option>` nodes per render. They are now filled ON DEMAND: a closed picker
   renders exactly the one option it displays, and the full list arrives on the first
   pointer/focus (`openPickers`). This is the whole difference between seconds and instant;
2. **one `<datalist>` per leaf** for the classes and the groups — 662 duplicated lists on
   that same catalog. There are now two, rendered once for the tree;
3. **`sourceEntries()` re-qualified every entry on every render.** Memoised on what it
   actually depends on (the checked books + the role filter).

The leaf bullet went at the same time (a `circle-dot` icon that read as an unselectable
radio button) — which also removed 331 Stencil components from that tree.

**The model ↔ DP TYPE status** answers a question the list could not: is this model still
what the project holds? `modelSyncState` compares the two structures on the same
`fingerprint` the check-in diff uses (so "changed" cannot mean two things), against the LIVE
snapshot rather than the workspace — the question is about the project, not about what is
staged. `absent` is not a warning: a model authored today has produced nothing.

### Polling or subscription — a second decision the address did not carry

Field question: *"comment me conseillerais-tu d'intégrer la gestion polling ou par
souscription sur OPC UA ?"* — answered by asking, and the answers are the design:
subscription for **TA/TS** (alarme + état) and polling elsewhere; the choice **per leaf,
with the role's default**; **two modes only** (no third "on demand" one, even though the
driver has `*_ON_USE` directions); **three poll groups** — fast 500 ms, normal 1 s, slow
10 s.

**The address format is the part that could not be guessed, and it was given rather than
inferred**: `Connexion$Souscription$1$1$NodeId`. Field 2 empty is polling; filled, it names
the subscription — and it names it **without** the leading `_` of the `_OPCUASubscription`
datapoint it refers to. That is why the reference is now built in two steps
(`buildOpcUaReference(conn, nodeId, subscription)` and `withOpcUaSubscription`, which
rewrites field 2 of an existing reference): a model may be re-pointed at another
subscription without re-deriving the address, which is exactly what changing the mode of an
already-mapped leaf does.

**What lives where matters more than it looks.** The address carries only *which*
subscription; the publishing interval, the sampling interval and the deadband are attributes
of the `_OPCUASubscription` datapoint (`Config.RequestedPublishingInterval`,
`Config.MonitoredItems.DataChangeFilter.*` — read in the vendor's own
`opcuaDriver_plugin.ctl`, not from memory). So the studio **lists** subscriptions and never
creates or tunes one: tuning is a project-wide decision that belongs in PARA, and a studio
that silently created a subscription per model would produce a project nobody can reason
about. Same reasoning as the archive group and the alert class: the model holds the *name*,
the project owns the *thing*.

**`_poll_group` is now written exactly when the direction is a polled one**
(`isPolledDirection` — 3, 4, 7, 8, 11, 13). It used to be written always. A poll group next
to a spontaneous direction is not an error the runtime reports; it is a config that stays
there, is never used, and reads as a bug the first time someone audits why a subscribed tag
names a 10 s group.

**The two new fields also had to reach the DIFF, and for a while they did not.** A poll group
and a subscription were compared but never read back, so `fingerprint(workspace) !==
fingerprint(live)` for every address carrying one — and since the studio injects `_Poll_Normal`
by default, that was *almost every address*, permanently "à mettre à jour", one check-in after
another. The fix separates the two because they are not the same kind of value:

- the **subscription** is not an attribute at all — it IS field 2 of the reference, which the
  diff already compares. It is dropped from the comparison; nothing is lost, and re-pointing a
  leaf at another subscription still shows as a change because the reference says so;
- the **poll group** IS written (`_address.._poll_group`), so it is now READ BACK and compared
  **by token** — the model carries the name (`_Poll_Normal`), the project holds the dpid it
  resolves to (`System1:_Poll_Normal.`), and verbatim the two never match. Same treatment as the
  archive group beside it, for the same reason. It is compared only on a POLLED direction, which
  is the only direction the builder writes it for: a stale group left on a subscribed DPE would
  otherwise differ for ever, since no write would ever clear it.

`comparableConfigs` is now exactly *what `buildAddressWrite` writes* — that is the invariant, and
`modelgen.spec` pins it end to end: **a freshly generated model, written and read back, must diff
to nothing**. Twice a field reached the comparison without reaching the read-back (this pair,
then the historical flag); the guard catches the third at the source.

**The rule is now visible where it is decided — in the CATALOG.** The role already decided
poll-or-subscribe (`defaultLeafPolicy`), but the answer only appeared one screen later, in the
model's structure tree, one leaf at a time. Qualifying a catalog is precisely when an engineer
asks *"how many of these end up subscribed?"*, so the Books table carries an **acq.** column
beside the role that produces it — read-only there, because the role decides it and the
per-element override belongs on the model. Two exceptions, both mirroring the generator rather
than the intention: an **unqualified** signal shows a dash (no role → no config at all, so no
acquisition to promise), and a **non-OPC-UA** catalog shows polling whatever the role, since a
subscription there falls back to polling anyway.

**A mode that cannot be honoured degrades loudly.** `spont` requires an OPC UA leaf *and* a
named subscription; anything else (a Modbus leaf marked TA, an OPC UA leaf whose
subscription field is empty because the project has none) **falls back to polling** and
emits `SUBSCRIPTION_MISSING` with the leaf's path. The alternative — writing an
`INPUT_SPONT` address on a driver that never pushes — produces a datapoint that simply never
updates, which is the worst failure mode this page can ship: everything looks configured.

### The connection of an INSTANCE is the instance's, not the catalog's

Field report: *"le nom de la connexion à l'instanciation doit être tiré de la connexion et non
de la connexion utilisée lors de l'import par browsing du catalogue"*.

**It was broken in two places at once**, and either one alone would have hidden the other:

1. the studio passed `bindConnection: book.interface?.connection ?? device?.name` — the
   catalog's browse connection **first**, so the target equipment never got a say;
2. `resolveReference` only substituted a **`<placeholder>`**. A catalog browsed online carries
   a **concrete** server in field 1, so even with the right target it was left untouched.

That is exactly the case **mutualisation** exists for: browse one machine, deploy the five
identical ones beside it. Every instance ended up addressed to the machine the catalog came
from — a plant reading one PLC five times and reporting the other four as healthy, with no
error anywhere, because each address is individually valid.

**Now**: the call sites pass `connectionNameOf(device) ?? book.interface?.connection`, and the
generator re-points **field 1 alone** of an OPC UA reference through `withOpcUaConnection` — the
subscription, the kind, the variant and the NodeId stay the catalog's, as rebuilding an address
from parts the catalog no longer has is how a working reference gets corrupted.

`connectionNameOf` lives in the core beside `PROTOCOL_PARAMS`, because *which* parameter names
the connection is the protocol spec's business: it is the declared `server` (the `_OPCUAServer`
datapoint without its `_`), the display name only when nothing was declared. `device.name` was
never the right answer — it just happened to be right whenever the two matched.

A re-pointing is **stated**, never silent: `modelgen.connection-repointed` names each
`browsed → target` pair. And a non-OPC-UA reference is left alone: S7 and Modbus carry no
connection field (S7Plus has `_address.._connection`, which is a separate attribute).

> Per-leaf interfaces (a MULTI-catalog model) keep `leaf.interface?.connection` first: those
> catalogs were each browsed on their own server, and both are real. Only the primary book's
> leaves — every single-catalog model, which is the case the report is about — take the target.

### The catalog's `H` column now reaches the address — `_address.._offset`

Field request: *"quand les points qui sont notés Historic en OPC UA doivent activer la case
Historical dans l'adresse WinCC OA"*, then *"tient compte aussi de l'access défini dans le
catalogue R (IN) ou RW (IN/OUT)"*.

The catalog already knew: `BookEntry.historized` carries the server's own statement (the
`Historizing` attribute of a NodeSet variable, or the `HistoryRead`/`HistoryWrite` bits of
its `AccessLevel`) and the Books table shows it as the **H** chip. It only fed the ARCHIVE
default. **It now also decides the address**, because the WinCC OA address has a box for
exactly that question and leaving it unchecked is a decision nobody took.

**Which attribute, and how it was verified.** The "Historical" checkbox of the OPC UA address
tab is **`_address.._offset`** (0/1). Not from memory and not from the online help (which
describes `_offset` as "optional driver-specific address information"): from the vendor's own
installed code — `scripts/libs/opcuaDrvPara.ctl` reads the `cbHistory` shape into `dpc[10]`
and `scripts/libs/para.ctl`, `case "opcua"`, writes `dpc[10]` to `_address.._offset`. The
panel's tooltip states the semantics: *"Determines if this address is included in historical
queries"*. It is recorded in `VENDOR-ADDRESS-TRANSFORMATIONS.md` beside the transformation
tables, for the same reason those are there.

**Two conditions, and the second is the access.** A leaf gets `historical: true` when the
source historizes it **and** the address READS — which is the catalog's access mode turned
into a direction: `r` → IN (`INPUT_POLL`/`INPUT_SPONT`), `rw` → IN/OUT (`IO_POLL`/`IO_SPONT`),
`w` → OUT. An `OUTPUT` acquires nothing, so asking the server for its history configures a
read that never happens; `isReadingDirection` is the predicate, next to `isPolledDirection`
and for the same reason.

**Driver specific, so it is written and read back for OPC UA alone.** On Modbus the very same
`_offset` is a **bit count** (`modDrvPara.ctl`). The builder honours the flag only when the
address mode is `opcua`, and the read-back reads `_drv_ident` beside `_offset` — a Modbus bit
count read as a history flag would report every such address as modified, one check-in after
another.

**A historical address is written INACTIVE** (`_address.._active = false`). Field rule, and
it follows from what the flag is for: the signal is already historized on the server, and the
project reads that history through a **HistoryRead** request — the driver's *method 3*, which
matches the peripheral address and fills `_archive` directly. An ACTIVE address would poll (or
subscribe to) the very same signal and archive it a second time. The address still exists with
all its attributes, which is exactly what `_active` means in the vendor's words: *"an inactive
address exists and keeps its attributes, but the driver does not use it"*. Activating it is one
checkbox in PARA the day a signal needs its live value too.

> **To verify in the field.** The vendor documents that method 3 *"only performs a read request
> if the `_offset` attribute is set"* (`OPC_UA/opc_ua_c_historical_access.html`, *Notes &
> restrictions* — `_offset` bit 0 = "historical data available"). It says nothing about whether
> an **inactive** address is still matched by the request's `HW.HWMask` filter. If a backfill
> comes back empty, that is the first thing to test.

**Absent, never `false`.** `AddressConfig.historical` is set to `true` or left out. The
check-in fingerprint drops `undefined` keys, so "the model never decided" and "the box is
unchecked" are the same string — which is what keeps the diff from inventing a change. The
generation reports how many addresses were flagged (`modelgen.historical-addresses`), the model
grid shows the **H** chip next to the direction, and an inactive address is dimmed in the same
grid — so both answers are visible without opening PARA.

**One thing was wrong beside it**: the grid's direction column read `IN` for a *subscribed*
`rw` leaf, because `dirLabel` only knew `OUTPUT` (1) and `IO_POLL` (7) — `IO_SPONT` (6) fell
through to `IN` and denied a write path the address really carries. It now covers every
direction the driver defines.

### AMEND, never re-create — and the Instances tab as master–detail

Field request: *"en cas de mise à jour du modèle il faut pouvoir le faire unitairement par
modèle ou de manière globale pour tous les modèles, dans ce cas il faut mettre à jour le DPT
sans le recréer et compléter ou mettre à jour le paramétrage des configurations des DP
(instances). ne jamais recréer complètement un DPT ou un DP (sauf si explicitement demandé
via un bouton spécial)"*.

**The applier already amended; what was missing was the guarantee and the escape hatch.**
`applyItem` calls `dpTypeChange` on an existing type and skips an existing datapoint (its
configs are separate items, so they are (re)written either way). That is now stated in the
code, pinned by two tests — one proving the datapoints survive a type update, one proving
`recreate` really deletes and re-makes — and reachable: `ApplyOptions.recreate` flows from a
per-model **Recréer…** button through `/api/eng/checkin` to the core. Two clicks (armed, like
the device delete), scoped to that model's own plan items, and the warning says what it
costs: re-creating a datapoint drops its archived values.

**Per-model and global updates** are the same operation: `onReapplyAll` runs
`onReapplyModel` over every model that has instances, **sequentially** — each pass merges
into the workspace the previous one produced, so running them concurrently would race on
that single value.

**The Instances tab became master–detail**, deliberately the same shape as the Model tab:
one is "what a model IS", the other "what it PRODUCED", and an engineer should not have to
re-learn where to click between them. The left list repeats the Model tab's sync chip
(`modelSyncState`) beside the DP type name; the right pane shows each instance with its
status AND the DPEs it carries, because "diverged" without the address / alarm / archive /
range cells is a verdict with no evidence. The old two-level tree, its expand/collapse state
and the workspace-wide signal grid went with the change — the grid was the same rows without
the per-instance grouping, and the test-read it carried moved to the panel header.

### Why the check-in was slow, and the two fixes

The symptom an operator sees is a button that hangs; the log said where the time went —
`engController: running driver managers = [...]` once **per DPE**. Two independent costs:

1. **A driver lookup per address.** `resolveAddressContext` → `detectDriver` re-read
   `_Connections.Driver.ManNums` plus one `_Driver<n>.DT` per running driver, for every
   address of the plan. Now memoised on the PORT, which lives for exactly one check-in — so
   the cache cannot go stale within a run, and the old code was no fresher anyway (the first
   address already fixed the answer for the whole write).
2. **A round-trip per config.** `applyPlan` sent one `dpSetWait` per config family per DPE.
   Consecutive config writes are now merged into as few calls as `ApplyOptions.batch` allows
   (400 pairs by default), which turns a thousand-DPE model from thousands of round-trips
   into a handful.

Three rules keep the bulk path honest, and each is a test:

- **a multi-step write is never merged.** The analog alert handling is a proven SEQUENCE
  (type + orig_hdl → the ranges → active); folding it into one transaction would write ranges
  before the type that gives them meaning. Single-write configs (address, archive, range,
  binary alert) batch freely;
- **an item is flushed before any type/datapoint item**, because a config can only be written
  after its datapoint exists;
- **a failed batch is replayed item by item**, so the report still names the offending DPE
  instead of blaming the four hundred that travelled with it.

⚠️ The CTRL manager needed no change: its `DpSetWait` always passed the arrays straight to
`dpSetWait`, so a bigger call is simply a bigger transaction.

### A catalog goes OUT of a model the way it came in, and a model may start from a DPT

Two symmetry fixes, both from using the screen:

**Un-ticking a source was not removing it.** It stopped OFFERING its signals; the branches it
had contributed stayed, bound to a catalog the model no longer read — a model that cannot say
what it does. Each source row now carries the counterpart of its import button:
`removeSourceFromModel` (core, tested) drops the branches that READ that catalog, their
mappings and their policy, prunes the groups they emptied, and un-ticks the source in the
same gesture. What decides is the BINDINGS, not a memory of who added what — so a branch
someone re-mapped onto another catalog stays, because it is no longer that catalog's.

**A model may PARAMETERISE an existing DP TYPE.** `GET /api/eng/dptypes` lists the project's
types (internal ones excluded) and `/dptypes/:name` reads one structure on demand — reading
them all to fill a picker would cost far more than the one that gets picked. The creation form
copies that structure with **no bindings**: the branches exist, what each reads is the next
decision. That is the path for a project engineered in PARA before the studio arrived, and it
is why "New" is now three doors (empty, an existing type, or a catalog import) rather than one.

⚠️ **It targets that type, it does not clone it.** The first version derived the model's
`typeName` from its NAME, so a model built on `Equip_Four` and called anything else generated a
SECOND type beside it and left the datapoints of the first unconfigured — the exact opposite of
"parameterise this DPT". A model's `name` (a label) and its `typeName` (the type it writes) are
therefore two separate fields now, `genModelName` and `genTypeName`; picking an existing type
sets the second one to that type's own spelling, and the structure is stored **as read**, so the
diff finds the type identical and writes configs only.

**Icons, reviewed as a set** (and audited against the installed `@siemens/ix-icons`):
`import` = pull a catalog's paths into the model, `link-break` = take them out, `plus` = new,
`pen` = edit, `trashcan` = delete, `refresh` = re-apply, `reset`-like destructive actions keep
their own label. Two names were rendering as EMPTY BOXES — `copy`/`close` were not registered
in the demo bootstrap (found earlier), and `icon="chip"` in `eng-books.ts` does not exist in
the set at all (now `hardware-cabinet`). The audit is two greps and worth re-running whenever
an icon is added: every `icon="…"` must have an SVG in the package AND a line in
`demo/ix-bootstrap.ts`, which is what makes a missing glyph show up in a screenshot instead of
on a deployment.

### "It says not created, and lists no instance" — four causes, one rule

A model created on the existing type `AGV_Vehicle_Model` reported **not created** beside a type
that exists, and **no instance** while the project held several. Four independent reasons, all
the same mistake — reading the WORKING COPY where the question was about the PROJECT:

1. **the live read never asked for that type.** `liveScopeOf(workspace)` derives the scope from
   the working copy, and a model that parameterises an existing type describes nothing there
   yet. The page now unions in the types its MODELS target (`liveScope`), which is what makes
   both the type and its datapoints visible on the first paint;
2. **`liveScopeOf` ignored the types of the workspace's own datapoints** — so a datapoint
   staged against a project type was diffed without ever reading the live side, and reported
   "to create" although it exists. Fixed in the core, with a test;
3. **`dpNames` answers with the SYSTEM PREFIX** (`System1:AGV_01.`) as soon as the project is
   named or distributed, while a workspace holds `AGV_01`. The live snapshot now bares the
   names, as the rest of the controller already did;
4. **a failed `dpTypeGet` skipped the datapoint listing** of that type entirely (`continue`),
   so every datapoint of it read as absent. The datapoints are now listed regardless, and a
   type that exists but cannot be read is logged instead of being silently dropped.

And the rule that follows: **instances are derived from BOTH sides.** `modelInstances` takes the
live snapshot as well and returns the union — a datapoint the working copy describes (with its
plan status) and one only the project has, which gets the new status `unmanaged` ("dans le
projet"). Calling that one `synced` would have claimed the model was applied to it; hiding it
was the bug. The panel offers **Paramétrer** on it: the instance form opens on that name, and
generating writes the model's configs onto the existing datapoint — which `applyPlan` never
re-creates. That is the path for every project engineered before the studio arrived.

### Error 76: one unknown type must not blank the page

`Cannot load: 76, Invalid argument in function, DP-pattern: *, DP-Type: FraDataloggerModel, no
such type` — and every panel stayed empty. Two mistakes, both mine, both from the previous fix:

1. **`dpNames('*', <type>)` is illegal for a type that does not exist.** Listing the datapoints
   "regardless" (so an unreadable structure would stop hiding existing datapoints) removed the
   `continue` that had also been protecting this call. A model whose target type nobody created
   yet is a perfectly normal state — and the live scope now deliberately includes such types, so
   the read has to tolerate them. `typeExistsIn` is asked FIRST, and the type is skipped when the
   answer is no.
2. **One type could fail the whole snapshot.** `readSnapshot` feeds the first paint and the plan,
   so an exception from any single type surfaced as "could not load" with nothing on screen. Each
   type is now read in its own `try` (`readTypeInto`), skipped and logged on failure — the rest of
   the project is still read.

The rule worth keeping: **this read is a screen's data source, so its failure mode is per item,
never per request.** Same reason the driver list, the alarm classes and the archive groups all
degrade to an empty list rather than a 500.

### Folding the structure

A mirrored DB is hundreds of branches, so the groups fold (their chevron is the control) and two
buttons above the tree fold or unfold **every** group at once, with a count of how many are
folded. Local render state (`collapsed`), like the lazily-filled signal pickers: it is about
reading the tree, not about the model, so it is not stored with it.

### Two verdicts about one DP type, and a check-in per scope

**"to update" beside "not created".** `statusOf` folded every non-`dp` plan item into `update`,
type items included — so a model whose DP type does not exist reported "to update" next to the
sync chip's "not created". The fold is right for CONFIG items (creating a config on an existing
datapoint IS an update of that datapoint) and wrong for a type, which now keeps its own
operation. Two tests pin it: a type to create reads `create`, a type whose structure differs
reads `update`.

That was the visible half. The other half is that the screen asked the same question twice, from
two sources — the plan and the live comparison — and showed both answers. It now shows **one**
(`renderTypeVerdict`): the plan when it has something pending on the type, the project comparison
otherwise. Two sources for one fact will always find a way to disagree.

**Check-in per scope.** The panel's Check-in writes the whole plan, which is the wrong grain on a
project with twenty models: an operator wants to apply the one that is ready. The same plan is
therefore filtered — `planItemsForType` (its type, its datapoints, their configs) and
`planItemsForDp` (the datapoint and its own configs, never the type: checking a type in "for one
instance" would write it for all of them) — and applied WITHOUT `recreate`, so the amend
semantics hold: nothing is dropped, nothing is re-created. The destructive path stays the armed
`Recréer` button, and it is the only one that passes `recreate`.

### Three things a model must not be able to ask for

**A first level named after the DP type.** Importing a type read from the project kept its root
node as a member, so the model's first level was one element carrying the type's name with every
real element under it. `dpTypeStructureAsModel` takes the read type's MEMBERS as the model's first
level, renames the root to the target type, and unwraps any duplicated root whatever produced it
(bounded walk, three tests).

**An alarm on something that cannot alarm.** `_alert_hdl` compares a value against a good state or
against ranges, so it needs a value to compare: a **group** is not one, and a **String**, a
**Blob** or a **Time** has none. The studio no longer offers the alarm cells on those leaves
(`isAlarmableLeafType`), the default policy no longer arms the `alarm` role on them, and a policy
or a catalog role that asks anyway is **ignored with a named warning** rather than written as a
config the runtime rejects.

**An archive group that does not exist.** `ESAB.P01.SampleValue` failed with
`dpSetWait … rc=-1 on …:_archive.._type` because the model carried `EVENT` (a token an engineer
types — and the studio's own default) while the project holds `_NGA_G_EVENT`: `_archive.1._class`
must name the DATAPOINT. The port now resolves it, exactly as it already resolved a driver for an
address (`EngPort.resolveArchiveGroup`): exact match → the first group whose name CONTAINS the
token (`EVENT` → `_NGA_G_EVENT`) → the first usable group with a log line → and only with no
usable `_NGA_Group` at all, a clear error. Resolving beats failing here because one wrong-but-
visible group is correctable, while a failed write loses every config of that DPE.

⚠️ The three share a shape: **a model may hold what an engineer typed, and what the project can
accept is decided at the write, by the side that knows the project.** The core stays free of
runtime knowledge; the port answers for it.

### The DEPLOYMENT POLICY: what a model pins once, and its three defaults

Field request: *"il faut pouvoir créer un modèle de déploiement dans lequel on règle
au niveau mapping les alarmes, les archives, etc. — définir cela une seule fois et
ensuite créer plusieurs instances selon le modèle pour des connexions différentes"*.

So a `ModelTemplate` now carries a third thing beside its structure and its
bindings: a **`policy`** (`ModelPolicy` = leaf path → `LeafPolicy`), edited in the
Model tab's *Déploiement (par mapping)* table and stored with the model. An
INSTANCE is then what it always was — the same model generated for another target
device/connection — except the alarm/archive/range decisions are replayed instead
of re-taken. One test pins exactly that (`replays the same policy for a second
instance`): two devices, identical configs, only `address.deviceId` differs.

The defaults (`defaultLeafPolicy`) are the part worth defending, because each one
refuses to configure something nobody asked for:

| | default | why |
|---|---|---|
| **alarm** | on **only for the `alarm` role**, class `alert` | a fault DP is the one signal whose purpose is to raise something; arming an alert on a measure would put alarms in a project by accident |
| **archive** | on **only when the source historizes the signal** (`BookEntry.historized`) | that is the machine's own answer to "is this worth keeping?", and it is evidence rather than a guess. Every other signal starts un-archived |
| **range** | none | a meaningful range is engineering knowledge (unchanged rule) |

⚠️ **This CHANGED the previous behaviour**: the role profiles used to set
`archive: true` for almost every role, so a generation archived nearly everything
in `EVENT`. Four tests asserted that and were rewritten rather than patched — the
new contract is "archive because the source archives, or because an engineer
ticked it". The profiles still decide the address **direction** (a reconciliation
with the declared access, not a policy), which is why `configsForRole` is still
called.

Absence is not "off" anywhere in this chain: a policy with no `alarm` key takes the
default alarm, and a range needs BOTH bounds before it is recorded at all — a
half-range would be a guess the generator has to resolve.

### Live value: `--` when the DPE does not exist yet

A model is mostly made of DPEs the project does not have. The grid's live column
now shows `--` (with the reason as its tooltip) instead of an empty cell, which
read as "no value" for something that cannot have one until the check-in creates
it. Existence is taken from the LIVE snapshot the page already holds, so it costs
no extra read.

### Neutral profiles (validated choice)

`NEUTRAL_ROLE_PROFILES` keeps the shipped behaviour project-agnostic: one
injected archive group (default `EVENT`), the `alert` class for alarms, a binary
alert on TRUE, direction derived from the role (falling back to the signal's real
access mode). **No `_pv_range` is ever generated by default** — a meaningful range
is engineering knowledge, and a range built from a type's numeric bounds would be
a useless check. A project profile states real bounds when it wants one.

## Model generation (`modelgen.ts`) — decisions

`generateModelFromBook(book, options)` is pure and returns a **proposal**
(`type` + `dps` + `configs` + `warnings` + role counts); `mergeProposal()` folds it
into the workspace, and the existing diff engine turns it into a check-in plan.
Nothing is written until check-in — the generation is a workspace edit.

### Two ways to shape the type: mirror, or author + map

`options.mapping` selects the mode, and it is the ONLY thing that differs — both
modes produce the same `Leaf[]` and everything downstream (datapoints, configs,
descriptions, warnings) is shared:

- **mirror** (default) — the type follows the book's own paths. Right when the
  source is already organised the way the model should be (a TIA DB, a PackML
  interface).
- **custom + mapping** — the engineer authors the target structure and binds each
  of its leaves to a book signal. That is what a HOUSE STANDARD needs: one DP type
  across machines whose PLCs name and nest things differently.

The storage format is an **outline** (`structure.ts`): indentation is nesting,
`Name : Type` is a leaf. It stays the format because it is readable, diffable,
pasteable between projects, and it is what a standard looks like in a spec document.
Switching to custom mode pre-fills it from the MIRRORED structure, so authoring
starts from something that already works, and `parseStructureOutline` never throws:
a bad line is reported next to the editor and skipped.

**Two views, one value.** Shaping a type reads better as a tree than as text, so the
editor offers both — `ui/eng-structure-tree.ts`, in PARA's own grammar (an indented
row per element, its name, its element type, add/delete on the right), with the
outline still editable as text behind a toggle. They cannot disagree because there is
only one value: `genOutline`. The tree parses it, emits a whole new structure, and the
page writes the text back from it. What the tree adds that PARA has no reason to:
each **leaf carries its mapping** (and its ambiguity, if auto-binding could not
decide), so what is still unbound is visible in place instead of in a second flat
list that had to be read against the tree.

The edits themselves are pure and live in the core (`renameStructureNode`,
`setStructureNodeType`, `addStructureChild`, `removeStructureNode`), and every one of
them takes the BINDINGS with it — because a binding is keyed by a leaf's dotted path:

- **renaming a group re-keys every mapping under it.** Not a nicety: without it,
  renaming `DB_Four` to `Mesures` would leave ten bindings pointing at paths that no
  longer exist, and the type would generate with no addresses at all;
- **deleting a node prunes its own** (a deleted subtree binds nothing);
- **leaving `Struct`** drops the children and their bindings; **becoming** one drops
  the leaf's own — a group is not addressable;
- a **rename that collides with a sibling is refused**, because two siblings sharing a
  name make a binding key ambiguous and collapse two DPE names into one;
- an added node's name is made **unique** instead of refused: the "+" button must
  always produce something to type over.

All of it unit-tested (`structure.spec.ts`), the re-keying included.

One parser decision worth keeping: the first line is treated as the type ROOT (and
dropped) **only when it names the type**. `Mesures` followed by indented members is
genuinely ambiguous — root, or a group inside the type? — and eating it would
silently lose a level. Nothing is dropped unless the text says so.

`autoBindStructure` does the tedious part by name, most specific first: identical
full path → the entry path ENDS WITH the leaf path (the usual case, since a book is
rooted at a block or an instance and the structure is not) → leaf name alone.
Comparison is separator- and case-insensitive (`Temp_Produit` ↔ `TempProduit`).
When a pass yields **several equal candidates it binds nothing** and reports them:
`PV.Temperature` matching both `Mesures.Temperature` and `Consignes.Temperature` is
a question, not a coin flip. The UI shows those and offers the choice.

What the mapping mode refuses to hide:
- an **unbound leaf** stays in the type (the engineer put it there) but gets no
  config, and is counted in a warning;
- a **dangling binding** (pointing at a path the book/selection no longer has) is
  named — that is what a re-browse that dropped a signal looks like;
- a **type mismatch** keeps the AUTHORED type (it is the model's contract) and names
  the mismatch, because a `Bool` DPE fed by a `Float` address is a mapping mistake
  far more often than an intended conversion;
- **unused book signals** are counted — a partial model is legitimate, silence is not.

- **Structure from paths.** The entries' dotted paths become nested `Struct`s.
  The **longest fully-shared prefix is stripped** (`DB_Four.` when the whole DB is
  selected): a level shared by *every* selected signal carries no information.
  Selecting a single branch therefore flattens it (`DB_Four.Mesures.*` →
  `Temperature`, `Hygrometrie`), while a multi-branch selection keeps the groups.
  Disable with `stripCommonPrefix: false`.
- **Names are sanitised** through `naming.ts` (`Admin.ProdProcessedCount[0].Count`
  → `Admin.ProdProcessedCount_0.Count`) and de-duplicated per parent, so a source
  path can never produce an invalid WinCC OA identifier.
- **Datapoints** are named after the equipment (sanitised), one per equipment, and
  carry the source comments as DPE descriptions. The **zone** was removed from the
  Model panel (field report: one notion too many for what the name gains) —
  `modelgen` still accepts an optional `zone` prefix, the UI just never sends one.
- **Configs come from the role**, via `configsForRole` — the generator itself has
  no policy. The address reference is the entry's candidate for the chosen access
  mode; a **template placeholder** (`<Machine>$$1$1$…`) is substituted with the
  bound connection, which is what makes a mutualised catalog usable per equipment.
- **Three refusals, each surfaced as a warning** (never silent):
  1. a role of `unknown` → the DPE is created, NO config;
  2. a template catalog with no connection → no address config (the role's other
     configs still apply);
  3. a source type the target driver has **no `_datatype` transformation** for →
     **no address at all** (`modelgen.no-datatype`, naming the types). An address
     whose transformation is wrong reads a plausible wrong value, which is worse
     than a DPE an operator can see is unbound.
- A signal with no address for the chosen mode is reported too (the DPE is still
  modelled — useful for a computed/internal element).

Not generated on purpose: DPE **units** (would need a verified `_common` unit
write) and **analog alarms** (thresholds are engineering knowledge, like ranges).

## Address books (the iba idea), and the S7 access-mode duality

Each device carries a persistent **AddressBook**; entries hold **candidate
addresses per access mode**. For S7 this is deliberate: a **standard**
(non-optimized) DB member has both a classic operand (`s7`: `DB12.DBD4`) and a
symbolic path (`s7plus`/`opcua`); an **optimized** DB member has only symbolic
candidates. Which candidate a generation writes is decided by the **book's
interface protocol**, else the target device's **protocol** — the device-side
"access modes" checkboxes were REMOVED (field request): they taught a second
declaration the workflow does not need, since a device is bound the way its
declared connection speaks, and a machine reachable through a second dialect is
modelled by binding it through a book carrying that interface.
`Device.accessModes` still exists in the model (stored registries carry it) but
is DERIVED — `normalizeDevice` forces it to `[protocol]`.

## SimaticML parser + offsets — verified vs PENDING

- The parser (`simaticml/parse.ts`) + the dependency-free XML reader
  (`simaticml/xml.ts`) turn TIA Openness `Export()` of global DBs and UDTs into
  book entries (UDT expansion, comments, arrays skipped with warnings).
- Standard-block **offset computation** (`simaticml/offsets.ts`) implements the
  classic S7 layout (BOOL bit-packing, word alignment, `String[n]` = n+2, struct
  padding) and is unit-tested.
- ⚠️ **Calibration PENDING on real exports.** The fixtures
  (`wui-eng-core/src/samples/simaticml-fixtures.ts`) are hand-authored against
  the SimaticML v5 dialect. Before production the parser must be re-checked
  against **real** `PlcBlock.Export()` / `PlcType.Export()` files (see
  INTEGRATION "inputs needed"), and the standard-DB offsets cross-checked against
  a live DB. The S7 `_datatype` transformation codes were a **sentinel (0)** until
  the vendor tables were obtained; they are now the verified constants — see
  "`_datatype`: the sentinels are lifted" below. Same "verify against the real
  system, not training data" culture as `docs/wui-para/NOTES.md` (the DPL
  `-filter` work).

## Demo catalogs: sources and verification status

The demo ships two catalogs built from real-world references, both **no-interface
template books** (mutualised across equipments):

- **SENTRON PAC3200** (`data/pac3200.ts`, Modbus) — offsets transcribed from the
  Siemens manual **A5E01168664B-04 §3.9.3** through the VC knowledge-base fiche
  `templates-import-tags-modbus-pac3200` (Industrial Edge import templates,
  SIMPLE 15 / DETAILED 72 profiles). The offset↔notation triplets
  (1 → `40002`/`%MW2`, 65 → `40066`, 801 → `40802`) are unit-tested in
  `drivers/modbus.spec.ts`, and independently corroborated by public Modbus
  integrations (voltage L1 at address 1, frequency at 55). Device facts carried
  from the same source: Big-Endian/Big-Endian (no word swap), `Zero based
  addressing` pitfall, T1 counters at 2801+ vs cumulated LREAL at 801+.
- **PackML** (`data/packml.ts`, OPC UA) — tag names from the OPC Foundation
  "OPC UA for PackML" companion spec (**OPC 30050**) and the OMAC implementation
  guide, cross-checked on a vendor implementation (`StateCurrent` DINT,
  `UnitModeCurrent` DINT, `CurMachSpeed` REAL). ⚠️ The spec reference pages could
  not be opened directly (HTTP 403), so the catalog is a **faithful but
  non-exhaustive subset** and its NodeIds are **illustrative** (`ns=4;s=…`) — a
  real book comes from browsing the machine or ingesting the spec's NodeSet2.
  Both caveats are surfaced as book warnings in the UI, not hidden.

## `_datatype`: the sentinels are lifted

`drivers/s7.ts` and `drivers/modbus.ts` used to return a **sentinel (0)** for
`_address.._datatype`, flagged by a warning, because the constants are driver
specific and we refuse to ship numbers from memory. The vendor tables are now
recorded in [VENDOR-ADDRESS-TRANSFORMATIONS.md](./VENDOR-ADDRESS-TRANSFORMATIONS.md)
(the WinCC OA `_address` appendix — **the vendor host is unreachable from our dev
containers**, so a copy in the repo is what makes the constants auditable), and
every code is asserted one by one in `drivers/s7.spec.ts` / `drivers/modbus.spec.ts`.

Four things the tables changed, none of them cosmetic:

**S7 and S7Plus are two different drivers with disjoint tables.** 700–722 with
driver-flavoured names (`INT16`, `BIT`, `TimeOfDay`) versus 1001–1027 with the IEC
names TIA itself uses (`BOOL`, `UDINT`, `LREAL`). The code that treated `s7` and
`s7plus` as one family would have written an S7Plus code onto an S7 address —
accepted by the API, wrong on the wire. `s7DatatypeCode` now takes the variant as a
**required argument** so the choice cannot be forgotten.

**A missing transformation is not a nearby one.** The classic S7 driver has no
64-bit integer, no 64-bit float, no wide string, no 8-bit signed; Modbus has no
`DATE`/`TOD`/`DT`. Mapping `LReal` onto `FLOAT` would silently halve precision on
every read, so those types return `undefined`, the generator writes **no address**
for them and names them in `modelgen.no-datatype`. Not-configured is recoverable;
wrongly-configured is a field bug that looks like a sensor problem.

**A Modbus book has two possible vocabularies.** A vendor register map says
`REAL`/`UDINT`; a Control Expert export says `EBOOL`/`WORD`/`DWORD`/`TIME`. Under
one shared sentinel that gap was invisible — every code was 0. `modbusDatatypeCode`
now takes a plain string and maps both, normalising `STRING[16]` → `STRING`.

**The lift exposed a wrong demo fixture.** `Catalogue_Pompe_KSB` declared OPC UA
type names (`Boolean`, `Double`) on S7Plus symbolic addresses; with real tables its
signals became unaddressable. The fixture was wrong, not the mapping — it now uses
the TIA names (`Bool`, `LReal`), which is what a book bound over S7Plus must carry.

Still NOT settled by any table, and per-device: the Modbus **byte/word order** and
the connector's **zero-based addressing** option. Those stay device facts, carried
as book warnings.

## Schneider (Modicon) — why a variables export, not the "extended Modbus"

Schneider's **extended protocol over Modbus is UMAS** (Unified Messaging
Application Services), carried on the **reserved function code 90 (0x5A)**: when
a Modicon PLC receives a Modbus frame with FC `0x5A` it hands the payload to the
UMAS layer instead of the standard Modbus handling. This is what Unity Pro /
EcoStruxure Control Expert uses to configure, monitor and browse symbols
(verified: Kaspersky ICS-CERT "The secrets of Schneider Electric's UMAS
protocol", INCIBE-CERT, plus independent protocol analyses).

It is deliberately **not** the studio's default generator:

- it is **proprietary and undocumented by the vendor** — public knowledge comes
  from reverse engineering, so any implementation is unsupported and version-
  fragile (Unity OS ≥ 2.6 behaviours differ);
- the same research published **security weaknesses** in UMAS (session-key
  handling); emitting UMAS traffic from a SCADA server is a real OT-security
  decision, not an implementation detail;
- WinCC OA has no UMAS driver, so a UMAS browse would only ever feed the
  *catalog*, never the runtime binding — the runtime stays standard Modbus.

The supported path therefore mirrors the Siemens one (SimaticML export):
`schneider/variables.ts` parses a **Control Expert data-editor variables export**
(CSV/TSV, delimiter and column order auto-detected, EN/FR headers) and
`schneider/address.ts` resolves located variables to the Modbus data model.

**Verified mapping** (Schneider community + integrator documentation):
`%MWn` → holding register `n` → `40001 + n` (`%MW0` → `40001`,
`%MW4513` → `44514`); `%MD`/`%MF` overlay two `%MW` words; `%IW` → input
register (`30001 + n`); `%M` → coil (`00001 + n`); `%I` → discrete input
(`10001 + n`). Two facts are enforced rather than assumed:

- **only located variables exist for a Modbus client** — a variable with no
  address in the data editor is excluded with a warning;
- **`%M` and `%I` share memory** on M340/M580 and which one FC1/FC2 actually
  reads depends on the memory-management setting (Topological vs mixed
  topological/state RAM) → every bit entry carries that note;
- topological addresses (`%I0.2.3`) and non-verified prefixes (`%SW`, `%KW`) are
  reported, never silently converted.

The generator also detects **register overlaps** (a `DINT` at `%MW112` spanning
112-113 against an `INT` at `%MW113`) — a classic "the value changes on its own"
root cause. 21 unit tests cover the mapping and these checks.

### Two Schneider generators, one shared engineering step

`entriesFromSchneiderVariables()` holds the engineering resolution (addresses →
Modbus, unlocated/topological exclusion, overlap detection, type flagging); the
generators only differ in how they READ the file:

- `schneider/variables.ts` — CSV/TSV export (delimiter + column order detected);
- `schneider/xvm.ts` — **XVM / XSY / XEF XML**, on the core's shared XML reader.

### The XVM reader and its unverified schema

⚠️ **Schneider does not publish the XVM schema, and no real export could be
obtained**: the pages that carry one (the developpez.net thread *"Lecture d'un
fichier XVM"*, se.com FAQ FA198786, product-help.schneider-electric.com) are
unreachable from this environment's network policy, and no public sample is
indexed. What IS documented: XVM is the **OFS-compatible variables export**
carrying the variable↔controller-address link and the memory-organisation info;
XSY/XEF are XML exports preserving name, address, type, description and initial
values, with the attribute **`topologicalAddress`** holding the memory position
(e.g. `%MW3215`) next to `typeName` and `comment`.

The reader is therefore built to survive being wrong about the exact schema:

- **spelling-tolerant** — a variable is any element carrying a recognisable
  *name*; name/type/address/comment/unit are looked up across attribute aliases
  (`topologicalAddress`/`address`/`@`, `typeName`/`type`/`datatype`, …), child
  elements, and Unity-style `<attribute name= value=/>` children,
  case-insensitively and ignoring namespace prefixes;
- **structured variables contribute their MEMBERS**, dot-joined
  (`Recette.Consigne`) — you bind leaves, not a struct root — and a member with
  no own address is reported rather than having its offset guessed;
- **it fails LOUD**: when nothing is recognised it reports the element names
  actually encountered (with counts), so calibrating on a real file is a
  one-line alias addition; unreadable XML is reported, never thrown;
- **an ENCRYPTED export is named as such, not blamed on the schema.** A real
  Unity Pro V13 export (`variable_2022_manut.xvm`, 2.3 MB, *"Fichier source
  variables"*) turned out to hold exactly five elements —
  `XVMExchangeFile`, `fileHeader`, `contentHeader`, `crypted`,
  `applicationIDs` — the entire payload being ONE hex blob inside
  `<crypted Encoding="65001">`. Control Expert writes the export that way when
  the project or its sections are password-protected, and the key is the
  project's, not ours: no reader can recover the variables. So when nothing is
  recognised AND a `crypted` element was seen, the reader emits
  `schneider.xvm-crypted` ("re-export from an unprotected project") *instead of*
  the alias advice, which would otherwise send the integrator hunting for a
  schema mismatch that does not exist;
- every book it produces carries the "schema not vendor-verified" warning as its
  **first** warning, visible in the UI.

The fixtures (`samples/schneider-fixtures.ts`) are hand-authored in the shape of
a data-editor / XVM export — replace them with a **real** export when available
(see INTEGRATION.md "inputs needed"). A UMAS-based online browse remains possible
as an explicitly opt-in phase-2 generator, with the security trade-off stated to
the user.

## What is proven

- OPC UA address mapping (`drivers/opcua.ts`) is the **verified** tag-importer
  code, unchanged (reference `<Conn>$$1$1$<NodeId>`, datatypes 750–768,
  directions). The `_address`/`_distrib` write set generalises the proven
  `tagImporterController.writeAddress`; the `_alert_hdl` and `_archive` writes
  mirror `para-alarm.ts` / `para-archive.ts`.

## Online OPC UA browse — decisions forced by the driver

The walk lives in the pure core (`opcua/browse.ts`) behind an injected
`OpcUaBrowsePort`; the backend implements the port, the demo implements it over an
in-memory fake server. Every design choice below is a consequence of what the
driver actually returns, not a preference:

- **One level per request.** A browse answer is six PARALLEL ARRAYS
  (`DisplayNames`, `NodeIds`, `DataTypes`, `ValueRanks`, `NodeClasses`,
  `BrowsePaths`) with **no parent link**, so a multi-level answer cannot be
  reassembled into a tree. The walker asks for depth 1 and recurses itself — that
  is the only way to know a node's parent, hence its symbolic path. (Using the
  driver's own multi-level browse would first require confirming the exact
  `BrowsePaths` format on a real server; not done, so not used.)
- **Sequential, and QUEUED per connection.** Every browse of a connection goes
  through the same `_<conn>.Browse.GetBranch` element: a second request overwrites
  the first before its answer arrives, and the first caller then waits for a reply
  that never comes. The walk is sequential by construction, and the backend port
  keeps a per-connection queue so two concurrent HTTP callers cannot collide
  either. The tag importer does one browse per user click and never hit this; the
  studio walks hundreds of levels, so it must.
- **Bounded, and never silently.** Depth, signal count and request count are all
  capped (8 / 5000 / 2000 by default). Hitting a cap emits a warning naming the
  abandoned branches — a truncated catalog that *looks* complete is how you ship a
  half-configured machine.
- **A cycle guard**, because an OPC UA address space is a graph: a node already
  visited is not re-entered.
- **One unreadable branch does not lose the catalog**: the failure is caught,
  counted and reported as a warning; the rest of the walk continues.
- **`AccessLevel` is read when the driver has it, assumed otherwise** — see the
  dedicated section below.
- **Array variables are flagged, not guessed.** `OaLeafType` has no `Dyn*` member
  and the `_address` write for a dynamic DPE is unverified, so an array is
  catalogued with its scalar base type, marked `unmapped`, and listed in a warning.
  Fabricating a dynamic address would put a silently-truncating binding in a
  project.

**The refresh is the reason a book is first-class.** Browse parameters are recorded
in `provenance.browse`, so a refresh REPLAYS the same walk and diffs the result
(`diffBooks` → `refreshWarnings`, both in the core so the backend and the demo word
it identically). `removed` is the dangerous half: those signals may still be
referenced by a workspace. A failed re-browse **keeps the stored catalog** (HTTP
502 + the old book) — losing a catalog because a server blinked is not acceptable.

### Who drives the walk: the client, for anything an operator watches

The walk is the same core function either way; what changed is where it is driven
from, and that follows from a fact about real servers: **a walk takes minutes**.

`POST /books/browse` runs it entirely on the backend and answers when it is finished.
That is right for a machine-to-machine caller and wrong for a person: nothing to
watch, no way to look at the address space first, no way to stop. So the page drives
the walk itself over `POST /browse/level` (`data/walk.ts`), and three things follow
from the same seam:

- **progress** — the core's walker gained an `onProgress(BrowseProgress)` hook, called
  before each request with the counts so far and the branch it is waiting on;
- **cancellation** — the hook is the only place a sequential recursive walk can be
  interrupted, so "Stop" is a flag the callback reads and THROWS on. The walker
  unwinds, the partial book is never stored;
- **exploration** — one level on demand is exactly what a tree explorer needs, so the
  same endpoint serves "show me what is on this server" before anything is created.

`POST /browse/level` takes `view`, not `manage-devices`: it only reads an address
space. The finished book is stored by `PUT /books/:id`, gated like every other catalog
write, with the id taken from the PATH — a body claiming another id cannot overwrite
another catalog, and the server still applies qualification (roles, access,
exclusions) exactly as for a server-side browse.

**No percentage.** The size of an address space is not known until it has been walked,
so a bar filling towards an invented total would be a lie. The counts and the current
branch are true, and they are what an operator actually needs: they distinguish "still
working" from "stuck on one branch".

**Declare, then walk** — for the same reason. `POST /books` creates the catalog from
its identity alone (id, name, interface, driver) and the walk fills it afterwards. A
walk that is stopped or fails then leaves a catalog to run again rather than nothing,
and the operator is not holding a form open for minutes. It also makes "re-walk this
catalog" the same operation as "walk it the first time".

### Hiding signals: an override, never a deletion

A generated catalog holds what the source exposes, which is not always what the
project wants (diagnostics counters, vendor scratch registers, a whole `Admin`
branch). Those can be hidden — and the implementation is deliberately an **override
stored beside the book** (`books/<id>.excluded.json`), like the role and access ones:

- a catalog is a *reading* of a source, and the source gets **re-read**. Had hiding
  rewritten the book, the next refresh would bring the signal straight back — the
  operator's judgement lost to a mechanical re-read;
- it stays **reversible**: nothing is destroyed, and every hidden signal can come back;
- the exclusion is applied on the way OUT, never before storing (`presented()` vs
  `qualified()` in the controller, mirrored in the demo gateway). Folding it into what
  is stored would make hiding a deletion, and "restore" would have nothing to restore;
- and the catalog **states the count** — in the signal bar and as a book warning
  (`book.excluded`). This is the risk the feature itself introduces: a catalog that
  quietly shows less than the machine has would have the next engineer model from an
  incomplete reading. So it is not allowed to be quiet.

A hidden signal is dropped before the role rules run, so it takes no role, no address
and no config: it costs nothing downstream.

### History: the other half of AccessLevel, and why it is only INFORMATION

The same OPC UA `AccessLevel` that decides the direction also carries
`HistoryRead`/`HistoryWrite`, and a NodeSet states it outright
(`Historizing="true"` — what SiOME writes). `BookEntry.historized` records it and
the catalog shows it in its own column, next to the access chip. Three decisions:

- **it is decoded apart** (`opcUaHistorizedFromLevel`, never folded into
  `opcUaAccessFromLevel`): the access mode drives the address direction, history
  drives an archiving decision, and one value carrying both is how a read-only
  signal ends up looking archivable;
- **it generates nothing.** The studio does not turn "the server historizes this"
  into a WinCC OA `_archive` config: whether the SCADA should archive what the
  machine already keeps is an engineering decision (retention, volume, who is the
  reference), exactly like the ranges and the analog alarms it also refuses to
  invent. It is shown so the decision can be MADE, at the moment the operator is
  looking at the signal;
- **absent means unknown, not "no"** — a Modbus register map, a CSV export or a
  browse whose driver exposes no `AccessLevel` leave the field undefined, and the
  column shows a plain dash rather than a "no history" chip. Same rule as
  `accessSource: 'assumed'`: no evidence is not evidence of absence.

### Role labels carry their TELEMETRY CODE

Every role label is prefixed with its designation — TM mesure, TC commande, TR
consigne, TS état, TA alarme, TCP compteur, TX paramètre (`ROLE_CODE` in the
page's i18n). The codes are **not translated**: they are designations, identical
in every language, and they are what an operator reading a schematic or a signal
list recognises before the word. `unknown` deliberately has none — an unqualified
signal has no telemetry nature yet, and giving it a code would hide exactly what
the "à qualifier" chip exists to show.

### AccessLevel, and the direction that follows from it

The access mode decides whether a binding can be written at all, so the studio
treats it as **evidence with a provenance** rather than a value:
`BookEntry.accessSource` is `declared` (the source states it), `assumed` (the
generator could not read it) or `manual` (the operator set it).

Where each comes from:

| Source | Access | Why |
|--------|--------|-----|
| NodeSet2 | `declared` | the `AccessLevel` attribute is in the file |
| Control Expert / SimaticML / PAC3200 | `declared` | the export states the variable's access or register class |
| Online browse, driver exposes it | `declared` | read from the `Browse.*` element **discovered** by introspecting the `_OPCUAServer` DP type — never a guessed element name (the same technique appSecurityGuard uses for `_Users`). A non-existent DPE in the browse `dpConnect` would kill the whole browse, hence the up-front discovery, cached per process |
| Online browse, driver does not | `assumed` (`r`) | the tag importer's verified caveat; the book says so, per-signal and in a warning |
| Operator override | `manual` | `POST /books/:id/access`, stored in `books/<id>.access.json` so a refresh keeps it |

`configsForRole` then reconciles the **role's intent** with that access — the two
carry different information and neither may be ignored:

- access `assumed` → the role wins outright. The access is not evidence, so a
  command still gets `OUTPUT`. This is the case the manual override exists for.
- write intent + a **declared** read-only signal → the address is created
  `INPUT_POLL` and a note is raised. Writing `OUTPUT` to a read-only node yields a
  binding the server rejects at runtime: a silent, hard-to-diagnose failure. The
  studio would rather create a working read than a broken write.
- setpoint on a **write-only** signal → `OUTPUT`, with a note that the read-back
  is not possible.
- read intent (measure/state/alarm/counter) → `INPUT_POLL` even on a writable
  node: declaring a write path nobody uses is noise.

Every note becomes a generation warning naming the signals, and `assumed` accesses
are counted in their own warning. In the UI the access chip carries its provenance
(`r?` assumed, `rw✎` manual) and checked signals can be corrected in bulk.

Order matters in `qualified()`: **access overrides are applied before the role
rules**, because several structural rules match on the access mode — qualifying
first would classify from a value the operator has just corrected.

### The path-rule bug the browse exposed

The role engine's path rules (`path-measure`, `path-state`, `path-command`,
`path-setpoint`, `path-admin`) were anchored at `^`, e.g. `^(mesures?)\.`. That
only ever matched catalogs rooted at the branch itself (a companion spec like
PackML). Every book rooted at a **block** (`DB_Four.Mesures.Temperature`) or at an
**instance** (`Remplisseuse.Status.StateCurrent`, which is what a browse produces)
fell straight through to the name/structural rules. The rules were silently dead
for most real books.

Fixed by matching a **branch anywhere** in the path (`(^|\.)(…)\.`) — a branch is
what carries the meaning, wherever it sits — plus the French plural
(`commande?s?`, so a TIA `Commandes.` folder counts). Visible effect on the demo:
`Status.*` went from *mesure* to *état*, and the generated model gained correct
I/O directions on setpoints and a binary alarm on `Moteur.Defaut`. Regression tests
cover all three rootings.

## OPC UA NodeSet2 — the offline sibling

`opcua/nodeset.ts` ports the tag importer's proven NodeSet reader (standard
reference/datatype NodeIds, alias resolution, `AccessLevel` decoding, supertype
folding) onto the core's dependency-free XML reader — the tag-importer version runs
on the browser's `DOMParser`, which exists neither in the core nor in the backend.

Two output shapes, and the difference is not cosmetic:

- the file declares real **instances** (`UAObject` with a `HasTypeDefinition` and
  **no** `HasModellingRule` — a modelling rule marks an instance *declaration*,
  i.e. part of a type) → entries rooted at each instance. An export of a machine.
- the file declares only **types** (the usual companion-spec case) → each
  `UAObjectType` becomes a TEMPLATE rooted at the type name. That is precisely the
  studio's template catalog, mutualisable across every machine implementing the
  spec.

**NodeIds are file-local.** A NodeSet assigns its own namespace INDICES and a live
server almost always assigns different ones, so a NodeSet address is a *candidate*,
never a binding: every address is emitted with the `<Connexion>` placeholder, the
book carries **no `interface`** (so `ingestBook` deliberately does not forward one),
and the caveat is the book's first warning. Unlike a browse, a NodeSet *does* carry
`AccessLevel`, so its access modes are real.

⚠️ The unit-test fixtures are hand-written `UANodeSet` documents following OPC UA
Part 6 — **not** vendor exports. The OPC Foundation pages for the PackML companion
spec return HTTP 403 from this environment, so a real companion-spec NodeSet is
still to be calibrated against (see INTEGRATION "Inputs still needed").

### Reading a REAL vendor NodeSet: five fixes, one symptom

Verified against the file that produced the report — a SiOME 3.0.2 export
(`Opc.Ua.CC.NodeSet_v1.1`, 24 `Pnn` parameters + a station). A verbatim subset is kept as
`samples/opcua-cc-fixtures.ts`, and `nodeset.spec.ts` asserts its exact output:
`P01.Config.RawRange.MinimumValue` & co, 13 signals per parameter, zero duplicates.

**`Organizes` is a hierarchical reference too — and it is the one used for sub-objects.**
The decisive detail of that file: an instance's sub-OBJECTS hang off `Organizes`
(`Config`, `RawRange`, `Processing`, `EngRange`) while their VARIABLES use `HasComponent`.
Following components only, every `Config` was unattached from its `P01`, so it became a
root of its own — 24 parameters × ~5 collapsing paths ≈ the 115 duplicates. The member
walk, the root detection and the component-type scan now all read one index built over
`HasComponent`, `HasProperty` **and** `Organizes`.

**A NodeSet also describes ITSELF, and that is not a machine.** The same file carries a
`NamespaceMetadataType` object (`i=11616`: `NamespaceUri`, `NamespaceVersion`,
`StaticNodeIdTypes`…) and a `DataTypeEncodingType` (`i=76`) per structured DataType. Read
as equipment, the first produced entries like `http://framatome.com/UA/msp.NamespaceUri` —
not a signal, and not a usable DPE name. Both standard types are excluded from the
instance candidates (`FILE_METADATA_TYPES`).


**A hierarchical reference may be written from EITHER end — and usually is written on the
child.** `HasComponent` / `HasProperty` exists once in the address space, and NodeSet2
serialises it either forward on the parent or INVERSE on the child
(`<Reference ReferenceType="HasComponent" IsForward="false">parent</Reference>`). The
reader followed forward references only, so in a real exporter's file every instance looked
childless: `P01` produced nothing, each of its sub-objects (`Config`, `Processing`,
`RawRange`) looked like a machine of its own, and the book came out with a bare
`Config.SampleRate` per probe instead of `P01.Config.SampleRate`. The hierarchy is now
resolved ONCE per document from both directions (`buildChildrenIndex`, `NodeGraph`) and
every walk — members, root detection, component types — reads that one index. This was the
root cause of the "115 duplicate signal path(s)" report; the three below made it worse.


An import of a real device model reported *"115 duplicate signal path(s) dropped
(Config.SampleRate, Processing.Function, RawRange.MinimumValue…)"* instead of a structure.
Three defects, each of which alone produced garbage:

**An object nested in a TYPE is not a machine.** The instance test was "a `UAObject` with
a `HasTypeDefinition` and no `HasModellingRule`", and real vendor files very often put NO
modelling rule on a type's nested declaration (`ProbeType` → `Config` → `SampleRate`) — the
rule sits on the leaves, or nowhere. So every `Config` of every type was read as a machine
of its own and rooted its own entries: with 40 types, `Config.SampleRate` came out 40
times. `rootInstances` now refuses any candidate whose ancestry reaches a type node
(`UAObjectType`/`UAVariableType`/`UADataType`) — what lives under a type belongs to that
type, and the type loop already catalogues it as `TypeName.Config.SampleRate`, unique per
type.

**A COMPONENT type must not root entries of its own.** When a file declares no instance,
entries come from the types — but `ConfigType` behind `ProbeType.Config` is a component,
not an equipment. Rooting entries at it too catalogued the same signals a second time
under a name no machine carries. It stays a `BookType` (a legitimate DP-type candidate);
it just no longer produces entries (`componentTypeIds`).

**The cycle guard was hiding half the model.** `visited` was scoped to the whole walk, so a
type used TWICE (`Channel1: ChannelType`, `Channel2: ChannelType` — an IO card, a two-way
valve) was catalogued for the first use and silently skipped for every other. Only an
ancestry loop is a cycle, so the guard is now scoped to the BRANCH. This one is worth
remembering: the symptom of a walk-wide guard is not an error, it is a structure that looks
complete and is not.

## Localisation: structured warnings (`EngWarning`)

The page is EN / FR / DE **and so are the core's diagnostics**, without the core
knowing a single language.

A generator warning has three consumers, and a plain string serves only the first:
the OPERATOR (in their language), the TEST suite and the backend log (which need an
exact, stable meaning), and any future rule that wants to react to a KIND of problem
without matching prose. So `EngWarning` carries all three concerns separately:

```ts
{ code: 'browse.truncated-entries',
  message: 'Walk TRUNCATED at {max} signals (maxEntries) — …',   // English, the fallback
  params:  { max: 5 } }
```

The page maps `code` → its own FR/DE template and substitutes the **same params**, so
a value never has to be re-extracted from prose. An unknown code falls back to
`message`: a warning added to the core is never invisible, merely untranslated.

Two rules make that contract hold, and both are enforced mechanically by
`tools/check-eng-i18n.mjs` (which bundles the real modules with esbuild):

1. **every value sits behind a `{placeholder}`** — a translator cannot re-order text
   that already has values baked in. `warnings.spec.ts` asserts that no
   `{placeholder}` survives the English rendering, i.e. that each message's
   placeholders are all fed;
2. **codes are stable and exhaustively translated** — the checker fails on a core
   code missing from `WARNING_MSG`, on a translation whose placeholders drift from
   the English template, and on a translation matching no core code (a typo, or a
   warning that was removed). `WARNING_CODES` in the core is the single vocabulary.

**Migration without touching stored files.** `AddressBook.warnings` lives in the
engineering store on disk, and books written before this change hold plain strings.
Rather than migrate files (and break a rollback), `asEngWarnings()` accepts both
shapes when READING: a legacy string becomes `{ code: 'legacy', message }`, which
renders exactly as before and translates to nothing — the truthful outcome. Both the
backend's `qualified()` and the demo gateway run stored books through it.

**Test quality improved on the way.** Assertions that matched prose
(`w.includes('TRUNCATED')`) now match the code and its params
(`{ code: 'browse.truncated-entries', params: { max: 5 } }`) — re-wording or
translating a message no longer breaks a test, while a changed *meaning* still does.

Still English by design: `BookProvenance.detail` (a free-form generator trace such as
`walk ns=0;i=85 · 7 request(s) · 21 signals`) and the role rules' `note` (the
tooltip explaining which rule matched). Both are diagnostics rather than messages;
promote them to codes if an operator ever needs them localised.

Three smaller decisions inside the page's i18n:
- the module is **self-contained** (its own `ml()`/resolver) rather than importing
  `@wincc-oa/wui-i18n-shared`, because the page must render in the offline demo and
  the screenshot pipeline where no `@wincc-oa/*` package exists — the same reason it
  depends on `lit` only;
- **no language picker, and the user connection decides.** In the shell the language
  is read from `localStorage['lang']` — the very key the WebUI's
  `wui-translation-loader` boots lit-translate from (`use(localStorage.getItem('lang')
  || default)`), so the page follows the user session without importing anything and
  without a second switch that could disagree with the shell. The key is absent on
  the demo's own origin, which is what keeps `?lang=` (demo, screenshots) working —
  the resolver order is attribute → session → `?lang=` → `<html lang>` → navigator;
- the reactive state is `uiLang`, **not** `lang`: that would shadow the native
  `HTMLElement.lang` property, which Lit does not observe anyway. The element's
  `lang` attribute is read once at connect time instead.

## Backend: the runtime seam, and where the honesty lives

The backend is deliberately thin — three files, no manager. Endpoint table, store
layout and payloads are in [INTEGRATION.md](./INTEGRATION.md); the *decisions*
are here.

**Why a file store, not datapoints.** Every other page store in the suite is
DP-JSON. The studio is not: an address book holds thousands of entries (a DP
string element is the wrong container), and engineering data must be diffable,
backup-able and reviewable outside the project. `engStore.ts` writes JSON with
`safeId` sanitising and temp-file + rename, so a crash never leaves half a book.

**Manual role overrides are stored apart** (`books/<id>.roles.json`). A refresh or
a re-ingest replaces the *catalog* and re-runs the rules, but the operator's
qualification survives — re-importing a TIA export must never lose that work.

**Written values vs studio provenance** (the trap that would have poisoned every
diff). An `AddressConfig` carries `deviceId`/`mode`, which are *never written to
OA*: a read-back cannot recover them. So the diff compares
`comparableConfigs()` — written attributes only. Without it, every checked-out
address would show as permanently modified and the plan would never converge.
`configs/read.spec.ts` proves the WRITE → READ round trip for all four families,
which is what makes the diff trustworthy.

**A live read declares its scope.** Reading configs costs 16 attributes per DPE,
so `/live` and `/plan` take a `dpes` list, derived by `liveScopeOf(workspace)` in
the core — the union of the workspace's config keys **and its baseline `cfg:`
keys**. The baseline half is not an optimisation detail: a config *deleted* from
the workspace is no longer a workspace key, so omitting it would silently drop
the removal from the plan. The page and the controller call the same helper so
they cannot drift. The demo gateway *honours* the scope too, so an under-scoped
read shows up in the offline demo instead of only on a live project.

**Driver resolution refuses to guess.** `resolveAddressContext` takes the stored
device's explicit `driverNumber` first, then auto-detects (running managers from
`_Connections.Driver.ManNums`, matched on `_Driver<n>.DT`), then **throws**. Only
`OPCUAC` is a verified `DT` value, so S7/Modbus devices need an explicit number —
writing an address to the wrong driver breaks the binding *silently*, which is
strictly worse than refusing to write it.

**The driver PICKER filters by protocol, and never offers the simulator.** Same
knowledge, used the other way round: `driverFitsProtocol` (core, unit-tested) decides
which `_Driver<n>` may appear when a connection of a given protocol is declared.

- **`DT = SIM` is dropped for every protocol.** Verified vendor constant
  (`DRVS_DT_SIM` in `scripts/libs/driverSettings.ctl`), where it is deliberately
  treated as matching *every* driver type — which is precisely why it must be
  filtered here: it would otherwise pass every check and look like a valid choice,
  and an address bound to the simulator reads plausible invented values. That is a
  worse failure than no binding at all.
- **Excluding on proof, not including on a guess.** Only `OPCUAC` and `S7PLUS` are
  verified `DT` values (the second from the vendor's own
  `drvsCheckRunningDrvNums("S7PLUS", …)`); no string could be verified for the
  classic S7 and Modbus drivers. So a protocol WITH a verified set shows only that
  set, and a protocol WITHOUT one shows everything except the drivers proven to
  belong elsewhere. A driver whose `DT` could not be read stays offerable —
  absence of evidence is not evidence, the same rule as `accessSource: 'assumed'`.
  A test pins the verified table itself, as a guard against a future "helpful"
  addition from memory.
- **"None fits" is not "none listed".** When the project has drivers but none can
  serve the protocol, the hint says so; the old message would have sent an operator
  looking for a driver that is right there in the project.

**Fail-closed gating, gated by capability not verb.** Nothing in `/api/eng` is a
shared API (contrast para, which *is* the suite's persistence API and must stay
open), so every route is gated. `POST /plan` and `POST /test-read` only read →
`view`; `POST /checkout` writes a workspace file → `edit-model`. ⚠️ The guards are
**inert until the webserver's own HTTP authentication is enabled** —
`appSecurityGuard` cannot attribute a request without a session identity and fails
open with a warning. This is the same finding as the para audit and it remains the
single most important prerequisite for real enforcement.

**Offline typecheck.** `backend/tsconfig.typecheck.json` +
`backend/types/runtime-stubs.d.ts` compile the routes against the **real** core
sources with the webserver packages stubbed — so the decoupling mandate covers the
backend too, not just the core and the page.

## The S7Plus symbolic browse (what it cost, and the two traps)

Added after the OPC UA browse and deliberately shaped like it: the pure walker in
`s7plus/browse.ts`, the runtime behind an injected port, the same client-driven walk
with progress and cancellation. The full protocol analysis — with the file each fact
was read from — is [S7PLUS-BROWSE.md](./S7PLUS-BROWSE.md). What is worth keeping
here is why two decisions went the way they did.

**A dedicated JS manager, unlike OPC UA.** The OPC UA browse runs inside the
webserver; the S7Plus one does not, and the difference is not taste. Both drivers
answer on a single `Browse.GetBranch` element per connection, so a second request
overwrites the first — but where the OPC UA explorer is a handful of levels a human
clicks through, an S7Plus walk of a station is hundreds of requests, and the owner
that serialises them has to outlive a deploy. A webserver does not: it restarts, and
there can be several instances. So the dialogue moved into `s7plusBrowse`
(MSA vRPC), the webserver became a stub, and the walk stayed in the core where it is
tested. No direct-API fallback was added on purpose — falling back to "browse from
the webserver anyway" would reintroduce exactly the failure the manager prevents, so
an absent manager is reported instead.

**Trap 1 — the `item` grammar is silent when it is wrong.** A node is addressed by a
`|`-separated path from the TIA project, and the client has to insert synthetic
`Blocks` / `Tags` segments that the driver never reports (it answers a data block as
a plain child with `SystemType = 'Block'`). Get it wrong and nothing fails: the
driver returns an **empty level**, and the catalog is short by a whole block with no
warning anywhere. That is why the grammar lives in one tested function
(`s7plusChildItem`) and why the unit tests drive a fake port that *throws* on an item
it was not asked for — so a grammar mistake fails a test instead of quietly costing
signals. It is also why the walk asks for the exact items the standard panel asks
for, verbatim from `s7plus_symbolic.pnl`.

**Trap 2 — an array can arrive as one element.** Browsing an `Array` node does not
always return every element: the driver answers `Mesures[0]` and the standard panel
synthesises the rest up to the declared length (its `g_optBrowse` block). A walker
that took the answer at face value would catalogue a 200-element array as one signal
— and the 199 missing ones would be invisible, not reported. So the walker completes
them, bounds the count (`maxArrayElements`, 64 by default) and names any truncation.

**What the browse does not say, and the studio does not invent.** No access rights
and no history flag: every entry is `access: 'r'` with `accessSource: 'assumed'`,
`historized` stays absent, and each book carries `s7plus.access-assumed` — not as a
failure but as a statement that read-only here is a default. The direction then comes
from the role, and a manual override counts as evidence. Same rule as an OPC UA
browse whose driver exposes no `AccessLevel`; the difference is that for S7Plus it is
always the case.

**A TIA export is not the machine.** The same walk reads either the live PLC or an
export under `data/TIA_Projects`, and the *project* name decides
(`S7Plus$Online` = the machine). An export describes an engineered program, so it
produces a **template catalog with no interface** — bound per equipment at
generation, like a NodeSet — and the book states which source it was. A catalog that
claimed a live binding it never had would put addresses in a project on the strength
of an archive.

**Check-in needed one addition.** `para.ctl` writes `_address.._connection` for
`s7plus` (the reference is the bare symbolic path; the connection travels beside it),
which the studio's `buildAddressWrite` did not. It now appends the pair **when the
config carries a connection** — OPC UA does not need one, so absence stays absence —
and `AddressConfig.connection` is excluded from diff comparison like `deviceId`/`mode`,
because it is written but not read back.

⚠️ **Not yet exercised against a real driver.** The dev project has no
`_S7PlusConnection` and no `WCCOAs7plus` manager, so the request/response round-trip
is the one part that could not be verified offline — S7PLUS-BROWSE.md §7 lists what
to check first, in order, and what the likeliest first-contact problem is (the
`hmiVisible` polarity, or an `item` shape a real driver spells differently).

## Classic S7 — a verifier, not a browser

The S7Plus work above raised the obvious question: what about the S7-300/400 that
make up most of the installed base? The answer is not "the same, later". It is a
**different feature**, because the protocol is different in the one way that
matters: **classic S7 carries no symbols and no layout**.

A CPU answers a block DIRECTORY — which OBs/DBs/FBs/FCs exist, how big each is,
when it was compiled, who wrote it, plus its own identification through the
system-status lists. It has no message that returns a variable name, a datatype or
an offset. Those live in the STEP 7 project. This is a property of S7comm, not a
gap in any client library (it is also what every Snap7 discussion on the subject
concludes), and it decides the whole design:

1. an S7 catalog **cannot be generated online** — it is generated from the
   project's exports (`s7/symbols.ts`, `s7/awl.ts`);
2. the online side is therefore a **verifier**, and the only thing it can add is
   whether the export still matches the running machine.

That second point is worth more than it sounds. The failure it catches —
a data block the catalog addresses that the PLC no longer holds, or one that was
shortened since the export — is invisible offline, survives a check-in, and
surfaces weeks later as a field report about a broken sensor. Nothing but the
machine can answer it.

### The two exports are complementary, and neither is sufficient

A symbol table names the memory areas and the project's blocks; it never contains
a data block's CONTENT. AWL sources contain exactly that content and none of the
memory-area names. So a symbol table ingested alone yields a catalog with no DB
member in it — correct, and easily mistaken for a parser failure, which is why it
is the catalog's own first warning (`s7sym.no-db-content`) naming the blocks whose
sources nobody supplied. The symbol table's **block directory** is also kept and
reused: given both, a member is pathed `Echange.Consigne_Vitesse` instead of
`DB10.Consigne_Vitesse`, for identical addresses.

### Three things read from the file rather than asked of the operator

- **the dialect.** `.asc` (fixed-width, `126,` record prefix), `.sdf` (quoted CSV),
  `.seq`, `.csv` re-saved from Excel with `,` or `;`. Decided per line, so no
  format switch exists to get wrong. One repair was needed: the address column of
  a fixed-width export is itself sub-columned (`A      4.0`), so a run-of-spaces
  split tears the operand in two — the fragments are re-joined **only when the
  merge parses as an operand and the left fragment alone does not**, never on
  shape. That rule was found by a test, not by reading: the first implementation
  split `A      4.0` into `A` and `4.0` and quietly produced a catalog whose
  addresses were all wrong;
- **the column order.** Siemens documents BOTH `Symbol, Address, Type, Comment`
  and `Address, Symbol, Type, Comment`. Guessing swaps every name with its address
  and yields a catalog that looks plausible and addresses nothing, so the order is
  counted over the whole file (not decided on the first line, which is often a
  header, and a symbol can look like an operand by accident — `M1` is an ordinary
  name). A file where neither column wins is refused;
- **the mnemonic language.** `E`/`A`/`Z` and `I`/`Q`/`C` normalise to one area, so
  a German export and an English one of the same PLC produce identical addresses.

### Access from the area is `declared`, not `assumed`

An S7 process image is read-only to a driver by construction and an output image
is not a meaningful setpoint source. So `E`/`PE` is `r`, `A`/`PA` is `w`, flags
and DB members are `rw` — and all of them carry `accessSource: 'declared'`,
because that IS what the source states. Contrast the online OPC UA browse, where
an unexposed `AccessLevel` yields `assumed` and a role's write intent wins. The
distinction is the same one throughout the studio: what the source says is
evidence, what it does not say is not invented.

### The offsets are not reimplemented

An AWL source states member ORDER, never addresses. The classic layout (BOOL
bit-packing, word alignment, `String[n]` = n + 2, struct padding) already exists
unit-tested in `simaticml/offsets.ts`, so `s7/awl.ts` calls it. Two
implementations of one layout rule drift, and a drift here moves every address of
a data block by a byte — the kind of defect that reads as a wiring fault.

One trap the tests caught: `DATA_BLOCK DB 12 "UDT_Moteur"` declares an INSTANCE
block, so the quoted name is the TYPE, not the block's own name. The first
implementation took it as the name and pathed every entry under `UDT_Moteur`.
Which quoted name is whose depends on the numeric token being present, and that is
now written out as a table in the parser rather than inferred at each site.

### The protocol client: hand-written, and read-only by construction

The reference implementation is Snap7, which is native — a compiled addon inside
the WinCC OA node runtime, rebuilt per host ABI. The subset an inventory needs is
small and entirely request/response, so `backend/managers/s7Browse/s7-protocol.js`
implements it over `node:net` with **no dependency**, like every other JS manager
here. Every frame is transcribed from the Snap7 sources and cross-checked against
the Wireshark dissector, and recorded byte by byte in
[S7-BROWSING.md](./S7-BROWSING.md) — the same treatment
`VENDOR-ADDRESS-TRANSFORMATIONS.md` gives the `_datatype` tables, and for the same
reason: constants that came from somewhere must stay auditable.

It implements the block-directory subset **and nothing else** — no variable read,
no write, no upload, no run/stop. That is a design guarantee, not an unfinished
state: it means the feature cannot disturb a production PLC however it is called,
and unlike a role gate it does not depend on configuration. It is also why the two
HTTP routes take `view` rather than `manage-devices`: they read a CPU and store
nothing, so they grant no more than the reads beside them.

A hand-written protocol client that cannot be pointed at a real PLC from a dev
machine would normally be unverifiable. `tools/check-s7-protocol.mjs` closes that
gap as far as it can be closed offline: it runs the real client against a **fake
CPU on a loopback socket** and asserts every request **byte for byte** against the
telegram Snap7 builds for the same call, plus the answer parsing, the multi-PDU
continuation, TPKT reassembly across two TCP segments, and the refusals. It found
five real defects on the first run — all of them TPKT lengths in the expectations
rather than in the client, which is itself the useful outcome: the arithmetic a
reviewer would have waved through is exactly what a fake CPU checks for free.

What it proves is the FRAMING. What a real CPU's dialect does with it is still
unverified — see the verification status in [S7-BROWSING.md](./S7-BROWSING.md).

## Staged for later (explicit)

- ~~OPC UA connection security~~ — **implemented**: see
  [OPCUA-CONNECTION-SECURITY.md](./OPCUA-CONNECTION-SECURITY.md) (analysis §1–2,
  what ships §3) and "OPC UA security: the vendor path" below.

- **TIA Openness connector**: a separate study (`docs/wui-tia-connector/`, to be
  written) — a thin agent that runs `PlcBlock.Export()`/`PlcType.Export()` and
  drops the XML bundle to the studio's ingestion (watched folder + POST), so the
  studio parses it as a book. Goal: minimal human steps between TIA and WinCC OA.
- **Ingestion mode** — `POST /books/ingest` exists; the **watched folder** does
  not (waiting on your choice, see INTEGRATION "Inputs still needed").
- **File-book regeneration** — a re-browse replays an online walk, but the server
  does not keep an uploaded document, so a SimaticML/CSV/XVM/NodeSet book is
  regenerated by re-ingesting its source. Keeping the source blob next to the book
  in the store would make those refreshable too; not done (storage + retention
  question for you).
- **S7Plus `Types|` branch** — the driver also exposes the station's PLC datatypes
  (`<project>|<station>|Types|<UDT>`, which the vendor's TIA importer uses to build
  its type tree). The walk does not read them, so an S7Plus book has no `BookType`
  either: structural sharing across identical machines still comes from a NodeSet or
  from the model generation. Worth adding once the walk itself is confirmed against a
  live driver — until then it would be a second unverified guess on top of a first.
- **S7Plus alarms** — `<station>|Alarms` is a browsable branch of its own (alarming
  addresses, which the standard panel offers when the address mode is alarm-driven).
  Out of scope here: the studio's `_alert_hdl` generation is its own path, and the
  vendor documents that alarming does not work together with online browsing
  (`s7plusOnlineNoAlarm`).
- **Browse-time type discovery** — a browsed book has no `BookType` (an online
  browse does not reliably expose `HasTypeDefinition`, the same limit the tag
  importer documents). Structural sharing across identical machines therefore comes
  from a NodeSet or from the model generation, not from the walk.
- Mass-edit rules & config profiles, auto-map-by-name, multi-user check-out
  locking (the baseline already detects the conflict; it does not prevent it).
