/**
 * WinCC OA Constants
 *
 * Constants for datapoint configs, transformations, and address modes.
 */
/**
 * Datapoint Config Type Constants
 */
export var DpConfigType;
(function (DpConfigType) {
    /** No config */
    DpConfigType[DpConfigType["DPCONFIG_NONE"] = 0] = "DPCONFIG_NONE";
    /** Archive config */
    DpConfigType[DpConfigType["DPCONFIG_DB_ARCHIVEINFO"] = 4] = "DPCONFIG_DB_ARCHIVEINFO";
    /** Min/Max range check config */
    DpConfigType[DpConfigType["DPCONFIG_MINMAX_PVSS_RANGECHECK"] = 7] = "DPCONFIG_MINMAX_PVSS_RANGECHECK";
    /** Set range check config */
    DpConfigType[DpConfigType["DPCONFIG_SET_PVSS_RANGECHECK"] = 8] = "DPCONFIG_SET_PVSS_RANGECHECK";
    /** Binary signal alert */
    DpConfigType[DpConfigType["DPCONFIG_ALERT_BINARYSIGNAL"] = 12] = "DPCONFIG_ALERT_BINARYSIGNAL";
    /** Non-binary signal alert */
    DpConfigType[DpConfigType["DPCONFIG_ALERT_NONBINARYSIGNAL"] = 13] = "DPCONFIG_ALERT_NONBINARYSIGNAL";
    /** Alert class */
    DpConfigType[DpConfigType["DPCONFIG_ALERT_CLASS"] = 14] = "DPCONFIG_ALERT_CLASS";
    /** Peripheral address config */
    DpConfigType[DpConfigType["DPCONFIG_PERIPH_ADDR_MAIN"] = 16] = "DPCONFIG_PERIPH_ADDR_MAIN";
    /** Distribution/manager allocation config */
    DpConfigType[DpConfigType["DPCONFIG_DISTRIBUTION_INFO"] = 56] = "DPCONFIG_DISTRIBUTION_INFO";
    /** Sum alert */
    DpConfigType[DpConfigType["DPCONFIG_SUM_ALERT"] = 59] = "DPCONFIG_SUM_ALERT";
    /** Match range check config */
    DpConfigType[DpConfigType["DPCONFIG_MATCH_PVSS_RANGECHECK"] = 64] = "DPCONFIG_MATCH_PVSS_RANGECHECK";
})(DpConfigType || (DpConfigType = {}));
/**
 * Address Direction Modes
 */
export var DpAddressDirection;
(function (DpAddressDirection) {
    /** Undefined */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_UNDEFINED"] = 0] = "DPATTR_ADDR_MODE_UNDEFINED";
    /** Standard output (group connection) */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_OUTPUT"] = 1] = "DPATTR_ADDR_MODE_OUTPUT";
    /** Input for spontaneous data */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_INPUT_SPONT"] = 2] = "DPATTR_ADDR_MODE_INPUT_SPONT";
    /** Input for single queries */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_INPUT_SQUERY"] = 3] = "DPATTR_ADDR_MODE_INPUT_SQUERY";
    /** Input for polling (cyclic query) */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_INPUT_POLL"] = 4] = "DPATTR_ADDR_MODE_INPUT_POLL";
    /** Output with single connection */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_OUTPUT_SINGLE"] = 5] = "DPATTR_ADDR_MODE_OUTPUT_SINGLE";
    /** Input/output for spontaneous data */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_IO_SPONT"] = 6] = "DPATTR_ADDR_MODE_IO_SPONT";
    /** Input/output for polling */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_IO_POLL"] = 7] = "DPATTR_ADDR_MODE_IO_POLL";
    /** Input/output for single queries */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_IO_SQUERY"] = 8] = "DPATTR_ADDR_MODE_IO_SQUERY";
    /** Hardware alert handling */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_AM_ALERT"] = 9] = "DPATTR_ADDR_MODE_AM_ALERT";
    /** Currently not in use */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_INPUT_ON_DEMAND"] = 10] = "DPATTR_ADDR_MODE_INPUT_ON_DEMAND";
    /** Input, polled only if query exists (dpConnect) */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_INPUT_CYCLIC_ON_USE"] = 11] = "DPATTR_ADDR_MODE_INPUT_CYCLIC_ON_USE";
    /** Currently not in use */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_IO_ON_DEMAND"] = 12] = "DPATTR_ADDR_MODE_IO_ON_DEMAND";
    /** Input/output, polled only if query exists */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_IO_CYCLIC_ON_USE"] = 13] = "DPATTR_ADDR_MODE_IO_CYCLIC_ON_USE";
    /** Input, subscribed only if query exists */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_INPUT_SPONT_ON_USE"] = 14] = "DPATTR_ADDR_MODE_INPUT_SPONT_ON_USE";
    /** Input/output, subscribed only if query exists */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_IO_SPONT_ON_USE"] = 15] = "DPATTR_ADDR_MODE_IO_SPONT_ON_USE";
    /** Obsolete - use _internal attribute instead */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_INTERNAL"] = 32] = "DPATTR_ADDR_MODE_INTERNAL";
    /** Obsolete - use _lowlevel attribute instead */
    DpAddressDirection[DpAddressDirection["DPATTR_ADDR_MODE_LOW_LEVEL_FLAG"] = 64] = "DPATTR_ADDR_MODE_LOW_LEVEL_FLAG";
})(DpAddressDirection || (DpAddressDirection = {}));
/**
 * OPC UA Transformation/Datatype Constants
 */
