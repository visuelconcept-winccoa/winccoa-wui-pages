/**
 * OPC UA Driver Types
 *
 * Type definitions for OPC UA connections.
 * Note: Browse types are in browse.ts
 */
// ============================================================================
// OPC UA Connection Types
// ============================================================================
/**
 * OPC UA Security Policy
 */
export var SecurityPolicy;
(function (SecurityPolicy) {
    SecurityPolicy[SecurityPolicy["None"] = 0] = "None";
    SecurityPolicy[SecurityPolicy["Basic128Rsa15"] = 2] = "Basic128Rsa15";
    SecurityPolicy[SecurityPolicy["Basic256"] = 3] = "Basic256";
    SecurityPolicy[SecurityPolicy["Basic256Sha256"] = 4] = "Basic256Sha256";
    SecurityPolicy[SecurityPolicy["Aes128Sha256RsaOaep"] = 5] = "Aes128Sha256RsaOaep";
    SecurityPolicy[SecurityPolicy["Aes256Sha256RsaPss"] = 6] = "Aes256Sha256RsaPss";
})(SecurityPolicy || (SecurityPolicy = {}));
/**
 * OPC UA Message Security Mode
 */
export var MessageSecurityMode;
(function (MessageSecurityMode) {
    MessageSecurityMode[MessageSecurityMode["None"] = 0] = "None";
    MessageSecurityMode[MessageSecurityMode["Sign"] = 1] = "Sign";
    MessageSecurityMode[MessageSecurityMode["SignAndEncrypt"] = 2] = "SignAndEncrypt";
})(MessageSecurityMode || (MessageSecurityMode = {}));
/**
 * Default values for OPC UA connections
 */
export const OPCUA_DEFAULTS = {
    reconnectTimer: 10,
    securityPolicy: SecurityPolicy.None,
    messageSecurityMode: MessageSecurityMode.None,
    separator: '.',
    enableConnection: true
};
//# sourceMappingURL=opcua.js.map