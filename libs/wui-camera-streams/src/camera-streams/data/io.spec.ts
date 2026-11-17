// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Import of camera files: the source kind and the local resolution preset are
 * read back, records from before 0.2.0 (no kind) stay RTSP cameras.
 */
import { describe, expect, it } from 'vitest';
import { parseStreams } from './io.js';

describe('parseStreams — source kind', () => {
  it('keeps a USB camera of this PC with its resolution', () => {
    const [cam] = parseStreams(JSON.stringify({ name: 'Webcam', kind: 'local', localResolution: '720p' }));
    expect(cam).toMatchObject({ name: 'Webcam', kind: 'local', localResolution: '720p', url: '' });
  });

  it('reads a record without kind (exported before 0.2.0) as an RTSP camera', () => {
    const [cam] = parseStreams(JSON.stringify({ streams: [{ name: 'Gate', url: 'rtsp://10.0.0.1/s' }] }));
    expect(cam).toMatchObject({ kind: 'rtsp', localResolution: 'default', url: 'rtsp://10.0.0.1/s' });
  });

  it('coerces an unknown kind or resolution to the defaults', () => {
    const [cam] = parseStreams(JSON.stringify([{ name: 'X', kind: 'onvif', localResolution: '4k' }]));
    expect(cam).toMatchObject({ kind: 'rtsp', localResolution: 'default' });
  });
});
