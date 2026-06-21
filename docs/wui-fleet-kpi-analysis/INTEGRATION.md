# Intégrer la page Fleet KPI Analysis (`@visuelconcept/wui-fleet-kpi-analysis`) — mode source, Tier 3

Page **standalone WinCC OA WebUI** d'**analyse des KPI de parc** (`/fleet-kpi`) :
**disponibilité / TRS par machine** calculé sur le temps d'ouverture moins les
jours non travaillés (closures), restitué en **echarts**. Le TRS temps réel par
machine est produit par le **manager Node `kpiCalc`** ; la page le lit et
l'affiche. C'est un Tier 3 **sans module backend** : frontend + manager seulement.
Distribution **source auto-contenue** : le kit partagé (kit / fleet-core / ai-kit)
est **vendorisé** sous `_vendor/` (pas de prérequis `@visuelconcept/wui-kit`), et
la page est **compilée sur le workspace runtime de la cible** (bundle = bonne
version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. **Pas de module backend** : la page passe par le runtime WebUI standard pour
   dialoguer avec WinCC OA, donc **`@visuelconcept/wui-webserver` n'est pas
   requis** par cette page.
3. Les **dépendances npm frontend** (`@siemens/ix-echarts`, `three`) déclarées
   dans `module.json` sont **installées automatiquement** dans le workspace par
   l'installeur.

## Installer (une commande)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet> --register-pmon
```
Exemple (WebDemo2) :
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2 --register-pmon
```
L'installeur :
1. copie la **source** (kit vendorisé sous `_vendor/`) → `<workspace>/…/standalone-pages/` ;
2. insère l'**entrée de menu** (`/fleet-kpi`, masquée) → `menuconfig.jsonc` du workspace (idempotent par `routeId`) ;
3. installe **`@siemens/ix-echarts`** et **`three`** dans le workspace (pour que `build:pages` les bundle) ;
4. déploie le **manager `kpiCalc`** → `<projet>/javascript/kpiCalc/` (+ `npm install` si un `package.json` est livré) ; avec `--register-pmon`, ajoute la ligne à `config/progs` ;
5. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Manager** : démarrer **`kpiCalc`** dans la console WinCC OA (il calcule le TRS
   temps réel par machine que la page lit). Vérifier l'ordre/numéro du manager si
   pmon a été édité.
2. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**,
   recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul
   `Clear site data` le purge.

## Vérifier
1. Connecté → la page **« Analyse des KPI »** (`/fleet-kpi`) charge (atteinte
   depuis la vue d'ensemble du parc — l'entrée de menu est masquée).
2. Le manager **`kpiCalc`** tourne dans la console WinCC OA et alimente les DP de
   KPI ; les courbes de disponibilité / TRS par machine s'affichent (echarts).

## Notes / sécurité
- Cette page **ne monte aucune route `/api/*`** : pas de surface backend à
  durcir côté webserver.
- Le manager **`kpiCalc`** a besoin de **`winccoa-manager`**, **fourni par le
  runtime WinCC OA** (pas dans le `package.json` du manager).
- Le calcul du TRS dépend du temps d'ouverture et des **jours non travaillés
  (closures)** ainsi que des catégories de temps de cause : ces données doivent
  être présentes dans le projet pour que les KPI soient pertinents.
