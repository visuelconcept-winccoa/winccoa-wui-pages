<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Classic S7 (S7-300/400) — symbol tables, AWL sources, and the online check

How the Engineering Studio builds and verifies an address book for a **classic S7**
equipment: what the protocol can and cannot answer, which STEP 7 exports fill the
gap, and the byte-level reference for the `s7Browse` JavaScript manager.

> This is the **S7-300/400** story. An S7-1200/1500 is a different one: the S7Plus
> driver does expose a symbolic browse, and the studio walks it —
> see [S7PLUS-BROWSE.md](./S7PLUS-BROWSE.md).

## 1 · The one fact the whole design follows from

**The classic S7 protocol carries no symbols.** A CPU answers which blocks exist,
how large each one is, when it was compiled and who wrote it. It never answers
that byte 4 of DB10 is called `Consigne_Vitesse` and holds a `REAL`. Names, types
and offsets live in the STEP 7 project, and S7comm has no message that returns
them — a limit of the protocol, not of any client library.

Two consequences, and they decide everything below:

1. an S7 catalog **cannot be generated online**. It is generated from the
   project's own exports;
2. the online side is therefore not a generator but a **verifier** — the only
   thing it can add is whether the export still matches the running machine.

Anything that claims to "browse the symbols of an S7-300" is reading a project
file somewhere. The studio does that reading explicitly, and says where each
piece of information came from.

## 2 · Two exports, two halves of one catalog

| | what it gives | what it cannot give |
|---|---|---|
| **Symbol table** (`.asc` / `.sdf` / `.seq` / `.csv`) | every named signal in the MEMORY AREAS — inputs, outputs, flags, peripheral words, timers, counters — plus the project's **block directory** (`Echange` = `DB10`) | the CONTENT of a data block |
| **AWL / STL sources** (`DATA_BLOCK`, `TYPE`) | the members of each data block, in declaration order, with their types and comments | the names of the memory-area signals |

The AWL side takes a **bundle**: one `.awl` per block, one file declaring the
whole program, or any mix — a source is scanned for every `DATA_BLOCK` and `TYPE`
it declares, and a UDT resolves for a block declared later in the same file. The
picker accumulates across successive selections rather than replacing, because a
file input replaces its own selection and would otherwise drop what was chosen
first without saying so.

They are ingested as two catalogs, or as one AWL catalog with the symbol table
supplied beside it *for its block directory only* — which is what lets a member be
pathed `Echange.Consigne_Vitesse` instead of `DB10.Consigne_Vitesse`. The
addresses are identical either way; only the generated DPE names change.

A symbol table ingested alone therefore yields a catalog with no DB member in it.
That is not a parser failure and must not look like one, so it is the catalog's
own first warning (`s7sym.no-db-content`), naming the data blocks whose contents
nobody supplied.

### Reading the symbol table without being told the dialect

Siemens exports the same table in several shapes, and the operator should not have
to know which one they have:

- `.asc` — fixed-width columns, each record prefixed by its length and a comma
  (`126,`), which is what makes an ASC line instantly recognisable;
- `.sdf` — System Data Format: quoted CSV, `"symbol","address","type","comment"`;
- `.seq` — the legacy sequential export, whitespace-separated;
- `.csv` — any of the above re-saved from Excel, `,` or `;` by locale.

So the split is decided **per line** — quoted CSV, tabs, semicolons, then runs of
two-or-more spaces. The last rule is what reads the fixed-width exports, and it
needs one repair: the address column of an `.asc` file is itself sub-columned
(`A      4.0`, `PEW  256`), so a run-of-spaces split tears the operand in two.
The fragments are re-joined **only when the merged text parses as an S7 operand
and the left fragment alone does not** — never on shape, so a datatype followed by
a comment (`BOOL` + `Ordre de marche`) can never merge.

### The column order is detected, not assumed

Siemens documents **both** `Symbol, Address, Type, Comment` (the symbol editor's
export) and `Address, Symbol, Type, Comment` (the reference-data export). Picking
wrong swaps every name with its address and produces a catalog that looks
plausible and addresses nothing. So the order is decided from the file: whichever
of the first two columns parses as an S7 operand across the majority of records is
the address column, and a file where neither wins is **refused**
(`s7sym.no-address-column`) rather than read at random.

### Access comes from the area, and is `declared`

An S7 process image is read-only to a driver by construction and an output image
is not a meaningful setpoint source, so the AREA is the evidence:

| area | access |
|---|---|
| `E`/`I`, `PE`/`PI` | `r` |
| `A`/`Q`, `PA`/`PQ` | `w` |
| `M`, DB members | `rw` |

These entries carry `accessSource: 'declared'` — a statement of the source, not a
default. This is the same rule the OPC UA browse applies to an `AccessLevel`, and
the same honesty: what the source states is `declared`, what it does not is not
invented.

