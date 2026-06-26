# aliMcp — Asset Lifecycle Intelligence MCP server

Dedicated **Streamable-HTTP MCP server** (WinCC OA JS manager, ESM) exposing
ALI-specific tools over the `AssetLifecycle_Asset` datapoints. `ali-core.js` is a
server-side port of the page's `risk.ts` + `asset-tree.ts`, so tools return the
same composite scores as the UI.

## Endpoint
- `POST /mcp` — MCP (Streamable-HTTP). `GET /health` — liveness.
- Config (env / `.env`): `ALI_MCP_PORT` (default 3100), `ALI_MCP_HOST` (default
  `0.0.0.0`), `ALI_MCP_TOKEN` (optional Bearer; unset = auth disabled).

## Tools (13)
- **Read/analyse:** `ali_list_assets`, `ali_get_asset`, `ali_fleet_summary`,
  `ali_top_risks`, `ali_asset_tree`, `ali_group_scores`,
  `ali_obsolescence_report`, `ali_search`.
- **Siemens PIH:** `ali_lookup_mlfb`, `ali_refresh_obsolescence` (dry-run unless
  `apply:true`). Reads the key from `ProductInfo_Config`, calls the hub directly.
- **Write:** `ali_create_asset`, `ali_update_asset`, `ali_delete_asset`.

## Install / run in a WinCC OA project
1. Copy `aliMcp/` to `<project>/javascript/aliMcp/` (done by `deploy:backend`).
2. Provide deps in `<project>/javascript/aliMcp/node_modules/`:
   - `@modelcontextprotocol/sdk` and `zod` (npm install, or copy from the
     `mcpServer` manager).
   - **`winccoa-manager` as a directory JUNCTION** to
     `C:\Siemens\Automation\WinCC_OA\3.21\javascript\winccoa-manager`
     (NOT a copy — a copy breaks `binding.js`'s relative native-addon path).
     `cmd /c mklink /J <project>\javascript\aliMcp\node_modules\winccoa-manager <OA>\javascript\winccoa-manager`
3. Register in `config/progs` (or via pmon `add-manager`):
   `node | always | 30 | 2 | 2 |aliMcp/index.js`
4. Start the `aliMcp` manager; verify `GET http://127.0.0.1:3100/health`.

After editing this manager, restart it.
