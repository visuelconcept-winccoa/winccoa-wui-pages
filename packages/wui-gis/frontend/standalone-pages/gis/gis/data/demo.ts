// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/* eslint-disable @typescript-eslint/no-magic-numbers, max-lines-per-function --
   This file IS data: WGS 84 coordinates and per-reading display precisions. Naming
   each latitude would obscure the map rather than explain it, and each site is one
   flat literal that reads as the site it describes. */

/**
 * Demo sites — the two flagship map experiences, seeded when the project has no
 * `GIS_Site` datapoint (or no writable backend) so the page is demonstrable on an
 * unprovisioned system.
 *
 * 1. **Water** — a drinking-water network over a lake catchment: abstraction,
 *    treatment, pumping, storage, then distribution through three sectors.
 * 2. **Smart city** — a town centre: districts as areas, with traffic lights, air
 *    quality, tunnel ventilation, street-lighting cabinets and EV chargers.
 *
 * Coordinates are real places (Annecy and Grenoble, France) so the OSM basemap
 * shows a plausible network instead of markers over open sea.
 *
 * Every live value binds to a `System1:ExampleDP_*` datapoint, which a new/example
 * WinCC OA project ships — so the demo actually moves. Those datapoints are ABSENT
 * from a production project: see
 * `docs/knowledge/project/webui-runtime-example-datapoints.md`. Rebinding them to
 * project datapoints is exactly what the asset inspector is for.
 */
import {
  AUTO_GROUP_ZOOM,
  blankReading,
  defaultBasemap,
  type Area,
  type Asset,
  type Connection,
  type ConnectionKind,
  type Layer,
  type Reading,
  type Route,
  type Site
} from '../types.js';

/** Area ids, named because every asset of an area repeats its id. */
const AREA_NORD = 'nord';
const AREA_CENTRE = 'centre';
const AREA_SUD = 'sud';
const AREA_HYPER = 'hyper-centre';
const AREA_PRESQUILE = 'presquile';
const AREA_VILLENEUVE = 'villeneuve';

/**
 * Asset ids, named because the network below references them by id as well — the same
 * reason the area ids above are named.
 */
const A_USINE = 'usine-traitement';
const A_CAPTAGE = 'captage-lac';
const A_FORAGE = 'forage-fier';
const A_POMPE_N = 'pompage-nord';
const A_POMPE_S = 'pompage-sud';
const A_RES_SEMNOZ = 'reservoir-semnoz';
const A_RES_PUISOTS = 'reservoir-puisots';
const A_RES_NORD = 'reservoir-nord';
const A_VANNE_N = 'vanne-nord-1';
const A_VANNE_C = 'vanne-centre-1';
const A_DEBIT_C = 'debitmetre-centre';
const A_DEBIT_S = 'debitmetre-sud';
const A_SONDE_S = 'sonde-chlore-sud';
const A_TUNNEL = 'tunnel-bastille';
const A_FEU_HUGO = 'feu-hugo';
const A_FEU_GARE = 'feu-gare';
const A_FEU_VILLENEUVE = 'feu-villeneuve';
const A_EP_CENTRE = 'ep-centre';
const A_EP_PRESQUILE = 'ep-presquile';
const A_LAMPE = 'lampe-berriat';
const A_IRVE_GARE = 'irve-gare';

/** Route ids, named because every segment of a line repeats its id. */
const R_ADDUCTION = 'adduction';
const R_REFOULEMENT = 'refoulement';
const R_AXE = 'axe-structurant';
const R_HTA = 'hta-eclairage';

/** The example datapoints the demo readings bind to (see the module docs). */
const DP_FLOW = 'System1:ExampleDP_Trend1.';
const DP_LEVEL = 'System1:ExampleDP_Arg1.';
const DP_PRESSURE = 'System1:ExampleDP_Arg2.';
const DP_QUALITY = 'System1:ExampleDP_Result.';
const DP_COUNT = 'System1:ExampleDP_Rpt1.';
const DP_POWER = 'System1:ExampleDP_Rpt2.';

/** Build a reading in one line — the demo declares dozens of them. */
function reading(
  id: string,
  dp: string,
  label: string,
  unit: string,
  decimals: number,
  onMap: boolean
): Reading {
  return { ...blankReading(), id, dp, label, unit, decimals, onMap };
}

