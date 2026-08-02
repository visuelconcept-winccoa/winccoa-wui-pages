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

⚠️ The fixture (`samples/schneider-fixtures.ts`) is hand-authored in the shape of
a data-editor export; re-calibrate against a **real** Control Expert export (and
consider the native `.XVM` XML export as a second parser) when one is available.
A UMAS-based online browse remains possible as an explicitly opt-in phase-2
generator, with the security trade-off stated to the user.

## What is proven

- OPC UA address mapping (`drivers/opcua.ts`) is the **verified** tag-importer
  code, unchanged (reference `<Conn>$$1$1$<NodeId>`, datatypes 750–768,
  directions). The `_address`/`_distrib` write set generalises the proven
  `tagImporterController.writeAddress`; the `_alert_hdl` and `_archive` writes
  mirror `para-alarm.ts` / `para-archive.ts`.

## Staged for later (explicit)

- **Backend** (`engController.ts`): `checkin`/`test-read` wired; **config
  read-back** in `readSnapshot` and the driver/poll-group resolution in
  `resolveAddressContext` are TODO. The studio runs fully on the demo gateway
  meanwhile.
- **TIA Openness connector**: a separate study (`docs/wui-tia-connector/`, to be
  written) — a thin agent that runs `PlcBlock.Export()`/`PlcType.Export()` and
  drops the XML bundle to the studio's ingestion (watched folder + POST), so the
  studio parses it as a book. Goal: minimal human steps between TIA and WinCC OA.
- Devices/workspace **server-side store**, mass-edit rules & config profiles,
  auto-map-by-name, multi-user check-out locking.
