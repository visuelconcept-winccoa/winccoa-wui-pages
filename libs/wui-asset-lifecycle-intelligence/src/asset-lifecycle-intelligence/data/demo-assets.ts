/* eslint-disable sonarjs/no-duplicate-string, max-lines --
   Demo data fixtures: repeated MLFB / firmware / area values and the overall
   length are inherent to multi-domain sample datasets, not logic to refactor. */
/**
 * Demo asset fleets used to seed the in-memory (offline) store and the
 * "import demo" action. Three industry domains are provided so the page can be
 * shown in different contexts:
 *   - `semicon` — semiconductor fab / cleanroom utilities;
 *   - `agro`    — food & beverage processing plant;
 *   - `pharma`  — pharmaceutical manufacturing (GMP).
 *
 * Each fleet is modelled as a handful of **logical assets** (`assetGroup` =
 * machine / skid). Every asset bundles SEVERAL product references (MLFB) on the
 * same control **station** — typically a CPU + its IO modules + a network switch
 * (+ a drive / HMI / meter where relevant) — so the grouped tree view and the
 * summed per-asset scoring are meaningful. Field values span the full
 * Low→Critical risk range and the Siemens lifecycle phases (PM300 → PM500).
 * All copy is in English.
 */
import { blankAsset, type Asset } from '../types.js';

/** Industry domain of a demo fleet. */
export type DemoDomain = 'semicon' | 'agro' | 'pharma';

/** Domains offered in the UI, in display order. */
export const DEMO_DOMAIN_KEYS: DemoDomain[] = ['semicon', 'agro', 'pharma'];

/** Build a demo asset from partial fields, filling the rest with sane defaults. */
function a(o: Partial<Asset> & Pick<Asset, 'id' | 'name' | 'mlfb'>): Asset {
  return { ...blankAsset(), ...o };
}

// Common component MLFBs reused across stations (CPU / IO / switch / drive / HMI).
const SCALANCE_XB208 = '6GK5208-0BA00-2AC2';
const SCALANCE_XB216 = '6GK5216-0BA00-2AC2';
const SCALANCE_XR528 = '6GK5528-0AA00-2AR2';
const ET200SP_IM = '6ES7155-6AU01-0BN0';
const ET200SP_DI = '6ES7131-6BF00-0BA0';
const ET200SP_AI = '6ES7134-6JD00-0CA1';

