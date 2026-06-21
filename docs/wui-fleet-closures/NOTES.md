# wui-fleet-closures — notes métier & architecture

Module de page WebUI WinCC OA, **Tier 1** (frontend pur, sans backend ni manager). Route `/fleet-closures`, composant `wui-fleet-closures`.

## Domaine / objet

Gestion des **jours non travaillés** (périodes de fermeture / *closures*) de la flotte de machines. Une période de fermeture est un intervalle [début, fin] rattaché à un **scope** : soit un atelier entier, soit une machine précise.

La page est une **page standalone à part entière** (et non plus un dialogue). Elle est atteinte depuis un bouton de l'en-tête de la vue d'ensemble Machine Fleet 3D. Historiquement, cette fonction vivait dans un dialogue `mf-kpi-closures-dialog` ouvert depuis la page KPI ; ce dialogue a été retiré. La page KPI (`fleet-kpi-analysis`) continue toutefois de **charger** les closures, car elles servent de base au **dénominateur du calcul TRS** (temps d'ouverture).

Interface : un tableau éditable unique avec une ligne par période :
- **scope** : `ix-select` dont la valeur est `a:<atelierId>` (atelier) ou `m:<machineId>` (machine)
- **début** (date + heure), **fin** (date + heure), **durée** (calculée), bouton de suppression
- bouton d'ajout de période dans le `tfoot`, avec un select de scope

Barre d'outils : Retour, filtre **Année** (par défaut année courante ; `ALL_YEARS = 0` = toutes), multi-select **Ateliers** + **Machines**, **Importer / Exporter** (JSON), **Enregistrer** (activé uniquement si `dirty`).

L'édition se fait sur une **copie de travail** `working: ClosureConfig` ; la persistance passe par `store.saveClosures`.

## Modèle de données

Les closures sont portées par un objet `ClosureConfig` chargé/sauvegardé via le store de la flotte (`store.saveClosures`). Le scope d'une période est encodé en chaîne : préfixe `a:` pour un atelier, `m:` pour une machine, suivi de l'identifiant.

Format d'import/export : **JSON** (union de périodes).

## Algorithmes / gestion des chevauchements

La logique de chevauchement est centralisée dans `fleet-kpi-analysis/closures.ts` :
- `rangesOverlap(...)` — test de chevauchement de deux intervalles
- `hasOverlap(existing, incoming)` — vrai si l'import recoupe l'existant
- `mergeClosures(existing, incoming, mode)` avec `mode` ∈ `'replace' | 'ignore'` :
  - `replace` — l'entrant l'emporte (les périodes importées écrasent celles qui se chevauchent)
  - `ignore` — on conserve l'existant et on n'ajoute que les périodes entrantes **sans chevauchement**

Comportement à l'import :
- si `hasOverlap` → dialogue de conflit proposant **Remplacer / Ignorer / Annuler**
- sinon → union silencieuse via `mergeClosures(..., 'ignore')`

## Architecture / intégration

- La page réutilise `pageStyles()` de `fleet-stop-analysis/styles.js`, complété par un `extraStyles()` local.
- La vue d'ensemble émet l'évènement `wui:closures` ; le shell (`machine-fleet-3d.ts`) déclenche `RouterEvent('/fleet-closures')`. C'est le même schéma que `wui:analyze` → `/fleet-stops` et `wui:kpi` → `/fleet-kpi`.
- Découverte automatique : les pages standalone sont auto-enregistrées par scan de répertoire (`discoverStandalonePages` dans la config de build). Déposer un `*.ts` dans `standalone-pages/` suffit à créer l'entrée de page ; aucune inscription manuelle dans le build.
- Route déclarée en `hidden: true` dans la config de menu.
- Dépendance npm déclarée dans `module.json` : `three` (^0.169.0).

## Pièges / à savoir

- **Page, pas dialogue** : ne pas confondre avec l'ancien `mf-kpi-closures-dialog`. La page KPI ne fait plus qu'utiliser les closures (dénominateur TRS), elle ne les édite plus.
- **Bouton Enregistrer gated sur `dirty`** : tant qu'aucune modification n'a été faite sur la copie `working`, l'enregistrement reste inactif.
- **Encodage du scope** en chaîne `a:`/`m:` : bien préserver le préfixe lors de la lecture/écriture des sélecteurs.
- **Pièges de lint rencontrés** :
  - `member-ordering` : `render` (public) doit précéder `firstUpdated` (protected)
  - `sonarjs/prefer-single-boolean-return` : combiner les gardes de filtre en un seul `return` booléen
  - `unicorn/no-array-for-each` : préférer un `for...of` sur `.entries()` (avec index) plutôt que `.forEach`
