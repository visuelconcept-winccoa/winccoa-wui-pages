# wui-fleet-kpi-analysis — notes métier & architecture

Page WebUI standalone **Analyse des KPI** (route `/fleet-kpi`, masquée dans le menu). Tier 3 : front + manager serveur `kpiCalc`, pas de module `/api` ni de relais ws.

## Domaine / objet

Calcul d'indicateurs de performance par machine (TRS basé sur la disponibilité, et côté manager MTBF/MTTR), sur une fenêtre de temps, à partir des historiques d'archives NGA. Deux usages :

- **La page `/fleet-kpi`** : analyse a posteriori sur une période choisie. Accès via le bouton « Analyse des KPI » de la vue 3D (`mf-atelier-overview` → événement `wui:kpi` → `RouterEvent('/fleet-kpi')` côté shell). Filtres date début/fin (défaut : mois dernier) + multi-select atelier/machine, bouton « Jours non travaillés ». Onglets **Tableau** (1 ligne/machine : barre TRS colorée par seuil, arrêt non planifié, arrêt planifié ; pied = TRS flotte pondéré) et **Graphique** (echarts : 1 barre/machine). Les machines sans historique archivé affichent « — » (`hasData=false`), jamais un 100 % trompeur.
- **Le TRS/KPI live par machine dans la vue 3D** : calculé en continu côté serveur par le manager `kpiCalc`, archivé pour le trending, affiché dans la bulle. (Note : ceci a **remplacé** l'ancien TRS live calculé côté client ; ne pas réintroduire `showTrs`/`trsWindow`/`refreshTrs`.)

La page partage l'**unique source de vérité** algorithmique avec la page d'analyse d'arrêts : elle réutilise `fleet-stop-analysis/engine.ts` (`queryHistory`, `nonProductionIntervals`, `partitionByCause`, `resolveGroup`) et les styles `fleet-stop-analysis/styles`.

## Modèle de données (DPs)

- **`MachineFleet3D_Closures`** — un seul DP JSON contenant les jours/périodes non travaillés (temps d'ouverture). Forme : `ClosureConfig { ateliers: {atelierId: Range[]}, machines: {machineId: Range[]} }`, `Range {start, end}` en datetime locale `yyyy-MM-ddTHH:mm`. L'ensemble effectif pour une machine = ranges de son atelier ∪ ranges machine (le niveau atelier s'applique à toutes ses machines). Le `FleetStore` le manipule comme un blob opaque (`unknown`) ; la page possède la forme via `closures.ts` (`normaliseClosures`). Édité dans `mf-kpi-closures-dialog`.
- **`MachineFleet3D_Kpi`** — type de DP créé par le manager `kpiCalc` (`dpTypeCreate` au démarrage). Éléments : `value` (Float, archivé NGA) + Strings `kpiType, machineId, machineName, window, unit, updatedAt`. Une instance par KPI configuré, nommée `MachineFleet3D_Kpi_<sanitize(machineId)>_<sanitize(kpiId)>` (sanitize = `[^A-Za-z0-9_] → _`).
- **Modèle de config KPI** (côté `MachineDef.kpiCalcs?: MachineKpi[]`) : `KpiType = 'TRS'|'MTBF'|'MTTR'` ; `MachineKpi {id, type, window, refreshMin, label?, showInBubble?, thresholdId?, archive?, archiveGroup?}`. Archivage par KPI : toggle `archive` (défaut true) + groupe NGA `archiveGroup`. Pas de KPI configuré par défaut → le manager reste inactif et la bulle n'affiche rien tant qu'un utilisateur n'a pas ajouté de KPI dans le dialogue machine.

## Algorithmes / formules clés

**TRS (page, disponibilité uniquement)** :
- temps d'ouverture = fenêtre − périodes non travaillées (closures)
- temps requis = ouverture − arrêts planifiés
- **Disponibilité = (requis − non planifiés) / requis** ; performance et qualité fixées à 100 %.

Classification de chaque sous-segment d'arrêt via le catalogue de causes (`resolveGroup().classification`) : `planned` → seau planifié, `production` → considéré disponible (ignoré), tout le reste (`unplanned` / cause inconnue / sans cause) → non planifié. **Un arrêt qui chevauche une période non travaillée n'est PAS compté.**

**MTBF / MTTR (manager, en minutes)** — calculés sur le **temps non planifié uniquement** ; les arrêts planifiés sont ignorés (comptés comme temps de fonctionnement, ne dégradent pas la métrique) :
- MTBF = (ouverture − non planifié) / N_pannes
- MTTR = non planifié / N_pannes
- une « panne » = un arrêt comportant au moins du temps non planifié.

**Affectation des causes dans le temps** (`partitionByCause` / `causeBoundaries`) : le segment initial sans cause d'un arrêt est rétro-rempli jusqu'à la première cause affectée, puis report-avant. Tant qu'aucune cause n'est affectée le temps compte **non planifié** ; dès qu'une cause est affectée, tout l'arrêt est reclassé planifié/non planifié depuis son début. `classify(code)` : `''`/null → unplanned, sinon `causeClass[code] || __default || unplanned`. Seul `planned` est soustrait du temps requis.

Seuils de couleur TRS : ≥ 90 % vert, ≥ 75 % ambre, sinon rouge (config atelier `trsThresholds` / `resolveTrsColor`, conservée comme référence par le KPI TRS).

## Backend / manager (`kpiCalc`)

Manager `manager/kpiCalc` (`kpiCalc/index.js`, JS pur, winccoa-manager ; pmon `node | always | 30 | 3 | 1`).

- Au démarrage : `dpTypeCreate` de `MachineFleet3D_Kpi`.
- Par KPI configuré : assure un DP `MachineFleet3D_Kpi_<machineId>_<kpiId>`, active l'archivage NGA sur `.value` (`_archive.._type=45`, `.1._type=15`, `.1._class=<groupe NGA>`, `.._archive=true`), calcule sur la fenêtre glissante du KPI, écrit valeur + métadonnées, le tout gated par `refreshMin`.
- Honore le toggle d'archivage par KPI : `archive===false` → `disableArchived` (pose `_archive.._archive=false`) ; sinon `ensureArchived(valueDpe, archiveGroup || <premier découvert>)`. Le Set `archived` est clé `"<dpe>|<group>"` / `"<dpe>|off"` pour ré-appliquer au toggle.
- Honore **closures** (`MachineFleet3D_Closures`, soustraites de chaque intervalle) ET l'affectation de causes (logique `partitionByCause` portée de la page d'analyse d'arrêts).
- Cadence : relit catalogue config + closures + liste KPI toutes les 60 s ; tick de base 15 s.

**Groupes d'archive = ACTIFS uniquement** : `FleetStore.listArchiveGroups()` ne retourne que les DPs `_NGA_Group` dont `.active === true`. Utilisé par l'onglet Archivage et par le sélecteur de groupe d'archive par KPI.

**Câblage bulle 3D** : la page s'abonne au DP `…_<kpiId>.value` de chaque KPI (kind `DpTarget` `'kpiCalc'`) ; `applyDpValue` stocke dans `machine.kpiCalcValues` et pousse via `updateMachineLive`. `label-manager.kpiCalcLines()` rend les KPI `showInBubble`. Le préfixe `KPI_CALC_PREFIX` / `sanitizeKpiId` côté vue **doit refléter exactement** le nommage de DP du manager.

## Pièges / à savoir

- **Prérequis runtime** : nécessite les historiques NGA `.state` (arrêts) et `.cause` (split planifié/non planifié). Sur ce projet `.cause` n'est actuellement PAS archivé → tout l'arrêt compte comme non planifié et planifié = 0.
- **Onglet « Affichage » unifié** (dialogue machine) : source de vérité unique `MachineDef.display?: DisplayEntry[]` (`{ref, inBubble, inPopup}`, ordre = index). `ref` = `state | stopCause | workOrder | operation | param:<key> | kpi:<id>`. `resolveDisplaySlots(m)` construit le catalogue ordonné ; les items absents de `display` sont ajoutés en fin (nouveaux params/KPIs apparaissent automatiquement). Les anciens toggles de visibilité par onglet ont été SUPPRIMÉS.
- **Closures opaques côté store** : le `FleetStore` garde `MachineFleet3D_Closures` comme blob `unknown` pour éviter une dépendance retour vers la page ; toute évolution de forme se fait dans `closures.ts`, pas dans le store.
- **Machines sans données** : afficher « — » (`hasData=false`), jamais 100 %.
