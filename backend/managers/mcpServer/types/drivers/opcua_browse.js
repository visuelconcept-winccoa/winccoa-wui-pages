/**
 * OPC UA Browse Types
 *
 * Type definitions for browsing OPC UA address space.
 */
/**
 * Event source type for browsing
 */
export var BrowseEventSource;
(function (BrowseEventSource) {
    /** Value nodes (variables with values) */
    BrowseEventSource[BrowseEventSource["Value"] = 0] = "Value";
    /** Event nodes */
    BrowseEventSource[BrowseEventSource["Event"] = 1] = "Event";
    /** Alarm & Condition nodes */
    BrowseEventSource[BrowseEventSource["AlarmCondition"] = 2] = "AlarmCondition";
})(BrowseEventSource || (BrowseEventSource = {}));
//# sourceMappingURL=opcua_browse.js.map