/** Build an asset in one line, defaulting the parts most demo assets share. */
/**
 * Build a supervised link in one line. Its ends are asset **ids**, so the demo network
 * follows its markers when any of them is dragged.
 */
function link(
  id: string,
  name: string,
  kind: ConnectionKind,
  from: string,
  to: string,
  routeId: string,
  readings: Reading[] = []
): Connection {
  return {
    id,
    name,
    kind,
    from,
    to,
    via: [],
    routeId,
    areaIds: [],
    layerIds: [],
    dp: DP_FLOW,
    readings,
    link: '',
    notes: ''
  };
}

function asset(
  init: Partial<Asset> & Pick<Asset, 'id' | 'name' | 'kind' | 'lat' | 'lon'>
): Asset {
  return {
    areaIds: [],
    layerIds: [],
    dp: DP_LEVEL,
    readings: [],
    link: '',
    notes: '',
    ...init
  };
}

// --- 1. water ----------------------------------------------------------------

/** Distribution sectors of the water network (rough rings around Annecy). */
function waterAreas(): Area[] {
  return [
    {
      id: AREA_NORD,
      name: 'Secteur Nord',
      groupZoom: AUTO_GROUP_ZOOM,
      color: '#1a9be0',
      link: '',
      ring: [
        [6.078, 45.935],
        [6.155, 45.941],
        [6.168, 45.912],
        [6.084, 45.906]
      ]
    },
    {
      id: AREA_CENTRE,
      name: 'Secteur Centre',
      groupZoom: AUTO_GROUP_ZOOM,
      color: '#00b0a0',
      link: '',
      ring: [
        [6.084, 45.906],
        [6.168, 45.912],
        [6.163, 45.886],
        [6.086, 45.882]
      ]
    },
    {
      id: AREA_SUD,
      name: 'Secteur Sud',
      groupZoom: AUTO_GROUP_ZOOM,
      color: '#7d5bbe',
      link: '',
      ring: [
        [6.086, 45.882],
        [6.163, 45.886],
        [6.17, 45.852],
        [6.098, 45.848]
      ]
    }
  ];
}

