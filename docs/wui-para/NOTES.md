# wui-para — implementation notes

Read this (and `README.md` + `INTEGRATION.md`) **before editing** the PARA page
or its backend. It records the non-obvious contracts and assumptions.

## Page shape

`para.ts` is a two-tab shell under a shared header:
- Tab 0 **Modèle (Types)** (model — types) → `wui-para-type-editor`.
- Tab 1 **Instances & valeurs** (instances & values) → `wui-para-nav` (Type→DP→element tree) +
  `wui-para-detail` (live values + `wui-para-config-detail`).

Both tab bodies stay mounted; the inactive one is hidden with a `.hidden`
class (so editor drafts and tree state survive tab switches). The header hosts
`wui-para-ai-assistant`; the page passes it a `contextSummary` and handles its
`wui:applytype` event by switching to tab 0 and pushing the proposal into the
editor.

## DP-type editor — `dpTypeChange` rename contract

The editor keeps a working tree of `EditorNode`s. Each node remembers the name
it was **loaded** with (`origName`, `null` for nodes the user just added). On
save:
- **New type** → `POST /api/para/dptype/create` (`name` only).
- **Existing type** → `POST /api/para/dptype/change` (updates in place, keeping
  existing datapoints). For each node still carrying an `origName` we send
  `name = origName` and, if it changed, `newName = current name`; new nodes send
  `name` only; removed nodes are simply absent. This mirrors
  `backend/routes/paraTypeNode.ts` → `WinccoaDpTypeNode(name, type, refName, children, newName)`.

The element-type catalog (`para-element-types.ts`) is the single source of
truth; its names MUST match the backend `ELEMENT_TYPE_MAP` keys. v1 keeps the
**root as `Struct`** (scalar-root types are a later enhancement) and does **not**
reorder elements.

## AI assistant — proposal-only, no MCP

`para-ai-assistant.ts` reuses `@visuelconcept/wui-ai-kit` (`askAi`,
`renderMarkdown`, `mf-ai-config-dialog`) but is deliberately toolless: every
prompt is sent with **`mcpServers: []`**, so the LLM has no tools and cannot
mutate the project. The user always applies/saves changes themselves via the
editor. The system prompt + JSON proposal contract live in `para-ai-context.ts`.

The `mcpServers: []` per-call override only works because we extended the bridge:
`backend/routes/aiController.ts` now forwards `mcpServers`, and
`wui-ai-kit/data/ai-store.ts` `AskAiOptions` carries it. The manager
(`aiAssistant/index.js`) already honored a per-call `mcpServers`. **These take
effect only after the webserver is rebuilt/restarted**; until then the guarantee
falls back to the system prompt alone.

## DPL ASCII import/export

Frontend: checkboxes on type/DP rows in `wui-para-nav` build a selection;
`para-dpl.ts` POSTs to `/api/para/dpl/{export,import}` and streams the `.dpl`
download / uploads the chosen file as base64.

Backend: `dplController.ts` bridges HTTP → the **`DplAscii`** MSA service
(`backend/managers/dplAscii/index.js`), which shells out to **`WCCOAasciiSQLite`**
(`child_process.execFile`) in the project context.

- **Import** mirrors the proven reference command
  (`WCCOAasciiSQLite -currentproj -in <file>`).
- **Export** uses the ASCII manager's own object filters (verified against
  WinCC OA **3.21** `WCCOAasciiSQLite -help`, and run against the live project):
  `WCCOAasciiSQLite -currentproj -out <file> [-filterDpType <T>]… [-filterDp <dp>]…`
  - `-filterDpType <T>` → the type **definition + all its datapoints** (works
    even for a type with **no** instances). This is the "definition + instances".
  - `-filterDp <dp>` → restricts the datapoint output to that DP. The full type
    list is still emitted (standard ASCII dump), so a DP-only export stays
    self-contained/importable. The DP name may carry the `System:` prefix or not.
  - Both flags repeat and combine (union).
  ⚠️ The earlier `-yfile` guess was **wrong** (3.21 rejects it: "unknown option").
  The command is centralized in `dplAscii/index.js` (`ASCII_MANAGER` + the
  `runAscii([...])` args).

Deployment (dev): `npm run deploy:backend -- --project <root> --only para,machine-fleet-3d`
(specs-driven; see `webserver/SETUP.md`). It copies the para srcFiles
(incl. `dplController.ts`) + the machine-fleet-3d `aiController.ts` and rebuilds
the webserver. Then in pmon: **restart `customer-webserver`** so `/api/para/dpl/*`
mounts, register/start the **`dplAscii`** manager. Skipping the restart leaves the
new routes 404 even after a successful build.
