# Intégrer la page Thermal Treatment Reports (`@visuelconcept/wui-thermal-reports`) — mode source, Tier 1

Page **standalone WinCC OA WebUI** de **rapports de traitement thermique**
(`/thermal-reports`) : un rapport par charge, avec paliers de recette + bande de
tolérance superposée à la **courbe réelle de température du four** (`dpGetPeriod`),
évaluation qualité/conformité, graphique echarts (bande) et impression. Stockage
**1 DP par rapport**. C'est un **Tier 1** : **frontend uniquement** (pas de module
backend, pas de manager Node). Distribution **source auto-contenue** : le kit
partagé est **vendorisé** sous `_vendor/` (pas de prérequis
`@visuelconcept/wui-kit`), et la page est **compilée sur le workspace runtime de
la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. Les deps npm frontend déclarées dans `module.json` (`@siemens/ix-echarts ~3.0.0`, `three ^0.169.0`) sont **installées automatiquement** dans le workspace par l'installeur — rien à ajouter à la main.

## Installer (une commande)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet>
```
Exemple (WebDemo2) :
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
L'installeur :
1. copie la **source** (kit vendorisé sous `_vendor/`) → `<workspace>/libs/default-components/src/lib/standalone-pages/` ;
2. insère l'**entrée de menu** → `menuconfig.jsonc` du workspace (idempotent) ;
3. installe les **deps npm frontend** (`@siemens/ix-echarts`, `three`) dans le workspace (pour que `build:pages` les bundle) ;
4. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

Aucun webserver à recompiler ni manager à démarrer : ce module est **frontend uniquement**.

## Vérifier
1. Connecté → l'entrée **« Rapports traitement thermique »** apparaît dans le menu.
2. `/thermal-reports` charge la liste des rapports ; ouvrir/créer un rapport affiche la courbe réelle du four (lue via `dpGetPeriod`) superposée à la bande de tolérance de la recette, avec le verdict qualité/conformité et l'impression.

## Notes / sécurité
- Module **frontend pur** : pas de surface réseau ajoutée (pas de route `/api/*`, pas de manager exposé). Rien à durcir côté backend.
- La page lit/écrit des DP via le canal WebUI standard (un DP par rapport) ; les droits sont ceux de l'utilisateur connecté du dashboard.
