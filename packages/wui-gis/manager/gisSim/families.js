// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * gisSim — the catalogue: WHAT a GIS object simulates.
 *
 * A GIS site (`libs/wui-gis`) stores assets with a `kind` and connections with their own
 * `kind`, and nothing else about their physics. This module turns that into a **family**:
 * a role in the network (source / consumer / transit / storage / inert) and the list of
 * values the object publishes, each with its label, unit, decimals and — for the ones that
 * deserve it — an alarm threshold.
 *
 * Two rules decide a family, in this order:
 *
 * 1. **`sim:famille=<name>` in the object's `notes`** — the escape hatch, because the GIS
 *    model has no field for "what this thing is beyond its glyph", and a demo sometimes
 *    needs one (see {@link directives}).
 * 2. **The kind crossed with the DOMAIN its links put it in.** `station` is the ambiguous
 *    case that forced this: wired with `power` connections it is a power plant, with `pipe`
 *    connections it is a pumping station. The links are the only evidence in the model, and
 *    using them means the same site drawn by hand comes out simulated correctly.
 *
 * Kept free of any WinCC OA dependency on purpose: the manager (`index.js`) requires it to
 * drive the datapoints, and `bind-site.js` requires it to WRITE the bindings into an
 * exported site — one catalogue, so the two can never disagree about an element name.
 */

// ---- datapoint naming (the contract with the site's bindings) ---------------

/**
 * One flat WinCC OA datapoint per simulated value: `GisSim_<assetId>_<element>`.
 *
 * Flat rather than one struct per asset, because of how the page resolves an alarm: it
 * widens `asset.dp` to its DATAPOINT (`bareDp`) and follows that DP's
 * `_alert_hdl.._act_state_color`. On a struct, that root is the struct node and would need
 * a summary-alert config; on a flat datapoint the alert sits exactly where the page looks.
 * It is also the shape the page's own demo sites bind to (`ExampleDP_*`).
 */
const ASSET_PREFIX = 'GisSim_';
/** Same, for a connection: `GisLink_<connectionId>_<element>`. */
const LINK_PREFIX = 'GisLink_';
/** System prefix written into the bindings; `''` for the local system. */
const SYSTEM = 'System1:';
/** State element (Int): 0 arrêt, 1 marche, 2 défaut, 3 maintenance. */
const EL_STATE = 'etat';
/** Fault element (Bool) — the one that carries the alert config, so the marker colours. */
const EL_FAULT = 'defaut';

/** Object states. `defaut` is raised by {@link STATE_FAULT} alone: a stop is not a fault. */
const STATE_OFF = 0;
const STATE_RUN = 1;
const STATE_FAULT = 2;
const STATE_MAINTENANCE = 3;

/** Roles in the network solve (see `network.js`). */
const ROLE_SOURCE = 'source';
const ROLE_SINK = 'sink';
const ROLE_TRANSIT = 'transit';
const ROLE_STORE = 'store';
/** Publishes values but exchanges nothing (an air-quality station, a sensor). */
const ROLE_INERT = 'inert';

/**
 * Daily profile a family's demand follows.
 *
 * `PROFILE_TRANSIT` exists because the electrical one does not fit ridership: a national load
 * curve never drops below ~65 % of its peak, while a metro at 4 a.m. carries almost nobody.
 * Reusing `jour` for a station made the night look like a rush hour.
 */
const PROFILE_DAY = 'jour';
const PROFILE_NIGHT = 'nuit';
const PROFILE_TRANSIT = 'transit';
const PROFILE_FLAT = 'plat';

/**
 * One simulated value.
 *
 * `from` = derived by the network solve (`flow`, `capacity`, `demand`, `load`, `coverage`,
 * `current`, `level`, `volume`, `netflow`, `opening`, `total`, and `ratio` of another
 * element named by `of`); otherwise `base`/`span` make it wander on its own. `scale` ties a
 * free value to the object actually running (a stopped pump has no discharge pressure),
 * `profile` ties it to the daily curve, and `route` ties it to the SERVICE of the line it
 * belongs to — `'traffic'` falls when the line is interrupted, `'delay'` rises.
 *
 * A `ratio` reads a value computed EARLIER IN THE SAME LIST, so it must be declared after
 * the element it divides.
 */
function value(el, label, unit, decimals, spec = {}) {
  return { el, label, unit, decimals, onMap: false, ...spec };
}

