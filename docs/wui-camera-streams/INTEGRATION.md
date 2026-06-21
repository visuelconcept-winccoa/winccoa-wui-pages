# Intégrer la page Camera Streams (`@visuelconcept/wui-camera-streams`) — mode source, Tier 3

Page **standalone WinCC OA WebUI** pour visualiser des **caméras RTSP** dans le
navigateur (JSMpeg) sans plugin. C'est un **Tier 3 complet** : frontend + module
backend `/api/rtsp` (HTTP **+ relais WebSocket** via `registerRaw`) + un **manager
Node `rtspProxy`** (ffmpeg). Distribution **source auto-contenue** : le kit partagé
est **vendorisé** sous `_kit/` (pas de prérequis `@visuelconcept/wui-kit`), et la
page est **compilée sur le workspace runtime de la cible** (bundle = bonne version).

## Pré-requis
1. Un **workspace WebUI Runtime** (`@wincc-oa/webui-runtime`) — le `--workspace`.
2. **`@visuelconcept/wui-webserver`** installé dans le projet : il héberge la route `/api/rtsp` ET le **relais ws brut** sur l'app uWebSockets (il fournit aussi `ws`). Son loader monte automatiquement `routes` **et** `registerRaw`.

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
2. insère les **2 entrées de menu** → `menuconfig.jsonc` du workspace (idempotent) ;
3. installe **`@cycjimmy/jsmpeg-player`** dans le workspace (pour que `build:pages` le bundle) ;
4. dépose le **module backend** → `customer-webserver/src/modules/camera-streams/` ;
5. déploie le **manager `rtspProxy`** → `<projet>/javascript/rtspProxy/` + `npm install` (ffmpeg-static, rtsp-relay) ; avec `--register-pmon`, ajoute la ligne à `config/progs` ;
6. lance **`build:pages`** (OUT_DIR=`<projet>/data/dashboard-wc`).

## Après l'install (obligatoire)
1. **Webserver** : `cd <projet>/javascript/customer-webserver && npm run build`, puis **redémarrer** le manager webserver (il auto-monte `/api/rtsp` + le relais `/api/rtsp/ws`).
2. **Manager** : démarrer **`rtspProxy`** dans la console WinCC OA (écoute `127.0.0.1:9999`). Vérifier l'ordre/numéro du manager si pmon a été édité.
3. **Navigateur** : DevTools → Application → Storage → **`Clear site data`**, recharger (**connecté**).
   ⚠️ Le SW cache `menuconfig.json` → **`Ctrl+Shift+R` ne suffit pas**.

## Vérifier
1. Connecté → entrée **« Flux caméras (RTSP) »**, `/camera-streams` charge la liste.
2. `GET https://<dashboard>/api/rtsp/health` → `{ ok, service:"rtsp", manager:"127.0.0.1:9999" }`.
3. Manager : `http://127.0.0.1:9999/health` → `{ ok, service:"rtsp", port:9999 }`.
4. Ajouter une caméra (crée `RtspCamera_<id>`), ouvrir le flux → la vidéo apparaît (le `/api/rtsp/ws` relaie vers rtspProxy, une seule connexion RTSP partagée).

## Notes / sécurité
- Le manager écoute **127.0.0.1 uniquement** (jamais exposé réseau) ; le navigateur ne nomme qu'un **id connu**, jamais une URL `rtsp://` brute (pas de SSRF / proxy ouvert).
- Le module monte `/api/rtsp/*` en `fullAccess` (démo) → restreindre l'`acl` dans `backend/modules/camera-streams/index.ts` avant prod.
- Port/hôte du manager configurables via `RTSP_PROXY_PORT` / `RTSP_PROXY_HOST` (doivent matcher `RtspController`).
- `winccoa-manager` est fourni par le runtime WinCC OA (pas dans le package.json du manager).
