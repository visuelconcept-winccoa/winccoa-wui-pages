# WinCC OA Dashboard - Claude Code Context

This file automatically loads project context for Claude Code sessions.

## Critical Thinking - READ FIRST

Read and follow `docs/knowledge/project/critical-thinking-rules.md` in every session.

- **Before creating files:** Check existing patterns in the codebase first
- **Before implementing UI:** Search for existing iX components that match the need

## Repository shape

Each `libs/wui-<id>/` is an independent npm package; the repo has no build, dev or
deploy tooling — that is [wui-toolkit](https://github.com/visuelconcept-winccoa/winccoa-wui-tools)'s job (README "Develop").
Do not re-add root-level tooling (`tools/`, `package.json`, `tsconfig.base.json`, Nx).

## Development Guidelines

@AGENTS.md