### Both mnemonic languages

A STEP 7 project is configured in German (`E`ingang / `A`usgang / `M`erker /
`Z`ähler) or in English (`I`/`Q`/`M`/`C`), and the export carries whichever the
project uses. Both are read into the **same** area, so a catalog built from a
German export addresses identically to one built from an English export of the
same PLC.

### Offsets are computed, and by the existing code

An AWL source states the ORDER of the members and nothing about their addresses.
The classic layout turns that order into byte offsets — BOOL bit-packing, word
alignment, `STRING[n]` = n + 2 bytes, struct padding — and that computation
already exists, unit-tested, in `simaticml/offsets.ts`. It is **reused verbatim**
rather than reimplemented: two implementations of one layout rule drift, and a
drift here moves every address of a data block by a byte.

That reuse is also why this generator only ever produces classic operands
(`DB10.DBD4`). An S7-300/400 has no other layout, so nothing is lost; a block
compiled *optimized* on an S7-1200/1500 has no byte offsets at all, and the
catalog says so (`s7awl.standard-layout`).

## 3 · The online check — what it adds, and what it refuses to conclude

`POST /api/eng/books/:id/s7-inventory` reads the CPU's block directory through the
`s7Browse` manager and hands it to the pure core
(`crossCheckBookAgainstInventory`), which answers four distinct questions —
distinct because each calls for a different action:

| verdict | meaning | why it matters |
|---|---|---|
| `absent` | the catalog addresses a DB the CPU does not hold | every DPE built from it will fail to bind — the ticket arrives three weeks after check-in, described as a broken sensor |
| `overrun` | the catalog reads past the end of a DB | the block was shortened since the export. The addresses *below* the cut still work, which is exactly what makes this hard to notice |
| `unknown` | the CPU refused to describe the block (protected) | "we could not ask" — reported as such, never as `absent` |
| *uncatalogued* | the CPU holds DBs the catalog ignores | not an error; the only way to discover an export left something behind |

**Nothing is written.** Not to the catalog (it is a reading of the project), not
to the PLC. Silently reconciling the two would destroy the only information worth
having, which is that they disagree.

**What it cannot verify:** the memory-area signals. Inputs, outputs and flags have
no directory entry — the CPU reports blocks, never a symbol — so a catalog with no
data block gets a plain statement to that effect (`s7browse.no-db-addressed`)
rather than a reassuring green tick.

## 3 bis · The connection state of a classic-S7 equipment

The LED is read the same way for every protocol — `Common.State.ConnState` on the
connection datapoint — but an S7 equipment first has to be MATCHED to one. Until
now it could only be matched by searching its declared IP inside `_S7_Conn.Address`,
which says nothing when two stations sit behind one address (reported as
`ambiguous-connection`, no lamp) and nothing at all when the project spells the
address differently.

So a classic-S7 equipment may now **name its connection**, picked from the
project's own `_S7_Conn` list (`GET /api/eng/s7/connections`) exactly as an OPC UA
one names its server. The match then tries the **name first** and falls back to the
address, so:

- a named connection gives an exact state read, and the badge says which datapoint
  it was read on;
- an equipment declared before its connection exists still saves — the field is
  **optional**, and every equipment declared before it keeps working unchanged.

### ⚠️ What is deliberately NOT done: creating the connection

Saving an OPC UA equipment **creates** its `_OPCUAServer` when the project lacks
it. The same is *not* done for `_S7_Conn`, and that is a standing decision rather
than an omission: the write set of an S7 connection (which config elements, in
which order, and how it is registered with the S7 driver) is **not verified in
this repo**, and an invented one would mis-parameter every register it carries —
see [NOTES.md](./NOTES.md), "the `_S7_Conn`/`_Mod_Plc` config write sets are not
verified".

The consequence is worth stating plainly, because it is what an operator sees: the
connection must exist — created through the standard WinCC OA S7 driver panel —
before the studio can read a state on it. The studio then names it, reads it and
reports it; it does not provision it.

To lift this, what is needed is the vendor write set, read from the installed
system rather than from memory: the `_S7_Conn` structure in
`dbdfiles/version_<v>/dptypes.txt`, and what the S7 driver panel writes when it
creates a connection. With those in hand the provisioning is the same shape as the
OPC UA one (`provisionConnection` + a `CreateS7Connection` method on the CTRL
manager).

## 4 · The `s7Browse` manager

`libs/wui-eng-studio/managers/s7Browse/` — a WinCC OA **JavaScript manager** hosting the MSA
vRPC service `S7Browse`. The webserver stub is `libs/wui-eng-studio/backend/engS7Browse.ts`.

### Why a manager

- an inventory holds a TCP session to OT equipment for as long as it takes to
  describe every block, and the webserver serves the whole suite: one switched-off
  PLC must not become everybody's latency;
