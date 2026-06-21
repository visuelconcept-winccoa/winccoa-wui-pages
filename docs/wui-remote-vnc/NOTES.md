# wui-remote-vnc — notes métier & architecture

Page WebUI autonome **Connexions VNC distantes** (`/remote-vnc`, entry `wui-remote-vnc`, classe `WuiRemoteVnc`, préfixe des sous-composants `rv-`). Module **Tier 3** : frontend + module backend `/api/vnc` + manager `vncProxy`.

## Domaine / objet

Gérer un **catalogue de points d'accès VNC** et ouvrir une session VNC **directement dans le navigateur** grâce au client **noVNC** embarqué. Choix de conception retenus : noVNC in-browser + 1 DP par connexion + mot de passe stocké + statut « dernière connexion » (pas de lien flotte, pas de groupes/recherche au départ).

Navigation **maître/détail pilotée par le routeur shell** (même principe que `/fleet-3d/:atelier`) :
- `/remote-vnc` = la **liste** (table : étoile favori, endpoint, mode, dernière connexion, colonne LED « État » ; actions connecter/éditer/supprimer).
- `/remote-vnc/:connectionid` = le **visualiseur** `rv-viewer` (noVNC) de cette connexion — route deep-linkable par connexion, marquée `hidden:true` dans le menu (les deux routes pointent sur `wui-remote-vnc`).

Le paramètre arrive via l'attribut `connectionid` → `@property({attribute:'connectionid'}) connectionId` ; `selectedConnection()` se déduit de `connectionId` + `connections` (pas d'état « id sélectionné » interne). Connecter → `dispatchEvent(new RouterEvent('/remote-vnc/<id>'))` ; retour / suppression de la courante → `RouterEvent('/remote-vnc')`. L'ouverture (clic ou deep-link) horodate `lastConnectedAt` côté client via le store.

## Modèle de données (DPs)

- **1 DP par connexion**, type `RemoteVnc_Connection` (Struct : `name` + `json`). Nom de DP `RemoteVnc_<id>` sur `System1`.
- Pattern de store identique à AssetStore (asset-lifecycle / thermal-reports) : auto-création via PARA REST + fallback hors-ligne amorcé avec `DEMO_CONNECTIONS`.
- Modèle `VncConnection` (`types.ts`) : `name`/`host`/`port`/`password`/`description`/`group`/`viewOnly`/`shared`/`favorite`/`lastConnectedAt`, plus les paramètres de timeout/reconnexion : `connectTimeoutSec`/`autoReconnect`/`reconnectDelaySec`/`maxReconnectAttempts` (défauts **15 s / true / 5 s / 3** ; `maxReconnectAttempts:0` = illimité). `blankConnection()` fournit les valeurs par défaut.
- **Import / export** (`data/io.ts`) : enveloppe commune `{kind:'remote-vnc-connections',version,connections}` pour le catalogue complet et pour une connexion seule. `parseConnections` accepte un tableau nu, l'enveloppe ou un objet connexion unique ; l'import fusionne par `id` (mise à jour si existant, sinon création). `io.normalize` complète les défauts des anciens enregistrements.

## Architecture 3-tier (relais binaire brut)

Chaîne de bout en bout :
```
noVNC RFB (navigateur)
  → WebSocket wss://<dashboard>/api/vnc/ws?id=<connId>   (même origine)
  → relais webserver (websockify)
  → résout id → host:port via le manager VncProxy (vRPC)
  → socket TCP vers le serveur VNC, octets relayés dans les deux sens
```
Le protocole **RFB et l'auth VNC sont de bout en bout** : le relais n'est qu'un tuyau d'octets, et le **mot de passe est envoyé côté client par noVNC** (lu depuis le DP). Garder la résolution `id → host:port` côté serveur fait que le navigateur ne peut atteindre que des connexions **connues** (pas de proxy ouvert / SSRF).

## Backend / manager (Tier 3)

**Manager `vncProxy`** (`manager/vncProxy`, pmon `node | always`, idx 19 dans WebDemo1) — service vRPC **`VncProxy`** basé sur `winccoa-manager` Vrpc (`ServiceBase` + `registerFunction`, `ServiceContainer.startAllServices`, même moule que le manager productInfo). Deux méthodes :
- **`Resolve(id)`** → JSON `{ok,host,port,name}` : valide `id` (`^[A-Za-z0-9_-]{1,64}$`), lit `System1:RemoteVnc_<id>.json`, renvoie host/port (port 1..65535).
- **`Status()`** → JSON `{id:{reachable,checkedAt,detail}}` : expose le cache du **test de joignabilité TCP cyclique** (voir ci-dessous).

**Test de joignabilité** (dans le manager, indépendant des sessions ouvertes) : `net.connect host:port` (timeout 4 s, cycle 25 s, concurrence 8) sur **toutes** les connexions énumérées par `winccoa.dpNames('*','RemoteVnc_Connection')`. Répond seulement à « le socket configuré répond-il ? » — **pas de handshake RFB**. Résultat caché dans `statusById`.

