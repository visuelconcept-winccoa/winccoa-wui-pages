# WinCC OA Dashboard - Claude Code Context

This file automatically loads project context for Claude Code sessions.

## Critical Thinking - READ FIRST

Read and follow `docs/knowledge/project/critical-thinking-rules.md` in every session.

- **Before creating files:** Check existing patterns in the codebase first
- **Before implementing UI:** Search for existing iX components that match the need

## Repository shape

The repo is a [wui-toolkit](https://github.com/visuelconcept-winccoa/winccoa-wui-tools) site, in the shape
`npx wui init project --no-winccoa` creates (`package.json` with the `libs/*` workspaces,
`wui.project.jsonc`, `.npmrc`, `.githooks/`, `mock/`); each `libs/wui-<id>/` is an
independent npm package with its own `tsconfig.json`. `npx wui dev` / `npm test` run
here, nothing is deployed from here (README "Develop").

- Tooling belongs in wui-toolkit, not here: do not add scripts, build config or a
  shared root `tsconfig` (`tools/`, `tsconfig.base.json`, Nx).

## Development Guidelines

@AGENTS.md
