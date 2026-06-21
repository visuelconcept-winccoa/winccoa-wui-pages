/**
 * Base Connection Class
 *
 * Abstract base class for all driver connections (OPC UA, S7Plus, BACnet, etc.).
 * Provides shared functionality and enforces common patterns.
 */
import { WinccoaManager } from 'winccoa-manager';
import type { DpAddressConfig, DpDistribConfig } from '../../types/index.js';
/**
 * Abstract base class for driver connections
 *
 * All driver-specific connection classes must extend this class.
 * Provides common helper methods for datapoint management and validation.
 */
export declare abstract class BaseConnection {
    /** WinCC OA manager instance */
    protected winccoa: WinccoaManager;
    constructor();
    /**
     * Protected method to set address configuration (common implementation)
     * Sets all address fields
     *
     * @param dpName - Full datapoint element name (e.g., 'MyDP.Value')
     * @param config - Address configuration
     * @returns true on success, false on failure
     */
    protected setAddressConfig(dpName: string, config: DpAddressConfig): Promise<boolean>;
    /**
     * Protected method to set BOTH address and distribution configs in a single atomic operation
     * CRITICAL: WinCC OA requires _address and _distrib to be set together atomically!
     *
     * @param dpName - Full datapoint element name (e.g., 'MyDP.Value')
     * @param addressConfig - Address configuration
     * @param distribConfig - Distribution configuration
     * @returns true on success, false on failure
     */
    protected setAddressAndDistribConfig(dpName: string, addressConfig: DpAddressConfig, distribConfig: DpDistribConfig): Promise<boolean>;
    /**
     * Protected method to set distribution config (manager allocation)
     * This is a separate config parallel to _address
     *
     * @param dpName - Full datapoint element name (e.g., 'MyDP.Value')
     * @param config - Distribution configuration
     * @returns true on success, false on failure
     */
    protected setDistribConfig(dpName: string, config: DpDistribConfig): Promise<boolean>;
    /**
     * Configure address settings for a datapoint
     * Must be implemented by each driver-specific class with driver-specific parameters
     *
     * Note: Each driver implements this with its own signature based on driver requirements.
     * This method should handle validation and call setAddressConfig() and setDistribConfig().
     */
    abstract addAddressConfig(...args: any[]): Promise<boolean>;
    /**
     * Check if a datapoint exists
     * @param dpName - Name of the datapoint
     * @returns true if datapoint exists
     */
    protected checkDpExists(dpName: string): boolean;
    /**
     * Ensure that a connection datapoint exists, create if necessary
     * @param dpName - Name of the datapoint
     * @param dpType - Type of the datapoint (e.g., '_OPCUAServer', '_S7PlusConnection')
     * @returns true if datapoint exists or was created successfully
     */
    protected ensureConnectionDpExists(dpName: string, dpType: string): Promise<boolean>;
    /**
     * Validate IP address or hostname
     * @param ipAddress - IP address or hostname to validate
     * @returns true if valid
     */
    protected validateIpAddress(ipAddress: string): boolean;
    /**
     * Validate port number
     * @param port - Port number to validate
     * @returns true if valid (1-65535)
     */
    protected validatePort(port: number): boolean;
    /**
     * Validate manager/driver number
     * @param num - Manager number to validate
     * @returns true if valid (1-99)
     */
    protected validateManagerNumber(num: number): boolean;
    /**
     * Generate a unique connection name with a given prefix
     * @param prefix - Prefix for the connection name (e.g., '_OpcUAConnection', '_S7Connection')
     * @returns Unique connection name
     */
    protected generateConnectionName(prefix: string): Promise<string>;
}
//# sourceMappingURL=BaseConnection.d.ts.map