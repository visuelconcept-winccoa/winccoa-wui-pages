# wui-mosaic — notes métier & architecture

## Domaine / objet

Page autonome **Mosaïque** (`/mosaic`, custom element `wui-mosaic`, classe `WuiMosaic`, préfixe des sous-composants `mo-`). C'est un **mur d'affichage** (display wall) configurable : chaque mosaïque est un canvas de *tuiles* (tiles), chaque tuile embarque une source dans un `<iframe>`.

- **Plusieurs mosaïques**, 1 DP chacune + une liste d'aperçu (pattern routeur du shell, comme machine-fleet-3d / remote-vnc).
- **Layout libre** : tuiles flottantes positionnées/dimensionnées librement (pas une grille fixe), avec drag + resize.
- **Lecture seule par défaut** : un mur d'affichage ne transmet pas les événements pointeur/clavier sauf si une tuile est explicitement marquée interactive.

**Types de source** (`TileKind`, ensemble ouvert) :
- `fleet-3d` — id d'atelier (`''` = vue overview).
- `remote-vnc` — id de connexion VNC, **toujours forcé en lecture seule** (toggle interactif désactivé/forcé-off dans le dialogue).
- `camera` — id de flux RTSP (embarque `/camera-streams/<id>`), DP type `RtspCamera_Stream` / préfixe `RtspCamera_`, sélection forcée depuis le catalogue comme VNC, **forcé en lecture seule**.
- `url` — **même origine uniquement** (URL externe refusée).

VNC et caméra sont **toujours** `!isInteractive` (exclus par `isInteractive`) → leurs barres d'outils sont masquées par l'injection lecture seule.

**Ajouter un nouveau type "choisi dans un catalogue, lecture seule"** = ajouter à `TileKind` + `KIND_LABELS` + `tileSrc` + `isInteractive`, plus un `SourceCatalog.listX()` et une liste `@property` propagée mosaic.ts → mo-tile-dialog (`renderPickSource` est générique sur options/label/pageName).

## Modèle de données (DPs)

- **1 DP par mosaïque**, type **`Mosaic_Board`** (Struct : String `name` + String `json`), préfixe `Mosaic_`.
- Le store (`data/mosaic-store.ts`) est une **copie exacte du pattern ConnectionStore de remote-vnc** :
  - PARA REST : `/api/para/dptype/create`, `/dp/create`, `/dp/set`, `DELETE /dp/:name`.
  - Liste via `WuiDpeService.listDatapoints`.
  - Lecture via `OaRxJsApi.dpGet` (`extractJsonString` fouille raw / array / `{value}`).
  - **Fallback offline en mémoire**, amorcé par `DEMO_MOSAICS`.
- `persist()` estampille `updatedAt` ; les mutations persistent immédiatement.

**Modèle objet** (`types.ts`) :
- `Tile` : kind / title / ref / url + **x/y/w/h en pourcentages du canvas (0–100)** + interactive / refresh.
- `Mosaic` : id / dp / name / description / tiles / updatedAt.
- Helpers : `blankTile`, `blankMosaic`, `tileSrc`, `isInteractive`, `tileKindLabel`, constantes MIN/DEFAULT de taille de tuile, `APP_SHELL`.

**Catalogue de sources** (`data/source-catalog.ts`) — helper de sélection lecture seule : liste les ateliers (`MachineFleet3D_Config`, on retire le préfixe `MachineFleet3D_`) et les connexions VNC (`RemoteVnc_Connection`, on retire `RemoteVnc_`) par `.name`. Best-effort : `[]` si offline → le dialogue retombe sur un champ id manuel.

## Algorithmes / mécanismes clés

### URL d'embarquement (hash routing)
Le SPA dashboard utilise le **hash routing** : le bootstrap déployé redirige `/` → `/data/dashboard-wc/index.html` **en préservant `location.hash`**. Toute vue interne s'embarque donc en `…/index.html#/<route>`.

`tileSrc()` (dans `types.ts`) construit l'URL via `embeddedViewUrl(route)` = `` `${APP_SHELL}${EMBED_QUERY}#${route}` `` avec `APP_SHELL='/data/dashboard-wc/index.html'` et `EMBED_QUERY='?embed=1'` :
- `?embed=1#/fleet-3d/<id|>`
- `?embed=1#/remote-vnc/<id>`
- `?embed=1#/camera-streams/<id>`
- l'URL brute telle quelle pour le type `url`.

