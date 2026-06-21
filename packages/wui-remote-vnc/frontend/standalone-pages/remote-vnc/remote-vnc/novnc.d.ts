/**
 * Minimal ambient declaration for the bundled noVNC client (`@novnc/novnc`,
 * which ships ES modules without TypeScript types). Only the subset of the RFB
 * API used by {@link ./ui/rv-viewer.ts} is declared.
 */
declare module '@novnc/novnc/core/rfb.js' {
  export interface RfbCredentials {
    username?: string;
    password?: string;
    target?: string;
  }

  export interface RfbOptions {
    /** Whether other clients may stay connected (RFB shared flag). */
    shared?: boolean;
    /** VNC credentials (password for standard VNC auth). */
    credentials?: RfbCredentials;
    /** Repeater / proxy target id. */
    repeaterID?: string;
    /** WebSocket sub-protocols. */
    wsProtocols?: string[];
  }

  /**
   * noVNC RFB client. Construct with the target element, the WebSocket URL and
   * options; it connects immediately and emits DOM events
   * (`connect`, `disconnect`, `credentialsrequired`, `securityfailure`, …).
   */
  export default class RFB extends EventTarget {
    /** Scale the remote framebuffer to fit the container. */
    scaleViewport: boolean;
    /** Resize the remote session to the container size when supported. */
    resizeSession: boolean;
    /** Open the session read-only. */
    viewOnly: boolean;
    /** Quality level 0..9. */
    qualityLevel: number;
    /** Compression level 0..9. */
    compressionLevel: number;
    /** Show a dot cursor when the remote provides none. */
    showDotCursor: boolean;
    /** Background CSS of the canvas container. */
    background: string;

    constructor(target: Element, urlOrChannel: string, options?: RfbOptions);

    /** Send the stored/typed credentials after a `credentialsrequired` event. */
    sendCredentials(credentials: RfbCredentials): void;
    /** Send a Ctrl-Alt-Del to the remote. */
    sendCtrlAltDel(): void;
    /** Disconnect the session. */
    disconnect(): void;
    /** Focus the remote session. */
    focus(): void;
  }
}
