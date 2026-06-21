# Intégrer la page PARA (`@visuelconcept/wui-para`) — mode source

Page **standalone WinCC OA WebUI** (arbre Type→DP→élément + édition/création/
renommage/suppression). Distribuée en **source** : elle est **compilée sur le
workspace runtime de la cible**, donc le bundle matche toujours la version du
runtime (un bundle de page est couplé à la carte d'imports du shell — c'est le
piège qu'on a rencontré : un `.js` pré-buildé d'une autre version ne va pas).

## Pré-requis
1. La cible a un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) qui build son dashboard — c'est le `--workspace`. (cf. process officiel, `dist-packages/README.md`.)
2. **`@visuelconcept/wui-webserver`** est installé dans le projet (fournit `/api/para` via l'auto-découverte de modules backend).

## Installer (une commande)
```bash
node install.mjs --workspace <workspace-runtime> --project <racine-projet-winccoa>
```
Exemple (cas WebDemo2) :
```bash
node install.mjs --workspace D:\WinCC_OA_Proj_321\WebDemo2\webui-workspace --project D:\WinCC_OA_Proj_321\WebDemo2
```
L'installeur :
1. copie la **source** de la page → `<workspace>/libs/default-components/src/lib/standalone-pages/` ;
2. insère l'entrée de menu → `<workspace>/apps/dashboard-wc/config/menuconfig.jsonc` (idempotent) ;
3. copie le **module backend** → `<projet>/javascript/customer-webserver/src/modules/para/` ;
4. lance **`build:pages`** dans le workspace avec `OUT_DIR=<projet>/data/dashboard-wc` → `para.js` compilé **contre le bon runtime** + `menuconfig.json` redéployé.

## Après l'install (obligatoire)
1. **Backend** : `cd <projet>/javascript/customer-webserver && npm run build`, puis **redémarrer** le manager webserver (il compile et auto-monte le module `/api/para`).
2. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, puis recharger (**connecté**).
   ⚠️ Le service-worker met `menuconfig.json` en cache → **`Ctrl+Shift+R` ne suffit PAS**, seul `Clear site data` purge. (C'est ce qui nous a bloqués.)

## Vérifier
1. Connecté → l'entrée **« Paramétrage »** apparaît, `/para` charge l'arbre des types.
2. `GET https://<dashboard>/api/para/health` → `{ ok, service:"para" }`.
3. Éditer une valeur / créer un DP → `POST /api/para/dp/set` (ou `/dp/create`) 200.

## Sécurité
Le module monte `/api/para/*` en `fullAccess` (démo). Avant prod, restreindre l'`acl`
dans `backend/modules/para/index.ts` (ex. `{ allowUsers: ['root','engineer'] }`).
La page est `permission: ["connected"]` (réservée aux utilisateurs connectés).