export var OpcUaDatatype;
(function (OpcUaDatatype) {
    /** Default - automatic type detection */
    OpcUaDatatype[OpcUaDatatype["DEFAULT"] = 750] = "DEFAULT";
    /** Boolean */
    OpcUaDatatype[OpcUaDatatype["BOOLEAN"] = 751] = "BOOLEAN";
    /** Signed Byte */
    OpcUaDatatype[OpcUaDatatype["SBYTE"] = 752] = "SBYTE";
    /** Byte */
    OpcUaDatatype[OpcUaDatatype["BYTE"] = 753] = "BYTE";
    /** 16-bit Integer signed */
    OpcUaDatatype[OpcUaDatatype["INT16"] = 754] = "INT16";
    /** 16-bit Integer unsigned */
    OpcUaDatatype[OpcUaDatatype["UINT16"] = 755] = "UINT16";
    /** 32-bit Integer signed */
    OpcUaDatatype[OpcUaDatatype["INT32"] = 756] = "INT32";
    /** 32-bit Integer unsigned */
    OpcUaDatatype[OpcUaDatatype["UINT32"] = 757] = "UINT32";
    /** 64-bit Integer signed */
    OpcUaDatatype[OpcUaDatatype["INT64"] = 758] = "INT64";
    /** 64-bit Integer unsigned */
    OpcUaDatatype[OpcUaDatatype["UINT64"] = 759] = "UINT64";
    /** Floating-point value */
    OpcUaDatatype[OpcUaDatatype["FLOAT"] = 760] = "FLOAT";
    /** Floating-point value, double precision */
    OpcUaDatatype[OpcUaDatatype["DOUBLE"] = 761] = "DOUBLE";
    /** String */
    OpcUaDatatype[OpcUaDatatype["STRING"] = 762] = "STRING";
    /** Date & Time */
    OpcUaDatatype[OpcUaDatatype["DATETIME"] = 763] = "DATETIME";
    /** Unique Identifier */
    OpcUaDatatype[OpcUaDatatype["GUID"] = 764] = "GUID";
    /** Byte String */
    OpcUaDatatype[OpcUaDatatype["BYTESTRING"] = 765] = "BYTESTRING";
    /** XML Element */
    OpcUaDatatype[OpcUaDatatype["XMLELEMENT"] = 766] = "XMLELEMENT";
    /** Node ID */
    OpcUaDatatype[OpcUaDatatype["NODEID"] = 767] = "NODEID";
    /** Localized Text */
    OpcUaDatatype[OpcUaDatatype["LOCALIZEDTEXT"] = 768] = "LOCALIZEDTEXT";
})(OpcUaDatatype || (OpcUaDatatype = {}));
/**
 * Datapoint Element Types (from WinCC OA Documentation)
 * See: https://winccoa.cope-it.at - "Data types for DPEs"
 */
