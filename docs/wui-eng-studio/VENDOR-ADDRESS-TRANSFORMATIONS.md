<!--
SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
SPDX-License-Identifier: AGPL-3.0-only
-->

# WinCC OA `_address` config — attributes, transformations, directions

**Vendor reference, recorded verbatim.** Source: WinCC OA online help, `_address`
config appendix —
`https://www.winccoa.com/documentation/WinCCOA/latest/en_US/Notes/dpconfig_address.html`
(companion page: `.../Treiber_ComDrv/comdrv_transformation.html`).

Why a copy lives in the repository: **`www.winccoa.com` is not reachable from our
dev/CI containers** — the outbound HTTPS proxy rejects the CONNECT (403). Without
this file the numeric constants would be guessed from memory, which is exactly how
an address silently binds the wrong transformation. Every constant used by
`libs/wui-eng-core/src/drivers/*` is traceable to a row below.

> Reproduced for engineering reference. Check the online version when upgrading
> WinCC OA: transformations are added between releases (the non-contiguous Modbus
> numbering below is such an addition).

## `_address` attributes (neutral)

| Attribute | Type | Meaning (condensed) |
|---|---|---|
| `_type` | type | `DPCONFIG_NONE` = 0, `DPCONFIG_PERIPH_ADDR_MAIN` = 16 (general peripheral address) |
| `_drv_ident` | string | driver type, e.g. `"MODBUS"`, `"S7"` |
| `_reference` | string | the address of the data in the periphery — **format is driver specific** |
| `_datatype` | int | data type in the periphery → the required **transformation**; **driver specific**, tables below |
| `_direction` | int | input/output mode; bits 0–4 of the legacy `_mode` |
| `_internal` | bool | the "internal" bit (bit 5 of `_mode`) — driver-specific special handling |
| `_lowlevel` | bool | low-level Old/New comparison filter (bit 6 of `_mode`) |
| `_active` | bool | an **inactive** address exists and keeps its attributes, but the driver does not use it: no value exchange, no connection built for the DPE, and **conflicts with other addresses are not checked** |
| `_poll_group` | dpid | reference to a poll group (replaces `_interval` / `_start`); **only set when given as system name + datapoint name**, otherwise it is not even displayed in para |
| `_subindex` | uint32 | access part of an address, e.g. individual bits of a 32-bit word |
| `_offset` | uint16 | optional driver-specific address information |
| `_connection` | string | used by some drivers |
| `_mode` | char | legacy combination of `_direction` + `_internal` + `_lowlevel` — **replaced** by those three |
| `_interval`, `_start` | time | **obsolete** (superseded by poll groups) |

## `_address.._direction`

| CTRL constant | Int | Meaning |
|---|---|---|
| `DPATTR_ADDR_MODE_UNDEFINED` | 0 | undefined |
| `DPATTR_ADDR_MODE_OUTPUT` | 1 | standard output — **group** connection on subindices: any subindex change makes the driver read *all* subindices and build one telegram |
| `DPATTR_ADDR_MODE_INPUT_SPONT` | 2 | input, spontaneous data |
| `DPATTR_ADDR_MODE_INPUT_SQUERY` | 3 | input, single queries |
| `DPATTR_ADDR_MODE_INPUT_POLL` | 4 | input, polling (cyclic query) |
| `DPATTR_ADDR_MODE_OUTPUT_SINGLE` | 5 | output with a **single** connection per subindex: missing subindices are sent as 0 (identical to OUTPUT when there is only one) |
| `DPATTR_ADDR_MODE_IO_SPONT` | 6 | input/output, spontaneous |
| `DPATTR_ADDR_MODE_IO_POLL` | 7 | input/output, polling |
| `DPATTR_ADDR_MODE_IO_SQUERY` | 8 | input/output, single queries |
| `DPATTR_ADDR_MODE_AM_ALERT` | 9 | hardware alert handling — external alerts are triggered through this address |
| `DPATTR_ADDR_MODE_INPUT_ON_DEMAND` | 10 | currently not in use |
| `DPATTR_ADDR_MODE_INPUT_CYCLIC_ON_USE` | 11 | input, polled only while a `dpConnect`/`dpQueryConnect` exists on the element |
| `DPATTR_ADDR_MODE_IO_ON_DEMAND` | 12 | currently not in use |
| `DPATTR_ADDR_MODE_IO_CYCLIC_ON_USE` | 13 | input/output, polled only while a query exists |
| `DPATTR_ADDR_MODE_INPUT_SPONT_ON_USE` | 14 | input, subscribed only while a query exists |
| `DPATTR_ADDR_MODE_IO_SPONT_ON_USE` | 15 | input/output, subscribed only while a query exists |
| `DPATTR_ADDR_MODE_INTERNAL` | 32 | **obsolete** — use `_internal` |
| `DPATTR_ADDR_MODE_LOW_LEVEL_FLAG` | 64 | **obsolete** — use `_lowlevel` |

## `_address.._datatype` — the drivers this repository addresses

### OPC UA (750–768)

| Transformation | Int | | Transformation | Int |
|---|---|---|---|---|
| DEFAULT | 750 | | UINT64 | 759 |
| BOOLEAN | 751 | | FLOAT | 760 |
| SBYTE | 752 | | DOUBLE | 761 |
| BYTE | 753 | | STRING | 762 |
| INT16 | 754 | | DATETIME | 763 |
| UINT16 | 755 | | GUID | 764 |
| INT32 | 756 | | BYTESTRING | 765 |
| UINT32 | 757 | | XMLELEMENT | 766 |
| INT64 | 758 | | NODEID | 767 |
| | | | LOCALIZEDTEXT | 768 |

