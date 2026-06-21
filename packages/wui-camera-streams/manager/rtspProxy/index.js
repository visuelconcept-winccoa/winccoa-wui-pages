'use strict';

/**
 * RTSP Proxy — WinCC OA JavaScript Manager that relays RTSP camera streams to
 * the browser over a WebSocket, so the WebUI "Flux caméras (RTSP)" page can view
 * any registered IP camera with no browser plugin.
 *
 * Architecture (this manager is the streaming BACKEND; the browser does NOT talk
 * to it directly — the dashboard webserver proxies a same-origin WebSocket to
 * it, see customer-webserver-example/src/rtspRelay.ts):
 *
 *   WebUI (JSMpeg) ──wss://<dashboard>/api/rtsp/ws?id=<id>──▶ dashboard webserver
 *                                                        │  ws↔ws proxy (same origin)
 *                                                        ▼
 *               ws://127.0.0.1:<PORT>/api/rtsp/stream/<id> ──▶ this manager
 *                                                        │  reads the RtspCamera_<id> DP
 *                                                        ▼
 *                                       resolves id → { url, transport, options }
 *                                                        │  ffmpeg (ffmpeg-static)
 *                                                        ▼
 *                          ONE RTSP connection to the camera, transcoded to
 *                          MPEG1-TS and fanned out to every connected client
 *                          (rtsp-relay shares one ffmpeg per URL — see below)
 *
 * Why this design:
 *   - "Activation du flux dès qu'il y a un consommateur" — rtsp-relay starts the
 *     ffmpeg process lazily on the FIRST WebSocket client and kills it (SIGTERM)
 *     when the LAST client disconnects (ref-counted in InboundStreamWrapper).
 *   - "Plusieurs clients → on distribue, pas plusieurs connexions RTSP" —
 *     rtsp-relay keys its inbound streams by URL, so N browser clients watching
 *     the same camera share a SINGLE RTSP pull + a SINGLE ffmpeg (one-to-many).
 *   - Keeping the id → URL mapping server-side (this manager owns the registry,
 *     the DPs created by the page) means the browser only ever names a *known*
 *     camera id, never a raw rtsp:// URL (no open proxy / SSRF).
 *
 * Security: the manager listens on 127.0.0.1 only — it is reachable solely from
 * the dashboard webserver running on the same host, never from the network.
 * Browser TLS / authentication are handled by the dashboard (same-origin proxy).
 *
 * Register in config/progs, e.g.:
 *   node | always | 30 | 3 | 5 |rtspProxy/index.js
 *
 * Configuration (optional, via env):
 *   - RTSP_PROXY_PORT       listen port (default 9999) — must match the webserver
 *                           proxy target (RtspController.MANAGER_PORT).
 *   - RTSP_PROXY_HOST       bind address (default 127.0.0.1).
 *
 * Dependencies (installed locally in this folder — see package.json):
 *   express, express-ws, rtsp-relay (bundles ffmpeg-static — no system ffmpeg).
 *
 * After editing this file, restart the rtspProxy manager.
 */
const { spawn } = require('node:child_process');
const express = require('express');
const ffmpegPath = require('ffmpeg-static');
const { WinccoaManager } = require('winccoa-manager');

const winccoa = new WinccoaManager();

