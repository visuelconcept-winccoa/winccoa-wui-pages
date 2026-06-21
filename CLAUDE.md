# WinCC OA Dashboard - Claude Code Context

This file automatically loads project context for Claude Code sessions.

## Critical Thinking - READ FIRST

Read and follow `docs/knowledge/project/critical-thinking-rules.md` in every session.

- **Before creating files:** Check existing patterns in the codebase first
- **Before implementing UI:** Search for existing iX components that match the need

## Screenshots of the pages

To capture screenshots of every standalone page (logged in, with live data), use
[`tools/screenshot-pages.mjs`](tools/screenshot-pages.mjs). It drives the Vite dev
server with Playwright, auto-discovers pages from each `libs/wui-*/menu.fragment.jsonc`,
and writes one PNG per page to `docs/images/manual/`.

```bash
# 1) point the dev server at a running WinCC OA (or let the tool start it):
#    BASE_URL=https://<oa-host>:<httpsPort> npm start      # in another shell (optional)
# 2) capture (credentials via env — never hardcode):
WUI_USER=<user> WUI_PASS=<pass> BASE_URL=https://<oa-host>:<httpsPort> node tools/screenshot-pages.mjs
#    options: --out <dir>  --only <id,id>  --headless  --dev-url <url>  --width/--height
```

Why it works this way (the page WebSocket and the HTTP-Basic `/WebUI_Token` login do
not survive a browser pointed straight at the deployed https host): the tool runs the
pages on the dev server (which proxies data/login to `BASE_URL`), injects the Basic
auth header on `/WebUI_Token`, ignores self-signed-cert errors, and strips the
`wui-message`/`ix-toast` system overlays before each shot. Details are in the script header.

## Development Guidelines

@AGENTS.md
