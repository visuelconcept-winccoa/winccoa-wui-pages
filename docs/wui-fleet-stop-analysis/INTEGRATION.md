# Intégrer la page Fleet Stop-Cause Analysis (`@visuelconcept/wui-fleet-stop-analysis`) — mode source, Tier 1

Page **standalone WinCC OA WebUI** d'**analyse des causes d'arrêts** (`/fleet-stops`) :
décomposition du temps d'arrêt (`dpGetPeriod` + algorithme par intervalles) ventilée
**par cause**, en onglets **table + ECharts**. C'est un **Tier 1** : **frontend
uniquement** (pas de module backend, pas de manager). Distribution **source
auto-contenue** : le kit partagé (`wui-kit`, `wui-fleet-core`) est **vendorisé** sous
`fleet-stop-analysis/_vendor/` (pas de prérequis `@visuelconcept/wui-kit`), et la page
est **compilée sur le workspace runtime de la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. **Aucun** module backend ni manager. Les deps npm front (`@siemens/ix-echarts`, `three`) sont **installées automatiquement dans le workspace** par l'installeur.

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
2. insère l'**entrée de menu** → `menuconfig.jsonc` du workspace (idempotent par `routeId`) ;
3. installe les **deps npm front** (`@siemens/ix-echarts`, `three`) dans le workspace (pour que `build:pages` les bundle) ;
4. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

## Vérifier
1. Connecté → la page **`/fleet-stops`** charge (entrée « Analyse des causes d'arrêts », normalement atteinte depuis la vue d'ensemble du parc — l'entrée de menu est `hidden`).
2. Sélectionner une période → la décomposition par cause s'affiche dans l'onglet **table** et le graphe **ECharts**.

## Notes / sécurité
- Page **frontend uniquement** : pas de route `/api/*` exposée, pas de manager à démarrer. Les données sont lues via la connexion WinCC OA existante du dashboard.
- L'entrée de menu est `hidden` (atteinte depuis la vue d'ensemble du parc) ; changer ce flag dans `frontend/menu.fragment.jsonc` si vous voulez l'exposer directement.
