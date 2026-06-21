# wui-camera-streams — notes métier & architecture

Page WebUI autonome **Flux caméras (RTSP)** (`/camera-streams`, entry `wui-camera-streams`, classe `WuiCameraStreams`, préfixe de sous-composants `cs-`). Tier **3** (frontend + module backend `/api/rtsp` + manager dédié `rtspProxy`). Modelée sur la page **remote-vnc** (même structure store / table / dialog / viewer / io).

## Domaine / objet

Gérer un catalogue de caméras IP **RTSP** et visualiser un flux **directement dans le navigateur** via le lecteur **JSMpeg** embarqué.

Le point clé métier : **un navigateur ne sait pas lire du RTSP** (contrairement au VNC, qui est du RFB bout-à-bout sur un simple tunnel TCP). Il faut donc un **transcodage côté serveur**. La solution retenue : un manager JS dédié qui s'appuie sur la lib npm `rtsp-relay` + `ffmpeg`, et un client **JSMpeg** (flux MPEG1-TS).

Deux entrées de menu : la liste, et une entrée masquée `/camera-streams/:streamid` (attribut `streamid`). Icône menuconfig `video-camera`, permission `connected`.

## Modèle de données (DPs)

- **Type DP** `RtspCamera_Stream` (Struct : `name` + `json`), préfixe d'instances `RtspCamera_`. Une caméra = un DP (`RtspCamera_<id>.json`). Création/lecture via l'API REST PARA, avec un repli **DEMO** hors-ligne (`DEMO_STREAMS`).
- **Modèle `CameraStream`** : `name`, `group`, `description`, `url`, `username`, `password`, `transport` (`'tcp'` | `'udp'`), `audio`, `maxWidth`, `frameRate`, `videoBitrate`, `autoReconnect`, `reconnectDelaySec`, `favorite`, `lastViewedAt`.
- Le store est une copie exacte du `ConnectionStore` de remote-vnc.
- **Les identifiants (username/password) sont stockés en clair dans le DP** (avertissement affiché dans le dialog). Ils ne sont jamais exposés au navigateur : c'est le manager qui les injecte dans l'URL RTSP côté serveur.

## Architecture 3 niveaux, MÊME ORIGINE

Tout passe par le webserver du dashboard pour éliminer le problème de **mixed-content** HTTPS (pas de port/certificat supplémentaire, héritage du TLS + auth du dashboard) :

```
Navigateur (JSMpeg)
  → wss://<dashboard>/api/rtsp/ws?id=<id>      (MÊME ORIGINE, TLS+auth du dashboard)
  → relais ws↔ws du webserver
  → ws://127.0.0.1:9999/api/rtsp/stream/<id>   (loopback uniquement)
  → manager rtspProxy (rtsp-relay + ffmpeg)
  → source RTSP
```

- Le manager **possède l'allow-list** (résolution `id → URL RTSP` à partir du DP) : pas de SSRF, le client n'envoie qu'un `id`.
- Le manager **bind 127.0.0.1 uniquement** : injoignable depuis le réseau, accessible seulement par le webserver.
- URL côté frontend : `streamWsUrl()` construit l'URL même-origine `${ws|wss}://${location.host}/api/rtsp/ws?id=`. `streamHost()` extrait l'hôte de l'URL par regex.

## Algorithmes / mécanismes clés

- **Un seul pull RTSP, diffusé à N clients** : `rtsp-relay` indexe les flux entrants **par URL** → un seul ffmpeg par URL, **compté par référence** (démarrage paresseux au 1er client, `SIGTERM` au dernier). C'est ce qui réalise « une seule connexion RTSP éclatée vers N clients » et « démarrage du flux au premier consommateur ». Vérifié E2E : 2 clients → toujours 1 seul ffmpeg.
- **Mapping options → flags ffmpeg** (`buildFlags`) : `-r` (frameRate), `-vf scale='min(w,iw)':-2` (maxWidth), `-b:v` (videoBitrate), audio `mp2` ou `-an`. Injection des identifiants dans l'URL par regex (`withCredentials`).
- **Compteur de clients connectés en direct** : le relais du webserver étant le point d'entrée même-origine de chaque viewer, il compte là (`Map<id,count>`, incrément après validation d'URL dans `startRelay`, décrément dans le `close` uWS, garde `counted`). Exposé via `GET /api/rtsp/clients` → `{ "<id>": <n> }`. La page le sonde toutes les 4 s et l'affiche dans une colonne « Clients » (point vert pulsant + compte si >0). Dégrade à « 0 » si l'endpoint répond 404.
- **Voyant de joignabilité (« État »)** : le manager exécute une **sonde ffmpeg cyclique** indépendante des clients (`-rtsp_transport <t> -i <url> -t 1 -an -f null -`, kill 8 s, cycle 25 s, concurrence 6) sur **toutes** les caméras (`dpNames('*','RtspCamera_Stream')`). Mesure la vraie joignabilité du flux, pas juste le port. Résultat dans `statusById`, exposé par `GET /api/rtsp/status` (manager) ; le webserver le relaie. La page le replie dans le même rafraîchissement 4 s ; `cs-stream-table` affiche une LED « État » (🟢/🔴/⚪ + tooltip).
- **Machine à états du viewer** (`cs-viewer`) : `new JSMpeg.Player(streamWsUrl(c), {...})` ; états idle/connecting/connected/reconnecting/disconnected/error pilotés par un **timer de vivacité sur les frames décodées** (JSMpeg n'a pas d'événement « connect » natif) + un timeout de connexion. Barre d'outils : retour / plein écran / stop / relancer.

