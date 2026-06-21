/**
 * Base Driver Connection Types
 *
 * Generic types shared by all driver connections.
 * Note: DpAddressConfig and DpDistribConfig are defined in winccoa/manager.ts
 */
/**
 * Common connection state values (unified across drivers)
 * Values < 256 = not connected, >= 256 = connected
 */
export var CommonConnectionState;
(function (CommonConnectionState) {
    /** Not initialized */
    CommonConnectionState[CommonConnectionState["NotInitialized"] = -1] = "NotInitialized";
    /** Undefined state */
    CommonConnectionState[CommonConnectionState["Undefined"] = 0] = "Undefined";
    /** Not connected */
    CommonConnectionState[CommonConnectionState["NotConnected"] = 1] = "NotConnected";
    /** Connecting in progress */
    CommonConnectionState[CommonConnectionState["Connecting"] = 2] = "Connecting";
    /** Connection not active */
    CommonConnectionState[CommonConnectionState["NotActive"] = 3] = "NotActive";
    /** Disconnecting in progress */
    CommonConnectionState[CommonConnectionState["Disconnecting"] = 4] = "Disconnecting";
    /** Connection failure */
    CommonConnectionState[CommonConnectionState["Failure"] = 5] = "Failure";
    /** Waiting for reconnect */
    CommonConnectionState[CommonConnectionState["WaitForReconnect"] = 9] = "WaitForReconnect";
    /** Connected (base value) */
    CommonConnectionState[CommonConnectionState["Connected"] = 256] = "Connected";
    /** Connected - First device, first connection active */
    CommonConnectionState[CommonConnectionState["ConnectedFirstFirst"] = 257] = "ConnectedFirstFirst";
    /** Connected - First device, second connection active */
    CommonConnectionState[CommonConnectionState["ConnectedFirstSecond"] = 258] = "ConnectedFirstSecond";
    /** Connected - Second device, first connection active */
    CommonConnectionState[CommonConnectionState["ConnectedSecondFirst"] = 259] = "ConnectedSecondFirst";
    /** Connected - Second device, second connection active */
    CommonConnectionState[CommonConnectionState["ConnectedSecondSecond"] = 260] = "ConnectedSecondSecond";
    /** General query running */
    CommonConnectionState[CommonConnectionState["GeneralQueryRunning"] = 261] = "GeneralQueryRunning";
    /** Info query running */
    CommonConnectionState[CommonConnectionState["InfoQueryRunning"] = 262] = "InfoQueryRunning";
})(CommonConnectionState || (CommonConnectionState = {}));
//# sourceMappingURL=connection.js.map