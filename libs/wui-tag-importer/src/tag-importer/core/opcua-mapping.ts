// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OPC UA ↔ WinCC OA mapping — the only place that knows OPC UA specifics for the
 * client side of the import (datatype/direction/reference for the peripheral
 * address, and how an OPC UA datatype becomes a WinCC OA element type).
 *
 * Values verified against the WinCC OA OPC UA client driver + the vendored ETM
 * MCP server (`types/winccoa/constants.js`, `helpers/drivers/OpcUaConnection.js`):
 *  - peripheral-address reference: `<Conn>$$1$1$<NodeId>` (empty subscription →
 *    polling, variant 1, mode 1) — ported from `IT_OT_BL.ctl`;
 *  - `_datatype` uses the OPC UA transformation constants 750–768;
 *  - `_direction` uses the DpAddressDirection constants.
 */

import type { OaLeafType, TagAccess } from './model.js';

/** OPC UA transformation/datatype constants (`_address.._datatype`). */
export const OpcUaDatatype = {
  DEFAULT: 750,
  BOOLEAN: 751,
  SBYTE: 752,
  BYTE: 753,
  INT16: 754,
  UINT16: 755,
  INT32: 756,
  UINT32: 757,
  INT64: 758,
  UINT64: 759,
  FLOAT: 760,
  DOUBLE: 761,
  STRING: 762,
  DATETIME: 763,
  GUID: 764,
  BYTESTRING: 765,
  XMLELEMENT: 766,
  NODEID: 767,
  LOCALIZEDTEXT: 768
} as const;

/** Peripheral-address direction constants (`_address.._direction`). */
export const DpAddressDirection = {
  OUTPUT: 1,
  INPUT_SPONT: 2,
  INPUT_SQUERY: 3,
  INPUT_POLL: 4,
  IO_POLL: 7
} as const;

/**
 * OPC UA built-in datatype name → WinCC OA element type of the DPE. Any name
 * absent here is a complex/unsupported type and falls back to `String`
 * (the caller records a warning; see {@link isUnmappedOpcUaType}).
 */
const LEAF_TYPE_MAP: Record<string, OaLeafType> = {
  Boolean: 'Bool',
  SByte: 'Int',
  Byte: 'Int',
  Int16: 'Int',
  UInt16: 'Int',
  Int32: 'Int',
  UInt32: 'UInt',
  Int64: 'Long',
  UInt64: 'ULong',
  Float: 'Float',
  Double: 'Float',
  Number: 'Float',
  DateTime: 'Time',
  UtcTime: 'Time',
  ByteString: 'Blob',
  LocalizedText: 'LangString',
  String: 'String',
  Guid: 'String',
  NodeId: 'String',
  ExpandedNodeId: 'String',
  QualifiedName: 'String',
  XmlElement: 'String'
};

/** OPC UA built-in datatype name → `_datatype` transformation constant. */
const DATATYPE_CODE_MAP: Record<string, number> = {
  Boolean: OpcUaDatatype.BOOLEAN,
  SByte: OpcUaDatatype.SBYTE,
  Byte: OpcUaDatatype.BYTE,
  Int16: OpcUaDatatype.INT16,
  UInt16: OpcUaDatatype.UINT16,
  Int32: OpcUaDatatype.INT32,
  UInt32: OpcUaDatatype.UINT32,
  Int64: OpcUaDatatype.INT64,
  UInt64: OpcUaDatatype.UINT64,
  Float: OpcUaDatatype.FLOAT,
  Double: OpcUaDatatype.DOUBLE,
  Number: OpcUaDatatype.DOUBLE,
  String: OpcUaDatatype.STRING,
  DateTime: OpcUaDatatype.DATETIME,
  UtcTime: OpcUaDatatype.DATETIME,
  Guid: OpcUaDatatype.GUID,
  ByteString: OpcUaDatatype.BYTESTRING,
  XmlElement: OpcUaDatatype.XMLELEMENT,
  NodeId: OpcUaDatatype.NODEID,
  ExpandedNodeId: OpcUaDatatype.NODEID,
  LocalizedText: OpcUaDatatype.LOCALIZEDTEXT
};

/** Map an OPC UA built-in datatype name to the WinCC OA element type of the DPE. */
export function opcUaLeafType(dataType: string | undefined): OaLeafType {
  return LEAF_TYPE_MAP[(dataType ?? '').trim()] ?? 'String';
}

/** True when an OPC UA datatype name is not a mappable scalar (complex/unknown). */
export function isUnmappedOpcUaType(dataType: string | undefined): boolean {
  return !((dataType ?? '').trim() in LEAF_TYPE_MAP);
}

/** Map an OPC UA datatype name to the `_datatype` transformation constant. */
export function opcUaDatatypeCode(dataType: string | undefined): number {
  return DATATYPE_CODE_MAP[(dataType ?? '').trim()] ?? OpcUaDatatype.DEFAULT;
}

/** Peripheral-address direction from a leaf's access mode. */
export function directionFor(access: TagAccess): number {
  switch (access) {
    case 'w': {
      return DpAddressDirection.OUTPUT;
    }
    case 'rw': {
      return DpAddressDirection.IO_POLL;
    }
    default: {
      return DpAddressDirection.INPUT_POLL;
    }
  }
}

/**
 * Peripheral-address `_reference` for an OPC UA item in polling mode:
 * `<Conn>$$1$1$<NodeId>` — empty subscription field (polling), variant 1,
 * transformation mode 1, then the NodeId in item notation. `conn` is the OPC UA
 * server (connection) name WITHOUT the leading underscore of its `_<conn>`
 * `_OPCUAServer` datapoint.
 */
export function buildOpcUaReference(conn: string, nodeId: string): string {
  return `${conn}$$1$1$${nodeId}`;
}

/** Default poll-group DP the backend ensures exists (1000 ms) for imported items. */
export const DEFAULT_POLL_GROUP = 'TagImporter_Poll';
