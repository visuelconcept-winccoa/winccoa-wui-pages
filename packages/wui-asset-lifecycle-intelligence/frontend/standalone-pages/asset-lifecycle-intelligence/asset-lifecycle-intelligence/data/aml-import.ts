/**
 * TIA Portal CAx (AutomationML / .aml) import.
 *
 * Parses a TIA Portal "Export CAx data" file (CAEX XML) and turns each
 * hardware module that has an order number (MLFB) into an {@link Asset}. The
 * parsing mirrors the standalone hw_config_viewer.html prototype (same
 * `:scope > Attribute` / SupportedRoleClass walk), reduced to the fields the
 * asset inventory needs.
 *
 * Re-import keying: every imported asset carries `tiaProject` (the AML project
 * name) and a stable `tiaKey` (`device/module#slot`). On re-import of the same
 * project, the page matches on `tiaProject + tiaKey` and refreshes the
 * hardware-derived fields while preserving the user's risk assessment (see
 * {@link mergeAmlAsset}).
 */
import { blankAsset, type Asset } from '../types.js';

const ORDER_PREFIX = 'OrderNumber:';
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const CHILD_ELEMENTS = ':scope > InternalElement';

export interface AmlImportResult {
  project: string;
  assets: Asset[];
}

/** Read a direct-child `<Attribute Name=..><Value>` text, or '' if absent. */
function attr(el: Element, name: string): string {
  for (const a of el.querySelectorAll(':scope > Attribute')) {
    if (a.getAttribute('Name') === name) {
      const v = a.querySelector(':scope > Value');
      return v?.textContent?.trim() ?? '';
    }
  }
  return '';
}

/** Last segment of the element's SupportedRoleClass path (e.g. 'Device'). */
function role(el: Element): string {
  const src = el.querySelector(':scope > SupportedRoleClass');
  const path = src?.getAttribute('RefRoleClassPath') ?? '';
  return path.includes('/') ? (path.split('/').pop() ?? '') : path;
}

/** Normalize a TypeIdentifier into a clean MLFB (strip prefix + spaces). */
function orderNumber(el: Element): string {
  const ti = attr(el, 'TypeIdentifier');
  if (!ti.includes(ORDER_PREFIX)) return '';
  return ti.replace(ORDER_PREFIX, '').replaceAll(' ', '').trim();
}

/** First IPv4 found on any descendant node of the module (CPU interface). */
function findIp(moduleEl: Element): string {
  for (const node of moduleEl.querySelectorAll('InternalElement')) {
    const ip = attr(node, 'NetworkAddress');
    if (IPV4_RE.test(ip)) return ip;
  }
  return '';
}

/** Is this child element a hardware module (vs. a tag table / port / node)? */
function isModule(el: Element): boolean {
  return (
    attr(el, 'TypeName') !== '' ||
    attr(el, 'DeviceItemType') !== '' ||
    role(el) === 'DeviceItem'
  );
}

function moduleToAsset(project: string, deviceName: string, moduleEl: Element): Asset | null {
  const mlfb = orderNumber(moduleEl);
  if (mlfb === '') return null; // only orderable hardware becomes an asset

  const typeName = attr(moduleEl, 'TypeName');
  const moduleName = moduleEl.getAttribute('Name') ?? typeName;
  const slot = attr(moduleEl, 'PositionNumber');

  const asset = blankAsset();
  asset.name = typeName || moduleName;
  asset.mlfb = mlfb;
  asset.station = deviceName;
  asset.area = deviceName;
  asset.ip = findIp(moduleEl);
  asset.firmwareField = attr(moduleEl, 'FirmwareVersion');
  asset.source = 'tia';
  asset.tiaProject = project;
  asset.tiaKey = `${deviceName}/${moduleName}#${slot}`;
  return asset;
}

function isRack(el: Element): boolean {
  return attr(el, 'TypeName') === 'Rack' || (el.getAttribute('Name') ?? '').includes('Rail');
}

/** Collect every order-numbered module of one device (across its racks). */
function parseDevice(project: string, deviceEl: Element): Asset[] {
  const deviceName = deviceEl.getAttribute('Name') ?? '';
  const assets: Asset[] = [];
  for (const rackEl of deviceEl.querySelectorAll(CHILD_ELEMENTS)) {
    if (!isRack(rackEl)) continue;
    for (const child of rackEl.querySelectorAll(CHILD_ELEMENTS)) {
      if (!isModule(child)) continue;
      const asset = moduleToAsset(project, deviceName, child);
      if (asset) assets.push(asset);
    }
  }
  return assets;
}

/** Parse AML text into a project name + the assets it contains. */
export function parseAmlAssets(xmlText: string): AmlImportResult {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('Fichier AML illisible (XML invalide).');
  }
  const projectEl = doc.querySelector('InstanceHierarchy > InternalElement');
  if (!projectEl) {
    throw new Error('Aucun projet trouvé dans le fichier AML.');
  }
  const project = projectEl.getAttribute('Name') ?? 'TIA';

  const assets: Asset[] = [];
  for (const deviceEl of projectEl.querySelectorAll(CHILD_ELEMENTS)) {
    if (role(deviceEl) === 'Device') assets.push(...parseDevice(project, deviceEl));
  }
  if (assets.length === 0) {
    throw new Error('Aucun module avec référence (MLFB) trouvé dans le projet.');
  }
  return { project, assets };
}

/**
 * Merge a freshly parsed AML asset onto an existing record: refresh the
 * hardware-derived fields, keep the user's risk assessment, identity and notes.
 */
export function mergeAmlAsset(existing: Asset, incoming: Asset): Asset {
  return {
    ...existing,
    name: incoming.name,
    mlfb: incoming.mlfb,
    station: incoming.station,
    ip: incoming.ip,
    firmwareField: incoming.firmwareField,
    source: 'tia',
    tiaProject: incoming.tiaProject,
    tiaKey: incoming.tiaKey
  };
}
