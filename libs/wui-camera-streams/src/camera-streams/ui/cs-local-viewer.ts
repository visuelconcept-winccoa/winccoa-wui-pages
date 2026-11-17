// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Viewer of a **local camera** — a webcam / USB camera plugged into the PC
 * running the browser — the counterpart of `cs-viewer` (RTSP via the proxy).
 *
 * The browser captures it itself (`getUserMedia`, video only) into a
 * `<video autoplay muted playsinline>`: nothing goes through the server, and
 * the video never leaves this browser. Which device to open is this browser's
 * choice (toolbar select, remembered in localStorage per camera entry — see
 * `data/local-camera.ts`); the resolution preset comes from the shared entry.
 *
 * Permission: until the user grants camera access once, browsers hide the
 * device labels (and Safari the devices). Then the viewer does not prompt on
 * its own: it shows an "Allow camera access" button, which asks once, opens the
 * camera and re-enumerates (labels now visible). Once granted, it opens at once.
 *
 * The camera is released (every track stopped) when the viewer leaves the DOM
 * (back to the list, another route, page left), when another entry / device /
 * resolution is opened, and on Stop — no camera is ever left on.
 *
 * Embedded in a Mosaic tile (same-origin iframe, toolbar hidden, read-only),
 * it opens the device this browser remembered; the permission must have been
 * granted once on this site (same-origin iframes inherit `camera` from the
 * default Permissions Policy allowlist `self`).
 */
import { IXCoreStyles } from '@wincc-oa/wui-shared/styles/ix-core.js';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import type { CameraStream } from '../types.js';
import { MSG, localize, localizeDir } from '../i18n.js';
import {
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
  type LocalCameraProblem
} from '../data/local-camera.js';

type Status = 'idle' | 'permission' | 'starting' | 'live' | 'stopped' | 'error';

/** Why the viewer is in the error state: a capture problem, or the track ended. */
type ErrorCause = LocalCameraProblem | 'ended';

interface VideoInput {
  deviceId: string;
  label: string;
}

const STATUS_LABELS: Record<Status, MultiLangString> = {
  idle: MSG.viewer.statusIdle,
  permission: MSG.local.statusPermission,
  starting: MSG.local.statusStarting,
  live: MSG.local.statusLive,
  stopped: MSG.viewer.statusDisconnected,
  error: MSG.viewer.statusError
};

const ERROR_MESSAGES: Record<ErrorCause, MultiLangString> = {
  insecure: MSG.local.errInsecure,
  unsupported: MSG.local.errUnsupported,
  denied: MSG.local.errDenied,
  notFound: MSG.local.errNotFound,
  busy: MSG.local.errBusy,
  overconstrained: MSG.local.errOverconstrained,
  unknown: MSG.local.errUnknown,
  ended: MSG.local.ended
};

/** Problems no click can fix from the page (no Retry button). */
const FINAL_PROBLEMS = new Set<ErrorCause>(['insecure', 'unsupported']);

function localStorageOrUndefined(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // access itself can throw when storage is blocked
  }
}

@customElement('cs-local-viewer')
export class CsLocalViewer extends LitElement {
  static override readonly styles = [IXCoreStyles, localViewerStyles()];

  @property({ attribute: false }) stream!: CameraStream;

  @state() private status: Status = 'idle';
  @state() private cause: ErrorCause | null = null;
  /** Browser error text appended to an "unknown" problem (for support). */
  @state() private detail = '';
  @state() private inputs: VideoInput[] = [];
  @state() private selectedId = '';

  @query('video') private video!: HTMLVideoElement;

  private media: MediaStream | null = null;
  /** Bumped on every (re)start / release: a late getUserMedia result is dropped. */
  private generation = 0;
  /** Entry + resolution the current capture was opened for. */
  private openedFor = '';
  private readonly onDeviceChange = (): void => void this.refreshInputs();

  override render(): TemplateResult {
    const c = this.stream;
    const capturing = this.status === 'live' || this.status === 'starting';
    return html`
      <div class="toolbar">
        <ix-button variant="secondary" @click=${this.back}>${localizeDir(MSG.viewer.back)}</ix-button>
        <span class="title">${c.name}</span>
        <span class="endpoint">${localizeDir(MSG.local.endpoint)}</span>
        <span class="status ${this.status}">
          <span class="dot"></span>${localizeDir(STATUS_LABELS[this.status])}
        </span>
        <span class="grow"></span>
        ${this.renderDeviceSelect()}
        <ix-button variant="secondary" @click=${this.fullscreen}>
          <ix-icon name="maximize" slot="icon"></ix-icon>${localizeDir(MSG.viewer.fullscreen)}
        </ix-button>
        ${capturing
          ? html`<ix-button variant="secondary" @click=${this.stop}>
              <ix-icon name="close" slot="icon"></ix-icon>${localizeDir(MSG.viewer.stop)}
            </ix-button>`
          : html`<ix-button @click=${this.restart}>
              <ix-icon name="play" slot="icon"></ix-icon>${localizeDir(MSG.viewer.restart)}
            </ix-button>`}
      </div>

      <div class="stage">
        <video
          class="screen ${this.status === 'live' ? '' : 'hidden'}"
          autoplay
          muted
          .muted=${true}
          playsinline
        ></video>
        ${this.renderOverlay()}
      </div>
    `;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    globalThis.navigator?.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
    // Re-attached after a move in the DOM: open again (first open is in firstUpdated).
    if (this.hasUpdated) void this.open();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    globalThis.navigator?.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
    this.release();
  }

