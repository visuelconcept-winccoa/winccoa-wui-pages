# Embedding one atelier's 3D view in another module — `<wui-fleet-3d-view>`

Since **0.2.0**, `@visuelconcept-winccoa/wui-machine-fleet-3d` exports the 3D view of its
`/fleet-3d/:atelier` page as a public custom element, so another module's page (a workcenter
sheet, a tab configured by an administrator…) can show **one atelier**, display only. The
ateliers stay declared and edited **only** in Machine Fleet: the host stores an atelier **id**,
nothing else — never a layout, a machine list or a datapoint name.

## 1. Declare the dependency (host module)

In the host module's `package.json`:

```jsonc
"dependencies": {
  "@visuelconcept-winccoa/wui-machine-fleet-3d": "^0.2.0"
},
"wuiPage": {
  // machine-fleet-3d's backend (/api/ai, which now also serves the ateliers) is used when
  // deployed; the host page works without it (the element then shows "data unavailable").
  "optional": ["machine-fleet-3d"],
  // The element also goes through the shared kits, which call these two backends
  // (most pages already require them):
  "requires": ["para", "app-security"]
}
```

Use `requires: ["machine-fleet-3d"]` instead of `optional` if the host page is useless without
the 3D view: wui-toolkit then deploys machine-fleet-3d **headless** (its `/api/ai` backend and its
managers, no page, no menu entry) when the site does not select its page. See
[module-dependencies.md](../module-dependencies.md). `npm test` (`wui test`) checks these
declarations: it follows the element's imports, kits included. After changing the
dependencies, run `npx wui tsconfig` in the repository that holds the host module.

The ateliers themselves are built in the Machine Fleet page (and their machines bound to
datapoints there): a site that only embeds views still needs someone to manage them, so it
usually selects the page too (its edit actions can be restricted with the `edit` role).

**Bundle size.** The element brings the page's view with it, and `three` (bundled, not a shared
bundle of the shell): the host's page bundle grows accordingly. Within one site build, wui-toolkit
builds every page in a single pass, so the Machine Fleet page and the host share one chunk.

## 2. Import the element

```ts
import '@visuelconcept-winccoa/wui-machine-fleet-3d/fleet-view.js';
```

This path is stable (the file is `libs/wui-machine-fleet-3d/src/fleet-view.ts`). The element is
defined with a guard (`customElements.get` first), so importing it twice never throws. It renders
the page's own view (`mf-atelier-view`, in its display-only mode): one scene implementation for
the page and every host.

## 3. Use it

```ts
html`<wui-fleet-3d-view atelier=${tab.fleetAtelierId} fill></wui-fleet-3d-view>`
```

| Attribute | Default | Meaning |
| --- | --- | --- |
| `atelier` | — | The atelier id (`MachineFleet3D_<id>`) — the only input. Changing it releases the scene and loads the new atelier. |
| `fill` | off | Take the whole width **and** height of the container (give the container a size; in a flex column, `flex: 1; min-height: 0`). Without it the element is `height: var(--wui-fleet-3d-view-height, 480px)`. |
| `hide-toolbar` | off | Hide the view's top bar (atelier name, reset view, roof / labels / alerts-only, viewpoints, machine list, full screen). |
| `hide-nav` | off | Hide the navigation pad (rotate / tilt / zoom / presets / 2D-3D) and the saved-viewpoint bar. The mouse / touch camera stays. |

**Display only.** The user can move the camera, see the live machine states and their labels,
select a machine (its detail card: state, stop cause, parameters, KPIs), open the machine list,
jump to a saved viewpoint, toggle the roof / labels / alerts-only display and go full screen.
There is no edit mode, no atelier management (rename, delete, import, export, building, state
mappings, graphics catalog), no machine dialog, no AI prompt, and nothing that navigates away
from the host (no back button, no machine dashboard, no dashboard or custom links). The element
writes nothing: the display toggles stay local to the element.

**Full screen.** The toolbar's full-screen button puts the element itself full screen (and
back). With `hide-toolbar`, a host that wants it calls `el.requestFullscreen()` on the element.
Inside a host page the element sits in several shadow roots, where `document.fullscreenElement`
names only the outermost host: the element reads its own root's `fullscreenElement` to know
whether it is the full-screen element.

**States** shown in the element, without building a scene (`el.viewState` gives the current
one: `idle`, `loading`, `forbidden`, `not-found`, `unavailable`, `ready`):

