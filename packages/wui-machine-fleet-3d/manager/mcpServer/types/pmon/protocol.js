/**
 * Pmon Protocol Type Definitions
 *
 * Type definitions for WinCC OA Process Monitor (Pmon) TCP protocol communication.
 */
/**
 * Manager state enum
 * Based on Pmon protocol specification
 */
export var ManagerState;
(function (ManagerState) {
    /** Manager is stopped */
    ManagerState[ManagerState["Stopped"] = 0] = "Stopped";
    /** Manager is initializing */
    ManagerState[ManagerState["Init"] = 1] = "Init";
    /** Manager is running */
    ManagerState[ManagerState["Running"] = 2] = "Running";
    /** Manager is blocked (no alive sign) */
    ManagerState[ManagerState["Blocked"] = 3] = "Blocked";
})(ManagerState || (ManagerState = {}));
/**
 * Manager start mode enum
 */
export var ManagerStartMode;
(function (ManagerStartMode) {
    /** Manager must be started manually */
    ManagerStartMode[ManagerStartMode["Manual"] = 0] = "Manual";
    /** Manager starts only once when project starts */
    ManagerStartMode[ManagerStartMode["Once"] = 1] = "Once";
    /** Manager starts automatically and restarts on crash */
    ManagerStartMode[ManagerStartMode["Always"] = 2] = "Always";
})(ManagerStartMode || (ManagerStartMode = {}));
/**
 * Pmon operation mode
 */
export var PmonMode;
(function (PmonMode) {
    /** Pmon is starting managers */
    PmonMode[PmonMode["StartMode"] = 0] = "StartMode";
    /** Pmon is monitoring managers */
    PmonMode[PmonMode["MonitorMode"] = 1] = "MonitorMode";
    /** Pmon is waiting for commands */
    PmonMode[PmonMode["WaitMode"] = 2] = "WaitMode";
    /** Pmon is restarting managers */
    PmonMode[PmonMode["RestartMode"] = 3] = "RestartMode";
    /** Pmon is shutting down */
    PmonMode[PmonMode["ShutdownMode"] = 4] = "ShutdownMode";
})(PmonMode || (PmonMode = {}));
//# sourceMappingURL=protocol.js.map