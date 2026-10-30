// `wui dev`: the read-only atelier routes of the /api/ai backend (backend/aiRoute.ts +
// fleetAteliers.ts), mocked — for the hosts that embed <wui-fleet-3d-view> or list the ateliers
// in a picker (`wui dev` merges this mock when the site selects machine-fleet-3d or deploys it
// headless). The mock knows no roles: every route answers.
//
// Which ateliers: those the mock data declares, like the page reads them — the
// `MachineFleet3D_Config` type in a fixtures' "types" with its "dps", each atelier in the value of
// `System1:<dp>.json` — else the demonstration atelier the page shows in `wui dev` without them
// (its in-memory fallback, wui-fleet-core DEMO_ATELIER, copied in demo-ateliers.json; a test checks
// the copy against the source). The stop-cause catalog is the value of
// `System1:MachineFleet3D_StopCauses.json`, else empty. /api/ai/chat is not mocked.

import { readFileSync } from 'node:fs';

const CONFIG_TYPE = 'MachineFleet3D_Config';
const DP_PREFIX = 'MachineFleet3D_';
const STOPCAUSE_DP = 'MachineFleet3D_StopCauses';

const DEMO = JSON.parse(readFileSync(new URL('./demo-ateliers.json', import.meta.url), 'utf8'));

const notFound = (id) =>
  Object.assign(new Error(`unknown atelier: ${id}`), {
    status: 404,
    body: { ok: false, error: 'not-found', message: `unknown atelier: ${id}` }
  });

const bare = (name) => String(name).replace(/^[^:]*:/, '').replace(/\.$/, '');

const parse = (value, opening) => {
  if (typeof value !== 'string' || !value.trim().startsWith(opening)) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

/** The ateliers of the mock data, else the demo ones — each with its id and dp, as the backend answers. */
function ateliers(fixtures) {
  const type = fixtures?.types?.[CONFIG_TYPE];
  if (!type) return DEMO.map((atelier) => ({ ...atelier, dp: `${DP_PREFIX}${atelier.id}` }));
  return (type.dps ?? [])
    .map(bare)
    .map((dp) => {
      const atelier = parse(fixtures.values?.[`System1:${dp}.json`], '{');
      return atelier && !Array.isArray(atelier) ? { ...atelier, id: dp.slice(DP_PREFIX.length), dp } : null;
    })
    .filter(Boolean);
}

const summary = (atelier) => ({
  id: atelier.id,
  name: typeof atelier.name === 'string' && atelier.name.trim() !== '' ? atelier.name : atelier.id,
  machineCount: Array.isArray(atelier.machines) ? atelier.machines.length : 0
});

export default {
  'GET /api/ai/fleet/ateliers': ({ fixtures }) => ({
    ok: true,
    ateliers: ateliers(fixtures)
      .map(summary)
      .sort((a, b) => a.name.localeCompare(b.name))
  }),

  'GET /api/ai/fleet/ateliers/:id': ({ params, fixtures }) => {
    const atelier = ateliers(fixtures).find((a) => a.id === params.id);
    if (!atelier) throw notFound(params.id);
    const causes = parse(fixtures?.values?.[`System1:${STOPCAUSE_DP}.json`], '[');
    return { ok: true, atelier, stopCauses: Array.isArray(causes) ? causes : [] };
  }
};
