# Tag Importer (`wui-tag-importer`)

Standalone WinCC OA WebUI page (`/tag-importer`) that imports device tags into
WinCC OA **datapoint types** and **datapoints** from two OPC UA sources, behind
one protocol-agnostic pipeline that is designed to extend to other protocols.

## What it does

- **From an OPC UA NodeSet2 XML file** (offline, parsed in the browser): every
  `UAObjectType` becomes a datapoint type; the repeated `UAObject` instances of
  a type become one datapoint each — i.e. the structure of repetitive nodes is
  *mutualised* into a single DPType.
- **From a live OPC UA server** (online, browsed through the backend): a selected
  instance's subtree becomes a datapoint type, the instance (and, optionally, its
  same-level siblings) become datapoints, and the OPC UA **peripheral address
  configs** (`_address`/`_distrib`) are written so the tags are live immediately.

A **dry-run preview** always precedes any write, and everything the operator will
create is shown in a review screen first.

## DPType structuring — the hybrid policy

Nested typed objects are handled by a **hybrid** rule (confirmed with the product
owner, toggigable and overridable per type in the review screen):

- a nested type used by **≥ 2** parent types becomes its **own DPType**, referenced
  via `DPT_TYPEREF` (shared, no duplication);
- a nested type used by a single parent (and not instantiated on its own) is
  **flattened** into that parent as a `Struct` group;
- turning the *"Share nested types"* option off flattens everything.

Referenced types are always created **before** their referrers (dependency order);
nesting cycles are broken by promoting a type to a reference (with a warning).

## Usage

1. Open **Tag Importer** in the menu.
2. **Driver** — choose the driver/protocol to import from (OPC UA today).
3. **Connection** — select an existing OPC UA connection (`_OPCUAServer`) or
   create a new one (endpoint `opc.tcp://…`, security policy/mode, credentials).
4. **Source** — choose *NodeSet2 XML file* (drop a `.xml`, offline) or
   *Live OPC UA server* (browse the chosen connection).
5. **Select** (live only) — browse the address space (with a live
   connection-state banner) and pick the instance to model as a datapoint type;
   optionally include same-level siblings.
6. **Review** — adjust the DPType name prefix, the hybrid option and the
   *Write address configs* toggle, inspect the datapoint types / datapoints /
   address configs to be created, and run a **Preview (dry-run)**.
7. **Apply** — after a confirmation, the types, datapoints and (bound) address
   configs are created in the project. A result report lists what was created,
   skipped (already existed) or failed.

The chosen connection feeds **both** sources; a NodeSet import can be bound to it
too (with a namespace-index caveat — its indices are file-local).

## Architecture (files)

```
libs/wui-tag-importer/
├── menu.fragment.jsonc                 # nav entry
├── package.json / project.json / tsconfig*.json
└── src/
    ├── tag-importer.ts                 # page shell (stepper + orchestration + role gating)
    ├── app-security.roles.json         # roles: view / import-file / browse / create
    └── tag-importer/
        ├── i18n.ts                     # EN / FR / DE strings
        ├── core/                       # protocol-agnostic pipeline
        │   ├── model.ts                #   the intermediate model (TagModel/TypeDef/InstanceDef)
        │   ├── plan.ts                 #   the serializable ImportPlan (front↔back contract)
        │   ├── generate.ts             #   DpTypeGenerator: model → plan (HYBRID typeref policy)
        │   ├── opcua-mapping.ts        #   OPC UA datatype/direction/reference mapping
        │   └── naming.ts               #   WinCC OA identifier sanitisation
        ├── adapters/                   # source connectors (extension point)
        │   ├── opcua-nodeset.ts        #   NodeSet2 XML → TagModel (browser DOMParser)
        │   └── opcua-online.ts         #   live browse → TagModel
        ├── data/api.ts                 # REST client → /api/tag-importer/*
        └── ui/                         # ti-source, ti-browse-tree, ti-review, ti-result
```

Backend (shared trees): `backend/routes/tagImporterController.ts` +
`tagImporterRoute.ts` (+ a copy of `appSecurityGuard.ts`). No dedicated manager —
the controller uses the webserver's shared `WsjServerGlobal.winccoa`.

See [`INTEGRATION.md`](./INTEGRATION.md) for deployment and [`NOTES.md`](./NOTES.md)
for design decisions, the datatype mapping table and caveats.
