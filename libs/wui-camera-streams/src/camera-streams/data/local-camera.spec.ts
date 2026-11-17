// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The local (USB) camera's pure parts: whether capture can work, getUserMedia
 * errors → what the viewer explains, which device to open, the constraints, the
 * per-browser device choice, and that every track is stopped.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  DEVICE_CHOICE_PREFIX,
  buildVideoConstraints,
  captureSupport,
  classifyMediaError,
  deviceLabel,
  labelsHidden,
  loadDeviceChoice,
  pickDevice,
  saveDeviceChoice,
  stopMediaStream,
  videoInputs,
  type ChoiceStorage
} from './local-camera.js';

const named = (name: string): { name: string } => ({ name });

function memoryStorage(items: Record<string, string> = {}): ChoiceStorage & { items: Map<string, string> } {
  const map = new Map(Object.entries(items));
  return {
    items: map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k)
  };
}

const cam = (deviceId: string, label: string): { kind: MediaDeviceKind; deviceId: string; label: string } => ({
  kind: 'videoinput',
  deviceId,
  label
});

describe('captureSupport', () => {
  const withGum = { mediaDevices: { getUserMedia: () => undefined } };

  it('needs a secure context first (HTTPS or localhost)', () => {
    expect(captureSupport({ isSecureContext: false, navigator: {} })).toBe('insecure');
    expect(captureSupport({ isSecureContext: false, navigator: withGum })).toBe('insecure');
  });

  it('reports a browser without getUserMedia', () => {
    expect(captureSupport({ isSecureContext: true, navigator: {} })).toBe('unsupported');
    expect(captureSupport({ isSecureContext: true })).toBe('unsupported');
  });

  it('lets capture go in a secure context with getUserMedia', () => {
    expect(captureSupport({ isSecureContext: true, navigator: withGum })).toBeNull();
  });
});

describe('classifyMediaError', () => {
  it.each([
    ['NotAllowedError', 'denied'],
    ['PermissionDeniedError', 'denied'],
    ['SecurityError', 'denied'],
    ['NotFoundError', 'notFound'],
    ['DevicesNotFoundError', 'notFound'],
    ['NotReadableError', 'busy'],
    ['TrackStartError', 'busy'],
    ['AbortError', 'busy'],
    ['OverconstrainedError', 'overconstrained'],
    ['ConstraintNotSatisfiedError', 'overconstrained'],
    ['TypeError', 'unknown']
  ])('%s → %s', (name, problem) => {
    expect(classifyMediaError(named(name))).toBe(problem);
  });

  it('reads a real DOMException', () => {
    expect(classifyMediaError(new DOMException('in use', 'NotReadableError'))).toBe('busy');
  });

  it('copes with anything thrown', () => {
    expect(classifyMediaError(undefined)).toBe('unknown');
    expect(classifyMediaError('boom')).toBe('unknown');
    expect(classifyMediaError(new Error('boom'))).toBe('unknown');
  });
});

describe('the video inputs', () => {
  const devices = [
    { kind: 'audioinput' as MediaDeviceKind, deviceId: 'mic', label: 'Mic' },
    cam('a', 'Integrated Webcam'),
    { kind: 'audiooutput' as MediaDeviceKind, deviceId: 'spk', label: 'Speakers' },
    cam('b', 'USB Camera')
  ];

  it('keeps only the cameras, in order', () => {
    expect(videoInputs(devices).map((d) => d.deviceId)).toEqual(['a', 'b']);
  });

  it('knows the labels are hidden until the permission is granted', () => {
    expect(labelsHidden([cam('', ''), cam('', '')])).toBe(true);
    expect(labelsHidden([cam('a', 'Integrated Webcam')])).toBe(false);
    expect(labelsHidden([])).toBe(false);
  });

  it('numbers an unnamed camera', () => {
    expect(deviceLabel(cam('a', ''), 1, 'Camera')).toBe('Camera 2');
    expect(deviceLabel(cam('a', 'USB Camera'), 1, 'Camera')).toBe('USB Camera');
  });
});

