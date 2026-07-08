# Tag Importer — design notes & caveats

## Why this shape

- **Protocol-agnostic core + adapters.** A source adapter's only job is to
  produce a `TagModel` (`core/model.ts`) — a protocol-neutral description of
  *types*, *instances* and per-leaf *addresses*. The `DpTypeGenerator`
  (`core/generate.ts`) and the review UI are protocol-independent; only the
  `ProtocolAddress` (discriminated by `protocol`) and the OPC UA mapping module
  carry OPC UA specifics. **Adding a protocol** = write one adapter that returns a
  `TagModel` and, if it binds live addresses, extend the address builder — nothing
  else changes.
- **One serializable `ImportPlan`** (`core/plan.ts`) is both the dry-run preview
  and the `/apply` request body: what you preview is exactly what gets created.
- **No dedicated manager.** DPType/DP creation and OPC UA browse are all standard
  datapoint operations available on the webserver's shared `WsjServerGlobal.winccoa`
  handle (as proven by `paraController`), so the whole backend is one controller —
  simpler to deploy than a `config/progs` manager.

## Hybrid DPType policy (the confirmed decision)

Adapters express nested typed objects *faithfully* as `RefMember`s. The generator
then decides, per type, keep-as-`DPT_TYPEREF` vs flatten-into-a-`Struct`:

- kept if directly instantiated, **or** (hybrid on) referenced by **≥ 2** distinct
  parent types, **or** force-kept in the review;
- flattened otherwise (or if force-inlined, or if hybrid is off).

The **DPE path of a leaf is identical** whether its nested type is a typeref or
flattened (`Motor.Speed` either way), so instance address bindings survive the
choice unchanged. Types are emitted in dependency order; inline cycles are broken
by promoting a type to a typeref (warned), and a residual typeref cycle (which
`dpTypeCreate` cannot satisfy) is reported as a warning.

## OPC UA → WinCC OA datatype mapping (`core/opcua-mapping.ts`)

| OPC UA built-in | DPE element type | `_datatype` (transf.) |
|---|---|---|
| Boolean | `Bool` | 751 |
| SByte/Byte/Int16/UInt16/Int32 | `Int` | 752–756 |
| UInt32 | `UInt` | 757 |
| Int64 | `Long` | 758 |
| UInt64 | `ULong` | 759 |
| Float | `Float` | 760 |
| Double / Number | `Float` | 761 |
| String / Guid / NodeId / … | `String` | 762 / 764 / 767 |
| DateTime / UtcTime | `Time` | 763 |
| ByteString | `Blob` | 765 |
| LocalizedText | `LangString` | 768 |
| *(anything else)* | `String` (with warning) | 750 DEFAULT |

Array-valued variables (`ValueRank ≥ 1` or `0`) map to the `Dyn<Base>` element
type. Direction: read-only → `INPUT_POLL` (4), writable → `IO_POLL` (7),
write-only → `OUTPUT` (1). Reference is `<Conn>$$1$1$<NodeId>` (polling; the poll
group lives in `_poll_group`, not the reference).

## Caveats / v1 scope

- **NodeSet2 imports do not write address configs.** NodeSet namespace indices are
  file-local and generally differ from a live server's, so parsed NodeIds are only
  informational. A NodeSet import creates types + datapoints; bind them to a live
  connection afterwards (e.g. re-run online, or via PARA).
- **Online derives a flat type.** A live browse does not reliably expose shared
  type definitions, so an online-imported type's nested objects are flattened into
  `Struct` groups (the hybrid sharing applies fully only to NodeSet imports, which
  carry `HasTypeDefinition`).
- **Online AccessLevel is not read**, so browsed variables default to read-only
  (`INPUT_POLL`). Adjust in PARA if a tag must be writable.
- **Not imported (v1):** OPC UA Methods, Events, Alarms & Conditions, and
  historising/`_archive` configuration. Methods/events are skipped with a warning.
- **Type inheritance** (custom `HasSubtype` supertypes) is folded into each subtype
  as flattened members (WinCC OA has no DPType inheritance); standard base types
  contribute nothing.
- Existing datapoint types/datapoints are **skipped, never overwritten** (reported
  as `skipped`); `dpTypeChange` is intentionally not used here.

## Extending to another protocol (checklist)

1. Add `<protocol>` to the `ProtocolAddress.protocol` union in `core/model.ts`.
2. Write `adapters/<protocol>-<source>.ts` returning a `TagModel`.
3. If it binds live addresses, add the protocol's reference/direction/datatype
   mapping (mirror `core/opcua-mapping.ts`) and branch the address builder in
   `core/generate.ts` / the backend `writeAddress` on the discriminator.
4. Add a source option in `ui/ti-source.ts` and wire it in `tag-importer.ts`.