/** Ascending alarm: high is bad (1 threshold ⇒ alert, 2 ⇒ warning then alert). */
function high(...thresholds) {
  return { direction: 'ASC', thresholds };
}

/** Descending alarm: low is bad. */
function low(...thresholds) {
  return { direction: 'DESC', thresholds };
}

// ---- asset families --------------------------------------------------------

/**
 * What each family is and publishes. `capacity` (source / transit / storage) and `demand`
 * (consumer) are the DEFAULTS, in the family's own unit — a real figure belongs in the
 * object's notes as `sim:capacite=` / `sim:demande=`, which is how a demo carries the
 * installed power of an actual plant.
 */
const ASSET_FAMILIES = {
  'production-electrique': {
    label: 'Production électrique',
    role: ROLE_SOURCE,
    domain: 'electrique',
    capacity: 2800,
    voltageKv: 400,
    values: [
      value('puissance', 'Puissance', 'MW', 0, { from: 'flow', onMap: true }),
      value('capacite', 'Capacité dispo.', 'MW', 0, { from: 'capacity' }),
      value('charge', 'Facteur de charge', '%', 0, { from: 'load' }),
      value('tension', 'Tension', 'kV', 1, { base: 400, span: 6 }),
      value('frequence', 'Fréquence', 'Hz', 2, { base: 50, span: 0.06 })
    ]
  },
  'consommation-electrique': {
    label: 'Pôle de consommation',
    role: ROLE_SINK,
    domain: 'electrique',
    demand: 3000,
    profile: PROFILE_DAY,
    voltageKv: 225,
    values: [
      value('charge', 'Charge', 'MW', 0, { from: 'flow', onMap: true }),
      value('demande', 'Demande', 'MW', 0, { from: 'demand' }),
      value('couverture', 'Couverture', '%', 1, {
        from: 'coverage',
        alert: low(98)
      }),
      value('tension', 'Tension', 'kV', 1, { base: 225, span: 4 }),
      value('frequence', 'Fréquence', 'Hz', 2, { base: 50, span: 0.06 })
    ]
  },
  'poste-electrique': {
    label: 'Poste / armoire',
    role: ROLE_TRANSIT,
    domain: 'electrique',
    capacity: 2000,
    voltageKv: 225,
    values: [
      value('puissance', 'Puissance transitée', 'MW', 1, {
        from: 'flow',
        onMap: true
      }),
      value('charge', 'Charge', '%', 0, { from: 'load', alert: high(95) }),
      value('courant', 'Courant', 'A', 0, { from: 'current' }),
      value('tension', 'Tension', 'kV', 1, { base: 225, span: 4 })
    ]
  },
  captage: {
    label: 'Captage / forage',
    role: ROLE_SOURCE,
    domain: 'eau',
    capacity: 900,
    values: [
      value('debit', 'Débit', 'm³/h', 0, { from: 'flow', onMap: true }),
      value('capacite', 'Capacité', 'm³/h', 0, { from: 'capacity' }),
      value('niveau', 'Niveau nappe', 'm', 2, {
        base: 12,
        span: 1.5,
        alert: low(6, 4)
      }),
      value('qualite', 'Turbidité', 'NTU', 2, {
        base: 1.2,
        span: 0.8,
        alert: high(4)
      })
    ]
  },
  traitement: {
    label: 'Traitement',
    role: ROLE_TRANSIT,
    domain: 'eau',
    capacity: 1200,
    values: [
      value('debit', 'Débit traité', 'm³/h', 0, { from: 'flow', onMap: true }),
      value('charge', 'Charge', '%', 0, { from: 'load' }),
      value('qualite', 'Turbidité', 'NTU', 2, {
        base: 0.4,
        span: 0.3,
        alert: high(1.5)
      }),
      value('chlore', 'Chlore libre', 'mg/L', 2, { base: 0.35, span: 0.1 }),
      value('pression', 'Pression', 'bar', 2, { base: 3.2, span: 0.4 })
    ]
  },
  pompage: {
    label: 'Pompage',
    role: ROLE_TRANSIT,
    domain: 'eau',
    capacity: 700,
    values: [
      value('debit', 'Débit', 'm³/h', 0, { from: 'flow', onMap: true }),
      value('pression', 'Pression refoul.', 'bar', 2, {
        base: 5.5,
        span: 0.8,
        scale: true
      }),
      value('vitesse', 'Vitesse', 'tr/min', 0, {
        base: 1480,
        span: 120,
        scale: true
      }),
      value('courant', 'Courant', 'A', 1, {
        base: 42,
        span: 12,
        scale: true,
        alert: high(62)
      }),
      value('temperature', 'Température palier', '°C', 1, {
        base: 46,
        span: 10,
        scale: true,
        alert: high(75)
      })
    ]
  },
  stockage: {
    label: 'Stockage',
    role: ROLE_STORE,
    domain: 'eau',
    capacity: 800,
    /** Usable volume (m³) the level is integrated over. `sim:volume=` overrides it. */
    volume: 2500,
    values: [
      value('niveau', 'Niveau', '%', 1, {
        from: 'level',
        onMap: true,
        alert: low(25, 15)
      }),
      value('volume', 'Volume', 'm³', 0, { from: 'volume' }),
      value('debit', 'Débit net', 'm³/h', 0, { from: 'netflow' })
    ]
  },
  vanne: {
    label: 'Vanne',
    role: ROLE_TRANSIT,
    domain: 'eau',
    capacity: 600,
    values: [
      value('ouverture', 'Ouverture', '%', 0, { from: 'opening', onMap: true }),
      value('debit', 'Débit', 'm³/h', 0, { from: 'flow' }),
      value('pression', 'Pression', 'bar', 2, { base: 4.2, span: 0.6 })
    ]
  },
  comptage: {
    label: 'Comptage',
    role: ROLE_TRANSIT,
    domain: 'eau',
    capacity: 600,
    values: [
      value('debit', 'Débit', 'm³/h', 1, { from: 'flow', onMap: true }),
      value('indice', 'Index', 'm³', 0, { from: 'total' }),
      value('pression', 'Pression', 'bar', 2, { base: 3.6, span: 0.5 })
    ]
  },
  'consommation-eau': {
    label: 'Consommation (eau)',
    role: ROLE_SINK,
    domain: 'eau',
    demand: 250,
    profile: PROFILE_DAY,
    values: [
      value('debit', 'Débit soutiré', 'm³/h', 1, { from: 'flow', onMap: true }),
      value('demande', 'Demande', 'm³/h', 1, { from: 'demand' }),
      value('pression', 'Pression au point', 'bar', 2, {
        base: 3.4,
        span: 0.5,
        alert: low(2)
      })
    ]
  },
  eclairage: {
    label: 'Éclairage public',
    role: ROLE_SINK,
    domain: 'electrique',
    demand: 45,
    profile: PROFILE_NIGHT,
    voltageKv: 0.4,
    values: [
      value('puissance', 'Puissance', 'kW', 1, { from: 'flow', onMap: true }),
      value('niveau', 'Gradation', '%', 0, { from: 'opening' }),
      value('courant', 'Courant', 'A', 1, { base: 8, span: 3, scale: true }),
      value('energie', 'Énergie', 'kWh', 0, { from: 'total' })
    ]
  },
  'feu-tricolore': {
    label: 'Feu tricolore',
    role: ROLE_SINK,
    domain: 'transport',
    demand: 1.2,
    profile: PROFILE_DAY,
    values: [
      // The vehicle count follows the traffic curve, while the power draw below follows the
      // family's electrical day: a traffic light burns its lamps all night.
      value('trafic', 'Trafic', 'véh/h', 0, {
        base: 900,
        span: 400,
        profile: PROFILE_TRANSIT,
        onMap: true
      }),
      value('attente', 'Attente moyenne', 's', 0, {
        base: 35,
        span: 15,
        profile: PROFILE_TRANSIT
      }),
      value('puissance', 'Puissance', 'kW', 2, { from: 'flow' })
    ]
  },
  'borne-recharge': {
    label: 'Recharge VE',
    role: ROLE_SINK,
    domain: 'electrique',
    demand: 60,
    profile: PROFILE_DAY,
    values: [
      value('puissance', 'Puissance', 'kW', 1, { from: 'flow', onMap: true }),
      value('sessions', 'Sessions', '', 0, { base: 2, span: 2, profile: true }),
      value('energie', 'Énergie', 'kWh', 0, { from: 'total' })
    ]
  },
  'tunnel-routier': {
    label: 'Tunnel',
    role: ROLE_SINK,
    domain: 'transport',
    demand: 120,
    profile: PROFILE_DAY,
    values: [
      value('co', 'CO', 'ppm', 1, {
        base: 8,
        span: 5,
        profile: PROFILE_TRANSIT,
        onMap: true,
        alert: high(25, 40)
      }),
      value('ventilation', 'Ventilation', '%', 0, { base: 45, span: 30 }),
      value('trafic', 'Trafic', 'véh/h', 0, {
        base: 1200,
        span: 600,
        profile: PROFILE_TRANSIT
      }),
      value('puissance', 'Puissance', 'kW', 0, { from: 'flow' })
    ]
  },
  'qualite-air': {
    label: 'Qualité de l’air',
    role: ROLE_INERT,
    domain: 'transport',
    values: [
      value('no2', 'NO₂', 'µg/m³', 1, {
        base: 32,
        span: 18,
        profile: true,
        onMap: true,
        alert: high(40, 80)
      }),
      value('pm25', 'PM2.5', 'µg/m³', 1, {
        base: 14,
        span: 8,
        profile: true,
        alert: high(25)
      }),
      value('o3', 'O₃', 'µg/m³', 0, { base: 60, span: 25 })
    ]
  },
  /**
   * A passenger station — a metro one in particular, hence the platform temperature and the
   * CO₂: underground, those two are what the ventilation is judged on, and they are the
   * reason a station is supervised at all rather than merely drawn.
   */
  'station-transport': {
    label: 'Station voyageurs',
    role: ROLE_INERT,
    domain: 'transport',
    profile: PROFILE_TRANSIT,
    values: [
      value('affluence', 'Affluence', 'p/h', 0, {
        base: 1500,
        span: 700,
        profile: true,
        onMap: true
      }),
      value('temperature', 'Temp. quai', '°C', 1, {
        base: 24,
        span: 2.5,
        alert: high(28, 30)
      }),
      value('co2', 'CO₂', 'ppm', 0, {
        base: 700,
        span: 250,
        profile: true,
        alert: high(1000, 1500)
      }),
      value('retard', 'Retard moyen', 'min', 1, {
        base: 0.6,
        span: 1,
        route: 'delay',
        alert: high(4)
      })
    ]
  },
  mesure: {
    label: 'Mesure',
    role: ROLE_INERT,
    domain: '',
    values: [value('mesure', 'Mesure', '', 2, { base: 50, span: 20, onMap: true })]
  }
};

