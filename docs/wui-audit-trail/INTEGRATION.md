# Intégrer la page Audit Trail (`@visuelconcept/wui-audit-trail`) — mode source, Tier 1

Page **standalone WinCC OA WebUI** affichant un **tableau croisé (pivot) de
l'historique des éléments archivés NGA** d'un datapoint, piloté par un **popup de
configuration** (DP / période / colonnes / rafraîchissement) persisté dans un DP
**`AuditTrail_Config`**. C'est un **Tier 1** : **frontend uniquement** (pas de
module backend, pas de manager). Distribution **source auto-contenue** : le kit
partagé est **vendorisé** sous `audit-trail/_vendor/` (pas de prérequis
`@visuelconcept/wui-kit`), et la page est **compilée sur le workspace runtime de
la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. Aucun backend ni manager requis. `module.json.frontend.npmDeps` est vide : l'installeur n'ajoute aucune dépendance npm au workspace.

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
3. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

## Vérifier
1. Connecté → l'entrée **« Audit Trail »** apparaît dans le menu, `/audit-trail` charge la page.
2. Ouvrir le **popup de config** : choisir un DP archivé NGA, une période et des colonnes → le tableau pivot se remplit avec l'historique des éléments.
3. La config est persistée dans le DP **`AuditTrail_Config`** (rechargée au prochain affichage).

## Notes / sécurité
- Page **frontend uniquement** : aucune route `/api/*` exposée, aucun manager à démarrer.
- L'entrée de menu est en `permission: ["connected"]` → visible pour tout utilisateur connecté ; restreindre via la `permission` du fragment de menu si besoin.
- La page lit l'historique via les archives **NGA** du DP ciblé : s'assurer que l'archivage NGA est actif sur les éléments à auditer.
