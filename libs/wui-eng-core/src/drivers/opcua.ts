// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * OPC UA address building — ported unchanged from the PROVEN tag-importer
 * mapping (`libs/wui-tag-importer/src/tag-importer/core/opcua-mapping.ts`,
 * itself verified against the WinCC OA OPC UA client driver and the vendored
 * ETM MCP server). Kept as the studio's reference driver implementation.
 *
 *  - peripheral-address reference: `<Conn>$$1$1$<NodeId>` (empty subscription
 *    → polling, variant 1, transformation mode 1);
 *  - `_address.._datatype` uses the OPC UA transformation constants 750–768;
 *  - `_address.._direction` uses the DpAddressDirection constants.
 */

import type { OaLeafType, TagAccess } from '../model.js';

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

/** OPC UA built-in datatype name → WinCC OA element type of the DPE. */
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

/** Map an OPC UA built-in datatype name to the WinCC OA element type. */
export function opcUaLeafType(dataType: string | undefined): OaLeafType {
  return LEAF_TYPE_MAP[(dataType ?? '').trim()] ?? 'String';
}

/** True when an OPC UA datatype name is not a mappable scalar. */
export function isUnmappedOpcUaType(dataType: string | undefined): boolean {
  return !((dataType ?? '').trim() in LEAF_TYPE_MAP);
}

/** Map an OPC UA datatype name to the `_datatype` transformation constant. */
export function opcUaDatatypeCode(dataType: string | undefined): number {
  return DATATYPE_CODE_MAP[(dataType ?? '').trim()] ?? OpcUaDatatype.DEFAULT;
}

/**
 * OPC UA `AccessLevel` bit masks (Part 3 §5.6.2). Only the two CURRENT bits are
 * meaningful for a peripheral address; the history bits do not affect a binding.
 */
export const OpcUaAccessLevel = {
  CURRENT_READ: 1,
  CURRENT_WRITE: 2
} as const;

/**
 * Decode an OPC UA `AccessLevel` bitmask into the book's access mode.
 * Shared by the NodeSet reader (the attribute is in the file) and the online
 * browse (when the driver exposes it) so both agree.
 */
export function opcUaAccessFromLevel(level: number): TagAccess {
  /* eslint-disable no-bitwise */
  const read = (level & OpcUaAccessLevel.CURRENT_READ) !== 0;
  const write = (level & OpcUaAccessLevel.CURRENT_WRITE) !== 0;
  /* eslint-enable no-bitwise */
  if (read && write) return 'rw';
  if (write) return 'w';
  return 'r';
}

/** Peripheral-address direction from a tag's access mode. */
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
 * `<Conn>$$1$1$<NodeId>`. `conn` is the OPC UA server (connection) name
 * WITHOUT the leading underscore of its `_<conn>` `_OPCUAServer` datapoint.
 */
export function buildOpcUaReference(conn: string, nodeId: string): string {
  return `${conn}$$1$1$${nodeId}`;
}

/** `_address.._drv_ident` for the OPC UA client driver. */
export const OPCUA_DRV_IDENT = 'OPCUA';