Used by `drivers/opcua.ts` (unchanged since the verified tag-importer code — this
table confirms it).

### S7 — classic driver, S7-300/400 (700–722)

| Transformation | Int | Description |
|---|---|---|
| UNDEFINED | 700 | default |
| INT16 | 701 | 16-bit integer signed |
| INT32 | 702 | 32-bit integer signed |
| UINT16 | 703 | 16-bit integer unsigned |
| BYTE | 704 | byte |
| FLOAT | 705 | floating-point value |
| BIT | 706 | boolean |
| STRING | 707 | text |
| UINT32 | 708 | 32-bit integer unsigned |
| DATETIME | 709 | date/time (S7 300 and S7 400 models) |
| BLOB | 710 | blob |
| BITSTRING | 711 | bit pattern |
| TimeOfDay | 713 | time |
| S5Time | 714 | time, S5 compatibility |
| DATETIMELONG | 718 | date/time (S7 1200 models) |
| Int32WithQuality | 719 | 32-bit signed + (optional) quality |
| UInt32WithQuality | 720 | 32-bit unsigned + (optional) quality |
| FloatWithQuality | 721 | float + (optional) quality |
| S5TimeAsMilliseconds | 722 | S5Time to UINT |

**No entry for**: 64-bit integers (`LInt`/`ULInt`), 64-bit float (`LReal`),
`LWord`, `WString`, `LTime`/`LTod`/`LDT`. `drivers/s7.ts` therefore returns
`undefined` for those instead of a neighbour — mapping `LReal` onto `FLOAT` would
truncate every value.

### S7Plus — S7-1200/1500 (1001–1027)

| Transformation | Int | | Transformation | Int |
|---|---|---|---|---|
| DEFAULT | 1001 | | DINT | 1013 |
| BOOL | 1002 | | LINT | 1014 |
| BYTE | 1003 | | REAL | 1015 |
| WORD | 1004 | | LREAL | 1016 |
| DWORD | 1005 | | DATE | 1017 |
| LWORD | 1006 | | DATETIME | 1018 |
| USINT | 1007 | | TIME | 1019 |
| UINT | 1008 | | TIME_OF_DAY | 1020 |
| UDINT | 1009 | | LDATETIME | 1021 |
| ULINT | 1010 | | LTIME | 1022 |
| SINT | 1011 | | LTOD | 1023 |
| INT | 1012 | | DTL | 1024 |
| | | | S5TIME | 1025 |
| | | | STRING | 1026 |
| | | | WSTRING | 1027 |

Ranges of `TIME`/`LTIME`/`DTL` per the vendor page: `TIME` 32-bit ms
(±24d 20h 31m 23s 647ms), `LTIME` 64-bit ns, `DTL` a 12-byte struct
(1970-01-01-00:00:00.0 … 2554-12-31-23:59:59.999999999), `S5TIME` 16-bit ms
(0 … 2h 46m 30s).

**The names are the IEC ones**, so the mapping from a TIA datatype is 1:1 — except
`Char`/`WChar`, which the table does not list.
⚠️ The numbering **overlaps SBUS and MQTT** (both also start at 1001): a
transformation code is only meaningful together with `_drv_ident`.

### MODBUS (560–577)

| Transformation | Int | | Transformation | Int |
|---|---|---|---|---|
| UNDEFINED | 560 | | BLOB | 570 |
| INT16 | 561 | | INT64 | 571 |
| INT32 | 562 | | DOUBLE (64-bit IEEE 754) | 572 |
| UINT16 | 563 | | FLOAT with timestamp | 573 |
| UINT32 | 564 | | UINT64 | 574 |
| CHAR | 565 | | MOD10 SIZE 2 | 575 |
| FLOAT | 566 | | MOD10 SIZE 3 | 576 |
| BIT | 567 | | MOD10 SIZE 4 | 577 |
| BOOLEAN_AS_BYTE | 568 | | | |
| STRING | 569 | | | |

`MOD10 SIZE n` is a PLC-specific transformation spanning *n* registers.
⚠️ No table settles the **byte/word order** of 32/64-bit values, nor the
connector's *zero based addressing* option — both must be confirmed per device.

## Other drivers (for completeness, not used here)

| Driver | Range | Driver | Range |
|---|---|---|---|
| SIM | 0–15 | OPC (classic) | 480–491 (+ `DEFAULT` = 0) |
| IEC61850 | 1–15 | IEC (60870) | 520–546 |
| SSI | 40–51 | MODBUS | 560–577 |
| RK512 | 240–255 | SNMP | 660–673 |
| DNP3 | 210–215 | S7 | 700–722 |
| BACnet | 800–822 | SINAUT | 720–726 |
| EIP | 770–781 | OPC UA | 750–768 |
| MQTT | 1001–1004 | SBUS | 1001–1006 |
| S7Plus | 1001–1027 | | |

Full per-driver rows are on the vendor page; only the drivers above are mapped in
`libs/wui-eng-core/src/drivers/`. Note how many ranges collide — always pair a
code with its `_drv_ident`.

## Example from the vendor page

```cpp
main()
{
  dpSetWait("TestDP_1.element:_address.._type",
  DPCONFIG_PERIPH_ADDR_MAIN,
  "TestDP_1.element:_address.._drv_ident","ABB");
}
```

This is the shape `configs/builders.ts` generalises: one `dpSetWait` carrying the
whole `_address` attribute set for a DPE.
