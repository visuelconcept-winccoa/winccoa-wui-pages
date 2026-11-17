<!-- SPDX-FileCopyrightText: 2026 VISUEL CONCEPT -->
<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Changelog — @visuelconcept-winccoa/wui-camera-streams

## 0.2.0 — 2026-11-17

**Upgrade.** Rebuild the site (`npx wui build prod`) and **restart the `rtspProxy` manager**
(it now skips local cameras in its reachability probe). Existing cameras are unchanged: a
record without `kind` is read as an RTSP camera.

- **USB camera of this PC** — a new source kind next to RTSP ("Source" in the camera
  dialog). The browser captures a webcam / USB camera plugged into the PC it runs on
  (`getUserMedia`, video only, no audio) and shows it in a `<video>` in the usual viewer
  route `/camera-streams/<id>` (so also in a Mosaic camera tile). Nothing goes through the
  server: no proxy, no ffmpeg, the video never leaves the browser.
- **Stored like any camera**: one `RtspCamera_<id>` datapoint holding `kind: "local"` and a
  resolution preset (`localResolution`: default, 640 × 480, 1280 × 720, 1920 × 1080 — an
  `ideal` hint). **Which device** to open is a **per-browser** choice — device ids differ
  from one PC (and browser profile) to the next — picked in the viewer toolbar and kept in
  `localStorage` (`wui-camera-streams.local-device.<cameraId>` → `{ deviceId, label }`;
  the label finds the camera again when the browser rotates its ids).
- **Permission flow**: while the browser hides device labels (access never granted) the
  viewer shows an "Allow camera access" button that asks once, opens the camera and
  re-lists the devices by name; once granted it opens at once.
- **Clear states**: insecure context (HTTPS or localhost required), no camera found,
  permission denied (how to allow it in the browser), camera busy (`NotReadableError` /
  `AbortError`), selected camera gone (falls back to the browser's default once), camera
  unplugged while live.
- **No camera left on**: every track is stopped when the viewer leaves the page, on Back,
  on Stop, and when another camera entry, device or resolution is opened.
- **Table**: a local camera shows "USB camera of this PC" as endpoint, a USB chip, no
  reachability LED and no client count (the server never sees it).
- **rtspProxy manager**: never pulls, relays or probes a `kind: "local"` entry.
- **Import / export / audit**: `kind` and `localResolution` are exported, imported
  (unknown values coerced to `rtsp` / `default`) and traced in the audit trail.
- **Demo**: a "Webcam de ce PC" entry joins the demo cameras (works in `wui dev` on
  localhost).
- **Roles unchanged**: creating / editing a local camera is the existing `edit` role,
  viewing it the existing `view` role.
