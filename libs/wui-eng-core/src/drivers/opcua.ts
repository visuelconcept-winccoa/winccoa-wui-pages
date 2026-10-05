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

/**
 * Peripheral-address direction constants (`_address.._direction`), complete per the
 * WinCC OA `_address` appendix — see
 * `docs/wui-eng-studio/VENDOR-ADDRESS-TRANSFORMATIONS.md`. Driver-independent
 * despite living here (this module is the verified reference the rest imports).
 *
 * `INTERNAL` (32) and `LOW_LEVEL_FLAG` (64) of the legacy `_mode` bit field are
 * deliberately absent: they are now the separate `_internal` / `_lowlevel`
 * attributes, which is what `configs/builders.ts` writes.
 */
export const DpAddressDirection = {
  UNDEFINED: 0,
  OUTPUT: 1,
  INPUT_SPONT: 2,
  INPUT_SQUERY: 3,
  INPUT_POLL: 4,
  /** Output with a SINGLE connection per subindex (OUTPUT groups them). */
  OUTPUT_SINGLE: 5,
  IO_SPONT: 6,
  IO_POLL: 7,
  IO_SQUERY: 8,
  /** Hardware alert handling — external alerts are triggered through it. */
  AM_ALERT: 9,
  /** Polled only while a dpConnect/dpQueryConnect exists on the element. */
  INPUT_CYCLIC_ON_USE: 11,
  IO_CYCLIC_ON_USE: 13,
  /** Subscribed only while a dpConnect/dpQueryConnect exists on the element. */
  INPUT_SPONT_ON_USE: 14,
  IO_SPONT_ON_USE: 15
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
 * OPC UA `AccessLevel` bit masks (Part 3 §5.6.2). The two CURRENT bits decide a
 * peripheral address; the HISTORY_READ bit decides nothing about the binding but
 * says the server ARCHIVES the signal — which is exactly what an engineer needs
 * to know before deciding whether WinCC OA should archive it too, so the book
 * carries it (see `BookEntry.historized`).
 */
export const OpcUaAccessLevel = {
  CURRENT_READ: 1,
  CURRENT_WRITE: 2,
  HISTORY_READ: 4,
  HISTORY_WRITE: 8
} as const;

/**
 * Whether an `AccessLevel` says the server keeps HISTORY for the signal
 * (`HistoryRead`, or `HistoryWrite` for the rarer writable-history case).
 *
 * Deliberately separate from {@link opcUaAccessFromLevel}: the access mode drives
 * the address direction, history drives an archiving DECISION, and folding the
 * two into one value is how a read-only signal ends up looking archivable.
 */
export function opcUaHistorizedFromLevel(level: number): boolean {
  /* eslint-disable no-bitwise */
  return (level & (OpcUaAccessLevel.HISTORY_READ | OpcUaAccessLevel.HISTORY_WRITE)) !== 0;
  /* eslint-enable no-bitwise */
}

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
/** How a signal is acquired: sampled on a rhythm, or pushed by the server on change. */
export type AcquisitionMode = 'poll' | 'spont';

/**
 * `_address.._direction` for an access mode and an ACQUISITION mode.
 *
 * A write is a write whatever the acquisition (`OUTPUT`); a read is polled (4) or subscribed
 * (2); a read/write is the same choice one level up (7 / 6). The acquisition used to be implied
 * by the access — every address was polled — which is precisely why the choice could not be
 * expressed.
 */
export function directionFor(access: TagAccess, mode: AcquisitionMode = 'poll'): number {
  switch (access) {
    case 'w': {
      return DpAddressDirection.OUTPUT;
    }
    case 'rw': {
      return mode === 'spont' ? DpAddressDirection.IO_SPONT : DpAddressDirection.IO_POLL;
    }
    default: {
      return mode === 'spont' ? DpAddressDirection.INPUT_SPONT : DpAddressDirection.INPUT_POLL;
    }
  }
}

/**
 * Does this direction READ? — the question the "Historical" checkbox answers to.
 *
 * The catalog's access is what decides it: `R` becomes an input (IN, 2/4) and `rw` an
 * input/output (IN/OUT, 6/7) — both acquire a value, so both can be part of a historical
 * query. A pure `OUTPUT` acquires nothing: asking the server for the history of an address
 * that only writes configures a read that will never happen.
 */
export function isReadingDirection(direction: number): boolean {
  return (
    direction === DpAddressDirection.INPUT_SPONT ||
    direction === DpAddressDirection.INPUT_SQUERY ||
    direction === DpAddressDirection.INPUT_POLL ||
    direction === DpAddressDirection.IO_SPONT ||
    direction === DpAddressDirection.IO_POLL ||
    direction === DpAddressDirection.IO_SQUERY ||
    direction === DpAddressDirection.INPUT_CYCLIC_ON_USE ||
    direction === DpAddressDirection.IO_CYCLIC_ON_USE ||
    direction === DpAddressDirection.INPUT_SPONT_ON_USE ||
    direction === DpAddressDirection.IO_SPONT_ON_USE
  );
}

/**
 * Is this direction POLLED? — the question `_address.._poll_group` answers to.
 *
 * A poll group on a subscribed or written address configures nothing; writing one there is a
 * value nobody asked for on an attribute that has no meaning in that mode.
 */
export function isPolledDirection(direction: number): boolean {
  return (
    direction === DpAddressDirection.INPUT_POLL ||
    direction === DpAddressDirection.IO_POLL ||
    direction === DpAddressDirection.INPUT_SQUERY ||
    direction === DpAddressDirection.IO_SQUERY ||
    direction === DpAddressDirection.INPUT_CYCLIC_ON_USE ||
    direction === DpAddressDirection.IO_CYCLIC_ON_USE
  );
}

/**
 * Peripheral-address `_reference` for an OPC UA item: `<Conn>$<Sub>$1$1$<NodeId>`.
 *
 * Field 1 is the OPC UA server (connection) and field 2 the SUBSCRIPTION, both named without
 * the leading underscore of their datapoint (`_<conn>` of type `_OPCUAServer`, `_<sub>` of type
 * `_OPCUASubscription` — verified in the vendor's own `opcuaDriver_plugin.ctl`).
 *
 * ⚠️ An EMPTY subscription field is what makes an address polled. So a subscribed address whose
 * subscription name is missing does not fail — it silently becomes a polled one, which is the
 * reason the generator refuses to write it and says so instead.
 */
export function buildOpcUaReference(conn: string, nodeId: string, subscription = ''): string {
  return `${conn}$${subscription}$1$1$${nodeId}`;
}

/**
 * The same reference, with its SUBSCRIPTION field set (or cleared).
 *
 * Catalogs store the whole reference as the browse produced it — polled, i.e. field 2 empty — so
 * switching one signal to a subscription rewrites that field rather than rebuilding the address
 * from parts the catalog no longer has.
 */
export function withOpcUaSubscription(reference: string, subscription: string): string {
  const fields = reference.split('$');
  // `<Conn>$<Sub>$1$1$<NodeId>`: fewer fields than that is not a reference this can touch, and
  // guessing at its shape would corrupt an address that works.
  if (fields.length < 5) return reference;
  fields[1] = subscription;
  return fields.join('$');
}

/**
 * The same reference, re-pointed at another SERVER (field 1).
 *
 * A catalog stores the reference the browse produced, which names the connection the browse
 * ran on. That connection is a property of the IMPORT, not of the instance: a mutualised
 * catalog — one machine browsed once, then deployed on the five identical ones beside it — must
 * address each instance through ITS OWN server. Left as browsed, every instance would poll the
 * machine the catalog came from, which is a plant reading one PLC five times and reporting the
 * other four as healthy.
 *
 * Field 1 alone is rewritten: the subscription, the kind, the variant and the NodeId are the
 * catalog's, and rebuilding the address from parts the catalog no longer has is how a working
 * reference gets corrupted.
 */
export function withOpcUaConnection(reference: string, connection: string): string {
  const fields = reference.split('$');
  // `<Conn>$<Sub>$1$1$<NodeId>`: fewer fields than that is not a reference this can touch.
  if (fields.length < 5 || connection.trim() === '') return reference;
  fields[0] = connection.trim();
  return fields.join('$');
}

/** `_address.._drv_ident` for the OPC UA client driver. */
export const OPCUA_DRV_IDENT = 'OPCUA';