// ---- Semiconductor fab / cleanroom utilities -------------------------------
const SEMICON: Asset[] = [
  // Asset: Ultra-Pure Water system (CPU + IO + switch on the control cabinet, HMI on the panel)
  a({
    id: 'upw-cpu-1510sp', name: 'UPW controller CPU 1510SP', mlfb: '6ES7510-1DJ01-0AB0',
    station: 'upw-ctrl-01', ip: '10.31.1.10', area: 'Ultra-Pure Water (UPW)', assetGroup: 'UPW system',
    firmwareField: 'V2.1', firmwareAvail: 'V3.0', phase: 'PM410', firmware: 'majorOrCve',
    criticality: 'high', supply: 'over12OrOos', vuln: 'medium', operatingHours: 60_000, mtbfHours: 90_000,
    source: 'tia', notes: 'Recirculation loop CPU — firmware V2.1, latest V3.0.'
  }),
  a({
    id: 'upw-io-im155', name: 'UPW ET 200SP IM 155-6', mlfb: ET200SP_IM,
    station: 'upw-ctrl-01', ip: '10.31.1.11', area: 'Ultra-Pure Water (UPW)', assetGroup: 'UPW system',
    firmwareField: 'V4.2', firmwareAvail: 'V4.2', phase: 'PM300', firmware: 'upToDate',
    criticality: 'high', supply: 'inStock', vuln: 'low', operatingHours: 40_000, mtbfHours: 120_000,
    source: 'tia', notes: 'Distributed IO head station for the UPW loop.'
  }),
  a({
    id: 'upw-sw-xb208', name: 'UPW switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'upw-ctrl-01', ip: '10.31.1.12', area: 'Ultra-Pure Water (UPW)', assetGroup: 'UPW system',
    firmwareField: 'V4.3', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 55_000, mtbfHours: 110_000,
    source: 'tia', notes: 'Cabinet network switch (PROFINET).'
  }),
  a({
    id: 'upw-hmi-tp1500', name: 'UPW HMI TP1500 Comfort', mlfb: '6AV2124-0QC02-0AX0',
    station: 'upw-hmi-01', ip: '10.31.4.50', area: 'Ultra-Pure Water (UPW)', assetGroup: 'UPW system',
    firmwareField: 'V16.0', firmwareAvail: 'V17.0', phase: 'PM500', firmware: 'minorBehind',
    criticality: 'high', supply: 'over12OrOos', vuln: 'low', operatingHours: 80_000, mtbfHours: 90_000,
    source: 'tia', notes: 'Operator panel at end of life (PM500) — replacement required.'
  }),

  // Asset: Air-separation compressor (legacy S7-400 CPU + ET 200M IO + switch + drive)
  a({
    id: 'asu-cpu-414', name: 'ASU compressor CPU 414-3', mlfb: '6ES7414-3XM05-0AB0',
    station: 'asu-comp-01', ip: '10.30.1.10', area: 'Air Separation (ASU)', assetGroup: 'ASU compressor',
    firmwareField: 'V5.3', firmwareAvail: 'V6.0', successor: '6ES7516-3AN02-0AB0', phase: 'PM490',
    firmware: 'majorOrCve', criticality: 'critical', supply: 'over12OrOos', vuln: 'medium',
    operatingHours: 110_000, mtbfHours: 120_000, source: 'tia', notes: 'S7-400 discontinued (PM490) — plan S7-1500 migration.'
  }),
  a({
    id: 'asu-io-im153', name: 'ASU ET 200M IM 153-2', mlfb: '6ES7153-2BA02-0XB0',
    station: 'asu-comp-01', ip: '10.30.1.11', area: 'Air Separation (ASU)', assetGroup: 'ASU compressor',
    firmwareField: 'V4.0', firmwareAvail: 'V4.2', phase: 'PM410', firmware: 'minorBehind',
    criticality: 'high', supply: 'lead4to12', vuln: 'low', operatingHours: 95_000, mtbfHours: 110_000,
    source: 'tia', notes: 'ET 200M IO rack (spare-part only, PM410).'
  }),
  a({
    id: 'asu-sw-xb216', name: 'ASU switch SCALANCE XB216', mlfb: SCALANCE_XB216,
    station: 'asu-comp-01', ip: '10.30.1.12', area: 'Air Separation (ASU)', assetGroup: 'ASU compressor',
    firmwareField: 'V4.4', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 50_000, mtbfHours: 110_000,
    source: 'tia', notes: 'Compressor cabinet switch.'
  }),
  a({
    id: 'asu-drive-g120', name: 'ASU compressor drive G120', mlfb: '6SL3210-1PE23-3UL0',
    station: 'asu-comp-01', ip: '10.30.1.13', area: 'Air Separation (ASU)', assetGroup: 'ASU compressor',
    firmwareField: 'V4.7', firmwareAvail: 'V4.8', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'high', supply: 'lead4to12', vuln: 'none', operatingHours: 70_000, mtbfHours: 80_000,
    source: 'csv', notes: 'Main compressor drive.'
  }),

  // Asset: Lithography tool (safety CPU + IO + switch + HMI)
  a({
    id: 'litho-cpu-1516f', name: 'Lithography F-CPU 1516F', mlfb: '6ES7516-3FN02-0AB0',
    station: 'litho-01', ip: '10.41.1.10', area: 'Lithography', assetGroup: 'Lithography tool',
    firmwareField: 'V2.9', firmwareAvail: 'V3.1', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'critical', supply: 'lead4to12', vuln: 'high', operatingHours: 55_000, mtbfHours: 90_000,
    source: 'manual', notes: 'Tool safety controller — phase-out announced.'
  }),
  a({
    id: 'litho-io-di', name: 'Lithography ET 200SP DI', mlfb: ET200SP_DI,
    station: 'litho-01', ip: '10.41.1.11', area: 'Lithography', assetGroup: 'Lithography tool',
    firmwareField: 'V2.1', firmwareAvail: 'V2.1', phase: 'PM300', firmware: 'upToDate',
    criticality: 'medium', supply: 'inStock', vuln: 'low', operatingHours: 30_000, mtbfHours: 120_000,
    source: 'manual', notes: 'Digital-input module.'
  }),
  a({
    id: 'litho-sw-xb208', name: 'Lithography switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'litho-01', ip: '10.41.1.12', area: 'Lithography', assetGroup: 'Lithography tool',
    firmwareField: 'V4.5', firmwareAvail: 'V4.5', phase: 'PM300', firmware: 'minorBehind',
    criticality: 'medium', supply: 'inStock', vuln: 'medium', operatingHours: 28_000, mtbfHours: 110_000,
    source: 'manual', notes: 'Tool cabinet switch.'
  }),
  a({
    id: 'litho-hmi-tp1900', name: 'Lithography HMI TP1900', mlfb: '6AV2124-0UC02-0AX0',
    station: 'litho-hmi-01', ip: '10.41.4.30', area: 'Lithography', assetGroup: 'Lithography tool',
    firmwareField: 'V16.1', firmwareAvail: 'V17.0', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'critical', supply: 'lead4to12', vuln: 'medium', operatingHours: 55_000, mtbfHours: 90_000,
    source: 'manual', notes: 'Tool supervision panel.'
  }),

  // Asset: Cleanroom HVAC (CPU + analog IO + switch)
  a({
    id: 'hvac-cpu-1515', name: 'Cleanroom HVAC CPU 1515-2', mlfb: '6ES7515-2AN03-0AB0',
    station: 'hvac-ahu-01', ip: '10.36.1.10', area: 'HVAC – Cleanroom', assetGroup: 'Cleanroom HVAC',
    firmwareField: 'V2.9', firmwareAvail: 'V2.9', phase: 'PM300', firmware: 'upToDate',
    criticality: 'critical', supply: 'inStock', vuln: 'low', operatingHours: 38_000, mtbfHours: 100_000,
    source: 'tia', notes: 'Air-handling unit CPU (ISO 5).'
  }),
  a({
    id: 'hvac-io-ai', name: 'Cleanroom HVAC ET 200SP AI', mlfb: ET200SP_AI,
    station: 'hvac-ahu-01', ip: '10.36.1.11', area: 'HVAC – Cleanroom', assetGroup: 'Cleanroom HVAC',
    firmwareField: 'V1.3', firmwareAvail: 'V1.4', phase: 'PM300', firmware: 'minorBehind',
    criticality: 'high', supply: 'inStock', vuln: 'low', operatingHours: 25_000, mtbfHours: 120_000,
    source: 'tia', notes: 'Analog-input module (temp/humidity/pressure).'
  }),
  a({
    id: 'hvac-sw-xb208', name: 'Cleanroom HVAC switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'hvac-ahu-01', ip: '10.36.1.12', area: 'HVAC – Cleanroom', assetGroup: 'Cleanroom HVAC',
    firmwareField: 'V4.3', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 32_000, mtbfHours: 110_000,
    source: 'tia', notes: 'AHU cabinet switch.'
  }),

  // Asset: Plant network core (redundant switches)
  a({
    id: 'net-sw-xr528-1', name: 'Core switch SCALANCE XR528 #1', mlfb: SCALANCE_XR528,
    station: 'core-sw-01', ip: '10.50.0.2', area: 'Control room', assetGroup: 'Plant network',
    firmwareField: 'V2.3', firmwareAvail: 'V3.0', phase: 'PM300', firmware: 'minorBehind',
    criticality: 'high', supply: 'inStock', vuln: 'medium', operatingHours: 40_000, mtbfHours: 130_000,
    source: 'manual', notes: 'SCADA network core (redundant).'
  }),
  a({
    id: 'net-sw-xr528-2', name: 'Core switch SCALANCE XR528 #2', mlfb: SCALANCE_XR528,
    station: 'core-sw-01', ip: '10.50.0.3', area: 'Control room', assetGroup: 'Plant network',
    firmwareField: 'V2.3', firmwareAvail: 'V3.0', phase: 'PM300', firmware: 'minorBehind',
    criticality: 'medium', supply: 'inStock', vuln: 'medium', operatingHours: 40_000, mtbfHours: 130_000,
    source: 'manual', notes: 'SCADA network core (redundant pair).'
  })
];

