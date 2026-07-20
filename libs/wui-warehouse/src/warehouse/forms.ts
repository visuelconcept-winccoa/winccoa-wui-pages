// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Field-schema builders for the generic {@link WhEntityDialog}. Kept out of the
 * page component so the page stays focused on orchestration. Option labels are
 * resolved in the active language at build time (the dialog is re-created per
 * open, so this is fine).
 */
import { MSG, localize } from './i18n.js';
import type { FieldDef, FieldOption } from './ui/wh-entity-dialog.js';
import type { LocationType, Product, StorageLocation, Zone } from './types.js';

const LOCATION_TYPES: LocationType[] = ['rack', 'shelf', 'bin', 'floor', 'cold'];

export function zoneFields(): FieldDef[] {
  return [
    { key: 'name', label: MSG.fields.name, kind: 'text', required: true, full: true },
    { key: 'code', label: MSG.fields.code, kind: 'text', required: true },
    { key: 'color', label: MSG.fields.color, kind: 'color' },
    { key: 'x', label: MSG.fields.posX, kind: 'number', min: 0 },
    { key: 'y', label: MSG.fields.posY, kind: 'number', min: 0 },
    { key: 'w', label: MSG.fields.posW, kind: 'number', min: 1 },
    { key: 'h', label: MSG.fields.posH, kind: 'number', min: 1 },
    { key: 'description', label: MSG.fields.description, kind: 'textarea', full: true }
  ];
}

export function locationFields(zones: Zone[]): FieldDef[] {
  return [
    { key: 'zoneId', label: MSG.fields.zone, kind: 'select', required: true, options: zoneOptions(zones) },
    { key: 'code', label: MSG.fields.code, kind: 'text', required: true },
    { key: 'label', label: MSG.fields.name, kind: 'text' },
    { key: 'type', label: MSG.fields.type, kind: 'select', options: typeOptions() },
    { key: 'capacity', label: MSG.fields.capacity, kind: 'number', min: 0 },
    { key: 'x', label: MSG.fields.posX, kind: 'number', min: 0 },
    { key: 'y', label: MSG.fields.posY, kind: 'number', min: 0 },
    { key: 'w', label: MSG.fields.posW, kind: 'number', min: 1 },
    { key: 'h', label: MSG.fields.posH, kind: 'number', min: 1 }
  ];
}

export function productFields(): FieldDef[] {
  return [
    { key: 'ref', label: MSG.fields.ref, kind: 'text', required: true },
    { key: 'name', label: MSG.fields.name, kind: 'text', required: true, full: true },
    { key: 'category', label: MSG.fields.category, kind: 'text' },
    { key: 'unit', label: MSG.fields.unit, kind: 'text' },
    { key: 'minQty', label: MSG.fields.minQty, kind: 'number', min: 0 },
    { key: 'maxQty', label: MSG.fields.maxQty, kind: 'number', min: 0 }
  ];
}

export function stockFields(products: Product[], locations: StorageLocation[], lock: boolean): FieldDef[] {
  return [
    { key: 'product', label: MSG.fields.product, kind: 'select', required: true, readonly: lock, options: productOptions(products) },
    { key: 'location', label: MSG.fields.location, kind: 'select', required: true, readonly: lock, options: locationOptions(locations) },
    { key: 'quantity', label: MSG.fields.quantity, kind: 'number', min: 0, full: true }
  ];
}

export function campaignFields(zones: Zone[]): FieldDef[] {
  const scope: FieldOption[] = [{ value: '', label: localize(MSG.inventory.wholeWarehouse) }, ...zoneOptions(zones)];
  return [
    { key: 'name', label: MSG.fields.name, kind: 'text', required: true, full: true },
    { key: 'zoneId', label: MSG.fields.zone, kind: 'select', options: scope, full: true }
  ];
}

function zoneOptions(zones: Zone[]): FieldOption[] {
  return zones.map((z) => ({ value: z.id, label: `${z.code} · ${z.name}` }));
}

function typeOptions(): FieldOption[] {
  return LOCATION_TYPES.map((t) => ({ value: t, label: localize(MSG.locTypes[t]) }));
}

function productOptions(products: Product[]): FieldOption[] {
  return products.map((p) => ({ value: p.id, label: `${p.ref} · ${p.name}` }));
}

function locationOptions(locations: StorageLocation[]): FieldOption[] {
  return locations.map((l) => ({ value: l.id, label: `${l.code} · ${l.label}` }));
}
