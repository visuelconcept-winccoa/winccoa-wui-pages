/**
 * Domain model for the Mosaïque page.
 *
 * A *mosaic* is a free-layout display wall: a canvas holding any number of
 * *tiles*, each embedding one source in an `<iframe>`. Sources are existing
 * routable views of this same dashboard (a Machine-Fleet-3D atelier, a Remote
 * VNC viewer) or an arbitrary URL. Because the whole dashboard is a single-page
 * app served from `/data/dashboard-wc/index.html` with **hash-based** routing,
 * any internal view is embeddable as `…/index.html#/<route>` (see
 * {@link tileSrc}).
 *
 * Tiles are positioned freely as percentages of the canvas (resilient to canvas
 * resize). Each mosaic is persisted as one WinCC OA datapoint of type
 * `Mosaic_Board` — see {@link ./data/mosaic-store.ts}.
 *
 * **Read-only by design**: a mosaic is a *display* wall, so tiles do not forward
 * pointer/keyboard events by default. Remote-VNC tiles are forced non-interactive
 * (see {@link isInteractive}) so an embedded VNC session can never be controlled
 * from the wall — the "lecture seule obligatoire" requirement.
 */

/** Source kind backing a tile. */
export type TileKind = 'fleet-3d' | 'remote-vnc' | 'camera' | 'url';

/** A single tile (one embedded source) on a mosaic canvas. */
export interface Tile {
  /** Stable identifier, unique within the mosaic. */
  id: string;
  /** Which kind of source this tile embeds. */
  kind: TileKind;
  /** Display title shown in the tile header. */
  title: string;
  /**
   * Source reference:
   * - `fleet-3d`: atelier id (empty = the ateliers overview);
   * - `remote-vnc`: connection id;
   * - `url`: unused (see {@link url}).
   */
  ref: string;
  /** Embedded URL for the `url` kind. */
  url: string;

  /** Left edge, percentage of the canvas width (0–100). */
  x: number;
  /** Top edge, percentage of the canvas height (0–100). */
  y: number;
  /** Width, percentage of the canvas width (0–100). */
  w: number;
  /** Height, percentage of the canvas height (0–100). */
  h: number;

  /**
   * Allow pointer/keyboard interaction into the tile in display mode. Always
   * forced off for `remote-vnc` (read-only wall) — see {@link isInteractive}.
   */
  interactive: boolean;
  /** Auto-reload period in seconds (0 = no auto-reload). */
  refresh: number;
}

/** A mosaic board: a named canvas of tiles. */
export interface Mosaic {
  /** Stable identifier (slug); used as the route param and DP suffix. */
  id: string;
  /** Full backing DP name (e.g. "System1:Mosaic_x"); absent until persisted. */
  dp?: string;
  /** Display name. */
  name: string;
  /** Free-text description / notes. */
  description: string;
  /** The tiles composing the wall. */
  tiles: Tile[];
  /** ISO-ish local timestamp of the last save (empty = never). */
  updatedAt: string;
}

/** Base URL of the dashboard SPA shell (hash routing carries the route). */
export const APP_SHELL = '/data/dashboard-wc/index.html';
/**
 * Query flag that puts the shell in "chromeless" mode (no header/menu — handled
 * in `webui-app-ix.ts`), so an embedded internal view shows only its page content.
 *
 * It lives INSIDE the hash, *after* the route (`…index.html#/route?embed=1`), not
 * as a pre-hash `?embed` query. A pre-hash query is fragile: the root-path
 * redirect in `index.html` keeps only `location.hash`, and the SPA router rewrites
 * the URL — both drop a pre-hash `?embed`, leaving the tile showing the full app
 * chrome. In the hash region the flag survives the redirect (hash preserved) and
 * the router (which keeps the route's own query inside the hash).
 */
export const EMBED_QUERY = '?embed=1';

/** Build an embeddable, chromeless URL to an internal hash route (e.g. `/fleet-3d/x`). */
export function embeddedViewUrl(route: string): string {
  // Embed flag goes after the route, inside the hash — see EMBED_QUERY.
  const sep = route.includes('?') ? '&embed=1' : EMBED_QUERY;
  return `${APP_SHELL}#${route}${sep}`;
}

