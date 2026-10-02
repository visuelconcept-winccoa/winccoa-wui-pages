// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

'use strict';

/**
 * VNC Proxy — WinCC OA JavaScript Manager hosting an MSA (Manager Service API)
 * vRPC service that resolves a VNC connection *id* to its target host:port.
 *
 * Architecture (mirrors the productInfo / aiAssistant managers):
 *   WebUI (noVNC) ──WebSocket /api/vnc/ws?id=<id>──▶ customer-webserver (relay)
 *                                                        │  MSA vRPC "Resolve(id)"
 *                                                        ▼
 *                                    this manager: service "VncProxy"
 *                                                        │  reads the RemoteVnc_<id> DP
 *                                                        ▼
 *                                              { host, port, name }
 *                                                        │
 *                            relay opens a TCP socket to host:port and proxies
 *                            the raw RFB stream (websockify) ◀──────────────────
 *
 * Keeping the id→host:port mapping server-side (this manager owns the registry,
 * the DPs created by the Remote VNC page) means the browser can only ask for a
 * *known* connection — it never gets to point the relay at an arbitrary
 * host:port (no open proxy / SSRF).
 *
 * Register in config/progs, e.g.:
 *   node | always | 30 | 3 | 5 |vncProxy/index.js
 *
 * The service exposes two unary methods:
 *   Resolve(Variant<string id>) -> Variant<string JSON {ok, host, port, name, error?}>
 *   Status(Variant<*>)          -> Variant<string JSON {<id>: {reachable, checkedAt, detail}}>
 *
 * Status is backed by a cyclic TCP reachability test of every connection's
 * configured host:port (a plain socket connect — "does the configured socket
 * answer?"), run independently of any connected client so the Remote VNC page
 * can show a live reachability indicator.
 *
 * After editing this file, restart the vncProxy manager.
 */
const net = require('node:net');
const { WinccoaManager, Vrpc } = require('winccoa-manager');

const winccoa = new WinccoaManager();

