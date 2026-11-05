// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Whether the opening view of an atelier (#70) is framed again when the view is resized (#72).
 *
 * The opening framing depends on the view's aspect: a panel opening beside the view, full screen
 * or a resized window would leave the symbols cut off or small. As long as the user has not moved
 * the camera since the opening view was framed, a resize frames it again; after any move of theirs
 * (drag, wheel, key, pad button, preset, fly to machine, viewpoint, 2D / 3D toggle) it never does.
 * A viewpoint is a pose, not a framing: once one is applied there is nothing to frame again.
 *
 * Pure state, no three.js: the atelier view feeds it, the unit tests drive it.
 */
import type { FrontSide, OpeningViewSetting } from '@visuelconcept-winccoa/wui-fleet-core/opening-view.js';

export interface FramedOpening {
  view: OpeningViewSetting;
  front: FrontSide;
}

export class OpeningReframe {
  private framed: FramedOpening | null = null;
  private untouched = false;

  /** The opening view was just framed (load, "Default view", 3D toggle): untouched again. */
  opened(view: OpeningViewSetting, front: FrontSide): void {
    this.framed = { view, front };
    this.untouched = true;
  }

  /** A viewpoint was applied instead: there is no opening view to frame again. */
  viewpointApplied(): void {
    this.framed = null;
    this.untouched = false;
  }

  /** The user moved the camera: a resize no longer moves it. */
  userMoved(): void {
    this.untouched = false;
  }

  /** On a resize: the opening view to frame again, or null. */
  toReframe(): FramedOpening | null {
    return this.untouched ? this.framed : null;
  }
}
