// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/** The "bubbles on hover only" mode works whether the machine labels are shown or not (#378). */
import { describe, expect, it } from 'vitest';
import { labelsActive, labelVisibility } from './label-visibility.js';

const base = { labels: true, hoverMode: false, editMode: false, hovered: false };

describe('label visibility', () => {
  it('shows every dot and bubble with the labels on', () => {
    expect(labelVisibility(base)).toEqual({ dot: true, bubble: true });
  });

  it('shows only the hovered bubble in hover mode, every dot', () => {
    expect(labelVisibility({ ...base, hoverMode: true })).toEqual({ dot: true, bubble: false });
    expect(labelVisibility({ ...base, hoverMode: true, hovered: true })).toEqual({ dot: true, bubble: true });
  });

  it('shows every bubble in edit mode, even in hover mode', () => {
    expect(labelVisibility({ ...base, hoverMode: true, editMode: true })).toEqual({ dot: true, bubble: true });
  });

  it('hides everything with the labels off', () => {
    expect(labelVisibility({ ...base, labels: false })).toEqual({ dot: false, bubble: false });
    expect(labelVisibility({ ...base, labels: false, hovered: true })).toEqual({ dot: false, bubble: false });
    expect(labelVisibility({ ...base, labels: false, editMode: true })).toEqual({ dot: false, bubble: false });
  });

  it('still shows the hovered machine with the labels off in hover mode (#378)', () => {
    expect(labelVisibility({ ...base, labels: false, hoverMode: true, hovered: true })).toEqual({ dot: true, bubble: true });
    expect(labelVisibility({ ...base, labels: false, hoverMode: true, editMode: true, hovered: true })).toEqual({ dot: true, bubble: true });
    expect(labelVisibility({ ...base, labels: false, hoverMode: true })).toEqual({ dot: false, bubble: false });
  });

  it('draws nothing only when the labels are off outside hover mode', () => {
    expect(labelsActive(false, false)).toBe(false);
    expect(labelsActive(false, true)).toBe(true);
    expect(labelsActive(true, false)).toBe(true);
  });
});
