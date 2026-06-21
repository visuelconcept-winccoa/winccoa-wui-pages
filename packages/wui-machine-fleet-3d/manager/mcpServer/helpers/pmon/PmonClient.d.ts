/**
 * Pmon TCP Client
 *
 * Client for communicating with WinCC OA Process Monitor (Pmon) via TCP protocol.
 * Supports all Pmon commands for manager administration.
 */
import type { PmonConfig, PmonResponse, PmonStatus, ManagerProperties, ManagerListEntry } from '../../types/pmon/protocol.js';
export declare class PmonClient {
    private host;
    private port;
    private user;
    private password;
    private timeout;
    constructor(config?: PmonConfig);
    /**
     * Send a command to Pmon via TCP
     * @param command - The Pmon protocol command to send
     * @returns Promise with the raw response string
     */
    private sendCommand;
    /**
     * Get list of all managers with their status
     * @returns Promise with parsed manager status
     */
    getManagerStatus(): Promise<PmonStatus>;
    /**
     * Get list of all managers with their configuration
     * @returns Promise with manager list
     */
    getManagerList(): Promise<ManagerListEntry[]>;
    /**
     * Add a new manager to the Pmon configuration
     * @param index - Position where to insert (1-based, 0 is Pmon itself)
     * @param manager - Manager name (without .exe extension)
     * @param startMode - Start mode: manual, once, or always
     * @param secKill - Seconds to wait before SIGKILL (default: 30)
     * @param restartCount - Number of restart attempts (default: 3)
     * @param resetMin - Minutes to reset restart counter (default: 5)
     * @param options - Command line options (default: '')
     * @returns Promise with operation result
     */
    addManager(index: number, manager: string, startMode?: 'manual' | 'once' | 'always', secKill?: number, restartCount?: number, resetMin?: number, options?: string): Promise<PmonResponse>;
    /**
     * Remove a manager from the Pmon configuration
     * @param index - Manager index to remove (1-based)
     * @returns Promise with operation result
     */
    removeManager(index: number): Promise<PmonResponse>;
    /**
     * Start a manager
     * @param index - Manager index to start (1-based)
     * @returns Promise with operation result
     */
    startManager(index: number): Promise<PmonResponse>;
    /**
     * Stop a manager (sends SIGTERM)
     * @param index - Manager index to stop (1-based)
     * @param ownManagerNumber - Optional: Own manager number to prevent self-stop
     * @returns Promise with operation result
     */
    stopManager(index: number, ownManagerNumber?: number | null): Promise<PmonResponse>;
    /**
     * Kill a manager (sends SIGKILL)
     * @param index - Manager index to kill (1-based)
     * @param ownManagerNumber - Optional: Own manager number to prevent self-kill
     * @returns Promise with operation result
     */
    killManager(index: number, ownManagerNumber?: number | null): Promise<PmonResponse>;
    /**
     * Get manager properties
     * @param index - Manager index (1-based)
     * @returns Promise with manager properties
     */
    getManagerProperties(index: number): Promise<ManagerProperties>;
    /**
     * Update manager properties
     * @param index - Manager index (1-based)
     * @param startMode - Start mode: manual, once, or always
     * @param secKill - Seconds to wait before SIGKILL
     * @param restartCount - Number of restart attempts
     * @param resetMin - Minutes to reset restart counter
     * @param options - Command line options
     * @returns Promise with operation result
     */
    updateManagerProperties(index: number, startMode: 'manual' | 'once' | 'always', secKill: number, restartCount: number, resetMin: number, options?: string): Promise<PmonResponse>;
    /**
     * Parse MGRLIST:STATI response into structured data
     * @param response - Raw response from Pmon
     * @returns Parsed manager status
     */
    private parseManagerStatus;
    /**
     * Parse MGRLIST:LIST response into structured data
     * @param response - Raw response from Pmon
     * @returns Parsed manager list
     */
    private parseManagerList;
    /**
     * Parse SINGLE_MGR:PROP_GET response into structured data
     * @param response - Raw response from Pmon
     * @returns Parsed manager properties
     */
    private parseManagerProperties;
}
//# sourceMappingURL=PmonClient.d.ts.map