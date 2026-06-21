/**
 * Persistence layer for RTSP camera streams — one WinCC OA datapoint per camera
 * (type `RtspCamera_Stream`, a Struct with String elements `name` + `json`).
 *
 * Thin adapter over the shared {@link DpJsonStore}; it only wires the type/prefix
 * and keeps the page-specific method names. The `rtspProxy` JavaScript manager
 * reads these same DPs server-side to resolve a camera id → rtsp URL.
 */
import { DpJsonStore } from '../_kit/data/dp-json-store.js';
import { DEMO_STREAMS } from './demo-streams.js';
import type { CameraStream } from '../types.js';

export class StreamStore extends DpJsonStore<CameraStream> {
  constructor() {
    super(
      'RtspCamera_Stream',
      'RtspCamera_',
      (cam) => cam.name,
      () => DEMO_STREAMS.map((c) => structuredClone(c)),
      { slugFallback: 'camera' }
    );
  }

  listStreams(): Promise<CameraStream[]> {
    return this.list();
  }

  createStream(cam: CameraStream): Promise<CameraStream> {
    return this.create(cam);
  }

  saveStream(cam: CameraStream): Promise<void> {
    return this.save(cam);
  }

  deleteStream(id: string): Promise<void> {
    return this.remove(id);
  }

  /** Seed the backend with the supplied demo cameras. */
  importDemo(streams: CameraStream[]): Promise<CameraStream[]> {
    return this.importMany(streams);
  }
}