// ---- Food & Beverage processing plant --------------------------------------
const AGRO: Asset[] = [
  // Asset: Pasteurizer skid (CPU + IO + switch)
  a({
    id: 'past-cpu-1516', name: 'Pasteurizer CPU 1516-3', mlfb: '6ES7516-3AN02-0AB0',
    station: 'past-01', ip: '10.20.1.10', area: 'Pasteurization', assetGroup: 'Pasteurizer skid',
    firmwareField: 'V2.9', firmwareAvail: 'V3.1', phase: 'PM300', firmware: 'majorOrCve',
    criticality: 'critical', supply: 'lead4to12', vuln: 'high', operatingHours: 32_000, mtbfHours: 100_000,
    source: 'tia', notes: 'HTST loop CPU — CVE to patch as a priority.'
  }),
  a({
    id: 'past-io-im155', name: 'Pasteurizer ET 200SP IM 155-6', mlfb: ET200SP_IM,
    station: 'past-01', ip: '10.20.1.11', area: 'Pasteurization', assetGroup: 'Pasteurizer skid',
    firmwareField: 'V4.2', firmwareAvail: 'V4.2', phase: 'PM300', firmware: 'upToDate',
    criticality: 'high', supply: 'inStock', vuln: 'low', operatingHours: 30_000, mtbfHours: 120_000,
    source: 'tia', notes: 'Skid distributed IO.'
  }),
  a({
    id: 'past-sw-xb208', name: 'Pasteurizer switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'past-01', ip: '10.20.1.12', area: 'Pasteurization', assetGroup: 'Pasteurizer skid',
    firmwareField: 'V4.3', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 35_000, mtbfHours: 110_000,
    source: 'tia', notes: 'Skid cabinet switch.'
  }),

  // Asset: Filling line (CPU + IO + switch + drive + HMI)
  a({
    id: 'fill-cpu-1513', name: 'Filling line CPU 1513-1', mlfb: '6ES7513-1AL02-0AB0',
    station: 'fill-01', ip: '10.21.1.10', area: 'Filling line', assetGroup: 'Filling line',
    firmwareField: 'V2.8', firmwareAvail: 'V2.9', phase: 'PM300', firmware: 'minorBehind',
    criticality: 'critical', supply: 'inStock', vuln: 'low', operatingHours: 28_000, mtbfHours: 90_000,
    source: 'tia', notes: 'Rotary filler line CPU.'
  }),
  a({
    id: 'fill-io-di', name: 'Filling line ET 200SP DI', mlfb: ET200SP_DI,
    station: 'fill-01', ip: '10.21.1.11', area: 'Filling line', assetGroup: 'Filling line',
    firmwareField: 'V2.1', firmwareAvail: 'V2.1', phase: 'PM300', firmware: 'upToDate',
    criticality: 'medium', supply: 'inStock', vuln: 'low', operatingHours: 26_000, mtbfHours: 120_000,
    source: 'tia', notes: 'Line digital IO.'
  }),
  a({
    id: 'fill-sw-xb208', name: 'Filling line switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'fill-01', ip: '10.21.1.12', area: 'Filling line', assetGroup: 'Filling line',
    firmwareField: 'V4.3', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 33_000, mtbfHours: 110_000,
    source: 'csv', notes: 'Line cabinet switch.'
  }),
  a({
    id: 'fill-drive-g120c', name: 'Filling line drive G120C', mlfb: '6SL3210-1KE21-3UF1',
    station: 'fill-01', ip: '10.21.1.13', area: 'Filling line', assetGroup: 'Filling line',
    firmwareField: 'V4.7', firmwareAvail: 'V4.8', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'critical', supply: 'lead4to12', vuln: 'none', operatingHours: 61_000, mtbfHours: 80_000,
    source: 'csv', notes: 'Rotary filler main drive — phase-out announced.'
  }),
  a({
    id: 'fill-hmi-tp1200', name: 'Filling line HMI TP1200 Comfort', mlfb: '6AV2123-2MB03-0AX0',
    station: 'fill-hmi-01', ip: '10.21.4.50', area: 'Filling line', assetGroup: 'Filling line',
    firmwareField: 'V16.0', firmwareAvail: 'V17.0', phase: 'PM500', firmware: 'minorBehind',
    criticality: 'high', supply: 'over12OrOos', vuln: 'low', operatingHours: 82_000, mtbfHours: 90_000,
    source: 'tia', notes: 'Line panel at end of life (PM500).'
  }),

  // Asset: Mixing (legacy S7-300 CPU + IO + switch)
  a({
    id: 'mix-cpu-315', name: 'Mixer CPU 315-2', mlfb: '6ES7315-2EH14-0AB0',
    station: 'mix-01', ip: '10.22.1.10', area: 'Mixing', assetGroup: 'Ingredient mixer',
    firmwareField: 'V3.2', firmwareAvail: '', successor: '6ES7515-2AN03-0AB0', phase: 'PM490',
    firmware: 'majorOrCve', criticality: 'critical', supply: 'over12OrOos', vuln: 'medium',
    operatingHours: 105_000, mtbfHours: 120_000, source: 'tia', notes: 'S7-300 discontinued (PM490) — migrate to S7-1500.'
  }),
  a({
    id: 'mix-io-im153', name: 'Mixer ET 200M IM 153-2', mlfb: '6ES7153-2BA02-0XB0',
    station: 'mix-01', ip: '10.22.1.11', area: 'Mixing', assetGroup: 'Ingredient mixer',
    firmwareField: 'V4.0', firmwareAvail: 'V4.2', phase: 'PM410', firmware: 'minorBehind',
    criticality: 'high', supply: 'lead4to12', vuln: 'low', operatingHours: 90_000, mtbfHours: 110_000,
    source: 'tia', notes: 'Legacy ET 200M IO rack.'
  }),
  a({
    id: 'mix-sw-xb208', name: 'Mixer switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'mix-01', ip: '10.22.1.12', area: 'Mixing', assetGroup: 'Ingredient mixer',
    firmwareField: 'V4.4', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 60_000, mtbfHours: 110_000,
    source: 'tia', notes: 'Mixer cabinet switch.'
  }),

  // Asset: Utilities / boiler (CPU + IO + meter)
  a({
    id: 'util-cpu-1214', name: 'Boiler control CPU 1214C', mlfb: '6ES7214-1AG40-0XB0',
    station: 'boiler-01', ip: '10.24.1.10', area: 'Utilities / Steam', assetGroup: 'Steam boiler',
    firmwareField: 'V4.5', firmwareAvail: 'V4.6', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'none', operatingHours: 35_000, mtbfHours: 80_000,
    source: 'tia', notes: 'Steam boiler control.'
  }),
  a({
    id: 'util-sw-xb208', name: 'Boiler switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'boiler-01', ip: '10.24.1.12', area: 'Utilities / Steam', assetGroup: 'Steam boiler',
    firmwareField: 'V4.5', firmwareAvail: 'V4.5', phase: 'PM300', firmware: 'upToDate',
    criticality: 'low', supply: 'inStock', vuln: 'low', operatingHours: 20_000, mtbfHours: 110_000,
    source: 'tia', notes: 'Utilities cabinet switch.'
  }),
  a({
    id: 'util-meter-pac3200', name: 'Utilities meter SENTRON PAC3200', mlfb: '7KM2112-0BA00-3AA0',
    station: 'boiler-01', ip: '10.24.1.32', area: 'Utilities / Steam', assetGroup: 'Steam boiler',
    firmwareField: 'V2.2', firmwareAvail: 'V2.4', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'low', supply: 'inStock', vuln: 'none', operatingHours: 52_000, mtbfHours: 130_000,
    source: 'manual', notes: 'Feeder energy metering.'
  })
];

