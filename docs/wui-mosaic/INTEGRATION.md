# Intégrer la page Mosaïque (`@visuelconcept/wui-mosaic`) — mode source, Tier 1

Page **standalone WinCC OA WebUI** : un **mur d'affichage** libre (drag/resize)
qui embarque d'autres vues du dashboard en **iframes same-origin chromeless**.
C'est un **Tier 1 frontend-only** (pas de module backend, pas de manager).
Chaque mur est stocké dans un DP (`Mosaic_Board`) + une liste d'aperçu.
Distribution **source auto-contenue** : le kit partagé est **vendorisé** sous
`_vendor/` (pas de prérequis `@visuelconcept/wui-kit`), et la page est
**compilée sur le workspace runtime de la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. Aucun prérequis backend (page frontend-only). `module.json.frontend.npmDeps` est vide → l'installeur n'ajoute aucun package npm au workspace.

## Installer (une commande)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet>
```
Exemple (WebDemo2) :
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
L'installeur :
1. copie la **source** (kit vendorisé sous `_vendor/`) → `<workspace>/…/standalone-pages/` ;
2. insère les **entrées de menu** → `menuconfig.jsonc` du workspace (idempotent) ;
3. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

Pas de webserver à recompiler ni de manager à démarrer (page frontend-only).

## Vérifier
1. Connecté → l'entrée **« Mosaïque »** apparaît dans le menu, `/mosaic` charge la liste des murs.
2. Créer un mur (crée un DP `Mosaic_Board`), ajouter des tuiles → les vues embarquées s'affichent en iframes same-origin chromeless.

## Notes / sécurité
- Page **frontend-only** : aucune route `/api/*`, aucun manager — rien à durcir côté backend.
- Les iframes sont **same-origin** uniquement (vues du même dashboard, chromeless) : pas d'URL externe arbitraire embarquée.
- Rien ne stocke de secret côté page : les murs ne contiennent que des références aux vues internes (DP `Mosaic_Board`).
