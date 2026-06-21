/**
 * OPC UA Driver Types
 *
 * Type definitions for OPC UA connections.
 * Note: Browse types are in browse.ts
 */
import type { ConnectionConfig } from './connection.js';
/**
 * OPC UA Security Policy
 */
export declare enum SecurityPolicy {
    None = 0,
    Basic128Rsa15 = 2,
    Basic256 = 3,
    Basic256Sha256 = 4,
    Aes128Sha256RsaOaep = 5,
    Aes256Sha256RsaPss = 6
}
/**
 * OPC UA Message Security Mode
 */
export declare enum MessageSecurityMode {
    None = 0,
    Sign = 1,
    SignAndEncrypt = 2
}
/**
 * OPC UA Connection Configuration
 */
export interface OpcUaConnectionConfig extends ConnectionConfig {
    /** IP address of the OPC UA server */
    ipAddress: string;
    /** Port of the OPC UA server */
    port: number;
    /** Manager number of the OPC UA client (e.g., 4 for _OPCUA4) */
    managerNumber: number;
    /** Reconnect timer in seconds (default: 10) */
    reconnectTimer?: number;
    /** Security policy (default: None) */
    securityPolicy?: SecurityPolicy;
    /** Message security mode (default: None) */
    messageSecurityMode?: MessageSecurityMode;
    /** Username for authentication */
    username?: string;
    /** Password for authentication */
    password?: string;
    /** Client certificate name */
    clientCertificate?: string;
    /** Separator for display names (default: ".") */
    separator?: string;
}
/**
 * Default values for OPC UA connections
 */
export declare const OPCUA_DEFAULTS: {
    readonly reconnectTimer: 10;
    readonly securityPolicy: SecurityPolicy.None;
    readonly messageSecurityMode: MessageSecurityMode.None;
    readonly separator: ".";
    readonly enableConnection: true;
};
//# sourceMappingURL=opcua.d.ts.map