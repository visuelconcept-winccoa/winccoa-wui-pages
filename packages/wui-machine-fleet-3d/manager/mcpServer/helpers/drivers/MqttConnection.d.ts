/**
 * MQTT Connection Manager
 *
 * Provides functionality to create, configure, and manage MQTT connections in WinCC OA.
 * Based on WinCC OA _MqttConnection internal datapoint structure.
 */
import { BaseConnection } from './BaseConnection.js';
import type { MqttConnectionConfig, MqttAddressParams } from '../../types/index.js';
import { MqttConnectionState } from '../../types/index.js';
export { MqttConnectionType, MqttConnectionState, MqttProtocolVersion, MqttSslVersion, MqttQoS, MqttAddressDirection, MqttTransformation, MQTT_DEFAULTS } from '../../types/index.js';
/**
 * MQTT Connection Manager Class
 *
 * Extends BaseConnection with MQTT-specific functionality.
 */
export declare class MqttConnection extends BaseConnection {
    /**
     * Generate a unique connection name for MQTT
     * @returns Connection name in format _MqttConnection<n>
     */
    generateConnectionName(): Promise<string>;
    /**
     * Get available MQTT driver numbers from Pmon
     * Similar to CTRL paMqttCheckDrvNums()
     * @returns Array of MQTT driver numbers, sorted ascending
     */
    getMqttDriverNumbers(): Promise<number[]>;
    /**
     * Get all used driver numbers (MQTT, simulation, other drivers)
     * @returns Array of used driver numbers
     */
    getUsedDriverNumbers(): Promise<number[]>;
    /**
     * Get the lowest available MQTT driver number (avoiding sim driver conflicts)
     * @returns Lowest available driver number for MQTT
     */
    getDefaultMqttDriverNumber(): Promise<number>;
    /**
     * Ensure MQTT driver with specified number is running
     * Creates and starts the driver if it doesn't exist
     * @param managerNumber - The driver number to ensure
     * @returns Object with success status and optional warnings
     */
    ensureMqttDriverRunning(managerNumber: number): Promise<{
        success: boolean;
        error?: string;
        warnings?: string[];
    }>;
    /**
     * Build the JSON address string for Config.Address
     * This is the format stored in _MqttConnection.Config.Address
     * Required keys: Username, ConnectionType, ConnectionString, Certificate, Password, Identity, PSK
     */
    private buildAddressJson;
    /**
     * Add a new MQTT connection
     *
     * @param config - MQTT connection configuration
     * @returns Object with success status, connection name, and any errors
     */
    addConnection(config: MqttConnectionConfig): Promise<{
        success: boolean;
        connectionName?: string;
        error?: string;
    }>;
    /**
     * Delete an MQTT connection
     *
     * @param connectionName - Name of the connection to delete (with or without leading _)
     * @returns Object with success status and any errors
     */
    deleteConnection(connectionName: string): Promise<{
        success: boolean;
        error?: string;
    }>;
    /**
     * Get the connection state of an MQTT connection
     *
     * @param connectionName - Name of the connection
     * @returns Connection state or error
     */
    getConnectionState(connectionName: string): Promise<{
        success: boolean;
        state?: MqttConnectionState;
        stateText?: string;
        error?: string;
    }>;
    /**
     * List all MQTT connections
     *
     * @returns Array of connection names and their states
     */
    listConnections(): Promise<{
        success: boolean;
        connections?: Array<{
            name: string;
            state: MqttConnectionState;
            stateText: string;
            connectionString?: string;
        }>;
        error?: string;
    }>;
    /**
     * Configure address settings for a datapoint (peripheral address)
     * Implementation of abstract method from BaseConnection
     *
     * @param params - MQTT address parameters
     * @returns true on success
     * @throws Error with detailed message on failure
     */
    addAddressConfig(params: MqttAddressParams): Promise<boolean>;
}
//# sourceMappingURL=MqttConnection.d.ts.map