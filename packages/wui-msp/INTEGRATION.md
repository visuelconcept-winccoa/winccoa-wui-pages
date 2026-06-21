# Intégrer la page MSP (`@visuelconcept/wui-msp`) — mode source, Tier 1

Page **standalone WinCC OA WebUI** « MSP » (coquille / shell) enregistrée sous
`/msp`. C'est un **Tier 1** : **frontend uniquement** — pas de module backend,
pas de manager. Distribution **source auto-contenue** : le kit partagé est
**vendorisé** sous `_vendor/` (pas de prérequis `@visuelconcept/wui-kit`), et la
page est **compilée sur le workspace runtime de la cible** (le bundle correspond
à la bonne version du runtime).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. Aucun backend ni manager requis ; aucune dépendance npm supplémentaire (`module.json` `frontend.npmDeps` est vide).

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
2. insère l'**entrée de menu** (`/msp`) → `menuconfig.jsonc` du workspace (idempotent par `routeId`) ;
3. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

## Vérifier
1. Connecté → l'entrée **« MSP »** apparaît dans le menu.
2. `/msp` charge la page (coquille).

## Notes / sécurité
- Page **frontend uniquement** : aucune route `/api/*` exposée, aucun manager à démarrer ni à enregistrer dans pmon.
- La permission de l'entrée de menu est `connected` (tout utilisateur authentifié) — restreindre dans `frontend/menu.fragment.jsonc` si besoin avant prod.
