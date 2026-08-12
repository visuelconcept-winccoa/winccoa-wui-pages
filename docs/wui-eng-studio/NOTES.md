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
- **Datapoints** follow the VC convention (`{Zone}_{Equipement}`), one per
  equipment, and carry the source comments as DPE descriptions.
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
candidates. The device declares which modes it offers; the config generation
picks the candidate matching the device's mode.

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

Two smaller decisions inside the page's i18n:
- the module is **self-contained** (its own `ml()`/resolver) rather than importing
  `@wincc-oa/wui-i18n-shared`, because the page must render in the offline demo and
  the screenshot pipeline where no `@wincc-oa/*` package exists — the same reason it
  depends on `lit` only;
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

## Staged for later (explicit)

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
- **Browse-time type discovery** — a browsed book has no `BookType` (an online
  browse does not reliably expose `HasTypeDefinition`, the same limit the tag
  importer documents). Structural sharing across identical machines therefore comes
  from a NodeSet or from the model generation, not from the walk.
- Mass-edit rules & config profiles, auto-map-by-name, multi-user check-out
  locking (the baseline already detects the conflict; it does not prevent it).
