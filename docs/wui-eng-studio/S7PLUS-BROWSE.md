<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# The S7Plus symbolic browse — protocol analysis, and how the studio uses it

How the **S7-1200/1500 symbolic browse** of WinCC OA actually works, read from the
**installed 3.21** (panels, CTRL libraries, base data, message catalogue), and how
the Engineering Studio builds an address book from it.

Everything below is *evidence*, not recollection: each claim names the file it was
read from, so an upgrade can be re-checked against the same places. The parts that
could NOT be verified offline are called out in [§7](#7-verification-status).

## 1 · Where the browse lives: on the CONNECTION datapoint

The S7Plus driver answers browse requests through a single request/response slot on
each `_S7PlusConnection` instance — the same shape as the OPC UA client's
`_OPCUAServer.Browse`, which is why the studio could reuse its whole architecture.

`dbdfiles/version_3.21/dptypes.txt` (and confirmed live with `dpTypeGet`):

```
_S7PlusConnection._S7PlusConnection  1
    Config  1
        Address 25 … StationName 25 … DrvNumber 20 … PLCType 20 …
    State   1
        ConnState 20 …
    Browse  1
        GetBranch      9    (dyn_string — the REQUEST)
        NodePaths      9    (dyn_string)
        NodeComments  44    (dyn_langString)
        SystemTypes    9    (dyn_string)
        ValueTypes     9    (dyn_string)
        ItemLengths    5    (dyn_int)
        RequestId     25    (string — the completion signal)
    Common  1
        State  1
            ConnState 21
```

The connection datapoint is `_<connection name>` (`S7PLUS_INOA = "_"` in
`scripts/libs/s7PlusDrvPara.ctl`); `address_s7plus_symbolic.pnl` composes it as
`g_s7drvdp = S7PLUS_INOA + $SERVER`. On a redundant system the *second* driver's
connection carries the suffix `_2` (`S7PLUS_REDU`), used when redundancy is active.

## 2 · The dialogue

`panels/para/s7plus_symbolic.pnl`, `treeConnect` / `tabConnect` and the tree's
`expanded` callback:

1. `dpSetWait(<conn>.Browse.RequestId, "")` — clear the echo **first**;
2. subscribe (`dpConnect`) to `RequestId` + the five answer arrays;
3. `dpSet(<conn>.Browse.GetBranch, [requestId, item, hmiVisible])`;
4. the driver fills the five arrays and then echoes `RequestId`; the answer whose
   `RequestId` is yours is yours. (The panel also polls in a `while` loop with a
   30 s cap — 600 × 100 ms — for the calls it makes synchronously.)

The request is built by `paS7PlusBrowseParams` (`scripts/libs/s7PlusDrvPara.ctl`):

```ctrl
dyn_string paS7PlusBrowseParams(string sReqId, string sItem, int iHmiVisible,
                                string sRecursive = "", bool bOptBrowse = false)
```

so `[requestId, item, hmiVisible]`, optionally followed by a recursion flag and an
"optimised browse" flag. The driver's own error message states the contract:

> `00025,GetBranch element requires 2 item for a valid browse query (Request ID,
> Start node [, HMI relevance filters])` — `msg/en_US.utf8/s7plus.cat`

**`hmiVisible`** is the checkbox `cbHmiVisible`, labelled *"Visible in HMI
Engineering"* with the tooltip *"Show only elements for which this property has
been set in the TIA project"*. The panels pass `1` by default.

### The five answer arrays

| element | what it carries |
|---|---|
| `NodePaths` | the node's own name (one segment). At the *station* level it is `"<station>\|<something>"`, and the panel keeps `strsplit(…,"\|")[1]` |
| `SystemTypes` | `Project`, `Station`, `Block`, `ComplexTag`, `Array`, `Struct`, `Variable`, `Tag`, … |
| `ValueTypes` | the TIA datatype (`Bool`, `Real`, `String[80]`, …) |
| `ItemLengths` | array length, or a string's length **including its 2 header bytes** (the panel subtracts them: `if (dsST[i] != "Array" && (sVT == "String" \|\| sVT == "WString")) diIL[i] -= 2`); `-1` = not applicable |
| `NodeComments` | the TIA member comment (a langString) |

**What is NOT in the answer: any access information.** No access level, no
direction, no history flag. This is the single most consequential fact for the
studio (see [§5](#5-what-the-studio-does-with-it)).

## 3 · The `item` grammar — a path, not a node id

There is no node id anywhere. A node is addressed by its `|`-separated path from
the TIA project:

```
''                                  → the TIA projects        (SystemTypes 'Project')
'<project>'                         → its stations            (SystemTypes 'Station')
'<project>|<station>'               → blocks and tag tables
'<project>|<station>|Blocks|<DB>'   → the members of a block
'<project>|<station>|Tags|<table>'  → the tags of a tag table
'<project>|<station>|Types|<UDT>'   → a PLC datatype (used by the TIA importer)
'<project>|<station>|Alarms'        → the alarm texts (alarming addresses)
```

`Blocks` and `Tags` are **synthetic segments the CLIENT inserts** — the driver
reports a data block as a plain child with `SystemType = 'Block'`, and the panel
builds the id itself (`s7plus_symbolic.pnl`, `refreshTree`):

```ctrl
else if (dsST[i] == "Block")      id = g_parentId + "|Blocks|" + dsNP[i];
else if (dsST[i] == "ComplexTag") id = g_parentId + "|Tags|"   + dsNP[i];
else                              id = g_parentId + "|"        + dsNP[i];
```

Getting this wrong does not raise an error: the driver answers an **empty level**,
and a catalog silently comes out short. That is why the studio's grammar lives in
one tested function (`s7plusChildItem`) and why its unit tests use a fake port that
*refuses* an item it was not asked for — a grammar mistake fails a test instead of
losing signals.

**Expandable** is everything that is not a leaf, which the panel states as
`if (dsST[i] != "Variable" && dsST[i] != "Tag") setExpandable(id, TRUE)`.

**Arrays.** Browsing an `Array` node does not always return every element: the
driver answers the first one (`Mesures[0]`) and the panel synthesises the rest up to
the parent's declared `ItemLength` (its `g_optBrowse` block). The panel also stops at
50 elements and asks the engineer whether to continue (`tiaArray>50`).

## 4 · Online vs a TIA export — the same walk, two sources

The driver browses either a **TIA export file** placed under
`<project>/data/TIA_Projects` (the panel's own hint: *"Projects must be stored at
../data/TIA_Projects"*, and `libFileSync.ctl` synchronises that folder in a
redundant project), or the **live PLC**.

The switch is the *project* name. `panels/para/s7plus_engineering.pnl`:

```ctrl
string sStationOnline = "S7Plus$Online|Online";
…
if (iSource == 1) sStation = sStationOnline;
dpSet(S7PLUS_INOA + sConn + sCFG + "StationName", sStationOnline);
```

So `Config.StationName` holds `"<project>|<station>"` — or the reserved
`S7Plus$Online|Online`, which is what "browse the machine" means. Two conditions the
standard panel enforces before an online browse, worth repeating because they are
the whole diagnosis when nothing comes back:

- the **S7Plus driver must be running**: `tiaDrvNumForSym` — *"The S7+ driver with
  number $1 must be started to use symbolic configuration!"*, checked with
  `drvsCheckRunningDrvNums("S7PLUS", false)` (`_Driver<n>.DT == "S7PLUS"`, from
  `_Connections.Driver.ManNums`);
- the **connection must be up** (`ConnState`), else `s7plusOnlineNoConn`.
  Alarming is also not supported with online browsing (`s7plusOnlineNoAlarm`).

## 5 · What the studio does with it

### The address the browse yields

`address_s7plus_symbolic.pnl` (`closeAndReturn`) turns the selected id into the
symbolic address: drop the station and the synthetic `Blocks`/`Tags` segment, then
replace `|` with `.` — `DB_Echange.Consigne.Valeur`. Two suffix rules come from
`paS7PlusUpdateDpcFromPanel`:

- a **string** carries its item length: `MyDB.Texte:80`;
- a symbol that itself contains a `:` gets a **trailing** `:`, so the driver can tell
  the symbol's colon from the length separator.

The connection does **not** ride in the reference: `para.ctl` (`case "s7plus"`)
writes it beside, into `_address.._connection = _<conn>`, together with `_reference`,
`_mode`, `_datatype`, `_poll_group`, `_drv_ident` and `_active`. The studio's
`buildAddressWrite` therefore appends `_address.._connection` **when the config
carries one** — OPC UA does not need it (its reference names the server), so absence
stays absence. `AddressConfig.connection` is written but not read back, so it is
dropped from diff comparison like `deviceId`/`mode` (`comparableConfigs`).

The `_datatype` transformation is the S7Plus table (1001–1027, IEC names) —
`drivers/s7.ts`, documented in [VENDOR-ADDRESS-TRANSFORMATIONS.md](./VENDOR-ADDRESS-TRANSFORMATIONS.md).
A TIA type the table has no transformation for yields **no address** and a warning,
never a plausible neighbour.

### Access: assumed, and the book says so

The browse states no access rights at all, so every entry is catalogued
`access: 'r'` with `accessSource: 'assumed'`, and `historized` stays **absent**
(unknown, never `false`). The consequences are the ones the OPC UA
`assumed` case already has: the address direction comes from the signal's **role**,
and a manual access override counts as evidence. Every S7Plus book therefore
carries `s7plus.access-assumed` as a warning — not because something went wrong,
but because "read-only" here is a default and not a reading.

### An export is a TEMPLATE catalog

A walk of the live PLC produces a book with an `interface` (protocol `s7plus`, the
connection, and the station in `params`). A walk of a TIA **export** produces a book
with **no interface**: it describes an engineered program, not a live binding, so it
is bound per equipment at generation — exactly like a NodeSet2 catalog. The book
says which it was (`s7plus.source-online` / `s7plus.source-project`).

### Bounded, and never silently

Depth, signal count, request count and **elements per array** are all capped, and
every truncation raises a warning naming what was left out (`browse.truncated-*`,
`s7plus.array-truncated`). The defaults are in `S7PLUS_BROWSE_DEFAULTS`.

## 6 · Architecture: a dedicated JavaScript manager

```
page ──HTTP /api/eng/s7plus/*──▶ webserver ──MSA vRPC "S7PlusBrowse"──▶ s7plusBrowse
  (core walker, level by level)   (thin stub)                            (JS manager)
                                                                              │
                                                                  dpSet/dpConnect on
                                                                  _<conn>.Browse.*
                                                                              ▼
                                                                     WCCOAs7plus driver
```

- **the pure core** — `libs/wui-eng-core/src/s7plus/browse.ts`: the walk (grammar,
  paths, caps, datatypes, warnings, book) behind an injected `S7PlusBrowsePort`.
  Unit-tested with a fake port: no WinCC OA, no driver, no PLC;
- **the manager** — `libs/wui-eng-studio/managers/s7plusBrowse/index.js`: the vRPC service that
  owns the driver dialogue (`Health`, `Connections`, `Projects`, `Stations`,
  `Level`);
- **the webserver** — `libs/wui-eng-studio/backend/engS7PlusBrowse.ts`: the stub + the port
  implementation, and `engController`/`engRoute` expose the `/api/eng/s7plus/*`
  routes plus `POST /books/browse-s7plus`;
- **the page** — runs the core's walker over one HTTP round-trip per level, so a
  walk shows progress and can be stopped (`data/walk.ts`, shared by both gateways);
- **the demo** — `data/demo-s7plus-station.ts`: a fake S7-1500 behind the same port,
  so the docs, the screenshots and the offline demo exercise the real walker.

### Why a manager, when the OPC UA browse runs in the webserver

`Browse.GetBranch` is **one element per connection**: a second request overwrites
the first before its answer arrives, and the first caller then waits for a reply
that never comes. A walk is hundreds of requests and two operators may browse at
once, so the requests of a connection must be serialised by **one long-lived
owner**. A webserver cannot be that owner — it is restarted on every deploy and
there can be several instances. Two secondary reasons: a chatty, minutes-long
conversation with a PLC does not belong in the webserver's event loop, and the
diagnosis a failed browse needs (which driver runs, which connection is up, which
station is configured) belongs next to the dialogue — which is what `Health` and
`Connections` answer.

There is deliberately **no direct-API fallback**: browsing from the webserver is
precisely what the manager exists to prevent, so with the manager absent the routes
say so instead of doing it anyway.

### Deployment

`package.json#wuiPage.backend.managers` → the `eng-studio` module declares
`["s7Browse", "s7plusBrowse"]`. `npx wui build` stages
`libs/wui-eng-studio/managers/s7plusBrowse/` into `<project>/javascript/s7plusBrowse/`;
register it in `config/progs`:

```
node             | always |      30 |        2 |        2 |s7plusBrowse/index.js
```

Then **start it in pmon** (the deployer never starts managers) and restart the
webserver so the new routes are loaded. After editing the manager, restart it.

## 7 · Verification status

**Verified offline, against the installed 3.21 and this repo:**

- the `_S7PlusConnection.Browse` element set — `dbdfiles/version_3.21/dptypes.txt`,
  **and live** through `dpTypeGet('_S7PlusConnection')` on the dev project;
- the request shape, the `item` grammar, the synthetic `Blocks`/`Tags` segments, the
  leaf rule, the string `-2` length rule, the array-element synthesis, the online
  station marker, the driver-running check — all read from the panels and CTRL
  libraries quoted above;
- the symbolic reference and its two suffix rules, and `_address.._connection` for
  `s7plus` — `s7PlusDrvPara.ctl` + `para.ctl`;
- the walker itself: 30 unit tests over a fake port (`s7plus/browse.spec.ts`), and
  the whole core suite stays green;
- the backend and the page typecheck offline against the real core sources
  (`npm test` → `wui test`, which typechecks each lib and each module's backend).

**⚠️ Not verified against a live S7Plus driver or PLC.** The dev project this was
written on has **no `_S7PlusConnection` datapoint and no WCCOAs7plus manager**, so
the one thing that cannot be checked offline — the actual request/response
round-trip with the driver — is still to be confirmed on a project that has one.
What to check first, in order:

1. the manager starts and `GET /api/eng/s7plus/health` reports `reachable: true`
   with the S7Plus driver numbers it found;
2. `GET /api/eng/s7plus/connections` lists the connections with their state and
   their configured `Config.StationName`;
3. `POST /api/eng/s7plus/projects` answers the TIA exports (plus the online entry),
   then `/stations`, then `/level` on `"<project>|<station>"`;
4. only then a full walk — and compare the catalog with what
   PARA's own "S7+ Symbolic" selection shows for the same station. That comparison
   is the real acceptance test: the studio and the standard panel must see the same
   program.

The likeliest thing to be wrong on first contact is the `hmiVisible` parameter's
polarity or an `item` shape a real driver spells differently from the panels — both
are one-line fixes in the manager, and both would show up as an unexpectedly empty
level rather than as an error.
