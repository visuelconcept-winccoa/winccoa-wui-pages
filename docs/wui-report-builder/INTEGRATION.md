# Intégrer la page Report Builder (`@visuelconcept/wui-report-builder`) — mode source, Tier 1

Page **standalone WinCC OA WebUI** pour construire des **rapports à partir de
modèles** : pages `/report-builder` (liste) + `/report-builder/:reportid` (détail).
On remplit les données, on **recalcule les agrégations de datasets depuis les
archives**, on signe selon un **workflow multi-niveaux conditionné par une
checklist**, puis on verrouille + imprime. Chaque rapport est stocké dans un DP
`ReportBuilder_Report`. C'est un **Tier 1** : **frontend uniquement** (pas de
module backend, pas de manager). Distribution **source auto-contenue** : le kit
partagé est **vendorisé** sous `report-builder/_vendor/` (pas de prérequis
`@visuelconcept/wui-kit`), et la page est **compilée sur le workspace runtime de
la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. Aucun backend ni manager requis. La dépendance npm `@siemens/ix-echarts` (`~3.0.0`)
   déclarée dans `module.json` est **installée automatiquement dans le workspace**
   par l'installeur (pour que `build:pages` la bundle).

## Installer (une commande)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet>
```
Exemple (WebDemo2) :
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
L'installeur :
1. copie la **source** (kit vendorisé) → `<workspace>/…/standalone-pages/` ;
2. insère les **2 entrées de menu** → `menuconfig.jsonc` du workspace (idempotent par `routeId`) ;
3. installe **`@siemens/ix-echarts`** dans le workspace (pour que `build:pages` le bundle) ;
4. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

## Vérifier
1. Connecté → l'entrée **« Rapports »** apparaît dans le menu, `/report-builder` charge la liste des rapports.
2. Ouvrir/créer un rapport → `/report-builder/:reportid` charge le détail (remplissage, recalcul des datasets depuis les archives, signature multi-niveaux, verrouillage, impression).

## Notes / sécurité
- Page **frontend pure** : pas de route `/api/*` ni de manager exposé → pas de surface réseau ajoutée par ce module.
- Les rapports sont persistés en DP **`ReportBuilder_Report`** (un DP par rapport) ; les droits de lecture/écriture suivent donc les ACL WinCC OA habituelles sur ces DP.
- La signature multi-niveaux est conditionnée par la checklist côté UI ; le verrouillage final fige le rapport. À renforcer côté projet si une garantie serveur est requise (pas de manager de validation côté backend dans ce module).
