// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Internationalisation for the Warehouse page (EN / FR / DE), following the
 * shared `lit-translate` singleton. `localizeDir(...)` in templates (reactive to
 * language change), `localize(...)` for plain-string attributes.
 */
import type { MultiLangString } from '@wincc-oa/wui-models/interfaces/multi-lang-string.js';
import { getLanguage } from '@wincc-oa/wui-i18n-shared/localize-base.js';

export { localize, localizeDir } from '@wincc-oa/wui-i18n-shared/localize-multilang.js';

export function ml(en: string, fr: string, de: string): MultiLangString {
  return { 'en_US.utf8': en, 'fr.utf8': fr, 'de.utf8': de };
}

/** Format an ISO timestamp as a short date-time in the active UI language. */
export function dateLabel(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(getLanguage());
}

export const MSG = {
  tabs: {
    plan: ml('Plan', 'Plan', 'Plan'),
    stock: ml('Stock', 'Stock', 'Bestand'),
    zones: ml('Zones', 'Zones', 'Zonen'),
    products: ml('Products', 'Produits', 'Produkte'),
    inventory: ml('Inventory', 'Inventaire', 'Inventur')
  },
  common: {
    add: ml('Add', 'Ajouter', 'Hinzufügen'),
    edit: ml('Edit', 'Éditer', 'Bearbeiten'),
    delete: ml('Delete', 'Supprimer', 'Löschen'),
    save: ml('Save', 'Enregistrer', 'Speichern'),
    cancel: ml('Cancel', 'Annuler', 'Abbrechen'),
    close: ml('Close', 'Fermer', 'Schließen'),
    back: ml('Back', 'Retour', 'Zurück'),
    search: ml('Search…', 'Rechercher…', 'Suchen…'),
    all: ml('All zones', 'Toutes les zones', 'Alle Zonen'),
    refresh: ml('Refresh', 'Rafraîchir', 'Aktualisieren'),
    offline: ml(
      'Demo data (backend read-only or offline) — changes are not persisted.',
      'Données de démo (backend en lecture seule ou hors ligne) — les modifications ne sont pas enregistrées.',
      'Demodaten (Backend schreibgeschützt oder offline) — Änderungen werden nicht gespeichert.'
    ),
    units: ml('units', 'unités', 'Einheiten')
  },
  warehouses: {
    add: ml('New warehouse', 'Nouvel entrepôt', 'Neues Lager'),
    open: ml('Open', 'Ouvrir', 'Öffnen'),
    zones: ml('zones', 'zones', 'Zonen'),
    locations: ml('locations', 'emplacements', 'Lagerplätze'),
    none: ml('No warehouses yet — create one to start.', 'Aucun entrepôt — créez-en un pour commencer.', 'Noch keine Lager — legen Sie eines an.'),
    deleteConfirm: ml(
      'Delete this warehouse with all its zones, locations and stock?',
      'Supprimer cet entrepôt avec toutes ses zones, emplacements et stocks ?',
      'Dieses Lager mit allen Zonen, Lagerplätzen und Beständen löschen?'
    ),
    notFound: ml('Warehouse not found.', 'Entrepôt introuvable.', 'Lager nicht gefunden.'),
    back: ml('All warehouses', 'Tous les entrepôts', 'Alle Lager')
  },
  plan: {
    hint: ml('Click a location to see its stock.', 'Cliquez sur un emplacement pour voir son stock.', 'Klicken Sie auf einen Lagerplatz, um dessen Bestand zu sehen.'),
    legend: ml('Occupancy', 'Occupation', 'Belegung'),
    legEmpty: ml('Empty', 'Vide', 'Leer'),
    legOk: ml('Normal', 'Normal', 'Normal'),
    legHigh: ml('High', 'Élevé', 'Hoch'),
    legFull: ml('Full', 'Plein', 'Voll'),
    legUncapped: ml('Occupied (uncapped)', 'Occupé (illimité)', 'Belegt (unbegrenzt)'),
    view2d: ml('2D', '2D', '2D'),
    view3d: ml('3D', '3D', '3D'),
    edit: ml('Edit layout', 'Éditer le plan', 'Layout bearbeiten'),
    done: ml('Done', 'Terminer', 'Fertig'),
    editHint: ml(
      'Drag zones and racks to move them; drag the corner handle to resize.',
      'Glissez les zones et racks pour les déplacer ; la poignée d’angle les redimensionne.',
      'Zonen und Regale ziehen zum Verschieben; Eckgriff zum Skalieren.'
    ),
    editHint3d: ml(
      'Drag a rack to move it on the floor. Left-drag orbits, wheel zooms, right-drag pans.',
      'Glissez un rack pour le déplacer au sol. Glisser = orbite, molette = zoom, clic droit = panoramique.',
      'Regal ziehen zum Verschieben. Ziehen = Orbit, Rad = Zoom, Rechtsklick = Schwenken.'
    ),
    noSelection: ml('No location selected.', 'Aucun emplacement sélectionné.', 'Kein Lagerplatz ausgewählt.'),
    capacity: ml('Capacity', 'Capacité', 'Kapazität'),
    occupancy: ml('Occupancy', 'Occupation', 'Belegung'),
    contents: ml('Contents', 'Contenu', 'Inhalt')
  },
  stock: {
    kpiSkus: ml('Stocked products', 'Produits en stock', 'Bevorratete Produkte'),
    kpiFill: ml('Overall occupancy', 'Occupation globale', 'Gesamtbelegung'),
    kpiUnder: ml('Below minimum', 'Sous le minimum', 'Unter Minimum'),
    kpiEmpty: ml('Empty locations', 'Emplacements vides', 'Leere Lagerplätze'),
    colProduct: ml('Product', 'Produit', 'Produkt'),
    colLocation: ml('Location', 'Emplacement', 'Lagerplatz'),
    colZone: ml('Zone', 'Zone', 'Zone'),
    colQty: ml('Qty', 'Qté', 'Menge'),
    colMinMax: ml('Min / Max', 'Mini / Maxi', 'Min / Max'),
    colStatus: ml('Status', 'Statut', 'Status'),
    addStock: ml('Add stock entry', 'Ajouter une entrée de stock', 'Bestandseintrag hinzufügen'),
    statusOk: ml('OK', 'OK', 'OK'),
    statusUnder: ml('Under min', 'Sous mini', 'Unter Min'),
    statusOver: ml('Over max', 'Sur maxi', 'Über Max'),
    statusEmpty: ml('Empty', 'Vide', 'Leer'),
    empty: ml('No stock matches the filter.', 'Aucun stock ne correspond au filtre.', 'Kein Bestand entspricht dem Filter.')
  },
  zones: {
    addZone: ml('Add zone', 'Ajouter une zone', 'Zone hinzufügen'),
    addLocation: ml('Add location', 'Ajouter un emplacement', 'Lagerplatz hinzufügen'),
    colCode: ml('Code', 'Code', 'Code'),
    colName: ml('Name', 'Nom', 'Name'),
    colType: ml('Type', 'Type', 'Typ'),
    colCapacity: ml('Capacity', 'Capacité', 'Kapazität'),
    colOccupancy: ml('Occupancy', 'Occupation', 'Belegung'),
    locations: ml('Locations', 'Emplacements', 'Lagerplätze'),
    noZones: ml('No zones yet — add one to start.', 'Aucune zone — ajoutez-en une pour commencer.', 'Noch keine Zonen — fügen Sie eine hinzu.'),
    noLocations: ml('No locations in this zone.', 'Aucun emplacement dans cette zone.', 'Keine Lagerplätze in dieser Zone.'),
    deleteZone: ml('Delete this zone and all its locations?', 'Supprimer cette zone et tous ses emplacements ?', 'Diese Zone und alle Lagerplätze löschen?'),
    deleteLocation: ml('Delete this location?', 'Supprimer cet emplacement ?', 'Diesen Lagerplatz löschen?')
  },
  products: {
    addProduct: ml('Add product', 'Ajouter un produit', 'Produkt hinzufügen'),
    colRef: ml('Ref.', 'Réf.', 'Ref.'),
    colName: ml('Name', 'Nom', 'Name'),
    colCategory: ml('Category', 'Catégorie', 'Kategorie'),
    colUnit: ml('Unit', 'Unité', 'Einheit'),
    colMinMax: ml('Min / Max', 'Mini / Maxi', 'Min / Max'),
    colStock: ml('In stock', 'En stock', 'Bestand'),
    noProducts: ml('No products yet — add one to start.', 'Aucun produit — ajoutez-en un pour commencer.', 'Noch keine Produkte — fügen Sie eines hinzu.'),
    deleteProduct: ml('Delete this product?', 'Supprimer ce produit ?', 'Dieses Produkt löschen?')
  },
  inventory: {
    newCampaign: ml('New campaign', 'Nouvelle campagne', 'Neue Kampagne'),
    colName: ml('Campaign', 'Campagne', 'Kampagne'),
    colZone: ml('Scope', 'Périmètre', 'Umfang'),
    colStatus: ml('Status', 'Statut', 'Status'),
    colCreated: ml('Created', 'Créée le', 'Erstellt'),
    colProgress: ml('Counted', 'Comptés', 'Gezählt'),
    colVariance: ml('Variance', 'Écart', 'Abweichung'),
    statusCounting: ml('Counting', 'Comptage', 'Zählung'),
    statusValidated: ml('Validated', 'Validée', 'Validiert'),
    open: ml('Open', 'Ouvrir', 'Öffnen'),
    validate: ml('Validate', 'Valider', 'Validieren'),
    validateConfirm: ml(
      'Validate the campaign? Counted quantities will be written to stock and the campaign closed.',
      'Valider la campagne ? Les quantités comptées seront écrites dans le stock et la campagne clôturée.',
      'Kampagne validieren? Gezählte Mengen werden in den Bestand geschrieben und die Kampagne geschlossen.'
    ),
    deleteCampaign: ml('Delete this campaign?', 'Supprimer cette campagne ?', 'Diese Kampagne löschen?'),
    wholeWarehouse: ml('Whole warehouse', 'Tout l’entrepôt', 'Gesamtes Lager'),
    colSystem: ml('System', 'Système', 'System'),
    colCounted: ml('Counted', 'Compté', 'Gezählt'),
    saveCounts: ml('Save counts', 'Enregistrer les comptages', 'Zählungen speichern'),
    noCampaigns: ml('No inventory campaigns yet.', 'Aucune campagne d’inventaire.', 'Noch keine Inventurkampagnen.'),
    countHint: ml(
      'Enter the physical count for each line. On validation the stock is set to the counted quantities.',
      'Saisissez le comptage physique de chaque ligne. À la validation, le stock est ajusté aux quantités comptées.',
      'Erfassen Sie die physische Zählung je Zeile. Bei der Validierung wird der Bestand auf die gezählten Mengen gesetzt.'
    )
  },
  fields: {
    name: ml('Name', 'Nom', 'Name'),
    warehouse: ml('Warehouse', 'Entrepôt', 'Lager'),
    code: ml('Code', 'Code', 'Code'),
    color: ml('Colour', 'Couleur', 'Farbe'),
    description: ml('Description', 'Description', 'Beschreibung'),
    zone: ml('Zone', 'Zone', 'Zone'),
    type: ml('Type', 'Type', 'Typ'),
    capacity: ml('Capacity (0 = uncapped)', 'Capacité (0 = illimitée)', 'Kapazität (0 = unbegrenzt)'),
    ref: ml('Reference', 'Référence', 'Referenz'),
    category: ml('Category', 'Catégorie', 'Kategorie'),
    unit: ml('Unit', 'Unité', 'Einheit'),
    minQty: ml('Minimum qty', 'Quantité mini', 'Mindestmenge'),
    maxQty: ml('Maximum qty (0 = none)', 'Quantité maxi (0 = aucune)', 'Höchstmenge (0 = keine)'),
    product: ml('Product', 'Produit', 'Produkt'),
    location: ml('Location', 'Emplacement', 'Lagerplatz'),
    quantity: ml('Quantity', 'Quantité', 'Menge'),
    posX: ml('Plan X', 'Plan X', 'Plan X'),
    posY: ml('Plan Y', 'Plan Y', 'Plan Y'),
    posW: ml('Width', 'Largeur', 'Breite'),
    posH: ml('Height', 'Hauteur', 'Höhe')
  },
  dialogTitles: {
    newWarehouse: ml('New warehouse', 'Nouvel entrepôt', 'Neues Lager'),
    editWarehouse: ml('Edit warehouse', 'Éditer l’entrepôt', 'Lager bearbeiten'),
    newZone: ml('New zone', 'Nouvelle zone', 'Neue Zone'),
    editZone: ml('Edit zone', 'Éditer la zone', 'Zone bearbeiten'),
    newLocation: ml('New location', 'Nouvel emplacement', 'Neuer Lagerplatz'),
    editLocation: ml('Edit location', 'Éditer l’emplacement', 'Lagerplatz bearbeiten'),
    newProduct: ml('New product', 'Nouveau produit', 'Neues Produkt'),
    editProduct: ml('Edit product', 'Éditer le produit', 'Produkt bearbeiten'),
    addStock: ml('Add / adjust stock', 'Ajouter / ajuster le stock', 'Bestand hinzufügen / anpassen'),
    newCampaign: ml('New inventory campaign', 'Nouvelle campagne d’inventaire', 'Neue Inventurkampagne')
  },
  locTypes: {
    rack: ml('Rack', 'Rack', 'Regal'),
    shelf: ml('Shelf', 'Étagère', 'Fach'),
    bin: ml('Bin', 'Bac', 'Behälter'),
    floor: ml('Floor', 'Au sol', 'Boden'),
    cold: ml('Cold storage', 'Froid', 'Kühllager')
  }
} as const;
