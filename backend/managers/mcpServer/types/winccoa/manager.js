/**
 * WinCC OA Manager Types
 *
 * Type definitions for the WinccoaManager class from winccoa-manager package.
 * These types extend or re-export types from the package.
 */
/**
 * Datapoint element type enum (subset of WinCC OA types)
 */
export var DpElementType;
(function (DpElementType) {
    /** Invalid type */
    DpElementType[DpElementType["Invalid"] = 0] = "Invalid";
    /** Boolean */
    DpElementType[DpElementType["Bool"] = 1] = "Bool";
    /** Character */
    DpElementType[DpElementType["Char"] = 2] = "Char";
    /** Integer */
    DpElementType[DpElementType["Int"] = 3] = "Int";
    /** Unsigned integer */
    DpElementType[DpElementType["UInt"] = 4] = "UInt";
    /** Float */
    DpElementType[DpElementType["Float"] = 5] = "Float";
    /** Bit (32-bit bitfield) */
    DpElementType[DpElementType["Bit"] = 6] = "Bit";
    /** Text/String */
    DpElementType[DpElementType["Text"] = 7] = "Text";
    /** Time value */
    DpElementType[DpElementType["Time"] = 8] = "Time";
    /** Blob (binary large object) */
    DpElementType[DpElementType["Blob"] = 9] = "Blob";
    /** Unsigned char */
    DpElementType[DpElementType["UChar"] = 10] = "UChar";
    /** Long integer */
    DpElementType[DpElementType["Long"] = 11] = "Long";
    /** Unsigned long */
    DpElementType[DpElementType["ULong"] = 12] = "ULong";
    /** 64-bit integer */
    DpElementType[DpElementType["Int64"] = 13] = "Int64";
    /** Unsigned 64-bit integer */
    DpElementType[DpElementType["UInt64"] = 14] = "UInt64";
    /** Dynamic array */
    DpElementType[DpElementType["DynAny"] = 15] = "DynAny";
})(DpElementType || (DpElementType = {}));
//# sourceMappingURL=manager.js.map