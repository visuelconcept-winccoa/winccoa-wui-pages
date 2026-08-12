// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Offline demo entry — mounts the studio with the in-memory DemoEngGateway, so the
 * page runs (and is screenshotted) WITHOUT any WinCC OA runtime.
 *
 * It bootstraps Siemens iX FIRST (the elements, the icons and the theme the app
 * shell normally provides — see `ix-bootstrap.ts`), and only then imports the page:
 * the studio's templates use `ix-*` elements, and mounting before they are defined
 * would paint an unstyled frame the screenshot pipeline could catch.
 *
 * `?panel=` selects the initial panel and `?lang=en|fr|de` the UI language — both
 * used by the screenshot pipeline (the element resolves `?lang=` itself, see
 * i18n.ts; this entry only needs to forward `?panel=`).
 */
import { bootstrapIx } from './ix-bootstrap.js';

const PANELS = new Set(['devices', 'books', 'model', 'control']);

/** Not a top-level await: the demo's build target predates it. */
async function start(): Promise<void> {
  await bootstrapIx();

  const { WuiEngStudio } = await import('../src/eng-studio.js');

  const app = document.getElementById('app') as InstanceType<typeof WuiEngStudio>;
  app.useDemo();

  const panel = new URLSearchParams(location.search).get('panel');
  if (panel !== null && PANELS.has(panel)) {
    // Set once the element has booted its data.
    await customElements.whenDefined('wui-eng-studio');
    queueMicrotask(() => ((app as unknown as { panel: string }).panel = panel));
  }
}

void start();
