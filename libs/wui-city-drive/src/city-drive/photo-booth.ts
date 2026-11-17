// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The photo booth (#91): a souvenir photo of the players when a match starts, taken with a
 * camera of the Camera Streams module, saved on the server by City Drive's backend in a folder,
 * one file per player named after their email (backend/photoStore.ts).
 *
 * Sources (the "Photo booth camera" setting):
 * - `webcam`: this PC's default webcam, straight from the browser (getUserMedia);
 * - a Camera Streams camera of kind `local` (a USB camera of this PC): the browser opens it,
 *   on the device this browser chose in Camera Streams (its localStorage key), else the default;
 * - a Camera Streams RTSP camera: one JPEG frame from `GET /api/rtsp/snapshot/<id>` (pulled by
 *   its rtspProxy manager), no live preview.
 *
 * Optional: without Camera Streams, the webcam source still works; without City Drive's
 * backend, the photo is taken and the page says it was not saved.
 */

export type BoothSource = { kind: 'off' } | { kind: 'webcam' } | { kind: 'local'; id: string; width?: number; height?: number } | { kind: 'rtsp'; id: string };

/** A camera of Camera Streams, as listed in the settings. */
export interface BoothCamera {
  id: string;
  name: string;
  kind: 'local' | 'rtsp';
  /** Resolution preset of a local camera (`1280x720`, or `default`). */
  resolution: string;
}

export const PHOTO_URL = '/api/city-drive/photo';
const SNAPSHOT_URL = '/api/rtsp/snapshot';
const DEVICE_KEY = 'wui-camera-streams.local-device.';
export const BOOTH_COUNTDOWN_S = 3;

/** The source of the "Photo booth camera" setting: '' off, 'webcam', or a Camera Streams id. */
export function boothSource(setting: string, cameras: readonly BoothCamera[]): BoothSource {
  if (!setting) return { kind: 'off' };
  if (setting === 'webcam') return { kind: 'webcam' };
  const cam = cameras.find((c) => c.id === setting);
  if (!cam) return { kind: 'off' };
  if (cam.kind === 'rtsp') return { kind: 'rtsp', id: cam.id };
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(cam.resolution);
  return m ? { kind: 'local', id: cam.id, width: Number(m[1]), height: Number(m[2]) } : { kind: 'local', id: cam.id };
}

/** A Camera Streams camera from its datapoint's JSON, or null. */
export function parseBoothCamera(id: string, json: string): BoothCamera | null {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    return { id, name: String(o.name ?? id), kind: o.kind === 'local' ? 'local' : 'rtsp', resolution: String(o.localResolution ?? 'default') };
  } catch {
    return null;
  }
}

/** The device this browser picked for a local Camera Streams camera (its own localStorage key). */
function chosenDevice(id: string): string | undefined {
  try {
    const raw = localStorage.getItem(`${DEVICE_KEY}${id}`);
    const o = raw ? (JSON.parse(raw) as { deviceId?: unknown }) : null;
    return typeof o?.deviceId === 'string' && o.deviceId ? o.deviceId : undefined;
  } catch {
    return undefined;
  }
}

/** Opens a live preview (webcam / local camera); null for an RTSP camera (no preview). */
export async function openPreview(src: BoothSource): Promise<MediaStream | null> {
  if (src.kind !== 'webcam' && src.kind !== 'local') return null;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use a camera here (HTTPS or localhost needed).');
  const device = src.kind === 'local' ? chosenDevice(src.id) : undefined;
  const video: MediaTrackConstraints = {
    ...(device ? { deviceId: { ideal: device } } : {}),
    ...(src.kind === 'local' && src.width ? { width: { ideal: src.width }, height: { ideal: src.height } } : { width: { ideal: 1280 }, height: { ideal: 720 } })
  };
  return navigator.mediaDevices.getUserMedia({ video, audio: false });
}

export function closePreview(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/** The photo, as a JPEG data URL: the current frame of the preview, or a snapshot of the RTSP camera. */
export async function takePhoto(src: BoothSource, video: HTMLVideoElement | null): Promise<string> {
  if (src.kind === 'rtsp') {
    const res = await fetch(`${SNAPSHOT_URL}/${encodeURIComponent(src.id)}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`camera snapshot ${res.status}`);
    const blob = await res.blob();
    return new Promise((ok, ko) => {
      const reader = new FileReader();
      reader.onload = () => ok(String(reader.result).replace(/^data:[^;]*;/, 'data:image/jpeg;'));
      reader.onerror = () => ko(new Error('snapshot unreadable'));
      reader.readAsDataURL(blob);
    });
  }
  if (!video || video.videoWidth === 0) throw new Error('no image from the camera');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const g = canvas.getContext('2d') as CanvasRenderingContext2D;
  // a selfie is mirrored on screen, not in the souvenir
  g.drawImage(video, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** Saves the photo for one player (file named after the email); returns the file name. */
export async function savePhoto(image: string, email: string, nickname: string): Promise<string> {
  const res = await fetch(PHOTO_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, email, nickname })
  });
  if (!res.ok) throw new Error(`photo not saved (${res.status})`);
  const body = (await res.json()) as { file?: string };
  return String(body.file ?? '');
}