const SERVICE_NAME = 'VncProxy';
const DP_PREFIX = 'RemoteVnc_';
const CONN_TYPE = 'RemoteVnc_Connection';
const SYS = 'System1:';
const MIN_PORT = 1;
const MAX_PORT = 65_535;
/** Connection ids are slugs (created by the page) — guard the DP path. */
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// --- Cyclic TCP reachability test -------------------------------------------
const STATUS_CYCLE_MS = 25_000;
const STATUS_TIMEOUT_MS = 4000;
/** Max simultaneous socket tests per cycle. */
const STATUS_CONCURRENCY = 8;
/** Last reachability result per connection id: { reachable, checkedAt, detail }. */
const statusById = new Map();

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[VncProxy] ${msg}`);
}

function vrpcError(code, message) {
  return new Vrpc.Error(new Vrpc.Status(Vrpc.StatusCode[code], message));
}

function extractString(raw) {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v == null ? '' : String(v);
}

/** Read + parse the RemoteVnc_<id>.json datapoint into a connection object. */
async function readConnection(id) {
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

// ---- reachability test -----------------------------------------------------

function nowIso() {
  return new Date().toISOString();
}

/** Strip the system + `RemoteVnc_` prefix from a DP name to get the page id. */
function idFromDpName(name) {
  const bare = name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
  return bare.startsWith(DP_PREFIX) ? bare.slice(DP_PREFIX.length) : '';
}

/**
 * Test whether the configured socket answers: a plain TCP connect with a
 * timeout. Resolves { reachable, detail } — never rejects.
 */
function testSocket(host, port) {
  return new Promise((resolve) => {
    let settled = false;
    const sock = new net.Socket();
    const done = (reachable, detail) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ reachable, detail });
    };
    sock.setTimeout(STATUS_TIMEOUT_MS);
    sock.once('connect', () => done(true, ''));
    sock.once('timeout', () => done(false, 'délai dépassé (injoignable)'));
    sock.once('error', (e) => done(false, e?.code || e?.message || 'connexion refusée'));
    try {
      sock.connect(port, host);
    } catch (e) {
      done(false, e?.message ?? 'connexion impossible');
    }
  });
}

/** Test every connection's host:port once (bounded concurrency), then prune. */
async function testAll() {
  let names = [];
  try {
    names = winccoa.dpNames('*', CONN_TYPE) || [];
  } catch (e) {
    log(`Énumération des connexions échouée : ${e?.message ?? e}`);
    return;
  }
  const present = new Set();
  for (let i = 0; i < names.length; i += STATUS_CONCURRENCY) {
    await Promise.all(
      names.slice(i, i + STATUS_CONCURRENCY).map(async (name) => {
        const id = idFromDpName(name);
        if (!id) return;
        present.add(id);
        const conn = await readConnection(id);
        const host = String(conn?.host ?? '').trim();
        const port = Number(conn?.port);
        if (!host || !Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
          statusById.set(id, { reachable: false, checkedAt: nowIso(), detail: 'configuration invalide' });
          return;
        }
        const res = await testSocket(host, port);
        statusById.set(id, { reachable: res.reachable, checkedAt: nowIso(), detail: res.detail });
      })
    );
  }
  for (const id of Array.from(statusById.keys())) {
    if (!present.has(id)) statusById.delete(id);
  }
}

/** Run the reachability cycle forever, spaced by STATUS_CYCLE_MS after each pass. */
function scheduleTest() {
  testAll()
    .catch((e) => log(`Cycle de test : ${e?.message ?? e}`))
    .finally(() => setTimeout(scheduleTest, STATUS_CYCLE_MS));
}

// ---- MSA vRPC service ------------------------------------------------------

class VncProxyService extends Vrpc.ServiceBase {
  constructor() {
    super(SERVICE_NAME);
    this.registerFunction('Resolve', (ctx, request) => this.resolve(ctx, request));
    this.registerFunction('Status', (ctx) => this.status(ctx));
  }

  status(serverContext) {
    serverContext.cancelSignal.throwIfAborted();
    return Vrpc.Variant.createString(JSON.stringify(Object.fromEntries(statusById)));
  }

  async resolve(serverContext, request) {
    serverContext.cancelSignal.throwIfAborted();
    if (!request.isString() || request.isNull()) {
      throw vrpcError('InvalidArgument', 'La requête doit être un id de connexion (chaîne)');
    }
    const id = request.getString().trim();
    if (!ID_RE.test(id)) {
      throw vrpcError('InvalidArgument', `Id de connexion invalide : ${id}`);
    }

    const conn = await readConnection(id);
    if (!conn) {
      throw vrpcError('NotFound', `Connexion VNC inconnue : ${id}`);
    }
    const host = String(conn.host ?? '').trim();
    const port = Number(conn.port);
    if (!host) throw vrpcError('FailedPrecondition', `Hôte non renseigné pour ${id}`);
    if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
      throw vrpcError('FailedPrecondition', `Port invalide pour ${id} : ${conn.port}`);
    }

    log(`Resolve ${id} -> ${host}:${port}`);
    return Vrpc.Variant.createString(
      JSON.stringify({ ok: true, host, port, name: String(conn.name ?? id) })
    );
  }
}

async function run() {
  log('Démarrage du service VNC Proxy (MSA vRPC)…');
  const container = new Vrpc.ServiceContainer();
  container.registerService(new VncProxyService(), new Vrpc.ServiceOptions());
  try {
    await container.startAllServices();
    log(`Service "${SERVICE_NAME}" démarré.`);
  } catch (e) {
    log(`Échec du démarrage du service : ${e}`);
  }
  // Start the cyclic socket reachability test (runs regardless of clients).
  log(`Test de joignabilité TCP actif (cycle ${STATUS_CYCLE_MS / 1000}s).`);
  scheduleTest();
}

run().catch((e) => log(`Erreur fatale : ${e}`));
