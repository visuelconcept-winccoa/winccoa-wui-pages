/**
 * MQTT Driver Types
 *
 * Type definitions for MQTT connections.
 * Based on WinCC OA _MqttConnection internal datapoint structure.
 */
// ============================================================================
// MQTT Enums
// ============================================================================
/**
 * MQTT Connection Type
 * Defines the security/transport type for MQTT connections
 */
export var MqttConnectionType;
(function (MqttConnectionType) {
    /** Unsecure TCP connection (default port 1883) */
    MqttConnectionType[MqttConnectionType["Unsecure"] = 1] = "Unsecure";
    /** TLS encrypted connection (default port 8883) */
    MqttConnectionType[MqttConnectionType["TLS"] = 2] = "TLS";
    /** WebSocket connection */
    MqttConnectionType[MqttConnectionType["WebSocket"] = 3] = "WebSocket";
    /** TLS with Pre-Shared Key */
    MqttConnectionType[MqttConnectionType["TLS_PSK"] = 4] = "TLS_PSK";
})(MqttConnectionType || (MqttConnectionType = {}));
/**
 * MQTT Protocol Version
 */
export var MqttProtocolVersion;
(function (MqttProtocolVersion) {
    /** Default (driver decides) */
    MqttProtocolVersion[MqttProtocolVersion["Default"] = 0] = "Default";
    /** MQTT v3.1 */
    MqttProtocolVersion[MqttProtocolVersion["V3_1"] = 3] = "V3_1";
    /** MQTT v3.1.1 */
    MqttProtocolVersion[MqttProtocolVersion["V3_1_1"] = 4] = "V3_1_1";
    /** MQTT v5.0 */
    MqttProtocolVersion[MqttProtocolVersion["V5_0"] = 5] = "V5_0";
})(MqttProtocolVersion || (MqttProtocolVersion = {}));
/**
 * MQTT SSL/TLS Version
 */
export var MqttSslVersion;
(function (MqttSslVersion) {
    /** Default */
    MqttSslVersion[MqttSslVersion["Default"] = 0] = "Default";
    /** TLS v1.0 */
    MqttSslVersion[MqttSslVersion["TLS_1_0"] = 2] = "TLS_1_0";
    /** TLS v1.1 */
    MqttSslVersion[MqttSslVersion["TLS_1_1"] = 3] = "TLS_1_1";
    /** TLS v1.2 */
    MqttSslVersion[MqttSslVersion["TLS_1_2"] = 4] = "TLS_1_2";
    /** Any version */
    MqttSslVersion[MqttSslVersion["Any"] = 5] = "Any";
    /** TLS v1.0 or later */
    MqttSslVersion[MqttSslVersion["TLS_1_0_OrLater"] = 8] = "TLS_1_0_OrLater";
    /** TLS v1.1 or later */
    MqttSslVersion[MqttSslVersion["TLS_1_1_OrLater"] = 9] = "TLS_1_1_OrLater";
    /** TLS v1.2 or later */
    MqttSslVersion[MqttSslVersion["TLS_1_2_OrLater"] = 10] = "TLS_1_2_OrLater";
    /** TLS v1.3 */
    MqttSslVersion[MqttSslVersion["TLS_1_3"] = 15] = "TLS_1_3";
    /** TLS v1.3 or later */
    MqttSslVersion[MqttSslVersion["TLS_1_3_OrLater"] = 16] = "TLS_1_3_OrLater";
})(MqttSslVersion || (MqttSslVersion = {}));
/**
 * MQTT Connection State
 * Used in State.ConnState datapoint element
 */
export var MqttConnectionState;
(function (MqttConnectionState) {
    /** Connection is inactive */
    MqttConnectionState[MqttConnectionState["Inactive"] = 0] = "Inactive";
    /** Disconnected from broker */
    MqttConnectionState[MqttConnectionState["Disconnected"] = 1] = "Disconnected";
    /** Connecting to broker */
    MqttConnectionState[MqttConnectionState["Connecting"] = 2] = "Connecting";
    /** Connected to broker */
    MqttConnectionState[MqttConnectionState["Connected"] = 3] = "Connected";
    /** Disconnecting from broker */
    MqttConnectionState[MqttConnectionState["Disconnecting"] = 4] = "Disconnecting";
    /** Connection failure */
    MqttConnectionState[MqttConnectionState["Failure"] = 5] = "Failure";
    /** Listening (server mode) */
    MqttConnectionState[MqttConnectionState["Listening"] = 6] = "Listening";
})(MqttConnectionState || (MqttConnectionState = {}));
/**
 * MQTT Quality of Service levels
 */
export var MqttQoS;
(function (MqttQoS) {
    /** At most once (fire and forget) */
    MqttQoS[MqttQoS["AtMostOnce"] = 0] = "AtMostOnce";
    /** At least once (acknowledged delivery) */
    MqttQoS[MqttQoS["AtLeastOnce"] = 1] = "AtLeastOnce";
    /** Exactly once (assured delivery) */
    MqttQoS[MqttQoS["ExactlyOnce"] = 2] = "ExactlyOnce";
})(MqttQoS || (MqttQoS = {}));
/**
 * MQTT Address Direction (for peripheral addresses)
 */
export var MqttAddressDirection;
(function (MqttAddressDirection) {
    /** Publish (output) - WinCC OA sends to broker */
    MqttAddressDirection[MqttAddressDirection["Publish"] = 1] = "Publish";
    /** Subscribe (input) - WinCC OA receives from broker */
    MqttAddressDirection[MqttAddressDirection["Subscribe"] = 2] = "Subscribe";
    /** Both (in/out) - bidirectional */
    MqttAddressDirection[MqttAddressDirection["Both"] = 6] = "Both";
})(MqttAddressDirection || (MqttAddressDirection = {}));
/**
 * MQTT Transformation Type (for peripheral addresses)
 */
export var MqttTransformation;
(function (MqttTransformation) {
    /** Plain string (no transformation) */
    MqttTransformation[MqttTransformation["PlainString"] = 1001] = "PlainString";
    /** JSON Profile: Value only */
    MqttTransformation[MqttTransformation["JsonValue"] = 1002] = "JsonValue";
    /** JSON Profile: Value + Timestamp */
    MqttTransformation[MqttTransformation["JsonValueTimestamp"] = 1003] = "JsonValueTimestamp";
    /** JSON Profile: Value + Timestamp + Status */
    MqttTransformation[MqttTransformation["JsonValueTimestampStatus"] = 1004] = "JsonValueTimestampStatus";
})(MqttTransformation || (MqttTransformation = {}));
/**
 * Default values for MQTT connections
 */
export const MQTT_DEFAULTS = {
    connectionType: MqttConnectionType.Unsecure,
    keepAliveInterval: 20,
    reconnectInterval: 20,
    useUtc: true,
    timezoneOffset: 0,
    setInvalidBit: false,
    enableStatistics: true,
    persistentSession: true,
    enableConnection: true,
    protocolVersion: MqttProtocolVersion.Default,
    sslVersion: MqttSslVersion.Default,
    lastWillQoS: MqttQoS.AtMostOnce,
    lastWillRetain: false
};
//# sourceMappingURL=mqtt.js.map