function waterAssets(): Asset[] {
  return [
    asset({
      id: A_USINE,
      name: 'Usine de traitement',
      kind: 'treatment',
      lat: 45.9048,
      lon: 6.1005,
      areaIds: [AREA_CENTRE],
      dp: DP_QUALITY,
      // The plant is the site's process heart: its own single-line diagram and its
      // 3D twin are both worth reaching from the map.
      link: '/ampere/tgbt-usine',
      notes: 'Filtration + désinfection UV. Capacité nominale 1 200 m³/h.',
      readings: [
        reading('q', DP_FLOW, 'Q', 'm³/h', 0, true),
        reading('turb', DP_QUALITY, 'Turbidité', 'NFU', 2, true),
        reading('cl', DP_LEVEL, 'Cl₂', 'mg/L', 2, false)
      ]
    }),
    asset({
      id: A_CAPTAGE,
      name: 'Captage lac',
      kind: 'well',
      lat: 45.8862,
      lon: 6.1521,
      areaIds: [AREA_CENTRE],
      dp: DP_FLOW,
      notes: 'Prise d’eau brute, crépine à −18 m.',
      readings: [reading('q', DP_FLOW, 'Q', 'm³/h', 0, true)]
    }),
    asset({
      id: A_FORAGE,
      name: 'Forage du Fier',
      kind: 'well',
      lat: 45.9124,
      lon: 6.0884,
      areaIds: [AREA_NORD],
      dp: DP_LEVEL,
      readings: [
        reading('n', DP_LEVEL, 'Niveau', 'm', 2, true),
        reading('q', DP_FLOW, 'Q', 'm³/h', 0, false)
      ]
    }),
    asset({
      id: A_POMPE_N,
      name: 'Pompage Nord',
      kind: 'pump',
      lat: 45.9251,
      lon: 6.1347,
      areaIds: [AREA_NORD],
      dp: DP_PRESSURE,
      link: '/fleet-3d/pompage-nord',
      notes: '3 pompes, dont 1 en secours. Variateur sur P1 et P2.',
      readings: [
        reading('p', DP_PRESSURE, 'P', 'bar', 2, true),
        reading('q', DP_FLOW, 'Q', 'm³/h', 0, true),
        reading('kw', DP_POWER, 'P élec', 'kW', 1, false)
      ]
    }),
    asset({
      id: A_POMPE_S,
      name: 'Pompage Sud',
      kind: 'pump',
      lat: 45.8703,
      lon: 6.1448,
      areaIds: [AREA_SUD],
      dp: DP_PRESSURE,
      link: '/fleet-3d/pompage-sud',
      readings: [
        reading('p', DP_PRESSURE, 'P', 'bar', 2, true),
        reading('q', DP_FLOW, 'Q', 'm³/h', 0, true)
      ]
    }),
    asset({
      id: A_RES_SEMNOZ,
      name: 'Réservoir Semnoz',
      kind: 'tank',
      lat: 45.8709,
      lon: 6.1103,
      areaIds: [AREA_SUD],
      dp: DP_LEVEL,
      notes: 'Cuve 2 × 1 500 m³, cote de trop-plein 712 m NGF.',
      readings: [
        reading('n', DP_LEVEL, 'Niveau', '%', 1, true),
        reading('vol', DP_COUNT, 'Volume', 'm³', 0, false)
      ]
    }),
    asset({
      id: A_RES_PUISOTS,
      name: 'Réservoir des Puisots',
      kind: 'tank',
      lat: 45.8953,
      lon: 6.1052,
      areaIds: [AREA_CENTRE],
      dp: DP_LEVEL,
      readings: [reading('n', DP_LEVEL, 'Niveau', '%', 1, true)]
    }),
    asset({
      id: A_RES_NORD,
      name: 'Réservoir Nord',
      kind: 'tank',
      lat: 45.9312,
      lon: 6.1108,
      areaIds: [AREA_NORD],
      dp: DP_LEVEL,
      readings: [reading('n', DP_LEVEL, 'Niveau', '%', 1, true)]
    }),
    asset({
      id: A_VANNE_N,
      name: 'Vanne sectorisation N1',
      kind: 'valve',
      lat: 45.9188,
      lon: 6.1235,
      areaIds: [AREA_NORD],
      dp: DP_PRESSURE,
      readings: [reading('p', DP_PRESSURE, 'P', 'bar', 2, true)]
    }),
    asset({
      id: A_VANNE_C,
      name: 'Vanne sectorisation C1',
      kind: 'valve',
      lat: 45.8991,
      lon: 6.1288,
      areaIds: [AREA_CENTRE],
      dp: DP_PRESSURE,
      readings: [reading('p', DP_PRESSURE, 'P', 'bar', 2, true)]
    }),
    asset({
      id: A_DEBIT_C,
      name: 'Débitmètre Centre',
      kind: 'meter',
      lat: 45.8964,
      lon: 6.1401,
      areaIds: [AREA_CENTRE],
      dp: DP_FLOW,
      notes: 'Comptage de sectorisation — base du bilan de fuites.',
      readings: [
        reading('q', DP_FLOW, 'Q', 'm³/h', 1, true),
        reading('idx', DP_COUNT, 'Index', 'm³', 0, false)
      ]
    }),
    asset({
      id: A_DEBIT_S,
      name: 'Débitmètre Sud',
      kind: 'meter',
      lat: 45.8641,
      lon: 6.1312,
      areaIds: [AREA_SUD],
      dp: DP_FLOW,
      readings: [reading('q', DP_FLOW, 'Q', 'm³/h', 1, true)]
    }),
    asset({
      id: A_SONDE_S,
      name: 'Sonde Cl₂ Sud',
      kind: 'sensor',
      lat: 45.8577,
      lon: 6.1489,
      areaIds: [AREA_SUD],
      dp: DP_QUALITY,
      readings: [reading('cl', DP_QUALITY, 'Cl₂', 'mg/L', 2, true)]
    })
  ];
}

// --- 2. smart city ----------------------------------------------------------

/** Districts of the city centre (rough rings around Grenoble). */
function cityAreas(): Area[] {
  return [
    {
      id: AREA_HYPER,
      name: 'Hyper-centre',
      groupZoom: AUTO_GROUP_ZOOM,
      color: '#e26a1b',
      link: '',
      ring: [
        [5.7165, 45.1955],
        [5.7358, 45.1948],
        [5.7362, 45.1846],
        [5.7159, 45.1852]
      ]
    },
    {
      id: AREA_PRESQUILE,
      name: 'Presqu’île',
      groupZoom: AUTO_GROUP_ZOOM,
      color: '#00a1d2',
      link: '',
      ring: [
        [5.6942, 45.2118],
        [5.7148, 45.2094],
        [5.7121, 45.1978],
        [5.6928, 45.2001]
      ]
    },
    {
      id: AREA_VILLENEUVE,
      name: 'Villeneuve',
      groupZoom: AUTO_GROUP_ZOOM,
      color: '#8ab63f',
      link: '',
      ring: [
        [5.6982, 45.1698],
        [5.7188, 45.1682],
        [5.7205, 45.1571],
        [5.6996, 45.1588]
      ]
    }
  ];
}