// ---- connection families ---------------------------------------------------

const LINK_FAMILIES = {
  'ligne-electrique': {
    label: 'Ligne électrique',
    capacity: 2400,
    voltageKv: 400,
    values: [
      value('flux', 'Flux', 'MW', 0, { from: 'flow', onMap: true }),
      value('charge', 'Charge', '%', 0, { from: 'load', alert: high(92) }),
      value('courant', 'Courant', 'A', 0, { from: 'current' })
    ]
  },
  canalisation: {
    label: 'Canalisation',
    capacity: 800,
    values: [
      value('debit', 'Débit', 'm³/h', 0, { from: 'flow', onMap: true }),
      value('charge', 'Charge', '%', 0, { from: 'load', alert: high(95) }),
      value('pression', 'Pression', 'bar', 2, { base: 4.5, span: 0.7 })
    ]
  },
  /**
   * A metro track section, underground by assumption: the tunnel temperature and the
   * traction voltage are what a section is supervised for, and both are absent from a
   * mainline `rail` section — which is why `metro` and `rail` are two families and not one.
   */
  'voie-metro': {
    label: 'Voie de métro',
    capacity: 24,
    profile: PROFILE_TRANSIT,
    values: [
      // The tunnel temperature is what goes on the map rather than the traffic: the route's
      // colour already says which line a section belongs to, while the temperature is the
      // reason an underground section is supervised at all.
      value('temperature', 'Temp. tunnel', '°C', 1, {
        base: 32,
        span: 4,
        onMap: true,
        alert: high(40, 45)
      }),
      value('tension', 'Tension 3e rail', 'V', 0, {
        base: 750,
        span: 18,
        scale: true,
        alert: low(690)
      }),
      value('trafic', 'Trafic', 'tr/h', 0, {
        base: 16,
        span: 5,
        profile: true,
        route: 'traffic'
      }),
      value('occupation', 'Occupation', '%', 0, { from: 'ratio', of: 'trafic' }),
      value('retard', 'Retard moyen', 'min', 1, {
        base: 0.6,
        span: 1,
        route: 'delay',
        alert: high(5)
      })
    ]
  },
  'voie-ferree': {
    label: 'Voie ferrée',
    capacity: 24,
    profile: PROFILE_TRANSIT,
    values: [
      value('trafic', 'Trafic', 'trains/h', 0, {
        base: 12,
        span: 6,
        profile: true,
        route: 'traffic',
        onMap: true
      }),
      value('occupation', 'Occupation', '%', 0, { from: 'ratio', of: 'trafic' }),
      value('retard', 'Retard moyen', 'min', 1, {
        base: 0.6,
        span: 1,
        route: 'delay',
        alert: high(5)
      })
    ]
  },
  voirie: {
    label: 'Voirie',
    capacity: 1800,
    values: [
      value('trafic', 'Trafic', 'véh/h', 0, {
        base: 1400,
        span: 700,
        profile: PROFILE_TRANSIT,
        route: 'traffic',
        onMap: true
      }),
      value('occupation', 'Occupation', '%', 0, { from: 'ratio', of: 'trafic' }),
      value('vitesse', 'Vitesse moyenne', 'km/h', 0, { base: 70, span: 25 })
    ]
  },
  liaison: {
    label: 'Liaison',
    capacity: 1000,
    values: [
      value('flux', 'Flux', '', 1, { from: 'flow', onMap: true }),
      value('charge', 'Charge', '%', 0, { from: 'load' })
    ]
  }
};

