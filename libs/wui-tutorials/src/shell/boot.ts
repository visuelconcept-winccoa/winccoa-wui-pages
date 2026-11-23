// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The module's boot script in the shell (`wuiPage.shell.boot`, wui-toolkit 0.23.0 or later):
 * the guide is put on the page as the application loads, and a tutorial being played resumes
 * where it was, on any page. `wui dev` runs no boot script: there, the #/tutorials page puts it.
 *
 * Declares neither a header element nor `loginHome`, and takes nothing from the shell's handle.
 */
import { installGuide } from '../guide/guide-overlay.js';

export default function boot(): void {
  installGuide();
}