function cityAssets(): Asset[] {
  return [
    asset({
      id: A_TUNNEL,
      name: 'Ventilation tunnel',
      kind: 'tunnel',
      lat: 45.1988,
      lon: 5.7241,
      areaIds: [AREA_HYPER],
      dp: DP_QUALITY,
      link: '/fleet-3d/tunnel',
      notes: '2 accélérateurs, asservis au taux de CO et à l’opacité.',
      readings: [
        reading('co', DP_QUALITY, 'CO', 'ppm', 1, true),
        reading('v', DP_FLOW, 'Vitesse air', 'm/s', 1, true),
        reading('kw', DP_POWER, 'P élec', 'kW', 1, false)
      ]
    }),
    asset({
      id: 'aq-centre',
      name: 'Qualité air — Victor Hugo',
      kind: 'air',
      lat: 45.1892,
      lon: 5.7238,
      areaIds: [AREA_HYPER],
      dp: DP_QUALITY,
      readings: [
        reading('no2', DP_QUALITY, 'NO₂', 'µg/m³', 0, true),
        reading('pm', DP_LEVEL, 'PM₁₀', 'µg/m³', 0, true)
      ]
    }),
    asset({
      id: 'aq-presquile',
      name: 'Qualité air — Presqu’île',
      kind: 'air',
      lat: 45.2041,
      lon: 5.7034,
      areaIds: [AREA_PRESQUILE],
      dp: DP_QUALITY,
      readings: [reading('no2', DP_QUALITY, 'NO₂', 'µg/m³', 0, true)]
    }),
    asset({
      id: A_FEU_HUGO,
      name: 'Carrefour Victor Hugo',
      kind: 'traffic',
      lat: 45.1901,
      lon: 5.7218,
      areaIds: [AREA_HYPER],
      dp: DP_COUNT,
      notes: 'Plan de feux adaptatif, priorité tramway.',
      readings: [reading('veh', DP_COUNT, 'Véh/h', '', 0, true)]
    }),
    asset({
      id: A_FEU_GARE,
      name: 'Carrefour Gare',
      kind: 'traffic',
      lat: 45.1918,
      lon: 5.7145,
      areaIds: [AREA_HYPER],
      dp: DP_COUNT,
      readings: [reading('veh', DP_COUNT, 'Véh/h', '', 0, true)]
    }),
    asset({
      id: A_FEU_VILLENEUVE,
      name: 'Carrefour Villeneuve',
      kind: 'traffic',
      lat: 45.1633,
      lon: 5.7089,
      areaIds: [AREA_VILLENEUVE],
      dp: DP_COUNT,
      readings: [reading('veh', DP_COUNT, 'Véh/h', '', 0, true)]
    }),
    asset({
      id: A_EP_CENTRE,
      name: 'Armoire EP Centre',
      kind: 'cabinet',
      lat: 45.1873,
      lon: 5.7281,
      areaIds: [AREA_HYPER],
      dp: DP_POWER,
      link: '/ampere/ep-centre',
      notes: '148 points lumineux, abaissement nocturne 23 h – 5 h.',
      readings: [
        reading('kw', DP_POWER, 'P', 'kW', 2, true),
        reading('h', DP_COUNT, 'Heures', 'h', 0, false)
      ]
    }),
    asset({
      id: A_EP_PRESQUILE,
      name: 'Armoire EP Presqu’île',
      kind: 'cabinet',
      lat: 45.2072,
      lon: 5.7062,
      areaIds: [AREA_PRESQUILE],
      dp: DP_POWER,
      readings: [reading('kw', DP_POWER, 'P', 'kW', 2, true)]
    }),
    asset({
      id: A_LAMPE,
      name: 'Éclairage Berriat',
      kind: 'light',
      lat: 45.1935,
      lon: 5.7089,
      areaIds: [AREA_PRESQUILE],
      dp: DP_POWER,
      readings: [reading('kw', DP_POWER, 'P', 'kW', 2, true)]
    }),
    asset({
      id: A_IRVE_GARE,
      name: 'Recharge Gare',
      kind: 'charger',
      lat: 45.1922,
      lon: 5.7132,
      areaIds: [AREA_HYPER],
      dp: DP_POWER,
      notes: '4 points 22 kW + 2 points 150 kW.',
      readings: [
        reading('kw', DP_POWER, 'P', 'kW', 1, true),
        reading('sess', DP_COUNT, 'Sessions', '', 0, false)
      ]
    }),
    asset({
      id: 'irve-villeneuve',
      name: 'Recharge Villeneuve',
      kind: 'charger',
      lat: 45.1615,
      lon: 5.7124,
      areaIds: [AREA_VILLENEUVE],
      dp: DP_POWER,
      readings: [reading('kw', DP_POWER, 'P', 'kW', 1, true)]
    }),
    asset({
      id: 'chauffe-mairie',
      name: 'Hôtel de ville',
      kind: 'building',
      lat: 45.1868,
      lon: 5.7331,
      areaIds: [AREA_HYPER],
      dp: DP_POWER,
      notes: 'GTB raccordée — chauffage, CTA, comptage.',
      readings: [
        reading('kw', DP_POWER, 'P', 'kW', 1, true),
        reading('t', DP_LEVEL, 'T° ambiante', '°C', 1, true)
      ]
    })
  ];
}