const DP_PREFIX = 'RtspCamera_';
const STREAM_TYPE = 'RtspCamera_Stream';
const SYS = 'System1:';
const DEFAULT_PORT = 9999;
const DEFAULT_HOST = '127.0.0.1';
const WS_PATH = '/api/rtsp/stream/:id';
/** Camera ids are slugs (created by the page) — guard the DP path. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_AUDIO_BITRATE_K = 128;
const AUDIO_SAMPLE_RATE = 44_100;

// --- Cyclic RTSP reachability probe -----------------------------------------
// A short ffmpeg pull tests whether each camera's RTSP stream is actually
// reachable (not just the TCP port). Runs on a timer for EVERY camera,
// independently of whether any client is connected, so the page can show a
// live "joignable / injoignable" indicator at all times.
const PROBE_CYCLE_MS = 25_000;
const PROBE_TIMEOUT_MS = 8000;
/** Max simultaneous probes per cycle (keeps CPU/handles bounded). */
const PROBE_CONCURRENCY = 6;
/** Last reachability result per camera id: { reachable, checkedAt, detail }. */
const statusById = new Map();

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[RtspProxy] ${msg}`);
}

/** Many clients / many cameras → silence the EventEmitter listener warning. */
process.setMaxListeners(0);

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

/** Read + parse the RtspCamera_<id>.json datapoint into a camera object. */
async function readCamera(id) {
  const dpe = `${SYS}${DP_PREFIX}${id}.json`;
  if (!winccoa.dpExists(`${DP_PREFIX}${id}.json`)) return null;
  const raw = await winccoa.dpGet([dpe]);
  const json = extractString(raw);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Inject (or replace) the credentials into an rtsp:// URL so they never have to
 * be stored inside the URL field and are not sent by the browser. Strips any
 * pre-existing user:pass@ before adding ours.
 */
function withCredentials(url, user, pass) {
  if (!user) return url;
  const creds = pass
    ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}`
    : encodeURIComponent(user);
  return url.replace(/^(rtsps?:\/\/)(?:[^@/]*@)?/i, `$1${creds}@`);
}

/** Build the extra ffmpeg output flags from the camera's "classic" options. */
function buildFlags(cam) {
  const flags = [];
  // Output frame rate. rtsp-relay hard-codes `-r 30`; appended later this wins.
  const fps = Number(cam.frameRate);
  if (Number.isFinite(fps) && fps > 0) flags.push('-r', String(fps));
  // Downscale to a max width, keeping aspect (force even height for MPEG1).
  const maxW = Number(cam.maxWidth);
  if (Number.isFinite(maxW) && maxW > 0) {
    flags.push('-vf', `scale='min(${maxW},iw)':-2`);
  }
  // Target video bitrate (kbps).
  const bv = Number(cam.videoBitrate);
  if (Number.isFinite(bv) && bv > 0) flags.push('-b:v', `${bv}k`);
  // Audio: JSMpeg only decodes MP2. Off by default to save bandwidth/CPU.
  if (cam.audio) {
    flags.push(
      '-codec:a',
      'mp2',
      '-ar',
      String(AUDIO_SAMPLE_RATE),
      '-ac',
      '1',
      '-b:a',
      `${DEFAULT_AUDIO_BITRATE_K}k`
    );
  } else {
    flags.push('-an');
  }
  return flags;
}

/** Resolve a camera id to the ffmpeg input URL + relay options, or null. */
async function resolveStream(id) {
  if (!ID_RE.test(id)) return null;
  const cam = await readCamera(id);
  if (!cam) return null;
  const baseUrl = String(cam.url ?? '').trim();
  if (!/^rtsps?:\/\//i.test(baseUrl)) return null;
  const url = withCredentials(baseUrl, String(cam.username ?? ''), String(cam.password ?? ''));
  const transport = cam.transport === 'udp' ? 'udp' : 'tcp';
  return { url, transport, additionalFlags: buildFlags(cam), name: String(cam.name ?? id) };
}

function resolvePort() {
  const fromEnv = Number(process.env.RTSP_PROXY_PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : DEFAULT_PORT;
}

// --- reachability probe -----------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

/** Strip the system + `RtspCamera_` prefix from a DP name to get the page id. */
function idFromDpName(name) {
  const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  return bare.startsWith(DP_PREFIX) ? bare.slice(DP_PREFIX.length) : '';
}

/** Last non-empty line of ffmpeg stderr — a concise failure reason. */
function lastErrLine(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines.at(-1).slice(0, 200) : '';
}

/**
 * Probe one resolved stream: a short ffmpeg pull that opens the RTSP session and
 * reads ~1s. Exit 0 = reachable; non-zero / timeout = unreachable. A hard kill
 * timeout guarantees termination even if the connect hangs.
 */
function probeCamera(stream) {
  return new Promise((resolve) => {
    const args = [
      '-rtsp_transport',
      stream.transport,
      '-loglevel',
      'error',
      '-i',
      stream.url,
      '-t',
      '1',
      '-an',
      '-f',
      'null',
      '-'
    ];
    let settled = false;
    let stderr = '';
    let child;
    const finish = (reachable, detail) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ reachable, detail });
    };
    const timer = setTimeout(() => {
      try {
        child?.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish(false, 'délai dépassé (injoignable)');
    }, PROBE_TIMEOUT_MS);
    try {
      child = spawn(ffmpegPath, args, { windowsHide: true });
    } catch (e) {
      finish(false, e?.message ?? 'échec du lancement de ffmpeg');
      return;
    }
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', (e) => finish(false, e?.message ?? 'erreur ffmpeg'));
    child.on('exit', (code) => {
      if (code === 0) finish(true, '');
      else finish(false, lastErrLine(stderr) || `ffmpeg a quitté (code ${code})`);
    });
  });
}

