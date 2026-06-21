'use strict';

/**
 * Minimal MCP (Model Context Protocol) client over the Streamable-HTTP
 * transport, implemented with plain `fetch` (no @modelcontextprotocol/sdk
 * dependency — the aiAssistant manager has no node_modules).
 *
 * It speaks JSON-RPC 2.0 to an MCP server endpoint and supports the three calls
 * the agentic tool loop needs: `initialize`, `tools/list`, `tools/call`. The
 * server may answer a POST with either `application/json` or a single
 * `text/event-stream` event carrying the JSON-RPC message — both are parsed.
 *
 * This is the "local MCP" model: the manager connects to the MCP server
 * (e.g. the WinCC OA MCP server on 127.0.0.1:3000) and executes tool calls on
 * the LLM's behalf, so the cloud provider never needs to reach the server.
 */

const PROTOCOL_VERSION = '2025-06-18';

function headersFor(server, sessionId) {
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  if (server.token) headers.authorization = `Bearer ${server.token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return headers;
}

/** Parse a JSON-RPC message from a JSON or SSE (text/event-stream) body. */
function parseRpc(text) {
  const trimmed = (text || '').trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  for (const line of trimmed.split(/\r?\n/)) {
    const m = /^data:\s*(.*)$/.exec(line);
    if (m && m[1].trim().startsWith('{')) {
      try {
        return JSON.parse(m[1]);
      } catch {
        // try next data line
      }
    }
  }
  throw new Error('Réponse MCP non parsable');
}

async function rpc(server, sessionId, body) {
  const res = await fetch(server.url, {
    method: 'POST',
    headers: headersFor(server, sessionId),
    body: JSON.stringify(body)
  });
  const sid = res.headers.get('mcp-session-id') || sessionId;
  const text = await res.text();
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 200)}`);
  return { msg: parseRpc(text), sessionId: sid };
}

/** Fire-and-forget notification (no JSON-RPC id, no response parsing). */
async function notify(server, sessionId, body) {
  try {
    await fetch(server.url, {
      method: 'POST',
      headers: headersFor(server, sessionId),
      body: JSON.stringify(body)
    });
  } catch {
    // best-effort
  }
}

/** Perform the MCP handshake; returns the session id (or null). */
async function connect(server) {
  const { msg, sessionId } = await rpc(server, null, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'aiAssistant', version: '1.0.0' }
    }
  });
  if (msg && msg.error) throw new Error(`MCP initialize: ${msg.error.message}`);
  await notify(server, sessionId, { jsonrpc: '2.0', method: 'notifications/initialized' });
  return sessionId;
}

/** List the tools exposed by the server. */
async function listTools(server, sessionId) {
  const { msg } = await rpc(server, sessionId, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  if (msg && msg.error) throw new Error(`MCP tools/list: ${msg.error.message}`);
  return (msg && msg.result && msg.result.tools) || [];
}

/** Call a tool; returns { text, isError }. */
async function callTool(server, sessionId, name, args) {
  const { msg } = await rpc(server, sessionId, {
    jsonrpc: '2.0',
    id: Math.floor(Math.random() * 1e9) + 3,
    method: 'tools/call',
    params: { name, arguments: args || {} }
  });
  if (msg && msg.error) throw new Error(`MCP tools/call(${name}): ${msg.error.message}`);
  const result = (msg && msg.result) || {};
  const text = (result.content || [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');
  return { text: text || JSON.stringify(result.content || result), isError: Boolean(result.isError) };
}

module.exports = { connect, listTools, callTool };