describe('pickDevice', () => {
  const inputs = [cam('a', 'Integrated Webcam'), cam('b', 'USB Camera')];

  it('opens the remembered device', () => {
    expect(pickDevice(inputs, { deviceId: 'b', label: 'USB Camera' })?.deviceId).toBe('b');
  });

  it('finds it again by label when the browser rotated its ids', () => {
    const rotated = [cam('x', 'Integrated Webcam'), cam('y', 'USB Camera')];
    expect(pickDevice(rotated, { deviceId: 'b', label: 'USB Camera' })?.deviceId).toBe('y');
  });

  it('falls back to the first camera when the remembered one is gone', () => {
    expect(pickDevice(inputs, { deviceId: 'z', label: 'Unplugged' })?.deviceId).toBe('a');
    expect(pickDevice(inputs, null)?.deviceId).toBe('a');
  });

  it('lets the browser choose when there is no camera or the ids are hidden', () => {
    expect(pickDevice([], null)).toBeUndefined();
    expect(pickDevice([cam('', ''), cam('', '')], { deviceId: 'b', label: '' })).toBeUndefined();
  });
});

describe('buildVideoConstraints', () => {
  it('never asks for audio', () => {
    expect(buildVideoConstraints(undefined, undefined).audio).toBe(false);
    expect(buildVideoConstraints('a', '1080p').audio).toBe(false);
  });

  it('is any camera at its own resolution by default', () => {
    expect(buildVideoConstraints(undefined, 'default')).toEqual({ audio: false, video: true });
  });

  it('holds the chosen device exactly, the resolution as an ideal', () => {
    expect(buildVideoConstraints('a', '720p')).toEqual({
      audio: false,
      video: { deviceId: { exact: 'a' }, width: { ideal: 1280 }, height: { ideal: 720 } }
    });
    expect(buildVideoConstraints(undefined, '480p')).toEqual({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 } }
    });
    expect(buildVideoConstraints('b', 'default')).toEqual({ audio: false, video: { deviceId: { exact: 'b' } } });
  });
});

describe('the per-browser device choice', () => {
  it('is kept per camera entry', () => {
    const storage = memoryStorage();
    saveDeviceChoice(storage, 'cam-1', { deviceId: 'b', label: 'USB Camera' });
    saveDeviceChoice(storage, 'cam-2', { deviceId: 'a', label: 'Integrated Webcam' });
    expect(storage.items.get(`${DEVICE_CHOICE_PREFIX}cam-1`)).toBe('{"deviceId":"b","label":"USB Camera"}');
    expect(loadDeviceChoice(storage, 'cam-1')).toEqual({ deviceId: 'b', label: 'USB Camera' });
    expect(loadDeviceChoice(storage, 'cam-2')).toEqual({ deviceId: 'a', label: 'Integrated Webcam' });
  });

  it('can be forgotten', () => {
    const storage = memoryStorage();
    saveDeviceChoice(storage, 'cam-1', { deviceId: 'b', label: '' });
    saveDeviceChoice(storage, 'cam-1', null);
    expect(loadDeviceChoice(storage, 'cam-1')).toBeNull();
  });

  it('ignores a missing, corrupt or foreign value', () => {
    const storage = memoryStorage({
      [`${DEVICE_CHOICE_PREFIX}corrupt`]: '{not json',
      [`${DEVICE_CHOICE_PREFIX}no-id`]: '{"label":"x"}',
      [`${DEVICE_CHOICE_PREFIX}no-label`]: '{"deviceId":"a"}'
    });
    expect(loadDeviceChoice(storage, 'missing')).toBeNull();
    expect(loadDeviceChoice(storage, 'corrupt')).toBeNull();
    expect(loadDeviceChoice(storage, 'no-id')).toBeNull();
    expect(loadDeviceChoice(storage, 'no-label')).toEqual({ deviceId: 'a', label: '' });
  });

  it('never throws when storage is blocked or absent', () => {
    const blocked: ChoiceStorage = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('full', 'QuotaExceededError');
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError');
      }
    };
    expect(loadDeviceChoice(blocked, 'cam-1')).toBeNull();
    expect(() => saveDeviceChoice(blocked, 'cam-1', { deviceId: 'a', label: '' })).not.toThrow();
    expect(() => saveDeviceChoice(blocked, 'cam-1', null)).not.toThrow();
    expect(loadDeviceChoice(undefined, 'cam-1')).toBeNull();
  });
});

describe('stopMediaStream', () => {
  it('stops every track', () => {
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stopMediaStream({ getTracks: () => tracks as unknown as MediaStreamTrack[] });
    for (const track of tracks) expect(track.stop).toHaveBeenCalledOnce();
  });

  it('accepts no stream', () => {
    expect(() => stopMediaStream(null)).not.toThrow();
    expect(() => stopMediaStream(undefined)).not.toThrow();
  });
});