async function probeOne(id) {
  let stream;
  try {
    stream = await resolveStream(id);
  } catch {
    stream = null;
  }
  if (!stream) {
    statusById.set(id, { reachable: false, checkedAt: nowIso(), detail: 'configuration invalide' });
    return;
  }
  const res = await probeCamera(stream);
  statusById.set(id, { reachable: res.reachable, checkedAt: nowIso(), detail: res.detail });
}

/** Probe every camera once (bounded concurrency), then prune stale ids. */
async function probeAll() {
  let names = [];
  try {
    names = winccoa.dpNames('*', STREAM_TYPE) || [];
  } catch (e) {
    log(`Énumération des caméras échouée : ${e?.message ?? e}`);
    return;
  }
  const ids = names.map(idFromDpName).filter(Boolean);
  for (let i = 0; i < ids.length; i += PROBE_CONCURRENCY) {
    await Promise.all(ids.slice(i, i + PROBE_CONCURRENCY).map(probeOne));
  }
  const present = new Set(ids);
  for (const id of Array.from(statusById.keys())) {
    if (!present.has(id)) statusById.delete(id);
  }
}

/** Run the probe cycle forever, spaced by PROBE_CYCLE_MS after each full pass. */
function scheduleProbe() {
  probeAll()
    .catch((e) => log(`Cycle de sonde : ${e?.message ?? e}`))
    .finally(() => setTimeout(scheduleProbe, PROBE_CYCLE_MS));
}

function run() {
  const port = resolvePort();
  const host = process.env.RTSP_PROXY_HOST || DEFAULT_HOST;
  log(`Démarrage du proxy RTSP (ffmpeg → MPEG1-TS → WebSocket) sur ${host}:${port}…`);

  const app = express();
  // rtsp-relay wraps the express app with express-ws and shares one ffmpeg per URL.
  const { proxy } = require('rtsp-relay')(app);

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'rtsp', port });
  });

  // Cyclic RTSP reachability of every camera (independent of connected clients).
  app.get('/api/rtsp/status', (_req, res) => {
    res.json(Object.fromEntries(statusById));
  });

  // The live camera stream. The dashboard webserver proxies the browser's
  // same-origin WebSocket here as ws://127.0.0.1:<port>/api/rtsp/stream/<id>;
  // we resolve <id> to the (credentialed) rtsp URL server-side and hand it to
  // rtsp-relay, which shares one ffmpeg per URL across all connected clients.
  app.ws(WS_PATH, async (ws, req) => {
    const id = String(req.params.id ?? '').trim();
    let stream;
    try {
      stream = await resolveStream(id);
    } catch (error) {
      log(`Résolution échouée pour « ${id} » : ${error?.message ?? error}`);
    }
    if (!stream) {
      log(`Caméra inconnue ou URL invalide : « ${id} » — fermeture.`);
      try {
        ws.close();
      } catch {
        // already closed
      }
      return;
    }
    log(`Client connecté → ${stream.name} (${id})`);
    proxy({
      url: stream.url,
      transport: stream.transport,
      additionalFlags: stream.additionalFlags,
      verbose: false
    })(ws, req);
  });

  app
    .listen(port, host, () => log(`Proxy RTSP à l'écoute sur ws://${host}:${port}${WS_PATH}`))
    .on('error', (e) => log(`Échec de l'écoute sur ${host}:${port} : ${e?.message ?? e}`));

  // Start the cyclic reachability probe (runs regardless of connected clients).
  log(`Sonde de joignabilité RTSP active (cycle ${PROBE_CYCLE_MS / 1000}s).`);
  scheduleProbe();
}

try {
  run();
} catch (e) {
  log(`Erreur fatale : ${e?.message ?? e}`);
}
