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

## AI assistant — proposal-only, read-only MCP

`para-ai-assistant.ts` reuses `@visuelconcept/wui-ai-kit` (`askAi`,
`renderMarkdown`, `mf-ai-config-dialog`) and sends every prompt with
**`mcpMode: 'read-only'`**: it gets the project's *configured* MCP servers, minus
every mutating tool. The user always applies/saves changes themselves via the
editor. The system prompt + JSON proposal contract live in `para-ai-context.ts`.

The filtering is in the **manager** (`gatherMcpTools`), not in the page, and that
placement is the guarantee: a tool that is never declared to the model cannot be
called, whereas a page-side rule is one prompt away from being ignored. A tool is
kept when its MCP `annotations.readOnlyHint` says so, and — when the server sends
no annotation — when its name does not read like a mutation (`set`, `create`,
`delete`, `start`, …). The heuristic is deliberately over-cautious: dropping a
harmless tool costs a capability, keeping a mutating one costs the guarantee.

This replaced the earlier `mcpServers: []`, which bought the same safety by
having no tools at all — at the price of an assistant that could not check
anything, and had to be told never to propose a datapoint name. A page can still
pass `mcpServers: []` for a genuinely tool-free prompt.

Both `mcpServers` and `mcpMode` are per-call overrides carried by
`wui-ai-kit/data/ai-store.ts` (`AskAiOptions`) and forwarded by
`backend/routes/aiController.ts`. **They take effect only after the webserver is
rebuilt/restarted**; until then the guarantee falls back to the system prompt alone.

`webSearch`, `effort` and `maxTokens` ride the same three-layer path (`AskAiOptions`
→ bridge → `resolveOverrides` in the manager), so a page can send `webSearch: false`
for a project-only prompt, `effort: 'low'` for a latency-bound one, or a larger
`maxTokens` when it expects a big proposal. All three default from the
`AI_Assistant_Config` DP — web search **on**, effort **`medium`**, budget **32768** —
and the manager only sends each field to providers whose API accepts it (web search:
Anthropic, Gemini; effort: Anthropic, OpenAI o-series; budget: Anthropic, Gemini),
because a field a model does not know is a provider 400 rather than a silent no-op.

The budget is the one that bites in practice: a proposal that runs past it comes back
cut mid-object, which used to surface as an answer that simply had no applicable JSON
block. The manager now detects the provider's own truncation signal (`max_tokens` /
`finish_reason: length` / `MAX_TOKENS`), appends a note to the answer and returns
`truncated: true`, so a page can say why instead of staying mute.

## DPL ASCII import/export

Frontend: checkboxes on type/DP rows in `wui-para-nav` build a selection;
`para-dpl.ts` POSTs to `/api/para/dpl/{export,import}` and streams the `.dpl`
download / uploads the chosen file as base64. The import and export buttons
carry **separate** busy flags (`dplImportBusy` / `dplExportBusy` in `para.ts`)
so each button spins only for its own operation (both stay disabled while
either runs).

The same tick selection doubles as the **multi-delete** selection: a trashcan
button on the selection row (UI-gated by `edit-values`, like the single-DP
actions) opens `wui-para-dp-dialog` in `delete-multi` mode, which DELETEs the
ticked DPs one by one (`/api/para/dp/:name?dpType=`; the type guard is looked
up in the loaded tree and omitted when unknown — the backend accepts a
guard-less delete). Failed targets stay listed for retry; the dialog reports
`deletedDps` in `wui:done` so the page prunes them from the nav selection
(`removeFromExportSelection`). Ticked DP-types are ignored by the delete —
type deletion stays in the model tab.

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

## Application Security (roles — added 2026-07)

PARA declares 4 roles (self-registration in `para.ts` + mirrored in the
app-security manifest): `view`, `edit-types`, `edit-values`, `dpl-import`.
All OPEN until an admin assigns groups in `/app-security`
(docs/wui-app-security/INTEGRATION.md).

- **UI gating** (`hasRole$`, subscribed per component): `edit-types` hides the
  model-tab mutations (new type, add element/substruct, node delete, save,
  delete type — para-type-editor); `edit-values` hides the value/config write
  buttons (para-detail / para-config-detail) and the DP create/rename/delete
  node actions (para-nav); `dpl-import` hides the DPL import button (para.ts —
  export stays open, it only reads).
- **Server-side** (`requireRole` in paraRoute, guard shipped via
  `appSecurityGuard.ts` in the para srcFiles): `dptype/change` +
  `DELETE /dptype/:name` → `edit-types`; `dp/rename` → `edit-values`;
  `dpl/import` → `dpl-import`.
- ⚠️ **Deliberately NOT gated at the API level**: `dptype/create`, `dp/create`,
  `dp/set`, `DELETE /dp/:name` — they are the SHARED persistence API used by
  every DP-JSON page store (mosaic, ampère, app-security…); gating them with
  PARA roles would 403 an operator saving another page's data. They are gated
  in the PARA UI only.
- `edit-values` also gates the **Archive** and **Alarm** tabs' writes (archive
  group select + enable toggle in para-archive; Apply/Disable in para-alarm) —
  they write `_archive` / `_alert_hdl` configs through the same dp/set API.
