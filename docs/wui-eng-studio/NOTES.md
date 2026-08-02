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
`otherDevicesSharing`). The backend store (devices + books registry) is a
later increment.

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

The authoring format is an **outline** (`structure.ts`): indentation is nesting,
`Name : Type` is a leaf. A textarea, not a tree widget — the outline is readable,
diffable, pasteable between projects, and it is what a standard looks like in a
spec document. Switching to custom mode pre-fills it from the MIRRORED structure,
so authoring starts from something that already works, and `parseStructureOutline`
never throws: a bad line is reported next to the editor and skipped.

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
  3. a driver whose `_datatype` is still a sentinel (S7, Modbus) → flagged once,
     so nobody mistakes 0 for a verified transformation.
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
  a live DB. The S7 `_datatype` **transformation codes are intentionally left at
  a sentinel (0)** in `drivers/s7.ts` until verified against the S7 driver —
  same "verify against the real system, not training data" culture as
  `docs/wui-para/NOTES.md` (the DPL `-filter` work).

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

⚠️ Like `drivers/s7.ts`, `drivers/modbus.ts` leaves the WinCC OA
`_address.._datatype` transformation constants at a sentinel
(`MODBUS_DATATYPE_UNVERIFIED`) until verified against a live driver.

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

## Localisation boundary

The page is EN / FR / DE; the **core is English, in every language**. That line is
deliberate, and it is where it is for two reasons:

- `wui-eng-core` is a pure library with no i18n layer, and adding one would mean
  making `warnings: string[]` a structured `{code, params}` shape — which is stored
  in the book files, returned by the API and consumed by the backend. A localisation
  concern should not reshape the engineering contract.
- Its messages are part of its API: tests assert on them, the backend logs them, and
  a warning quoted in a bug report should read the same everywhere.

Consequence, stated plainly: a French or German operator sees a localised UI with
**English generator warnings**. If that is not acceptable, the fix is
`EngWarning { code, message, params }` in the core plus a code→`ml()` table in the
page, falling back to `message` for unknown codes — a contained refactor of the ~57
warning sites, not a redesign. Not done: it is a real cost and nobody has asked for
localised engine messages yet.

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
- **Device form** — the UI's "add device" is still a stub; `POST /devices`
  accepts the registry, so devices can be provisioned by the API meanwhile.
- **Browse-time type discovery** — a browsed book has no `BookType` (an online
  browse does not reliably expose `HasTypeDefinition`, the same limit the tag
  importer documents). Structural sharing across identical machines therefore comes
  from a NodeSet or from the model generation, not from the walk.
- Mass-edit rules & config profiles, auto-map-by-name, multi-user check-out
  locking (the baseline already detects the conflict; it does not prevent it).
