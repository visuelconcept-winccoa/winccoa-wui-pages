// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Siemens iX bootstrap for the OFFLINE demo — the part the app shell normally
 * does once for every page.
 *
 * The studio renders `ix-*` custom elements and inlines `IXCoreStyles` into its
 * shadow roots, exactly like the other pages of the suite. Two things it does NOT
 * do (and must not, since the shell owns them):
 *   1. register the iX custom elements;
 *   2. put the iX THEME on the document — the `--theme-*` tokens live on
 *      `:root`/`.theme-*` and inherit into every shadow root, which is what makes
 *      the page's `--eng-*` aliases resolve to real colours.
 *
 * So this module does both, for the demo and the screenshot pipeline only. The
 * icons are registered EXPLICITLY rather than by loading the whole set: the demo
 * is also the screenshot harness, and a missing icon has to fail here (visibly,
 * in a shot) rather than silently in the shell.
 */
import { defineCustomElements } from '@siemens/ix/loader';
import '@siemens/ix/dist/siemens-ix/siemens-ix.css';
import { defineCustomElements as defineIxIcons } from '@siemens/ix-icons/loader';
import { addIcons } from '@siemens/ix-icons';
import {
  iconAddCircle,
  iconCancel,
  iconCheck,
  iconChevronDownSmall,
  iconChevronRightSmall,
  iconCircleDot,
  iconCogwheel,
  iconEye,
  iconEyeCancelled,
  iconInfo,
  iconLink,
  iconPen,
  iconPlus,
  iconRefresh,
  iconSearch,
  iconTrashcan,
  iconUpload
} from '@siemens/ix-icons/icons';

/**
 * Every icon the studio names in an `ix-button` / `ix-chip`.
 *
 * Listed one by one rather than loading the whole set: the demo is also the
 * screenshot harness, so an icon this page uses but nobody registered has to show up
 * HERE — as a missing glyph in a shot — instead of silently in a deployment.
 */
const ICONS = {
  'add-circle': iconAddCircle,
  cancel: iconCancel,
  check: iconCheck,
  'chevron-down-small': iconChevronDownSmall,
  'chevron-right-small': iconChevronRightSmall,
  'circle-dot': iconCircleDot,
  cogwheel: iconCogwheel,
  eye: iconEye,
  'eye-cancelled': iconEyeCancelled,
  info: iconInfo,
  link: iconLink,
  pen: iconPen,
  plus: iconPlus,
  refresh: iconRefresh,
  search: iconSearch,
  trashcan: iconTrashcan,
  upload: iconUpload
};

/**
 * Register the iX elements + icons and apply a theme. Idempotent, and awaited by
 * the demo entry so the first paint already has the design system — a screenshot
 * taken before this resolves would show unstyled custom elements.
 */
export async function bootstrapIx(theme = 'theme-classic-dark'): Promise<void> {
  document.documentElement.classList.add(theme);
  document.body.classList.add(theme);
  // `ix-icon` is its OWN package and its own element registry: registering the iX
  // components does not bring it, and without it every `icon=` renders as nothing.
  await Promise.all([defineIxIcons(), defineCustomElements()]);
  // The icons must be REGISTERED (not fetched): the demo is served from a bundle
  // with no `svg/` asset directory, so an icon resolved by URL would 404.
  addIcons(ICONS);
  // The studio's own elements are upgraded by the browser; the iX ones are
  // Stencil-lazy, so wait for the three that carry the page's chrome before
  // declaring the design system ready.
  await Promise.all([
    customElements.whenDefined('ix-tabs'),
    customElements.whenDefined('ix-button'),
    customElements.whenDefined('ix-icon')
  ]);
}