- its own process and lifecycle, restartable from pmon without touching the
  webserver;
- and it is the honest place for it — talking to a PLC is a manager's job.

### Read-only by construction

The protocol client implements the **block-directory subset and nothing else**:
no variable read, **no write**, no upload, no run/stop. This service cannot
disturb a production PLC however it is called. The HTTP routes are role-gated on
top of that, but the guarantee that matters is this one, because it does not
depend on configuration.

That is also why the two routes take `view` rather than `manage-devices`: they
read a CPU and store nothing, so they grant no more than the reads beside them,
and there is no capability here for a stronger gate to protect.

### Service surface

| Method | Request | Answer |
|---|---|---|
| `Health` | — | `{ok, service, served, readOnly}` |
| `Probe` | `{host, rack?, slot?, port?, timeoutMs?}` | `{ok, pduLength, cpu, endpoint}` |
| `Inventory` | `{host, …, blockKinds?, maxBlocks?, withBlockInfo?}` | `{ok, inventory}` |
| `BlockInfo` | `{host, …, kind, number}` | `{ok, block}` |
| `ReadSzl` | `{host, …, id, index?}` | `{ok, recordLength, records[] (hex)}` |

`{ok:false, error}` is an engineering refusal the studio shows to the operator
("no route to host", "the rack is wrong", "the block is protected"); only a
transport failure throws. Same convention as `aiAssistant` and the EngStudio CTRL
service, so the stub is the same shape.

### Deployment

`package.json#wuiPage.backend.managers` → `["s7Browse", …]`. `npx wui build` stages it
into `<project>/javascript/s7Browse/`; register it in `config/progs`:

```
node             | manual |      30 |        3 |        5 |s7Browse/index.js
```

`manual` on purpose: this manager only answers requests from the studio, so an
operator decides when a project may reach out to its PLCs. Starting it stays a
live-system action, as with every manager the deployer writes.

The studio degrades cleanly without it: `GET /api/eng/health` reports `s7Browse`
separately from the CTRL manager, and the page **hides** the check action rather
than showing it fail — the S7 catalogs are built from the exports and are complete
without the manager. It is a missing extra, not a broken page.

## 5 · Protocol reference — every byte, with its source

Transcribed from the **Snap7** sources and cross-checked against the **Wireshark
S7comm dissector**, both public. Recorded here for the same reason
[VENDOR-ADDRESS-TRANSFORMATIONS.md](./VENDOR-ADDRESS-TRANSFORMATIONS.md) records
the `_datatype` tables: constants that came from somewhere must stay auditable.

Sources:

- `snap7/src/core/s7_isotcp.{h,cpp}` — TPKT, COTP CR/CC and DT, the TSAP
  parameters (`BuildControlPDU`);
- `snap7/src/core/s7_peer.cpp` — `NegotiatePDULength`;
- `snap7/src/core/s7_micro_client.cpp` — `opListBlocks`, `opListBlocksOfType`,
  `opAgBlockInfo`, `opReadSZL`, `ConnectTo`;
- `snap7/src/core/s7_types.h` — the request/response structures and constants;
- `wireshark/epan/dissectors/packet-s7comm.c` — ROSCTR, function groups and
  subfunctions, block-type codes.

### Framing

```
TPKT   03 00 <len_hi> <len_lo>            len = the ENTIRE frame
COTP   CR: <hlen> E0 <dstRef:2> <srcRef:2> <class> <params…>
       DT: 02 F0 80
S7     32 <rosctr> 00 00 <pduRef:2> <parLen:2> <dataLen:2>   (+ <error:2> on ROSCTR 3)
```

`ROSCTR`: `01` job, `03` ack-data, `07` userdata.

### Connection

- source TSAP `0x0100`; destination TSAP `(connectionType << 8) + rack * 0x20 + slot`,
  with connection type `1` = PG (what STEP 7 itself uses). An S7-300 CPU is
  normally rack 0, slot 2 → `0x0102`;
- source reference `00 01`, destination `00 00`, class/option `0x00` (S7 wants 0,
  in disagreement with RFC 0983);
- TPDU size parameter `C0 01 0B`, then `C1 02 <srcTsap>` and `C2 02 <dstTsap>`.

Setup Communication (ROSCTR 1, 8 parameter bytes, no data):
`F0 00 00 01 00 01 <pduLength:2>` — the answer's `pduLength` at parameter offset 6
is the negotiated maximum.

### Userdata parameters

```
00 01 12 <plen> <method> <group> <subfunction> <sequence> [<reserved:2> <error:2>]
```

`plen` is `0x04` on a first request and `0x08` on a continuation (which adds the
reserved and error words). `method` is `0x11`, and `0x12` on an SZL continuation.
`group` packs the type in the high nibble and the function group in the low one:
**`0x43`** = request + block functions, **`0x44`** = request + SZL.

