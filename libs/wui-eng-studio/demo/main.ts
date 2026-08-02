// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Offline demo entry — mounts the studio with the in-memory DemoEngGateway,
 * so the page runs (and is screenshotted) WITHOUT any WinCC OA runtime.
 * A `?panel=` query selects the initial panel (used by the screenshot tool).
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