/** The two readings the water mains repeat, as their own helpers. */
const flow = (): Reading[] => [reading('q', DP_FLOW, 'Q', 'm³/h', 0, true)];
const pressure = (): Reading[] => [
  reading('p', DP_PRESSURE, 'P', 'bar', 1, true)
];

// --- the demo networks -------------------------------------------------------

/**
 * The water network as supervised links: the raw-water mains up to the treatment plant,
 * then the pumped mains out to the reservoirs, then distribution. Two named lines, because
 * that is how an operator talks about them.
 */
function waterRoutes(): Route[] {
  return [
    {
      id: R_ADDUCTION,
      name: 'Adduction',
      color: '#3ba1d9',
      kind: 'pipe',
      link: ''
    },
    {
      id: R_REFOULEMENT,
      name: 'Refoulement',
      color: '#00b3a4',
      kind: 'pipe',
      link: ''
    }
  ];
}

function waterConnections(): Connection[] {
  return [
    link(
      'add-captage',
      'Captage → Usine',
      'pipe',
      A_CAPTAGE,
      A_USINE,
      R_ADDUCTION,
      flow()
    ),
    link(
      'add-forage',
      'Forage → Usine',
      'pipe',
      A_FORAGE,
      A_USINE,
      R_ADDUCTION,
      flow()
    ),
    link(
      'ref-nord',
      'Usine → Pompage Nord',
      'pipe',
      A_USINE,
      A_POMPE_N,
      R_REFOULEMENT,
      pressure()
    ),
    link(
      'ref-sud',
      'Usine → Pompage Sud',
      'pipe',
      A_USINE,
      A_POMPE_S,
      R_REFOULEMENT,
      pressure()
    ),
    link(
      'ref-res-nord',
      'Pompage Nord → Réservoir Nord',
      'pipe',
      A_POMPE_N,
      A_RES_NORD,
      R_REFOULEMENT
    ),
    link(
      'ref-res-semnoz',
      'Pompage Sud → Réservoir Semnoz',
      'pipe',
      A_POMPE_S,
      A_RES_SEMNOZ,
      R_REFOULEMENT
    ),
    link(
      'ref-res-puisots',
      'Usine → Réservoir Puisots',
      'pipe',
      A_USINE,
      A_RES_PUISOTS,
      R_REFOULEMENT
    ),
    link(
      'dist-nord',
      'Réservoir Nord → Vanne Nord',
      'pipe',
      A_RES_NORD,
      A_VANNE_N,
      ''
    ),
    link(
      'dist-centre',
      'Réservoir Puisots → Vanne Centre',
      'pipe',
      A_RES_PUISOTS,
      A_VANNE_C,
      ''
    ),
    link(
      'dist-centre-2',
      'Vanne Centre → Débitmètre Centre',
      'pipe',
      A_VANNE_C,
      A_DEBIT_C,
      ''
    ),
    link(
      'dist-sud',
      'Réservoir Semnoz → Débitmètre Sud',
      'pipe',
      A_RES_SEMNOZ,
      A_DEBIT_S,
      ''
    ),
    link(
      'dist-sud-2',
      'Débitmètre Sud → Sonde chlore',
      'pipe',
      A_DEBIT_S,
      A_SONDE_S,
      ''
    )
  ];
}