In an ANSWER, parameter byte 7 is the sequence number the CPU wants echoed and
**byte 9 is the "last data unit" flag** — `0x00` done, `0x01` more follows. That
byte is the whole paging mechanism of `ListBlocksOfType` and of a long SZL read.

### Data items

```
<returnCode> <transportSize> <length:2> <payload…>
```

`returnCode` `0xFF` = OK, `0x0A` = "no data" (what a continuation request carries);
`transportSize` `0x09` = octet string.

### The four calls

| call | group / subfunction | request data | answer |
|---|---|---|---|
| List blocks | `43` / `01` | `0A 00 00 00` | length **28**, then 7 × `{30, type, count:2}` |
| List blocks of type | `43` / `02` | first `FF 09 00 02 30 <type>`, then `0A 00 00 00` | items of 4 bytes `{number:2, ?, language}` |
| Block info | `43` / `03` | `FF 09 00 08 30 <type> <5 ASCII digits> 41` | 78 data bytes (below) |
| Read SZL | `44` / `01` | first `FF 09 00 04 <id:2> <index:2>`, then `0A 00 00 00` | `<id:2> <index:2> <recordLength:2> <recordCount:2>` then the records |

Block types travel as the ASCII pair `0x30` + a letter — `OB` `0x38`, `DB` `0x41`,
`SDB` `0x42`, `FC` `0x43`, `SFC` `0x44`, `FB` `0x45`, `SFB` `0x46`. So a DB request
carries `30 41`, i.e. `"0A"` (Wireshark's `S7COMM_BLOCKTYPE_DB 0x3041`). The `41`
that ends a block-info request is `'A'`, the **active** filesystem.

Block-info answer, offsets from the start of the data item:

| offset | field | | offset | field |
|---|---|---|---|---|
| 13 | block flags | | 36 | interface time, days |
| 14 | language | | 42 | local data size |
| 15 | sub-block type | | **44** | **MC7 size** |
| 16 | block number | | 46 | author (8 ASCII) |
| 18 | load memory size (u32) | | 54 | family (8 ASCII) |
| 26 | code time, ms of day (u32) | | 62 | header (8 ASCII) |
| 30 | code time, days (u16) | | 70 | version (nibbles) |
| 32 | interface time, ms (u32) | | 72 | checksum |

`MC7 size` is the one the cross-check needs: for a data block it is the size of
its DATA, so a catalog reading beyond it is reading past the end of the block in
the running PLC.

Timestamps are a **day count since 1984-01-01** plus a millisecond offset within
the day (epoch offset 441 763 200 s). Both are used: Snap7 keeps only the date,
but the time is what distinguishes two compilations on the same day — and "was
this block recompiled since the export?" is exactly the question.

SZL ids read: **`0x001C`** component identification (index 1 system name, 2 module
name, 3 plant designation, 5 serial number, 7 module type name) and **`0x0011`**
module identification, whose 20 ASCII characters after the index are the MLFB
order code. The record length is taken from the CPU's own answer rather than
hard-coded, because it varies between ids and firmware versions. The version words
of `0x0011` are carried **raw**, not decoded into a firmware string this project
has no vendor table for.

## 6 · Verification status

- **The core generators are unit-tested** with no runtime: 52 tests over the
  operand reader, the three symbol dialects, the AWL parser and the cross-check
  (`libs/wui-eng-core/src/s7/*.spec.ts`).
- **The protocol framing is tested against a fake CPU**:
  `node tools/check-s7-protocol.mjs` runs the real client over a loopback socket
  and asserts **every request byte for byte** against the telegram Snap7 builds
  for the same call, plus the answer parsing, the multi-PDU continuation, TPKT
  reassembly across two TCP segments, and the refusals (protected block, CPU error
  code, timeout, unreachable host). 31 checks.
- ⚠️ **Not yet run against a live S7-300/400.** The framing is transcribed and
  tested; what a real CPU's dialect does with it is not. First steps on the deploy
  target: start the manager, `GET /api/eng/health` and check `s7Browse.reachable`,
  then `POST /api/eng/s7/probe {deviceId}` — a correct `cpu.orderCode` proves the
  connection, the negotiation and the SZL path in one call, before any block walk.
- ⚠️ **The export dialects are calibrated on the published format descriptions and
  on hand-authored fixtures** (`samples/s7-fixtures.ts`), not on exports from the
  user's own STEP 7 projects — the same standing caveat the SimaticML parser
  carries (see [NOTES.md](./NOTES.md)). The tolerant per-line splitting and the
  detected column order are what make that caveat survivable: a dialect that
  differs in its padding still reads, and one that differs in its column order is
  detected rather than silently mis-read.
