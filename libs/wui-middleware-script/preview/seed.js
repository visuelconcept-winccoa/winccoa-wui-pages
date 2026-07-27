// SPDX-FileCopyrightText: 2026 VISUEL CONCEPT
// SPDX-License-Identifier: AGPL-3.0-only

// Preview seed — demo tasks, simulated live values/statuses, and a fetch mock
// covering the two backends the page talks to:
//   /api/para/*                 → always ok (persistence is the in-memory store)
//   /api/middleware-script/test → a REAL browser-side dry-run of the draft
//                                 script (same (inputs, output, log) contract as
//                                 the manager sandbox — preview only, of course
//                                 without the worker/vm containment).
// Everything hangs off globalThis so the stubs stay generic.

globalThis.__previewLocale = 'fr.utf8';

const now = () => new Date().toISOString();

globalThis.__previewSeed = [
  {
    id: 'alarme-niveau-cuve',
    name: 'Alarme niveau cuve',
    description: 'Alarme haute sur le niveau de la cuve 1 (seuil 90 %).',
    enabled: true,
    trigger: { kind: 'dpe', debounceMs: 200 },
    inputs: [{ alias: 'niveau', dpe: 'System1:Cuve1.niveau' }],
    outputs: [{ alias: 'alarmeHaut', dpe: 'System1:Cuve1.alarmeHaut' }],
    script: [
      '// Alarme haute simple sur le niveau de cuve.',
      'const seuil = 90;',
      "output('alarmeHaut', inputs.niveau > seuil);",
      "log('niveau =', inputs.niveau, '=> alarme', inputs.niveau > seuil);"
    ].join('\n'),
    timeoutMs: 1000,
    updatedAt: now()
  },
  {
    id: 'moyenne-debit-pompes',
    name: 'Moyenne débit pompes',
    description: 'Recalcule le débit moyen des deux pompes toutes les 30 s.',
    enabled: true,
    trigger: { kind: 'cyclic', intervalS: 30 },
    inputs: [
      { alias: 'debitP1', dpe: 'System1:PompeA.debit' },
      { alias: 'debitP2', dpe: 'System1:PompeB.debit' }
    ],
    outputs: [{ alias: 'debitMoyen', dpe: 'System1:Station.debitMoyen' }],
    script: "output('debitMoyen', (inputs.debitP1 + inputs.debitP2) / 2);",
    timeoutMs: 1000,
    updatedAt: now()
  },
  {
    id: 'recopie-consigne',
    name: 'Recopie consigne secours',
    description: 'Recopie la consigne active vers l’automate de secours.',
    enabled: false,
    trigger: { kind: 'dpe', debounceMs: 500 },
    inputs: [{ alias: 'consigne', dpe: 'System1:Regulation.consigne' }],
    outputs: [{ alias: 'consigneSecours', dpe: 'System1:Secours.consigne' }],
    script: "output('consigneSecours', inputs.consigne);",
    timeoutMs: 500,
    updatedAt: now()
  }
];

globalThis.__previewDpValues = {
  'System1:Cuve1.niveau': 93.5,
  'System1:PompeA.debit': 12.4,
  'System1:PompeB.debit': 10.8,
  'System1:Regulation.consigne': 68
};

globalThis.__previewStatuses = {
  'MiddlewareScript_Task_alarme-niveau-cuve.status': JSON.stringify({
    state: 'idle',
    lastRunAt: now(),
    lastDurationMs: 3,
    runCount: 128
  }),
  'MiddlewareScript_Task_moyenne-debit-pompes.status': JSON.stringify({
    state: 'error',
    lastRunAt: now(),
    lastDurationMs: 1002,
    lastError: 'Timeout du script (1000 ms)',
    runCount: 42
  }),
  'MiddlewareScript_Task_recopie-consigne.status': JSON.stringify({ state: 'disabled', runCount: 0 })
};

// ---- fetch mock ---------------------------------------------------------------

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Browser-side dry-run mirroring the manager sandbox's script contract. */
function dryRun(task, inputValues) {
  const outputs = {};
  const logs = [];
  const allowed = new Set((task.outputs ?? []).map((binding) => binding.alias));
  const output = (alias, value) => {
    if (!allowed.has(String(alias))) throw new Error(`output('${alias}') : alias de sortie non déclaré`);
    outputs[String(alias)] = value;
  };
  const log = (...args) => {
    logs.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
  };
  const inputs = Object.freeze({ ...inputValues });
  const started = performance.now();
  try {
    // Preview-only execution — the real dry-run runs in the manager's worker
    // sandbox; this keeps the Test tab usable without any backend.
    const fn = new Function('inputs', 'output', 'log', `'use strict';\n${task.script}`);
    fn(inputs, output, log);
    return { ok: true, outputs, logs, durationMs: Math.max(1, Math.round(performance.now() - started)) };
  } catch (error) {
    return {
      ok: false,
      error: String(error?.message ?? error),
      outputs,
      logs,
      durationMs: Math.max(1, Math.round(performance.now() - started))
    };
  }
}

const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.startsWith('/api/middleware-script/health')) {
    return jsonResponse({ ok: true, service: 'middleware-script', vrpc: 'preview' });
  }
  if (url.startsWith('/api/middleware-script/test')) {
    try {
      const body = JSON.parse(init?.body ?? '{}');
      return jsonResponse(dryRun(body.task ?? {}, body.inputValues ?? {}));
    } catch (error) {
      return jsonResponse({ ok: false, error: String(error) }, 400);
    }
  }
  if (url.startsWith('/api/para/')) {
    return jsonResponse({ ok: true });
  }
  return realFetch(input, init);
};
