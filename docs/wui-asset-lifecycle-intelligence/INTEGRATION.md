# Intégrer la page Asset Lifecycle Intelligence (`@visuelconcept/wui-asset-lifecycle-intelligence`) — mode source, Tier 3

Page **standalone WinCC OA WebUI** (`/asset-lifecycle`) : modèle de domaine des
actifs + **moteur de scoring de risque composite** avec persistance DP, et
**recherche d'obsolescence/délai de livraison** (Siemens Product Information Hub).
C'est un **Tier 3 complet** : frontend + module backend `/api/product-info` + un
**manager MSA `productInfo`**. Distribution **source auto-contenue** : le
kit/fleet-core/ai-kit partagé est **vendorisé** sous `_vendor/` (pas de prérequis
`@visuelconcept/wui-kit`), et la page est **compilée sur le workspace runtime de la
cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. **`@visuelconcept/wui-webserver`** installé dans le projet : il héberge la route `/api/product-info` (découverte automatique des modules backend).

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
2. insère l'**entrée de menu** → `menuconfig.jsonc` du workspace (idempotent) ;
3. dépose le **module backend** → `customer-webserver/src/modules/asset-lifecycle-intelligence/` (route `/api/product-info`) ;
4. déploie le **manager `productInfo`** → `<projet>/javascript/productInfo/` + `npm install` ; avec `--register-pmon`, ajoute la ligne à `config/progs` ;
5. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Webserver** : `cd <projet>/javascript/customer-webserver && npm run build`, puis **redémarrer** le manager webserver (il auto-monte `/api/product-info`).
2. **Manager** : démarrer **`productInfo`** dans la console WinCC OA. Vérifier l'ordre/numéro du manager si pmon a été édité.
3. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas** ; seul `Clear site data` le purge.

## Vérifier
1. Connecté → entrée **« Intelligence du cycle de vie des actifs »**, `/asset-lifecycle` charge la page.
2. `GET https://<dashboard>/api/product-info/health` → réponse JSON de liveness (indique si le client MSA est disponible).
3. Ouvrir la fiche d'un actif → la recherche d'obsolescence/livraison (MLFB) interroge le PIH via le manager `productInfo`.

## Notes / sécurité
- Le module monte `/api/product-info/*` en `fullAccess` (démo) → restreindre l'`acl` dans `backend/modules/asset-lifecycle-intelligence/index.ts` avant prod.
- Le manager `productInfo` a besoin de `winccoa-manager`, **fourni par le runtime WinCC OA** (pas dans son `package.json`).
- ⚠️ **Clé API PIH** : la recherche Product Information Hub nécessite une clé d'API renseignée dans le DP **`ProductInfo_Config`** (ou via la variable d'environnement **`PRODUCT_INFO_API_KEY`**). **Aucune clé n'est livrée** — la lookup d'obsolescence/livraison reste inactive tant qu'elle n'est pas fournie.
