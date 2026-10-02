// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * `?inline` CSS imports resolve to the stylesheet's text. Vite's own client types
 * declare `*.css?inline`, but a type-check that does not pull `vite/client` in
 * would not see them — so the one specifier the page needs is declared here.
 */
declare module 'maplibre-gl/dist/maplibre-gl.css?inline' {
  const css: string;
  export default css;
}