### Mode chromeless / embed — réparti sur DEUX couches
Contrainte utilisateur : « ne change pas le code source du WebUI Runtime, seulement des options pour ma page ».
1. **Menu/header masqués par UN flag de shell** (une ligne) dans le fichier d'override du projet `webui-app-ix.ts` (compilé dans `entry/wui.js`) : `isEmbedded()` = `new URLSearchParams(location.search).has('embed')` ; `renderTemplate()` ne retourne qu'un `<div id="outlet" class="embed-outlet">` quand embarqué (pas de `wui-ix-template` / header / menu / `ix-application`). Robuste car l'outlet Vaadin n'a besoin que d'un élément `id="outlet"`. Rétrocompatible (pas de `?embed` → chrome complet).
2. **Tout le reste côté page** dans `mo-canvas.ts` (aucun autre changement runtime), via manipulation de l'iframe **même origine** sur `@load` + un poll borné (`FRAME_POLL_MS` / `MAX`, car la page routée et ses composants imbriqués rendent en async) :
   - **thème** : le chromeless perd le contrôleur de thème (il vivait dans `wui-ix-template`), donc `syncTheme()` copie tous les attributs `data-ix*` du `<html>` hôte vers le `<html>` de l'iframe + injecte `customstyles.css` ; un `MutationObserver` sur le `<html>` hôte re-propage au basculement de thème.
   - **masquer le nom de page** : `injectHideStyles()` crée une `CSSStyleSheet` **dans le realm de l'iframe** (`doc.defaultView.CSSStyleSheet` — les feuilles cross-realm sont rejetées) et l'**adopte récursivement** dans le document + chaque shadow root ouvert (`adoptInto`), règle `wui-content-header,wui-context-generator{display:none}`.
   - **lecture seule** : la même feuille masque aussi `.toolbar{display:none}` (attrape rv-viewer + mf-atelier-view + barres de page à travers les shadow roots imbriqués).
   - Les frames cross-origin lèvent une exception sur l'accès `contentDocument` → ignorées. Pas besoin de paramètre `ro` dans l'URL : la lecture seule est décidée côté page depuis `isInteractive(tile)`.

### Garantie lecture seule
`isInteractive(tile)` = `tile.interactive && kind !== 'remote-vnc'` → VNC n'est **jamais** interactif. Appliqué purement au niveau du mur via `pointer-events` de l'iframe : `none` sauf si interactif ; toujours `none` en mode édition ; `.canvas.dragging iframe{pointer-events:none!important}` pendant le drag. Ne touche **pas** la page remote-vnc ni son `viewOnly`.