/**
 * The city as supervised links: a structuring road axis through its signalled junctions,
 * and the feeder supplying the public-lighting cabinets.
 */
function cityRoutes(): Route[] {
  return [
    {
      id: R_AXE,
      name: 'Axe structurant',
      color: '#f0a30a',
      kind: 'road',
      link: ''
    },
    {
      id: R_HTA,
      name: 'Départ HTA éclairage',
      color: '#e2001a',
      kind: 'power',
      link: ''
    }
  ];
}

function cityConnections(): Connection[] {
  const traffic = (): Reading[] => [
    reading('n', DP_COUNT, 'Débit', 'véh/h', 0, true)
  ];
  return [
    link(
      'axe-1',
      'Gare → Victor Hugo',
      'road',
      A_FEU_GARE,
      A_FEU_HUGO,
      R_AXE,
      traffic()
    ),
    link(
      'axe-2',
      'Victor Hugo → Villeneuve',
      'road',
      A_FEU_HUGO,
      A_FEU_VILLENEUVE,
      R_AXE,
      traffic()
    ),
    link(
      'axe-tunnel',
      'Villeneuve → Tunnel Bastille',
      'road',
      A_FEU_VILLENEUVE,
      A_TUNNEL,
      R_AXE
    ),
    link(
      'hta-1',
      'Armoire Centre → Armoire Presqu’île',
      'power',
      A_EP_CENTRE,
      A_EP_PRESQUILE,
      R_HTA,
      [reading('p', DP_POWER, 'P', 'kW', 1, true)]
    ),
    link(
      'hta-2',
      'Armoire Presqu’île → Berriat',
      'power',
      A_EP_PRESQUILE,
      A_LAMPE,
      R_HTA
    ),
    link(
      'irve-feed',
      'Armoire Centre → IRVE Gare',
      'cable',
      A_EP_CENTRE,
      A_IRVE_GARE,
      ''
    )
  ];
}

/**
 * Information layers of the demo sites — classification, not geography: what an operator
 * wants to switch on and off while looking at the same map.
 */
function waterLayers(): Layer[] {
  return [
    { id: 'critique', name: 'Ouvrages critiques', color: '#e2001a' },
    { id: 'sectorisation', name: 'Sectorisation', color: '#3ba1d9' },
    { id: 'tranche-2', name: 'Tranche 2', color: '#f0a30a' }
  ];
}

function cityLayers(): Layer[] {
  return [
    { id: 'mobilite', name: 'Mobilité', color: '#f0a30a' },
    { id: 'environnement', name: 'Environnement', color: '#00b3a4' },
    { id: 'energie', name: 'Énergie', color: '#e2001a' }
  ];
}

// --- seeds -------------------------------------------------------------------

/**
 * The demo sites, freshly built on every call (the caller edits them in place when
 * running offline, so they must never share state between pages).
 */
export function demoSites(): Site[] {
  return [
    {
      id: 'reseau-eau',
      name: 'Réseau d’eau potable',
      description:
        'Captage, traitement, pompage et stockage, puis distribution en trois secteurs sectorisés. Les débitmètres de sectorisation servent de base au bilan de fuites.',
      category: 'Eau',
      center: { lat: 45.8975, lon: 6.1265 },
      zoom: 12,
      basemap: defaultBasemap(),
      groupZoom: AUTO_GROUP_ZOOM,
      areas: waterAreas(),
      assets: waterAssets(),
      layers: waterLayers(),
      routes: waterRoutes(),
      connections: waterConnections(),
      updatedAt: ''
    },
    {
      id: 'smart-city',
      name: 'Ville — hypervision',
      description:
        'Quartiers instrumentés : feux tricolores, qualité de l’air, ventilation de tunnel, armoires d’éclairage public et bornes de recharge.',
      category: 'Ville',
      center: { lat: 45.1885, lon: 5.7185 },
      zoom: 13,
      basemap: defaultBasemap(),
      groupZoom: AUTO_GROUP_ZOOM,
      areas: cityAreas(),
      assets: cityAssets(),
      layers: cityLayers(),
      routes: cityRoutes(),
      connections: cityConnections(),
      updatedAt: ''
    }
  ];
}
