// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Offline demo entry — mounts the studio with the in-memory DemoEngGateway,
 * so the page runs (and is screenshotted) WITHOUT any WinCC OA runtime.
 * `?panel=` selects the initial panel and `?lang=en|fr|de` the UI language — both
 * used by the screenshot pipeline (the element resolves `?lang=` itself, see
 * i18n.ts; this entry only needs to forward `?panel=`).
 */
import '../src/eng-studio.js';
import type { WuiEngStudio } from '../src/eng-studio.js';

const app = document.getElementById('app') as WuiEngStudio;
app.useDemo();

const panel = new URLSearchParams(location.search).get('panel');
if (panel === 'devices' || panel === 'model' || panel === 'control') {
  // Set once the element has booted its data.
  customElements.whenDefined('wui-eng-studio').then(() => {
    queueMicrotask(() => ((app as unknown as { panel: string }).panel = panel));
  });
}