/** Which family a connection kind belongs to, and which domain it puts its ends in. */
const LINK_KINDS = {
  power: { family: 'ligne-electrique', domain: 'electrique' },
  cable: { family: 'ligne-electrique', domain: 'electrique' },
  pipe: { family: 'canalisation', domain: 'eau' },
  metro: { family: 'voie-metro', domain: 'transport' },
  rail: { family: 'voie-ferree', domain: 'transport' },
  road: { family: 'voirie', domain: 'transport' },
  generic: { family: 'liaison', domain: '' }
};

/**
 * Asset kind → family, per domain. `default` applies when the links say nothing (an asset
 * with no connection at all, or only `generic` ones).
 */
const KIND_FAMILIES = {
  station: {
    default: 'production-electrique',
    eau: 'pompage',
    transport: 'station-transport'
  },
  building: {
    default: 'consommation-electrique',
    eau: 'consommation-eau',
    transport: 'station-transport'
  },
  well: { default: 'captage' },
  treatment: { default: 'traitement' },
  pump: { default: 'pompage' },
  tank: { default: 'stockage' },
  valve: { default: 'vanne' },
  meter: { default: 'comptage', electrique: 'poste-electrique' },
  cabinet: { default: 'poste-electrique' },
  light: { default: 'eclairage' },
  traffic: { default: 'feu-tricolore' },
  charger: { default: 'borne-recharge' },
  tunnel: { default: 'tunnel-routier' },
  air: { default: 'qualite-air' },
  sensor: { default: 'mesure' },
  generic: { default: 'mesure' }
};