// ---- Pharmaceutical manufacturing (GMP) ------------------------------------
const PHARMA: Asset[] = [
  // Asset: Bioreactor (safety CPU + IO + switch)
  a({
    id: 'bio-cpu-1516f', name: 'Bioreactor F-CPU 1516F-3', mlfb: '6ES7516-3FN02-0AB0',
    station: 'bio-01', ip: '10.10.1.10', area: 'Bioreactor / Fermentation', assetGroup: 'Bioreactor',
    firmwareField: 'V2.9', firmwareAvail: 'V3.0', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'critical', supply: 'lead4to12', vuln: 'high', operatingHours: 46_000, mtbfHours: 100_000,
    source: 'tia', notes: 'GMP fermentation safety controller.'
  }),
  a({
    id: 'bio-io-ai', name: 'Bioreactor ET 200SP AI', mlfb: ET200SP_AI,
    station: 'bio-01', ip: '10.10.1.11', area: 'Bioreactor / Fermentation', assetGroup: 'Bioreactor',
    firmwareField: 'V1.3', firmwareAvail: 'V1.4', phase: 'PM300', firmware: 'minorBehind',
    criticality: 'high', supply: 'inStock', vuln: 'low', operatingHours: 24_000, mtbfHours: 120_000,
    source: 'tia', notes: 'pH / DO / temperature analog IO.'
  }),
  a({
    id: 'bio-sw-xb208', name: 'Bioreactor switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'bio-01', ip: '10.10.1.12', area: 'Bioreactor / Fermentation', assetGroup: 'Bioreactor',
    firmwareField: 'V4.3', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 40_000, mtbfHours: 110_000,
    source: 'tia', notes: 'Bioreactor cabinet switch.'
  }),

  // Asset: WFI water loop (CPU + IO + switch)
  a({
    id: 'wfi-cpu-1513', name: 'WFI loop CPU 1513-1', mlfb: '6ES7513-1AL02-0AB0',
    station: 'wfi-01', ip: '10.10.2.10', area: 'WFI / Purified water', assetGroup: 'WFI water loop',
    firmwareField: 'V2.8', firmwareAvail: 'V3.1', phase: 'PM300', firmware: 'majorOrCve',
    criticality: 'critical', supply: 'lead4to12', vuln: 'high', operatingHours: 26_000, mtbfHours: 100_000,
    source: 'tia', notes: 'Water-for-injection loop — CVE to patch as a priority.'
  }),
  a({
    id: 'wfi-io-im155', name: 'WFI ET 200SP IM 155-6', mlfb: ET200SP_IM,
    station: 'wfi-01', ip: '10.10.2.11', area: 'WFI / Purified water', assetGroup: 'WFI water loop',
    firmwareField: 'V4.2', firmwareAvail: 'V4.2', phase: 'PM300', firmware: 'upToDate',
    criticality: 'high', supply: 'inStock', vuln: 'low', operatingHours: 22_000, mtbfHours: 120_000,
    source: 'tia', notes: 'Loop distributed IO.'
  }),
  a({
    id: 'wfi-sw-xb216', name: 'WFI switch SCALANCE XB216', mlfb: SCALANCE_XB216,
    station: 'wfi-01', ip: '10.10.2.12', area: 'WFI / Purified water', assetGroup: 'WFI water loop',
    firmwareField: 'V4.4', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 30_000, mtbfHours: 110_000,
    source: 'tia', notes: 'WFI cabinet switch.'
  }),

  // Asset: Aseptic filling line (CPU + IO + switch + HMI)
  a({
    id: 'fill-cpu-1515', name: 'Aseptic filling CPU 1515-2', mlfb: '6ES7515-2AN03-0AB0',
    station: 'afill-01', ip: '10.12.1.10', area: 'Aseptic filling', assetGroup: 'Aseptic filling line',
    firmwareField: 'V2.9', firmwareAvail: 'V2.9', phase: 'PM300', firmware: 'upToDate',
    criticality: 'critical', supply: 'inStock', vuln: 'low', operatingHours: 30_000, mtbfHours: 100_000,
    source: 'manual', notes: 'Aseptic isolator line CPU.'
  }),
  a({
    id: 'fill-io-di-ph', name: 'Aseptic filling ET 200SP DI', mlfb: ET200SP_DI,
    station: 'afill-01', ip: '10.12.1.11', area: 'Aseptic filling', assetGroup: 'Aseptic filling line',
    firmwareField: 'V2.1', firmwareAvail: 'V2.1', phase: 'PM300', firmware: 'upToDate',
    criticality: 'high', supply: 'inStock', vuln: 'low', operatingHours: 28_000, mtbfHours: 120_000,
    source: 'manual', notes: 'Line digital IO.'
  }),
  a({
    id: 'fill-sw-xb208-ph', name: 'Aseptic filling switch SCALANCE XB208', mlfb: SCALANCE_XB208,
    station: 'afill-01', ip: '10.12.1.12', area: 'Aseptic filling', assetGroup: 'Aseptic filling line',
    firmwareField: 'V4.3', firmwareAvail: 'V4.5', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'medium', supply: 'lead4to12', vuln: 'medium', operatingHours: 33_000, mtbfHours: 110_000,
    source: 'manual', notes: 'Line cabinet switch.'
  }),
  a({
    id: 'fill-hmi-tp1900-ph', name: 'Aseptic filling HMI TP1900', mlfb: '6AV2124-0UC02-0AX0',
    station: 'afill-hmi-01', ip: '10.12.4.30', area: 'Aseptic filling', assetGroup: 'Aseptic filling line',
    firmwareField: 'V16.1', firmwareAvail: 'V17.0', phase: 'PM400', firmware: 'minorBehind',
    criticality: 'critical', supply: 'lead4to12', vuln: 'medium', operatingHours: 54_000, mtbfHours: 90_000,
    source: 'manual', notes: 'Aseptic line supervision panel.'
  }),

  // Asset: Environmental monitoring + network (IPC + switch)
  a({
    id: 'env-ipc-627e', name: 'Environmental monitoring IPC627E', mlfb: '6AG4131-2..27-....',
    station: 'env-01', ip: '10.15.1.10', area: 'Environmental monitoring', assetGroup: 'EM & network',
    firmwareField: 'BIOS V21.01', firmwareAvail: 'BIOS V23.04', successor: 'SIMATIC IPC BX-39A', phase: 'PM410',
    firmware: 'majorOrCve', criticality: 'high', supply: 'over12OrOos', vuln: 'high',
    operatingHours: 50_000, mtbfHours: 70_000, source: 'manual', notes: 'EM server — unpatched OS CVE, 21 CFR Part 11 relevant.'
  }),
  a({
    id: 'env-sw-xr528', name: 'GMP core switch SCALANCE XR528', mlfb: SCALANCE_XR528,
    station: 'env-01', ip: '10.50.0.3', area: 'Environmental monitoring', assetGroup: 'EM & network',
    firmwareField: 'V2.3', firmwareAvail: 'V3.0', phase: 'PM300', firmware: 'minorBehind',
    criticality: 'high', supply: 'inStock', vuln: 'medium', operatingHours: 39_000, mtbfHours: 130_000,
    source: 'manual', notes: 'GMP SCADA network core.'
  })
];

/** All demo fleets, keyed by domain. */
export const DEMO_SETS: Record<DemoDomain, Asset[]> = {
  semicon: SEMICON,
  agro: AGRO,
  pharma: PHARMA
};

/** Default demo fleet (offline-fallback seed) — the semiconductor plant. */
export const DEMO_ASSETS: Asset[] = SEMICON;
