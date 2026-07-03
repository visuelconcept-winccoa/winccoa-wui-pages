// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Bridge to the camera-streams (RTSP) module: discover the configured
 * `RtspCamera_*` stream datapoints and build the chromeless URL that embeds
 * one camera's live video (same `?embed=1`-inside-the-hash mechanism the
 * Mosaic tiles use — the SPA shell then renders only the routed page).
 * Requires the wui-camera-streams page + rtspProxy manager on the target;
 * without them the stream list is simply empty.
 */
import { WuiDpeService } from '@wincc-oa/wui-data-selector-data/wui-dpe/wui-dpe.service.js';
import { firstValueFrom } from 'rxjs';
import { container } from 'tsyringe';

const STREAM_TYPE = 'RtspCamera_Stream';
const STREAM_PREFIX = 'RtspCamera_';
/** Base URL of the dashboard SPA shell (hash routing carries the route). */
const APP_SHELL = '/data/dashboard-wc/index.html';

/** Bare ids of the configured RTSP streams ([] when the module is absent). */
export async function listCameraStreams(): Promise<string[]> {
  let dpe: WuiDpeService | null = null;
  try {
    dpe = container.resolve(WuiDpeService);
  } catch {
    return [];
  }
  try {
    const names = await firstValueFrom(dpe.listDatapoints(STREAM_TYPE));
    return names
      .map((n) => {
        const bare = n.includes(':') ? n.slice(n.indexOf(':') + 1) : n;
        const noDot = bare.endsWith('.') ? bare.slice(0, -1) : bare;
        return noDot.startsWith(STREAM_PREFIX) ? noDot.slice(STREAM_PREFIX.length) : noDot;
      })
      .filter((id) => id !== '')
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Chromeless live-video URL of one stream. The embed flag lives INSIDE the
 * hash, after the route — a pre-hash query would be dropped by the shell's
 * root redirect and the SPA router (same reasoning as the Mosaic tiles).
 */
export function cameraEmbedUrl(streamId: string): string {
  return `${APP_SHELL}#/camera-streams/${encodeURIComponent(streamId)}?embed=1`;
}
