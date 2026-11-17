// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Local camera (webcam / USB camera of the PC running the browser) — the pure
 * parts of the capture, kept out of the viewer so they can be unit-tested:
 *
 * - {@link captureSupport}: getUserMedia needs a secure context (HTTPS or
 *   localhost) — outside one, `navigator.mediaDevices` is simply undefined;
 * - {@link classifyMediaError}: getUserMedia / play() errors → one of a few
 *   states the viewer explains (denied, not found, busy, …);
 * - {@link videoInputs} / {@link pickDevice}: the local video inputs, and which
 *   one to open given this browser's remembered choice;
 * - {@link buildVideoConstraints}: device + resolution preset → constraints
 *   (video only, never audio; the resolution is an `ideal`, never a hard limit);
 * - {@link loadDeviceChoice} / {@link saveDeviceChoice}: the per-browser device
 *   choice, in localStorage, keyed by camera id. The datapoint (shared by every
 *   PC) only says "a local camera"; device ids are per browser profile and per
 *   origin, so they cannot live there. The label is kept beside the id so the
 *   same camera is found again when the browser rotates its ids (site data
 *   cleared, permission reset);
 * - {@link stopMediaStream}: stops every track (the camera LED goes off).
 */
import type { LocalResolution } from '../types.js';

/** What the viewer can tell the user about a failed or impossible capture. */
export type LocalCameraProblem =
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'notFound'
  | 'busy'
  | 'overconstrained'
  | 'unknown';

/** localStorage key prefix of the per-browser device choice. */
export const DEVICE_CHOICE_PREFIX = 'wui-camera-streams.local-device.';

/** Target frame size of each resolution preset (`default` = the device's own choice). */
const RESOLUTION_SIZES: Record<Exclude<LocalResolution, 'default'>, { width: number; height: number }> = {
  '480p': { width: 640, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 }
};

/** The device a camera entry should open in this browser (remembered locally). */
export interface DeviceChoice {
  deviceId: string;
  label: string;
}

/** Minimal view of `window` needed to decide whether capture can work at all. */
export interface CaptureEnvironment {
  isSecureContext?: boolean;
  navigator?: { mediaDevices?: { getUserMedia?: unknown } };
}

/**
 * `null` when getUserMedia can be called, else why not. An insecure context is
 * reported first: there the browser hides `mediaDevices` entirely, so "not
 * supported" would be misleading.
 */
export function captureSupport(env: CaptureEnvironment): LocalCameraProblem | null {
  if (env.isSecureContext === false) return 'insecure';
  if (typeof env.navigator?.mediaDevices?.getUserMedia !== 'function') return 'unsupported';
  return null;
}

/**
 * Map a getUserMedia rejection to a problem. Names per the Media Capture spec,
 * plus the legacy Chrome / Firefox aliases still seen in the field. Firefox
 * reports a camera held by another application as `AbortError`.
 */
export function classifyMediaError(error: unknown): LocalCameraProblem {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError': {
      return 'denied';
    }
    case 'NotFoundError':
    case 'DevicesNotFoundError': {
      return 'notFound';
    }
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError': {
      return 'busy';
    }
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError': {
      return 'overconstrained';
    }
    default: {
      return 'unknown';
    }
  }
}

/** The video inputs among `enumerateDevices()` results, in the browser's order. */
export function videoInputs<T extends Pick<MediaDeviceInfo, 'kind'>>(devices: readonly T[]): T[] {
  return devices.filter((d) => d.kind === 'videoinput');
}

/**
 * Whether the browser hides the device labels — it does until the user grants
 * camera access once (then the "Allow camera access" step is needed).
 */
export function labelsHidden(devices: readonly Pick<MediaDeviceInfo, 'label'>[]): boolean {
  return devices.length > 0 && devices.every((d) => d.label === '');
}

/**
 * The device to open: the remembered one by id, else by label (ids rotate when
 * site data is cleared), else the first input. `undefined` when there is no
 * input, or when ids are hidden (before the permission) — let the browser pick.
 */
export function pickDevice<T extends Pick<MediaDeviceInfo, 'deviceId' | 'label'>>(
  inputs: readonly T[],
  choice: DeviceChoice | null
): T | undefined {
  const usable = inputs.filter((d) => d.deviceId !== '');
  if (usable.length === 0) return undefined;
  if (choice) {
    const byId = usable.find((d) => d.deviceId === choice.deviceId);
    if (byId) return byId;
    const byLabel = choice.label ? usable.find((d) => d.label === choice.label) : undefined;
    if (byLabel) return byLabel;
  }
  return usable[0];
}

/** Display label of a video input; `<unnamed> <n>` while the browser hides labels. */
export function deviceLabel(device: Pick<MediaDeviceInfo, 'label'>, index: number, unnamed: string): string {
  return device.label || `${unnamed} ${index + 1}`;
}

/**
 * getUserMedia constraints: video only. The device is `exact` (the user picked
 * it — a missing one must fail, not silently open another camera), the
 * resolution `ideal` (a camera that cannot do 1080p still opens).
 */
export function buildVideoConstraints(
  deviceId: string | undefined,
  resolution: LocalResolution | undefined
): MediaStreamConstraints {
  const video: MediaTrackConstraints = {};
  if (deviceId) video.deviceId = { exact: deviceId };
  if (resolution && resolution !== 'default') {
    const size = RESOLUTION_SIZES[resolution];
    if (size) {
      video.width = { ideal: size.width };
      video.height = { ideal: size.height };
    }
  }
  return { audio: false, video: Object.keys(video).length > 0 ? video : true };
}

/** Storage subset used for the device choice (localStorage in the page). */
export type ChoiceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** This browser's remembered device for a camera entry, or `null`. Never throws. */
export function loadDeviceChoice(storage: ChoiceStorage | undefined, cameraId: string): DeviceChoice | null {
  try {
    const raw = storage?.getItem(DEVICE_CHOICE_PREFIX + cameraId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const { deviceId, label } = parsed as Partial<DeviceChoice>;
    if (typeof deviceId !== 'string' || deviceId === '') return null;
    return { deviceId, label: typeof label === 'string' ? label : '' };
  } catch {
    return null; // storage blocked (private mode, policy) or corrupt value
  }
}

/** Remember (or with `null`, forget) the device for a camera entry. Never throws. */
export function saveDeviceChoice(
  storage: ChoiceStorage | undefined,
  cameraId: string,
  choice: DeviceChoice | null
): void {
  try {
    if (choice) storage?.setItem(DEVICE_CHOICE_PREFIX + cameraId, JSON.stringify(choice));
    else storage?.removeItem(DEVICE_CHOICE_PREFIX + cameraId);
  } catch {
    // storage blocked: the choice simply is not remembered
  }
}

/** Stop every track of a capture (releases the camera; its LED goes off). */
export function stopMediaStream(stream: Pick<MediaStream, 'getTracks'> | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}