## Backend / managers

**Manager `rtspProxy`** (`manager/rtspProxy/`, pmon `node | always`) :
- A son **propre `package.json` + `node_modules` local** : `express`, `express-ws`, **`rtsp-relay@1.9.0`** (qui embarque **`ffmpeg-static`** → ffmpeg.exe, **aucun ffmpeg système requis**). `winccoa-manager` est résolu via le `NODE_PATH` de WinCC OA (pas de copie locale).
- `require('rtsp-relay')(app)` → `proxy({url,transport,additionalFlags})(ws)`.
- Lit `RtspCamera_<id>.json`, injecte les creds, mappe les options vers les flags ffmpeg.
- Variables d'env : `RTSP_PROXY_PORT` (9999), `RTSP_PROXY_HOST` (127.0.0.1).

**Module backend `/api/rtsp`** (hébergé par `@visuelconcept/wui-webserver`, TS, uWS) :
- Relais **`rtspRelay.ts`** : `registerRtspRelay(app)` → `app.uwsApp.ws('/api/rtsp/ws', behavior)`. Comme `vncRelay.ts` de remote-vnc mais en **ws↔ws** (et non ws↔TCP) : ouvre un client `ws` amont vers le manager, pipe dans les deux sens, gère la backpressure (pause de `_socket` amont selon `getBufferedAmount` uWS). Nécessite la dép `ws`.
- `rtspController.ts` : construit l'URL `127.0.0.1:9999` (garde regex sur l'`id`), `health`, compteur de clients (`incrClient`/`decrClient`/`getClientCounts`), `fetchManagerStatus` (proxie `GET /status` du manager via `http.get`).
- `rtspRoute.ts` : `GET /health`, `GET /api/rtsp/clients`, `GET /api/rtsp/status`.

## Pièges / à savoir

- **Ne PAS passer `-rw_timeout` avant `-i`** pour une entrée RTSP → ffmpeg « Error opening input files: Option not found ». S'appuyer sur le timeout de kill du process à la place.
- **Quirk JSMpeg + rtsp-relay** : rtsp-relay envoie un en-tête `jsmp` de 8 octets avant le mpegts ; les JSMpeg modernes le sautent. Un `ETIMEDOUT` transitoire sur une 1ère connexion peut survenir sous cycles de test rapides (ffmpeg résiduel) — l'auto-reconnexion du viewer couvre ça.
- **Player JSMpeg** : `@cycjimmy/jsmpeg-player` v6 ne fournit pas de types → décl. ambiante `jsmpeg.d.ts` (export par défaut `JSMpeg` avec `.Player` / `.VideoElement`).
- **Sonde keyframe** : avec un GOP de 50 à 25 fps (keyframe toutes les 2 s), un test ffmpeg `-t 1` montre 0 frame ; utiliser `-t 3`.
- **Limite connue** : si le manager garde la ws ouverte après l'arrêt de ffmpeg (perte de source), le viewer reste bloqué en « reconnecting » sans fermeture WS → pas de reconnexion JSMpeg. Piste : que le manager ferme la ws client à la sortie de ffmpeg.
- **Vérif liveness sous Windows/Git Bash** : `tasklist` renvoie par intermittence des comptes de process à 0 erronés — utiliser `netstat -ano | grep LISTENING` et les logs comme source de vérité.
- **ACL** : les routes `/api/rtsp/*` sont actuellement en `fullAccess` comme les autres ponts (à resserrer).
- **Source de test locale** : MediaMTX (`bluenviron/mediamtx`) en RTSP-seul (`rtspTransports:[tcp]`, `:8554`, `paths: { all_others: }`, `user: any`) + publication d'une mire via le ffmpeg embarqué (`testsrc2 ... -c:v libx264 -tune zerolatency -g 50 -f rtsp`). Le flux public BigBuckBunny de streamlock est **mort** (ffmpeg lit 0 octet).