**Module webserver `/api/vnc`** (module backend `remote-vnc`, hébergé par le webserver client, idx 13 dans WebDemo1) :
- `vncController` : `resolveVncTarget(id)` (stub vRPC vers `VncProxy.Resolve`, stub caché recréé en cas d'erreur) + `fetchVncStatus()` (vers `Status()`) + diagnostics `health`/`resolve`.
- `vncRoute` : `GET /health`, `GET /resolve?id=`, `GET /status`.
- **`vncRelay` = le websockify** : `registerVncRelay(app)` appelle `app.uwsApp.ws('/api/vnc/ws', behavior)`. UltimateExpress (sur uWebSockets.js) expose l'app uWS brute via **`app.uwsApp`** → WS binaire natif uWS, même port/TLS, **aucune dépendance `ws` npm**. Cycle : `upgrade` stocke `{id}` en userData ; `open` résout + `net.connect` + vide les octets client mis en file ; `message` **copie** l'ArrayBuffer (`Buffer.from(new Uint8Array(message))` — le message uWS n'est valide que pendant le callback) puis `tcp.write` ; `data` TCP → `ws.send(buf,true)` avec gestion du backpressure (`getBufferedAmount` > 8 Mo → `sock.pause()`, reprise sur `drain`) ; `close`/erreurs démontent tout. **`registerVncRelay` doit être appelé avant `listen`** (dans `defineRoutes()`).

## Frontend

`novnc.d.ts` = module ambiant `declare module '@novnc/novnc/core/rfb.js'` (noVNC ne livre pas de types). **rv-viewer** construit l'URL ws (`wss:`/`ws:` selon `location.protocol`), `new RFB(div, url, {shared, credentials:{password}})`, gère `viewOnly`/`scaleViewport` et les événements connect/disconnect/credentialsrequired/securityfailure ; barre d'outils = Ctrl+Alt+Suppr / plein écran / déconnecter / reconnecter.

**Machine à états reconnexion** : un `connectTimer` avorte une connexion bloquée → `scheduleReconnect` ; événement `disconnect` avec `clean===false` → reconnexion, `clean===true` / manuel / échec d'auth → arrêt. **Garde anti-rfb-périmé** : comparer le `rfb` capturé dans l'événement à `this.rfb` (le démontage met `this.rfb` à null d'abord pour ignorer son propre `disconnect`). La barre montre « Déconnecter » pendant l'activité (connecting/connected/reconnecting), sinon « Reconnecter » ; le bandeau affiche le compte à rebours de retry.

**Polling État** : `WuiRemoteVnc` interroge `GET /api/vnc/status` toutes les 5 s (connected/disconnectedCallback, `refreshStatus`) ; `rv-connection-table` affiche une colonne LED « État » (🟢 ok / 🔴 ko / ⚪ inconnu + tooltip raison + heure).

## Pièges / à savoir

- **noVNC épinglé à 1.4.0** (npmDep `@novnc/novnc: 1.4.0`, bundlé dans `remote-vnc.js`) — NE PAS monter en 1.7.0 :
  1. 1.7.0 utilise un **top-level await** (détection WebCodecs H264) que la cible vite des pages (es2020 / chrome87) rejette → build cassé ; 1.4.0 n'a pas de TLA.
  2. **Chemin d'import dépendant de la version** : 1.7.0 a `exports:"./core/rfb.js"` (bare `@novnc/novnc`) ; **1.4.0 n'a NI `exports` NI `main`** → importer le fichier directement `@novnc/novnc/core/rfb.js` (le nom du module dans le `.d.ts` doit correspondre).
- **Le message uWS n'est valide que pendant le callback** : toujours copier (`Buffer.from(new Uint8Array(message))`) avant tout usage asynchrone (`tcp.write`).
- **Backpressure obligatoire** sur le relais : surveiller `ws.getBufferedAmount()`, pauser le socket TCP au-delà du seuil (8 Mo), reprendre sur `drain` — sinon explosion mémoire sur les sessions denses.
- **`registerVncRelay` avant `listen`** ; l'interaction uWS (`app.uwsApp.ws`) vs UltimateExpress (`any('/*')`) est un risque à vérifier en priorité lors d'une nouvelle intégration.
- **Sécurité** : `/api/vnc/*` est non authentifié (`fullAccess`) comme les autres bridges, et l'upgrade WS contourne de toute façon l'ACL Express → à durcir avant production. Le **mot de passe est stocké en clair** dans le DP (et **exporté en clair** dans les fichiers d'import/export) — averti dans le dialogue.
- Le test de joignabilité ne valide **que le socket TCP**, pas l'auth ni le handshake RFB : un 🟢 ne garantit pas qu'une session aboutira.
- Helpers de paramètres résolus = **méthodes privées, pas des getters** (typescript-eslint member-ordering interdit les accesseurs privés après des méthodes publiques).
- Le `willUpdate` du dialogue rétro-remplit les défauts des anciens enregistrements via `{...blankConnection(), ...clone}`.
- Après modification du manager : redémarrer `vncProxy`. Pour activer ou rafraîchir `/api/vnc/*` (relais, `/health`, `/status`) : le webserver client doit être redémarré (le module backend ne sert ses routes qu'après redémarrage).
