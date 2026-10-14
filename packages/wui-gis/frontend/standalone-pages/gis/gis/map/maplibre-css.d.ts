// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `?inline` CSS imports resolve to the stylesheet's text. Vite's own client types
 * declare `*.css?inline`, but this lib's `tsconfig.lib.json` is also type-checked
 * by the workspace-wide `tsc -p tsconfig.base.json` pass, which does not pull
 * `vite/client` in — so the one specifier the page needs is declared here.
 */
declare module 'maplibre-gl/dist/maplibre-gl.css?inline' {
  const css: string;
  export default css;
}