const FULL_PCT = 100;
/**
 * The canvas is a **48×48 grid** in each axis (≈2.08% per cell). 48 divides by
 * 2, 3, 4, 6, 8, 12, 16 and 24, so tiles still snap cleanly to halves, thirds,
 * quarters, sixths, eighths… with a fine, smooth step. Lower (24/12) for a
 * coarser/snappier grid.
 */
const GRID_DIVISIONS = 48;
/** New tile = this many cells square (24/48 == 50%). */
const DEFAULT_CELLS = 24;
/** Smallest tile = this many cells (8/48 ≈ 16.7%). */
const MIN_CELLS = 8;

/** Snap step for tile placement, in percent of the canvas (one grid cell). */
export const GRID_PCT = FULL_PCT / GRID_DIVISIONS;
/** Default size of a freshly added tile (percentage of canvas; whole grid cells). */
export const DEFAULT_TILE_W = DEFAULT_CELLS * GRID_PCT;
export const DEFAULT_TILE_H = DEFAULT_CELLS * GRID_PCT;
/** Smallest a tile may be dragged/resized to (percentage of canvas; whole cells). */
export const MIN_TILE_W = MIN_CELLS * GRID_PCT;
export const MIN_TILE_H = MIN_CELLS * GRID_PCT;

/**
 * Snap a percentage value to the nearest grid line. Used for both edge positions
 * and sizes, so tile corners always land on a grid line (and on a snap dot).
 */
export function snapToGrid(v: number): number {
  return Math.round(v / GRID_PCT) * GRID_PCT;
}

const KIND_LABELS: Record<TileKind, string> = {
  'fleet-3d': 'Parc machines 3D',
  'remote-vnc': 'VNC (lecture seule)',
  camera: 'Caméra (flux vidéo)',
  url: 'URL'
};

/** Human label for a tile kind. */
export function tileKindLabel(kind: TileKind): string {
  return KIND_LABELS[kind];
}

/** A blank tile with sensible defaults, positioned at the canvas origin. */
export function blankTile(): Tile {
  return {
    id: '',
    kind: 'fleet-3d',
    title: '',
    ref: '',
    url: '',
    x: 0,
    y: 0,
    w: DEFAULT_TILE_W,
    h: DEFAULT_TILE_H,
    interactive: false,
    refresh: 0
  };
}

/** A blank mosaic with no tiles. */
export function blankMosaic(): Mosaic {
  return { id: '', name: '', description: '', tiles: [], updatedAt: '' };
}

/**
 * Whether a tile forwards pointer/keyboard events in display mode. VNC and camera
 * tiles can never be interactive (read-only wall: VNC sessions, one-way video).
 */
export function isInteractive(tile: Tile): boolean {
  return tile.interactive && tile.kind !== 'remote-vnc' && tile.kind !== 'camera';
}

/**
 * Whether a `url`-tile target is allowed: only URLs that resolve to **this
 * server (same origin)** — relative paths (`/…`, `#/…`, `page.html`) or an
 * absolute URL on the dashboard's own origin. Any external host, protocol-
 * relative (`//host`) or non-http scheme (`data:`, `javascript:`) is refused.
 */
export function isInternalUrl(url: string): boolean {
  const u = url.trim();
  if (u === '') return false;
  try {
    return new URL(u, globalThis.location.origin).origin === globalThis.location.origin;
  } catch {
    return false;
  }
}

/**
 * Resolve a tile to its `<iframe>` source URL. Internal views go through the SPA
 * shell in chromeless mode (no header/menu — just the page); `url` tiles use
 * their raw URL verbatim.
 */
export function tileSrc(tile: Tile): string {
  switch (tile.kind) {
    case 'fleet-3d': {
      return embeddedViewUrl(tile.ref ? `/fleet-3d/${encodeURIComponent(tile.ref)}` : '/fleet-3d');
    }
    case 'remote-vnc': {
      return tile.ref ? embeddedViewUrl(`/remote-vnc/${encodeURIComponent(tile.ref)}`) : '';
    }
    case 'camera': {
      return tile.ref ? embeddedViewUrl(`/camera-streams/${encodeURIComponent(tile.ref)}`) : '';
    }
    case 'url': {
      return isInternalUrl(tile.url) ? tile.url.trim() : '';
    }
    default: {
      return '';
    }
  }
}
