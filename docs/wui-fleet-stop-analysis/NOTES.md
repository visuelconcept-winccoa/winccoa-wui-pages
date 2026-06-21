# wui-fleet-stop-analysis — notes métier & architecture

Page WebUI autonome **Analyse des causes d'arrêts** (`/fleet-stops`, route masquée), tier 1 (pur frontend, pas de backend ni de manager). Décompose le temps d'arrêt multi-machines par cause sur une période.

## Domaine / objet

- Analyse a posteriori des arrêts d'un parc de machines : pour chaque machine et chaque cause d'arrêt, on calcule le temps assigné, le temps d'arrêt total, et le nombre d'occurrences sur une période choisie.
- Accès depuis la vue **Machine Fleet 3D** : le bouton « Analyse des causes d'arrêts » de l'overview (`mf-atelier-overview`) émet `wui:analyze`, le shell `wui-machine-fleet-3d` déclenche `RouterEvent('/fleet-stops')`. Le bouton Retour de la page renvoie vers `RouterEvent('/fleet-3d')`.
- **C'est ici que vit l'éditeur du catalogue de causes d'arrêt** (déplacé depuis l'overview) : bouton de barre d'outils « Causes d'arrêt » (icône `alarm`) → dialogue `mf-stop-causes` (`.store` / `.canEdit` / `@wui:close`). À la fermeture, la page recharge le catalogue (`listStopCauses`) et **recalcule** l'analyse, car les classifications/libellés des causes influent sur le résultat. C'est la page principale de la fonction « causes d'arrêt ».

## Modèle de données (DPs)

- Pas de DP propre à cette page. Les données proviennent de l'**historique archivé** des DPEs des machines :
  - `stateDp` (état machine) et `stopCauseDp` (code cause) de chaque machine, fournis par la config d'atelier de `FleetStore` (réutilisé depuis machine-fleet-3d).
- Le **catalogue des causes** est lu via `FleetStore.listStopCauses()` (entrées avec libellé, classification, et un flag `isDefault`).
- Réutilise aussi `types.ts` de machine-fleet-3d.

## Algorithmes / formules clés

Cœur dans `engine.ts` (`analyseStopCauses`, fonction pure de requête historique + algorithme d'intervalles) :

- Pour chaque machine, requête de l'historique archivé de `stateDp` et `stopCauseDp` via `OaRxJsApi.dpGetPeriod(start, end, 0, dpe + ':_original.._value')`. Le **count `0` signifie TOUTES les valeurs de la période** (transmis tel quel à `dpGetPeriod` côté CTRL).
- On élargit la requête d'**une largeur de fenêtre avant `start`** pour connaître l'état/cause actif à la borne de début.
- Intervalles de **non-production** = état résolu `!== 'ok'` (warn + stop + maint comptent tous) ; les intervalles adjacents sont fusionnés.
- Pour chaque intervalle d'arrêt, partition par cause active :
  - **back-fill amont** : un trou avant la première cause → la première cause prend le début de l'arrêt (« ajuster au début de l'arrêt ») ;
  - **carry-forward** : report de la dernière cause connue ;
  - **troncature** à la fin de l'arrêt (gestion du recouvrement).
- Agrégats par cause : `assignedMs` (temps partitionné, dont la somme = durée totale de l'arrêt), `downtimeMs` (durée pleine de l'intervalle par cause distincte présente), `occurrences` (+1 par arrêt contenant la cause).
- Codes inconnus / hors catalogue → repliés sur l'entrée `isDefault` du catalogue (même logique que `formatStopCause`). Sans défaut et sans code → « Sans cause assignée ».
- **Filtres** : sélections multiples atelier/machine. Un ensemble de filtres **vide = « tout »** (le moteur traite un `Set` vide comme absence de filtre). Période par défaut : dernier mois.

## Pièges / à savoir

- **Prérequis runtime — archivage NGA** : les DPEs état/cause doivent être archivés NGA, sinon `dpGetPeriod` ne renvoie rien et la page affiche « Aucune donnée d'historique ». Les DPs MachineSim ne sont **pas** archivés par défaut → activer via le toggle d'archivage par machine (`FleetStore.setArchive`) ou la config NGA.
- **echarts non bundlé** : import nu `import * as echarts from 'echarts'`, externalisé via l'import map du shared-bundle (dans `export-echarts-entry`), résolu au runtime par le shell. `@siemens/ix-echarts` n'exporte que des helpers de thème (`registerTheme`), pas de composant → la page initialise echarts directement dans une `<div #chart>`.
- **Lit recrée `#chart` au changement d'onglet** : `renderChart()` doit `dispose()` puis ré-initialiser quand `chart.getDom() !== host`, faute de quoi le graphe se rattache à un nœud détaché.
- **Chunks partagés** : la page réutilise `FleetStore` / `types.ts` (et, via le dialogue `mf-stop-causes`, `dialog-styles` / `router-event`) de machine-fleet-3d ; rollup en extrait des **chunks partagés** importés par les deux pages. Leurs noms sont **dérivés du contenu et changent entre builds** → ne jamais les coder en dur ; vérifier les références `./chunks/...` de chaque page déployée. `three` n'est PAS dans le bundle de cette page (présent dans `npmDeps` car partagé/transitif via le store du parc).
