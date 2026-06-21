/**
 * Demo VNC connections (self-contained — illustrative endpoints on the local
 * network). Used both as the offline in-memory seed and the empty-state
 * "generate demo" action. The hosts/ports are placeholders; without a reachable
 * VNC server + the `/api/vnc/ws` relay the viewer will simply report a
 * connection error.
 */
import { DEFAULT_VNC_PORT, blankConnection, type VncConnection } from '../types.js';

interface DemoSeed {
  id: string;
  name: string;
  host: string;
  port: number;
  group: string;
  description: string;
  viewOnly: boolean;
  favorite: boolean;
}

const SEEDS: DemoSeed[] = [
  {
    id: 'vnc-demo-hmi-ligne1',
    name: 'IHM Ligne 1',
    host: '10.0.3.21',
    port: DEFAULT_VNC_PORT,
    group: 'Atelier usinage',
    description: 'Panel IHM de la ligne d’usinage 1 (Comfort Panel).',
    viewOnly: false,
    favorite: true
  },
  {
    id: 'vnc-demo-poste-supervision',
    name: 'Poste supervision',
    host: '10.0.3.10',
    port: 5901,
    group: 'Salle de contrôle',
    description: 'PC de supervision WinCC OA (UI client).',
    viewOnly: false,
    favorite: false
  },
  {
    id: 'vnc-demo-four-nitruration',
    name: 'Pupitre four nitruration',
    host: '10.0.4.42',
    port: DEFAULT_VNC_PORT,
    group: 'Traitement thermique',
    description: 'Pupitre opérateur du four de nitruration (lecture seule).',
    viewOnly: true,
    favorite: false
  },
  {
    id: 'vnc-demo-robot-soudage',
    name: 'Baie robot soudage',
    host: '10.0.3.55',
    port: 5900,
    group: 'Atelier soudage',
    description: 'Teach-pendant déporté de la cellule de soudage robotisée.',
    viewOnly: false,
    favorite: false
  }
];

export const DEMO_CONNECTIONS: VncConnection[] = SEEDS.map((s) => ({
  ...blankConnection(),
  id: s.id,
  name: s.name,
  host: s.host,
  port: s.port,
  group: s.group,
  description: s.description,
  viewOnly: s.viewOnly,
  favorite: s.favorite
}));