  protected override firstUpdated(_changed: PropertyValues): void {
    void this.open();
  }

  protected override updated(changed: PropertyValues): void {
    // Another entry, or its resolution edited → reopen with the new settings.
    if (changed.has('stream') && this.hasUpdated && this.openedFor !== '' && this.openedFor !== this.key()) {
      void this.open();
    }
  }

  private renderDeviceSelect(): TemplateResult | typeof nothing {
    if (this.inputs.length < 2) return nothing;
    const index = Math.max(
      0,
      this.inputs.findIndex((d) => d.deviceId === this.selectedId)
    );
    const unnamed = localize(MSG.local.unnamed);
    return html`
      <label class="device">
        <span>${localizeDir(MSG.local.device)}</span>
        <ix-select
          .selectedIndices=${[index]}
          @valueChange=${(e: CustomEvent<string | string[]>) => this.onSelectDevice(e.detail)}
        >
          ${this.inputs.map(
            (d, i) => html`<ix-select-item value=${d.deviceId} label=${deviceLabel(d, i, unnamed)}></ix-select-item>`
          )}
        </ix-select>
      </label>
    `;
  }

  private renderOverlay(): TemplateResult | typeof nothing {
    if (this.status === 'starting') {
      return html`<div class="overlay">
        <div class="panel">
          <ix-spinner></ix-spinner>
          <div class="p-status">${localizeDir(MSG.local.statusStarting)}</div>
        </div>
      </div>`;
    }
    if (this.status === 'permission') {
      return html`<div class="overlay">
        <div class="panel">
          <ix-icon name="video-camera" size="32"></ix-icon>
          <div class="p-text">${localizeDir(MSG.local.needPermission)}</div>
          <ix-button @click=${this.allow}>${localizeDir(MSG.local.allow)}</ix-button>
        </div>
      </div>`;
    }
    if (this.status === 'error' && this.cause) {
      const final = FINAL_PROBLEMS.has(this.cause);
      return html`<div class="overlay">
        <div class="panel error">
          <ix-icon name="warning" size="32"></ix-icon>
          <div class="p-text">${localizeDir(ERROR_MESSAGES[this.cause])}</div>
          ${this.detail ? html`<div class="p-detail">${this.detail}</div>` : nothing}
          ${final ? nothing : html`<ix-button @click=${this.restart}>${localizeDir(MSG.local.retry)}</ix-button>`}
        </div>
      </div>`;
    }
    return nothing;
  }

  // --- capture lifecycle -------------------------------------------------------

  /** Identity of what is open: another entry or resolution means reopen. */
  private key(): string {
    return `${this.stream.id}|${this.stream.localResolution ?? 'default'}`;
  }

  /**
   * Check that capture can work, list the inputs, then open the camera when the
   * permission is already granted — else wait for "Allow camera access".
   */
  private async open(): Promise<void> {
    this.release();
    this.openedFor = this.key();
    const problem = captureSupport(globalThis);
    if (problem) {
      this.fail(problem);
      return;
    }
    const generation = this.generation;
    const listed = await this.refreshInputs();
    if (generation !== this.generation || !this.isConnected) return;
    // No input listed or labels hidden: the permission was never granted
    // (Safari lists nothing before it) — ask through the button, not unprompted.
    if (listed.length === 0 || labelsHidden(listed)) {
      this.status = 'permission';
      return;
    }
    await this.start();
  }

  /** "Allow camera access": getUserMedia prompts once, then opens the camera. */
  private allow(): void {
    void this.start();
  }

  private restart(): void {
    void this.open();
  }

  /**
   * Open the chosen device and show it — or, with `useChoice` false, whatever
   * camera the browser picks (the fallback when the chosen one has vanished).
   */
  private async start(useChoice = true): Promise<void> {
    this.release();
    const generation = this.generation;
    this.status = 'starting';
    const storage = localStorageOrUndefined();
    const device = useChoice ? pickDevice(this.inputs, loadDeviceChoice(storage, this.stream.id)) : undefined;
    const constraints = buildVideoConstraints(device?.deviceId, this.stream.localResolution);
    let media: MediaStream;
    try {
      media = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      if (generation !== this.generation || !this.isConnected) return;
      const problem = classifyMediaError(error);
      // The chosen device vanished (unplugged since the listing): forget it, let the browser pick.
      if (problem === 'overconstrained' && device) {
        saveDeviceChoice(storage, this.stream.id, null);
        await this.start(false);
        return;
      }
      this.fail(problem, problem === 'unknown' && error instanceof Error ? error.message : '');
      return;
    }
    if (generation !== this.generation || !this.isConnected) {
      stopMediaStream(media); // superseded (released, another start) while the prompt was open
      return;
    }
    this.attach(media, generation);
    const track = media.getVideoTracks()[0];
    const openedId = track?.getSettings().deviceId ?? device?.deviceId ?? '';
    if (openedId) saveDeviceChoice(storage, this.stream.id, { deviceId: openedId, label: track?.label ?? '' });
    this.selectedId = openedId;
    // Labels are visible now that access is granted.
    await this.refreshInputs();
  }