### Snap sur grille (48×48)
- `GRID_DIVISIONS=48`, `GRID_PCT=100/48≈2.08%`. 48 se divise par 2/3/4/6/8/12/16/24 → demis/tiers/quarts/sixièmes/huitièmes snappent proprement. Pour retuner : changer la seule constante `GRID_DIVISIONS`.
- **Un seul `snapToGrid(v)=round(v/GRID_PCT)*GRID_PCT`** snappe à la fois positions de bord ET tailles sur les **lignes** de grille (live dans `computeBox` avant clamp ; committé dans `onUp` sans arrondi pour garder un pavage exact).
- Défauts exprimés en cellules pour que les tailles physiques survivent à un changement de `GRID_DIVISIONS` : `DEFAULT_CELLS=12` → 50%, `MIN_CELLS=4` → ≈16.7%. `blankTile` x/y=0 ; offset de cascade `=(n%6)*GRID_PCT`.
- **Grille visible = lignes fines très claires** (en mode `.canvas.editing` uniquement) : deux `linear-gradient` 1px (vertical + horizontal) avec `background-size:${GRID_PCT}%` inline, `background-position:0 0` (pas d'offset → évite la formule de % de background-position). Couleur `--mo-grid = color-mix(... soft-text 28%, transparent)`.

### Validation URL même origine
`isInternalUrl()` (`types.ts`) = `new URL(u, location.origin).origin === location.origin` : accepte relatif (`/…`, `#/…`, `page.html`) + absolu même-origine ; rejette host externe, `//host`, `data:` / `javascript:`. Appliqué dans le dialogue de tuile (erreur inline + save désactivé) ET dans `tileSrc` (externe → src vide → la tuile affiche « URL externe refusée »).

### Import / export
`mosaic/data/io.ts` (copie du pattern remote-vnc) : `exportJson(all)` / `exportMosaic(one)` téléchargent l'enveloppe `{kind:'mosaic-boards',version:1,mosaics:[…]}`. **`parseMosaics(text)` accepte un tableau nu, l'enveloppe, OU un objet mosaïque unique** (import d'une ou plusieurs), en coerçant chaque mosaïque et ses tuiles contre les défauts blank (valide `kind` contre un Set, ré-attribue un id `t-<i>` aux tuiles sans id). Import : si l'id existe → update, sinon `createMosaic`.

## Composants / fichiers

`standalone-pages/mosaic.ts` + dossier `mosaic/` :
- `types.ts` — modèle + helpers (voir ci-dessus).
- `data/mosaic-store.ts`, `data/demo-mosaics.ts` (2 murs de démo), `data/source-catalog.ts`, `data/io.ts`.
- `ui/` : `dialog-styles.ts` (overlay/panneau partagé), `mo-confirm-dialog`, `mo-mosaic-table` (liste d'aperçu : name / chips de sources / nb de tuiles / updated ; open/rename/delete), `mo-mosaic-dialog` (name + description), `mo-tile-dialog` (select de kind + dropdown catalogue OU id manuel + url + interactive/refresh ; toggle VNC désactivé), **`mo-canvas`** (le cœur : tuiles `%` absolues, drag par pointer-capture sur le header + resize par gripper bas-droite, commit du layout arrondi via `wui:layout` ; auto-reload par tuile via `setInterval` → `iframe.src=iframe.src`).

**Routage / shell** : `/mosaic` = overview (`mo-mosaic-table`) ; **`/mosaic/:mosaicid`** = affichage d'une mosaïque (`hidden:true` dans menuconfig, param → attribut `mosaicid` → `@property({attribute:'mosaicid'})`), avec un toggle d'édition en place **Modifier / Terminer**. Navigation via `RouterEvent` (`@wincc-oa/wui-models/events/router-event.js`). Menuconfig : icône `tiles`, permission `connected`.

## Pièges / à savoir

- **Tier 1, aucun backend ni manager** (cf. `module.json`) : toute la logique est côté frontend. Aucun module `/api`, aucun relais ws, aucun manager propre à cette page. (Les sources embarquées — VNC, RTSP — ont leurs propres backends, mais ils appartiennent à leurs pages respectives.)
- **CSP / iframes d'URL externe** : ce n'est PAS une limite de mosaic. Le `WuiCspService` (dans `wui.js`) injecte un `<meta>` CSP restrictif (`default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:`, sans `frame-src`) quand la option WebUI `allowExternalResources` est false (lue depuis `/WebUI_Settings` ; aussi forcée si le header CSP du serveur est restrictif). **Correctif** = mettre `allowExternalResources` dans la config serveur WebUI (`config/config`), puis redémarrer — c'est une option serveur, pas du code. **Caveat dur** : les sites publics (google) envoient leur propre `X-Frame-Options` / `frame-ancestors` → refusent l'embarquement quoi qu'il arrive ; seuls les sites intranet/propres sans ces headers s'embarquent (attention au cert auto-signé et au mixed-content). Les tuiles internes (même origine) ne sont jamais bloquées. Un reverse-proxy webserver (même origine + strip X-Frame-Options, avec allow-list anti-SSRF) reste un follow-up possible mais ne fera pas marcher les gros sites publics.
- **CSSStyleSheet cross-realm rejetée** : créer la feuille de style dans le realm de l'iframe (`doc.defaultView.CSSStyleSheet`), jamais depuis le document hôte.
- **Hide / read-only doivent traverser les shadow roots** : `adoptInto` adopte la feuille récursivement dans chaque shadow root ouvert (sinon les composants imbriqués gardent leur header/toolbar visibles).
- **Rendu async des pages routées** : utiliser un poll borné (`FRAME_POLL_MS`/`MAX`) après `@load`, pas une seule passe.
- **Le mode chromeless touche le bundle partagé** (`webui-app-ix.ts` → `entry/wui.js`) : tout changement de ce flag impose un rebuild app+SW cohérent et un **hard-refresh (Ctrl+F5) / clear du service worker** côté client après déploiement, car `entry/wui.js` a changé.
- **Edge auth** : un iframe embarqué non authentifié afficherait le login dans la tuile, puis `handleLogin` peut rediriger vers `POST_LOGIN_HOME` en perdant le deep-link. OK pour le cas normal connecté.
- **Règles de lint du repo** (mêmes que machine-fleet-3d) : noms de CustomEvent en littéraux string `^wui:[a-z]{3,}$` (donc `emitEdit`/`emitRemove` séparés, pas de nom d'event variable) ; `disconnectedCallback` public avant `updated` protégé (member-ordering) ; éviter le spread `[...map.keys()]` (delete pendant itération de Map est sûr) ; extraire les chaînes dupliquées en consts (`KIND_FLEET`/`KIND_VNC`/`KIND_URL`).
