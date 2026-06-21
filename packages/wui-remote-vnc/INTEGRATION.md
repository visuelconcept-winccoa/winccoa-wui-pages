# Intégrer la page Remote VNC (`@visuelconcept/wui-remote-vnc`) — mode source, Tier 3

Page **standalone WinCC OA WebUI** pour gérer des **connexions VNC** (1 DP chacune)
et les ouvrir **dans le navigateur avec noVNC embarqué** (sans plugin). C'est un
**Tier 3 complet** : frontend + module backend `/api/vnc` (HTTP **+ relais
WebSocket↔TCP** `/api/vnc/ws` via `registerRaw`) + un **manager Node `vncProxy`**
(service vRPC qui résout un *id* de connexion → `host:port` depuis les DP
`RemoteVnc_`). Distribution **source auto-contenue** : le kit partagé est
**vendorisé** sous `_vendor/` (pas de prérequis `@visuelconcept/wui-kit`), et la
page est **compilée sur le workspace runtime de la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. **`@visuelconcept/wui-webserver`** installé dans le projet : il héberge la route `/api/vnc` ET le **relais ws brut** sur l'app uWebSockets (il fournit aussi `ws`). Son loader monte automatiquement `routes` **et** `registerRaw`.
3. Le dep npm `@novnc/novnc@1.4.0` (déclaré dans `module.json`) est **installé automatiquement** dans le workspace par l'installeur.

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
2. insère les **2 entrées de menu** (liste + détail `/:connectionid` masqué) → `menuconfig.jsonc` du workspace (idempotent par `routeId`) ;
3. installe **`@novnc/novnc@1.4.0`** dans le workspace (pour que `build:pages` le bundle) ;
4. dépose le **module backend** → `customer-webserver/src/modules/remote-vnc/` ;
5. déploie le **manager `vncProxy`** → `<projet>/javascript/vncProxy/` + `npm install` ; avec `--register-pmon`, ajoute la ligne à `config/progs` ;
6. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Webserver** : `cd <projet>/javascript/customer-webserver && npm run build`, puis **redémarrer** le manager webserver (il auto-monte `/api/vnc` + le relais `/api/vnc/ws`).
2. **Manager** : démarrer **`vncProxy`** dans la console WinCC OA (service vRPC qui résout id → host:port). Vérifier l'ordre/numéro du manager si pmon a été édité.
3. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas**.

## Vérifier
1. Connecté → entrée **« Connexions VNC distantes »**, `/remote-vnc` charge la liste.
2. `GET https://<dashboard>/api/vnc/health` → `{ ok, service:"vnc", … }`.
3. Ajouter une connexion (crée `RemoteVnc_<id>`, type `RemoteVnc_Connection`), l'ouvrir → noVNC se connecte via `/api/vnc/ws?id=<id>` (le relais ouvre le TCP vers le `host:port` résolu par `vncProxy`).

## Notes / sécurité
- Le navigateur ne nomme qu'un **id connu** ; c'est `vncProxy` qui détient le mapping id → `host:port` (pas d'URL/socket brute côté client → pas de SSRF / proxy ouvert).
- Le module monte `/api/vnc/*` en `fullAccess` (démo) → restreindre l'`acl` dans `backend/modules/remote-vnc/index.ts` avant prod.
- `winccoa-manager` est fourni par le runtime WinCC OA (pas dans le `package.json` du manager).
