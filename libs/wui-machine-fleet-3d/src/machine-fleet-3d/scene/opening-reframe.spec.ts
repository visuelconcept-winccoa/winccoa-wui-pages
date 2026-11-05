import { describe, expect, it } from 'vitest';
import { OpeningReframe } from './opening-reframe.js';

const VIEW = { mode: 'tilted-ortho' as const, tilt: 30, margin: 12 };

describe('OpeningReframe (#72)', () => {
  it('frames the opening view again on a resize while the camera is untouched', () => {
    const r = new OpeningReframe();
    expect(r.toReframe()).toBeNull();
    r.opened(VIEW, 90);
    expect(r.toReframe()).toEqual({ view: VIEW, front: 90 });
    expect(r.toReframe()).toEqual({ view: VIEW, front: 90 });
  });

  it('never again once the user moved the camera — until the opening view is framed again', () => {
    const r = new OpeningReframe();
    r.opened(VIEW, 0);
    r.userMoved();
    expect(r.toReframe()).toBeNull();
    r.opened({ ...VIEW, mode: 'plan' }, 0);
    expect(r.toReframe()?.view.mode).toBe('plan');
  });

  it('not for a viewpoint: a pose, not a framing', () => {
    const r = new OpeningReframe();
    r.opened(VIEW, 0);
    r.viewpointApplied();
    expect(r.toReframe()).toBeNull();
  });
});
