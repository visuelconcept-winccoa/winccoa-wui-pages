# Tag Importer — integration

## Manifest

`tools/specs.json` entry (page id `tag-importer`):

```json
{
  "page": "tag-importer",
  "name": "@visuelconcept/wui-tag-importer",
  "title": "Tag Importer",
  "tier": 3,
  "backend": {
    "mount": "/api/tag-importer",
    "routeClass": "TagImporterRoute",
    "routeFile": "tagImporterRoute",
    "srcFiles": ["tagImporterController.ts", "tagImporterRoute.ts", "appSecurityGuard.ts"]
  }
}
```

No `managers` — the page needs no dedicated WinCC OA manager. `deploy-release.mjs`
generates the module descriptor, copies the three `srcFiles` into
`<ws>/src/modules/tag-importer/`, and `build:pages` bundles the front end; the
menu and app-security fragments are merged automatically by the dev-wiring
plugins from `menu.fragment.jsonc` and `src/app-security.roles.json`.

## Backend API (`/api/tag-importer`)

All handlers run in the webserver against `WsjServerGlobal.winccoa` (the same
shared API `paraController` uses — `dpTypeCreate` / `dpCreate` / `dpSetWait` /
`dpConnect` / `dpGet`).

| Method | Path           | Role     | Purpose |
|--------|----------------|----------|---------|
| GET    | `/health`      | —        | liveness |
| GET    | `/connections` | `browse` | list `_OPCUAServer` connections (`{name, connected}`) |
| POST   | `/browse`      | `browse` | one browse level of a live server (`{connection,nodeId?,depth?}` → `{nodes}`) |
| POST   | `/apply`       | `create` | create the plan's types/DPs/addresses (`{plan,dryRun}` → `{ok,dryRun,results}`) |

**Browse** writes a request id to `_<conn>.Browse.GetBranch:_original.._value`
`[requestId, startNode, depth, eventSource]` and correlates the echoed
`Browse.RequestId` on the response DPEs (`DisplayNames`/`NodeIds`/`NodeClasses`/
`DataTypes`/`ValueRanks`/`BrowsePaths`), via `dpConnect` with a 120 s timeout —
ported from the ETM MCP server's `OpcUaConnection.browse`.

**Apply** creates each DPType (`dpTypeCreate` with a `WinccoaDpTypeNode` tree,
`Typeref` = element type 41), each DP (`dpCreate`), then for online imports writes
each address config atomically:

```
<dpe>:_distrib.._type   = 56 (DPCONFIG_DISTRIBUTION_INFO)
<dpe>:_distrib.._driver = <auto-detected OPC UA manager number>
<dpe>:_address.._type   = 16 (DPCONFIG_PERIPH_ADDR_MAIN)
<dpe>:_address.._drv_ident = "OPCUA"
<dpe>:_address.._reference = "<Conn>$$1$1$<NodeId>"     (empty subscription → polling)
<dpe>:_address.._direction = 4 INPUT_POLL | 7 IO_POLL | 1 OUTPUT
<dpe>:_address.._datatype  = 750..768 (OPC UA transformation type)
<dpe>:_address.._subindex  = 0
<dpe>:_address.._internal  = false
<dpe>:_address.._lowlevel  = true
<dpe>:_address.._offset    = 0
<dpe>:_address.._poll_group = <_PollGroup DP, ensured (Active, 1000 ms)>
<dpe>:_address.._active   = true
```

The manager number is auto-detected from `_OPCUA<n>.Config.Servers` (fallback: a
running `_Driver*` with `DT == "OPCUAC"`).

## Application Security

Declared in `libs/wui-tag-importer/src/app-security.roles.json` (imported by the
page for `registerModuleRoles`), roles **open until an admin assigns groups**:

- `view` — see the page;
- `import-file` — load/preview a NodeSet2 file (client-side, read-only);
- `browse` — connect to and browse a live server (enforced on `/browse`, `/connections`);
- `create` — the sensitive write (enforced on `/apply` — dry-run included).

The UI gates the source cards and the apply/dry-run buttons via `hasRole$`; the
backend enforces the same rules with `requireRole(...)` (`appSecurityGuard.ts`).

## Prerequisites

- **NodeSet2 import**: none — parsing is entirely client-side.
- **Online import**: a running WinCC OA OPC UA client driver and at least one
  configured `_OPCUAServer` connection (create it in the OPC UA client config
  panel). The connection must be up for browsing to succeed.
- The `/api/para` backend module is a de-facto prerequisite of the app-security
  self-registration (as for every role-gated page).