export var DpeType;
(function (DpeType) {
    /** Structure */
    DpeType[DpeType["DPEL_STRUCT"] = 1] = "DPEL_STRUCT";
    /** Dynamic character array */
    DpeType[DpeType["DPEL_DYN_CHAR"] = 3] = "DPEL_DYN_CHAR";
    /** Dynamic unsigned array */
    DpeType[DpeType["DPEL_DYN_UINT"] = 4] = "DPEL_DYN_UINT";
    /** Dynamic integer array */
    DpeType[DpeType["DPEL_DYN_INT"] = 5] = "DPEL_DYN_INT";
    /** Dynamic float array */
    DpeType[DpeType["DPEL_DYN_FLOAT"] = 6] = "DPEL_DYN_FLOAT";
    /** Dynamic bit array */
    DpeType[DpeType["DPEL_DYN_BOOL"] = 7] = "DPEL_DYN_BOOL";
    /** Dynamic bit pattern array */
    DpeType[DpeType["DPEL_DYN_BIT32"] = 8] = "DPEL_DYN_BIT32";
    /** Dynamic text array */
    DpeType[DpeType["DPEL_DYN_STRING"] = 9] = "DPEL_DYN_STRING";
    /** Dynamic time array */
    DpeType[DpeType["DPEL_DYN_TIME"] = 10] = "DPEL_DYN_TIME";
    /** Character structure */
    DpeType[DpeType["DPEL_CHAR_STRUCT"] = 11] = "DPEL_CHAR_STRUCT";
    /** Unsigned integer structure */
    DpeType[DpeType["DPEL_UINT_STRUCT"] = 12] = "DPEL_UINT_STRUCT";
    /** Integer structure */
    DpeType[DpeType["DPEL_INT_STRUCT"] = 13] = "DPEL_INT_STRUCT";
    /** Float structure */
    DpeType[DpeType["DPEL_FLOAT_STRUCT"] = 14] = "DPEL_FLOAT_STRUCT";
    /** Bit structure */
    DpeType[DpeType["DPEL_BOOL_STRUCT"] = 15] = "DPEL_BOOL_STRUCT";
    /** Bit pattern structure */
    DpeType[DpeType["DPEL_BIT32_STRUCT"] = 16] = "DPEL_BIT32_STRUCT";
    /** Text structure */
    DpeType[DpeType["DPEL_STRING_STRUCT"] = 17] = "DPEL_STRING_STRUCT";
    /** Time structure */
    DpeType[DpeType["DPEL_TIME_STRUCT"] = 18] = "DPEL_TIME_STRUCT";
    /** Character */
    DpeType[DpeType["DPEL_CHAR"] = 19] = "DPEL_CHAR";
    /** Unsigned integer */
    DpeType[DpeType["DPEL_UINT"] = 20] = "DPEL_UINT";
    /** Integer */
    DpeType[DpeType["DPEL_INT"] = 21] = "DPEL_INT";
    /** Floating point */
    DpeType[DpeType["DPEL_FLOAT"] = 22] = "DPEL_FLOAT";
    /** Boolean/Bit */
    DpeType[DpeType["DPEL_BOOL"] = 23] = "DPEL_BOOL";
    /** Bit pattern */
    DpeType[DpeType["DPEL_BIT32"] = 24] = "DPEL_BIT32";
    /** Text/String */
    DpeType[DpeType["DPEL_STRING"] = 25] = "DPEL_STRING";
    /** Time */
    DpeType[DpeType["DPEL_TIME"] = 26] = "DPEL_TIME";
    /** DP Identifier */
    DpeType[DpeType["DPEL_DPID"] = 27] = "DPEL_DPID";
    /** Dynamic DP Identifier */
    DpeType[DpeType["DPEL_DYN_DPID"] = 29] = "DPEL_DYN_DPID";
    /** Type reference */
    DpeType[DpeType["DPEL_TYPEREF"] = 41] = "DPEL_TYPEREF";
    /** Multilingual text */
    DpeType[DpeType["DPEL_LANGSTRING"] = 42] = "DPEL_LANGSTRING";
    /** Multilingual text structure */
    DpeType[DpeType["DPEL_LANGSTRING_STRUCT"] = 43] = "DPEL_LANGSTRING_STRUCT";
    /** Dynamic description array */
    DpeType[DpeType["DPEL_DYN_LANGSTRING"] = 44] = "DPEL_DYN_LANGSTRING";
    /** Blob (binary large object) */
    DpeType[DpeType["DPEL_BLOB"] = 46] = "DPEL_BLOB";
    /** Blob structure */
    DpeType[DpeType["DPEL_BLOB_STRUCT"] = 47] = "DPEL_BLOB_STRUCT";
    /** Bit pattern 64 */
    DpeType[DpeType["DPEL_BIT64"] = 50] = "DPEL_BIT64";
    /** Dynamic bit64 array */
    DpeType[DpeType["DPEL_DYN_BIT64"] = 51] = "DPEL_DYN_BIT64";
    /** Bit64 structure */
    DpeType[DpeType["DPEL_BIT64_STRUCT"] = 52] = "DPEL_BIT64_STRUCT";
    /** Long integer (64 bit) */
    DpeType[DpeType["DPEL_LONG"] = 54] = "DPEL_LONG";
    /** Dynamic long array */
    DpeType[DpeType["DPEL_DYN_LONG"] = 55] = "DPEL_DYN_LONG";
    /** Long structure */
    DpeType[DpeType["DPEL_LONG_STRUCT"] = 56] = "DPEL_LONG_STRUCT";
    /** Unsigned long (64 bit) */
    DpeType[DpeType["DPEL_ULONG"] = 58] = "DPEL_ULONG";
    /** Dynamic unsigned long array */
    DpeType[DpeType["DPEL_DYN_ULONG"] = 59] = "DPEL_DYN_ULONG";
    /** Unsigned long structure */
    DpeType[DpeType["DPEL_ULONG_STRUCT"] = 60] = "DPEL_ULONG_STRUCT";
})(DpeType || (DpeType = {}));
/**
 * Alert Acknowledge Types
 */
