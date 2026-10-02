# WinCC OA Dashboard - AI Development Guidelines

> **🧠 Critical Thinking Rules - ALWAYS APPLY**
>
> Read and follow [`docs/knowledge/project/critical-thinking-rules.md`](./docs/knowledge/project/critical-thinking-rules.md) in every session.
> Key points: Don't assume - ask. Verify against official docs, not training data. Evaluate ideas critically. State uncertainty explicitly.

> **Information Hierarchy**
>
> 1. **`README.md`** - Setup, build, deployment instructions
> 2. **`docs/knowledge/*.md`** - Technical documentation, architecture guides
> 3. **`AGENTS.md`** (this file) - Coding standards and quick reference

## Project Overview

**WinCC Open Architecture Dashboard** - Web application for industrial dashboard development.

- **Domain**: SCADA visualization layer for WinCC OA backend
- **UI Library**: Siemens iX (`@siemens/ix`, `@siemens/ix-echarts`, `@siemens/ix-icons`)
- **Stack**: Lit 3 WebComponents, TypeScript, RxJS, Vaadin Router
- **DI**: tsyringe (singleton services, `container.resolve()`)
- **Build / dev / deploy**: [wui-toolkit](https://github.com/visuelconcept-winccoa/winccoa-wui-tools) (`wui` CLI, Vite) — this repo has no tooling of its own
- **Layout**: each `libs/wui-<id>/` is an independent npm package (`@visuelconcept-winccoa/wui-<id>`), published as is on GitHub Packages

## Commands

```bash
# Run / deploy — from a wui-toolkit site whose wui.project.jsonc "sources" point at this checkout (README "Develop")
npx wui dev                      # selected pages with mock data, hot reload (port 4300)
npx wui build <target>           # compile + deploy pages and backends into a WinCC OA project

# Per lib (cd libs/wui-<id>)
npx vitest run                   # unit tests, when the lib has a "test" script
npm run typecheck                # wui-eng-core, wui-alarms-core
npm pack --dry-run               # check what would be published
```

## Coding Standards

Standards are documented in `docs/knowledge/` - reference these files for full details:

- [**coding-conventions.md**](./docs/knowledge/project/coding-conventions.md) - Naming, file naming, TypeScript rules, imports, custom events, styling, formatting
- [**coding-style.md**](./docs/knowledge/project/coding-style.md) - Clean Code, SOLID, naming philosophy, early returns, comments

## Siemens iX Integration

- Use iX components where available - don't build custom equivalents
- Do not override iX component shadow DOM internals
- Use CSS custom properties for theming (`--theme-*` tokens)
- iX initialization is done once in the app shell - do not repeat in components

## Boundaries

### Always Do

- **Before modifying any module/page/library, re-read its own documentation first** — its `docs/<module>/README.md` + `NOTES.md` + `INTEGRATION.md` (when present), the module's source-header comment block, and any matching `docs/knowledge/*.md`. Do this every time, even for a change that looks like a one-liner: the docs record install/runtime coupling, backend contracts and caveats that the code alone does not surface. (E.g. for `libs/wui-para` read `docs/wui-para/README.md` and `docs/wui-para/INTEGRATION.md` before touching it.)
- **Application Security roles are part of every feature.** When you create a page module, when the user asks to "secure" / "add roles to" a module, and — without being asked — whenever a change **adds or removes a capability worth restricting** (edit mode, deploy/control action, signing, destructive operation…), apply [docs/wui-app-security/INTEGRATION.md](./docs/wui-app-security/INTEGRATION.md) in the same change: declare/update the module's roles in its own `libs/wui-<page>/src/app-security.roles.json` fragment (imported by the page for `registerModuleRoles` — single source of truth, no central manifest), gate the UI (`hasRole$`) and wrap sensitive backend routes (`requireRole` + `"@visuelconcept-winccoa/wui-app-security/appSecurityGuard.ts"` in the module's `package.json#wuiPage.backend.shared`). Roles are open until an admin assigns groups, so declaring them never breaks a deployment. Never write `.assignments` from a module; never rename a role id silently.
- Use iX components and CSS custom properties
- Use Shadow DOM for WebComponents
- **Declare runtime dependencies on other modules.** A page that calls another module's backend — directly (`fetch('/api/<module>/…')`) or through a kit (`DpJsonStore`, `DpSingleJsonStore`, `registerModuleRoles` / `hasRole$` of `wui-kit`, the stores of `wui-ai-kit` / `wui-fleet-core` → `/api/para` + `/api/app-security`) — lists that module in its `package.json#wuiPage.requires` and its package in `dependencies`, in the same change. wui-toolkit then deploys it headless (backend only) when the site does not select its page. See [module-dependencies.md](./docs/module-dependencies.md).
- Run lint on changed files
- Find and understand root causes before proposing solutions
- For questions about a `@wincc-oa/*` library's API or behavior, **read the library's installed README first** at `node_modules/@wincc-oa/<lib-name>/README.md` (e.g. `wui-oarxjs-data`, `wui-oarxjs-context`, `wui-alert-data`). Exception: `oa-rx-js-api` is still published as `@etm-professional-control/oa-rx-js-api`. These are the authoritative reference for that library; `docs/knowledge/` documents how libraries combine in app-level patterns.