// ---- resolution ------------------------------------------------------------

/**
 * The `sim:` directives written in an object's `notes` — the only place the GIS model
 * leaves for per-object simulation facts:
 *
 *   `Puissance installée 5460 MW. sim:capacite=5460`
 *   `Arrêtée en 2020. sim:etat=0`
 *   `Station de correspondance. sim:affluence=2600`
 *
 * Reserved keys: {@link RESERVED_DIRECTIVES}. **Any other key naming an element of the
 * object's family sets that element's baseline** — `sim:affluence=2600` on a station,
 * `sim:temperature=38` on a tunnel section. Without it, two stations of the same family
 * would only differ by their wander, and a busy interchange would read like a quiet
 * terminus.
 */
function directives(notes) {
  const found = {};
  for (const [, key, raw] of String(notes ?? '').matchAll(
    /sim:([a-zA-Z]+)\s*=\s*([^\s;,]+)/g
  )) {
    found[key.toLowerCase()] = raw;
  }
  return found;
}

/** A directive read as a finite number, or `null`. */
function numberOf(raw) {
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Directive keys that mean something other than "the baseline of this element". */
const RESERVED_DIRECTIVES = new Set([
  'famille',
  'capacite',
  'demande',
  'volume',
  'etat'
]);

/**
 * The per-element baselines a set of directives asks for, and the keys that named nothing.
 *
 * A key is only accepted when the family actually publishes that element: a typo would
 * otherwise sit in the notes doing nothing at all, which is the kind of silence that costs
 * an afternoon.
 */
function baselinesOf(hints, family) {
  const bases = {};
  const unknown = [];
  const elements = new Set(family.values.map((spec) => spec.el));
  for (const [key, raw] of Object.entries(hints)) {
    if (RESERVED_DIRECTIVES.has(key)) continue;
    const parsed = numberOf(raw);
    if (elements.has(key) && parsed !== null) bases[key] = parsed;
    else unknown.push(key);
  }
  return { bases, unknown };
}

/**
 * The domain an asset's links put it in: the most frequent domain among the connections
 * touching it (`power` ⇒ electric, `pipe` ⇒ water, `metro`/`rail`/`road` ⇒ transport).
 * `''` when it has no link that says anything — the kind then decides alone.
 */
function domainOfLinks(assetId, connections) {
  const tally = new Map();
  for (const link of connections) {
    if (link.from !== assetId && link.to !== assetId) continue;
    const domain = LINK_KINDS[link.kind]?.domain ?? '';
    if (!domain) continue;
    tally.set(domain, (tally.get(domain) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [domain, count] of tally) {
    if (count > bestCount) {
      best = domain;
      bestCount = count;
    }
  }
  return best;
}

/** The family of one asset, and how it was decided (for the log). */
function familyOfAsset(asset, connections) {
  const hint = directives(asset.notes)['famille'];
  if (hint && ASSET_FAMILIES[hint]) return { name: hint, reason: 'notes' };
  const byKind = KIND_FAMILIES[asset.kind] ?? KIND_FAMILIES['generic'];
  const domain = domainOfLinks(asset.id, connections);
  const name = (domain && byKind[domain]) || byKind['default'];
  return { name, reason: domain ? `${asset.kind}+${domain}` : asset.kind };
}

/** The family of one connection. */
function familyOfLink(link) {
  const hint = directives(link.notes)['famille'];
  if (hint && LINK_FAMILIES[hint]) return { name: hint, reason: 'notes' };
  const name = (LINK_KINDS[link.kind] ?? LINK_KINDS['generic']).family;
  return { name, reason: link.kind };
}

// ---- names and readings ----------------------------------------------------

/** Datapoint names may only hold `[A-Za-z0-9_]`, so an id's dashes become underscores. */
function sanitize(id) {
  return String(id).replaceAll(/[^A-Za-z0-9_]/g, '_');
}

/** Datapoint stem of an asset (`GisSim_belleville`). */
function assetStem(assetId) {
  return `${ASSET_PREFIX}${sanitize(assetId)}`;
}

/** Datapoint stem of a connection (`GisLink_belleville_paris`). */
function linkStem(linkId) {
  return `${LINK_PREFIX}${sanitize(linkId)}`;
}

/**
 * The readings a family suggests, ready to drop into an `Asset` / `Connection`.
 *
 * The page keeps at most 8 readings per object (`normalize.ts`), which every family here
 * stays well below.
 */
function readingsOf(family, stem, system = SYSTEM) {
  return family.values.map((spec) => ({
    id: spec.el,
    dp: `${system}${stem}_${spec.el}`,
    label: spec.label,
    unit: spec.unit,
    decimals: spec.decimals,
    onMap: spec.onMap === true
  }));
}

/** The primary binding of an object: its `defaut` element, which carries the alert. */
function primaryDp(stem, system = SYSTEM) {
  return `${system}${stem}_${EL_FAULT}`;
}

module.exports = {
  ASSET_FAMILIES,
  ASSET_PREFIX,
  RESERVED_DIRECTIVES,
  baselinesOf,
  EL_FAULT,
  EL_STATE,
  LINK_FAMILIES,
  LINK_KINDS,
  LINK_PREFIX,
  PROFILE_DAY,
  PROFILE_FLAT,
  PROFILE_NIGHT,
  PROFILE_TRANSIT,
  ROLE_INERT,
  ROLE_SINK,
  ROLE_SOURCE,
  ROLE_STORE,
  ROLE_TRANSIT,
  STATE_FAULT,
  STATE_MAINTENANCE,
  STATE_OFF,
  STATE_RUN,
  SYSTEM,
  assetStem,
  directives,
  domainOfLinks,
  familyOfAsset,
  familyOfLink,
  linkStem,
  numberOf,
  primaryDp,
  readingsOf,
  sanitize
};
