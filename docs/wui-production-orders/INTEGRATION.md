# Intégrer la page Production Orders (`@visuelconcept/wui-production-orders`) — mode source, Tier 3

Page **standalone WinCC OA WebUI** pour gérer les **ordres de production (OF)**
sur **`/production-orders`** : les OF sont stockés dans un **unique DP liste JSON**
(`ProductionOrders_List`), avec CRUD + workflow de statut + un **Gantt echarts** et
un lien vers la flotte. Les KPI du haut de page sont calculés **côté serveur** par le
manager **`productionOrdersKpi`** (DP `ProductionOrders_Kpi`). C'est un **Tier 3**
sans backend HTTP : frontend + un **manager Node**. Distribution **source
auto-contenue** : le kit partagé / fleet-core est **vendorisé** sous `_vendor/`
(pas de prérequis `@visuelconcept/wui-kit`), et la page est **compilée sur le
workspace runtime de la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. Pas de `@visuelconcept/wui-webserver` requis : **aucun module backend** (pas de route `/api`).
3. Les deps npm de `module.json` (`@siemens/ix-echarts`, `three`) sont **installées automatiquement** dans le workspace par l'installeur.

## Installer (une commande)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet> --register-pmon
```
Exemple (WebDemo2) :
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
L'installeur :
1. copie la **source** (kit vendorisé) → `<workspace>/…/standalone-pages/` ;
2. insère l'**entrée de menu** → `menuconfig.jsonc` du workspace (idempotent) ;
3. installe **`@siemens/ix-echarts`** et **`three`** dans le workspace (pour que `build:pages` les bundle) ;
4. déploie le **manager `productionOrdersKpi`** → `<projet>/javascript/productionOrdersKpi/` + `npm install` ; avec `--register-pmon`, ajoute la ligne à `config/progs` ;
5. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Manager** : démarrer **`productionOrdersKpi`** dans la console WinCC OA (il `dpConnect` la liste des OF et recalcule le DP `ProductionOrders_Kpi`). Vérifier l'ordre/numéro du manager si pmon a été édité.
2. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

## Vérifier
1. Connecté → entrée **« Ordres de production »**, `/production-orders` charge la liste des OF.
2. Créer / modifier un OF (persiste dans `ProductionOrders_List`), faire avancer le statut → le **Gantt** se met à jour.
3. Manager `productionOrdersKpi` démarré → les **KPI du haut de page** (DP `ProductionOrders_Kpi`) se renseignent et se rafraîchissent.

## Notes / sécurité
- Pas de module backend ni de route `/api` : aucune surface HTTP à durcir côté webserver pour cette page.
- Le manager **`productionOrdersKpi`** a besoin de **`winccoa-manager`**, fourni par le runtime WinCC OA (pas dans le `package.json` du manager).
- Le manager lit/écrit uniquement les DP `ProductionOrders_List` / `ProductionOrders_Kpi` du projet ; aucun secret ni token n'est embarqué.
