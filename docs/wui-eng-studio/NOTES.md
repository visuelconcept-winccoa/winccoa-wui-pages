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
- **Online browse** — `provenance.kind: 'opcua-browse'` books are stored and
  re-qualified, but `refreshBook` does not yet re-browse the server (it re-runs
  the rules on the stored catalog). Regenerating a browsed book is the next
  backend increment; file-based books are regenerated by re-ingesting.
- **Device form** — the UI's "add device" is still a stub; `POST /devices`
  accepts the registry, so devices can be provisioned by the API meanwhile.
- Mass-edit rules & config profiles, auto-map-by-name, multi-user check-out
  locking (the baseline already detects the conflict; it does not prevent it).
