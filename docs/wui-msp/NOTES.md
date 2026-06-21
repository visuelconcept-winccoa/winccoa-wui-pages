# wui-msp — business & architecture notes

## Domain / purpose

Standalone WebUI **MSP** page (route `/msp`, custom element `wui-msp`, class `WuiMsp`, permission `connected`). It hosts the **parameters SPC (Statistical Process Control) dashboard demo**: X and moving-range control charts, control and tolerance limits, alarms, live streaming.

The page itself is a thin Lit shell: a `wui-content-header` + an `<iframe>` filling the body. All the SPC lives in the prototype loaded by the iframe; the page is only an isolating host.

Tier 1: **no backend or manager**, **no datapoint** connected to date (cf. module.json — `frontend` only, no `backend`).

## Architecture (isolation iframe)

- The iframe loads a **self-contained** HTML prototype (vanilla JS + Chart.js, monolithic application: X / moving-range charts, control & tolerance limits, alarms, live streaming).
- **Why an iframe rather than a Lit/iX rewrite**: the prototype makes heavy use of `document`/`window` globals and embeds its own CSS. The iframe fully isolates it from the iX app shell, without a rewrite. A deliberate "demo for now" choice, replaceable later by a real iX render.
- The HTML's vendor loader tries several paths (`../vendor/`, `/data/html/vendor/`, then relative `vendor/`); it's the 3rd (relative) that resolves the libs. The root-level script fallbacks produce harmless 404s (`onerror=""`).

## Demo mode (no datapoint)

- **Automatic activation**: if no WinCC OA CTL data is pushed (`window._initialParametersData` undefined), the prototype's `initializeWhenReady()` function loads its built-in `demoData` (parameters: courant, tension, vitesse_fil, deviation, temperature, pression), selects courant + tension, and starts the live demo flow.
- **`sendEvent` no-op outside WinCC OA**: when `oaJsApi` is absent (the case of a normal iframe, outside the WinCC OA EWO WebView), `sendEvent` just does a `console.warn`. The prototype therefore runs cleanly in a plain iframe, without error.

## Pitfalls / things to know

- **No real data**: no datapoint connection for now. To wire up live data, the real parameter data will need to be pushed into the prototype (e.g. via `window.initParametersDashboard(data)` / `addDataPoint`) in place of `demoData`.
- **Meaning of "MSP"** not fixed: titles / translations and the final icon are yet to be decided (the `cogwheel` icon is a known-good placeholder in the deployed bundle).
- The iframe's assets (prototype HTML, SPC components, Chart.js vendor) are **not** built by Vite: they are static assets served as-is. Only the page's custom element goes through the pages build.
- The iframe guarantees CSS/JS isolation: do not rely on state or style sharing with the iX shell.
