/**
 * Minimal ambient declaration for the bundled JSMpeg player
 * (`@cycjimmy/jsmpeg-player`, which ships ES modules without TypeScript types).
 * Only the subset of the API used by {@link ./ui/cs-viewer.ts} is declared.
 *
 * JSMpeg decodes an MPEG1-TS stream delivered over a WebSocket (live mode when
 * the URL is `ws://`/`wss://`) and renders it to a canvas.
 */
/* eslint-disable @typescript-eslint/member-ordering, max-classes-per-file -- ambient type declaration mirroring the library's runtime shape */
declare module '@cycjimmy/jsmpeg-player' {
  /** Options forwarded to the underlying `JSMpeg.Player` (overlay options). */
  export interface JSMpegPlayerOptions {
    /** Decode audio (requires an MP2 track in the stream). */
    audio?: boolean;
    /** Decode video. */
    video?: boolean;
    /** Size of the video decode buffer in bytes. */
    videoBufferSize?: number;
    /** Size of the audio decode buffer in bytes. */
    audioBufferSize?: number;
    /** WebSocket reconnect interval in seconds (0 disables). */
    reconnectInterval?: number;
    /** Callback once the source (WebSocket) is established. */
    onSourceEstablished?: (source: unknown) => void;
    /** Callback when the source has no more data for a while. */
    onStalled?: (source: unknown) => void;
    /** Callback after each decoded video frame. */
    onVideoDecode?: (decoder: unknown, time: number) => void;
    [key: string]: unknown;
  }

  /** Options for the higher-level `VideoElement` wrapper. */
  export interface VideoElementOptions extends JSMpegPlayerOptions {
    /** Existing canvas to render into (a new one is created when omitted). */
    canvas?: string | HTMLCanvasElement;
    /** Poster image URL shown before playback. */
    poster?: string;
    /** Start playing immediately. */
    autoplay?: boolean;
    /** Resize the wrapper to the video size once loaded. */
    autoSetWrapperSize?: boolean;
    /** Loop (static files only). */
    loop?: boolean;
    /** Whether the user can control playback (shows the play button overlay). */
    control?: boolean;
    /** Decode and display the first frame. */
    decodeFirstFrame?: boolean;
    /** Picture mode (no play button). */
    picMode?: boolean;
    /** Lifecycle hooks. */
    hooks?: {
      play?: () => void;
      pause?: () => void;
      stop?: () => void;
      load?: () => void;
    };
  }

  /** Low-level JSMpeg player. */
  export class Player {
    constructor(url: string, options?: JSMpegPlayerOptions);
    play(): void;
    pause(): void;
    stop(): void;
    destroy(): void;
    volume: number;
    paused: boolean;
  }

  /** High-level player that manages its own canvas inside a wrapper element. */
  export class VideoElement {
    constructor(
      videoWrapper: string | HTMLElement,
      videoUrl: string,
      options?: VideoElementOptions,
      overlayOptions?: JSMpegPlayerOptions
    );
    readonly player: Player;
    play(): void;
    pause(): void;
    stop(): void;
    destroy(): void;
  }

  const JSMpeg: {
    Player: typeof Player;
    VideoElement: typeof VideoElement;
  };
  export default JSMpeg;
}