| State | When |
| --- | --- |
| `forbidden` | The user lacks the `view` role of `machine-fleet-3d`: the live client grant (`hasRole$`, a revocation removes a shown scene), or a 403 from the backend where the atelier is read. |
| `not-found` | No `atelier` attribute, or the id is unknown (atelier deleted: a 404 from the backend). |
| `unavailable` | The backend does not answer: machine-fleet-3d not deployed (or `optional` and not selected), webserver not restarted, network error, 5xx. A Retry button reloads. |

## 4. Lifecycle and performance

- Everything is created when the element is **connected** and released when it is
  **disconnected**: the request in flight is aborted, and the view is removed, which disposes the
  scene — geometries, materials, textures, the WebGL renderer and its context
  (`SceneController.dispose`, `scene/dispose.ts`) — disconnects its resize / visibility
  observers, unsubscribes its live datapoints and clears its timers. Reconnecting reloads the
  atelier and builds a new scene.
- **Mount the element only while it is visible**: render it in the active tab only, not in every
  tab hidden with CSS. One view at a time: each one holds a WebGL context and draws every frame
  while it is on screen (the view stops drawing when it scrolls out of sight). Browsers cap the
  number of live WebGL contexts (about 16 in Chromium, the oldest one is then lost), and a GPU-less
  machine (SwiftShader) draws a large atelier at a few frames per second.
- **Its own streams**: one `GET /api/ai/fleet/ateliers/:id` when it loads (a plain request, closed
  at once), then live values over the dashboard's **existing** WebSocket (the shell's
  `OaRxJsApi`): one `dpGet` per bound datapoint to seed and validate them, then **one**
  `dpConnect` block for the whole atelier (state, stop cause, work order, operation, comm,
  tilt, parameter and kpiCalc datapoints). The role grant is one shared subscription per module
  (wui-kit `hasRole$`), graphics resources (`dp:` GLB / billboard) are one `dpGet` each, and the
  ALI risk scores (when that module is installed) a few one-shot reads. No HTTP connection stays
  open: the 6-connections-per-server limit of HTTP/1.1 is not consumed by the element.

## 5. Roles and listing

The atelier routes enforce Machine Fleet's Application Security `view` role (module
`machine-fleet-3d`) **server-side** (`requireRole`); the role is open until an admin assigns
groups in `/app-security`:

| Route | Role | Answer |
| --- | --- | --- |
| `GET /api/ai/fleet/ateliers` | `view` | `{ ok, ateliers: [{ id, name, machineCount }] }`, sorted by name |
| `GET /api/ai/fleet/ateliers/:id` | `view` | `{ ok, atelier, stopCauses }`, or 404 `{ ok: false, error: 'not-found' }` — what the element shows |

A host that lets its user pick an atelier (e.g. when configuring a tab) calls the listing — never
the `MachineFleet3D_Config` datapoints:

```ts
import { listAteliers } from '@visuelconcept-winccoa/wui-machine-fleet-3d/fleet-view.js';

const out = await listAteliers();            // never throws
if (out.kind === 'ok') this.options = out.body.ateliers; // { id, name, machineCount }[]
// out.kind: 'forbidden' (403) | 'not-found' | 'unavailable' (backend not deployed, …)
```

Why `/api/ai`: a wui-toolkit module has one backend mount, and Machine Fleet's has been `/api/ai`
(the AI assistant bridge para, ampere and gis call) since its first release; the atelier routes
live there in their own `/fleet` segment.

`requireRole` identifies the caller by the webserver's session (passport / basic auth). On a
webserver without HTTP authentication — the dashboard usually authenticates on its WebSocket only
— it cannot attribute a request and lets it through (logged): the client-side `view` grant then
does the gating in the element. Enable the webserver's authentication for a server-side refusal.

## 6. `wui dev`

The package ships `mock/api.mjs`, merged by `wui dev` for every module the site selects or deploys
headless (a `requires`, not an `optional` one): select machine-fleet-3d in the host's site
(`npx wui use machine-fleet-3d`) and its `wui dev` serves the ateliers the mock data declares
(the `MachineFleet3D_Config` type with its `dps` in a `fixtures.json`, each atelier in
`System1:<dp>.json`) — else the demonstration atelier `demo` (the one the Machine Fleet page shows
in `wui dev`), with its stop-cause catalog from `System1:MachineFleet3D_StopCauses.json` (else
empty). `<wui-fleet-3d-view atelier="demo">` then renders it; its machines have no bound
datapoint in the demo, so their states are the ones stored with the atelier.