### Ask First

- Adding new dependencies
- Modifying shared utilities or base classes
- Changing build configuration
- Creating new WebComponent patterns

### Never Do

- Override iX component shadow DOM internals
- Hardcode colors, spacing, or theme values
- Commit secrets, credentials, or `.env` files
- Skip TypeScript strict mode
- Use `any` type without justification
- Modify `node_modules` or generated files

## Documentation

Technical guides are available in `docs/knowledge/`:

### Architecture & Shell

- [webui-runtime-standalone-page-guide.md](./docs/knowledge/project/webui-runtime-standalone-page-guide.md) - Building standalone pages with data binding
- [webui-runtime-shared-bundles.md](./docs/knowledge/project/webui-runtime-shared-bundles.md) - Shared bundle system, import maps, and aliasing
- [webui-runtime-architecture.md](./docs/knowledge/project/webui-runtime-architecture.md) - Shell, templates, DI, routing overview
- [webui-runtime-example-datapoints.md](./docs/knowledge/project/webui-runtime-example-datapoints.md) - Example datapoints reference and production caveat

### Widget Development

- [oa-widget-create-step-by-step-guide.md](./docs/knowledge/project/oa-widget-create-step-by-step-guide.md) - Step-by-step widget creation
- [oa-widget-create-integrate-external-components.md](./docs/knowledge/project/oa-widget-create-integrate-external-components.md) - Integrating external components
- [oa-widget-schemas.md](./docs/knowledge/project/oa-widget-schemas.md) - Widget JSON schema reference
- [oa-widget-architecture.md](./docs/knowledge/project/oa-widget-architecture.md) - Widget system architecture and data flow
- [oa-dashboard-customization.md](./docs/knowledge/project/oa-dashboard-customization.md) - Menu, branding, and theme configuration
- [oa-dashboard-custom-icons.md](./docs/knowledge/project/oa-dashboard-custom-icons.md) - Custom SVG icon registration

### Siemens iX Design System

- [Siemens iX documentation](https://ix.siemens.io/) - Components, icons, and theme tokens

### Web Technologies

- [Lit documentation](https://lit.dev/docs/) - Framework reference, lifecycle, and patterns
- [MDN: Web Components](https://developer.mozilla.org/en-US/docs/Web/API/Web_components) - Standards reference
- [lit-state-management.md](./docs/knowledge/project/lit-state-management.md) - RxJS + Lit Context patterns, DI, subscription cleanup
- [lit-property-converter-results.md](./docs/knowledge/project/lit-property-converter-results.md) - Property type conversion behavior
- [web-components-guide.md](./docs/knowledge/project/web-components-guide.md) - WebComponent fundamentals

### Coding Standards

- [coding-conventions.md](./docs/knowledge/project/coding-conventions.md) - Naming, imports, formatting rules
- [coding-style.md](./docs/knowledge/project/coding-style.md) - Clean Code, SOLID, best practices

### Backend Integration

- [module-dependencies.md](./docs/module-dependencies.md) - Which pages require which module's backend (`wuiPage.requires`), headless deployment
- [webserver-api-reference.md](./docs/knowledge/project/webserver-api-reference.md) - HTTP endpoints and WebSocket protocol
- [webserver-authentication.md](./docs/knowledge/project/webserver-authentication.md) - Auth strategies and login flow
- [webserver-frontend-integration.md](./docs/knowledge/project/webserver-frontend-integration.md) - SharedWorker and ServiceWorker coordination