export var DpAlertAckType;
(function (DpAlertAckType) {
    /** Single acknowledge */
    DpAlertAckType[DpAlertAckType["DPATTR_ACKTYPE_SINGLE"] = 1] = "DPATTR_ACKTYPE_SINGLE";
})(DpAlertAckType || (DpAlertAckType = {}));
/**
 * Alert Range Types
 */
export var DpAlertRangeType;
(function (DpAlertRangeType) {
    /** No range type */
    DpAlertRangeType[DpAlertRangeType["DPDETAIL_RANGETYPE_NONE"] = 0] = "DPDETAIL_RANGETYPE_NONE";
    /** Min/Max range */
    DpAlertRangeType[DpAlertRangeType["DPDETAIL_RANGETYPE_MINMAX"] = 4] = "DPDETAIL_RANGETYPE_MINMAX";
    /** Match range (for discrete alerts) */
    DpAlertRangeType[DpAlertRangeType["DPDETAIL_RANGETYPE_MATCH"] = 5] = "DPDETAIL_RANGETYPE_MATCH";
})(DpAlertRangeType || (DpAlertRangeType = {}));
/**
 * Archive Process Types
 */
export var DpArchiveProcessType;
(function (DpArchiveProcessType) {
    /** No archiving */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_NONE"] = 0] = "DPATTR_ARCH_PROC_NONE";
    /** Delete old values */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_DEL"] = 1] = "DPATTR_ARCH_PROC_DEL";
    /** Move to another archive */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_MOVE"] = 2] = "DPATTR_ARCH_PROC_MOVE";
    /** Simple smoothing */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_SIMPLESM"] = 3] = "DPATTR_ARCH_PROC_SIMPLESM";
    /** Simple smoothing and move */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_SIMPLESM_AND_MOVE"] = 4] = "DPATTR_ARCH_PROC_SIMPLESM_AND_MOVE";
    /** Derivative smoothing */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_DERIVSM"] = 5] = "DPATTR_ARCH_PROC_DERIVSM";
    /** Derivative smoothing and move */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_DERIVSM_AND_MOVE"] = 6] = "DPATTR_ARCH_PROC_DERIVSM_AND_MOVE";
    /** Decimation */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_DEC"] = 7] = "DPATTR_ARCH_PROC_DEC";
    /** Decimation and move */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_DEC_AND_MOVE"] = 8] = "DPATTR_ARCH_PROC_DEC_AND_MOVE";
    /** Average value */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_AVG_VAL"] = 9] = "DPATTR_ARCH_PROC_AVG_VAL";
    /** Average value and move */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_AVG_VAL_AND_MOVE"] = 10] = "DPATTR_ARCH_PROC_AVG_VAL_AND_MOVE";
    /** Average at time T0 */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_AVG_T0"] = 11] = "DPATTR_ARCH_PROC_AVG_T0";
    /** Average at time T0 and move */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_AVG_T0_AND_MOVE"] = 12] = "DPATTR_ARCH_PROC_AVG_T0_AND_MOVE";
    /** Average at time T1 */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_AVG_T1"] = 13] = "DPATTR_ARCH_PROC_AVG_T1";
    /** Average at time T1 and move */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_AVG_T1_AND_MOVE"] = 14] = "DPATTR_ARCH_PROC_AVG_T1_AND_MOVE";
    /** Value archiving (standard archiving) */
    DpArchiveProcessType[DpArchiveProcessType["DPATTR_ARCH_PROC_VALARCH"] = 15] = "DPATTR_ARCH_PROC_VALARCH";
})(DpArchiveProcessType || (DpArchiveProcessType = {}));
//# sourceMappingURL=constants.js.map