  private attach(media: MediaStream, generation: number): void {
    this.media = media;
    for (const track of media.getVideoTracks()) {
      track.addEventListener('ended', () => {
        if (generation === this.generation) this.fail('ended');
      });
    }
    // Muted as a property too: the attribute of a cloned template is not reliably applied.
    this.video.muted = true;
    this.video.srcObject = media;
    // autoplay normally starts it; play() covers browsers that wait (muted, so allowed).
    this.video.play().catch(() => undefined);
    this.status = 'live';
    this.cause = null;
    this.detail = '';
  }

  /** Stop the capture: every track stopped, video detached, pending starts dropped. */
  private release(): void {
    this.generation++;
    stopMediaStream(this.media);
    this.media = null;
    if (this.video) this.video.srcObject = null;
  }

  private fail(cause: ErrorCause, detail = ''): void {
    this.release();
    this.status = 'error';
    this.cause = cause;
    this.detail = detail;
  }

  /** Re-read the video inputs (on open, after the grant, on plug / unplug). */
  private async refreshInputs(): Promise<VideoInput[]> {
    let devices: MediaDeviceInfo[] = [];
    try {
      devices = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    } catch {
      devices = [];
    }
    const listed = videoInputs(devices).map((d) => ({ deviceId: d.deviceId, label: d.label }));
    this.inputs = listed.filter((d) => d.deviceId !== '');
    return listed;
  }

  private onSelectDevice(detail: string | string[]): void {
    const deviceId = Array.isArray(detail) ? detail[0] : detail;
    if (!deviceId || deviceId === this.selectedId) return;
    const label = this.inputs.find((d) => d.deviceId === deviceId)?.label ?? '';
    saveDeviceChoice(localStorageOrUndefined(), this.stream.id, { deviceId, label });
    this.selectedId = deviceId;
    void this.start();
  }

  private stop(): void {
    this.release();
    this.status = 'stopped';
    this.cause = null;
    this.detail = '';
  }

  private fullscreen(): void {
    const stage = this.renderRoot.querySelector<HTMLElement>('.stage');
    void stage?.requestFullscreen?.();
  }

  private back(): void {
    this.release();
    this.dispatchEvent(new CustomEvent('wui:back', { bubbles: true, composed: true }));
  }
}

// eslint-disable-next-line max-lines-per-function -- single stylesheet literal
function localViewerStyles(): ReturnType<typeof css> {
  return css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      padding-bottom: 0.5rem;
    }
    .title {
      font-weight: 600;
    }
    .endpoint {
      color: var(--theme-color-soft-text);
      font-size: 0.85rem;
    }
    .status {
      --c: var(--theme-color-soft-text);
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.85rem;
      color: var(--c);
    }
    .status.live {
      --c: var(--theme-color-success);
    }
    .status.starting,
    .status.permission {
      --c: var(--theme-color-warning);
    }
    .status.error {
      --c: var(--theme-color-alarm);
    }
    .status .dot {
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      background: var(--c);
    }
    .grow {
      flex: 1;
    }
    .device {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.85rem;
      color: var(--theme-color-soft-text);
    }
    .device ix-select {
      min-width: 14rem;
    }
    .stage {
      position: relative;
      flex: 1;
      min-height: 0;
      background: var(--theme-color-2);
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .screen {
      max-width: 100%;
      max-height: 100%;
      width: 100%;
      height: 100%;
      object-fit: contain;
    }
    .screen.hidden {
      visibility: hidden;
    }
    .overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 1rem;
    }
    .panel {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.75rem;
      max-width: 32rem;
      padding: 1.25rem 1.75rem;
      border: 1px solid var(--theme-color-soft-bdr);
      border-radius: var(--theme-default-border-radius);
      background: var(--theme-color-1);
      color: var(--theme-color-std-text);
      text-align: center;
    }
    .panel ix-icon {
      color: var(--theme-color-primary);
    }
    .panel.error ix-icon {
      color: var(--theme-color-alarm);
    }
    .p-status {
      font-size: 1.05rem;
      font-weight: 600;
    }
    .p-text {
      font-size: 0.9rem;
      line-height: 1.4;
    }
    .p-detail {
      font-family: var(--theme-font-mono, monospace);
      font-size: 0.78rem;
      color: var(--theme-color-soft-text);
    }
  `;
}
